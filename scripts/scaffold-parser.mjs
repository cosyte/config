#!/usr/bin/env node
// Scaffold a new @cosyte/* parser repo from the shared, standard-compliant template.
//
// Node stdlib only, plus the two dev dependencies of THIS repo that decide what "formatted" means:
// `prettier` and `@cosyte/prettier-config`. See formatEmitted() for why the emitted tree cannot be
// left unformatted for the new repo's author to notice.
//
// The emitted skeleton is born compliant with the canonical toolchain
// (documentation/conventions.md) and the drift check (config/drift-manifest.json): it inherits the
// shared @cosyte/* config packages, calls the reusable cosyte/.github workflows, ships Changesets on
// the 0.0.x ladder, and carries the parser archetype stubs (parse<Name>, WARNING_CODES, FATAL_CODES)
// plus the @cosyte/test-utils property harness.
//
// Usage:
//   node scripts/scaffold-parser.mjs <name> [--title "Human Title"] [--out <dir>]
//
//   <name>          package name segment, e.g. `x12` -> @cosyte/x12 (lowercase; [a-z][a-z0-9-]*)
//   --title <str>   human-readable title used in prose/docs (default: derived from <name>).
//                   Substituted verbatim into JSON, TypeScript comments and Markdown, so it may
//                   not carry a quote, a backslash, a block-comment terminator, a control or
//                   line-separator character, or `{{`. See firstUnsafeInTitle() for why each.
//   --out <dir>     parent directory to emit into (default: $CWD); the repo lands at <out>/<name>
//
// It refuses to overwrite an existing non-empty <out>/<name>.

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = join(SCRIPT_DIR, "parser-template");
const require = createRequire(import.meta.url);

/** Files whose contents are copied verbatim (no placeholder substitution). Binary-ish or none today. */
const VERBATIM_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2"]);

/** File extensions that should be made executable on emit. */
const EXECUTABLE_EXTENSIONS = new Set([".sh"]);

function fail(message) {
  process.stderr.write(`scaffold-parser: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const positionals = [];
  const flags = { title: undefined, out: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--title" || arg === "--out") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) fail(`${arg} requires a value`);
      flags[arg === "--title" ? "title" : "out"] = value;
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else if (arg.startsWith("--")) {
      fail(`unknown flag: ${arg}`);
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, flags };
}

function printUsage() {
  process.stdout.write(
    [
      "Scaffold a new @cosyte/* parser from the shared standard template.",
      "",
      "Usage:",
      '  node scripts/scaffold-parser.mjs <name> [--title "Human Title"] [--out <dir>]',
      "",
      "  <name>          package segment, e.g. x12 -> @cosyte/x12 (lowercase; [a-z][a-z0-9-]*)",
      "  --title <str>   human-readable title for prose/docs (default: derived from <name>).",
      '                  No quote, backslash, "{{", block-comment terminator, control character or',
      "                  line/paragraph separator: it is substituted verbatim into JSON, TS comments",
      "                  and Markdown.",
      "  --out <dir>     parent dir to emit into (default: cwd); repo lands at <out>/<name>",
      "",
    ].join("\n"),
  );
}

/** PascalCase identifier from a package segment: `x12` -> `X12`, `c-cda` -> `CCda`, `fhir` -> `Fhir`. */
function toPascal(name) {
  return name
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/**
 * WHY A HOSTILE `--title` IS REFUSED AT THE DOOR RATHER THAN ESCAPED AT EACH DESTINATION.
 *
 * `--title` is a DISPLAY string, and it is substituted verbatim into every template file that
 * carries the `{{TITLE}}` token: a JSON string in `package.json`, a JSDoc block in `src/index.ts`,
 * line comments in `scripts/phi-scan.ts`, and Markdown prose in the docs. Those are four different
 * syntaxes, and no single escaping is correct in all of them: JSON-escaping the value would put a
 * literal backslash-quote in the README, and no escaping at all rescues a block-comment
 * terminator, which ends a JSDoc block whatever you do to the quotes around it. "Escape it
 * properly" therefore means one escaper per destination plus a router that knows which file is
 * which - real machinery, to carry a value that has no legitimate reason to hold any of these
 * characters in the first place.
 *
 * MEASURED ON THE REAL GENERATOR, and each rule below is tied to one of these rather than to a
 * general suspicion of punctuation:
 *
 *   Bad "Q" Title / Bad \ Title          -> the emitted package.json is not valid JSON
 *   a newline, or a raw tab              -> a C0 control character raw inside a JSON string, and a
 *                                          line comment in the emitted scanner that stops there
 *   U+2028 / U+2029                      -> legal in JSON, but ECMAScript LINE TERMINATORS, so the
 *                                          same comments end early and the tree no longer parses
 *   a `*` followed by a `/`              -> closes the JSDoc block it is substituted into
 *   Title {{NAME}} here                  -> an unsubstituted placeholder ships in the README and in
 *                                          the published package description; `{{Pascal}}` is
 *                                          instead rewritten by a token that runs later
 *   X", "name": "@evil/pwned", "x": "    -> the emitted package.json PARSES CLEANLY and names a
 *                                          DIFFERENT PACKAGE
 *
 * WHAT THE BASE COMMIT ALREADY DID, IN TWO SENTENCES, BECAUSE A PER-ROW ACCOUNT OF IT WAS WRITTEN
 * WRONG TWICE. `#57` added a format step that parses the emitted manifest and runs prettier over
 * the emitted tree, so at `d3df2f3` the first four rows already exit 1 - but only after a full tree
 * has been written to disk, and two of them are reported as a formatting failure rather than as the
 * title that caused it. The last two rows exit 0 with the success banner at `d3df2f3` exactly as
 * they did at `e76939f`, and they are the reason this exists: handing back a WORKING repo that
 * carries someone else's package name, or an unsubstituted token in a published description, is
 * worse than handing back a broken one loudly.
 *
 * Refusing the input reaches all six, and it reaches them before the first file is written, which
 * is the discipline resolveFormatter() already follows: a refusal that leaves a half-written repo
 * behind has already broken the promise the scaffold makes.
 *
 * test/scaffold-title.test.ts asserts the refusal and the empty disk for every row. Its
 * counterfactuals reconstruct base behaviour for the injection and for a quoted title, the two ends
 * of what these guards do: a manifest that parses and lies, and one that does not parse at all.
 *
 * NOT REFUSED, BECAUSE IT WAS MEASURED NOT TO BREAK ANYTHING: U+007F (legal raw in a JSON string,
 * and not a line terminator), and a title of 300 characters (nothing reflows a comment, so the
 * emitted tree stays format-clean). A rule for either would be a claim nothing supports.
 *
 * HOW FAR THE ACCEPT-SET REACHES, STATED NO WIDER THAN IT HOLDS. It is complete for the two
 * destinations where a title can produce an artifact that does not PARSE: JSON (RFC 8259 forbids
 * exactly `"`, `\` and raw U+0000-U+001F) and TypeScript (only LF, CR, U+2028 and U+2029 end a line
 * comment; only a block-comment terminator ends a block one). It is NOT complete for Markdown, and
 * that is deliberate rather than overlooked: `Bad *emph* Title` is accepted, and prettier-on-emit
 * normalises it to `Bad _emph_ Title` wherever it lands in Markdown PROSE, while `package.json`,
 * the TypeScript comments and the text inside a fenced code block keep the raw bytes. That
 * divergence is PRE-EXISTING - it arrived with `#57`'s formatting step and produces a repo that
 * builds, publishes and gates green - so it is named here rather than fixed by widening the rules,
 * which would start refusing titles on cosmetic grounds.
 *
 * The sentence above USED to say "in whichever emitted Markdown its globs reach", which described a
 * split that no longer exists: the emitted globs are now the whole tree, so every emitted Markdown
 * file is reached and the surviving split is prose-vs-code, not file-vs-file. Measured on
 * `--title "Bad *emph* Title"`: `docs-content/intro.md` moved from raw to normalised, and
 * `docs-content/quickstart.md` now holds BOTH - normalised in its prose, raw inside its `ts` fence.
 */
function firstUnsafeInTitle(title) {
  const rules = [
    [
      /["\\]/,
      "the emitted package.json is a JSON document, and a quote or a backslash either breaks it " +
        "outright or silently REWRITES it: a crafted title can rename the package",
    ],
    [
      /[\u0000-\u001f]/,
      "a C0 control character is not legal raw inside a JSON string, and a newline additionally " +
        "ends the line comment it lands in",
    ],
    [
      /[\u2028\u2029]/,
      "U+2028 and U+2029 are legal inside a JSON string but are ECMAScript LINE TERMINATORS, so " +
        "they end the line comments they land in and the emitted TypeScript no longer parses",
    ],
    [/\*\//, "this sequence closes the JSDoc block comment it is substituted into"],
    [
      /\{\{/,
      "a title is substituted into the tree alongside the other placeholders, so a `{{...}}` in it " +
        "is either expanded by a token that runs later or survives into the emitted prose " +
        "unsubstituted - measured: `{{Pascal}}` is rewritten, `{{NAME}}` ships literally in the " +
        "README and in the published package description. Neither is the title that was asked for",
    ],
  ];
  for (const [pattern, why] of rules) {
    const found = pattern.exec(title);
    if (found) return { index: found.index, text: found[0], why };
  }
  return undefined;
}

/** Name a character the way an error message can be acted on: `U+0022 QUOTATION MARK`. */
function describeUnsafe(text) {
  if (text.length > 1) return `\`${text}\``;
  const code = text.codePointAt(0);
  const named = {
    0x09: "TAB",
    0x0a: "LINE FEED",
    0x0d: "CARRIAGE RETURN",
    0x22: "QUOTATION MARK",
    0x5c: "REVERSE SOLIDUS (backslash)",
    0x2028: "LINE SEPARATOR",
    0x2029: "PARAGRAPH SEPARATOR",
  }[code];
  const hex = `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
  return named ? `${hex} ${named}` : hex;
}

/** Refuse a title that cannot be substituted safely, before anything reaches the disk. */
function validateTitle(title, derived) {
  const source = derived ? "the title derived from <name>" : "--title";
  if (title.trim() === "") {
    // Phrased without a remedy that assumes which branch this is: defaultTitle() cannot return an
    // empty string for a name matching `[a-z][a-z0-9-]*`, so the derived branch is unreachable
    // today, and telling that caller to "omit --title" would be advice they had already taken.
    fail(
      `${source} is empty, so the emitted README, docs and package description would each be left ` +
        `with a gap where the standard's name belongs. Pass a title that names the standard. ` +
        `Nothing was written.`,
    );
  }
  const unsafe = firstUnsafeInTitle(title);
  if (!unsafe) return;
  fail(
    [
      `${source} carries ${describeUnsafe(unsafe.text)} at offset ${unsafe.index}, which cannot be ` +
        `substituted safely.`,
      // JSON.stringify so a control character is shown rather than executed against the terminal.
      `  title: ${JSON.stringify(title)}`,
      `  ${unsafe.why}.`,
      `A title is written VERBATIM into the emitted package.json, into JSDoc and line comments in`,
      `the emitted TypeScript, and into the Markdown docs, so no one escaping is correct in all of`,
      `them. Re-run with a title carrying none of: a double quote, a backslash, a block-comment`,
      `terminator, a control / line-separator character, or a "{{" placeholder opener. Nothing was`,
      `written.`,
    ].join("\n"),
  );
}

/** Default human title from a name: uppercase short codes, else Title Case. `x12` -> `X12`. */
function defaultTitle(name) {
  // Short, mostly-alphanumeric standard codes (hl7, x12, ccda, ncpdp, fhir, dicom) read best upper.
  if (/^[a-z0-9]{2,6}$/.test(name)) return name.toUpperCase();
  return name
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function isEmptyDir(dir) {
  return readdirSync(dir).length === 0;
}

/** Replace every placeholder token in a string. Order: longest/compound keys first is not needed
 *  because the tokens are disjoint, but {{NAME_UPPER}} must not be shadowed by {{NAME}}: `replaceAll`
 *  on the exact `{{NAME}}` token never matches inside `{{NAME_UPPER}}`, so plain replacement is safe. */
function substitute(text, tokens) {
  let out = text;
  for (const [key, value] of Object.entries(tokens)) {
    out = out.split(key).join(value);
  }
  return out;
}

function copyTree(srcDir, destDir, tokens) {
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyTree(srcPath, destPath, tokens);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = entry.name.includes(".") ? entry.name.slice(entry.name.lastIndexOf(".")) : "";
    if (VERBATIM_EXTENSIONS.has(ext)) {
      cpSync(srcPath, destPath);
    } else {
      const content = readFileSync(srcPath, "utf8");
      writeFileSync(destPath, substitute(content, tokens));
    }
    if (EXECUTABLE_EXTENSIONS.has(ext)) chmodSync(destPath, 0o755);
  }
}

/**
 * THE DEFECT THIS CLOSES, AND WHY IT CANNOT BE FIXED IN THE TEMPLATE.
 *
 * `scripts/parser-template` is `.prettierignore`d wholesale, because it carries `{{PLACEHOLDER}}`
 * tokens and is not valid TS or JSON until it has been generated. So nothing formats the template,
 * and until this step existed nothing formatted the emitted tree either: every parser this
 * generator has ever minted was born with a RED `format:check`, which is a gate in the shared CI
 * workflow the emitted `.github/workflows/ci.yml` calls. A new repo's first CI run failed on
 * whitespace.
 *
 * AND IT IS PACKAGE-NAME-LENGTH DEPENDENT, WHICH IS WHY ONE PROBE READS CLEAN AND PROVES NOTHING.
 * Substitution changes line lengths in both directions, so which files are unformatted depends on
 * how long `<name>` is. Measured on this template at prettier's `printWidth` of 100: a SHORT name
 * (`a`, `hl7`, `ccda`) SHORTENS an already-wrapped import in
 * `test/property/round-trip.property.test.ts` until prettier wants it collapsed onto one line,
 * while a LONG name (`terminology`) LENGTHENS a signature in `src/index.ts` and a ternary in
 * `test/docs-content.test.ts` past 100 until prettier wants them broken. The two ends red DISJOINT
 * file sets. That is the trap in fixing this by hand-editing template lines: whichever end you
 * measured goes green and the other stays red, and the boundary moves again the next time anyone
 * edits a line the tokens sit on.
 *
 * SO THE FIX IS NOT A LINE EDIT, IT IS RUNNING THE FORMATTER. Prettier is handed the emitted tree
 * after substitution, so the emitted bytes are a fixed point of prettier for EVERY name at every
 * length, with nothing here to keep in sync with the template's line lengths.
 *
 * NOT EVERY UNFORMATTED FILE DEPENDS ON THE NAME, AND THE ONE THAT DOES NOT IS THE REASON THE
 * TEMPLATE'S OWN GLOBS HAD TO CHANGE. `docs-content/quickstart.md` is unformatted at EVERY name
 * length; it stayed invisible while the emitted `format` / `format:check` were four path-scoped
 * globs that did not include `docs-content/`, so the emitted tree was handed over carrying it and
 * the check reported clean by never looking. The template's scripts are now a single whole-tree
 * glob, which is what makes this step reach it.
 *
 * WHAT IT IS POINTED AT IS DERIVED FROM THE EMITTED REPO, NEVER LISTED HERE. The globs come out of
 * the emitted `package.json`'s own `format` script, which is the script the new repo will be
 * checked with. A list of paths in this file would be a claim about the template, and it would go
 * stale the first time the template grows a directory. Deriving it means the set formatted on emit
 * and the set checked in CI cannot disagree. It does NOT by itself mean either set is the whole
 * emitted tree - `test/scaffold-format.test.ts` derives that census separately and asserts the gap
 * is empty, because a glob can agree with itself and still miss a directory.
 */
function resolveFormatter() {
  // Resolved BEFORE anything is copied, so a missing `pnpm install` fails with an empty disk rather
  // than leaving a half-written repo behind.
  try {
    return {
      bin: require.resolve("prettier/bin/prettier.cjs"),
      // The emitted `package.json` names `"prettier": "@cosyte/prettier-config"`, but the emitted
      // repo has no `node_modules` yet, so that reference cannot resolve from there. This repo's own
      // copy of the same package is passed explicitly instead. It is the SOURCE of what the emitted
      // repo will install, so a settings change lands in both at once.
      config: require.resolve("@cosyte/prettier-config"),
    };
  } catch (error) {
    fail(
      `cannot resolve the formatter (${error.code ?? "resolution failed"}). Run \`pnpm install\` ` +
        `in the config repo first: the emitted repo is formatted on emit with this repo's own ` +
        `prettier and @cosyte/prettier-config.`,
    );
    return undefined; // unreachable; fail() exits.
  }
}

/**
 * The prettier argv the emitted repo's own `format` / `format:check` script uses.
 *
 * The shape is asserted rather than loosely pattern-matched, so restructuring the template's script
 * fails LOUDLY here instead of silently formatting nothing. A generator that formats an empty set
 * and reports success is the same never-pointed-at-its-input defect this whole step exists to close.
 */
function emittedPrettierGlobs(pkgPath, scriptName) {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  } catch (error) {
    // THIS BRANCH IS UNREACHABLE TODAY, AND IT IS KEPT AS A LOCAL INVARIANT, NOT AS A LIVE GUARD.
    // The cause this comment used to name - `--title` substituted into a JSON string with no
    // escaping - is refused by validateTitle() before anything is written. Every other route to an
    // unparseable manifest, including the template's own package.json being edited into one, is
    // caught by assertEmittedManifest(), which parses the same path with no write in between and
    // refuses with a message aimed at the template. The `format:check` call below parses it a
    // SECOND time, after `prettier --write` has rewritten it, and that route is closed by prettier
    // rather than by us: a `--write` that emitted invalid JSON would have failed first. So nothing
    // arrives here while main() calls those two. What it buys is that this function cannot throw a
    // stack trace if it is ever called from somewhere else, which is the whole reason it reads the
    // manifest defensively.
    fail(
      `the emitted ${pkgPath} is not valid JSON (${error.message}), so the globs to format with ` +
        `cannot be derived from it. Check scripts/parser-template/package.json. Nothing was ` +
        `formatted; delete the emitted directory before retrying.`,
    );
  }
  const script = String(pkg.scripts?.[scriptName] ?? "").trim();
  const flag = scriptName === "format" ? "--write" : "--check";
  const shape = new RegExp(`^prettier ${flag} ((?:"[^"]+"\\s*)+)$`);
  const matched = shape.exec(script);
  if (!matched) {
    fail(
      `the template's "${scriptName}" script is no longer \`prettier ${flag} "<glob>" ...\`, so ` +
        `this generator can no longer derive what to format on emit.\n  got: ${script || "(missing)"}\n` +
        `Teach emittedPrettierGlobs() the new shape. Do not drop the format step to get green.`,
    );
  }
  return [...matched[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/**
 * THE EMITTED MANIFEST DESCRIBES THE PACKAGE THAT WAS ASKED FOR - PARSING IT IS NOT ENOUGH.
 *
 * validateTitle() refuses every input measured to corrupt this file, so in normal operation this
 * assertion cannot fire, and that is exactly why it is written down rather than left implicit: the
 * failure it covers is the one that was SILENT. A title of `X", "name": "@evil/pwned", "x": "`
 * produced a package.json that PARSES CLEANLY and names a different package, while the generator
 * printed `Scaffolded @cosyte/probe` and exited 0. A parse check - which is all the format step
 * needed, and all the generator had - accepts that manifest without complaint. Only an identity
 * check catches it.
 *
 * So the two guards fail in different ways and neither restates the other: the accept-set decides
 * what may enter, this decides whether what came out is the repo that was ordered. If the
 * accept-set is ever wrong, or widened, the injection class cannot go silent again - and a
 * scaffold that hands over a manifest naming someone else's package while reporting success is the
 * worst outcome available here, because every downstream gate then runs against the wrong identity.
 *
 * WHAT IS ASSERTED IS ONLY WHAT THE TOKENS CONTROL. `name` and the presence of the title in
 * `description` are what substitution produces; the rest of the manifest is the template's business
 * and pinning it here would red the first time the template legitimately grows a field.
 */
function assertEmittedManifest(pkgPath, expectedName, title) {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  } catch (error) {
    fail(
      `the emitted ${pkgPath} is not valid JSON (${error.message}). Nothing downstream of this can ` +
        `be trusted, so nothing was formatted; delete the emitted directory before retrying.`,
    );
  }
  if (pkg?.name !== expectedName) {
    fail(
      `the emitted ${pkgPath} names "${pkg?.name}", but this run was asked for "${expectedName}". ` +
        `Substitution has written outside the field it was given, which a JSON parse cannot see. ` +
        `Nothing was formatted; delete the emitted directory before retrying.`,
    );
  }
  if (typeof pkg?.description !== "string" || !pkg.description.includes(title)) {
    fail(
      `the emitted ${pkgPath} has a description that does not contain the title it was given ` +
        `(${JSON.stringify(title)}), so substitution did not land where it was meant to. Nothing ` +
        `was formatted; delete the emitted directory before retrying.`,
    );
  }
}

function runPrettier(formatter, destDir, flag, globs) {
  const result = spawnSync(
    process.execPath,
    [formatter.bin, "--config", formatter.config, flag, ...globs],
    { cwd: destDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return {
    code: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim(),
    error: result.error,
  };
}

/** Format the emitted tree, then PROVE it: `--write` is not by itself evidence of a clean `--check`. */
function formatEmitted(formatter, destDir) {
  const pkgPath = join(destDir, "package.json");
  const written = runPrettier(
    formatter,
    destDir,
    "--write",
    emittedPrettierGlobs(pkgPath, "format"),
  );
  if (written.error) fail(`could not run prettier on ${destDir}: ${written.error.message}`);
  if (written.code !== 0) {
    fail(`prettier --write failed on the emitted tree (exit ${written.code}):\n${written.output}`);
  }

  // `prettier --write` is NOT idempotent in general (documentation/conventions.md records a markdown
  // construct it rewrites on every pass), so "we ran the formatter" is a weaker claim than "the tree
  // passes the check the new repo's CI runs". The second is the one that matters, so it is measured
  // here, with the emitted `format:check` script's OWN globs rather than the `format` ones: if those
  // two ever drift, the drift surfaces at scaffold time instead of in a new repo's first CI run.
  const checked = runPrettier(
    formatter,
    destDir,
    "--check",
    emittedPrettierGlobs(pkgPath, "format:check"),
  );
  if (checked.code !== 0) {
    fail(
      `the emitted tree is still not format-clean after \`prettier --write\` (exit ` +
        `${checked.code}). A scaffolded repo must not be born with a red format:check.\n` +
        `${checked.output}`,
    );
  }
}

function main() {
  const { positionals, flags } = parseArgs(process.argv.slice(2));

  if (positionals.length === 0) {
    printUsage();
    fail("missing required <name> argument");
  }
  if (positionals.length > 1) fail(`unexpected extra arguments: ${positionals.slice(1).join(" ")}`);

  const name = positionals[0];
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    fail(`invalid name "${name}": must match [a-z][a-z0-9-]* (e.g. x12, ccda, ncpdp, fhir)`);
  }

  // Both inputs are checked before the environment is, and long before the first write: a title
  // that cannot be substituted safely must not leave a partially-written repo behind.
  const title = flags.title ?? defaultTitle(name);
  validateTitle(title, flags.title === undefined);

  if (!existsSync(TEMPLATE_DIR) || !statSync(TEMPLATE_DIR).isDirectory()) {
    fail(`template directory not found at ${TEMPLATE_DIR}`);
  }

  // Resolved before the first file is written: a missing formatter refuses with nothing on disk.
  const formatter = resolveFormatter();

  const outParent = resolve(flags.out ?? process.cwd());
  const destDir = join(outParent, name);

  if (existsSync(destDir)) {
    if (!statSync(destDir).isDirectory()) fail(`${destDir} exists and is not a directory`);
    if (!isEmptyDir(destDir)) fail(`refusing to overwrite non-empty directory ${destDir}`);
  }

  // Token order matters only when one token is a prefix of another; these are disjoint, and
  // `split/join` replaces exact occurrences, so order is irrelevant here.
  const tokens = {
    "{{PKG}}": `@cosyte/${name}`, // @cosyte/x12
    "{{NAME}}": name, // x12 (package segment / repo name)
    "{{TITLE}}": title, // human-readable, e.g. "X12"
    "{{Pascal}}": toPascal(name), // PascalCase identifier, e.g. X12 / Ccda, for type & fn names
  };

  copyTree(TEMPLATE_DIR, destDir, tokens);
  assertEmittedManifest(join(destDir, "package.json"), tokens["{{PKG}}"], title);
  formatEmitted(formatter, destDir);

  process.stdout.write(
    [
      `Scaffolded ${tokens["{{PKG}}"]} at ${destDir}`,
      "",
      "Next steps:",
      `  cd ${destDir}`,
      "  pnpm install            # resolves @cosyte/* config packages from npm",
      "  pnpm format:check       # already clean: the emitted tree was formatted on emit",
      "  pnpm typecheck && pnpm lint --max-warnings=0 && pnpm test && pnpm build && pnpm attw",
      "",
      "Then follow the crew skill `scaffold-a-new-parser` for the post-scaffold steps:",
      "  create the GitHub repo, set NPM_TOKEN + DOCS_REPO_DISPATCH_TOKEN secrets, add as an umbrella",
      "  submodule, register in docs/config/packages.ts, and run the drift check.",
      "",
    ].join("\n"),
  );
}

main();
