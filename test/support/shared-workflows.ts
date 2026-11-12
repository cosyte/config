import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * WHAT THE PULL REQUEST TITLE TESTS SHARE: the shared title rule, the pin that carries it, and a
 * reader for the titles a dependabot.yml gives Dependabot's pull requests.
 *
 * `test/pr-title-pin.test.ts` reads this repository's own files, `test/shared-workflow-pins.test.ts`
 * reads them beside the parser template's, and `test/scaffold-repo-standards.test.ts` reads what the
 * scaffolder emits. One copy, so the three cannot drift apart.
 */

/** The cosyte/.github commit whose shared title check requires a scope. */
export const SCOPED_COMMIT = "398cd4ded647dddd9f2e220ceb042840f59e1426";

/** The published reference that names SCOPED_COMMIT. */
export const SCOPED_REFERENCE = "workflows-2026-11-10-398cd4ded647";

/** The pattern the shared workflow tests a title against, at SCOPED_COMMIT. */
export const SCOPED_TITLE =
  /^(feat|fix|docs|chore|ci|build|refactor|test|perf|revert|style)\([a-z0-9][a-z0-9._/-]*\)!?: \S/;

/** The `- package-ecosystem:` blocks of a dependabot.yml, each as its own text. */
export const updateBlocks = (text: string): string[] =>
  text.split(/\n(?= {2}- package-ecosystem:)/).slice(1);

/** The ecosystem an update block names, or "" when it names none. */
export const ecosystemOf = (block: string): string =>
  /package-ecosystem: (\S+)/.exec(block)?.[1] ?? "";

/**
 * The titles Dependabot writes for one update block: `prefix(deps): ...` for production updates and
 * `prefix(deps-dev): ...` for development ones when `include: scope` is set, `prefix: ...` without.
 * A block with no `commit-message` gets Dependabot's own default, `Bump ...`.
 */
export const dependabotTitles = (block: string): string[] => {
  const message = /\n {4}commit-message:\n((?: {6}.*\n?)+)/.exec(block)?.[1] ?? "";
  const prefix = /^ {6}prefix: "?([^"\n]+?)"?$/m.exec(message)?.[1];
  if (prefix === undefined) return ["Bump example-package from 1.0.0 to 1.0.1"];
  const dev = /^ {6}prefix-development: "?([^"\n]+?)"?$/m.exec(message)?.[1] ?? prefix;
  const scoped = /^ {6}include: "?scope"?$/m.test(message);
  return scoped
    ? [`${prefix}(deps): bump example-package`, `${dev}(deps-dev): bump example-package`]
    : [`${prefix}: bump example-package`, `${dev}: bump example-package`];
};

/** One `uses: cosyte/.github/...` line: the file it sits in, the workflow, the commit, the name. */
export interface SharedCaller {
  file: string;
  workflow: string;
  commit: string;
  reference: string;
}

/** Every shared-workflow call in one workflow file's text. A line without a name reads as "". */
export const sharedCallers = (file: string, text: string): SharedCaller[] =>
  [
    ...text.matchAll(
      /^\s*(?:- )?uses: cosyte\/\.github\/\.github\/workflows\/([\w.-]+)@(\S+)(?: # (\S+))?\s*$/gm,
    ),
  ].map((m) => ({ file, workflow: m[1] ?? "", commit: m[2] ?? "", reference: m[3] ?? "" }));

/** Every shared-workflow call in the `.yml` files of one workflows directory. */
export const sharedCallersIn = (dir: string, label: string): SharedCaller[] =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".yml"))
    .sort()
    .flatMap((f) => sharedCallers(`${label}/${f}`, readFileSync(join(dir, f), "utf8")));
