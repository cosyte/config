import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * AC-C2: every numbered condition of the version-sync behaviour contract is exercised by at least
 * one test that NAMES its number, and the run fails if any of the five goes unnamed.
 *
 * Whether a given test "exercises condition 3" is a reading, so the mapping is made mechanical: a
 * test that exercises a condition says so in its title, and this file grades the titles. That makes
 * the contract a list a later adopting repo can hold its own variant against, rather than a claim
 * somebody has to re-derive by reading the suite.
 *
 * IT FAILS CLOSED. A scan that finds no titles at all, or that no longer finds the file holding
 * them, is a failure rather than a vacuous pass: a grader that can only report "nothing missing"
 * because it read nothing is the defect this exists to prevent.
 */

/** The five numbered conditions of the version-sync behaviour contract. */
const CONDITIONS = [1, 2, 3, 4, 5] as const;

/** The file expected to carry the per-condition tests. */
const SUBJECT = "sync-version.test.ts";

/** A test title, as written in the source: one `it(...)` or `test(...)` call per line. */
const TITLE_LINE = /^\s*(?:it|test)(?:\.each\(.*?\))?\(\s*"((?:[^"\\]|\\.)*)"/;

/** A title naming a condition number. */
const NAMES_CONDITION = /version-sync condition ([1-5])\b/g;

const TEST_DIR = import.meta.dirname;
const SELF = basename(import.meta.filename);

/** Every test file this grader reads: the suite, minus this file. */
function testFiles(): string[] {
  return readdirSync(TEST_DIR)
    .filter((entry) => entry.endsWith(".test.ts") && entry !== SELF)
    .sort();
}

/** The `it(...)` titles written in a test file. */
function titlesIn(file: string): string[] {
  const titles: string[] = [];
  for (const line of readFileSync(join(TEST_DIR, file), "utf8").split("\n")) {
    const match = TITLE_LINE.exec(line);
    if (match?.[1] !== undefined) {
      titles.push(match[1]);
    }
  }
  return titles;
}

/** Condition number to the titles naming it, across the whole suite. */
function conditionCoverage(): Map<number, string[]> {
  const coverage = new Map<number, string[]>();
  for (const file of testFiles()) {
    for (const title of titlesIn(file)) {
      for (const match of title.matchAll(NAMES_CONDITION)) {
        const condition = Number(match[1]);
        coverage.set(condition, [...(coverage.get(condition) ?? []), `${file}: ${title}`]);
      }
    }
  }
  return coverage;
}

describe("AC-C2: the five numbered conditions are each exercised by a test that names them", () => {
  it("reads the file holding the per-condition tests", () => {
    expect(testFiles()).toContain(SUBJECT);
  });

  it("extracts test titles rather than silently finding none", () => {
    // The extraction is a regular expression over source, so it can rot. If it ever stops matching,
    // this fails instead of letting the coverage assertion below pass over an empty set.
    expect(titlesIn(SUBJECT).length).toBeGreaterThanOrEqual(CONDITIONS.length);
  });

  it("finds a test naming every one of the five conditions", () => {
    const coverage = conditionCoverage();
    const unnamed = CONDITIONS.filter((condition) => !coverage.has(condition));
    expect(
      unnamed,
      `no test names version-sync condition ${unnamed.join(", ")}: every numbered condition of the ` +
        "behaviour contract needs at least one test whose title names its number",
    ).toEqual([]);
  });
});
