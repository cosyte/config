import { execFileSync } from "node:child_process";
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

  it("declares the new subpath alongside the two that were already there", () => {
    const manifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
    expect(manifest.exports).toEqual({
      ".": { types: "./index.d.ts", default: "./index.js" },
      "./phi-scan": { types: "./phi-scan.d.ts", default: "./phi-scan.js" },
      "./internal-refs": { types: "./internal-refs.d.ts", default: "./internal-refs.js" },
    });
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
