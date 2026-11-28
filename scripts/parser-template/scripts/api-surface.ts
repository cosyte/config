#!/usr/bin/env tsx
/**
 * Derive the package's public export surface from a built `.d.ts` and compare it against the
 * committed inventory, `release/public-api.json` for the main entry point, `{{PKG}}`. A further
 * entry point gets its own inventory, `release/public-api-<entry>.json`, and a row in `ENTRIES`.
 *
 * WHY THIS EXISTS. `dist/index.d.ts` is what every consumer's editor and compiler reads, and it
 * is assembled by a bundler from a barrel: nothing in `pnpm lint`, `pnpm typecheck` or the test
 * suite fails when an export leaves it, changes shape, or arrives unnoticed. A published type
 * surface that nobody wrote down cannot be certified stable, and "we did not mean to remove that"
 * is not recoverable once a version is on the registry. The inventory is the written-down surface;
 * this script is the thing that says the two still agree.
 *
 * WHAT IT REFUSES TO DO, and why each refusal is the point:
 *
 *   1. IT NEVER SELF-HEALS. The default mode compares and reports; it does not write. A check that
 *      rewrites its own baseline on mismatch always passes and therefore measures nothing, which is
 *      the exact shape of the silent-green failure the other gates in this repo were built against.
 *      Updating the baseline is `--write`, a separate deliberate act whose diff a reviewer reads.
 *   2. IT NEVER REPORTS AN EMPTY SURFACE AS A MATCH. Declarations that are absent, empty, or that
 *      resolve to a module with no exports are a MISSING INPUT (exit 2), never "zero exports, which
 *      happens to differ from the inventory" and never "zero exports, which happens to match an
 *      empty inventory". `tsup` writes JS before declarations, so every build has a window where
 *      `dist/` holds no `.d.ts` at all; a gate that cannot say its own inputs were missing reports
 *      that window as a pass. The shared `attw` gate (`cosyte-attw`) carries the same net for the
 *      same reason.
 *   3. IT NAMES EVERY DIFFERENCE. Added, removed and changed exports are listed individually, with
 *      the before and after for a change, so the reviewer decides whether the change is intended
 *      rather than being told only that something moved.
 *
 * WHAT AN INVENTORY ENTRY RECORDS. One entry per exported name, sorted by name:
 *
 *   `name`     the exported name, as a consumer imports it.
 *   `kind`     class | function | variable | interface | type | namespace | enum.
 *   `type`     for a VALUE export, the printed type (a function's signature, a const's type). Empty
 *              for a type-only or namespace export, whose printed type is just its own name.
 *   `members`  the named parts of the export, SORTED for a stable diff:
 *                interface / class   its properties and methods, `name?: Type` when optional
 *                                    (a class also lists its static side, prefixed `static `)
 *                type alias          the constituents when it is a union (so a warning-code or
 *                                    usage-code union lists its literals), else its properties
 *                namespace           the names it re-exports
 *                function / variable empty: `type` already carries the signature
 *
 * WHY THE MEMBERS ARE SORTED. A diff has to be stable across runs, and declaration order in a
 * bundled `.d.ts` is the bundler's business, not the API's. The one thing sorting gives up is
 * overload ORDER on a function, which is why a function's overloads live in `type` (printed in
 * declaration order by the type printer) rather than in `members`.
 *
 * THE TYPESCRIPT VERSION IS PART OF THE BASELINE. Entries are produced by the TypeScript type
 * printer, so an upgrade can legitimately change the text without the API changing. The inventory
 * records the version it was derived under and this script refuses a silent mismatch: an upgrade
 * reds here and is regenerated deliberately. Fully-qualified type names are deliberately NOT requested from the printer:
 * they embed the absolute path of the declarations file, which would make the baseline differ
 * between two machines that agree about the API.
 *
 * USAGE
 *
 *     tsx scripts/api-surface.ts [--entry <name>] [--declarations <path>] [--inventory <path>] [--write]
 *
 *   --entry         the entry point, a key of `ENTRIES`: `index` (the default, `{{PKG}}`). It
 *                   sets the two defaults below.
 *   --declarations  the built `.d.ts` to read (default `dist/<entry>.d.ts`, relative to cwd)
 *   --inventory     the committed inventory (default `release/public-api.json` for `index`,
 *                   `release/public-api-<entry>.json` otherwise, relative to cwd)
 *   --write         regenerate the inventory instead of comparing it
 *
 * EXIT CODES.  0 the surface matches (or was written).  1 the surface drifted.  2 the check could
 * not run: bad arguments, or inputs missing. 1 and 2 are kept apart because they need different
 * responses, and a run that could not read its inputs must never be mistaken for a clean one.
 */

import { readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import ts from "typescript";

/** What kind of thing an export is, as a consumer would describe it. */
type ExportKind =
  "class" | "enum" | "function" | "interface" | "namespace" | "type" | "variable" | "unknown";

interface ApiExport {
  readonly name: string;
  readonly kind: ExportKind;
  readonly type: string;
  readonly members: readonly string[];
}

interface Inventory {
  readonly $comment: string;
  readonly typescript: string;
  readonly exportCount: number;
  readonly exports: readonly ApiExport[];
}

/**
 * The entry points the package's `exports` names, each with the declarations it builds, the
 * inventory that records them and the specifier a consumer imports.
 */
const ENTRIES = {
  index: {
    declarations: "dist/index.d.ts",
    inventory: "release/public-api.json",
    specifier: "{{PKG}}",
    regenerate: "tsx scripts/api-surface.ts --write",
  },
} as const;

type EntryName = keyof typeof ENTRIES;

function isEntryName(value: string): value is EntryName {
  return Object.hasOwn(ENTRIES, value);
}

/** The note at the top of an entry's inventory: where it came from and how to regenerate it. */
function inventoryComment(entry: EntryName): string {
  const { declarations, regenerate, specifier } = ENTRIES[entry];
  return (
    `Generated by scripts/api-surface.ts from a fresh build's ${declarations}. ` +
    `Regenerate deliberately with \`${regenerate}\` and review the diff: ` +
    `this file is the written-down public type surface of ${specifier}.`
  );
}

/** An input the run needed and did not get. Distinct from drift, and exits 2. */
class MissingInputError extends Error {}

/* -------------------------------------------------------------------------------------------- */
/* Deriving the surface                                                                          */
/* -------------------------------------------------------------------------------------------- */

/**
 * Compiler options for reading a single bundled `.d.ts`. `skipLibCheck` keeps this from
 * type-checking the whole standard library on every run; nothing here depends on the declarations
 * being error-free, only on the checker being able to resolve their symbols.
 */
const COMPILER_OPTIONS: ts.CompilerOptions = {
  noEmit: true,
  target: ts.ScriptTarget.ES2023,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  skipLibCheck: true,
};

/** The repository root, where `fast-check`, the optional peer of `/arbitraries`, is installed. */
const REPO_ROOT = resolve(import.meta.dirname, "..");

/**
 * Where the declarations' package imports resolve. A subpath's declarations (`/arbitraries`) import
 * their types from `{{PKG}}` and `fast-check`. Read from a build in a folder outside the
 * repository, the two would resolve to nothing and every type naming them would print as `any`;
 * read from inside it, `{{PKG}}` would resolve to the repository's own `dist/`, not the build
 * under test. So `{{PKG}}` maps to the `index.d.ts` beside the declarations being read, and
 * `fast-check` to the copy installed at the repository root.
 */
function packagePaths(declarationsPath: string): ts.MapLike<string[]> {
  const paths: ts.MapLike<string[]> = {
    "{{PKG}}": [resolve(dirname(declarationsPath), "index.d.ts")],
  };
  const fastCheck = ts.resolveModuleName(
    "fast-check",
    resolve(REPO_ROOT, "package.json"),
    COMPILER_OPTIONS,
    ts.sys,
  ).resolvedModule?.resolvedFileName;
  if (fastCheck !== undefined) paths["fast-check"] = [fastCheck];
  return paths;
}

/**
 * `NoTruncation` only. The printer elides long types by default, and an elided type is a baseline
 * that silently stops distinguishing the things it was written to distinguish.
 */
const PRINT_FLAGS = ts.TypeFormatFlags.NoTruncation;

const SYMBOL_KINDS: readonly (readonly [ts.SymbolFlags, ExportKind])[] = [
  [ts.SymbolFlags.Class, "class"],
  [ts.SymbolFlags.Enum, "enum"],
  [ts.SymbolFlags.Function, "function"],
  [ts.SymbolFlags.Interface, "interface"],
  [ts.SymbolFlags.TypeAlias, "type"],
  [ts.SymbolFlags.ValueModule | ts.SymbolFlags.NamespaceModule, "namespace"],
  [ts.SymbolFlags.Variable, "variable"],
];

function kindOf(symbol: ts.Symbol): ExportKind {
  for (const [flags, kind] of SYMBOL_KINDS) {
    if ((symbol.flags & flags) !== 0) return kind;
  }
  return "unknown";
}

/** Resolve `export { x as y }` and re-exports down to the symbol that actually declares something. */
function resolveAlias(checker: ts.TypeChecker, symbol: ts.Symbol): ts.Symbol {
  return (symbol.flags & ts.SymbolFlags.Alias) === 0 ? symbol : checker.getAliasedSymbol(symbol);
}

function printType(checker: ts.TypeChecker, type: ts.Type, at: ts.Node | undefined): string {
  return checker.typeToString(type, at, PRINT_FLAGS);
}

/**
 * Whether a member is part of what a consumer receives.
 *
 * A `private` or `protected` class member is emitted into the declarations (the bundler writes
 * `private _cache;`, which the checker reads back as `any`) but no consumer can reach it, and
 * renaming one is not an API change. Including them would make an internal refactor read as public
 * drift, which trains a reviewer to regenerate the baseline without looking, and that is how a real
 * removal gets waved through. `#`-prefixed members are the same case in the other syntax.
 */
function isPublicMember(property: ts.Symbol): boolean {
  if (property.getName().startsWith("#")) return false;
  const hidden = ts.ModifierFlags.Private | ts.ModifierFlags.Protected;
  return (property.declarations ?? []).every(
    (declaration) => (ts.getCombinedModifierFlags(declaration) & hidden) === 0,
  );
}

/**
 * A member's name as a consumer writes it.
 *
 * A member keyed by a well-known symbol (`[Symbol.iterator]`) has an internal name of the form
 * `__@iterator@497`, and the trailing number is the checker's id for that symbol: it counts every
 * symbol created before it in the program, so it moves whenever the bundled declarations change
 * size or order, with no change to the API. tsup 9 renumbered every one of them. The checker's own
 * `symbolToString` prints the stable `[Symbol.iterator]` form, which is what this records; every
 * other name is kept exactly as `getName()` returns it.
 */
function memberName(checker: ts.TypeChecker, property: ts.Symbol): string {
  const name = property.getName();
  return name.startsWith("__@") ? checker.symbolToString(property) : name;
}

/** `name: Type` for each property of a type, `name?: Type` when the property is optional. */
function propertyLines(checker: ts.TypeChecker, type: ts.Type, prefix = ""): string[] {
  return checker
    .getPropertiesOfType(type)
    .filter(isPublicMember)
    .map((property) => {
      const declaration = property.declarations?.[0];
      const propertyType =
        declaration === undefined
          ? checker.getTypeOfSymbol(property)
          : checker.getTypeOfSymbolAtLocation(property, declaration);
      const optional = (property.flags & ts.SymbolFlags.Optional) === 0 ? "" : "?";
      return `${prefix}${memberName(checker, property)}${optional}: ${printType(checker, propertyType, declaration)}`;
    })
    .sort();
}

/**
 * The static side of a class, minus `prototype`. `prototype` is on every class and says nothing
 * about the API; every other static IS callable by a consumer and belongs in the baseline.
 */
function staticLines(checker: ts.TypeChecker, symbol: ts.Symbol): string[] {
  const declaration = symbol.declarations?.[0];
  if (declaration === undefined) return [];
  const constructorType = checker.getTypeOfSymbolAtLocation(symbol, declaration);
  return checker
    .getPropertiesOfType(constructorType)
    .filter((property) => property.getName() !== "prototype" && isPublicMember(property))
    .map((property) => {
      const propertyDeclaration = property.declarations?.[0];
      const propertyType =
        propertyDeclaration === undefined
          ? checker.getTypeOfSymbol(property)
          : checker.getTypeOfSymbolAtLocation(property, propertyDeclaration);
      return `static ${memberName(checker, property)}: ${printType(checker, propertyType, propertyDeclaration)}`;
    })
    .sort();
}

function describe(checker: ts.TypeChecker, exported: ts.Symbol): ApiExport {
  const symbol = resolveAlias(checker, exported);
  const kind = kindOf(symbol);
  const name = exported.getName();

  if (kind === "namespace") {
    return {
      name,
      kind,
      type: "",
      members: checker
        .getExportsOfModule(symbol)
        .map((member) => member.getName())
        .sort(),
    };
  }

  if (kind === "interface") {
    return {
      name,
      kind,
      type: "",
      members: propertyLines(checker, checker.getDeclaredTypeOfSymbol(symbol)),
    };
  }

  if (kind === "type") {
    const declared = checker.getDeclaredTypeOfSymbol(symbol);
    // A union alias is the shape that carries the stable identifiers a consumer switches on
    // (warning codes, finding codes, usage codes), so its constituents ARE the surface. Anything
    // else falls back to its properties.
    const members = declared.isUnion()
      ? declared.types.map((member) => printType(checker, member, undefined)).sort()
      : propertyLines(checker, declared);
    return { name, kind, type: "", members };
  }

  if (kind === "class") {
    return {
      name,
      kind,
      type: "",
      members: [
        ...propertyLines(checker, checker.getDeclaredTypeOfSymbol(symbol)),
        ...staticLines(checker, symbol),
      ].sort(),
    };
  }

  const declaration = symbol.declarations?.[0];
  const type =
    declaration === undefined
      ? ""
      : printType(checker, checker.getTypeOfSymbolAtLocation(symbol, declaration), declaration);
  return { name, kind, type, members: [] };
}

/**
 * Read a built `.d.ts` and return one entry per export, sorted by name.
 *
 * Every way of ending up with nothing throws `MissingInputError` rather than returning an empty
 * list: an absent file, an empty file, a file the compiler does not see as a module, and a module
 * whose export list is empty are all "the build did not give me a surface to compare", and none of
 * them is a verdict about the API.
 */
function deriveSurface(declarationsPath: string): ApiExport[] {
  let size: number;
  try {
    size = statSync(declarationsPath).size;
  } catch {
    throw new MissingInputError(
      `declarations not found at ${declarationsPath}. Build first (\`pnpm build\`), or pass --declarations.`,
    );
  }
  if (size === 0) {
    throw new MissingInputError(`declarations at ${declarationsPath} are empty (0 bytes).`);
  }

  const program = ts.createProgram([declarationsPath], {
    ...COMPILER_OPTIONS,
    paths: packagePaths(declarationsPath),
  });
  const source = program.getSourceFile(declarationsPath);
  if (source === undefined) {
    throw new MissingInputError(`TypeScript could not read declarations at ${declarationsPath}.`);
  }

  const checker = program.getTypeChecker();
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (moduleSymbol === undefined) {
    throw new MissingInputError(
      `declarations at ${declarationsPath} are not a module: they export nothing a consumer could import.`,
    );
  }

  const exports = checker.getExportsOfModule(moduleSymbol);
  if (exports.length === 0) {
    throw new MissingInputError(
      `declarations at ${declarationsPath} resolved to a module with no exports. ` +
        "Refusing to report an empty surface as a comparison result.",
    );
  }

  return exports
    .map((exported) => describe(checker, exported))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}

/* -------------------------------------------------------------------------------------------- */
/* Reading the committed inventory                                                                */
/* -------------------------------------------------------------------------------------------- */

function isApiExport(value: unknown): value is ApiExport {
  if (typeof value !== "object" || value === null) return false;
  const record: Record<string, unknown> = { ...value };
  return (
    typeof record["name"] === "string" &&
    typeof record["kind"] === "string" &&
    typeof record["type"] === "string" &&
    Array.isArray(record["members"]) &&
    record["members"].every((member) => typeof member === "string")
  );
}

function readInventory(inventoryPath: string): Inventory {
  let text: string;
  try {
    text = readFileSync(inventoryPath, "utf8");
  } catch {
    throw new MissingInputError(
      `inventory not found at ${inventoryPath}. Generate it with \`tsx scripts/api-surface.ts --write\`.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new MissingInputError(
      `inventory at ${inventoryPath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new MissingInputError(`inventory at ${inventoryPath} did not parse to an object.`);
  }
  const record: Record<string, unknown> = { ...parsed };
  const exports = record["exports"];
  const typescriptVersion = record["typescript"];
  if (!Array.isArray(exports) || !exports.every(isApiExport)) {
    throw new MissingInputError(
      `inventory at ${inventoryPath} has no usable \`exports\` list of {name, kind, type, members}.`,
    );
  }
  if (exports.length === 0) {
    throw new MissingInputError(
      `inventory at ${inventoryPath} records zero exports. An empty baseline can only ever agree ` +
        "with a build that produced nothing, so it is refused rather than compared.",
    );
  }
  if (typeof typescriptVersion !== "string") {
    throw new MissingInputError(`inventory at ${inventoryPath} records no \`typescript\` version.`);
  }

  return {
    $comment: typeof record["$comment"] === "string" ? record["$comment"] : "",
    typescript: typescriptVersion,
    exportCount: exports.length,
    exports,
  };
}

/* -------------------------------------------------------------------------------------------- */
/* Comparing                                                                                      */
/* -------------------------------------------------------------------------------------------- */

/** One line per difference, in a stable order, naming the export and what about it moved. */
function differences(committed: readonly ApiExport[], derived: readonly ApiExport[]): string[] {
  const before = new Map(committed.map((entry) => [entry.name, entry]));
  const after = new Map(derived.map((entry) => [entry.name, entry]));
  const names = [...new Set([...before.keys(), ...after.keys()])].sort();

  const lines: string[] = [];
  for (const name of names) {
    const was = before.get(name);
    const now = after.get(name);
    if (was === undefined && now !== undefined) {
      lines.push(`added:   ${name} (${now.kind})`);
      continue;
    }
    if (now === undefined && was !== undefined) {
      lines.push(`removed: ${name} (${was.kind})`);
      continue;
    }
    if (was === undefined || now === undefined) continue;
    if (was.kind !== now.kind) lines.push(`changed: ${name} kind ${was.kind} -> ${now.kind}`);
    if (was.type !== now.type)
      lines.push(`changed: ${name} type\n    was: ${was.type}\n    now: ${now.type}`);
    const gone = was.members.filter((member) => !now.members.includes(member));
    const fresh = now.members.filter((member) => !was.members.includes(member));
    for (const member of gone) lines.push(`changed: ${name} lost member ${member}`);
    for (const member of fresh) lines.push(`changed: ${name} gained member ${member}`);
  }
  return lines;
}

/* -------------------------------------------------------------------------------------------- */
/* CLI                                                                                            */
/* -------------------------------------------------------------------------------------------- */

interface Options {
  readonly entry: EntryName;
  readonly declarations: string;
  readonly inventory: string;
  readonly write: boolean;
}

class UsageError extends Error {}

function parseArgs(argv: readonly string[]): Options {
  let entry: EntryName = "index";
  let declarations: string | undefined;
  let inventory: string | undefined;
  let write = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--write") {
      write = true;
      continue;
    }
    if (arg === "--entry") {
      const value = argv[i + 1];
      if (value === undefined || !isEntryName(value)) {
        throw new UsageError(`--entry needs one of ${Object.keys(ENTRIES).join(", ")}`);
      }
      entry = value;
      i += 1;
      continue;
    }
    if (arg === "--declarations" || arg === "--inventory") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new UsageError(`${arg} needs a path`);
      }
      if (arg === "--declarations") declarations = value;
      else inventory = value;
      i += 1;
      continue;
    }
    throw new UsageError(`unrecognized argument ${String(arg)}`);
  }

  return {
    entry,
    declarations: resolve(declarations ?? ENTRIES[entry].declarations),
    inventory: resolve(inventory ?? ENTRIES[entry].inventory),
    write,
  };
}

function main(argv: readonly string[]): number {
  let options: Options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(
      `REFUSED: api-surface - ${error instanceof Error ? error.message : String(error)}`,
    );
    console.error(
      `Usage: tsx scripts/api-surface.ts [--entry ${Object.keys(ENTRIES).join("|")}] [--declarations <path>] [--inventory <path>] [--write]`,
    );
    return 2;
  }

  let derived: ApiExport[];
  try {
    derived = deriveSurface(options.declarations);
  } catch (error) {
    if (error instanceof MissingInputError) {
      console.error(`REFUSED: api-surface - inputs missing. ${error.message}`);
      return 2;
    }
    throw error;
  }

  if (options.write) {
    const inventory: Inventory = {
      $comment: inventoryComment(options.entry),
      typescript: ts.version,
      exportCount: derived.length,
      exports: derived,
    };
    writeFileSync(options.inventory, `${JSON.stringify(inventory, null, 2)}\n`);
    console.log(`api-surface: wrote ${String(derived.length)} exports to ${options.inventory}`);
    return 0;
  }

  let committed: Inventory;
  try {
    committed = readInventory(options.inventory);
  } catch (error) {
    if (error instanceof MissingInputError) {
      console.error(`REFUSED: api-surface - inputs missing. ${error.message}`);
      return 2;
    }
    throw error;
  }

  const lines = differences(committed.exports, derived);
  const versionDrift = committed.typescript !== ts.version;

  if (lines.length === 0 && !versionDrift) {
    console.log(
      `OK: public export surface matches ${options.inventory} (${String(derived.length)} exports)`,
    );
    return 0;
  }

  console.error(`DRIFT: the public export surface does not match ${options.inventory}.`);
  if (versionDrift) {
    console.error(
      `  the inventory was derived under TypeScript ${committed.typescript}; this run used ${ts.version}. ` +
        "Entries are printed by the type checker, so regenerate deliberately after reviewing the diff.",
    );
  }
  for (const line of lines) console.error(`  ${line}`);
  console.error(
    "Nothing was rewritten. If every difference above is intended, regenerate the inventory with " +
      `\`${ENTRIES[options.entry].regenerate}\` and commit it with the change that caused it.`,
  );
  return 1;
}

process.exit(main(process.argv.slice(2)));
