/**
 * Types for `@cosyte/script-utils/catalog`: the catalog of Cosyte's libraries and Pathways
 * (ST13, ST14), generated in cosyte/config from each package's package.json, and the check every
 * library runs that its description is the catalog's.
 */

/** The three tiers, in the order ST13 names them. */
export declare const TIERS: readonly ["standard", "built-on", "engine"];

/** What every record carries, generated from the package's package.json. */
export interface CatalogRecord {
  /** The npm package name, for example `@cosyte/hl7`. */
  readonly name: string;
  /** The name without its scope, for example `hl7`. */
  readonly slug: string;
  /** The package.json description: the package's one canonical line. */
  readonly description: string;
  /** The release line, for example `0.1`. */
  readonly line: string;
  readonly engines: { readonly node: string };
  /** `https://github.com/cosyte/<repo>`. */
  readonly repository: string;
  /** `https://docs.cosyte.com/<slug>`. */
  readonly docs: string;
}

/** One of the 14 libraries. */
export interface CatalogLibrary extends CatalogRecord {
  /** `https://www.npmjs.com/package/<name>`. */
  readonly npm: string;
  readonly tier: "standard" | "built-on";
  /** The standard, as readers see it (`HL7 v2`, `C-CDA`), for a library of the standard tier. */
  readonly standard?: string;
}

/** Pathways, our integration engine. */
export interface CatalogEngine extends CatalogRecord {
  readonly tier: "engine";
  /** The product name, `Pathways`. */
  readonly displayName: string;
  /** For example `in development`. */
  readonly status: string;
  /** Whether it is published to npm. */
  readonly onNpm: boolean;
}

export interface Catalog {
  /** The 8 standards' libraries, then the 6 built on them, in the order ST13 names them. */
  readonly libraries: readonly CatalogLibrary[];
  readonly engine: CatalogEngine;
}

/** The hand-kept tiers file, `catalog/tiers.json` in cosyte/config. */
export interface CatalogTiers {
  standards: { package: string; standard: string }[];
  builtOn: string[];
  engine: { package: string; name: string; status: string; onNpm: boolean };
}

/** The catalog, as the `catalog.json` beside this module carries it. Deeply frozen. */
export declare const CATALOG: Catalog;

/** The release line a version is on: `0.<minor>` below 1.0.0, the major from 1.0.0 on. */
export declare function releaseLine(version: string): string;

/**
 * Build the catalog from the tiers file and each package's parsed package.json, keyed by name.
 *
 * @throws {TypeError} When a tier names a package with no usable manifest, or names one twice.
 */
export declare function buildCatalog(
  tiers: CatalogTiers,
  manifests: Map<string, Record<string, unknown>> | Record<string, Record<string, unknown>>,
): Catalog;

/** The record for a package name: a library, the engine, or `undefined`. */
export declare function catalogEntry(
  name: string,
  catalog?: Catalog,
): CatalogLibrary | CatalogEngine | undefined;

/** A field where a package.json and its catalog record disagree. */
export interface CatalogDifference {
  field: "description";
  catalog: string;
  packageJson: string;
}

/**
 * Compare a package.json with its catalog record. Only the description is compared.
 *
 * @throws {TypeError} When the catalog does not list the package.
 */
export declare function compareWithCatalog(
  manifest: Record<string, unknown>,
  catalog?: Catalog,
): CatalogDifference[];

export interface CatalogCheckOptions {
  /** The package directory holding package.json. Default: the working directory. */
  dir?: string;
  /** CLI arguments; `--dir <path>` and `--strict` are accepted. */
  argv?: string[];
  /**
   * Fail on a disagreement (1) or an unlisted package (2) instead of printing a note and exiting
   * 0. Default: false, because keeping the catalog fresh is cosyte/config's job.
   */
  strict?: boolean;
}

/**
 * Run the check over one package directory and return the exit code. Advisory by default: 0 when
 * the description is the catalog's, and 0 with a note when it is not or the package is unlisted.
 * With `strict`, 1 for a disagreement and 2 for an unlisted package. 2 whenever the check could not
 * run. It never exits the process.
 */
export declare function runCatalogCheck(options?: CatalogCheckOptions): 0 | 1 | 2;
