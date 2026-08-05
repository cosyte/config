// @cosyte/script-utils
//
// SMALL, ZERO-DEPENDENCY HELPERS FOR THE .mjs/.js GATE SCRIPTS EVERY COSYTE REPO KEEPS IN `scripts/`.
//
// Zero-dependency is a hard constraint, not a preference. This repo's own two gates
// (`scripts/changeset-guard.mjs`, `scripts/release-notes.mjs`) run in `ci.yml` and `release.yml`
// BEFORE `pnpm install`, on purpose, so that a broken or malicious install cannot decide whether a
// release gate runs. Anything imported by such a gate must therefore resolve with no `node_modules`
// present. Keep this package free of runtime dependencies and free of a build step.

import { statSync, realpathSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Extensions Node or a loader may append to a specifier that was typed without one.
 *
 * The TypeScript entries are here because `tsx`, `ts-node` and `node --experimental-strip-types`
 * all resolve an extension-less specifier to a TypeScript file while leaving `process.argv[1]`
 * exactly as typed.
 */
const SCRIPT_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx"]);

/**
 * Resolve symlinks, including for a path that does not exist.
 *
 * THE NAIVE FALLBACK HERE IS A SILENT-SKIP BUG, and it takes two conditions that look unrelated.
 * An extension-less `argv[1]` names no file by construction, so `realpathSync` throws on it;
 * returning the input raw then compares an UNRESOLVED path against a resolved one, because the
 * module side always resolves. Add any symlinked ancestor (macOS reaches `tmpdir()` through
 * `/var` to `/private/var`, and a symlinked checkout does the same) and the two disagree, so the
 * gate reports "not the entry point" and exits 0 having checked nothing. That is the combination of
 * `tsx scripts/prebuild` and a symlinked ancestor, which is an ordinary way to run a gate.
 *
 * So resolve the deepest ancestor that DOES exist and keep the rest verbatim.
 *
 * @param {string} path An absolute path.
 * @returns {string} The path with every resolvable ancestor resolved.
 */
function canonical(path) {
  try {
    return realpathSync(path);
  } catch {
    const parent = dirname(path);
    // At the filesystem root `dirname` is a fixed point. Without this the recursion never ends.
    if (parent === path) return path;
    return join(canonical(parent), basename(path));
  }
}

/**
 * `statSync` that reports a missing path as `null` rather than throwing.
 *
 * @param {string} path An absolute path.
 * @returns {import("node:fs").Stats | null} The stats, or `null`.
 */
function statOrNull(path) {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

/**
 * Strip a trailing script extension, so `/a/gate.ts` and `/a/gate` compare equal.
 *
 * @param {string} path An absolute path.
 * @returns {string} `path` without its script extension.
 */
function withoutScriptExtension(path) {
  const ext = extname(path);
  return SCRIPT_EXTENSIONS.has(ext) ? path.slice(0, -ext.length) : path;
}

/**
 * Is this module the file Node was pointed at, rather than one imported by something else?
 *
 * The question every `scripts/*.mjs` gate asks before running its CLI body, so that a test can
 * import the module for its exports without the CLI executing as a side effect.
 *
 * WHY THIS IS NOT A STRING COMPARISON, all four cases measured on Node 22.23.1 rather than
 * predicted. The obvious spelling,
 *
 *     import.meta.url === `file://${resolve(process.argv[1])}`
 *
 * asks whether two strings match, not whether two paths name the same file, and it answers FALSE
 * for three ordinary invocations of the very script that wrote it:
 *
 *   1. EXTENSION-LESS. `node scripts/gate` runs `scripts/gate.js`, and `tsx scripts/gate` runs
 *      `scripts/gate.ts`. Node and the loader resolve the extension; `process.argv[1]` keeps the
 *      specifier as typed, so it names a file that does not exist. This is the expensive one: it is
 *      how a gate goes silent while looking like it ran, and a first cut at this helper that
 *      canonicalised each side independently reintroduced it.
 *   2. A PATH CONTAINING A SPACE. `import.meta.url` percent-encodes (`/space%20dir/gate.js`);
 *      string-concatenating `file://` onto a raw path does not. Any checkout under a directory with
 *      a space in its name disables every gate written this way.
 *   3. A SYMLINKED INVOCATION. Node resolves the main module to its real path, so `import.meta.url`
 *      is the target while `process.argv[1]` is the link. Both `node_modules/.bin` shims and a
 *      symlinked checkout hit this.
 *
 * In all three the gate exits 0 having checked nothing, which is worse than the defect it guards,
 * because a green run is the only thing anyone reads.
 *
 * WHICH WAY THIS ERRS, deliberately. When the answer is genuinely ambiguous (an extension-less
 * `argv[1]` that resolves to no file on disk, so the stem comparison below is the only evidence
 * available) this returns TRUE and the CLI runs. A false positive runs a gate during an import,
 * which is loud and immediately visible. A false negative skips a gate and exits 0, which is
 * silent. Those are not symmetric, so the tie goes to running.
 *
 * @param {string} moduleUrl The calling module's `import.meta.url`.
 * @returns {boolean} `true` when this module is the process entry point.
 * @throws {TypeError} When `moduleUrl` is not a non-empty string. Passing the wrong thing must be
 *   loud: returning `false` would silently disable the caller's CLI.
 * @example
 *   if (isCliEntrypoint(import.meta.url)) process.exit(main(process.argv.slice(2)));
 */
export function isCliEntrypoint(moduleUrl) {
  if (typeof moduleUrl !== "string" || moduleUrl === "") {
    throw new TypeError(
      `isCliEntrypoint(moduleUrl) expects a non-empty string, got ${typeof moduleUrl}. ` +
        `Pass \`import.meta.url\`.`,
    );
  }

  const entry = process.argv[1];
  // No entry script at all: `node --eval`, the REPL, or an embedder. Nothing was pointed at.
  if (typeof entry !== "string" || entry === "") return false;

  let modulePath;
  try {
    modulePath = fileURLToPath(moduleUrl);
  } catch {
    // A `data:`, `http:` or `node:` module is never the file Node was pointed at.
    return false;
  }

  const moduleReal = canonical(modulePath);
  const entryReal = canonical(resolve(entry));
  if (moduleReal === entryReal) return true;

  // Past here the strings differ, so Node either resolved the specifier or the caller is genuinely
  // not the entry. An `argv[1]` that names a real file is the second case: Node was pointed at some
  // other script and had no resolving to do.
  const entryStat = statOrNull(entryReal);
  if (entryStat !== null && entryStat.isFile()) return false;

  const entryStem = withoutScriptExtension(entryReal);
  const moduleStem = withoutScriptExtension(moduleReal);

  // `node scripts/gate` -> `scripts/gate.js`, and `tsx scripts/gate` -> `scripts/gate.ts`.
  if (moduleStem === entryStem) return true;
  // `node ./scripts` and `node ./scripts/` -> `scripts/index.js`.
  if (moduleStem === join(entryStem, "index")) return true;

  return false;
}
