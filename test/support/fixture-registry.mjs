// A THROWAWAY npm REGISTRY, SO THE INSTALL CHECKS GRADE THE SAME WAY ON ANY DAY.
//
// `minimumReleaseAge` and `trustPolicy` are decided from two facts a registry reports about a
// package: WHEN each version was published, and WHAT trust evidence each version carries. Both are
// properties of the public registry's data at the moment you look, so a test that exercised them
// against registry.npmjs.org would pass today and fail whenever a publisher shipped a release or
// stopped attaching provenance. `## Grading scenarios` in the spec says so in as many words: "A test
// that would pass today and fail next week has not graded the criterion."
//
// So this module STANDS UP A REGISTRY whose packuments say exactly what a scenario needs, and points
// a throwaway project's install at it. The publish dates are computed relative to the moment the
// test runs, which is what makes "newer than the cooldown" and "older than the cooldown" stable
// facts rather than calendar accidents. Nothing here reaches the network.
//
// ZERO DEPENDENCIES, INCLUDING FOR THE TARBALLS. A gzipped tar is 512-byte ustar headers and
// node:zlib, so the archive is built here rather than shelled out to `tar`, and the sha512 the
// packument advertises is computed from the exact bytes this server will serve. pnpm verifies that
// integrity, so a wrong tarball fails loudly instead of quietly resolving nothing.
//
// IT REFUSES TO GRADE UNDER THE WRONG pnpm. Every behaviour asserted through this module is a
// behaviour of the version this repository pins, and the v11 fail-safe knobs that would change two
// of the answers do not exist at that version. `pnpmVersionIn` is what the caller asserts against
// the pin, so a pass from some other pnpm that happened to be on PATH reds the test instead.

import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(here, "..", "..");

/** `pnpm@10.34.5`, read from the repository rather than transcribed. */
export const PACKAGE_MANAGER = JSON.parse(
  readFileSync(join(REPO_ROOT, "package.json"), "utf8"),
).packageManager;

export const PINNED_PNPM_VERSION = PACKAGE_MANAGER.split("@").pop();

// ---------------------------------------------------------------------------
// tar
// ---------------------------------------------------------------------------

function octal(value, width) {
  return value.toString(8).padStart(width - 1, "0") + " ";
}

/** One ustar file entry: a 512-byte header, the data, and padding to the next 512-byte boundary. */
function tarEntry(name, contents) {
  const data = Buffer.from(contents, "utf8");
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write(octal(0o644, 8), 100, 8, "ascii");
  header.write(octal(0, 8), 108, 8, "ascii");
  header.write(octal(0, 8), 116, 8, "ascii");
  header.write(octal(data.length, 12), 124, 12, "ascii");
  header.write(octal(0, 12), 136, 12, "ascii"); // mtime 0: the archive is byte-stable
  header.write("        ", 148, 8, "ascii"); // checksum field counts as spaces while summing
  header.write("0", 156, 1, "ascii"); // typeflag: regular file
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");
  const padding = Buffer.alloc((512 - (data.length % 512)) % 512);
  return Buffer.concat([header, data, padding]);
}

/** A gzipped tarball of `{ "package/<path>": "<contents>" }`, the layout npm tarballs use. */
export function makeTarball(files) {
  const entries = Object.entries(files).map(([path, contents]) => tarEntry(path, contents));
  return gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]), { level: 9 });
}

// ---------------------------------------------------------------------------
// packuments
// ---------------------------------------------------------------------------

/**
 * The trust evidence pnpm reads off a version, in the three shapes it distinguishes.
 *
 * pnpm ranks a version's evidence from `_npmUser.trustedPublisher` plus `dist.attestations
 * .provenance` (strongest), `dist.attestations.provenance` alone, then nothing at all, and
 * `trustPolicy: no-downgrade` refuses a version whose rank is below that of any earlier-published
 * version of the same package.
 */
export const TRUST = {
  trustedPublisher: (manifest) => ({
    ...manifest,
    _npmUser: { name: "fixture", trustedPublisher: { id: "fixture-ci", oidcConfigId: "fixture" } },
    dist: {
      ...manifest.dist,
      attestations: {
        url: "about:blank",
        provenance: { predicateType: "https://slsa.dev/provenance/v1" },
      },
    },
  }),
  provenance: (manifest) => ({
    ...manifest,
    _npmUser: { name: "fixture" },
    dist: {
      ...manifest.dist,
      attestations: {
        url: "about:blank",
        provenance: { predicateType: "https://slsa.dev/provenance/v1" },
      },
    },
  }),
  none: (manifest) => ({ ...manifest, _npmUser: { name: "fixture" } }),
};

/**
 * Start the registry.
 *
 * @param {Record<string, {
 *   omitTime?: boolean,
 *   versions: Record<string, { minutesAgo?: number, trust?: "trustedPublisher"|"provenance"|"none" }>
 * }>} spec
 * @returns {Promise<{ url: string, close: () => Promise<void>, requested: string[] }>}
 */
export async function startFixtureRegistry(spec) {
  const now = Date.now();
  const tarballs = new Map();
  const packuments = new Map();
  const requested = [];

  const server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? "").split("?")[0]);
    requested.push(path);
    if (tarballs.has(path)) {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end(tarballs.get(path));
      return;
    }
    const name = path.replace(/^\//, "");
    if (packuments.has(name)) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(packuments.get(name)));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/`;

  for (const [name, pkg] of Object.entries(spec)) {
    const basename = name.slice(name.lastIndexOf("/") + 1);
    const versions = {};
    const time = { created: new Date(now - 10 * 365 * 24 * 60 * 60_000).toISOString() };
    for (const [version, entry] of Object.entries(pkg.versions)) {
      const tarball = makeTarball({
        "package/package.json": `${JSON.stringify({ name, version, main: "index.js" }, null, 2)}\n`,
        "package/index.js": `module.exports = ${JSON.stringify(`${name}@${version}`)};\n`,
      });
      const tarballPath = `/${name}/-/${basename}-${version}.tgz`;
      tarballs.set(tarballPath, tarball);
      const base = {
        name,
        version,
        dist: {
          tarball: `${url.replace(/\/$/, "")}${tarballPath}`,
          integrity: `sha512-${createHash("sha512").update(tarball).digest("base64")}`,
          shasum: createHash("sha1").update(tarball).digest("hex"),
        },
      };
      versions[version] = TRUST[entry.trust ?? "none"](base);
      time[version] = new Date(now - (entry.minutesAgo ?? 0) * 60_000).toISOString();
    }
    const latest = Object.keys(pkg.versions).at(-1);
    time.modified = new Date(now).toISOString();
    const packument = { name, "dist-tags": { latest }, versions };
    // NOT `time: {}`: the scenario asks for a packument with NO time field at all, which is what a
    // mirror that cannot date its releases actually serves.
    if (pkg.omitTime !== true) packument.time = time;
    packuments.set(name, packument);
  }

  return {
    url,
    requested,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

// ---------------------------------------------------------------------------
// throwaway projects
// ---------------------------------------------------------------------------

/**
 * This repository's committed workspace settings, MINUS the `packages:` key.
 *
 * READ, NEVER TRANSCRIBED. A throwaway project that inherits these settings is grading the file
 * this spec ships, so weakening `pnpm-workspace.yaml` reds the install fixtures rather than leaving
 * them passing against a copy of the old values.
 */
export function inheritedWorkspaceSettings() {
  const text = readFileSync(join(REPO_ROOT, "pnpm-workspace.yaml"), "utf8");
  const lines = text.split("\n");
  const out = [];
  let inPackages = false;
  for (const line of lines) {
    if (/^packages:/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages && /^\s+-/.test(line)) continue;
    inPackages = false;
    out.push(line);
  }
  return out.join("\n");
}

/**
 * The scope every fixture package lives under.
 *
 * IT EXISTS SO THE DEFAULT REGISTRY CAN STAY THE REAL ONE. A fixture that set `--registry` to the
 * throwaway server pointed pnpm's OWN self-management at it too: `packageManager` makes pnpm fetch
 * the pinned pnpm from the registry, the fixture server does not carry a `pnpm` packument, and
 * every scenario failed with a 404 on `/pnpm` before it graded anything (measured while building
 * this file). Routing one SCOPE to the fixture server leaves pnpm free to fetch itself from npmjs
 * while every dependency under test still comes from metadata this file wrote.
 */
export const FIXTURE_SCOPE = "@cosyte-fixture";

/** Write a throwaway project that depends on `deps` and carries `settings` as its pnpm config. */
export function writeFixtureProject(dir, { deps, settings, registryUrl }) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify(
      {
        name: "install-hardening-fixture",
        version: "0.0.0",
        private: true,
        packageManager: PACKAGE_MANAGER,
        dependencies: deps,
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(join(dir, "pnpm-workspace.yaml"), `${settings}\n`);
  writeFileSync(join(dir, ".npmrc"), `${FIXTURE_SCOPE}:registry=${registryUrl}\n`);
  return dir;
}

/**
 * The environment a fixture runs in, with EVERY inherited pnpm setting removed.
 *
 * MEASURED, AND IT INVALIDATED THE FIRST DRAFT OF THIS FILE. `pnpm run <script>` exports its whole
 * effective configuration into the child environment - running `pnpm run test:root` in this
 * repository puts `npm_config_minimum_release_age=1440` and `npm_config_trust_policy=no-downgrade`
 * into every process the suite spawns - and an environment variable configures pnpm just as a
 * settings file does. A fixture that inherited them was not grading its own
 * `pnpm-workspace.yaml` at all: the "no hardening at all" CONTROL still refused the install, and it
 * did so only under `pnpm run` and not under `pnpm exec`, which is the shape of a flake nobody
 * tracks down.
 *
 * So every `npm_config_*` and `pnpm_config_*` variable is dropped, and each scenario's settings come
 * from the file this suite wrote and from nowhere else. pnpm re-derives its own configuration from
 * files when they are absent, so nothing needed is lost.
 *
 * (The same leak is why `scripts/install-hardening.mjs` compares the environment against the
 * declared value rather than trusting the file: this is AC-5's third input, observed rather than
 * imagined.)
 */
export function hermeticEnv() {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (/^(npm|pnpm)_config_/i.test(name)) delete env[name];
  }
  return env;
}

/**
 * The pnpm a fixture will actually run, and a refusal when it is not the pinned one.
 *
 * A fixture project declares `packageManager`, so pnpm switches itself to the pinned version. If it
 * did not - an offline runner, a pnpm too old to self-manage - every assertion below would be
 * grading some other tool, and two of them (Task 3's measurements) have DIFFERENT answers on v11.
 * Refusing is the same discipline the phi-scan probe applies: an assertion whose premise cannot be
 * grounded reports nothing rather than a pass.
 */
export function pnpmVersionIn(dir) {
  const r = spawnSync("pnpm", ["--version"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 300_000,
    env: hermeticEnv(),
  });
  return (r.stdout ?? "").trim();
}

/**
 * Run `pnpm install` in a fixture, against the fixture registry, in a store of its own.
 *
 * ASYNCHRONOUS, AND THAT IS NOT A STYLE CHOICE. The registry above is an HTTP server in THIS
 * process, so a synchronous spawn would block the event loop that has to answer it: pnpm would
 * connect, wait forever for a packument nobody is serving, and the test would hang rather than
 * fail. Measured while building this fixture, and recorded here because the failure looks like a
 * slow install rather than a deadlock.
 *
 * The store and the metadata cache live inside the throwaway directory, so a fabricated packument
 * can never reach the developer's real pnpm store, and a second scenario can never be answered from
 * the first one's cached metadata.
 */
export function runFixtureInstall(dir, extraArgs = []) {
  const child = spawn(
    "pnpm",
    [
      "install",
      "--store-dir",
      join(dir, ".store"),
      "--cache-dir",
      join(dir, ".cache"),
      "--ignore-scripts",
      "--no-frozen-lockfile",
      "--reporter=append-only",
      ...extraArgs,
    ],
    { cwd: dir, stdio: ["ignore", "pipe", "pipe"], timeout: 600_000, env: hermeticEnv() },
  );
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  return new Promise((resolve) => {
    child.on("close", (status) => resolve({ status: status ?? -1, output }));
  });
}
