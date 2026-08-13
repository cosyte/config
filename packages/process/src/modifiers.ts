import { type DelegatedVerb, type Invocation } from "./verbs.js";

/**
 * Term 3: the four modifiers, and how each one transforms an EFFECTIVE invocation.
 *
 * "Effective" is the load-bearing word. A modifier composes over the baseline as already adjusted by
 * any term-7 override, never over the raw baseline, so `lint --fix` under a `globs` override lints
 * the overridden globs.
 */

/** A modifier flag. Exactly four exist, and at most one may appear per invocation. */
export type Modifier = "--watch" | "--coverage" | "--fix" | "--check";

/**
 * Which modifiers each delegated verb accepts.
 *
 * A modifier that exists but not for the verb in hand (`build --watch`, say) is an unknown modifier:
 * term 3 defines the four as verb-specific pairs, not as a free-floating flag set.
 *
 * @example
 * MODIFIERS_BY_VERB.lint; // => ["--fix"]
 */
export const MODIFIERS_BY_VERB: Readonly<Record<DelegatedVerb, readonly Modifier[]>> = {
  build: [],
  test: ["--watch", "--coverage"],
  lint: ["--fix"],
  typecheck: [],
  format: ["--check"],
};

/**
 * The supported `<verb> <modifier>` pairs, in the order the usage text lists them.
 *
 * @example
 * SUPPORTED_MODIFIER_PAIRS[0]; // => "test --watch"
 */
export const SUPPORTED_MODIFIER_PAIRS: readonly string[] = Object.entries(
  MODIFIERS_BY_VERB,
).flatMap(([verb, modifiers]) => modifiers.map((modifier) => `${verb} ${modifier}`));

/**
 * Whether `modifier` is one of the four modifiers `verb` accepts.
 *
 * @param verb - The delegated verb being invoked.
 * @param modifier - Candidate modifier, typically straight off argv.
 * @returns True when the pair is one of term 3's four.
 * @example
 * isModifierFor("test", "--coverage"); // => true
 */
export function isModifierFor(verb: DelegatedVerb, modifier: string): modifier is Modifier {
  return (MODIFIERS_BY_VERB[verb] as readonly string[]).includes(modifier);
}

/**
 * Replace a core token, which term 3's two substituting modifiers do.
 *
 * @internal
 */
function replaceCore(invocation: Invocation, from: string, to: string): Invocation {
  if (!invocation.core.includes(from)) {
    // Unreachable by construction: core tokens survive every override (term 7), so the target is
    // always there. Kept as a loud refusal rather than a silent no-op if that ever stops holding.
    throw new Error(
      `internal: cannot apply modifier, core token "${from}" is absent from the effective invocation`,
    );
  }
  return { ...invocation, core: invocation.core.map((token) => (token === from ? to : token)) };
}

/**
 * Compose a modifier over an effective invocation (term 3).
 *
 * `--watch` swaps the core token `run` for `watch` and `--check` swaps the core token `--write` for
 * `--check`; `--coverage` and `--fix` append themselves after the flag tokens, which keeps term 4's
 * emission order (tool, core, flags, globs) intact.
 *
 * The verb is not a parameter: the four pairs are validated before this is reached, and each
 * modifier's transformation is fully determined by the modifier itself.
 *
 * @param modifier - The single modifier to apply.
 * @param invocation - The effective invocation: baseline as adjusted by any override.
 * @returns A new invocation; the input is not mutated.
 * @example
 * applyModifier("--watch", BASELINE.test).core; // => ["watch"]
 */
export function applyModifier(modifier: Modifier, invocation: Invocation): Invocation {
  switch (modifier) {
    case "--watch":
      return replaceCore(invocation, "run", "watch");
    case "--check":
      return replaceCore(invocation, "--write", "--check");
    case "--coverage":
    case "--fix":
      return { ...invocation, flags: [...invocation.flags, modifier] };
  }
}
