import { readFileSync } from "node:fs";
import { join } from "node:path";

import { type Modifier } from "./modifiers.js";
import { loadOverrides, OverrideError } from "./overrides.js";
import { DELEGATED_VERBS, type DelegatedVerb } from "./verbs.js";

/**
 * Term 8: `cosyte-process check`, the conformance verb consumers run in CI.
 *
 * Its scope is exactly the "process wiring": the five delegated verb scripts, any present reserved
 * variant scripts, the override file, and a direct `vitest` dependency if the consumer declares one.
 * An absent reserved variant script is conforming; a present one whose body drifted is not. An
 * absent direct vitest is conforming; a present one not pinned to exactly this package's vitest is
 * not, because test files import their types from it while `cosyte-process test` runs ours.
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
 * The package.json shape `check` reads: the scripts, and a direct vitest wherever it is declared.
 * Everything else in the manifest is out of scope.
 *
 * @internal
 */
interface ConsumerManifest {
  scripts?: Record<string, unknown>;
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
}

/**
 * This package's own manifest. `src/` and the built `dist/` are both one level below it.
 *
 * @internal
 */
const OWN_MANIFEST = join(import.meta.dirname, "..", "package.json");

/**
 * The exact vitest version this package depends on, read from its own manifest at run time.
 *
 * Read rather than inlined, so the pin `check` asks of a consumer is always the vitest this package
 * actually resolves for `cosyte-process test`.
 *
 * @returns The `dependencies.vitest` specifier of `@cosyte/process`'s package.json.
 * @throws Error When that manifest declares no vitest dependency.
 * @internal
 */
export function pinnedVitest(): string {
  const own = JSON.parse(readFileSync(OWN_MANIFEST, "utf8")) as {
    dependencies?: Record<string, string>;
  };
  const pin = own.dependencies?.["vitest"];
  if (pin === undefined) {
    throw new Error(`${OWN_MANIFEST} declares no vitest dependency`);
  }
  return pin;
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

  // A consumer may declare vitest directly, for the types its test files import, but only at exactly
  // the version this package runs: any other specifier type-checks against one vitest and runs
  // another.
  const want = pinnedVitest();
  for (const field of ["dependencies", "devDependencies"] as const) {
    const declared: unknown = manifest[field]?.["vitest"];
    if (declared !== undefined && declared !== want) {
      violations.push(
        `package.json: ${field} "vitest" is ${JSON.stringify(declared)}; expected exactly: ` +
          `${want}, the vitest @cosyte/process runs`,
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
