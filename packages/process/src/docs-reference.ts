import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  Application,
  type Comment,
  type ContainerReflection,
  Converter,
  type DeclarationReflection,
  Logger,
  LogLevel,
  type ProjectReflection,
  ReflectionKind,
} from "typedoc";

/**
 * `cosyte-docs-reference`: the API reference of a package, generated from its TSDoc comments into
 * `docs-content/api/`, with the check that every public export carries a comment.
 *
 * It runs TypeDoc with the markdown plugin over each entry point the package's `exports` names, one
 * page per module, the same tool docs.cosyte.com renders its reference with. The pages are
 * committed, so a change to the public surface shows in review as a change to them, and `--check`
 * fails when the committed pages no longer match the source.
 *
 * WHAT THE CHECK CATCHES: an export (a function, class, interface, type alias, enum, variable or
 * namespace) with no TSDoc summary, and a committed reference that has drifted from the source. No
 * tag hides an export: one tagged `@internal`, `@hidden` or `@ignore` is checked and shown like any
 * other, since a consumer can still import it. A symbol that is not public is not exported.
 * WHAT IT DOES NOT: a member of a documented export (a property, a method) with no comment, a
 * comment that is wrong, and an `@example` that does not run. Members are left out on purpose: when
 * this was written, TypeDoc's rule with members found 2 to 1,150 gaps per library, against 0 to 3
 * undocumented exports.
 */

/** Where the pages go, relative to the package root. Every file under it is generated. */
export const REFERENCE_DIR = "docs-content/api";

/**
 * The kinds of export that must carry a TSDoc comment: what a package exports, not the members of
 * what it exports.
 *
 * @example
 * REQUIRED_KINDS.includes("Function"); // => true
 */
export const REQUIRED_KINDS = [
  "Namespace",
  "Enum",
  "Variable",
  "Function",
  "Class",
  "Interface",
  "TypeAlias",
] as const;

/**
 * A refusal: the input could not be read, so nothing was generated or checked.
 *
 * @example
 * new ReferenceInputError("no package.json").name; // => "ReferenceInputError"
 */
export class ReferenceInputError extends Error {
  /** @param message - What could not be read, and where. */
  constructor(message: string) {
    super(message);
    this.name = "ReferenceInputError";
  }
}

/** One entry point of a package: an `exports` subpath and the source file behind it. */
export interface EntryPoint {
  /** The subpath, as `exports` writes it: `.` or `./name`. */
  readonly subpath: string;
  /** The absolute path of its source file. */
  readonly file: string;
}

/** What a generation produced. */
export interface ReferenceResult {
  /** Every page, by its path under {@link REFERENCE_DIR}, sorted. */
  readonly files: ReadonlyMap<string, string>;
  /** Each export with no TSDoc summary: `name (Kind), defined in path`, sorted. */
  readonly undocumented: readonly string[];
}

/**
 * The entry points a package's `exports` names, each mapped to its source by our layout: `.` is
 * `src/index.ts`, and `./name` is `src/name/index.ts` or `src/name.ts`. A JSON subpath is skipped.
 *
 * @param cwd - The package root.
 * @returns The entry points, in the order `exports` lists them.
 * @throws {@link ReferenceInputError} When package.json cannot be read, a subpath is a pattern, or
 *   a subpath has no source.
 * @example
 * entryPointsFor("/repo/hl7")[0]; // => { subpath: ".", file: "/repo/hl7/src/index.ts" }
 */
export function entryPointsFor(cwd: string): EntryPoint[] {
  const manifestPath = join(cwd, "package.json");
  let text: string;
  try {
    // Stryker disable next-line StringLiteral: equivalent, JSON.parse reads a Buffer as UTF-8 text.
    text = readFileSync(manifestPath, "utf8");
  } catch {
    throw new ReferenceInputError(`${manifestPath} could not be read`);
  }
  let manifest: { exports?: unknown };
  try {
    manifest = JSON.parse(text) as { exports?: unknown };
  } catch {
    throw new ReferenceInputError(`${manifestPath} is not JSON`);
  }
  const exportsField = manifest.exports;
  const subpaths =
    typeof exportsField === "object" && exportsField !== null ? Object.keys(exportsField) : ["."];
  const entries: EntryPoint[] = [];
  for (const subpath of subpaths) {
    if (subpath.endsWith(".json")) continue;
    if (subpath.includes("*")) {
      throw new ReferenceInputError(
        `the export "${subpath}" is a pattern; list each subpath the reference should cover`,
      );
    }
    if (subpath === ".") {
      entries.push({ subpath, file: join(cwd, "src", "index.ts") });
      continue;
    }
    // `join` drops the leading "./" of the subpath.
    const candidates = [join(cwd, "src", subpath, "index.ts"), join(cwd, "src", `${subpath}.ts`)];
    const file = candidates.find((candidate) => existsSync(candidate));
    if (file === undefined) {
      throw new ReferenceInputError(
        `the export "${subpath}" has no source: neither ${candidates[0]} nor ${candidates[1]} exists`,
      );
    }
    entries.push({ subpath, file });
  }
  return entries;
}

/** A TypeDoc logger that keeps its warnings and errors instead of printing them. @internal */
class CollectingLogger extends Logger {
  /** The warnings and errors, in the order TypeDoc reported them. */
  readonly messages: string[] = [];

  override log(message: string, level: LogLevel): void {
    if (level >= LogLevel.Warn) this.messages.push(message);
  }
}

/** Whether a comment has a summary. TypeDoc trims a summary, so one with no words is empty. @internal */
function hasSummary(comment: Comment | undefined): boolean {
  return comment !== undefined && comment.summary.length > 0;
}

/**
 * Each export of a project with no TSDoc summary, walking into namespaces and, for a package with
 * several entry points, into each module. A function counts as documented when its declaration or
 * any of its signatures has a summary. Members of an export are walked too, but none of them is of a
 * required kind, so none is reported.
 *
 * @internal
 */
function undocumentedExports(project: ProjectReflection): string[] {
  const required = REQUIRED_KINDS.map((kind) => ReflectionKind[kind]);
  const found: string[] = [];
  const visit = (container: ContainerReflection, prefix: string): void => {
    for (const child of container.children ?? []) {
      if (child.kindOf(ReflectionKind.Module)) {
        visit(child, "");
        continue;
      }
      if (!required.some((kind) => child.kindOf(kind))) continue;
      const name = `${prefix}${child.name}`;
      if (!isDocumented(child)) {
        found.push(`${name} (${ReflectionKind[child.kind]}), defined in ${sourceOf(child)}`);
      }
      visit(child, `${name}.`);
    }
  };
  visit(project, "");
  return found.sort();
}

/** Whether an export has a summary on itself or on one of its signatures. @internal */
function isDocumented(reflection: DeclarationReflection): boolean {
  return (
    hasSummary(reflection.comment) ||
    reflection.signatures?.some((signature) => hasSummary(signature.comment)) === true
  );
}

/** The file an export is declared in, relative to the package root. @internal */
function sourceOf(reflection: DeclarationReflection): string {
  // Stryker disable next-line all: TypeDoc records a source for every declaration it converts
  // while sources are on, so neither the optional chains nor the fallback is ever exercised.
  return reflection.sources?.[0]?.fileName ?? "an unknown file";
}

/** The tags with which TypeDoc leaves a reflection out of its output. @internal */
const HIDING_TAGS = ["@hidden", "@ignore"] as const;

/**
 * Take the hiding tags off every reflection before TypeDoc reads them, so an export it would leave
 * out stays in the pages and in the documented check. TypeDoc reads them when it begins resolving,
 * so this listener runs ahead of its own. `@internal` hides only under `excludeInternal`, which is off.
 *
 * @internal
 */
function keepHiddenReflections(app: Application): void {
  app.converter.on(
    Converter.EVENT_RESOLVE_BEGIN,
    (context) => {
      // Every reflection is registered here, a function's signatures among them.
      for (const reflection of Object.values(context.project.reflections)) {
        for (const tag of HIDING_TAGS) reflection.comment?.removeModifier(tag);
      }
    },
    1,
  );
}

/** The markdown plugin, resolved from this package so a consumer need not install it. @internal */
const MARKDOWN_PLUGIN = fileURLToPath(import.meta.resolve("typedoc-plugin-markdown"));

/**
 * Every file under a directory, by its `/`-separated path relative to it, in the order of a walk
 * that lists each directory by name.
 *
 * @internal
 */
function readTree(root: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (relativeDir: string): void => {
    for (const entry of readdirSync(join(root, relativeDir), { withFileTypes: true })) {
      const path = relativeDir === "" ? entry.name : `${relativeDir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else files.set(path, readFileSync(join(root, path), "utf8"));
    }
  };
  if (existsSync(root)) walk("");
  return files;
}

/**
 * Generate the reference pages for a package and find its undocumented exports. Nothing is written
 * to the package: the pages are generated in a temporary directory and returned.
 *
 * @param cwd - The package root.
 * @returns The pages and the undocumented exports.
 * @throws {@link ReferenceInputError} When the entry points cannot be read or TypeDoc cannot
 *   convert the source.
 * @example
 * (await buildReference("/repo/hl7")).undocumented; // => []
 */
export async function buildReference(cwd: string): Promise<ReferenceResult> {
  const entries = entryPointsFor(cwd);
  const tsconfig = join(cwd, "tsconfig.json");
  if (!existsSync(tsconfig)) throw new ReferenceInputError(`${tsconfig} does not exist`);
  // Stryker disable next-line StringLiteral: equivalent, the prefix only names the folder.
  const out = mkdtempSync(join(tmpdir(), "cosyte-docs-reference-"));
  try {
    const options = {
      entryPoints: entries.map((entry) => entry.file),
      tsconfig,
      plugin: [MARKDOWN_PLUGIN],
      out,
      // Stryker disable next-line StringLiteral: equivalent, English is TypeDoc's default.
      lang: "en",
      logLevel: LogLevel.Warn,
      // Stryker disable next-line StringLiteral: equivalent today, as TypeDoc puts no README into a
      // page per module; kept so a change of that default cannot add one.
      readme: "none",
      excludeExternals: true,
      // No tag hides a public export (keepHiddenReflections takes care of the others).
      excludeInternal: false,
      skipErrorChecking: true,
      githubPages: false,
      basePath: cwd,
      // typedoc-plugin-markdown: one page per module, no breadcrumbs or page header, and angle
      // brackets and braces in comments escaped so each page compiles as MDX.
      router: "module",
      hidePageHeader: true,
      hideBreadcrumbs: true,
      sanitizeComments: true,
    };
    const app = await Application.bootstrapWithPlugins(options);
    if (app.logger.hasErrors()) {
      throw new ReferenceInputError("TypeDoc could not read its options (its errors are above)");
    }
    const logger = new CollectingLogger();
    app.logger = logger;
    keepHiddenReflections(app);
    const project = await app.convert();
    if (project === undefined) {
      throw new ReferenceInputError(
        `TypeDoc could not read the source: ${logger.messages.join("; ")}`,
      );
    }
    const undocumented = undocumentedExports(project);
    // The sources are read for the findings above and left out of the pages: a "Defined in" line
    // carries a line number, which would make every edit to a source file a change to the pages.
    for (const reflection of Object.values(project.reflections)) {
      delete (reflection as DeclarationReflection).sources;
    }
    await app.generateOutputs(project);
    return { files: readTree(out), undocumented };
  } finally {
    rmSync(out, { recursive: true });
  }
}

/**
 * Compare generated pages with the pages in a directory.
 *
 * @param expected - The pages the source generates, by path.
 * @param dir - The directory holding the committed pages.
 * @returns One line per page that is missing, differs or is not generated, sorted.
 * @example
 * compareReference(new Map([["README.md", "# x"]]), "/nowhere"); // => ["README.md: missing"]
 */
export function compareReference(expected: ReadonlyMap<string, string>, dir: string): string[] {
  const actual = readTree(dir);
  const findings: string[] = [];
  for (const [path, text] of expected) {
    const committed = actual.get(path);
    if (committed === undefined) findings.push(`${path}: missing`);
    else if (committed !== text) {
      findings.push(`${path}: differs from what the source generates`);
    }
  }
  for (const path of actual.keys()) {
    if (!expected.has(path)) findings.push(`${path}: not generated from the source`);
  }
  return findings.sort();
}

/** A stream the command writes to. */
export interface ReferenceStream {
  write(text: string): unknown;
}

/** Options for {@link runDocsReference}. */
export interface DocsReferenceOptions {
  /** The package root. Defaults to `process.cwd()`. */
  readonly cwd?: string;
  /** Where the clean report goes. Defaults to `process.stdout`. */
  readonly stdout?: ReferenceStream;
  /** Where findings and refusals go. Defaults to `process.stderr`. */
  readonly stderr?: ReferenceStream;
}

/**
 * The command line: write the reference, or with `--check` compare it, and report undocumented
 * exports.
 *
 * @param argv - Arguments after the bin name; only `--check` is accepted.
 * @param options - The package root and the streams.
 * @returns 0 clean, 1 a finding, 2 the input could not be read or the pages could not be written.
 * @example
 * await runDocsReference(["--check"], { cwd: "/repo/hl7" }); // => 0 when the pages are current
 */
export async function runDocsReference(
  argv: readonly string[],
  options: DocsReferenceOptions = {},
): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const unknown = argv.find((arg) => arg !== "--check");
  if (unknown !== undefined) {
    stderr.write(
      `docs-reference: ${JSON.stringify(unknown)} is not an argument (only --check). Nothing was generated.\n`,
    );
    return 2;
  }
  const check = argv.includes("--check");
  const target = join(cwd, REFERENCE_DIR);
  let stale: string[] = [];
  let result: ReferenceResult;
  try {
    const docs = dirname(target);
    if (!existsSync(docs)) throw new ReferenceInputError(`${docs} is not a directory.`);
    result = await buildReference(cwd);
    if (check) {
      stale = compareReference(result.files, target);
    } else {
      rmSync(target, { recursive: true, force: true });
      for (const [path, text] of result.files) {
        mkdirSync(dirname(join(target, path)), { recursive: true });
        writeFileSync(join(target, path), text);
      }
    }
  } catch (error) {
    const message = (error as Error).message;
    stderr.write(
      `docs-reference: ${message}${message.endsWith(".") ? "" : "."} Nothing was generated.\n`,
    );
    return 2;
  }
  const where = relative(cwd, target);
  if (stale.length > 0) {
    stderr.write(
      `docs-reference: ${where} does not match the source:\n` +
        stale.map((line) => `  ${line}\n`).join("") +
        `docs-reference: run cosyte-docs-reference and commit ${where}\n`,
    );
  }
  if (result.undocumented.length > 0) {
    stderr.write(
      `docs-reference: ${String(result.undocumented.length)} export(s) without a TSDoc comment:\n` +
        result.undocumented.map((line) => `  ${line}\n`).join(""),
    );
  }
  if (!check) {
    stdout.write(
      `docs-reference: wrote ${String(result.files.size)} page(s) to ${where}` +
        (result.undocumented.length === 0 ? "; every export is documented\n" : "\n"),
    );
  } else if (stale.length === 0 && result.undocumented.length === 0) {
    stdout.write(`docs-reference: ${where} matches the source; every export is documented\n`);
  }
  return stale.length > 0 || result.undocumented.length > 0 ? 1 : 0;
}
