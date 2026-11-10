import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { onTestFinished } from "vitest";

/** Absolute paths the tests share. */
export const here = (rel: string): string => fileURLToPath(new URL(`../${rel}`, import.meta.url));

export const entry = (name: string): string => here(`fixtures/entries/${name}.mjs`);

export const FIXTURES = {
  suite: here("fixtures/suite.mjs"),
  target: here("fixtures/target.mjs"),
  notASuite: here("fixtures/not-a-suite.mjs"),
  throwsOnImport: here("fixtures/throws-on-import.mjs"),
};

/** Run a source entry in a child: Node strips the types, the loader maps `.js` to `.ts`. */
export const TS = {
  loader: ["--import", here("support/ts-loader.mjs")],
  child: fileURLToPath(new URL("../../src/child-entry.ts", import.meta.url)),
  importer: fileURLToPath(new URL("../../src/import-entry.ts", import.meta.url)),
};

/** A fresh temporary directory, removed when the test that made it finishes. */
export function scratchDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}
