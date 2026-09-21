/**
 * THE RELEASE PIPELINE MUST TELL "NOT YET PROPAGATED" APART FROM "NEVER PUBLISHED".
 *
 * On attempt 1 of publish run 35512528046 every one of eight packages published, and the run reded
 * anyway: the presence check gave `@cosyte/test-utils@0.1.0` about ten seconds to appear on the
 * public registry and the registry recorded it 73.594 seconds after the check had already given up.
 * A false failure on a permanent release costs a second approval on the protected `release`
 * environment, and it leaves the run's terminal sentence unsaid. The measurement is in
 * `documentation/registry-propagation-evidence.md`.
 *
 * WHAT THE DOUBLES STAND IN FOR, WHICH IS THE PART TO READ BEFORE TRUSTING ANY OF THIS. The SUBJECT
 * is the accounting in `scripts/registry-presence.mjs`: the budget, the retry, the
 * propagated-versus-absent-versus-unreadable decision, and what each one says. The BOUNDARIES are
 * the public registry and the GitHub releases API, and only those are doubled:
 *
 *   * THE REGISTRY is a real HTTP server this file starts on 127.0.0.1, answered by the REAL
 *     `npm view` the workflow runs, over a real socket. A version that 404s on two probes and then
 *     200s is the race, reproduced rather than described. Nothing here replaces the probe with a
 *     scripted sequence and then asserts the accounting agrees with the script, which would be the
 *     double standing in for the subject.
 *   * `gh` is a stub on PATH, because creating a GitHub release is the one thing a test cannot do.
 *
 * `test/no-network.setup.ts` permits exactly this: it refuses `fetch` and DNS for every host except
 * the loopback literals, and it does not reach into child processes. The install-hardening suite
 * stands up a fixture registry the same way.
 *
 * AND THE SHIPPED WORKFLOW IS WHAT RUNS. The end-to-end cases do not re-type the release step's
 * shell: they slice the `run:` block out of `.github/workflows/release.yml` and execute it under
 * bash. A change to that block changes what these cases grade.
 */

import { spawn, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { hermeticEnv } from "./support/fixture-registry.mjs";
import { renderNotes, slugFor } from "../scripts/release-notes.mjs";
import {
  ABSENT,
  PRESENCE_BUDGET_SECONDS,
  PRESENT,
  UNREADABLE,
  account,
  parseBumpedPackages,
} from "../scripts/registry-presence.mjs";

const REPO_ROOT = join(import.meta.dirname, "..");
const WORKFLOW = readFileSync(join(REPO_ROOT, ".github", "workflows", "release.yml"), "utf8");
const EVIDENCE = readFileSync(
  join(REPO_ROOT, "documentation", "registry-propagation-evidence.md"),
  "utf8",
);

/** The scope every fixture package here lives under, so a name can never collide with a real one. */
const SCOPE = "@cosyte-fixture";

const scratch: string[] = [];
const servers: Server[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The registry, which is the boundary
// ---------------------------------------------------------------------------

type Behaviour =
  | { kind: "present" }
  | { kind: "absent" }
  /** 404 for the first `probes` requests, then the version appears. This is the race. */
  | { kind: "appears-after"; probes: number }
  /** A status the registry has no business returning, which is not an answer about the version. */
  | { kind: "status"; code: number }
  /** One real "no such version", then nothing but failures. One answer is still an answer. */
  | { kind: "absent-then-status"; code: number }
  /** Accept the connection and never answer, which is the case that must still terminate. */
  | { kind: "hang" };

interface Fixture {
  url: string;
  /** How many packument requests each package has taken, so a case can assert probes happened. */
  hits: Map<string, number>;
}

/**
 * Start a registry on the loopback interface that answers for `spec` and 404s for everything else.
 *
 * The packument is the shape `npm view <name>@<version> version` reads: a `versions` map. A version
 * missing from an otherwise healthy packument is what the registry serves between the moment a
 * publish is accepted and the moment its record propagates, which is the state the whole defect
 * turns on, so "absent" is served that way rather than as a missing package.
 */
async function startRegistry(spec: Record<string, Behaviour>, version = "1.0.0"): Promise<Fixture> {
  const hits = new Map<string, number>();
  const sockets = new Set<{ destroy: () => void }>();

  const packument = (name: string, versions: string[]) => ({
    name,
    "dist-tags": { latest: versions.at(-1) },
    versions: Object.fromEntries(versions.map((v) => [v, { name, version: v, dist: {} }])),
    time: Object.fromEntries(versions.map((v) => [v, new Date().toISOString()])),
  });

  const server = createServer((request, response) => {
    const path = decodeURIComponent((request.url ?? "").split("?")[0]).replace(/^\//, "");
    const behaviour = spec[path];
    if (behaviour === undefined) {
      response.writeHead(404, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify({ error: "Not found" }));
      return;
    }
    const seen = (hits.get(path) ?? 0) + 1;
    hits.set(path, seen);

    if (behaviour.kind === "hang") return;
    if (behaviour.kind === "status" || (behaviour.kind === "absent-then-status" && seen > 1)) {
      response.writeHead(behaviour.code, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      response.end(JSON.stringify({ error: "the registry is not answering about this version" }));
      return;
    }
    // "absent" and a race before its turnover both serve a healthy packument WITHOUT the version.
    const visible =
      behaviour.kind === "present" ||
      (behaviour.kind === "appears-after" && seen > behaviour.probes)
        ? ["0.0.1", version]
        : ["0.0.1"];
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify(packument(path, visible)));
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  const closeAll = server.close.bind(server);
  server.close = ((callback?: () => void) => {
    for (const socket of sockets) socket.destroy();
    return closeAll(callback);
  }) as typeof server.close;

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  servers.push(server);
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("registry has no port");
  return { url: `http://127.0.0.1:${address.port}/`, hits };
}

/** The environment a probe runs in: this fixture registry, an isolated cache, nothing inherited. */
function registryEnv(url: string): NodeJS.ProcessEnv {
  return {
    ...hermeticEnv(),
    npm_config_registry: url,
    npm_config_cache: tempDir("registry-presence-cache-"),
  };
}

/** Run the accounting against a fixture registry, collecting everything it said. */
async function run(
  packages: { name: string; version: string }[],
  url: string,
  options: { arm?: "publish" | "version"; budgetSeconds?: number; intervalSeconds?: number } = {},
) {
  const lines: string[] = [];
  const started = Date.now();
  const result = await account({
    packages,
    arm: options.arm ?? "publish",
    budgetSeconds: options.budgetSeconds ?? 3,
    intervalSeconds: options.intervalSeconds ?? 0.5,
    probeTimeoutSeconds: 10,
    env: registryEnv(url),
    log: (line: string) => lines.push(line),
  });
  return { ...result, log: lines.join("\n"), elapsedSeconds: (Date.now() - started) / 1000 };
}

const pkg = (slug: string, version = "1.0.0") => ({ name: `${SCOPE}/${slug}`, version });

// ---------------------------------------------------------------------------
// The shipped workflow, which is what actually runs in a release
// ---------------------------------------------------------------------------

/**
 * The `run:` block of a named step, sliced out of the workflow this repository ships.
 *
 * Read rather than re-typed, so a case cannot pass against a copy of a step that no longer exists.
 * It refuses instead of guessing: a renamed step is a missing measurement, not a green run.
 */
function stepScript(stepName: string): string {
  const lines = WORKFLOW.split("\n");
  const start = lines.findIndex((line) => line.trim() === `- name: ${stepName}`);
  if (start === -1) throw new Error(`release.yml has no step named ${JSON.stringify(stepName)}`);
  let runAt = -1;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].trim().startsWith("- name:")) break;
    if (/^\s+run: \|\s*$/.test(lines[i])) {
      runAt = i;
      break;
    }
  }
  if (runAt === -1) throw new Error(`step ${JSON.stringify(stepName)} has no literal run block`);
  const indent = lines[runAt].search(/\S/) + 2;
  const body: string[] = [];
  for (let i = runAt + 1; i < lines.length; i += 1) {
    if (lines[i].trim() === "") {
      body.push("");
      continue;
    }
    if (lines[i].search(/\S/) < indent) break;
    body.push(lines[i].slice(indent));
  }
  return `${body.join("\n").trimEnd()}\n`;
}

const PUBLISH_STEP = "Every bumped package must be published, tagged and released";
const VERSION_STEP = "A version commit taking this arm must not go green unpublished";

/** A `gh` that records what it was asked to do and reports that no release exists yet. */
function stubGh(dir: string): string {
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  const path = join(bin, "gh");
  writeFileSync(
    path,
    [
      "#!/usr/bin/env bash",
      'printf "%s\\n" "gh $*" >> "$GH_LOG"',
      '[ "$1 $2" = "release view" ] && exit 1',
      "exit 0",
      "",
    ].join("\n"),
  );
  chmodSync(path, 0o755);
  return bin;
}

/** Run one of the shipped step bodies under bash, against a fixture registry. */
function runStep(
  step: string,
  packages: { name: string; version: string }[],
  url: string,
  options: { bumpedPackagesRaw?: string } = {},
): Promise<{ status: number; output: string; gh: string }> {
  const dir = tempDir("registry-presence-step-");
  const runnerTemp = join(dir, "runner-temp");
  const notesDir = join(runnerTemp, "release-notes");
  mkdirSync(notesDir, { recursive: true });
  for (const { name, version } of packages) {
    writeFileSync(
      join(notesDir, `${slugFor(name)}.md`),
      renderNotes({
        packageName: name,
        version,
        summaries: [`A fixture release body, so the shipped accounting step can run end to end.`],
      }),
      "utf8",
    );
  }
  const ghLog = join(dir, "gh.log");
  writeFileSync(ghLog, "", "utf8");
  const script = join(dir, "step.sh");
  writeFileSync(script, stepScript(step), "utf8");

  const env = {
    ...registryEnv(url),
    PATH: `${stubGh(dir)}:${process.env.PATH ?? ""}`,
    RUNNER_TEMP: runnerTemp,
    GITHUB_SHA: "1".repeat(40),
    GH_TOKEN: "fixture-token",
    GH_LOG: ghLog,
    NOTES_DIR: notesDir,
    BUMPED_PACKAGES: options.bumpedPackagesRaw ?? JSON.stringify(packages),
  };

  const child = spawn("bash", [script], {
    cwd: REPO_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => (output += chunk));
  child.stderr.on("data", (chunk: string) => (output += chunk));
  return new Promise((resolve) => {
    child.on("close", (status) =>
      resolve({ status: status ?? -1, output, gh: readFileSync(ghLog, "utf8") }),
    );
  });
}

// ---------------------------------------------------------------------------
// AC-1
// ---------------------------------------------------------------------------

describe("AC-1: a version absent on the first probe and present on a later one is published, not missing", () => {
  it(
    "accounts a package the registry only reports after several probes, and does not fail on it",
    { timeout: 120_000 },
    async () => {
      const racer = pkg("ac1-races");
      const registry = await startRegistry({ [racer.name]: { kind: "appears-after", probes: 2 } });

      const result = await run([racer], registry.url, { budgetSeconds: 6, intervalSeconds: 0.5 });

      expect(result.rows[0].state, result.log).toBe(PRESENT);
      expect(result.code, result.log).toBe(0);
      // Not merely "it eventually said present": it had to be told no first, or the fixture never
      // reproduced the race and this case would pass against a registry that always answered yes.
      expect(result.rows[0].probes).toBeGreaterThan(1);
      expect(registry.hits.get(racer.name)).toBeGreaterThan(2);
    },
  );

  it(
    "CONTROL: a package that never appears inside the budget is NOT tolerated",
    { timeout: 120_000 },
    async () => {
      // Without this, a check that answered "present" for everything would pass the case above.
      const gone = pkg("ac1-never-appears");
      const registry = await startRegistry({ [gone.name]: { kind: "absent" } });

      const result = await run([gone], registry.url, { budgetSeconds: 2, intervalSeconds: 0.5 });

      expect(result.rows[0].state).toBe(ABSENT);
      expect(result.code).not.toBe(0);
    },
  );

  it(
    "END TO END: the shipped publish step tags and releases a package that raced",
    { timeout: 180_000 },
    async () => {
      const racer = pkg("ac1-end-to-end");
      const registry = await startRegistry({ [racer.name]: { kind: "appears-after", probes: 1 } });

      const step = await runStep(PUBLISH_STEP, [racer], registry.url);

      expect(step.status, step.output).toBe(0);
      expect(step.gh).toContain(`gh release create ${racer.name}@${racer.version}`);
      expect(step.output).toContain("are published, tagged and released");
    },
  );
});

// ---------------------------------------------------------------------------
// AC-2
// ---------------------------------------------------------------------------

describe("AC-2: a propagation wait is said out loud, so it is not indistinguishable from an immediate hit", () => {
  it(
    "names the package, the version and the elapsed seconds to first success",
    { timeout: 120_000 },
    async () => {
      const racer = pkg("ac2-slow", "2.3.4");
      const registry = await startRegistry(
        { [racer.name]: { kind: "appears-after", probes: 2 } },
        racer.version,
      );

      const result = await run([racer], registry.url, { budgetSeconds: 6, intervalSeconds: 0.5 });

      const line = result.log.split("\n").find((l) => l.includes("Propagation wait"));
      expect(line, result.log).toBeDefined();
      expect(line).toContain(racer.name);
      expect(line).toContain(racer.version);
      // The elapsed seconds, not just the word "seconds": one probe interval has gone by at least.
      expect(line).toMatch(/\b\d+(\.\d+)?s\b/);
    },
  );

  it(
    "CONTROL: a version present on the first probe reports no propagation wait",
    { timeout: 120_000 },
    async () => {
      const quick = pkg("ac2-immediate");
      const registry = await startRegistry({ [quick.name]: { kind: "present" } });

      const result = await run([quick], registry.url);

      expect(result.code).toBe(0);
      expect(result.log).not.toContain("Propagation wait");
    },
  );
});

// ---------------------------------------------------------------------------
// AC-3
// ---------------------------------------------------------------------------

describe("AC-3: a package still absent when the budget is exhausted reds the job, by name", () => {
  it(
    "exits non-zero and annotates `Bumped but never published` with the names and the count",
    { timeout: 120_000 },
    async () => {
      const here = pkg("ac3-published");
      const gone = pkg("ac3-never-published");
      const registry = await startRegistry({
        [here.name]: { kind: "present" },
        [gone.name]: { kind: "absent" },
      });

      const result = await run([here, gone], registry.url, {
        budgetSeconds: 2,
        intervalSeconds: 0.5,
      });

      expect(result.code).not.toBe(0);
      const annotation = result.log
        .split("\n")
        .find((l) => l.startsWith("::error title=Bumped but never published::"));
      expect(annotation, result.log).toBeDefined();
      expect(annotation).toContain(`${gone.name}@${gone.version}`);
      // The count against the expected total, which is what tells a reader whether the release
      // half happened or did not happen at all.
      expect(annotation).toContain("1 of 2 package(s)");
      // The one that IS on the registry is not named: an annotation that listed both would be
      // reporting the rule rather than the violation.
      expect(annotation).not.toContain(here.name);
    },
  );

  it(
    "END TO END: the shipped publish step reds when the accounting reds",
    { timeout: 120_000 },
    async () => {
      // Driven through an input the accounting refuses outright rather than through an absent
      // package, because an absent package costs the whole shipped budget in wall time and this is
      // a required check. What it grades is the wiring: the step does not swallow the refusal.
      const registry = await startRegistry({});

      const step = await runStep(PUBLISH_STEP, [], registry.url, { bumpedPackagesRaw: "[]" });

      expect(step.status, step.output).not.toBe(0);
      expect(step.output).toContain("named no packages");
      expect(step.gh.trim()).toBe("");
    },
  );
});

// ---------------------------------------------------------------------------
// AC-4
// ---------------------------------------------------------------------------

describe("AC-4: a registry that cannot be read is not reported as a package that was never published", () => {
  it(
    "reports `Registry could not be read`, names the package and the failure, and does not say `Bumped but never published`",
    { timeout: 120_000 },
    async () => {
      const unreadable = pkg("ac4-server-error");
      const registry = await startRegistry({ [unreadable.name]: { kind: "status", code: 500 } });

      const result = await run([unreadable], registry.url, {
        budgetSeconds: 2,
        intervalSeconds: 0.5,
      });

      expect(result.code).not.toBe(0);
      expect(result.rows[0].state).toBe(UNREADABLE);
      const annotation = result.log
        .split("\n")
        .find((l) => l.startsWith("::error title=Registry could not be read::"));
      expect(annotation, result.log).toBeDefined();
      expect(annotation).toContain(`${unreadable.name}@${unreadable.version}`);
      // The underlying failure, so a human is not sent to hunt for a package.
      expect(result.log).toContain("E500");
      expect(result.log).not.toContain("::error title=Bumped but never published::");
    },
  );

  it(
    "BOUNDARY: a package the registry reported absent even once is `Bumped but never published`, not unreadable",
    { timeout: 120_000 },
    async () => {
      // AC-4 is "EVERY probe failed for a reason other than the registry reporting it absent". One
      // real answer of "no such version" is an answer, and it decides.
      // The first probe gets a real "no such version"; every later one gets a 500. The verdict
      // must follow the answer, not the last failure.
      const flaky = pkg("ac4-answered-once");
      const registry = await startRegistry({
        [flaky.name]: { kind: "absent-then-status", code: 500 },
      });

      const result = await run([flaky], registry.url, { budgetSeconds: 2, intervalSeconds: 0.5 });

      expect(result.rows[0].probes).toBeGreaterThan(1);
      expect(result.rows[0].state).toBe(ABSENT);
      expect(result.log).toContain("::error title=Bumped but never published::");
      expect(result.log).not.toContain("::error title=Registry could not be read::");
    },
  );
});

// ---------------------------------------------------------------------------
// AC-5
// ---------------------------------------------------------------------------

describe("AC-5: presence is decided from the registry alone, so a re-run completes a partial publish", () => {
  it(
    "END TO END: tags and releases every bumped package on a run that published nothing itself",
    { timeout: 180_000 },
    async () => {
      // This is the re-run: `changeset publish` found everything already on the registry and
      // published nothing, so a check keyed on the run's own output would skip. No publish step
      // runs in this case at all, and every package must still be tagged and released.
      const already = [pkg("ac5-one"), pkg("ac5-two")];
      const registry = await startRegistry({
        [already[0].name]: { kind: "present" },
        [already[1].name]: { kind: "present" },
      });

      const step = await runStep(PUBLISH_STEP, already, registry.url);

      expect(step.status, step.output).toBe(0);
      for (const { name, version } of already) {
        expect(step.gh).toContain(`gh release create ${name}@${version}`);
      }
    },
  );

  it("the accounting step reads no per-run published list", () => {
    // The negative half, which no run can demonstrate: the step's own text must not consult
    // `steps.changesets.outputs.*`. That output is what the first draft of this file keyed off, and
    // the comment above the step records the hole it left.
    const script = stepScript(PUBLISH_STEP);
    expect(script).not.toMatch(/steps\.changesets/);
    expect(script).not.toMatch(/publishedPackages/);
  });
});

// ---------------------------------------------------------------------------
// AC-6
// ---------------------------------------------------------------------------

describe("AC-6: the budget is one finite value, derived from the recorded measurement", () => {
  it("is at least the largest delay upper bound in documentation/registry-propagation-evidence.md", () => {
    // The subject is the BUDGET, not the document: the evidence supplies the number the budget has
    // to clear, and a budget that no measurement supports is what this criterion refuses.
    const rows = EVIDENCE.split("\n")
      .filter((line) => line.trim().startsWith("|") && line.includes("`0.1.0`"))
      .map((line) =>
        line
          .split("|")
          .map((cell) => cell.trim())
          .filter((cell) => cell !== ""),
      );
    expect(rows.length).toBeGreaterThanOrEqual(8);

    const upperBounds = rows.map((cells) => Number(cells[4]));
    expect(upperBounds.every((value) => Number.isFinite(value))).toBe(true);
    const measured = Math.max(...upperBounds);

    // The document's own summary must agree with its own rows, or the budget is being compared
    // against a figure the measurement does not carry.
    const stated = /Maximum upper bound: `([0-9.]+)` seconds/.exec(EVIDENCE);
    expect(stated, "the evidence document states no maximum upper bound").not.toBeNull();
    expect(Number(stated?.[1])).toBe(measured);

    expect(Number.isFinite(PRESENCE_BUDGET_SECONDS)).toBe(true);
    expect(PRESENCE_BUDGET_SECONDS).toBeGreaterThanOrEqual(measured);
  });

  it(
    "a caller can drive the accounting with a budget smaller than the shipped one",
    { timeout: 120_000 },
    async () => {
      // Without this, AC-1 and AC-9 could only be graded by spending the shipped budget in wall
      // time inside a required check.
      const gone = pkg("ac6-smaller-budget");
      const registry = await startRegistry({ [gone.name]: { kind: "absent" } });

      const started = Date.now();
      const result = await run([gone], registry.url, { budgetSeconds: 1, intervalSeconds: 0.5 });
      const elapsed = (Date.now() - started) / 1000;

      expect(result.rows[0].state).toBe(ABSENT);
      expect(elapsed).toBeLessThan(PRESENCE_BUDGET_SECONDS);
    },
  );

  it("the shipped workflow invokes the accounting with the shipped budget on both arms", () => {
    for (const step of [PUBLISH_STEP, VERSION_STEP]) {
      const script = stepScript(step);
      expect(script, `${step} does not call the accounting`).toMatch(
        /node scripts\/registry-presence\.mjs/,
      );
      expect(script, `${step} overrides the shipped budget`).not.toMatch(/--budget-seconds/);
      expect(script).not.toMatch(/--probe-interval-seconds/);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-8
// ---------------------------------------------------------------------------

describe("AC-8: both arms apply the same budget and the same propagated-versus-absent distinction", () => {
  it("the gated publish arm and the ungated version arm call the same accounting", () => {
    const publish = stepScript(PUBLISH_STEP);
    const version = stepScript(VERSION_STEP);
    for (const script of [publish, version]) {
      expect(script).toMatch(
        /node scripts\/registry-presence\.mjs account --arm (publish|version)/,
      );
    }
    // Neither arm may keep a probe loop of its own: two copies are how they drift.
    for (const script of [publish, version]) {
      expect(script).not.toMatch(/npm view/);
      expect(script).not.toMatch(/sleep 5/);
    }
  });

  it(
    "the ungated version arm tolerates the same race the gated publish arm does",
    { timeout: 180_000 },
    async () => {
      const racer = pkg("ac8-version-arm-race");
      const registry = await startRegistry({ [racer.name]: { kind: "appears-after", probes: 1 } });

      const step = await runStep(VERSION_STEP, [racer], registry.url);

      expect(step.status, step.output).toBe(0);
      expect(step.output).toContain("nothing is being withheld");
      // It reads the registry and reports; it must not have tried to tag or release anything.
      expect(step.gh.trim()).toBe("");
    },
  );

  it(
    "and reds on the same absent package the publish arm would red on, with its own terminal action",
    { timeout: 120_000 },
    async () => {
      const gone = pkg("ac8-absent");
      const registry = await startRegistry({ [gone.name]: { kind: "absent" } });

      const publish = await run([gone], registry.url, { arm: "publish", budgetSeconds: 2 });
      const version = await run([gone], registry.url, { arm: "version", budgetSeconds: 2 });

      expect(publish.rows[0].state).toBe(version.rows[0].state);
      expect(publish.code).toBe(version.code);
      expect(publish.code).not.toBe(0);
      // RELEASING.md failure state (c) distinguishes the two by annotation title, because their
      // terminal actions differ. The verdict does not differ, and that is what AC-8 is about.
      expect(publish.log).toContain("::error title=Bumped but never published::");
      expect(version.log).toContain("::error title=Bumped but never published (version arm)::");
    },
  );
});

// ---------------------------------------------------------------------------
// AC-9
// ---------------------------------------------------------------------------

describe("AC-9: the check terminates even when the registry never answers at all", () => {
  it(
    "gives up within the budget plus one probe, and says the registry could not be read",
    { timeout: 120_000 },
    async () => {
      const silent = pkg("ac9-never-answers");
      const registry = await startRegistry({ [silent.name]: { kind: "hang" } });

      const budgetSeconds = 2;
      const probeTimeoutSeconds = 2;
      const lines: string[] = [];
      const started = Date.now();
      const result = await account({
        packages: [silent],
        arm: "publish",
        budgetSeconds,
        intervalSeconds: 0.5,
        probeTimeoutSeconds,
        env: registryEnv(registry.url),
        log: (line: string) => lines.push(line),
      });
      const elapsed = (Date.now() - started) / 1000;

      expect(result.rows[0].state).toBe(UNREADABLE);
      expect(result.code).not.toBe(0);
      expect(lines.join("\n")).toContain("::error title=Registry could not be read::");
      // The bound AC-9 states, plus the process start-up a real probe pays for.
      expect(elapsed).toBeLessThan(budgetSeconds + probeTimeoutSeconds + 5);
    },
  );
});

// ---------------------------------------------------------------------------
// AC-10
// ---------------------------------------------------------------------------

describe("AC-10: the run says, in those words, that the release is done", () => {
  it(
    "ends the shipped publish step with `All N bumped package(s) are published, tagged and released`",
    { timeout: 180_000 },
    async () => {
      // RELEASING.md names this sentence as the only thing that means a release is done, and a
      // publish run is graded against it, so the wording is pinned rather than paraphrased.
      const three = [pkg("ac10-one"), pkg("ac10-two"), pkg("ac10-three")];
      const registry = await startRegistry(
        Object.fromEntries(three.map(({ name }) => [name, { kind: "present" } as Behaviour])),
      );

      const step = await runStep(PUBLISH_STEP, three, registry.url);

      expect(step.status, step.output).toBe(0);
      expect(step.output).toContain("All 3 bumped package(s) are published, tagged and released.");
    },
  );
});

// ---------------------------------------------------------------------------
// AC-3 and AC-4 both end in "the job SHALL exit non-zero", and the job learns that from an exit
// code. These are the unhappy paths of that contract: what the accounting does when it cannot
// check at all, which is neither "published" nor "never published".
// ---------------------------------------------------------------------------

describe("AC-3 and AC-4 rest on an exit code, so the accounting refuses what it cannot check", () => {
  it("AC-3: an empty package list is a release that named nothing, and is refused", () => {
    // The guard the shell used to carry. Passing on it would report a clean release having checked
    // nothing, which is the one outcome worse than a red run.
    expect(() => parseBumpedPackages("[]")).toThrow(/named no packages/);
    expect(() => parseBumpedPackages(undefined)).toThrow(/named no packages/);
    expect(() => parseBumpedPackages("{}")).toThrow(/named no packages/);
  });

  it("AC-3: an entry with no version is refused rather than probed as `name@undefined`", () => {
    expect(() => parseBumpedPackages('[{"name":"@cosyte/x"}]')).toThrow(/version/);
  });

  it("AC-4: `could not check` exits 2, distinctly from the 1 that means something is missing", () => {
    // Exit 2 is what the release step branches on to stop before it tags anything: there is no work
    // list, so there is nothing to tag and no count to balance.
    const run = spawnSync(
      process.execPath,
      [join(REPO_ROOT, "scripts", "registry-presence.mjs"), "--nonsense"],
      { encoding: "utf8", timeout: 60_000, env: hermeticEnv() },
    );
    expect(run.status).toBe(2);
    expect(`${run.stdout}${run.stderr}`).toMatch(/could not run/);
  });
});
