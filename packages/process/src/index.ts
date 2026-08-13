/**
 * @cosyte/process: the shared per-repo process scripts for the `@cosyte/*` repos.
 *
 * The package exists to be used through its bin (`cosyte-process <verb>`); this entry point exposes
 * the same machinery programmatically, which is what the wiring check, the tests and any future
 * tooling read the contract from. Nothing here has side effects.
 *
 * @packageDocumentation
 */

export {
  checkWiring,
  expectedScriptBody,
  RESERVED_VARIANTS,
  type ReservedVariant,
} from "./check.js";
export {
  applyModifier,
  isModifierFor,
  MODIFIERS_BY_VERB,
  type Modifier,
  SUPPORTED_MODIFIER_PAIRS,
} from "./modifiers.js";
export {
  applyOverride,
  loadOverrides,
  OVERRIDE_FILE,
  OVERRIDE_KEYS,
  OverrideError,
  type Overrides,
  type VerbOverride,
} from "./overrides.js";
export { resolveToolBin, ToolResolutionError } from "./resolve.js";
export { run, type RunOptions, type SpawnTool, usageText } from "./run.js";
export {
  BASELINE,
  DELEGATED_VERBS,
  type DelegatedVerb,
  type Invocation,
  isDelegatedVerb,
  isVerb,
  toArgv,
  TOOL_PACKAGES,
  type ToolName,
  type Verb,
  VERBS,
} from "./verbs.js";
