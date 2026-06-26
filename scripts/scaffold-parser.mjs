#!/usr/bin/env node
// Scaffold a new @cosyte/* parser repo from the shared, standard-compliant template.
//
// Zero-dep (Node stdlib only). The emitted skeleton is born compliant with the canonical toolchain
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

import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = join(SCRIPT_DIR, "parser-template");

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
      "  node scripts/scaffold-parser.mjs <name> [--title \"Human Title\"] [--out <dir>]",
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
 *  because the tokens are disjoint, but {{NAME_UPPER}} must not be shadowed by {{NAME}} — `replaceAll`
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

function main() {
  const { positionals, flags } = parseArgs(process.argv.slice(2));

  if (positionals.length === 0) {
    printUsage();
    fail("missing required <name> argument");
  }
  if (positionals.length > 1) fail(`unexpected extra arguments: ${positionals.slice(1).join(" ")}`);

  const name = positionals[0];
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    fail(`invalid name "${name}" — must match [a-z][a-z0-9-]* (e.g. x12, ccda, ncpdp, fhir)`);
  }

  if (!existsSync(TEMPLATE_DIR) || !statSync(TEMPLATE_DIR).isDirectory()) {
    fail(`template directory not found at ${TEMPLATE_DIR}`);
  }

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
    "{{Pascal}}": toPascal(name), // PascalCase identifier, e.g. X12 / Ccda — for type & fn names
  };

  copyTree(TEMPLATE_DIR, destDir, tokens);

  process.stdout.write(
    [
      `Scaffolded ${tokens["{{PKG}}"]} at ${destDir}`,
      "",
      "Next steps:",
      `  cd ${destDir}`,
      "  pnpm install            # resolves @cosyte/* config packages from npm",
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
