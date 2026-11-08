// @cosyte/script-utils/catalog
//
// THE CATALOG OF COSYTE'S LIBRARIES (ST13, ST14). One record per library, generated from that
// library's own package.json, with the tier it belongs to; and one for Pathways, our integration
// engine, which is in development and not on npm. The tiers and Pathways' status come from a small
// hand-kept file in cosyte/config (`catalog/tiers.json`); everything else is read out of each
// package.json by `scripts/catalog.mjs` there, and written beside this module as `catalog.json`.
// A site, the org profile, a deck or a knowledgebase page reads that one list instead of keeping
// its own roster.
//
// IT ALSO CARRIES THE CHECK A LIBRARY CAN RUN, AND THAT CHECK IS ADVISORY. Each package.json
// description is that library's one canonical line (ST14). Keeping the catalog fresh is cosyte/config's
// job: `scripts/catalog.mjs check --npm` compares the catalog with every library's latest npm release,
// nightly and before each config release. So a library that changes its description is not held red
// until the next script-utils release: this check prints both values as a note and exits 0. `--strict`
// makes a disagreement exit 1 and an unlisted package exit 2, for a caller that wants the old gate.
//
//   node node_modules/@cosyte/script-utils/catalog.js              # the package in this directory
//   node node_modules/@cosyte/script-utils/catalog.js --dir <path> # another package directory
//   node node_modules/@cosyte/script-utils/catalog.js --strict     # a disagreement fails
//
// EXIT CODES: 0 the description agrees, or (advisory) it does not and a note says so; 1 it does not,
// with --strict; 2 the check could not run (no package.json, a bad argument, or, with --strict, a
// package the catalog does not list).
//
// ZERO DEPENDENCIES AND NO BUILD STEP, like the rest of this package.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { isCliEntrypoint } from "./index.js";

/** The three tiers, in the order ST13 names them. */
export const TIERS = Object.freeze(["standard", "built-on", "engine"]);

/** Deep-freeze a parsed JSON value, so no consumer can edit the shared catalog in place. */
function freeze(value) {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** The catalog, as `catalog.json` beside this module carries it. */
export const CATALOG = freeze(
  JSON.parse(readFileSync(new URL("./catalog.json", import.meta.url), "utf8")),
);

/**
 * The release line a version is on: `0.<minor>` below 1.0.0, where a minor may break, and the
 * major from 1.0.0 on. `0.1.2` is the 0.1 line (ST16).
 *
 * @param {string} version A `major.minor.patch` version.
 * @returns {string} The line, for example `0.1`.
 */
export function releaseLine(version) {
  const match = /^(\d+)\.(\d+)\.\d+(?:[-+].*)?$/.exec(String(version));
  if (match === null) throw new TypeError(`${JSON.stringify(version)} is not a semver version.`);
  return match[1] === "0" ? `0.${match[2]}` : match[1];
}

/** The `https://github.com/cosyte/<repo>` a package.json's repository names, or `null`. */
function repositoryUrl(manifest) {
  const raw =
    typeof manifest.repository === "string" ? manifest.repository : manifest.repository?.url;
  if (typeof raw !== "string") return null;
  const match = /github\.com[/:]cosyte\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(raw);
  return match === null ? null : `https://github.com/cosyte/${match[1]}`;
}

/** The slug a `@cosyte/<slug>` name carries. */
function slugOf(name) {
  const match = /^@cosyte\/([a-z0-9][a-z0-9.-]*)$/.exec(String(name));
  if (match === null)
    throw new TypeError(`${JSON.stringify(name)} is not a @cosyte/<name> package.`);
  return match[1];
}

/** The fields every record takes from its package.json, refusing a manifest that lacks one. */
function fromManifest(name, manifest) {
  if (manifest === undefined || manifest === null || typeof manifest !== "object") {
    throw new TypeError(`no package.json was read for ${name}.`);
  }
  if (manifest.name !== name) {
    throw new TypeError(
      `the package.json read for ${name} names ${JSON.stringify(manifest.name)}.`,
    );
  }
  const slug = slugOf(name);
  const problems = [];
  if (typeof manifest.description !== "string" || manifest.description.trim() === "") {
    problems.push("no description");
  }
  if (typeof manifest.version !== "string") problems.push("no version");
  if (typeof manifest.engines?.node !== "string") problems.push("no engines.node");
  const repository = repositoryUrl(manifest);
  if (repository === null) problems.push("no github.com/cosyte repository");
  if (problems.length > 0)
    throw new TypeError(`${name}'s package.json has ${problems.join(", ")}.`);
  return {
    name,
    slug,
    description: manifest.description,
    line: releaseLine(manifest.version),
    engines: { node: manifest.engines.node },
    repository,
    docs: `https://docs.cosyte.com/${slug}`,
  };
}

/**
 * Build the catalog from the hand-kept tiers file and each package's package.json. Pure: it reads
 * nothing, so the generator decides where the manifests come from.
 *
 * @param {{ standards: { package: string, standard: string }[], builtOn: string[],
 *   engine: { package: string, name: string, status: string, onNpm: boolean } }} tiers
 * @param {Map<string, Record<string, any>> | Record<string, Record<string, any>>} manifests
 *   Each package's parsed package.json, keyed by package name.
 * @returns {{ libraries: object[], engine: object }} The catalog.
 * @throws {TypeError} When a tier names a package with no usable manifest, or names one twice.
 */
export function buildCatalog(tiers, manifests) {
  const get = (name) => (manifests instanceof Map ? manifests.get(name) : manifests[name]);
  const seen = new Set();
  const claim = (name) => {
    if (seen.has(name)) throw new TypeError(`${name} is listed twice in the tiers.`);
    seen.add(name);
  };
  const libraries = [];
  for (const { package: name, standard } of tiers.standards) {
    claim(name);
    libraries.push({
      ...fromManifest(name, get(name)),
      npm: `https://www.npmjs.com/package/${name}`,
      tier: "standard",
      standard,
    });
  }
  for (const name of tiers.builtOn) {
    claim(name);
    libraries.push({
      ...fromManifest(name, get(name)),
      npm: `https://www.npmjs.com/package/${name}`,
      tier: "built-on",
    });
  }
  const { package: enginePackage, name: engineName, status, onNpm } = tiers.engine;
  claim(enginePackage);
  const engine = {
    ...fromManifest(enginePackage, get(enginePackage)),
    tier: "engine",
    displayName: engineName,
    status,
    onNpm,
  };
  return { libraries, engine };
}

/**
 * The catalog record for a package name: a library or the engine, or `undefined`.
 *
 * @param {string} name A package name, for example `@cosyte/hl7`.
 * @param {{ libraries: object[], engine: object }} [catalog] Defaults to `CATALOG`.
 */
export function catalogEntry(name, catalog = CATALOG) {
  if (catalog.engine?.name === name) return catalog.engine;
  return catalog.libraries.find((entry) => entry.name === name);
}

/**
 * Compare a package.json with its catalog record. Only the description is compared: it is the line
 * ST14 makes canonical, and the other generated fields move with a release (the version line) or
 * cannot drift without the package moving (the name and repository).
 *
 * @param {Record<string, any>} manifest The package's parsed package.json.
 * @param {{ libraries: object[], engine: object }} [catalog] Defaults to `CATALOG`.
 * @returns {{ field: string, catalog: string, packageJson: string }[]} The disagreements.
 * @throws {TypeError} When the catalog does not list the package.
 */
export function compareWithCatalog(manifest, catalog = CATALOG) {
  const entry = catalogEntry(manifest?.name, catalog);
  if (entry === undefined) {
    throw new TypeError(`the catalog does not list ${JSON.stringify(manifest?.name ?? null)}.`);
  }
  if (manifest.description === entry.description) return [];
  return [
    {
      field: "description",
      catalog: entry.description,
      packageJson: String(manifest.description ?? ""),
    },
  ];
}

/**
 * Run the check over one package directory and return the exit code. It never exits the process.
 *
 * ADVISORY BY DEFAULT: a disagreement or an unlisted package is printed as a note and exits 0,
 * because keeping the catalog fresh is cosyte/config's job (`scripts/catalog.mjs check --npm`).
 * `strict` (or `--strict`) restores the gate: 1 for a disagreement, 2 for an unlisted package.
 *
 * @param {{ dir?: string, argv?: string[], strict?: boolean }} [options] `dir` is the package
 *   directory (default: the working directory). `argv` is the CLI arguments, read for
 *   `--dir <path>` and `--strict`.
 * @returns {0 | 1 | 2} 0 agree (or advisory), 1 disagree under strict, 2 the check could not run.
 */
export function runCatalogCheck(options = {}) {
  let dir = options.dir ?? process.cwd();
  let strict = options.strict === true;
  const argv = options.argv ?? [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dir" && typeof argv[i + 1] === "string") {
      dir = argv[i + 1];
      i += 1;
    } else if (argv[i] === "--strict") {
      strict = true;
    } else if (argv[i] !== "--") {
      process.stderr.write(
        `catalog check: ${JSON.stringify(argv[i])} is not an argument this check accepts (only ` +
          `--dir <package directory> and --strict). Nothing was checked.\n`,
      );
      return 2;
    }
  }
  dir = resolve(dir);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  } catch (err) {
    process.stderr.write(`catalog check: could not read package.json in ${dir}: ${err.message}\n`);
    return 2;
  }
  let differences;
  try {
    differences = compareWithCatalog(manifest);
  } catch (err) {
    if (strict) {
      process.stderr.write(`catalog check: ${err.message} Nothing was checked.\n`);
      return 2;
    }
    process.stderr.write(
      `catalog check: note: ${err.message} The catalog is cosyte/config's to keep fresh; this ` +
        `check is advisory, so it exits 0.\n`,
    );
    return 0;
  }
  if (differences.length === 0) {
    process.stdout.write(`catalog check: ${manifest.name}'s description is the catalog's.\n`);
    return 0;
  }
  const report = differences
    .map(
      (d) =>
        `  ${d.field}\n    package.json: ${JSON.stringify(d.packageJson)}\n` +
        `    catalog:      ${JSON.stringify(d.catalog)}`,
    )
    .join("\n");
  if (!strict) {
    process.stderr.write(
      `catalog check: note: ${manifest.name}'s package.json and the catalog this release of ` +
        `@cosyte/script-utils carries disagree.\n${report}\n` +
        `This is advisory and exits 0. Once this package is released with the new description, ` +
        `cosyte/config's nightly check against npm (scripts/catalog.mjs check --npm) flags the ` +
        `catalog, and the next script-utils release carries it.\n`,
    );
    return 0;
  }
  process.stderr.write(
    `catalog check: ${manifest.name}'s package.json and the catalog disagree.\n${report}\n` +
      `The catalog is generated in cosyte/config (scripts/catalog.mjs) and ships in ` +
      `@cosyte/script-utils. Regenerate it there, release script-utils, then move this package to ` +
      `that release.\n`,
  );
  return 1;
}

if (isCliEntrypoint(import.meta.url)) {
  process.exitCode = runCatalogCheck({ argv: process.argv.slice(2) });
}
