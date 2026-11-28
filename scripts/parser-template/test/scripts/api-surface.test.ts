/**
 * The export-surface records under `release/` agree with a fresh build of the declarations, one
 * record per entry point, and the check names a drift without rewriting anything.
 *
 * The declarations are built by the real `tsup` with this repository's config into a throwaway
 * directory, so the test never reads a `dist/` left over from another run and never clobbers one.
 *
 * SECURITY: every subprocess call uses spawnSync with array args. No exec, no shell form.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const TSX_BIN = join(REPO_ROOT, "node_modules", ".bin", "tsx");
const SCRIPT = join(REPO_ROOT, "scripts", "api-surface.ts");
/** A build plus a script run are well over the suite's default timeout. */
const TIMEOUT = 180_000;

/** Each entry point, with the declarations it builds and the record that holds them. */
const ENTRIES = [
  { entry: "index", record: join(REPO_ROOT, "release", "public-api.json") },
  { entry: "arbitraries", record: join(REPO_ROOT, "release", "public-api-arbitraries.json") },
] as const;

/**
 * The `tsup` that `pnpm build` runs, from `@cosyte/process`, which owns the build tool, read from
 * tsup's own `bin` field rather than a shell shim.
 */
function tsupBin(): string {
  const fromProcess = createRequire(
    createRequire(import.meta.url).resolve("@cosyte/process/package.json"),
  );
  const manifestPath = fromProcess.resolve("tsup/package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { bin?: { tsup?: string } };
  const entry = manifest.bin?.tsup;
  if (entry === undefined) throw new Error(`${manifestPath} declares no tsup bin`);
  return join(dirname(manifestPath), entry);
}

let out: string;

beforeAll(() => {
  out = mkdtempSync(join(tmpdir(), "api-surface-"));
  const build = spawnSync(process.execPath, [tsupBin(), "--out-dir", out], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: TIMEOUT,
  });
  expect(build.status, `${build.stdout ?? ""}${build.stderr ?? ""}`).toBe(0);
}, TIMEOUT);

afterAll(() => {
  rmSync(out, { recursive: true, force: true });
});

/** Run the check for one entry point against the fresh build, with a record of its own choice. */
function check(entry: string, record: string): { status: number | null; output: string } {
  const r = spawnSync(
    TSX_BIN,
    [SCRIPT, "--entry", entry, "--declarations", join(out, `${entry}.d.ts`), "--inventory", record],
    { cwd: REPO_ROOT, encoding: "utf8", timeout: TIMEOUT },
  );
  return { status: r.status, output: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

describe("the export-surface records", () => {
  for (const { entry, record } of ENTRIES) {
    it(`match a fresh build of the ${entry} entry point`, { timeout: TIMEOUT }, () => {
      const r = check(entry, record);
      expect(r.status, r.output).toBe(0);
    });
  }

  it("NEGATIVE CONTROL: name a drift and rewrite nothing", { timeout: TIMEOUT }, () => {
    const { entry, record } = ENTRIES[0];
    const parsed = JSON.parse(readFileSync(record, "utf8")) as {
      exports: { name: string }[];
      exportCount: number;
    };
    const [dropped, ...kept] = parsed.exports;
    const copy = join(out, "drifted.json");
    const drifted = `${JSON.stringify({ ...parsed, exports: kept, exportCount: kept.length }, null, 2)}\n`;
    writeFileSync(copy, drifted);
    const r = check(entry, copy);
    expect(r.status, r.output).toBe(1);
    expect(r.output).toContain(`added:   ${dropped?.name ?? ""}`);
    expect(readFileSync(copy, "utf8")).toBe(drifted);
  });
});
