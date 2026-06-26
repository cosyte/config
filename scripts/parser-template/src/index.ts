/**
 * Public entry point for the `{{PKG}}` package.
 *
 * This is the **archetype scaffold** for a cosyte standard parser (see the meta-repo's
 * `documentation/conventions.md` → "The standard parser archetype"). The real parser, model,
 * serializer, helpers, and profile system are populated in subsequent phases; these stubs keep the
 * module resolvable and typed so the build/typecheck/lint/test pipeline verifies end-to-end, and
 * they pin the public shape every sibling `@cosyte/*` parser shares.
 */

/**
 * Library version string, synced with `package.json#version` at build time by downstream phases.
 * Exported now so consumers (and the type-check pipeline) have at least one symbol to resolve
 * through the `exports` map.
 *
 * @example
 * ```ts
 * import { VERSION } from "{{PKG}}";
 * console.log(VERSION);
 * ```
 */
export const VERSION = "0.0.0";

/**
 * The result of parsing a {{TITLE}} payload.
 *
 * Mirrors the cosyte parser archetype: a parsed value plus the **warnings** the lenient parser
 * recovered from (Tier-2 deviations). The real model — an immutable document with dot-path access,
 * named helpers, and a spec-clean serializer — lands in subsequent phases; for now this captures the
 * minimal lenient-parse contract.
 */
export interface Parsed{{Pascal}} {
  /** The parsed in-memory representation. A structural stub until the real model lands. */
  readonly value: Record<string, unknown>;
  /** Tier-2 deviations recovered during a lenient parse — stable code + position, never thrown. */
  readonly warnings: readonly {{Pascal}}Warning[];
}

/**
 * A single Tier-2 tolerance warning.
 *
 * Warnings carry a **stable** {@link WarningCode} plus positional context so consumers can branch on
 * `w.code === WARNING_CODES.SOME_CODE` without the code churning — renaming a code is a breaking
 * change. The serializer never emits these; they describe what the lenient parser tolerated.
 */
export interface {{Pascal}}Warning {
  /** The stable warning code. One of the values in {@link WARNING_CODES}. */
  readonly code: WarningCode;
  /** Human-readable detail for logs (never contains PHI). */
  readonly message: string;
  /** Positional context (offset/segment/element — refined as the parser grows). */
  readonly position?: { readonly offset: number };
}

/**
 * Options for {@link parse{{Pascal}}}.
 *
 * The parser is **lenient by default** (Postel's Law): vendor quirks become {@link {{Pascal}}Warning}s
 * rather than failures. Set `strict` to escalate every Tier-2 deviation to a thrown error.
 */
export interface Parse{{Pascal}}Options {
  /** When `true`, escalate every Tier-2 deviation to a thrown error instead of a warning. */
  readonly strict?: boolean;
}

/**
 * Parse a {{TITLE}} payload into a {@link Parsed{{Pascal}}}.
 *
 * **Lenient by default** — real-world, vendor-quirky input parses rather than throws, emitting
 * {@link {{Pascal}}Warning}s instead (Postel's Law). The complementary serializer (added in a later
 * phase) always emits spec-clean output. Only unrecoverable structural corruption throws (a Tier-3
 * {@link FatalCode}).
 *
 * @param raw - The raw {{TITLE}} payload (`string` for now; `Buffer`/`Uint8Array` support is added
 *   alongside the real parser).
 * @param options - Parse options; see {@link Parse{{Pascal}}Options}. Lenient unless `strict` is set.
 * @returns The parsed value plus any recovered Tier-2 warnings.
 * @throws Only on a Tier-3 {@link FatalCode} (unrecoverable structural corruption), or — once
 *   implemented — on any Tier-2 deviation when `options.strict` is `true`.
 * @example
 * ```ts
 * import { parse{{Pascal}} } from "{{PKG}}";
 *
 * const { value, warnings } = parse{{Pascal}}(raw);
 * for (const w of warnings) console.warn(w.code, w.position);
 * ```
 */
export function parse{{Pascal}}(raw: string, options: Parse{{Pascal}}Options = {}): Parsed{{Pascal}} {
  // Archetype stub: the real lenient tokenizer/model lands in subsequent phases. The signature and
  // return shape are the load-bearing contract here (mirrored across the sibling @cosyte/* parsers).
  void raw;
  void options;
  return { value: {}, warnings: [] };
}

/**
 * Stable **Tier-2 warning code** registry — the lenient parser's recoverable deviations.
 *
 * Each code is its own value (`key === value`) so the set survives `Object.values(...)` into a
 * snapshot tripwire (see `@cosyte/test-utils`' `sortedCodeSet`). These codes are part of the public
 * contract: consumers branch on them, so renaming or removing one is a **breaking change**. Real
 * codes are added here as the parser grows; this placeholder keeps the shape resolvable.
 *
 * @example
 * ```ts
 * import { WARNING_CODES } from "{{PKG}}";
 *
 * if (warning.code === WARNING_CODES.EXAMPLE_TOLERATED_DEVIATION) {
 *   // handle the tolerated deviation
 * }
 * ```
 */
export const WARNING_CODES = {
  /** Placeholder Tier-2 code — replace with the parser's real recoverable-deviation codes. */
  EXAMPLE_TOLERATED_DEVIATION: "EXAMPLE_TOLERATED_DEVIATION",
} as const;

/**
 * A value from {@link WARNING_CODES} — the type consumers narrow `warning.code` against.
 */
export type WarningCode = (typeof WARNING_CODES)[keyof typeof WARNING_CODES];

/**
 * Stable **Tier-3 fatal code** registry — unrecoverable structural corruption.
 *
 * Tier-3 codes are **always thrown**, even in lenient mode: they mark input the parser cannot
 * recover into a structured result. Like {@link WARNING_CODES} these are `key === value` and part of
 * the public contract. Real codes are added as the parser grows; this placeholder keeps the shape
 * resolvable.
 *
 * @example
 * ```ts
 * import { FATAL_CODES } from "{{PKG}}";
 *
 * try {
 *   parse{{Pascal}}(raw);
 * } catch (err) {
 *   // err carries a code from FATAL_CODES
 *   void FATAL_CODES.EXAMPLE_UNRECOVERABLE;
 * }
 * ```
 */
export const FATAL_CODES = {
  /** Placeholder Tier-3 code — replace with the parser's real unrecoverable-corruption codes. */
  EXAMPLE_UNRECOVERABLE: "EXAMPLE_UNRECOVERABLE",
} as const;

/**
 * A value from {@link FATAL_CODES} — the type carried by a thrown fatal error.
 */
export type FatalCode = (typeof FATAL_CODES)[keyof typeof FATAL_CODES];
