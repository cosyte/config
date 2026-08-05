import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { isCliEntrypoint } from "@cosyte/script-utils";
import { afterEach, describe, expect, it } from "vitest";

// THE NEGATIVE CONTROL FOR THE ENTRY-POINT GUARD.
//
// Every `scripts/*.mjs` gate in this org ends with "run the CLI only if I am the entry point", so
// that a test can import the module for its exports without the CLI firing. That guard used to be
// spelled inline:
//
//     process.argv[1] !== undefined && import.meta.url === `file://${resolve(process.argv[1])}`
//
// which compares two STRINGS rather than two paths. It answers `false` for three ordinary
// invocations, and a `false` here does not fail loudly: the gate simply exits 0 having checked
// nothing, which is indistinguishable from a clean pass.
//
// THAT IS WHY THIS SUITE IS SHAPED THE WAY IT IS, and the shape is the whole point:
//
//   1. ASSERTING AN EXIT CODE CANNOT FAIL IN THIS DIRECTION. A gate that ran and passed exits 0. A
//      gate that never ran also exits 0. Every assertion below therefore checks OBSERVED BEHAVIOUR
//      (a printed verdict, or a refusal the gate is obliged to make) and never a bare exit 0. The
//      earlier attempt at this fix shipped a test that looked like it covered the extension-less
//      direction and could not fail. This suite is built so that it can.
//
//   2. THE OLD SPELLING IS CARRIED HERE AS A LIVE CONTROL. `OLD_SNIFF_FIXTURE` reproduces it
//      verbatim, and the table asserts it reports `false` for exactly the invocations the new helper
//      gets right. If someone reverts `isCliEntrypoint` to a string comparison, the `expected` column
//      and the `oldSniff` column collapse onto each other and these tests go red. Without the
//      control, a test asserting only "the new helper says true" would still pass against an
//      implementation that says true unconditionally.
//
// All three divergences were measured on Node 22.23.1 in this container, not predicted.

const HELPER = join(import.meta.dirname, "..", "packages", "script-utils", "index.js");
const GUARD = join(import.meta.dirname, "..", "scripts", "changeset-guard.mjs");

const temporaryDirs: string[] = [];

afterEach(() => {
  while (temporaryDirs.length > 0) {
    const dir = temporaryDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

/** A fixture that answers the question with the helper under test. */
const NEW_HELPER_FIXTURE = [
  `import { isCliEntrypoint } from ${JSON.stringify(pathToFileURL(HELPER).href)};`,
  `process.stdout.write("ENTRY=" + isCliEntrypoint(import.meta.url) + "\\n");`,
  "",
].join("\n");

/** The string comparison this slice replaced, reproduced verbatim as the control. */
const OLD_SNIFF_FIXTURE = [
  `import { resolve } from "node:path";`,
  `const entry = process.argv[1];`,
  `const answer = entry !== undefined && import.meta.url === "file://" + resolve(entry);`,
  `process.stdout.write("ENTRY=" + answer + "\\n");`,
  "",
].join("\n");

/**
 * Lay out a throwaway ESM package containing one fixture script, in several invocable shapes.
 *
 * @param source The fixture body to write.
 * @param directoryName Name of the temp directory, so a space can be forced into the path.
 * @returns Paths for each invocation form.
 */
function fixtureTree(
  source: string,
  directoryName = "entrypoint-",
): { root: string; script: string; extensionless: string; indexDir: string; link: string } {
  // Realpathed because the OLD-spelling control below asserts an exact string match for the plain
  // invocation. On macOS `tmpdir()` is `/var/folders/...`, a symlink to `/private/var/...`, which
  // Node resolves for the main module: without this the control would answer `false` there and red
  // a test that is about something else entirely.
  const parent = realpathSync(mkdtempSync(join(tmpdir(), "entrypoint-case-")));
  temporaryDirs.push(parent);
  const root = join(parent, directoryName);
  mkdirSync(root, { recursive: true });
  // `"type": "module"` is what makes an extension-less `.js` entry load as ESM, which is the shape
  // `tsx scripts/gate` produces for TypeScript and the reason `argv[1]` names no file on disk.
  writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }), "utf8");

  const script = join(root, "gate.js");
  writeFileSync(script, source, "utf8");

  const indexDir = join(root, "as-directory");
  mkdirSync(indexDir, { recursive: true });
  writeFileSync(join(indexDir, "index.js"), source, "utf8");

  const link = join(root, "linked.js");
  symlinkSync(script, link);

  return { root, script, extensionless: join(root, "gate"), indexDir, link };
}

/**
 * Run a fixture and read back the verdict it printed.
 *
 * @param target What to hand to `node`.
 * @returns The parsed verdict.
 */
function verdict(target: string): string {
  const stdout = execFileSync("node", [target], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const match = /ENTRY=(true|false)/.exec(stdout);
  // A fixture that printed nothing is a broken test, not a passing one.
  if (match === null) throw new Error(`fixture printed no verdict: ${JSON.stringify(stdout)}`);
  return match[1];
}

describe("isCliEntrypoint, across every invocation form", () => {
  const cases = [
    {
      name: "the exact path, which is the only form the string comparison ever got right",
      form: (t: ReturnType<typeof fixtureTree>) => t.script,
      oldSniff: "true",
    },
    {
      name: "extension-less, where node resolves `.js` and argv[1] names no file",
      form: (t: ReturnType<typeof fixtureTree>) => t.extensionless,
      oldSniff: "false",
    },
    {
      name: "a directory, where node resolves `index.js`",
      form: (t: ReturnType<typeof fixtureTree>) => t.indexDir,
      oldSniff: "false",
    },
    {
      name: "through a symlink, which node resolves to the real path",
      form: (t: ReturnType<typeof fixtureTree>) => t.link,
      oldSniff: "false",
    },
  ] as const;

  for (const testCase of cases) {
    it(`reports the entry point when invoked by ${testCase.name}`, () => {
      expect(verdict(testCase.form(fixtureTree(NEW_HELPER_FIXTURE)))).toBe("true");
    });

    it(`control: the old string comparison answers ${testCase.oldSniff} for ${testCase.name}`, () => {
      expect(verdict(testCase.form(fixtureTree(OLD_SNIFF_FIXTURE)))).toBe(testCase.oldSniff);
    });
  }

  it("reports the entry point from a checkout whose path contains a space", () => {
    const tree = fixtureTree(NEW_HELPER_FIXTURE, "space dir");
    expect(tree.script).toContain(" ");
    expect(verdict(tree.script)).toBe("true");
  });

  it("control: the old string comparison answers false for a path containing a space", () => {
    // `import.meta.url` percent-encodes the space; concatenating `file://` onto a raw path does not.
    expect(verdict(fixtureTree(OLD_SNIFF_FIXTURE, "space dir").script)).toBe("false");
  });

  it("reports NOT the entry point when the module is imported by another script", () => {
    const tree = fixtureTree(NEW_HELPER_FIXTURE);
    const importer = join(tree.root, "importer.js");
    writeFileSync(importer, `import ${JSON.stringify(pathToFileURL(tree.script).href)};\n`, "utf8");
    // This is the property the guard exists for. It must survive every change above.
    expect(verdict(importer)).toBe("false");
  });
});

describe("isCliEntrypoint, called directly", () => {
  it("is false when there is no entry script at all, as under `node --eval`", () => {
    const argv = process.argv[1];
    try {
      process.argv[1] = "";
      expect(isCliEntrypoint(pathToFileURL(HELPER).href)).toBe(false);
    } finally {
      process.argv[1] = argv as string;
    }
  });

  it("is false for a module that is not the entry, even sharing a basename", () => {
    // `test/gate.js` must not answer for `scripts/gate.js`.
    expect(isCliEntrypoint(pathToFileURL(join(import.meta.dirname, "gate.js")).href)).toBe(false);
  });

  it("is false for a non-file module URL", () => {
    expect(isCliEntrypoint("data:text/javascript,export{}")).toBe(false);
  });

  it("throws rather than silently answering false when handed the wrong thing", () => {
    // Returning false here would disable the caller's CLI without a word, which is the failure mode
    // this whole helper exists to remove.
    // @ts-expect-error deliberately wrong argument
    expect(() => isCliEntrypoint(undefined)).toThrow(TypeError);
    expect(() => isCliEntrypoint("")).toThrow(TypeError);
  });
});

describe("the shipped changeset-guard, invoked through a symlink", () => {
  /**
   * Build a workspace carrying one inert changeset, which the guard is obliged to refuse.
   *
   * @returns The workspace root.
   */
  function workspaceWithInertChangeset(): string {
    const root = mkdtempSync(join(tmpdir(), "entrypoint-guard-"));
    temporaryDirs.push(root);
    const packageDir = join(root, "packages", "tsconfig");
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(
      join(packageDir, "package.json"),
      JSON.stringify({ name: "@cosyte/tsconfig", version: "0.0.1" }),
      "utf8",
    );
    const changesetDir = join(root, ".changeset");
    mkdirSync(changesetDir, { recursive: true });
    writeFileSync(join(changesetDir, "config.json"), JSON.stringify({ changelog: false }), "utf8");
    writeFileSync(
      join(changesetDir, "inert.md"),
      "---\n---\n\nA perfectly good summary nobody will ever read.\n",
      "utf8",
    );
    return root;
  }

  /**
   * Run the guard binary at `entry` against a workspace.
   *
   * @param entry The path to invoke.
   * @param root The workspace root.
   * @returns Exit code and combined output.
   */
  function run(entry: string, root: string): { code: number; output: string } {
    try {
      const stdout = execFileSync("node", [entry, "--workspace", root], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { code: 0, output: stdout };
    } catch (error) {
      const err = error as { status?: number; stdout?: string; stderr?: string };
      return { code: err.status ?? -1, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
    }
  }

  it("still runs when there is no `node_modules` anywhere, which is how CI invokes it", () => {
    // THE INVARIANT THIS DEFENDS, and it is the reason the helper is imported by relative path.
    // `ci.yml` and `release.yml` both run this gate BEFORE `pnpm install`, deliberately, so that a
    // broken or hostile install cannot decide whether a release gate runs. A future editor tidying
    // `../packages/script-utils/index.js` into the bare specifier `@cosyte/script-utils` would look
    // correct, pass every other test in this repo (the tree it runs in has `node_modules`), and
    // break the gate only on CI. So the gate is copied somewhere with no `node_modules` above it
    // and run there: a bare specifier cannot resolve, and this test reds.
    const root = mkdtempSync(join(tmpdir(), "entrypoint-preinstall-"));
    temporaryDirs.push(root);
    mkdirSync(join(root, "scripts"), { recursive: true });
    mkdirSync(join(root, "packages", "script-utils"), { recursive: true });
    copyFileSync(GUARD, join(root, "scripts", "changeset-guard.mjs"));
    for (const file of ["index.js", "package.json"]) {
      copyFileSync(
        join(import.meta.dirname, "..", "packages", "script-utils", file),
        join(root, "packages", "script-utils", file),
      );
    }

    const workspace = workspaceWithInertChangeset();
    const copied = run(join(root, "scripts", "changeset-guard.mjs"), workspace);

    // Asserted on the refusal, not on an exit code: a gate that failed to import would also be
    // non-zero, and a gate that never ran would be 0.
    expect(copied.output).toContain("declares no packages");
    expect(copied.code).toBe(1);
  });

  it("still refuses an inert changeset, rather than exiting 0 having graded nothing", () => {
    const root = workspaceWithInertChangeset();
    const linkDir = mkdtempSync(join(tmpdir(), "entrypoint-link-"));
    temporaryDirs.push(linkDir);
    const link = join(linkDir, "guard.mjs");
    symlinkSync(GUARD, link);

    const direct = run(GUARD, root);
    const linked = run(link, root);

    // The point of the pair: a silently skipped gate exits 0 with no output, which is exactly what a
    // clean pass looks like on the exit code alone. Only the output tells them apart, so both are
    // asserted, and the symlinked run is required to match the direct one.
    expect(direct.code).toBe(1);
    expect(linked.code).toBe(1);
    expect(linked.output).toContain("declares no packages");
    expect(linked.output).toBe(direct.output);
  });
});
