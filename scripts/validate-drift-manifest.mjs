#!/usr/bin/env node
// scripts/validate-drift-manifest.mjs
//
// VALIDATE drift-manifest.json AGAINST THE SCHEMA THAT SHIPS BESIDE IT, WITH NOTHING INSTALLED.
//
// Run from the umbrella root (or anywhere):
//   pnpm --dir config run drift:validate
//   node config/scripts/validate-drift-manifest.mjs [--manifest <path>] [--schema <path>]
//
// WHY THIS IS HAND-ROLLED RATHER THAN `ajv`. The manifest is read by two gates that run with no
// `node_modules` present, and the file that calls itself the standard must be checkable in the same
// conditions. So this implements the SUBSET of JSON Schema 2020-12 the schema actually uses, and
// nothing else: type, required, properties, additionalProperties, patternProperties, propertyNames,
// items, minItems, minProperties, minLength, minimum, uniqueItems, enum, const, pattern, and local
// `$ref` into `$defs`. An UNKNOWN KEYWORD IS A HARD ERROR rather than a silent skip: a validator
// that ignores what it does not understand reports green over a constraint it never applied, which
// is the exact shape of blind gate this repo has already paid for twice.
//
// WHAT IT CHECKS BEYOND THE SCHEMA. Six invariants a schema cannot express, each one a claim the
// manifest makes about itself that would otherwise be unfalsifiable:
//
//   1. EVERY submodule path is claimed by EXACTLY ONE baseline, and no baseline names a repo the
//      estate does not list. Two baselines that together miss a repo, or claim one twice, are how
//      "every repo owes something" becomes a sentence rather than a fact.
//   2. Every top-level key the PREVIOUS manifest carried appears in exactly one of
//      `carriedUnchanged` or `droppedOrChanged`, so a requirement cannot vanish unmentioned.
//   3. Every key listed in `carriedUnchanged` is STILL PRESENT somewhere in the manifest. Without
//      this the list is a claim about a requirement that may have been deleted in the same commit.
//   4. Every `phiScanProbe.perRepo` override names a repo some baseline actually holds, so an
//      override cannot outlive the repo it exists for.
//   5. Every repo named in `optionalWorkflows[].carriedBy` is a repo some baseline holds, for the
//      same reason as 4: a carrier list is a measurement of the estate, and one naming a repo the
//      estate does not have is a measurement of nothing.
//   6. NO WORKFLOW IS DECLARED OPTIONAL AND REQUIRED AT ONCE, and none is declared optional twice.
//      `optional` means the checker reports neither its presence nor its absence, and `required`
//      means it reports its absence: a file claimed as both would have the manifest saying that a
//      repo both does and does not owe it, and whichever half a reader found first would look
//      settled.
//
// Exit codes, a contract asserted by test/drift-manifest.test.ts:
//   0  the manifest parses, matches the schema, and satisfies the invariants
//   1  the manifest is unparseable, violates the schema, or violates an invariant (the refusal this
//      gate exists for; every message names the offending key path)
//   2  the validator could not run (bad invocation, unreadable file, unparseable SCHEMA)
//
// The 1-versus-2 split is the same one scripts/changeset-guard.mjs draws, and for the same reason:
// a gate that could not read its input must not report the code that means it read it and found a
// violation.

import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Imported by RELATIVE PATH rather than as `@cosyte/script-utils`, because this gate must run with
// no `node_modules` for a bare specifier to resolve through. Same reason as changeset-guard.mjs.
import { isCliEntrypoint } from "../packages/script-utils/index.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const configRoot = resolve(scriptDir, "..");

export const DEFAULT_MANIFEST = join(configRoot, "drift-manifest.json");
export const DEFAULT_SCHEMA = join(configRoot, "drift-manifest.schema.json");

/** Thrown for an invocation or environment problem: exit 2, never exit 1. */
export class ValidatorError extends Error {}

/**
 * Keywords this validator implements. Anything else in a schema is refused rather than skipped.
 *
 * EXPORTED SO THE SCHEMA CAN BE GRADED AGAINST IT DIRECTLY. `validateValue` already throws on an
 * unknown keyword, but only along a path some value actually reaches; a subschema guarding a key
 * that no shipped manifest exercises would never be walked, and its unsupported keyword would sit
 * there reading as a constraint. test/drift-manifest.test.ts walks the whole schema against this
 * set instead.
 */
export const SUPPORTED_KEYWORDS = new Set([
  "$ref",
  "$schema",
  "$id",
  "$defs",
  "title",
  "description",
  "type",
  "required",
  "properties",
  "additionalProperties",
  "patternProperties",
  "propertyNames",
  "items",
  "minItems",
  "minProperties",
  "minLength",
  "minimum",
  "uniqueItems",
  "enum",
  "const",
  "pattern",
]);

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The type name this validator reports for a value, in JSON Schema's own vocabulary. */
function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function matchesType(value, want) {
  switch (want) {
    case "object":
      return isPlainObject(value);
    case "array":
      return Array.isArray(value);
    case "integer":
      return Number.isInteger(value);
    case "number":
      return typeof value === "number";
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      throw new ValidatorError(`the schema names an unsupported type ${JSON.stringify(want)}`);
  }
}

/** Extend a dotted key path. The root is named rather than left empty, so every error has a subject. */
function child(path, key) {
  return path === "" ? String(key) : `${path}.${key}`;
}

function resolveRef(ref, root) {
  const match = /^#\/\$defs\/([A-Za-z0-9_-]+)$/.exec(ref);
  if (match === null) {
    throw new ValidatorError(
      `only local references of the form "#/$defs/<name>" are supported, got ${JSON.stringify(ref)}`,
    );
  }
  const target = root.$defs?.[match[1]];
  if (target === undefined) {
    throw new ValidatorError(`the schema has no $defs entry named ${JSON.stringify(match[1])}`);
  }
  return target;
}

/**
 * Validate one value against one schema, appending `"<key path>: <problem>"` lines to `errors`.
 *
 * @param {unknown} value The value under test.
 * @param {Record<string, unknown>} schema The schema to apply.
 * @param {string} path The dotted key path of `value`, `""` at the root.
 * @param {Record<string, unknown>} root The whole schema document, for `$ref`.
 * @param {string[]} errors Collected problems.
 */
export function validateValue(value, schema, path, root, errors) {
  if (!isPlainObject(schema)) {
    throw new ValidatorError(`the schema at ${path === "" ? "(root)" : path} is not an object`);
  }
  for (const keyword of Object.keys(schema)) {
    if (!SUPPORTED_KEYWORDS.has(keyword)) {
      throw new ValidatorError(
        `the schema uses the keyword ${JSON.stringify(keyword)}, which this validator does not ` +
          `implement. Refusing to report a manifest valid against a constraint that was skipped.`,
      );
    }
  }

  if (typeof schema.$ref === "string") {
    validateValue(value, resolveRef(schema.$ref, root), path, root, errors);
    return;
  }

  const where = path === "" ? "(root)" : path;
  const before = errors.length;

  if (typeof schema.type === "string" && !matchesType(value, schema.type)) {
    errors.push(`${where}: want type ${schema.type}, got ${typeOf(value)}`);
    return; // Every keyword below assumes the type held. Reporting them too would be noise.
  }

  if (schema.const !== undefined && JSON.stringify(value) !== JSON.stringify(schema.const)) {
    errors.push(`${where}: want the constant ${JSON.stringify(schema.const)}`);
  }
  if (
    Array.isArray(schema.enum) &&
    !schema.enum.some((o) => JSON.stringify(o) === JSON.stringify(value))
  ) {
    errors.push(`${where}: want one of ${schema.enum.map((o) => JSON.stringify(o)).join(", ")}`);
  }

  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      errors.push(`${where}: want at least ${schema.minLength} characters, got ${value.length}`);
    }
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(value)) {
      errors.push(`${where}: ${JSON.stringify(value)} does not match /${schema.pattern}/`);
    }
  }

  if (typeof value === "number" && typeof schema.minimum === "number" && value < schema.minimum) {
    errors.push(`${where}: want at least ${schema.minimum}, got ${value}`);
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      errors.push(`${where}: want at least ${schema.minItems} item(s), got ${value.length}`);
    }
    if (schema.uniqueItems === true) {
      const seen = new Set();
      for (const [index, item] of value.entries()) {
        const key = JSON.stringify(item);
        if (seen.has(key)) errors.push(`${child(path, `[${index}]`)}: duplicate entry ${key}`);
        seen.add(key);
      }
    }
    if (isPlainObject(schema.items)) {
      for (const [index, item] of value.entries()) {
        validateValue(item, schema.items, `${path}[${index}]`, root, errors);
      }
    }
  }

  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (typeof schema.minProperties === "number" && keys.length < schema.minProperties) {
      errors.push(
        `${where}: want at least ${schema.minProperties} propert(ies), got ${keys.length}`,
      );
    }
    for (const name of schema.required ?? []) {
      if (!Object.hasOwn(value, name)) {
        errors.push(`${where}: missing required property ${JSON.stringify(name)}`);
      }
    }
    if (isPlainObject(schema.propertyNames)) {
      for (const name of keys) {
        validateValue(
          name,
          schema.propertyNames,
          `${child(path, name)} (property name)`,
          root,
          errors,
        );
      }
    }
    const declared = isPlainObject(schema.properties) ? schema.properties : {};
    const patterns = isPlainObject(schema.patternProperties) ? schema.patternProperties : {};
    for (const name of keys) {
      const here = child(path, name);
      let matched = false;
      if (Object.hasOwn(declared, name)) {
        validateValue(value[name], declared[name], here, root, errors);
        matched = true;
      }
      for (const [pattern, sub] of Object.entries(patterns)) {
        if (new RegExp(pattern, "u").test(name)) {
          validateValue(value[name], sub, here, root, errors);
          matched = true;
        }
      }
      if (matched) continue;
      if (schema.additionalProperties === false) {
        errors.push(`${here}: unexpected property (the schema declares no such key)`);
      } else if (isPlainObject(schema.additionalProperties)) {
        validateValue(value[name], schema.additionalProperties, here, root, errors);
      }
    }
  }

  return errors.length === before;
}

/** Every object key anywhere in a JSON value, so a claim about a key being present can be checked. */
export function collectKeys(value, into = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, into);
  } else if (isPlainObject(value)) {
    for (const [key, sub] of Object.entries(value)) {
      into.add(key);
      collectKeys(sub, into);
    }
  }
  return into;
}

/**
 * The four claims the manifest makes about itself that a schema cannot check.
 *
 * @param {Record<string, any>} manifest A manifest that has already matched the schema.
 * @returns {string[]} One line per violated invariant, each naming a key path.
 */
export function checkInvariants(manifest) {
  const errors = [];

  // 1. Every submodule path is claimed by exactly one baseline, and no baseline invents a repo.
  const estate = new Set(manifest.estate.submodulePaths);
  const claimedBy = new Map();
  for (const [name, baseline] of Object.entries(manifest.baselines)) {
    for (const [index, repo] of baseline.repos.entries()) {
      const where = `baselines.${name}.repos[${index}]`;
      if (!estate.has(repo)) {
        errors.push(
          `${where}: ${JSON.stringify(repo)} is not one of estate.submodulePaths, so this baseline ` +
            `names a repo the estate does not list`,
        );
      }
      const already = claimedBy.get(repo);
      if (already !== undefined) {
        errors.push(
          `${where}: ${JSON.stringify(repo)} is already held by the ${already} baseline; a repo ` +
            `must belong to exactly one`,
        );
      } else {
        claimedBy.set(repo, name);
      }
    }
  }
  for (const [index, repo] of manifest.estate.submodulePaths.entries()) {
    if (!claimedBy.has(repo)) {
      errors.push(
        `estate.submodulePaths[${index}]: ${JSON.stringify(repo)} is assigned to no baseline, so ` +
          `nothing states what that repo owes`,
      );
    }
  }

  // 2 and 3. The re-derivation record has to account for the previous manifest, and the keys it
  // claims to have carried have to still be here.
  const { preChangeKeys, carriedUnchanged, droppedOrChanged } = manifest.reDerivation;
  const kept = new Set(carriedUnchanged);
  const handled = new Map();
  for (const [index, entry] of droppedOrChanged.entries()) {
    handled.set(entry.was, `reDerivation.droppedOrChanged[${index}]`);
  }
  for (const [index, key] of preChangeKeys.entries()) {
    const inKept = kept.has(key);
    const inHandled = handled.has(key);
    if (!inKept && !inHandled) {
      errors.push(
        `reDerivation.preChangeKeys[${index}]: ${JSON.stringify(key)} appears in neither ` +
          `carriedUnchanged nor droppedOrChanged, so a requirement the previous manifest carried ` +
          `is unaccounted for`,
      );
    }
    if (inKept && inHandled) {
      errors.push(
        `reDerivation.preChangeKeys[${index}]: ${JSON.stringify(key)} is listed as carried ` +
          `unchanged AND as dropped or changed; it can be only one`,
      );
    }
  }
  const present = collectKeys(manifest);
  for (const [index, key] of carriedUnchanged.entries()) {
    if (!present.has(key)) {
      errors.push(
        `reDerivation.carriedUnchanged[${index}]: ${JSON.stringify(key)} is claimed to be carried ` +
          `unchanged but appears nowhere in this manifest`,
      );
    }
  }

  // 4. A per-repo probe override must name a repo some baseline holds.
  for (const repo of Object.keys(manifest.phiScanProbe.perRepo ?? {})) {
    if (!claimedBy.has(repo)) {
      errors.push(
        `phiScanProbe.perRepo.${repo}: no baseline holds a repo by that name, so this override is ` +
          `parameterising a probe run that never happens`,
      );
    }
  }

  // 5 and 6. The optional set is a claim about the estate and a claim against the baselines, and
  // both are checkable. A carrier must be a repo some baseline holds, and a workflow declared
  // optional must not also be required of anybody.
  const requiredWorkflowsBy = new Map();
  for (const [baselineName, baseline] of Object.entries(manifest.baselines)) {
    for (const [groupName, group] of Object.entries(baseline.groups)) {
      for (const workflow of group.requirements.requiredWorkflows ?? []) {
        if (!requiredWorkflowsBy.has(workflow)) {
          requiredWorkflowsBy.set(workflow, `baselines.${baselineName}.groups.${groupName}`);
        }
      }
    }
  }
  const declaredOptional = new Map();
  for (const [index, entry] of (manifest.optionalWorkflows?.workflows ?? []).entries()) {
    const where = `optionalWorkflows.workflows[${index}]`;
    const already = declaredOptional.get(entry.workflow);
    if (already !== undefined) {
      errors.push(
        `${where}: ${JSON.stringify(entry.workflow)} is already declared optional at ${already}; ` +
          `one workflow gets one entry, or two carrier lists disagree about the same file`,
      );
    } else {
      declaredOptional.set(entry.workflow, where);
    }
    const requiredAt = requiredWorkflowsBy.get(entry.workflow);
    if (requiredAt !== undefined) {
      errors.push(
        `${where}: ${JSON.stringify(entry.workflow)} is declared OPTIONAL here and REQUIRED by ` +
          `${requiredAt}. It can be one or the other: optional means the checker reports neither ` +
          `its presence nor its absence, required means it reports its absence`,
      );
    }
    for (const [repoIndex, repo] of entry.carriedBy.entries()) {
      if (!claimedBy.has(repo)) {
        errors.push(
          `${where}.carriedBy[${repoIndex}]: no baseline holds a repo named ` +
            `${JSON.stringify(repo)}, so this carrier list measures a repo the estate does not have`,
        );
      }
    }
  }

  return errors;
}

/**
 * Read a JSON file, reporting a missing or unreadable file separately from an unparseable one.
 *
 * @param {string} path Absolute path.
 * @param {"input" | "schema"} role Which failure this is: an unparseable INPUT is a validation
 *   failure (exit 1), an unparseable SCHEMA means the validator cannot run at all (exit 2).
 * @returns {{ value?: unknown, error?: string }} Exactly one of the two.
 */
function readJsonFile(path, role) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (cause) {
    throw new ValidatorError(`cannot read ${path}: ${String(cause)}`);
  }
  try {
    return { value: JSON.parse(text) };
  } catch (cause) {
    if (role === "schema")
      throw new ValidatorError(`${path} is not parseable JSON: ${String(cause)}`);
    return { error: `${path}: not parseable JSON, so no key path can be named: ${String(cause)}` };
  }
}

/**
 * Validate a manifest file against a schema file.
 *
 * @param {{ manifestPath?: string, schemaPath?: string }} options Defaults are this repo's own files.
 * @returns {{ ok: boolean, manifestPath: string, schemaPath: string, errors: string[] }}
 */
export function validateManifest({ manifestPath = DEFAULT_MANIFEST, schemaPath } = {}) {
  const manifestAbs = resolve(manifestPath);
  const read = readJsonFile(manifestAbs, "input");
  if (read.error !== undefined) {
    return {
      ok: false,
      manifestPath: manifestAbs,
      schemaPath: schemaPath ?? "",
      errors: [read.error],
    };
  }
  const manifest = read.value;

  // The manifest names its own schema, so a manifest and a schema cannot drift apart unnoticed.
  let schemaAbs;
  if (schemaPath !== undefined) {
    schemaAbs = resolve(schemaPath);
  } else if (
    isPlainObject(manifest) &&
    typeof manifest.$schema === "string" &&
    !/^https?:/.test(manifest.$schema)
  ) {
    schemaAbs = isAbsolute(manifest.$schema)
      ? manifest.$schema
      : resolve(dirname(manifestAbs), manifest.$schema);
  } else {
    schemaAbs = DEFAULT_SCHEMA;
  }
  const schema = readJsonFile(schemaAbs, "schema").value;

  const errors = [];
  validateValue(manifest, schema, "", schema, errors);
  // The invariants read named fields, so they can only run over a manifest whose shape already held.
  if (errors.length === 0) errors.push(...checkInvariants(manifest));

  return { ok: errors.length === 0, manifestPath: manifestAbs, schemaPath: schemaAbs, errors };
}

/**
 * CLI entry point.
 *
 * @param {string[]} argv Arguments after the script path.
 * @returns {number} Process exit code.
 */
function main(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--manifest" || arg === "--schema") {
      i += 1;
      const value = argv[i];
      if (value === undefined) throw new ValidatorError(`${arg} needs a value`);
      options[arg === "--manifest" ? "manifestPath" : "schemaPath"] = value;
    } else {
      throw new ValidatorError(`unknown argument ${JSON.stringify(arg)}`);
    }
  }

  const result = validateManifest(options);
  if (result.ok) {
    process.stdout.write(
      `drift:validate: OK (${result.manifestPath} matches ${result.schemaPath} and satisfies the ` +
        `re-derivation, coverage, probe and optional-workflow invariants)\n`,
    );
    return 0;
  }
  process.stderr.write(`ERROR: ${result.manifestPath} is not a valid drift manifest:\n`);
  for (const error of result.errors) process.stderr.write(`    - ${error}\n`);
  process.stderr.write(
    `Refusing. Nothing was graded: a manifest that does not validate cannot say what any repo owes.\n`,
  );
  return 1;
}

// `isCliEntrypoint` rather than a string comparison against argv[1], for the reasons its own
// docblock gives. Importing this file for tests must not run the CLI.
if (isCliEntrypoint(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    if (error instanceof ValidatorError) {
      process.stderr.write(`ERROR: drift:validate could not run: ${error.message}\n`);
      process.exit(2);
    }
    throw error;
  }
}
