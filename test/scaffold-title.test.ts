/**
 * Guards the one input `scripts/scaffold-parser.mjs` takes that it does not control the shape of:
 * `--title`.
 *
 * THE DEFECT. The title is substituted VERBATIM into every template file carrying `{{TITLE}}`, and
 * those files are not all the same syntax: a JSON string in `package.json`, a JSDoc block in
 * `src/index.ts`, line comments in `scripts/phi-scan.ts`, Markdown prose in the docs. Nothing
 * checked it. Measured on the generator as it stood, every one of these exited 0 and printed
 * `Scaffolded @cosyte/probe`:
 *
 *   `Bad "Q" Title`                     -> the emitted package.json is not valid JSON
 *   `X", "name": "@evil/pwned", "x": "` -> the emitted package.json IS valid JSON and names a
 *                                          DIFFERENT PACKAGE
 *   a block-comment terminator          -> the JSDoc block in the emitted src/index.ts closes early
 *   a newline, a tab, U+2028, U+2029    -> a raw control character in a JSON string, or an emitted
 *                                          line comment that stops being a comment
 *   `Title {{NAME}} here`               -> an unsubstituted placeholder ships in the README and in
 *                                          the published package description
 *
 * THE SILENT ONE IS THE POINT. An unparseable manifest breaks every downstream gate at once, which
 * is loud in its own way; a manifest that PARSES and names someone else's package is the failure
 * the scaffold's whole promise is against, because the generator reports success and every gate
 * downstream then runs, green, against the wrong identity.
 *
 * WHAT IS ASSERTED. Two independent guards, and the counterfactual block below measures that they
 * are independent rather than asserting it: `validateTitle()` refuses the input before any file is
 * written, and `assertEmittedManifest()` refuses an emitted manifest that does not describe the
 * package that was asked for. Strip either one and the other still catches the injection; strip
 * BOTH and the silent exit-0 wrong-package scaffold comes straight back.
 *
 * SECURITY: every subprocess call uses spawnSync with array args. No exec, no shell form.
 */

import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const SCAFFOLDER = join(REPO_ROOT, "scripts", "scaffold-parser.mjs");
const TEMPLATE = join(REPO_ROOT, "scripts", "parser-template");

/** The generator shells out to prettier twice on a successful run; the default 5s is not it. */
const SPAWN_TIMEOUT = 120_000;

const NAME = "probe";
const PKG = `@cosyte/${NAME}`;
const CONFORMANT_TITLE = "Probe Standard R2.1";

/** The title that produces a manifest which PARSES and names a different package. */
const INJECTION = `X", "name": "@evil/pwned", "x": "`;

/**
 * THE HOSTILE CORPUS, ONE ENTRY PER RULE THE GENERATOR STATES, so a rule that is deleted or
 * narrowed reds here rather than going quietly untested. The characters are written as escapes:
 * a raw U+2028 in this file would be invisible to a reviewer, which is the property that makes it
 * dangerous in the first place.
 */
const HOSTILE: Record<string, string> = {
  quote: 'Bad "Q" Title',
  injection: INJECTION,
  backslash: "Bad \\ Title",
  newline: "Line1\nLine2",
  tab: "Bad\tTitle",
  "control-char": "Bad \u0007 Title",
  "line-separator": "Bad \u2028 Title",
  "paragraph-separator": "Bad \u2029 Title",
  "block-comment-terminator": "Bad */ Title",
  "placeholder-token": "Title {{NAME}} here",
  empty: "",
  "whitespace-only": "   ",
};

interface RunResult {
  code: number;
  out: string;
}

let root: string;

function run(args: string[]): RunResult {
  const r = spawnSync(process.execPath, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: SPAWN_TIMEOUT,
  });
  if (r.error) throw r.error;
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** Run a generator (the real one, or a modified copy) with a title, into a fresh directory. */
function scaffold(
  title: string,
  label: string,
  scaffolder = SCAFFOLDER,
): RunResult & { dir: string } {
  const into = join(root, label);
  rmSync(into, { recursive: true, force: true });
  mkdirSync(into, { recursive: true });
  return { ...run([scaffolder, NAME, "--out", into, "--title", title]), dir: join(into, NAME) };
}

function everyFileUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...everyFileUnder(path));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

/**
 * A generator with one call textually removed, so a counterfactual reconstructs the shipped code
 * minus a named guard rather than approximating it. The substitution is asserted to have changed
 * the source, so a rename cannot quietly turn a counterfactual into a second test of the fixed
 * generator.
 */
function generatorWithout(calls: string[], label: string): string {
  const workspace = join(root, `without-${label}`);
  mkdirSync(join(workspace, "scripts"), { recursive: true });
  // The copy resolves `prettier` and `@cosyte/prettier-config` exactly as the original does, so it
  // needs this repo's node_modules reachable from where it sits.
  symlinkSync(join(REPO_ROOT, "node_modules"), join(workspace, "node_modules"), "dir");
  cpSync(TEMPLATE, join(workspace, "scripts", "parser-template"), { recursive: true });

  const source = readFileSync(SCAFFOLDER, "utf8");
  let stripped = source;
  for (const call of calls) {
    const next = stripped.replace(call, "void 0;");
    expect(
      next,
      `the generator no longer contains \`${call}\`, so this counterfactual is reconstructing ` +
        `nothing and would pass vacuously`,
    ).not.toBe(stripped);
    stripped = next;
  }
  const path = join(workspace, "scripts", "scaffold-parser.mjs");
  writeFileSync(path, stripped);
  return path;
}

const VALIDATE_CALL = "validateTitle(title, flags.title === undefined);";
const ASSERT_CALL =
  'assertEmittedManifest(join(destDir, "package.json"), tokens["{{PKG}}"], title);';

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "cosyte-scaffold-title-"));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("the template really does spread the title across several syntaxes", () => {
  it("carries {{TITLE}} into more than one file, in more than one language", () => {
    // Derived from the template every run rather than written down here: the argument for refusing
    // a hostile title instead of escaping one is that there is no single correct escaping, and that
    // argument is only true while the token genuinely lands in several syntaxes. If the template
    // ever narrows to one, the remedy is worth revisiting rather than this claim being restated.
    const carriers = everyFileUnder(TEMPLATE).filter((path) =>
      readFileSync(path, "utf8").includes("{{TITLE}}"),
    );
    expect(carriers.length).toBeGreaterThan(1);
    const syntaxes = new Set(carriers.map((path) => extname(path)));
    expect(syntaxes.size).toBeGreaterThan(1);
    expect([...syntaxes]).toContain(".json");
  });
});

describe("a conformant --title still scaffolds a repo that describes itself correctly", () => {
  it(
    "emits a manifest that parses, names the package asked for, and carries the title",
    () => {
      const result = scaffold(CONFORMANT_TITLE, "control");
      expect(result.code, result.out).toBe(0);

      const manifest = JSON.parse(readFileSync(join(result.dir, "package.json"), "utf8")) as {
        name: string;
        description: string;
      };
      expect(manifest.name).toBe(PKG);
      expect(manifest.description).toContain(CONFORMANT_TITLE);

      // Born-compliant means no placeholder survives into the emitted tree either, which is the
      // half of the `{{` rule a manifest check cannot see.
      const leftovers = everyFileUnder(result.dir).filter((path) =>
        /\{\{[A-Za-z_]+\}\}/.test(readFileSync(path, "utf8")),
      );
      expect(leftovers).toEqual([]);
    },
    SPAWN_TIMEOUT,
  );
});

describe("a title that cannot be substituted safely is refused, with nothing left on disk", () => {
  it.each(Object.keys(HOSTILE))(
    "%s: refuses, names the flag, and writes no repo",
    (label) => {
      const result = scaffold(HOSTILE[label] as string, `hostile-${label}`);
      expect(
        result.code,
        `A title the generator cannot substitute safely was accepted.\n${result.out}`,
      ).not.toBe(0);
      expect(result.out).toContain("--title");
      // The refusal has to land BEFORE the first write: a half-written repo left behind by a
      // refusal has already broken the promise that what the generator emits is usable.
      expect(
        existsSync(result.dir),
        `the refusal left a partially-written repo at ${result.dir}`,
      ).toBe(false);
    },
    SPAWN_TIMEOUT,
  );

  it(
    "says which character, where, and why",
    () => {
      // A refusal that does not name the offending character sends its reader back to bisecting
      // their own title by hand. The quote is the one that matters most: it is the character that
      // turns a broken manifest into a rewritten one.
      const result = scaffold('Bad "Q" Title', "diagnosis");
      expect(result.out).toContain("U+0022 QUOTATION MARK");
      expect(result.out).toContain("offset 4");
      expect(result.out).toContain("rename the package");
    },
    SPAWN_TIMEOUT,
  );
});

describe("counterfactual: the same generator with the guards removed", () => {
  /**
   * The guards above are worth their lines only if the defect returns when they go away, and the
   * SECOND one is worth its lines only if the first does not already cover it. Both are measured
   * here by rebuilding the generator out of the shipped source with one or both calls removed.
   */
  let withoutBoth: string;
  let withoutValidate: string;
  let withoutAssert: string;

  beforeAll(() => {
    withoutBoth = generatorWithout([VALIDATE_CALL, ASSERT_CALL], "both");
    withoutValidate = generatorWithout([VALIDATE_CALL], "validate");
    withoutAssert = generatorWithout([ASSERT_CALL], "assert");
  }, SPAWN_TIMEOUT);

  it(
    "without both: the injection scaffolds SILENTLY, exit 0, naming a different package",
    () => {
      const result = scaffold(INJECTION, "cf-both", withoutBoth);
      expect(
        result.code,
        "the injection no longer reaches a successful scaffold even with both guards removed, so " +
          "this counterfactual is not reconstructing the defect the guards exist for",
      ).toBe(0);
      expect(result.out).toContain(`Scaffolded ${PKG}`);
      const manifest = JSON.parse(readFileSync(join(result.dir, "package.json"), "utf8")) as {
        name: string;
      };
      expect(manifest.name).toBe("@evil/pwned");
    },
    SPAWN_TIMEOUT,
  );

  it(
    "without both: a quoted title emits a package.json nothing can parse",
    () => {
      const result = scaffold('Bad "Q" Title', "cf-both-quote", withoutBoth);
      const raw = readFileSync(join(result.dir, "package.json"), "utf8");
      expect(() => JSON.parse(raw)).toThrow();
    },
    SPAWN_TIMEOUT,
  );

  it(
    "without validateTitle: the manifest assertion still catches the injection",
    () => {
      const result = scaffold(INJECTION, "cf-validate", withoutValidate);
      expect(result.code, result.out).not.toBe(0);
      expect(result.out).toContain("@evil/pwned");
      expect(result.out).toContain(PKG);
    },
    SPAWN_TIMEOUT,
  );

  it(
    "without assertEmittedManifest: the input check still catches the injection",
    () => {
      const result = scaffold(INJECTION, "cf-assert", withoutAssert);
      expect(result.code, result.out).not.toBe(0);
      expect(result.out).toContain("--title");
      expect(result.out).toContain("U+0022 QUOTATION MARK");
    },
    SPAWN_TIMEOUT,
  );
});
