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
export { ENTRY_POINTS, type EntryPoint, isEntryPoint } from "./entry-points.js";
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
export {
  DEFAULT_OUTPUT_DIR,
  DOCS_ARTIFACT,
  PACK_DOCS_INPUTS,
  packDocs,
  PackDocsError,
  type PackDocsResult,
  type RequiredInput,
  SOURCE_ARTIFACT,
} from "./pack-docs.js";
export { resolveToolBin, ToolResolutionError } from "./resolve.js";
export { run, type RunOptions, type SpawnTool, usageText } from "./run.js";
export {
  findVersionDeclarations,
  SOURCE_ENTRY_POINT,
  syncVersion,
  SyncVersionError,
  type SyncVersionOutcome,
  type SyncVersionResult,
  type VersionDeclaration,
} from "./sync-version.js";
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
export {
  gradeSecurityWorkflows,
  gradeWorkflowFile,
  gradeWorkflowText,
  SECURITY_WORKFLOW_FILES,
  SECURITY_WORKFLOW_SURFACES,
  type SecurityWorkflowFile,
  type TriggerSurface,
  WORKFLOW_DIRECTORY,
  type WorkflowPermissions,
} from "./workflows.js";
