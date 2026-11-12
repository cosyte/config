// @cosyte/script-utils/release-pr
//
// THE RELEASE PULL REQUEST CHECK: a library's "Version Packages" pull request must pass its own
// checks, and a changeset must not wedge the release that consumes it.
//
// Three defects reached our libraries' release pull requests, each after the change that caused it
// had merged green, and each was fixed by hand in its own repository:
//
//   version-test      The mutation run on a Version Packages pull request mutates the exported
//                     `VERSION` string, and no test it links to that line pinned it to package.json.
//                     `VERSION` is set once, when its module is first evaluated, and the mutation run
//                     links a mutant only to the tests that run while its line is evaluated. A test
//                     file with a static import of the source evaluates it before any test starts, so
//                     the mutant survives however exactly a test compares it. What works: a test file
//                     with no static import of the source, that resets the module cache
//                     (`vi.resetModules()`) and then imports the source inside the test body, and
//                     compares `VERSION` with package.json's version. The rule is an allow list: the
//                     file is parsed with the TypeScript compiler, it passes only in a shape the rule
//                     recognises, and anything it cannot classify (a module mock, a load it cannot
//                     follow, a helper referred to other than by a direct call from a test body) is a
//                     finding, not a pass.
//   version-script    The version script did not regenerate the generated API reference, which prints
//                     `VERSION`, so the Version Packages pull request failed the reference's own
//                     drift check. The script runs `changeset version`, then the `VERSION` sync, then
//                     `cosyte-docs-reference`, in that order.
//   changeset-bullet  A changeset's opening sentence becomes one bullet of the GitHub release, and
//                     the shared release workflow refuses a bullet over 400 characters. It refuses it
//                     at release time, after the Version Packages pull request has merged and
//                     consumed the changeset, so recovery is a revert. This reads the pending
//                     changesets on the pull request that adds them, before they can merge.
//
// And one rule beside the last: `changeset-shape`, a changeset the release workflow cannot read once
// the Version Packages pull request has consumed it: no front matter block, an empty one (the file
// `changeset add --empty` writes, `---` then `---`), a front matter line that names no package and
// bump, or a release with no summary. The front matter is read with the release tooling's own pattern.
//
// THE BULLET IS MEASURED AS AN UPPER BOUND, conservatively, not by repeating the release's rewrites.
// The release workflow measures the sentence after them. Removing an internal reference only
// shortens it. Three rewrites can lengthen it: an em dash becomes ": " or ", " (one more each), our
// word "slice" becomes "change" (one more each), and a parenthetical holding an internal reference is
// rebuilt as ` (a, b)`, with a space before it where there was none (one more per parenthetical) and
// ", " where the author wrote a bare comma (one more per comma inside it). So the bound is the
// sentence's length plus one for each em dash, each "slice" (inside a word too), each innermost
// parenthetical and each comma inside one. A sentence this passes, the release passes on length; the
// release can pass a few this refuses, and those carry commas in parentheses or an internal reference
// that a few characters less would fit.
//
// WHAT IT DOES NOT DO. It reads text, so it cannot tell that a test it accepts runs, or that its
// assertion is right: the test's own run does that. It does not read the release workflow's other
// refusals (internal identifiers, phase language), and it does not check the API reference itself:
// `cosyte-docs-reference --check` does.
//
// EXIT CODES, the contract every gate here keeps: 0 clean, 1 at least one finding, 2 the check could
// not read its input (no package.json, an unreadable file, an argument it does not know).
//
// ZERO DEPENDENCIES AND NO BUILD STEP, like the rest of this package. The TypeScript compiler the
// version-test rule parses with is the checked library's own: from its root, else through
// `@cosyte/process` (which depends on it), else from wherever this package is installed. The command
// line is the bin `cosyte-release-pr`.

import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The longest release bullet the shared release workflow publishes, in characters. */
export const RELEASE_BULLET_LIMIT = 400;

/** Every rule id, with what it requires. */
export const RELEASE_PR_RULES = Object.freeze({
  "version-script":
    "the version script runs `changeset version`, then the VERSION sync, then `cosyte-docs-reference`",
  "version-test":
    "a test file that mocks no module and loads the source only in a test body, after resetting the " +
    "module cache, compares VERSION with package.json",
  "changeset-bullet": `a changeset opens with a sentence of at most ${RELEASE_BULLET_LIMIT} characters`,
  "changeset-shape":
    "a changeset has a front matter block that is not empty, names a package and bump on each line, " +
    "and has a summary when it releases a package",
});

const EM_DASH = String.fromCodePoint(0x2014);

/** The folders tests are read from, relative to the package root. */
const TEST_DIRS = ["test", "src"];

/** A test file: `*.test.*` or `*.spec.*`, in TypeScript or JavaScript. */
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]s$/;

/** A source file under `src/`: TypeScript or JavaScript, not a declaration file. */
const SOURCE_FILE = /\.[cm]?[jt]s$/;

/**
 * One finding.
 *
 * @param {keyof typeof RELEASE_PR_RULES} rule
 * @param {string} file
 * @param {string} message
 */
function finding(rule, file, message) {
  return { rule, file, message };
}

/**
 * The steps of a package script, split on `&&`, with a step that runs another script of the same
 * package (`pnpm <name>`, `pnpm run <name>`, `npm run <name>`) replaced by that script's steps.
 *
 * @param {string} body The script.
 * @param {Record<string, unknown>} scripts The package's scripts.
 * @param {Set<string>} [seen] Scripts already being expanded, so a cycle stops.
 * @returns {string[]} The steps, trimmed, empty ones left out.
 */
export function scriptSteps(body, scripts, seen = new Set()) {
  const steps = [];
  for (const raw of String(body).split("&&")) {
    const step = raw.trim();
    if (step === "") continue;
    const call = /^(?:pnpm(?: run)?|npm run) (\S+)$/.exec(step);
    const name = call?.[1];
    if (name !== undefined && typeof scripts[name] === "string" && !seen.has(name)) {
      steps.push(...scriptSteps(scripts[name], scripts, new Set([...seen, name])));
    } else {
      steps.push(step);
    }
  }
  return steps;
}

/**
 * The `version-script` rule over a package's scripts.
 *
 * @param {Record<string, unknown>} scripts The package's scripts.
 * @returns {Array<{rule: string, file: string, message: string}>} One finding per gap.
 */
export function checkVersionScript(scripts) {
  const body = scripts.version;
  if (typeof body !== "string") {
    return [
      finding(
        "version-script",
        "package.json",
        'no "version" script. The release workflow runs it to make the Version Packages pull ' +
          `request; it must run ${RELEASE_PR_RULES["version-script"]}.`,
      ),
    ];
  }
  const steps = scriptSteps(body, scripts);
  const bump = steps.findIndex((s) => /^changeset version(?:\s|$)/.test(s));
  const sync = steps.findIndex((s) => /sync-version/.test(s));
  const docs = steps.findIndex(
    (s) => /^cosyte-docs-reference(?:\s|$)/.test(s) && !/\s--check(?:[=\s]|$)/.test(s),
  );
  const found = [];
  const say = (message) => found.push(finding("version-script", "package.json", message));
  if (bump < 0) say("the version script never runs `changeset version`, which bumps the version.");
  if (sync < 0) {
    say(
      "the version script never syncs VERSION from package.json (`cosyte-process sync-version`), " +
        "so the Version Packages pull request ships a VERSION that names the old release.",
    );
  } else if (bump >= 0 && sync < bump) {
    say("the version script syncs VERSION before `changeset version` has bumped package.json.");
  }
  if (docs < 0) {
    say(
      "the version script never regenerates the API reference (`cosyte-docs-reference`, without " +
        "--check), so the reference page that prints VERSION is stale on the Version Packages " +
        "pull request.",
    );
  } else if (sync >= 0 && docs < sync) {
    say("the version script regenerates the API reference before VERSION is synced; run it after.");
  }
  return found;
}

/**
 * Whether a module's text declares an exported `VERSION` constant at the start of a line.
 *
 * @param {string} text The module's text.
 * @returns {boolean}
 */
export function declaresVersion(text) {
  return /^export const VERSION\b/m.test(String(text));
}

/**
 * Whether a relative import specifier, written in the file at `path`, points at the source folder.
 *
 * @param {string} path The importing file, relative to the package root, with `/` separators.
 * @param {string} specifier The specifier, `.` or `..` or starting with `./` or `../`.
 * @returns {boolean}
 */
function intoSource(path, specifier) {
  const target = posix.normalize(posix.join(posix.dirname(path), specifier));
  return target === "src" || target.startsWith("src/");
}

/** This module's own path: the last place the TypeScript compiler is looked for. */
const HERE = fileURLToPath(import.meta.url);

/**
 * The TypeScript compiler the version-test rule parses with: the package's own, else the one
 * `@cosyte/process` depends on (a scaffold lists no `typescript` of its own), else one resolvable
 * from each of `fallbacks`.
 *
 * @param {string} root The package root.
 * @param {string[]} [fallbacks] Further paths to resolve from; this module's own by default.
 * @returns {any} The `typescript` module.
 * @throws {Error} When none of them resolves it.
 */
export function loadTypeScript(root, fallbacks = [HERE]) {
  const manifest = join(resolve(root), "package.json");
  const bases = [manifest];
  try {
    bases.push(createRequire(manifest).resolve("@cosyte/process/package.json"));
  } catch {
    // No @cosyte/process here: the other places are tried.
  }
  for (const base of [...bases, ...fallbacks]) {
    try {
      return createRequire(base)("typescript");
    } catch {
      // Not resolvable from this place: the next one is tried.
    }
  }
  throw new Error(
    "the version-test rule parses test files with the TypeScript compiler, and the typescript " +
      "package could not be found from the package, its @cosyte/process or @cosyte/script-utils. " +
      "Add typescript to devDependencies.",
  );
}

/** The literal text of a string or plain template literal node, else undefined. */
function literalText(ts, node) {
  if (
    node !== undefined &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
  ) {
    return node.text;
  }
  return undefined;
}

/** The names the test runners give their mocker: `vi`, its alias `vitest`, and `jest`. */
const MOCKERS = new Set(["vi", "vitest", "jest"]);

/** The mocker calls that cannot replace or skip a module, the only ones a VERSION test may make. */
const MOCKER_CALLS = new Set([
  "resetModules",
  "doUnmock",
  "unmock",
  "fn",
  "spyOn",
  "restoreAllMocks",
  "clearAllMocks",
  "resetAllMocks",
  "useFakeTimers",
  "useRealTimers",
  "isMockFunction",
  "unstubAllGlobals",
  "unstubAllEnvs",
]);

/** The mocker calls that replace a module: accepted only with a pass-through factory. */
const MOCK_CALLS = new Set(["mock", "doMock"]);

/** The modifiers of `it`, `test` and `describe` under which the callback still runs. */
const RUN_MODIFIERS = new Set(["each", "concurrent", "sequential"]);

/** The names that register a test, and a suite. */
const TESTS = new Set(["it", "test"]);
const SUITES = new Set(["describe", "suite"]);

/** Names that load or run code by a route the check cannot follow. */
const LOADERS = new Set(["require", "createRequire", "eval", "Function"]);

/** The `import.meta` properties that load nothing. */
const META = new Set(["url", "dirname", "filename", "env", "resolve"]);

/** The modules whose namespace carries the mocker. */
const RUNNER_MODULES = new Set(["vitest", "@jest/globals"]);

/** A package specifier: a name or a scoped name, then any subpath. */
const PACKAGE_SPECIFIER = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(?:\/.*)?$/i;

/**
 * What a module specifier, written in the file at `path`, names: `source` (under `src/`), `data` (a
 * JSON file, which runs nothing), `package` (a built-in or a package), `local` (another file of the
 * repository), or `unknown` (no literal, or a specifier an alias may point anywhere: `#x`, `/x`,
 * `@/x`, `src/x`).
 *
 * @param {string} path The importing file.
 * @param {string | undefined} specifier The specifier, or undefined when it is not a literal.
 * @returns {"source" | "data" | "package" | "local" | "unknown"}
 */
function specifierKind(path, specifier) {
  if (specifier === undefined) return "unknown";
  if (specifier.endsWith(".json")) return "data";
  if (specifier.startsWith("node:")) return "package";
  if (/^\.\.?(?:\/|$)/.test(specifier)) return intoSource(path, specifier) ? "source" : "local";
  if (PACKAGE_SPECIFIER.test(specifier) && !/^src(?:\/|$)/.test(specifier)) return "package";
  return "unknown";
}

/** A source path without its extension, `src` itself read as `src/index`. */
function sourceKey(target) {
  const bare = target.replace(/\.[cm]?[jt]sx?$/, "");
  return bare === "src" ? "src/index" : bare;
}

/**
 * The callee chain of a call: the identifier it starts from and the property names after it, so
 * `it.each([1])("x", fn)` is `it` with `each`.
 */
function calleeChain(ts, call) {
  const modifiers = [];
  let callee = call.expression;
  for (;;) {
    if (ts.isPropertyAccessExpression(callee)) {
      modifiers.push(callee.name.text);
      callee = callee.expression;
    } else if (ts.isCallExpression(callee)) {
      callee = callee.expression;
    } else {
      break;
    }
  }
  return { root: ts.isIdentifier(callee) ? callee.text : undefined, modifiers };
}

/** The line, from 1, a node starts on. */
function lineOf(file, node) {
  return file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
}

/** The function a declaration names: `function f() {}`, `const f = () => {}`, or none. */
function namedFunction(ts, node) {
  if (ts.isFunctionDeclaration(node) && node.name !== undefined && node.body !== undefined) {
    return { name: node.name.text, fn: node, nameNode: node.name };
  }
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.initializer !== undefined
  ) {
    const init = node.initializer;
    if (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
      return { name: node.name.text, fn: init, nameNode: node.name };
  }
  return undefined;
}

/**
 * Whether a mock call's factory hands back the real module unchanged: `(importOriginal) =>
 * importOriginal()`, awaited or not, as an expression body or as the one `return` that ends a block.
 * Its parameter is used nowhere else, so it cannot be swapped for a stand-in. Then the mocked module
 * is still evaluated, and a test that counts the evaluations (mllp's) may use it.
 */
function passThroughMock(ts, call) {
  const factory = call.arguments[1];
  if (call.arguments.length !== 2 || factory === undefined) return false;
  if (!ts.isArrowFunction(factory) && !ts.isFunctionExpression(factory)) return false;
  const [param, ...rest] = factory.parameters;
  if (param === undefined || rest.length > 0 || !ts.isIdentifier(param.name)) return false;
  if (param.dotDotDotToken !== undefined || param.initializer !== undefined) return false;
  const name = param.name.text;
  let uses = 0;
  let returns = 0;
  const count = (node) => {
    if (ts.isIdentifier(node) && node.text === name) uses += 1;
    if (ts.isReturnStatement(node)) returns += 1;
    ts.forEachChild(node, count);
  };
  count(factory);
  const original = (node) => {
    let e = node;
    while (e !== undefined && (ts.isAwaitExpression(e) || ts.isParenthesizedExpression(e))) {
      e = e.expression;
    }
    return (
      e !== undefined &&
      ts.isCallExpression(e) &&
      ts.isIdentifier(e.expression) &&
      e.expression.text === name &&
      e.arguments.length === 0
    );
  };
  if (uses !== 2) return false;
  if (!ts.isBlock(factory.body)) return returns === 0 && original(factory.body);
  const last = factory.body.statements.at(-1);
  return (
    returns === 1 && last !== undefined && ts.isReturnStatement(last) && original(last.expression)
  );
}

/**
 * What one test file lacks to pin VERSION through a fresh import. Empty when it does.
 *
 * An allow list: the file passes only in a shape the check recognises, and what it cannot classify
 * is a gap, not a pass. The file is parsed, so a comment or a string satisfies nothing.
 *
 * - Nothing mocks or stubs a module: no `vi.mock`, `vi.doMock`, `vi.hoisted`, `vi.stubGlobal` or
 *   their `jest` equivalents, and the mocker is used only as `vi.<call>(...)` with a call that cannot
 *   replace a module. The one mock accepted hands back the real module unchanged.
 * - Every load is classified: a static import is type-only, of a package or of JSON; a dynamic
 *   import or `require()` has a literal specifier; nothing loads through `createRequire`, `eval`,
 *   `import.meta.glob` or an alias (`#x`, `@/x`).
 * - The source is loaded only by a dynamic import after `vi.resetModules()` in the same test body:
 *   the callback of an `it` or `test` call that runs, or a named function every reference to which
 *   is a direct call from such a body. An alias, `.call`, a name passed to a hook or anything else,
 *   a second function of the same name, or a call at module load each disqualifies the function.
 * - One such body imports the module that declares VERSION (`src/index` by default) and reads
 *   `VERSION`, and the file reads package.json.
 *
 * @param {string} path The test file, relative to the package root, with `/` separators.
 * @param {string} text Its text.
 * @param {any} [ts] The TypeScript compiler; found from this module when not given.
 * @param {string[]} [versionModules] The source files that declare VERSION, which a fresh import
 *   may name besides `src/index`.
 * @returns {string[]} One sentence per gap.
 */
export function freshVersionTestGaps(
  path,
  text,
  ts = loadTypeScript(process.cwd()),
  versionModules = [],
) {
  const kind = /\.[cm]?ts$/.test(path) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const file = ts.createSourceFile(path, String(text), ts.ScriptTarget.Latest, true, kind);
  const entries = new Set(["src/index", ...versionModules.map(sourceKey)]);
  let staticLine = 0;
  let readsManifest = false;
  /** Lines that mock, stub or use the mocker unrecognised, and lines that load unclassified. */
  const mocks = [];
  const unknown = [];
  /** The test callbacks that run. */
  const tests = new Set();
  /** The named functions. */
  const helpers = [];
  /** Every identifier, with the unit it sits in. */
  const idents = [];
  /** Per unit (a test callback, a named function, or null for anything else): what it does. */
  const units = new Map();
  const unitOf = (unit) => {
    if (!units.has(unit)) units.set(unit, { resets: [], loads: [], version: false });
    return units.get(unit);
  };
  const at = (node) => `line ${lineOf(file, node)}`;

  /** A static load: an import, an export from, or `import x = require()`. */
  const staticLoad = (node, specifierNode) => {
    const kind = specifierKind(path, literalText(ts, specifierNode));
    if (kind === "source") staticLine ||= lineOf(file, node);
    else if (kind === "local" || kind === "unknown") unknown.push(at(node));
  };

  /** The mocker named by an identifier: fine only as `vi.<call>(...)` or `import { vi }`. */
  const mockerUse = (node) => {
    const parent = node.parent;
    if (ts.isImportSpecifier(parent)) {
      if (parent.propertyName !== undefined) mocks.push(`${at(node)}: ${node.text} renamed`);
      return;
    }
    if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
      const member = parent.name.text;
      const call = parent.parent;
      const called = ts.isCallExpression(call) && call.expression === parent;
      if (called && MOCKER_CALLS.has(member)) return;
      if (called && MOCK_CALLS.has(member) && passThroughMock(ts, call)) return;
      mocks.push(`${at(node)}: ${node.text}.${member}`);
      return;
    }
    mocks.push(`${at(node)}: ${node.text}`);
  };

  const visit = (node, unit, dead) => {
    if (literalText(ts, node)?.endsWith("package.json")) readsManifest = true;
    const named = namedFunction(ts, node);
    if (named !== undefined) {
      // A named function is its own unit: what it does counts where it is called from.
      helpers.push({ ...named, decl: node });
      // The name of `const f = () => {}` is outside the function: kept, so a second `f` is seen.
      if (named.fn !== node) idents.push({ node: named.nameNode, unit });
      ts.forEachChild(named.fn, (child) => visit(child, named.fn, dead));
      return;
    }
    if (ts.isIdentifier(node)) {
      idents.push({ node, unit });
      if (node.text === "VERSION") unitOf(unit).version = true;
      if (MOCKERS.has(node.text)) mockerUse(node);
      const parent = node.parent;
      const directRequire =
        node.text === "require" && ts.isCallExpression(parent) && parent.expression === node;
      if (LOADERS.has(node.text) && !directRequire) unknown.push(`${at(node)}: ${node.text}`);
      return;
    }
    if (ts.isImportDeclaration(node)) {
      if (!node.importClause?.isTypeOnly) staticLoad(node, node.moduleSpecifier);
      const bindings = node.importClause?.namedBindings;
      const runner = literalText(ts, node.moduleSpecifier);
      if (bindings && ts.isNamespaceImport(bindings) && RUNNER_MODULES.has(runner)) {
        mocks.push(`${at(node)}: a namespace import of ${runner}`);
      }
    } else if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier) {
      staticLoad(node, node.moduleSpecifier);
    } else if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly) {
      const ref = node.moduleReference;
      if (ts.isExternalModuleReference(ref)) staticLoad(node, ref.expression);
    } else if (
      ts.isPropertyAccessExpression(node) &&
      ts.isMetaProperty(node.expression) &&
      node.expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
      !META.has(node.name.text)
    ) {
      unknown.push(`${at(node)}: import.meta.${node.name.text}`);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const dynamic = callee.kind === ts.SyntaxKind.ImportKeyword;
      const required = ts.isIdentifier(callee) && callee.text === "require";
      if (dynamic || required) {
        const specifier = literalText(ts, node.arguments[0]);
        const kind = specifierKind(path, specifier);
        if (dynamic && kind === "source") {
          const target = posix.normalize(posix.join(posix.dirname(path), specifier));
          unitOf(unit).loads.push({
            at: node.getStart(file),
            line: lineOf(file, node),
            entry: entries.has(sourceKey(target)),
          });
        } else if (kind !== "package" && kind !== "data") {
          unknown.push(at(node));
        }
      }
      if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        MOCKERS.has(callee.expression.text) &&
        callee.name.text === "resetModules"
      ) {
        unitOf(unit).resets.push(node.getStart(file));
      }
      const chain = calleeChain(ts, node);
      const runs = chain.modifiers.every((m) => RUN_MODIFIERS.has(m));
      if (TESTS.has(chain.root)) {
        const live = !dead && runs;
        visit(callee, unit, dead);
        for (const arg of node.arguments) {
          if (live && (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg))) {
            tests.add(arg);
            visit(arg, arg, dead);
          } else {
            visit(arg, unit, dead);
          }
        }
        return;
      }
      if (SUITES.has(chain.root) && !runs) {
        ts.forEachChild(node, (child) => visit(child, unit, true));
        return;
      }
    }
    ts.forEachChild(node, (child) => visit(child, unit, dead));
  };
  visit(file, null, false);

  // Each reference to a named function that is not its own name: a direct call (`f()`), or anything
  // else. A member name (`x.f`) is another binding and is left out.
  const references = (helper) =>
    idents.filter(
      ({ node }) =>
        node.text === helper.name &&
        node !== helper.nameNode &&
        !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node),
    );
  const exported = (helper) =>
    (ts.getCombinedModifierFlags(helper.decl) & ts.ModifierFlags.Export) !== 0;
  const directCall = ({ node }) =>
    ts.isCallExpression(node.parent) && node.parent.expression === node;

  // A named function runs in a test when it is not exported, is referred to at least once, and every
  // reference is a direct call from a test body or from a named function already known to.
  const inTest = new Set(tests);
  for (let grew = true; grew;) {
    grew = false;
    for (const helper of helpers) {
      if (inTest.has(helper.fn) || exported(helper)) continue;
      const refs = references(helper);
      if (refs.length > 0 && refs.every((r) => directCall(r) && inTest.has(r.unit))) {
        inTest.add(helper.fn);
        grew = true;
      }
    }
  }

  const gaps = [];
  const inside = [...units].filter(([unit]) => inTest.has(unit)).map(([, u]) => u);
  const outside = [...units]
    .filter(([unit]) => !inTest.has(unit))
    .flatMap(([, u]) => u.loads.map((l) => l.line));
  const loads = inside.flatMap((u) => u.loads.map((l) => ({ ...l, unit: u })));
  const stale = loads.filter((l) => !l.unit.resets.some((r) => r < l.at));
  const freshUnits = inside.filter((u) =>
    u.loads.some((l) => l.entry && u.resets.some((r) => r < l.at)),
  );
  if (!inside.some((u) => u.version)) gaps.push("it never reads VERSION in a test body");
  else if (freshUnits.length > 0 && !freshUnits.some((u) => u.version)) {
    gaps.push("it never reads VERSION in the test body that imports the source afresh");
  }
  if (!readsManifest) gaps.push("it never reads package.json");
  if (staticLine > 0) {
    gaps.push(
      `it imports the source statically (line ${staticLine}), so the module is evaluated before ` +
        "any test runs and the mutation run links the VERSION line to no test",
    );
  }
  if (mocks.length > 0) {
    gaps.push(
      `it mocks or stubs a module, or uses the mocker in a way the check does not recognise ` +
        `(${mocks.join(", ")}), so the source it imports may never be evaluated; the one mock ` +
        "accepted is a pass-through, `vi.doMock(path, (importOriginal) => importOriginal())`",
    );
  }
  if (unknown.length > 0) {
    gaps.push(
      `it loads code the check cannot classify (${unknown.join(", ")}), which may evaluate the ` +
        "source outside a test body; import packages, built-in modules and JSON statically, and the " +
        "source only dynamically, each with a literal specifier",
    );
  }
  for (const helper of helpers) {
    if (inTest.has(helper.fn) || (units.get(helper.fn)?.loads.length ?? 0) === 0) continue;
    const bad = references(helper).filter((r) => !directCall(r) || !inTest.has(r.unit));
    if (exported(helper)) bad.unshift({ node: helper.nameNode });
    if (bad.length === 0) continue;
    gaps.push(
      `it refers to ${helper.name} other than by a direct call from a test body ` +
        `(${[...new Set(bad.map((r) => at(r.node)))].join(", ")}), so the function may run outside ` +
        "a test",
    );
  }
  if (outside.length > 0) {
    gaps.push(
      `it loads the source outside a test body (line ${outside.sort((a, b) => a - b).join(", line ")}), ` +
        "so the module is evaluated while the file is collected or not in a test",
    );
  }
  if (loads.length === 0) {
    gaps.push(
      "it has no dynamic import of the source inside a test body, " +
        '`await import("../src/index.js")` in an `it` or `test` callback',
    );
  } else if (stale.length > 0) {
    gaps.push(
      "it does not call `vi.resetModules()` before its dynamic import of the source, in the same " +
        `test body (line ${stale.map((l) => l.line).join(", line ")})`,
    );
  } else if (freshUnits.length === 0) {
    gaps.push(
      "it imports afresh only other modules under src, not `src/index` or the module that " +
        "declares VERSION",
    );
  }
  return gaps;
}

/**
 * The `version-test` rule over a package's test files: at least one must pin VERSION through a
 * fresh import.
 *
 * @param {Array<{path: string, text: string}>} tests The test files.
 * @param {any} [ts] The TypeScript compiler; found from this module when not given.
 * @param {string[]} [versionModules] The source files that declare VERSION.
 * @returns {Array<{rule: string, file: string, message: string}>} No finding, or one.
 */
export function checkVersionTests(tests, ts = loadTypeScript(process.cwd()), versionModules = []) {
  const readers = [];
  for (const test of tests) {
    const gaps = freshVersionTestGaps(test.path, test.text, ts, versionModules);
    if (gaps.length === 0) return [];
    if (/\bVERSION\b/.test(test.text)) readers.push(`${test.path}: ${gaps.join("; ")}`);
  }
  const named =
    readers.length === 0
      ? "No test file reads VERSION."
      : `The test files that read VERSION, and what each lacks:\n    ${readers.join("\n    ")}`;
  return [
    finding(
      "version-test",
      "test/",
      "no test pins VERSION to package.json where the mutation run can link it, so the mutant " +
        "that changes VERSION survives on the Version Packages pull request. Add a test file with " +
        "no static import of the source that calls `vi.resetModules()`, then imports the source " +
        `inside the test body and compares VERSION with package.json's version. ${named}`,
    ),
  ];
}

/**
 * The first sentence of a changeset's summary, flattened to one line: the text the release workflow
 * makes a bullet of. The same reading as the release workflow's own, so the two agree on where the
 * sentence ends.
 *
 * @param {string} summary The changeset's text after its front matter.
 * @returns {string}
 */
export function openingSentence(summary) {
  let t = String(summary).trim().split(/\s+/).join(" ");
  t = t.replace(/^\*\*(.+?)\*\*[.:]?\s*/, "$1. ");
  const sentence = /^(.+?[.!?]\*{0,2})(\s|$)/.exec(t);
  const kept = (sentence ? sentence[1] : t).trim();
  // The trailing full stops come off by a scan, not by `/\.+$/`, which backtracks on a long run of
  // full stops that does not end the text.
  let end = kept.length;
  while (end > 0 && kept[end - 1] === ".") end -= 1;
  return kept.slice(0, end);
}

/**
 * The most characters the release workflow's bullet for this sentence can have: its length, plus one
 * for each em dash, each "slice" or "slices" (inside a longer word too), each innermost parenthetical
 * and each comma inside one, the rewrites that lengthen it.
 *
 * @param {string} sentence The opening sentence.
 * @returns {number}
 */
export function bulletLengthBound(sentence) {
  const text = String(sentence);
  const dashes = text.split(EM_DASH).length - 1;
  const slices = (text.match(/slices?\b/gi) ?? []).length;
  let parentheticals = 0;
  // The release's own pattern for a parenthetical: an innermost one, with no parenthesis inside.
  for (const m of text.matchAll(/\(([^()]*)\)/g)) parentheticals += 1 + m[1].split(",").length - 1;
  return text.length + dashes + slices + parentheticals;
}

/** A front matter line the release reads: a package name, a colon and a bump, either quoted. */
const RELEASE_LINE = /^["']?(@?[^"':]+)["']?\s*:\s*["']?([A-Za-z]+)["']?$/;

/**
 * The `changeset-bullet` and `changeset-shape` rules over one changeset.
 *
 * @param {string} path The changeset, relative to the package root.
 * @param {string} text Its text.
 * @returns {Array<{rule: string, file: string, message: string}>}
 */
export function checkChangeset(path, text) {
  const normalized = String(text).replace(/\r\n/g, "\n");
  const shape = (message) => [finding("changeset-shape", path, message)];
  // The release tooling's own pattern, so the two agree on what a front matter block is.
  const front = /^---\n([\s\S]*?)\n---\n?/.exec(normalized);
  if (front === null) {
    if (/^---\n---(?:\n|$)/.test(normalized)) {
      return shape(
        "its front matter block is empty (`---` then `---`, the file `changeset add --empty` " +
          "writes), and the release refuses it once the Version Packages pull request has consumed " +
          "it. A change that releases no package gets no changeset at all; a repository-level note " +
          "goes in the root CHANGELOG.md.",
      );
    }
    return shape(
      "no front matter block (`---` lines naming each package and its bump), so it is not a " +
        "changeset the release can read.",
    );
  }
  const releases = front[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
  for (const line of releases) {
    const entry = RELEASE_LINE.exec(line);
    if (entry === null) {
      return shape(
        `the front matter line ${JSON.stringify(line)} is not a package and its bump ` +
          '(`"@cosyte/<package>": patch`), and the release refuses it.',
      );
    }
    if (!["major", "minor", "patch"].includes(entry[2].toLowerCase())) {
      return shape(
        `the bump ${JSON.stringify(entry[2])} is not major, minor or patch, and the release ` +
          "refuses it.",
      );
    }
  }
  if (releases.length === 0) return [];
  const summary = normalized.slice(front[0].length).trim();
  if (summary === "") {
    return [
      finding(
        "changeset-shape",
        path,
        "it releases a package and its summary is empty, and the release refuses a change it " +
          "cannot describe.",
      ),
    ];
  }
  const bound = bulletLengthBound(openingSentence(summary));
  if (bound <= RELEASE_BULLET_LIMIT) return [];
  return [
    finding(
      "changeset-bullet",
      path,
      `its opening sentence becomes a release bullet of up to ${bound} characters, and the release ` +
        `refuses a bullet over ${RELEASE_BULLET_LIMIT}, so it is ${bound - RELEASE_BULLET_LIMIT} ` +
        "over. It refuses it after the Version Packages pull request has merged, when the fix is a " +
        `revert. Open the changeset with a sentence of at most ${RELEASE_BULLET_LIMIT} characters ` +
        "saying what changed for a reader, and move the detail into the paragraphs after it.",
    ),
  ];
}

/**
 * Every rule over a package's input.
 *
 * @param {{scripts: Record<string, unknown>, declaresVersion: boolean, versionModules?: string[],
 *   tests: Array<{path: string, text: string}>, changesets: Array<{path: string, text: string}>}} input
 * @param {any} [ts] The TypeScript compiler; found from this module when not given and needed.
 * @returns {Array<{rule: string, file: string, message: string}>}
 */
export function checkReleasePr(input, ts) {
  const found = [];
  if (input.declaresVersion) {
    found.push(
      ...checkVersionScript(input.scripts),
      ...checkVersionTests(input.tests, ts, input.versionModules),
    );
  }
  for (const c of input.changesets) found.push(...checkChangeset(c.path, c.text));
  return found;
}

/**
 * Every file under a folder whose name matches, as package-relative paths with `/` separators,
 * sorted. A missing folder is empty; `node_modules` and symbolic links are not followed.
 *
 * @param {string} root The package root.
 * @param {string} rel The folder, relative to it.
 * @param {RegExp} pattern Which file names to keep.
 * @returns {string[]}
 */
function filesUnder(root, rel, pattern) {
  let stat;
  try {
    stat = lstatSync(join(root, rel));
  } catch {
    return [];
  }
  if (!stat.isDirectory()) return [];
  const out = [];
  for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
    const path = `${rel}/${entry.name}`;
    if (entry.isDirectory() && entry.name !== "node_modules") {
      out.push(...filesUnder(root, path, pattern));
    } else if (entry.isFile() && pattern.test(entry.name)) {
      out.push(path);
    }
  }
  return out.sort();
}

/**
 * Read what the check needs from a package root: its scripts, whether `src/` declares an exported
 * VERSION, its test files and its pending changesets.
 *
 * @param {string} root The package root.
 * @returns {{scripts: Record<string, unknown>, declaresVersion: boolean, versionModules: string[],
 *   tests: Array<{path: string, text: string}>, changesets: Array<{path: string, text: string}>}}
 * @throws {Error} When package.json cannot be read or parsed, or a file cannot be read.
 */
export function readReleasePrInput(root) {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const read = (path) => ({ path, text: readFileSync(join(root, path), "utf8") });
  const sources = filesUnder(root, "src", SOURCE_FILE).filter(
    (p) => !TEST_FILE.test(p) && !/\.d\.[cm]?ts$/.test(p),
  );
  const tests = TEST_DIRS.flatMap((dir) => filesUnder(root, dir, TEST_FILE)).map(read);
  const changesets = filesUnder(root, ".changeset", /\.md$/)
    .filter((p) => p !== ".changeset/README.md")
    .map(read);
  const versionModules = sources.filter((p) => declaresVersion(read(p).text));
  return {
    scripts: manifest?.scripts ?? {},
    declaresVersion: versionModules.length > 0,
    versionModules,
    tests: tests.sort((a, b) => a.path.localeCompare(b.path)),
    changesets,
  };
}

/**
 * Run the check from the command line: `--dir <package root>`, the working directory by default.
 *
 * @param {{argv?: string[], dir?: string, stdout?: {write: (s: string) => unknown},
 *   stderr?: {write: (s: string) => unknown}}} [options]
 * @returns {number} The exit code: 0 clean, 1 a finding, 2 could not read its input.
 */
export function runReleasePrCheck(options = {}) {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  let dir = options.dir ?? process.cwd();
  const argv = options.argv ?? [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dir" && typeof argv[i + 1] === "string") {
      dir = argv[i + 1];
      i += 1;
    } else if (argv[i] !== "--") {
      stderr.write(
        `release-pr: ${JSON.stringify(argv[i])} is not an argument this check accepts (only ` +
          "--dir <package root>). Nothing was checked.\n",
      );
      return 2;
    }
  }
  let input;
  let ts;
  try {
    input = readReleasePrInput(resolve(dir));
    if (input.declaresVersion) ts = loadTypeScript(resolve(dir));
  } catch (error) {
    stderr.write(
      `release-pr: could not read the package in ${dir}: ${error.message} Nothing was checked.\n`,
    );
    return 2;
  }
  const found = checkReleasePr(input, ts);
  if (found.length > 0) {
    const report = found.map((f) => `  ${f.file} [${f.rule}] ${f.message}`).join("\n");
    stderr.write(
      `release-pr: a release pull request made from this tree would fail.\n${report}\n` +
        `${found.length} finding(s). The rules are in the @cosyte/script-utils README, ` +
        '"The release pull request check".\n',
    );
    return 1;
  }
  const version = input.declaresVersion
    ? "the version script and a fresh-import VERSION test are in place"
    : "the package exports no VERSION under src/, so the version rules do not apply";
  stdout.write(
    `release-pr: OK, ${version}; ${input.changesets.length} changeset(s) open within ` +
      `${RELEASE_BULLET_LIMIT} characters.\n`,
  );
  return 0;
}
