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
//   --title <str>   human-readable title used in prose/docs (default: derived from <name>)
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
      "  --title <str>   human-readable title for prose/docs (default: derived from <name>)",
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
 * WHAT IT IS POINTED AT IS DERIVED FROM THE EMITTED REPO, NEVER LISTED HERE. The globs come out of
 * the emitted `package.json`'s own `format` script, which is the script the new repo will be
 * checked with. A list of paths in this file would be a claim about the template, and it would go
 * stale the first time the template grows a directory. Deriving it means the set formatted on emit
 * and the set checked in CI cannot disagree.
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
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
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

  const title = flags.title ?? defaultTitle(name);
  // Token order matters only when one token is a prefix of another; these are disjoint, and
  // `split/join` replaces exact occurrences, so order is irrelevant here.
  const tokens = {
    "{{PKG}}": `@cosyte/${name}`, // @cosyte/x12
    "{{NAME}}": name, // x12 (package segment / repo name)
    "{{TITLE}}": title, // human-readable, e.g. "X12"
    "{{Pascal}}": toPascal(name), // PascalCase identifier, e.g. X12 / Ccda, for type & fn names
  };

  copyTree(TEMPLATE_DIR, destDir, tokens);
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
