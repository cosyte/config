import { readFileSync } from "node:fs";
import { join } from "node:path";

import { DELEGATED_VERBS, type DelegatedVerb, type Invocation, isDelegatedVerb } from "./verbs.js";

/**
 * Term 7: the override file, its schema, and how an override adjusts a baseline.
 *
 * Repo-specific deviation lives here and nowhere else. The tool name and the core tokens are never
 * added, removed, replaced or reordered; only the flag tokens and the glob tokens can be replaced,
 * per term 4's partition.
 */

/** The one file a consumer may use to deviate from the baseline. Lives at the consumer root. */
export const OVERRIDE_FILE = "cosyte-process.config.json";

/** The keys an override object may carry for a verb. Nothing else is accepted at either level. */
export const OVERRIDE_KEYS: readonly string[] = ["globs", "flags"];

/** A single verb's override: either key may be absent, and an absent key keeps the baseline tokens. */
export interface VerbOverride {
  /** Replaces the verb's baseline glob tokens. */
  readonly globs?: readonly string[];
  /** Replaces the verb's baseline flag tokens. */
  readonly flags?: readonly string[];
}

/** The parsed override file: at most one entry per delegated verb. */
export type Overrides = { readonly [K in DelegatedVerb]?: VerbOverride };

/**
 * A term-7 schema violation, or an unreadable/malformed override file.
 *
 * Its message always names the file and the first violation, which is what every verb prints before
 * exiting non-zero.
 *
 * @example
 * new OverrideError("/repo/cosyte-process.config.json", "unknown verb name \"buidl\"").message;
 */
export class OverrideError extends Error {
  /** Absolute path of the offending override file. */
  readonly file: string;

  /** The first violation found, without the file prefix. */
  readonly violation: string;

  /**
   * @param file - Absolute path of the override file.
   * @param violation - The first violation found.
   */
  constructor(file: string, violation: string) {
    super(`${file}: ${violation}`);
    this.name = "OverrideError";
    this.file = file;
    this.violation = violation;
  }
}

/** A plain-object guard that does not admit arrays or null. @internal */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validate one verb's override object, in the file's own key order. @internal */
function parseVerbOverride(file: string, verb: string, value: unknown): VerbOverride {
  if (!isPlainObject(value)) {
    throw new OverrideError(file, `the value of "${verb}" must be an object`);
  }
  const result: { globs?: readonly string[]; flags?: readonly string[] } = {};
  for (const key of Object.keys(value)) {
    if (!OVERRIDE_KEYS.includes(key)) {
      throw new OverrideError(
        file,
        `unknown key "${key}" under "${verb}" (expected one of ${OVERRIDE_KEYS.join(", ")})`,
      );
    }
    const tokens: unknown = value[key];
    if (!Array.isArray(tokens) || tokens.some((token) => typeof token !== "string")) {
      throw new OverrideError(file, `"${verb}.${key}" must be an array of strings`);
    }
    const strings: string[] = tokens.filter((token): token is string => typeof token === "string");
    if (key === "globs") {
      result.globs = strings;
    } else {
      result.flags = strings;
    }
  }
  return result;
}

/**
 * Read and validate the override file for a working directory (term 7).
 *
 * An absent file is the ordinary case and yields no overrides. A present but invalid file throws,
 * and the caller turns that into a non-zero exit for EVERY verb, not just the overridden one.
 *
 * @param cwd - The consumer's working directory.
 * @returns The validated overrides, empty when the file is absent.
 * @throws OverrideError When the file is unreadable, is not JSON, or violates the term-7 schema.
 * @example
 * loadOverrides("/repo/with/no/override/file"); // => {}
 */
export function loadOverrides(cwd: string): Overrides {
  const file = join(cwd, OVERRIDE_FILE);
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error: unknown) {
    if (isPlainObject(error) && error["code"] === "ENOENT") {
      return {};
    }
    throw new OverrideError(file, `cannot be read (${describe(error)})`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error: unknown) {
    throw new OverrideError(file, `malformed JSON (${describe(error)})`);
  }

  if (!isPlainObject(parsed)) {
    throw new OverrideError(file, "the top level must be a JSON object");
  }

  const overrides: { [K in DelegatedVerb]?: VerbOverride } = {};
  for (const key of Object.keys(parsed)) {
    if (key === "check") {
      throw new OverrideError(file, '"check" is not overridable');
    }
    if (!isDelegatedVerb(key)) {
      throw new OverrideError(
        file,
        `unknown verb name "${key}" (expected one of ${DELEGATED_VERBS.join(", ")})`,
      );
    }
    overrides[key] = parseVerbOverride(file, key, parsed[key]);
  }
  return overrides;
}

/** Best-effort message for an unknown thrown value. @internal */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Apply a verb's override to its baseline, producing the effective invocation (term 7).
 *
 * The tool and the core tokens pass through untouched; `flags` and `globs` are replaced wholesale
 * when given and kept when absent.
 *
 * @param baseline - The verb's term-4 baseline invocation.
 * @param override - That verb's override, if the file carried one.
 * @returns The effective invocation.
 * @example
 * applyOverride(BASELINE.test, { flags: ["--coverage"] }); // => vitest run --coverage
 */
export function applyOverride(
  baseline: Invocation,
  override: VerbOverride | undefined,
): Invocation {
  if (override === undefined) {
    return baseline;
  }
  return {
    tool: baseline.tool,
    core: baseline.core,
    flags: override.flags ?? baseline.flags,
    globs: override.globs ?? baseline.globs,
  };
}
