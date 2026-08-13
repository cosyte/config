import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  cleanupTempDirs,
  ensureBuilt,
  makeTempDir,
  PKG_ROOT,
  runCli,
  useFixture,
} from "./helpers.js";
import { OVERRIDE_FILE } from "../src/overrides.js";
import { DELEGATED_VERBS, VERBS } from "../src/verbs.js";

/**
 * The real bin, the real tools, in a fixture consumer.
 *
 * `test/cli.test.ts` proves the exact argv with the spawn injected; this file proves the other half:
 * that those invocations are the ones the tools actually accept, in the working directory the verb
 * was invoked from, with the exit code coming back verbatim.
 *
 * `test --watch` has no case here on purpose: watch mode does not exit, so the only assertable thing
 * about it is the invocation, which cli.test.ts asserts exactly.
 */

beforeAll(ensureBuilt);
afterAll(cleanupTempDirs);

/** Any version line at all; term 10 says `check` prints none and stdout never carries one. */
const ANY_VERSION_LINE = /^cosyte-process \d+\.\d+\.\d+$/m;

/**
 * The version this package's own manifest declares, read here rather than imported from the source
 * under test, so the assertion cannot agree with a wrong answer.
 */
const OWN_VERSION = (
  JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8")) as { version: string }
).version;

/** Exactly the line term 10 requires of the successor version, newline terminated. */
const VERSION_LINE = `cosyte-process ${OWN_VERSION}\n`;

describe("the five delegated verbs in a wired consumer with no override file", () => {
  it.each(DELEGATED_VERBS)("%s exits 0", (verb) => {
    const dir = useFixture("wired");
    const result = runCli([verb], dir);
    expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0);
  });

  it("build writes its output into the invoking directory", () => {
    const dir = useFixture("wired");
    expect(runCli(["build"], dir).code).toBe(0);
    expect(existsSync(join(dir, "dist", "index.js"))).toBe(true);
  });

  it("format rewrites the invoking directory's files", () => {
    const dir = useFixture("unformatted");
    expect(runCli(["format"], dir).code).toBe(0);
    expect(readFileSync(join(dir, "src", "messy.ts"), "utf8")).toBe("export const messy = 1;\n");
  });

  it("prints the version line before the tool's output (term 10, successor version)", () => {
    const dir = useFixture("wired");
    for (const verb of DELEGATED_VERBS) {
      const result = runCli([verb], dir);
      // First bytes on stderr, so it precedes whatever the tool itself writes there.
      expect(result.stderr.startsWith(VERSION_LINE), `${verb}: ${result.stderr}`).toBe(true);
      // Exactly one, and never on stdout, where it would corrupt a tool's own output.
      expect(result.stderr.split(VERSION_LINE)).toHaveLength(2);
      expect(result.stdout).not.toMatch(ANY_VERSION_LINE);
    }
  });

  it("check prints no version line at all (term 10: the delegated verbs only)", () => {
    const result = runCli(["check"], useFixture("wired"));
    expect(result.code).toBe(0);
    expect(result.stderr).not.toMatch(ANY_VERSION_LINE);
    expect(result.stdout).not.toMatch(ANY_VERSION_LINE);
  });
});

describe("modifiers, executed for real", () => {
  it("`format --check` reports the unformatted file and does not write it", () => {
    const dir = useFixture("unformatted");
    const before = readFileSync(join(dir, "src", "messy.ts"), "utf8");
    const result = runCli(["format", "--check"], dir);
    expect(result.code).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain("messy.ts");
    expect(readFileSync(join(dir, "src", "messy.ts"), "utf8")).toBe(before);
  });

  it("`test --coverage` runs vitest with the provider resolved from this package", () => {
    const dir = useFixture("wired");
    const result = runCli(["test", "--coverage"], dir);
    expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain("Coverage");
  });

  it("`lint --fix` fixes the OVERRIDDEN globs and leaves the baseline ones alone", () => {
    const dir = useFixture("overridden");
    const result = runCli(["lint", "--fix"], dir);
    expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0);
    // lib/ is what the override names, and the missing semicolon there is fixed.
    expect(readFileSync(join(dir, "lib", "fixable.ts"), "utf8")).toBe(
      "export const fixable = 1;\n",
    );
    // src/ is a BASELINE glob the override replaced, so it was never linted.
    expect(readFileSync(join(dir, "src", "bad.ts"), "utf8")).toBe(
      "const unusedAndUnterminated = 1\n",
    );
  });
});

describe("term 7: an override changes what runs, with no edit to any script body", () => {
  it("lints the overridden globs only", () => {
    const dir = useFixture("overridden");
    const result = runCli(["lint"], dir);
    const output = `${result.stdout}${result.stderr}`;
    expect(result.code).not.toBe(0);
    expect(output).toContain("fixable.ts");
    expect(output).not.toContain("bad.ts");
  });

  it("leaves the consumer's script bodies conforming while it does so", () => {
    const dir = useFixture("overridden");
    runCli(["lint"], dir);
    expect(runCli(["check"], dir).code).toBe(0);
  });
});

describe("check, end to end", () => {
  it("exits 0 on a conforming consumer", () => {
    expect(runCli(["check"], useFixture("wired")).code).toBe(0);
  });

  it("exits 0 with none of the four reserved variant scripts present", () => {
    expect(runCli(["check"], useFixture("minimal")).code).toBe(0);
  });

  it("exits non-zero naming each drifted script", () => {
    const result = runCli(["check"], useFixture("drifted"));
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('script "test"');
    expect(result.stderr).toContain('script "lint"');
    expect(result.stderr).toContain('script "test:coverage"');
  });
});

describe("a tool that fails", () => {
  it("propagates eslint's exit 2 for a broken config, with its own message", () => {
    const dir = useFixture("broken-eslint");
    const result = runCli(["lint"], dir);
    expect(result.code).toBe(2);
    expect(`${result.stdout}${result.stderr}`).toContain("deliberately broken");
  });

  it("propagates vitest's exit 1 for a failing test, with its own output", () => {
    const dir = useFixture("failing-test");
    const result = runCli(["test"], dir);
    expect(result.code).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain("fails on purpose");
  });

  it("adds nothing of its own to a tool's failure beyond the term-10 version line", () => {
    const result = runCli(["test"], useFixture("failing-test"));
    // The version line is ours and is expected on every delegated verb, failing or not; a
    // `cosyte-process:` diagnostic is not, and a tool's failure is still reported by the tool.
    expect(result.stderr.startsWith(VERSION_LINE)).toBe(true);
    expect(result.stderr).not.toContain("cosyte-process:");
  });

  it("puts the version line ahead of the tool's own stderr output", () => {
    const result = runCli(["lint"], useFixture("broken-eslint"));
    expect(result.code).toBe(2);
    expect(result.stderr.startsWith(VERSION_LINE)).toBe(true);
    // eslint's own message is on stderr too, and it comes after ours.
    expect(result.stderr.indexOf("deliberately broken")).toBeGreaterThan(VERSION_LINE.length - 1);
  });
});

describe("a path the verb must write is not writable", () => {
  it("exits non-zero naming the path", () => {
    const dir = useFixture("unformatted");
    const target = join(dir, "src", "messy.ts");
    chmodSync(target, 0o444);
    try {
      const result = runCli(["format"], dir);
      const output = `${result.stdout}${result.stderr}`;
      expect(result.code).not.toBe(0);
      expect(output).toContain("messy.ts");
      expect(output).toContain("EACCES");
    } finally {
      chmodSync(target, 0o644);
    }
  });
});

describe("argument and state errors, from the real bin", () => {
  it("refuses an unknown verb and prints the verbs and modifiers", () => {
    const result = runCli(["buidl"], useFixture("wired"));
    expect(result.code).not.toBe(0);
    for (const verb of VERBS) {
      expect(result.stderr).toContain(verb);
    }
    expect(result.stderr).toContain("cosyte-process test --watch");
  });

  it("refuses two modifiers", () => {
    const result = runCli(["test", "--watch", "--coverage"], useFixture("wired"));
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("at most one modifier");
  });

  it("refuses a directory with no package.json, naming the file", () => {
    const empty = makeTempDir("cosyte-process-empty-e2e-");
    const result = runCli(["build"], empty);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain(join(empty, "package.json"));
  });

  it("refuses an invalid override file on a verb that the override does not name", () => {
    const dir = useFixture("wired");
    writeFileSync(join(dir, OVERRIDE_FILE), '{"lint":{"globs":"lib/**/*.ts"}}\n');
    const result = runCli(["build"], dir);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain(OVERRIDE_FILE);
    expect(result.stderr).toContain("must be an array of strings");
  });
});
