import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * THE PUBLISHED ENTRY POINTS OF `@cosyte/script-utils`, GRADED FROM THE TARBALL.
 *
 * WHY THE TARBALL AND NOT THE WORKSPACE. What a consumer receives is decided by `files` and
 * `exports` together, and the two can disagree with the repository: a subpath declared in `exports`
 * whose file `files` does not ship resolves inside this workspace and fails on `npm install`. That
 * failure is invisible to every test that imports through the workspace link, so this suite packs
 * the package the way a release does, unpacks it into a consumer's `node_modules`, and imports it
 * by the bare specifier a consumer writes.
 *
 * THE SEPARATION IS PROVED BY MUTATION, NOT BY READING THE IMPORTS. The claim is that importing the
 * internal-reference gate does not load the PHI scanner. So the unpacked copy's `phi-scan.js` is
 * replaced by a module that records having been loaded, and the two subpaths are imported in
 * separate processes: one must leave no mark, and the other must leave one. Without that second
 * half the first proves only that the marker never worked.
 */

const REPO_ROOT = join(import.meta.dirname, "..");
const PACKAGE_DIR = join(REPO_ROOT, "packages", "script-utils");

let scratch: string;
let consumer: string;
let installed: string;
let marker: string;

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), "script-utils-tarball-"));
  const packDir = join(scratch, "pack");
  mkdirSync(packDir, { recursive: true });

  // THE BUILD STEP FIRST, in the order the release runs it: `pnpm run release` is
  // `publish-preflight && pnpm run build && changeset publish`, and this package's `build` is what
  // writes the em-dash gate into the package directory. It is invoked EXPLICITLY rather than left to
  // the `prepublishOnly` hook, because a lifecycle hook does not fire under `ignore-scripts`, which
  // is the default in some hardened environments; an explicit run never depends on that setting, and
  // a tarball graded under one setting and published under another is not evidence.
  execFileSync("pnpm", ["run", "build"], {
    cwd: PACKAGE_DIR,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  // `pnpm pack` is what a release runs, so the tarball this grades is the one a consumer gets.
  const output = execFileSync("pnpm", ["pack", "--pack-destination", packDir], {
    cwd: PACKAGE_DIR,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const tarball = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.endsWith(".tgz"))
    .pop();
  if (tarball === undefined) throw new Error(`pnpm pack named no tarball:\n${output}`);

  consumer = join(scratch, "consumer");
  installed = join(consumer, "node_modules", "@cosyte", "script-utils");
  mkdirSync(installed, { recursive: true });
  execFileSync("tar", ["-xzf", tarball, "-C", installed, "--strip-components=1"], {
    stdio: "pipe",
  });
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({ name: "consumer", version: "0.0.0", type: "module", private: true }),
  );

  // The tripwire. `phi-scan.js` in the INSTALLED copy writes a file when it is loaded, so "was the
  // scanner loaded" becomes a fact on disk rather than an assumption about the import graph.
  marker = join(scratch, "phi-scan-was-loaded");
  writeFileSync(
    join(installed, "phi-scan.js"),
    [
      'import { writeFileSync } from "node:fs";',
      `writeFileSync(${JSON.stringify(marker)}, "loaded");`,
      "export function runPhiScan() {",
      "  return 0;",
      "}",
      "export function exemptsMarkdown() {",
      "  return false;",
      "}",
      "",
    ].join("\n"),
  );
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** Run one line of module code inside the consumer directory, and report what it printed. */
function inConsumer(source: string): { code: number; out: string } {
  const file = join(consumer, `probe-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(file, source);
  try {
    const out = execFileSync(process.execPath, [file], {
      cwd: consumer,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? -1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  } finally {
    rmSync(file, { force: true });
  }
}

describe("the tarball a consumer installs", () => {
  it("ships the internal-reference gate and its declarations", () => {
    for (const file of ["internal-refs.js", "internal-refs.d.ts"]) {
      expect(existsSync(join(installed, file)), `${file} is not in the tarball`).toBe(true);
    }
  });

  it("ships the attw publish gate and its declarations", () => {
    // A subpath declared in `exports` whose file `files` does not ship resolves inside this
    // workspace and fails on `npm install`, which is invisible to every test that imports through
    // the workspace link. The gate every other repo will now run is exactly that shape of risk.
    for (const file of ["attw.js", "attw.d.ts"]) {
      expect(existsSync(join(installed, file)), `${file} is not in the tarball`).toBe(true);
    }
  });

  it("[AC-1] ships the em-dash gate as the EXACT BYTES of this repository's implementation", () => {
    // The consolidation's whole claim is that eleven other repositories execute THESE bytes rather
    // than a fork of them, and the only place that claim is observable from config alone is the
    // tarball: `files` decides what a consumer receives, npm omits a `files` entry that does not
    // exist WITHOUT SAYING SO, and the packed copy is gitignored build output that no other test
    // looks at. A missing or drifted copy would surface first in a consuming repository.
    const shipped = join(installed, "check-no-emdash.sh");
    expect(existsSync(shipped), "check-no-emdash.sh is not in the tarball").toBe(true);

    const canonical = readFileSync(join(REPO_ROOT, "scripts", "check-no-emdash.sh"));
    expect(readFileSync(shipped).equals(canonical)).toBe(true);

    // And the gate says so itself, which is the check a consuming repository can run without having
    // this repository on disk: `--self-id` over the shipped copy is the digest of the canonical.
    const selfId = execFileSync("bash", [shipped, "--self-id"], {
      cwd: consumer,
      encoding: "utf8",
    }).trim();
    expect(selfId).toBe(createHash("sha256").update(canonical).digest("hex"));

    // THE INVOCATION A CONSUMER ACTUALLY WRITES. Every consuming repo keeps a `check:no-emdash`
    // package script and reaches the gate through `pnpm run check:no-emdash -- <flag>`; pnpm 10
    // forwards that `--` verbatim, so the shipped gate has to see through it. Measured here rather
    // than reasoned about, because when it was NOT seen through the run fell back to the default
    // file scan and printed OK over text it never read.
    const throughSeparator = execFileSync("bash", [shipped, "--", "--self-id"], {
      cwd: consumer,
      encoding: "utf8",
    }).trim();
    expect(throughSeparator).toBe(selfId);
  });

  it("declares the new subpath alongside the ones that were already there", () => {
    const manifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
    expect(manifest.exports).toEqual({
      ".": { types: "./index.d.ts", default: "./index.js" },
      "./phi-scan": { types: "./phi-scan.d.ts", default: "./phi-scan.js" },
      "./internal-refs": { types: "./internal-refs.d.ts", default: "./internal-refs.js" },
      "./attw": { types: "./attw.d.ts", default: "./attw.js" },
    });
  });

  it("resolves the attw gate by the specifier a consuming repo's wrapper writes", () => {
    // `scripts/attw.mjs` in every consuming repo is this import and one statement. If the subpath
    // did not resolve from an installed tarball, every one of those repos would red at run time
    // and nothing in this workspace would have noticed.
    const probe = inConsumer(
      [
        'import { runAttwGate } from "@cosyte/script-utils/attw";',
        "console.log(typeof runAttwGate);",
        "",
      ].join("\n"),
    );
    expect(probe.code, probe.out).toBe(0);
    expect(probe.out.trim()).toBe("function");
  });

  it("resolves the new subpath by the specifier a consumer writes", () => {
    const probe = inConsumer(
      [
        'import { runInternalRefsScan, CONFIG_AXES, canonicalRuleNames } from "@cosyte/script-utils/internal-refs";',
        "console.log(typeof runInternalRefsScan, CONFIG_AXES.length, canonicalRuleNames().length);",
        "",
      ].join("\n"),
    );
    expect(probe.code, probe.out).toBe(0);
    expect(probe.out.trim()).toBe("function 10 6");
  });

  it("resolves it by relative path too, which is the pre-install route", () => {
    // A gate that runs before `pnpm install` has no `node_modules` for a bare specifier to resolve
    // through. The package is published as source with no build step precisely so that the file
    // itself is importable, and this asserts the property rather than the intention.
    const probe = inConsumer(
      [
        `import { canonicalRuleNames } from ${JSON.stringify(join(installed, "internal-refs.js"))};`,
        "console.log(canonicalRuleNames().length);",
        "",
      ].join("\n"),
    );
    expect(probe.code, probe.out).toBe(0);
    expect(probe.out.trim()).toBe("6");
  });
});

describe("importing the internal-reference gate does not load the PHI scanner", () => {
  it("leaves the tripwire untouched", () => {
    rmSync(marker, { force: true });
    const probe = inConsumer(
      [
        'import "@cosyte/script-utils/internal-refs";',
        'import { existsSync } from "node:fs";',
        `console.log(existsSync(${JSON.stringify(marker)}) ? "LOADED" : "NOT-LOADED");`,
        "",
      ].join("\n"),
    );
    expect(probe.code, probe.out).toBe(0);
    expect(probe.out.trim()).toBe("NOT-LOADED");
  });

  it("and the tripwire fires when the scanner IS imported, so the case above means something", () => {
    // The positive control. Without it, a marker that never worked and a subpath that never loads
    // the scanner produce exactly the same green.
    rmSync(marker, { force: true });
    const probe = inConsumer(
      [
        'import "@cosyte/script-utils/phi-scan";',
        'import { existsSync } from "node:fs";',
        `console.log(existsSync(${JSON.stringify(marker)}) ? "LOADED" : "NOT-LOADED");`,
        "",
      ].join("\n"),
    );
    expect(probe.code, probe.out).toBe(0);
    expect(probe.out.trim()).toBe("LOADED");
  });

  it("leaves the root entry point loading neither of the other two", () => {
    rmSync(marker, { force: true });
    const probe = inConsumer(
      [
        'import { isCliEntrypoint } from "@cosyte/script-utils";',
        'import { existsSync } from "node:fs";',
        `console.log(typeof isCliEntrypoint, existsSync(${JSON.stringify(marker)}) ? "LOADED" : "NOT-LOADED");`,
        "",
      ].join("\n"),
    );
    expect(probe.code, probe.out).toBe(0);
    expect(probe.out.trim()).toBe("function NOT-LOADED");
  });
});

describe("the two entry points that were already there are unchanged", () => {
  it("keeps the root entry point's surface and its tie-breaking direction", () => {
    const probe = inConsumer(
      [
        'import { isCliEntrypoint } from "@cosyte/script-utils";',
        "const names = Object.keys(await import(\"@cosyte/script-utils\")).sort().join(',');",
        "console.log(names, isCliEntrypoint(import.meta.url));",
        "",
      ].join("\n"),
    );
    expect(probe.code, probe.out).toBe(0);
    // The one export, and `true` because the probe module IS the file node was pointed at.
    expect(probe.out.trim()).toBe("isCliEntrypoint true");
  });

  it("keeps the PHI subpath's surface", () => {
    // Read from the SOURCE copy, because the installed one is the tripwire stub by now.
    const source = readFileSync(join(PACKAGE_DIR, "phi-scan.js"), "utf8");
    expect(source).toMatch(/export function runPhiScan\(/);
    expect(source).toMatch(/export function exemptsMarkdown\(/);
    // And nothing added here imports it, so the two gates share no module.
    const gate = readFileSync(join(PACKAGE_DIR, "internal-refs.js"), "utf8");
    expect(gate).not.toContain("phi-scan");
  });
});
