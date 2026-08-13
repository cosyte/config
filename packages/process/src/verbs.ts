/**
 * Term 3's verb surface and term 4's baseline table plus token partition.
 *
 * The partition is the whole contract: overrides (term 7) replace glob tokens and flag tokens and
 * nothing else, modifiers (term 3) compose over the result, and every invocation is emitted as
 * tool, core, flags, globs, in that order.
 */

/** A verb that delegates to an underlying tool. */
export type DelegatedVerb = "build" | "test" | "lint" | "typecheck" | "format";

/** Every verb `cosyte-process` accepts: the five delegated ones plus `check`. */
export type Verb = DelegatedVerb | "check";

/** The bin name each baseline invocation calls. */
export type ToolName = "tsup" | "vitest" | "eslint" | "tsc" | "prettier";

/**
 * The five delegated verbs, in the order the usage text lists them.
 *
 * @example
 * DELEGATED_VERBS.includes("build"); // => true
 */
export const DELEGATED_VERBS: readonly DelegatedVerb[] = [
  "build",
  "test",
  "lint",
  "typecheck",
  "format",
];

/**
 * Every verb, delegated ones first and `check` last.
 *
 * @example
 * VERBS.at(-1); // => "check"
 */
export const VERBS: readonly Verb[] = [...DELEGATED_VERBS, "check"];

/**
 * An invocation split into term 4's four token classes.
 *
 * `core` is the mode-selecting part (`run`, `--noEmit`, `--write`). It survives every override, which
 * is what lets the two substituting modifiers always find their target token.
 */
export interface Invocation {
  /** The bin to run. */
  readonly tool: ToolName;
  /** Mode-selecting tokens. Never added, removed, replaced or reordered by an override. */
  readonly core: readonly string[];
  /** Flag tokens. Replaceable per verb by an override's `flags`. */
  readonly flags: readonly string[];
  /** Glob tokens. Replaceable per verb by an override's `globs`. */
  readonly globs: readonly string[];
}

/**
 * The npm package that provides each tool bin.
 *
 * Term 5 makes all of them dependencies of this package, so they resolve from here and a consumer
 * declares none of them.
 *
 * @example
 * TOOL_PACKAGES.tsc; // => "typescript"
 */
export const TOOL_PACKAGES: Readonly<Record<ToolName, string>> = {
  tsup: "tsup",
  vitest: "vitest",
  eslint: "eslint",
  tsc: "typescript",
  prettier: "prettier",
};

/**
 * Term 4: the per-verb baseline invocation, partitioned.
 *
 * Verified verbatim from the consumer class this replaces; the flag and glob tokens are exactly the
 * ones those hand-maintained scripts carried.
 *
 * @example
 * BASELINE.test.core; // => ["run"]
 */
export const BASELINE: Readonly<Record<DelegatedVerb, Invocation>> = {
  build: { tool: "tsup", core: [], flags: [], globs: [] },
  test: { tool: "vitest", core: ["run"], flags: [], globs: [] },
  lint: {
    tool: "eslint",
    core: [],
    flags: ["--max-warnings=0", "--no-error-on-unmatched-pattern"],
    globs: ["src/**/*.ts", "scripts/**/*.ts", "test/**/*.ts"],
  },
  typecheck: { tool: "tsc", core: ["--noEmit"], flags: [], globs: [] },
  format: {
    tool: "prettier",
    core: ["--write"],
    flags: [],
    globs: ["src/**/*.{ts,md}", "test/**/*.ts", "scripts/**/*.{ts,mjs}", "*.{json,md,yml}"],
  },
};

/**
 * Emit an invocation as argv: tool, core, flags, globs, in that order (term 4).
 *
 * The glob tokens are emitted unquoted because nothing here goes through a shell. The quotes in a
 * hand-maintained package.json script exist to stop the shell expanding the pattern; passing an argv
 * array to the tool directly is what those quotes were protecting.
 *
 * @param invocation - The baseline or effective invocation to emit.
 * @returns The argv, tool name first.
 * @example
 * toArgv(BASELINE.typecheck); // => ["tsc", "--noEmit"]
 */
export function toArgv(invocation: Invocation): string[] {
  return [invocation.tool, ...invocation.core, ...invocation.flags, ...invocation.globs];
}

/**
 * Narrow an arbitrary string to a delegated verb.
 *
 * @param value - Candidate verb, typically straight off argv.
 * @returns True when `value` is one of the five delegated verbs.
 * @example
 * isDelegatedVerb("check"); // => false
 */
export function isDelegatedVerb(value: string): value is DelegatedVerb {
  return (DELEGATED_VERBS as readonly string[]).includes(value);
}

/**
 * Narrow an arbitrary string to any verb, `check` included.
 *
 * @param value - Candidate verb, typically straight off argv.
 * @returns True when `value` is one of the six verbs.
 * @example
 * isVerb("check"); // => true
 */
export function isVerb(value: string): value is Verb {
  return (VERBS as readonly string[]).includes(value);
}
