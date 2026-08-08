import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import prettier from "prettier";
import { describe, expect, it } from "vitest";

/**
 * Guards the root `format` / `format:check` globs against the defect that let a formatting
 * violation ship green here: the globs named `{js,ts,json,md,yml,yaml}` while this repo tracks
 * eight `.mjs` files, seven of them outside `.prettierignore`, so `prettier` was never once
 * pointed at any of the seven. `format:check` passed on every one of them without reading them.
 * A guard that has never been pointed at an input has not cleared that input.
 *
 * That gap is why a 101-character line in `scripts/attw.mjs` reached review under `#55` with a
 * green `format:check` behind it, and it is invisible by construction: a glob that omits an
 * extension reports success rather than "no such input", so nothing in CI can distinguish
 * "checked and clean" from "never looked".
 *
 * THE CENSUS IS DERIVED ON EVERY RUN, NEVER WRITTEN DOWN. `git ls-files` is piped through
 * prettier's own `getFileInfo()`, which is the same resolution the CLI uses for `.prettierignore`
 * and for parser inference. A hand-written list of extensions is a claim, and it is precisely the
 * shape that went stale here, and it would go stale again the first time someone lands a `.cjs`,
 * a `.mts`, or a `.css`. This test fails the moment such a file is tracked and unmatched, and
 * names it.
 *
 * SCOPE, STATED NO WIDER THAN IT HOLDS. What is compared is EXTENSION SETS, not file sets: every
 * extension carried by a tracked, non-ignored, prettier-parseable file must appear in the globs.
 * That is strictly weaker than "prettier reads every such file", and the gap is real rather than
 * theoretical. `getFileInfo()` is given only `.prettierignore`, while the prettier CLI defaults to
 * `[".gitignore", ".prettierignore"]`, so a file ignored by `.gitignore` alone counts here and is
 * skipped there. Today the two file sets are identical, so nothing is hidden; the point is that a
 * green here does not by itself prove they still are.
 *
 * It also does not reach the emitted output of `scripts/scaffold-parser.mjs`.
 * `scripts/parser-template` is `.prettierignore`d wholesale (it carries `{{PLACEHOLDER}}` tokens
 * and is not valid TS/JSON until generated), and no glob here can reach a tree that does not exist
 * until the generator runs. That half is closed separately, by the generator formatting what it
 * emits; `test/scaffold-format.test.ts` is the guard for it.
 */

const REPO_ROOT = join(import.meta.dirname, "..");

/** Extensions the root globs name, as `prettier` itself would expand the brace list. */
function coveredExtensions(script: string, flag: "--check" | "--write"): Set<string> {
  // The shape is asserted rather than pattern-matched loosely, so a restructure into path-scoped
  // globs (the shape the parser repos use) fails LOUDLY here instead of silently reducing this
  // test to a tautology. Widening the shape is a deliberate edit to this function.
  const shape = new RegExp(`^prettier ${flag} "(\\*\\*/\\*\\.\\{[a-z0-9,]+\\})"$`);
  const m = shape.exec(script.trim());
  if (!m) {
    throw new Error(
      `Root "${flag === "--check" ? "format:check" : "format"}" is no longer a single ` +
        `\`**/*.{ext,...}\` glob, so this guard can no longer derive what it covers.\n` +
        `  got: ${script}\n` +
        `Teach coveredExtensions() the new shape before changing the script. Do not delete ` +
        `this assertion to get green.`,
    );
  }
  const braces = /\{([a-z0-9,]+)\}/.exec(m[1] as string) as RegExpExecArray;
  return new Set((braces[1] as string).split(","));
}

/** Every tracked file prettier can parse and has not been told to ignore, grouped by extension. */
async function trackedFormattableByExtension(): Promise<Map<string, string[]>> {
  const tracked = execFileSync("git", ["ls-files", "-z"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  })
    .split("\0")
    .filter(Boolean);

  const byExtension = new Map<string, string[]>();
  for (const file of tracked) {
    const info = await prettier.getFileInfo(join(REPO_ROOT, file), {
      ignorePath: join(REPO_ROOT, ".prettierignore"),
      resolveConfig: true,
    });
    if (info.ignored || info.inferredParser === null) continue;
    const extension = file.slice(file.lastIndexOf(".") + 1);
    const bucket = byExtension.get(extension);
    if (bucket) bucket.push(file);
    else byExtension.set(extension, [file]);
  }
  return byExtension;
}

const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

describe("root format globs", () => {
  it("point prettier at every tracked file it can parse", async () => {
    const covered = coveredExtensions(pkg.scripts["format:check"] as string, "--check");
    const present = await trackedFormattableByExtension();

    // The census must not be empty, or this test clears a corpus it never read, which is the
    // same failure mode it exists to catch.
    expect(present.size).toBeGreaterThan(0);

    const unreached = [...present.entries()]
      .filter(([extension]) => !covered.has(extension))
      .map(([extension, files]) => `  .${extension} (${files.length}), e.g. ${files[0]}`);

    expect(
      unreached,
      `format:check never reads these tracked, non-ignored, prettier-parseable files.\n` +
        `They pass by never being looked at.\n${unreached.join("\n")}\n` +
        `Add the extension to BOTH "format" and "format:check" in package.json.`,
    ).toEqual([]);
  });

  it("keep format and format:check on exactly the same extensions", () => {
    // If they drift, `pnpm format` fixes a set `pnpm format:check` does not check (a violation
    // ships green) or checks a set it cannot fix (CI red with no local remedy).
    const check = coveredExtensions(pkg.scripts["format:check"] as string, "--check");
    const write = coveredExtensions(pkg.scripts["format"] as string, "--write");
    expect([...write].sort()).toEqual([...check].sort());
  });

  it("covers .mjs, the extension whose absence let a violation ship green", async () => {
    // Pinned by name as well as by the derived census: the census would also go green if every
    // .mjs file were deleted, and this repo's gates are .mjs scripts.
    const covered = coveredExtensions(pkg.scripts["format:check"] as string, "--check");
    expect(covered.has("mjs")).toBe(true);
    const present = await trackedFormattableByExtension();
    expect(present.get("mjs")?.length ?? 0).toBeGreaterThan(0);
  });

  it("refuses a glob shape it cannot derive coverage from, rather than passing vacuously", () => {
    // The negative control: pointed at the parser repos' path-scoped shape, the deriver must
    // throw. Without this, a restructure would silently reduce the census above to `{}` ⊇ `{}`.
    expect(() =>
      coveredExtensions(
        'prettier --check "src/**/*.{ts,md}" "test/**/*.ts" "scripts/**/*.{ts,mjs}"',
        "--check",
      ),
    ).toThrow(/no longer a single/);
  });
});
