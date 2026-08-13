import { readFileSync } from "node:fs";
import { join } from "node:path";

import { type Modifier } from "./modifiers.js";
import { loadOverrides, OverrideError } from "./overrides.js";
import { DELEGATED_VERBS, type DelegatedVerb } from "./verbs.js";

/**
 * Term 8: `cosyte-process check`, the conformance verb consumers run in CI.
 *
 * Its scope is exactly the "process wiring": the five delegated verb scripts, any present reserved
 * variant scripts, and the override file. An absent reserved variant script is conforming; a present
 * one whose body drifted is not.
 */

/** The four reserved variant script names, and the invocation each one must carry. */
export interface ReservedVariant {
  /** The verb the variant delegates to. */
  readonly verb: DelegatedVerb;
  /** The modifier the variant applies. */
  readonly modifier: Modifier;
}

/**
 * The reserved variant script names (term 6). A consumer MAY carry any subset, including none.
 *
 * @example
 * RESERVED_VARIANTS["lint:fix"].modifier; // => "--fix"
 */
export const RESERVED_VARIANTS: Readonly<Record<string, ReservedVariant>> = {
  "test:watch": { verb: "test", modifier: "--watch" },
  "test:coverage": { verb: "test", modifier: "--coverage" },
  "lint:fix": { verb: "lint", modifier: "--fix" },
  "format:check": { verb: "format", modifier: "--check" },
};

/**
 * The exact script body term 6 requires for a verb, with an optional modifier.
 *
 * @param verb - The delegated verb.
 * @param modifier - The modifier, for a reserved variant script.
 * @returns The script body, byte for byte.
 * @example
 * expectedScriptBody("test", "--watch"); // => "cosyte-process test --watch"
 */
export function expectedScriptBody(verb: DelegatedVerb, modifier?: Modifier): string {
  return modifier === undefined ? `cosyte-process ${verb}` : `cosyte-process ${verb} ${modifier}`;
}

/**
 * The package.json shape `check` reads. Everything else in the manifest is out of scope.
 *
 * @internal
 */
interface ConsumerManifest {
  scripts?: Record<string, unknown>;
}

/**
 * Check a consumer's process wiring (term 8).
 *
 * @param cwd - The consumer's working directory.
 * @returns One line per violation, in a stable order; empty means conforming.
 * @throws Error When the working directory has no readable package.json.
 * @example
 * checkWiring("/repo/that/conforms"); // => []
 */
export function checkWiring(cwd: string): string[] {
  const manifestPath = join(cwd, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ConsumerManifest;
  const scripts: Record<string, unknown> = manifest.scripts ?? {};
  const violations: string[] = [];

  for (const verb of DELEGATED_VERBS) {
    const expected = expectedScriptBody(verb);
    const actual: unknown = scripts[verb];
    if (actual === undefined) {
      violations.push(`package.json: script "${verb}" is missing; expected exactly: ${expected}`);
    } else if (actual !== expected) {
      violations.push(
        `package.json: script "${verb}" is ${JSON.stringify(actual)}; expected exactly: ${expected}`,
      );
    }
  }

  for (const [name, variant] of Object.entries(RESERVED_VARIANTS)) {
    const actual: unknown = scripts[name];
    if (actual === undefined) {
      // Term 8: an absent reserved variant script is conforming. Consumers need not carry all four.
      continue;
    }
    const expected = expectedScriptBody(variant.verb, variant.modifier);
    if (actual !== expected) {
      violations.push(
        `package.json: script "${name}" is ${JSON.stringify(actual)}; expected exactly: ${expected}`,
      );
    }
  }

  try {
    loadOverrides(cwd);
  } catch (error: unknown) {
    if (error instanceof OverrideError) {
      violations.push(error.message);
    } else {
      throw error;
    }
  }

  return violations;
}
