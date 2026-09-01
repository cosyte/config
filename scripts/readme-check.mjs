#!/usr/bin/env node
// scripts/readme-check.mjs
//
// GRADE THIS REPOSITORY'S OWN READMEs AGAINST THE HOUSE SKELETON, SO THE SHAPE IS ENFORCED RATHER
// THAN ASSERTED.
//
// THE DEFECT THIS EXISTS FOR. This repository publishes eight `@cosyte/*` packages and a README is
// inside every one of their `files` arrays, so the text is FROZEN INTO THE TARBALL at publish time
// and a wrong string can be corrected only by publishing again. Before this gate, not one of the
// nine READMEs carried the Cosyte banner, a badge row, a tagline, or the `Why this exists`,
// `Status`, `PHI and safety`, `Contributing` or `License` sections, and the repo README pointed a
// public reader at an internal path that does not exist. A reader arriving from npm got an
// unbranded page that could not tell them what the package claims or whether it is safe to depend
// on. Rewriting the nine files fixes the instance. This fixes the class.
//
// SCOPE, STATED SO IT IS NOT ASSUMED. This grades THIS repository's own READMEs only. It is not the
// estate-wide README gate and it deliberately does not read `drift-manifest.json`: generalizing the
// shape to the other repos is a separate change with its own operator-derived provenance note.
//
// THE GOVERNED SET IS DERIVED FROM THE WORKSPACE AT RUN TIME, NEVER HARDCODED, and that is the half
// of this gate that keeps working after it is written. A hardcoded list of nine paths grades nine
// paths forever: add a tenth package with no README and the gate stays green over it, which is the
// silent-skip shape every other gate in this repo is built to refuse. So the set is the root plus
// every directory under `packages/` that carries a `package.json`, and a governed README that is
// absent is a REFUSAL rather than a skip.
//
// WHAT "BYTE-IDENTICAL" MEANS FOR THE DESCRIPTION, because this is the one place where a literal
// reading would be wrong. Prettier owns markdown formatting in this repo and it ESCAPES markdown
// punctuation in prose: every one of the nine descriptions contains `@cosyte/*`, and Prettier
// rewrites that to `@cosyte/\*`. Measured, not predicted. So the README line is unescaped back to
// its rendered text before it is compared to `package.json`'s `description`, and the comparison is
// then byte-for-byte with no normalization of case, spacing or punctuation. Fighting Prettier here
// would mean a gate that reds on `pnpm format`, which is a gate nobody keeps.
//
// A PROSE CLAIM IS READ OUT OF THE PROSE, NOT OUT OF A URL. Every README here ends with the ABSOLUTE
// link to the repo-root `LICENSE` the house skeleton mandates, and that URL contains the owner's own
// name: `https://github.com/cosyte/config/blob/main/LICENSE`. A check that searched the raw section
// for `Cosyte` therefore passed on a README crediting NOBODY, which made the attribution
// requirement unfailable for exactly the eight files that reach npm. So the `## License` claims are
// graded against `stripLinkTargets()` output: labels a reader sees survive, and destinations,
// reference definitions, autolinks, bare URLs and HTML link attributes do not.
//
// THE `## Status` SECTION IS GRADED AGAINST THE EFFECTIVE RELEASE LINE, NOT THE BARE MANIFEST
// VERSION, and that distinction is the whole of why this section is checkable at all.
//
// A package's EFFECTIVE RELEASE LINE is the `major.minor` it will carry once the changesets already
// sitting in `.changeset/` have been applied to its manifest version. Manifest `0.0.4` with a
// pending `minor` naming it is the `0.1.x` line; manifest `0.0.4` with only `patch` entries, or
// none, is the `0.0.x` ladder. The pending bumps are read here rather than assumed because they
// move ONE MERGE BEFORE the manifests do: `changeset version` is a separate commit made by the
// release owner, so between the tree that decides a package's release policy and the tree that
// carries the bumped number there is a window in which the manifest still reads `0.0.4` and the
// README has to be allowed to state the policy that tree just made true. Keying on the bare
// manifest version closes that window by refusing the truth.
//
// THE ROOT PACKAGE HAS NO LINE OF ITS OWN AND ITS LINE IS DERIVED. `cosyte-config` is
// `private: true`, pinned at `0.0.0` and never versioned by Changesets (RELEASING.md, and ci.yml's
// note on why this repo is not a thin caller of the shared workflow), so its own `version` can
// never leave `0.0.0` and grading its README against that number would pin the root to the `0.0.x`
// ladder forever, through every release this repository will ever make. Its line is instead the one
// the published packages are on WHEN THEY AGREE, and when they do not agree it is unresolvable and
// this gate refuses rather than picking one.
//
// WHY THE PENDING BUMPS ARE READ HERE RATHER THAN IMPORTED. scripts/changeset-guard.mjs reads
// `.changeset/` with the same frontmatter regex `@changesets/parse@0.4.3` uses and holds the same
// exit contract, and the reading below is deliberately the same reading. It is a second copy rather
// than a shared import because the two gates answer different questions of the same file and refuse
// on different things: an unknown package name is a VIOLATION to the guard (a changeset that bumps
// nothing) and an UNGROUNDED PREMISE here (a release line that cannot be resolved), so folding them
// together would make one gate's exit contract the other's. The regex is itself a copy of the
// parser's, for the reason stated there: a reader that disagrees with the real parser about where
// the frontmatter ends is worse than a second copy of one that does not.
//
// Usage:
//   node scripts/readme-check.mjs [--workspace <repo-root>]
//
// Exit codes, which are a contract and are asserted by test/readme-check.test.ts:
//   0  every governed README carries the house skeleton
//   1  at least one governed README violates it (the refusal this gate exists for)
//   2  the check could not run (bad invocation, a governed README absent or unreadable, a
//      `package.json` beside one missing or unparseable, a workspace layout this cannot ground on,
//      or an effective release line it cannot resolve: `.changeset/` unreadable, a changeset whose
//      frontmatter does not resolve to packages and bump types, a changeset naming a package this
//      workspace does not have, published packages that disagree about their line, or a line this
//      gate has no Status sentence for)
//
// The 1-versus-2 split is the same contract scripts/changeset-guard.mjs holds and it matters for
// the same reason: a gate that cannot read its input must not report the same code as a gate that
// read it and found a violation, or "broken" and "caught something" become one signal in CI. A
// checker that cannot ground its own premise NEVER reports clean.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

// Imported by RELATIVE PATH, not as `@cosyte/script-utils`, for the same reason
// scripts/changeset-guard.mjs does it: the gates in this repo run before `pnpm install` in CI, so
// there is no `node_modules` for a bare specifier to resolve through. Same file, same contents,
// published for the other repos to use.
import { isCliEntrypoint } from "../packages/script-utils/index.js";

/** Thrown for an invocation or environment problem: exit 2, never exit 1. */
class InvocationError extends Error {}

/**
 * The Cosyte banner, required byte-identical and first in every governed README.
 *
 * The tiles are GENERATED by the assets repo and the alt string is central in its `alt-text.json`,
 * so neither is hand-written here: this constant is a copy of the declaration, and a README that
 * disagrees with it is the thing being refused. The URLs stay ABSOLUTE because npm does not resolve
 * relative images, and the `<img>` fallback carries the LIGHT tile so a renderer that drops
 * `<source>` still shows something.
 */
export const BANNER = [
  '<a href="https://cosyte.com">',
  "  <picture>",
  '    <source media="(prefers-color-scheme: dark)" srcset="https://cosyte.com/tile/cosyte-lockup-tile-on-dark-1200x300.png">',
  '    <img alt="The Cosyte logo on its own white ground: the icon beside the word Cosyte." src="https://cosyte.com/tile/cosyte-lockup-tile-on-light-1200x300.png">',
  "  </picture>",
  "</a>",
].join("\n");

/** Where a reader is told to ask. Required in every `## Contributing` section. */
export const ISSUES_URL = "https://github.com/cosyte/config/issues";

/** The CI badge, identical in all nine files. */
const CI_BADGE =
  "[![CI](https://img.shields.io/github/actions/workflow/status/cosyte/config/ci.yml?branch=main&label=CI)](https://github.com/cosyte/config/actions/workflows/ci.yml)";

/**
 * The License badge. Its target is ABSOLUTE because no package ships its own `LICENSE` file (the
 * only one is at the repo root), so a relative link would break on npm.
 */
const LICENSE_BADGE =
  "[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/cosyte/config/blob/main/LICENSE)";

/**
 * The required `##` headings, in the order they must appear. `## License` is additionally required
 * to be the LAST heading in the file. Other headings (`## API`, `## Compatibility`, and anything
 * else a package needs) may sit between them; what is graded is that these seven are present, in
 * this relative order, and that License closes the file.
 */
export const REQUIRED_HEADINGS = [
  "Why this exists",
  "Status",
  "Install",
  "Usage",
  "PHI and safety",
  "Contributing",
  "License",
];

/** A tagline is a hook, not a paragraph. The template's ceiling. */
const TAGLINE_LIMIT = 120;

/** GitHub truncates past this, so a README that exceeds it stops being readable where it matters. */
const SIZE_LIMIT_BYTES = 500 * 1024;

/**
 * Umbrella meta-repo surfaces a PUBLIC reader must never be pointed at.
 *
 * Note what is NOT here: a bare `documentation/` path. This repository has its own `documentation/`
 * directory holding its ADRs, and those pointers are legitimate and are preserved. What is refused
 * is a path that only exists inside the private meta-repo, of which
 * `documentation/conventions.md` is the one this repo actually shipped: it does not exist, and by
 * operator decision none is to be written. The standard these packages encode is
 * `drift-manifest.json`, which says so itself.
 */
const UMBRELLA_REFERENCES = [
  [/documentation\/conventions\.md/i, "documentation/conventions.md"],
  [/\bmeta-repo\b/i, "meta-repo"],
  [/\bmeta repo\b/i, "meta repo"],
  [/\bumbrella repo(?:sitory)?\b/i, "umbrella repo"],
  [/\bwork\/(?:specs|backlog|inbox|archive)\//i, "work/ stage directory"],
  [/sdd-umbrella-blueprint/i, "sdd-umbrella-blueprint"],
  [/\bcards\/[a-z0-9][a-z0-9-]*\.md\b/i, "cards/<repo>.md"],
];

/**
 * Release-cadence, release-frequency and support-window claims.
 *
 * `S0161-release-frequency-policy` owns that policy and has not landed, so a README that guesses it
 * would have to be rewritten when it does. Stated honestly: this is a keyword tripwire over the
 * phrases a README plausibly uses, not a semantic classifier. It cannot catch a cadence expressed in
 * a sentence nobody anticipated, and it is not claimed to. It errs toward refusing, which is the
 * safe direction for a string that publishes to npm.
 */
const CADENCE_CLAIMS = [
  [/\brelease cadence\b/i, "a release cadence"],
  [/\brelease schedule\b/i, "a release schedule"],
  [/\breleas(?:e|ed|es) (?:every|each) \w+/i, "a release frequency"],
  [
    /\b(?:weekly|monthly|quarterly|biweekly|fortnightly|nightly|daily) releases?\b/i,
    "a release frequency",
  ],
  [/\bevery (?:\d+|two|three|four|six|twelve) (?:days?|weeks?|months?)\b/i, "a release frequency"],
  [/\bsupport window\b/i, "a support window"],
  [/\bmaintenance window\b/i, "a support window"],
  [/\bsupported (?:for|until)\b/i, "a support window"],
  [/\bend[- ]of[- ]life\b/i, "a support window"],
  [/\bsupport(?:s|ed)? (?:for )?\d+ (?:months?|years?)\b/i, "a support window"],
];

/**
 * Claims a README on the `0.0.x` ladder must not make about its public API.
 *
 * Refused on the `0.0.x` line ONLY. On a settled line the required Status sentence itself says the
 * public API is settled, so a gate that refused the wording everywhere would refuse the sentence it
 * compels.
 */
const SETTLED_API_CLAIMS = [
  /\b(?:public )?API is (?:settled|stable|frozen|final)\b/i,
  /\bstable (?:public )?API\b/i,
  /\bsettled (?:public )?API\b/i,
  /\bsafe to depend on\b/i,
  /\bAPI (?:will not|won't) change\b/i,
];

/**
 * Assertions of the `0.0.x` ladder, refused ANYWHERE in a README whose package has left that line.
 *
 * The Status sentence is not the only place a README states this policy: the root README states it
 * again under `## Versioning`, in the other form written here, and a package README may repeat it
 * in prose. A gate that graded only the opening sentence would let a retired policy claim survive
 * three lines further down, inside the same tarball, contradicting the version printed beside it.
 *
 * Narrow by construction, and that is the point. Both patterns require the WORDS that make the
 * mention a POLICY CLAIM (`ladder`, or `until ... alpha`) next to the number. A README that says a
 * surface is "not covered by a stability promise at `0.0.x`", or that a package "is on its own
 * `0.0.x` version", is stating a fact about a version rather than asserting the ladder, and is left
 * alone. Erring the other way would refuse honest prose that merely names the number.
 */
const RETIRED_LADDER_CLAIMS = [
  [/\b0\.0\.x\b[^\n]{0,60}?\bladder\b/i, "the cosyte 0.0.x ladder"],
  [/\bladder\b[^\n]{0,60}?\b0\.0\.x\b/i, "the cosyte 0.0.x ladder"],
  [/\b0\.0\.x\b[^\n]{0,40}?\buntil\b[^\n]{0,40}?\balpha\b/i, "the 0.0.x-until-first-alpha ladder"],
];

/** Files in `.changeset/` that are configuration or prose, never changesets. */
const NOT_A_CHANGESET = new Set(["README.md", "config.json"]);

/**
 * `validVersionTypes` from `@changesets/parse@0.4.3`, ranked so that the strongest pending bump on a
 * package is the one that decides its line, which is what `@changesets/assemble-release-plan` does.
 */
const RELEASE_TYPE_RANK = new Map([
  ["none", 0],
  ["patch", 1],
  ["minor", 2],
  ["major", 3],
]);

/**
 * Undo the markdown escaping Prettier applies to prose.
 *
 * CommonMark lets a backslash escape any ASCII punctuation character, and that is exactly the set
 * Prettier reintroduces. Undoing it is what makes the description comparison a comparison of
 * RENDERED TEXT rather than of source bytes, which is the only version of "identical to the
 * manifest string" that survives `pnpm format`.
 *
 * @param {string} value Markdown source text.
 * @returns {string} The text as it renders.
 */
export function unescapeMarkdown(value) {
  return value.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~\\])/g, "$1");
}

/**
 * Markdown with every link and image TARGET removed, leaving the text a reader actually sees.
 *
 * WHY THIS EXISTS, written down so it is not simplified away. A URL is machine address, not prose,
 * and the two must never be confused when what is being graded is a CLAIM THE README MAKES. The
 * `## License` section of all eight published READMEs ends with the absolute link this repository
 * mandates, `https://github.com/cosyte/config/blob/main/LICENSE`, and the owner's name sits inside
 * that URL. Searching the raw section for `Cosyte` therefore matched the address rather than the
 * attribution, so the owner requirement could not fail on any README carrying the link the skeleton
 * REQUIRES: the check was dead code on precisely the files that publish. Deleting the attribution
 * left the gate green. What survives here is what a reader reads: link and image LABELS, and prose.
 * What goes is every address: inline destinations and titles, reference definitions, autolinks,
 * bare URLs, and the HTML attributes that carry a target.
 *
 * Each target becomes a SPACE rather than nothing, so stripping can never fuse two words into a
 * third that neither of them was.
 *
 * @param {string} value Markdown source text.
 * @returns {string} The same text with link targets removed.
 */
export function stripLinkTargets(value) {
  return (
    value
      // `[label]: https://example.com "title"` reference definitions, which are pure address.
      .replace(/^ {0,3}\[[^\]]*\]:.*$/gm, " ")
      // `[label](destination "title")` and `![alt](destination)`; the label and alt survive.
      .replace(/\]\((?:[^()\\]|\\.|\([^()]*\))*\)/g, "] ")
      // `<https://example.com>` and `<user@example.com>` autolinks.
      .replace(/<(?:[a-z][a-z0-9+.-]*:|[^\s<>@]+@)[^\s<>]*>/gi, " ")
      // HTML attributes that carry a target. `alt` is deliberately NOT here: it is read aloud.
      .replace(
        /\b(?:href|src|srcset|cite|action|formaction|poster|data)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
        " ",
      )
      // A bare URL pasted into prose.
      .replace(/\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)\S+/gi, " ")
  );
}

/**
 * Mark every line that sits inside a fenced code block.
 *
 * Headings are only headings outside a fence. This repo's own READMEs already contain fenced blocks
 * that hold `#` comment lines and a nested ```` ```md ```` fence, so a naive line scan would invent
 * headings that no reader sees.
 *
 * @param {string[]} lines The file's lines.
 * @returns {boolean[]} One flag per line: `true` when the line is a fence delimiter or inside one.
 */
export function fenceMask(lines) {
  const mask = new Array(lines.length).fill(false);
  let openFence = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (openFence === null) {
      if (match !== null) {
        openFence = match[1] ?? "";
        mask[i] = true;
      }
      continue;
    }
    mask[i] = true;
    if (
      match !== null &&
      (match[1] ?? "").charAt(0) === openFence.charAt(0) &&
      (match[1] ?? "").length >= openFence.length &&
      line.trim() === (match[1] ?? "")
    ) {
      openFence = null;
    }
  }
  return mask;
}

/**
 * The `##` headings of a README, in file order, with the line range each one owns.
 *
 * @param {string[]} lines The file's lines.
 * @param {boolean[]} mask The fence mask.
 * @returns {{ title: string, line: number, start: number, end: number }[]} Sections in file order.
 */
export function sectionsOf(lines, mask) {
  const found = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (mask[i] === true) continue;
    const match = /^## +(.+?)\s*$/.exec(lines[i] ?? "");
    if (match !== null)
      found.push({ title: (match[1] ?? "").trim(), line: i, start: i + 1, end: 0 });
  }
  for (let i = 0; i < found.length; i += 1) {
    const next = found[i + 1];
    const current = found[i];
    if (current !== undefined) current.end = next === undefined ? lines.length : next.line;
  }
  return found;
}

/**
 * Index of the next line at or after `from` that holds something other than whitespace.
 *
 * @param {string[]} lines The file's lines.
 * @param {number} from Where to start looking.
 * @returns {number} The index, or `lines.length` when there is none.
 */
function nextNonBlank(lines, from) {
  let i = from;
  while (i < lines.length && (lines[i] ?? "").trim() === "") i += 1;
  return i;
}

/**
 * The run of consecutive non-blank lines starting at `from`.
 *
 * @param {string[]} lines The file's lines.
 * @param {number} from Where the block starts.
 * @returns {string[]} The block's lines.
 */
function blockAt(lines, from) {
  const block = [];
  let i = from;
  while (i < lines.length && (lines[i] ?? "").trim() !== "") {
    block.push(lines[i] ?? "");
    i += 1;
  }
  return block;
}

/**
 * A package's EFFECTIVE Node floor: its own declared range when it has one, the root's otherwise.
 *
 * The floors in this workspace genuinely DIVERGE and this gate does not reconcile them; changing a
 * published package's declared engine range is a behaviour change with a changeset. What is graded
 * is that a README REPORTS what is true of its own package today.
 *
 * @param {Record<string, unknown>} manifest The package manifest.
 * @param {string} rootFloor The root manifest's `engines.node`.
 * @returns {string} The effective floor, for example `>=22.14`.
 */
export function effectiveFloor(manifest, rootFloor) {
  const engines = manifest.engines;
  if (engines !== null && typeof engines === "object" && typeof engines.node === "string") {
    return engines.node;
  }
  return rootFloor;
}

/**
 * The Node badge for a floor, in the URL-encoded form shields.io needs.
 *
 * @param {string} floor The effective floor, for example `>=22.14`.
 * @returns {string} The badge line.
 */
export function nodeBadge(floor) {
  const label = `node-${floor.replaceAll(">", "%3E").replaceAll("=", "%3D")}`;
  return `[![Node](https://img.shields.io/badge/${label}-brightgreen.svg)](https://nodejs.org)`;
}

/**
 * The house badge row for one package, in the required order.
 *
 * The npm version badge is present IF AND ONLY IF the package publishes. The root manifest is
 * `private: true`, so no npm page exists to link and a version badge there would render broken
 * forever.
 *
 * @param {{ name: string, isPrivate: boolean, floor: string }} pkg The package's facts.
 * @returns {string[]} The expected badge lines, in order.
 */
export function expectedBadges({ name, isPrivate, floor }) {
  const badges = [];
  if (!isPrivate) {
    badges.push(
      `[![npm version](https://img.shields.io/npm/v/${name}.svg)](https://www.npmjs.com/package/${name})`,
    );
  }
  badges.push(CI_BADGE, LICENSE_BADGE, nodeBadge(floor));
  return badges;
}

/**
 * Split a changeset file into its frontmatter block and the rest.
 *
 * This is the SAME regex `@changesets/parse@0.4.3` uses (`mdRegex` in its source) and the same one
 * scripts/changeset-guard.mjs copies, for the reason stated there: a reader that disagrees with the
 * real parser about where the frontmatter ends would resolve a release line the pipeline does not.
 *
 * @param {string} contents Raw file contents.
 * @returns {string | null} The frontmatter block, or `null` when there is none.
 */
function changesetFrontmatter(contents) {
  const match = /\s*---([^]*?)\n\s*---(\s*(?:\n|$)[^]*)/.exec(contents);
  if (match === null) return null;
  return match[1] ?? "";
}

/**
 * Read the `name: type` pairs out of one changeset's frontmatter block.
 *
 * Deliberately a LINE parser rather than a YAML one, because this gate runs before
 * `pnpm install --frozen-lockfile` in ci.yml and so may take no dependency. That is a real
 * limitation and it is bounded in the safe direction: a frontmatter shape this cannot read is
 * reported as unresolvable (exit 2), never as a package with no pending bump, which would grade a
 * README against a release line this never confirmed.
 *
 * @param {string} frontmatter The text between the `---` delimiters.
 * @param {string} file The changeset's basename, named in every diagnostic.
 * @returns {{ name: string, type: string }[]} One entry per declared release.
 */
function parseReleases(frontmatter, file) {
  const releases = [];
  for (const rawLine of frontmatter.split("\n")) {
    const line = rawLine.replace(/(^|\s)#.*$/, "$1").trim();
    if (line === "") continue;
    const match = /^(?:"([^"]+)"|'([^']+)'|([^:]+?))\s*:\s*(\S+)\s*$/.exec(line);
    if (match === null) {
      throw new InvocationError(
        `cannot read the frontmatter line ${JSON.stringify(line)} of .changeset/${file}. This ` +
          `reads only the one-pair-per-line form changesets itself writes. Refusing to guess: a ` +
          `frontmatter it cannot resolve must not be reported as one that declared no bump.`,
      );
    }
    // Unquoted for the same reason scripts/changeset-guard.mjs unquotes it: `@changesets/parse`
    // hands the block to js-yaml, which strips quotes, so `"minor"` and `minor` are one value to
    // the real pipeline and must be one value here.
    const type = (match[4] ?? "").trim().replace(/^["'](.*)["']$/, "$1");
    if (!RELEASE_TYPE_RANK.has(type)) {
      throw new InvocationError(
        `.changeset/${file} declares the release type ${JSON.stringify(type)}, which is not one ` +
          `of ${[...RELEASE_TYPE_RANK.keys()].join(", ")}. @changesets/parse throws on this, so ` +
          `the bump it would apply cannot be resolved and no release line can be derived from it.`,
      );
    }
    releases.push({ name: (match[1] ?? match[2] ?? match[3] ?? "").trim(), type });
  }
  return releases;
}

/**
 * Every release declared by the changesets pending in a directory.
 *
 * An absent or unreadable `.changeset/` is a REFUSAL rather than "no pending bumps": the two look
 * identical from the outside and mean opposite things, and reporting them the same way would grade
 * every README against a line this gate never read.
 *
 * @param {string} changesetDir The `.changeset` directory.
 * @returns {{ name: string, type: string, file: string }[]} Every declared release, with its file.
 */
export function pendingReleases(changesetDir) {
  let entries;
  try {
    entries = readdirSync(changesetDir);
  } catch (cause) {
    throw new InvocationError(
      `cannot read the changeset directory ${changesetDir}: ${String(cause)}. The pending bumps ` +
        `are half of every package's effective release line, so a gate that could not read them ` +
        `must not report what one that read them and found none reports.`,
    );
  }

  const files = entries
    .filter((entry) => entry.endsWith(".md") && !NOT_A_CHANGESET.has(basename(entry)))
    .sort();

  const releases = [];
  for (const file of files) {
    let contents;
    try {
      contents = readFileSync(join(changesetDir, file), "utf8");
    } catch (cause) {
      throw new InvocationError(`cannot read the changeset .changeset/${file}: ${String(cause)}`);
    }
    const frontmatter = changesetFrontmatter(contents);
    if (frontmatter === null) {
      throw new InvocationError(
        `.changeset/${file} has no \`---\` frontmatter block, so the packages and bump types it ` +
          `declares cannot be resolved. @changesets/parse throws on this shape.`,
      );
    }
    for (const release of parseReleases(frontmatter, file)) {
      releases.push({ name: release.name, type: release.type, file });
    }
  }
  return releases;
}

/**
 * A manifest version with one release type applied, the way `semver.inc` applies it.
 *
 * Only plain `major.minor.patch` releases are read. A prerelease or a version this cannot parse is
 * a REFUSAL: which line `0.1.0-next.3` lands on is a question with more than one defensible answer,
 * and a gate that picked one silently would grade a published Status sentence against a guess.
 *
 * @param {string} version The manifest version.
 * @param {string} type One of `major`, `minor`, `patch`, `none`.
 * @param {string} what What the version belongs to, for the diagnostic.
 * @returns {{ major: number, minor: number, patch: number }} The version after the bump.
 */
export function bumpedVersion(version, type, what) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (match === null) {
    throw new InvocationError(
      `${what} declares the version ${JSON.stringify(version)}, which this gate cannot resolve to ` +
        `a release line. It reads plain \`major.minor.patch\` releases only and refuses rather ` +
        `than guessing which line a version it cannot parse is on.`,
    );
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (type === "major") return { major: major + 1, minor: 0, patch: 0 };
  if (type === "minor") return { major, minor: minor + 1, patch: 0 };
  if (type === "patch") return { major, minor, patch: patch + 1 };
  return { major, minor, patch };
}

/**
 * A release line as a reader writes it.
 *
 * @param {{ major: number, minor: number }} line The line.
 * @returns {string} For example `0.0.x`.
 */
export function lineLabel(line) {
  return `${line.major}.${line.minor}.x`;
}

/** Whether a line is the `0.0.x` ladder, which is the one line with no settled-API promise. */
function isLadderLine(line) {
  return line.major === 0 && line.minor === 0;
}

/**
 * The exact sentence a README on a given release line must open its `## Status` section with.
 *
 * Two lines have a sentence. The `0.0.x` ladder says the API is not settled, which is the honest
 * claim while it is not. Every `0.<minor>.x` line above it says the API is settled and that bump
 * types follow ordinary semver, which is what leaving the ladder means. A line with no sentence is
 * refused by assertGradableLine() before any README is graded, so this never has to guess.
 *
 * @param {string} name The package name from its own manifest.
 * @param {{ major: number, minor: number }} line The effective release line.
 * @returns {string} The sentence.
 */
export function statusSentence(name, line) {
  if (isLadderLine(line)) {
    return `\`${name}\` is on the cosyte 0.0.x ladder: the public API is not yet settled and may change in any release.`;
  }
  return `\`${name}\` is on the cosyte ${lineLabel(line)} line: the public API is settled and bump types follow ordinary semver.`;
}

/**
 * Refuse a release line this gate has no Status sentence for.
 *
 * Silently accepting one would leave that README's `## Status` section UNGRADED, which is the
 * silent-skip shape every gate in this repo is built to refuse: the section that tells a consumer
 * what the package promises would go unchecked into the tarball.
 *
 * @param {{ major: number, minor: number }} line The effective release line.
 * @param {string} what What is on it, for the diagnostic.
 * @returns {void}
 */
function assertGradableLine(line, what) {
  if (line.major === 0) return;
  throw new InvocationError(
    `${what} is on the ${lineLabel(line)} effective release line, which this gate has no Status ` +
      `sentence for: it knows the 0.0.x ladder and the settled 0.<minor>.x lines above it. ` +
      `Refusing to leave that README's \`## Status\` section ungraded. Teach this gate the ` +
      `sentence that line owes a reader before moving a package onto it.`,
  );
}

/**
 * The effective release line of every governed README, keyed by label.
 *
 * @param {{ label: string, isRoot: boolean, manifest: Record<string, any> }[]} governed The set.
 * @param {string} changesetDir The `.changeset` directory.
 * @returns {Map<string, { major: number, minor: number }>} One line per governed label.
 */
export function releaseLines(governed, changesetDir) {
  const members = new Set();
  for (const entry of governed) {
    const name = entry.manifest.name;
    if (typeof name === "string" && name !== "") members.add(name);
  }

  // The strongest pending bump on a package is the one that moves it, so a `patch` beside a `minor`
  // does not hide the `minor`.
  const bumps = new Map();
  for (const release of pendingReleases(changesetDir)) {
    if (!members.has(release.name)) {
      throw new InvocationError(
        `.changeset/${release.file} names \`${release.name}\`, which is not a package in this ` +
          `workspace. The bump it declares cannot be grounded, so no release line can be derived ` +
          `from it, and a Status sentence graded against the remaining ones would be graded ` +
          `against a partial reading of the pending release.`,
      );
    }
    const held = bumps.get(release.name);
    const rank = RELEASE_TYPE_RANK.get(release.type) ?? 0;
    if (held === undefined || rank > (RELEASE_TYPE_RANK.get(held) ?? 0)) {
      bumps.set(release.name, release.type);
    }
  }

  const lines = new Map();
  const published = [];
  for (const entry of governed) {
    if (entry.isRoot) continue;
    const name = typeof entry.manifest.name === "string" ? entry.manifest.name : "";
    const version = typeof entry.manifest.version === "string" ? entry.manifest.version : "";
    if (version === "") {
      throw new InvocationError(
        `the manifest for ${entry.label} declares no \`version\`, so this gate cannot resolve the ` +
          `release line its Status sentence must state.`,
      );
    }
    const bumped = bumpedVersion(
      version,
      bumps.get(name) ?? "none",
      `the manifest for ${entry.label}`,
    );
    const line = { major: bumped.major, minor: bumped.minor };
    assertGradableLine(line, `${entry.label}'s package \`${name}\``);
    lines.set(entry.label, line);
    if (entry.manifest.private !== true) published.push({ name, line });
  }

  // THE ROOT'S LINE IS DERIVED, because the root package is `private: true` and is never versioned,
  // so its own `version` can never leave `0.0.0` and can never be evidence of anything.
  if (published.length === 0) {
    throw new InvocationError(
      `this workspace has no published package, so the root README's release line cannot be ` +
        `derived. The root package is private and never versioned, so its own \`version\` is not ` +
        `evidence of the line this repository is on.`,
    );
  }
  const byLine = new Map();
  for (const entry of published) {
    const key = lineLabel(entry.line);
    const held = byLine.get(key);
    if (held === undefined) byLine.set(key, [entry.name]);
    else held.push(entry.name);
  }
  if (byLine.size > 1) {
    const detail = [...byLine.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([key, names]) => `${key}: ${[...names].sort().join(", ")}`)
      .join("; ");
    throw new InvocationError(
      `the published packages are not all on one effective release line (${detail}), so the root ` +
        `README's Status sentence cannot be derived from them. Refusing to choose a line for it: ` +
        `the root package is private and never versioned, so there is nothing else to derive from.`,
    );
  }

  const rootLine = published[0].line;
  for (const entry of governed) {
    if (entry.isRoot) lines.set(entry.label, rootLine);
  }
  return lines;
}

/**
 * Grade one README against the house skeleton.
 *
 * Every problem the file has is collected: grading stops at no first failure, because a reader
 * fixing one element wants to see the rest in the same run rather than one per push.
 *
 * @param {object} entry The governed entry.
 * @param {string} entry.label The README's repo-relative path, for diagnostics.
 * @param {string} entry.text The file contents.
 * @param {Record<string, any>} entry.manifest The `package.json` beside it.
 * @param {string} entry.floor The effective Node floor.
 * @param {{ major: number, minor: number }} entry.line The effective release line.
 * @returns {string[]} One line per problem. Empty means the README conforms.
 */
export function gradeReadme({ label, text, manifest, floor, line }) {
  const problems = [];
  const say = (element, detail) => problems.push(`${label}: ${element}: ${detail}`);

  const name = typeof manifest.name === "string" ? manifest.name : "";
  const version = typeof manifest.version === "string" ? manifest.version : "";
  const description = typeof manifest.description === "string" ? manifest.description : "";
  const isPrivate = manifest.private === true;

  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > SIZE_LIMIT_BYTES) {
    say("size", `${bytes} bytes exceeds the ${SIZE_LIMIT_BYTES}-byte ceiling; GitHub truncates it`);
  }

  const lines = text.split("\n");
  const mask = fenceMask(lines);

  // --- BANNER, byte-identical and first in the file -------------------------------------------
  const bannerLines = BANNER.split("\n");
  const head = lines.slice(0, bannerLines.length).join("\n");
  if (head !== BANNER) {
    say(
      "banner",
      "the file does not open with the Cosyte banner byte-identical to the house block " +
        "(dark-scheme <source>, light-tile <img> fallback, absolute https://cosyte.com/tile/ URLs, " +
        "and the central alt string). Never hand-write the alt text",
    );
  }

  // Relative image sources break on npm, which does not resolve them against the repo.
  for (let i = 0; i < lines.length; i += 1) {
    if (mask[i] === true) continue;
    const line = lines[i] ?? "";
    const sources = [
      ...[...line.matchAll(/<img\b[^>]*?\bsrc="([^"]*)"/gi)].map((m) => m[1] ?? ""),
      ...[...line.matchAll(/<source\b[^>]*?\bsrcset="([^"]*)"/gi)].map((m) => m[1] ?? ""),
      ...[...line.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)].map((m) => m[1] ?? ""),
    ];
    for (const source of sources) {
      if (!/^(?:https?:|data:)/i.test(source)) {
        say(
          "images",
          `line ${i + 1} carries the relative image source ${JSON.stringify(source)}; npm does not resolve it`,
        );
      }
    }
  }

  // --- H1, tagline, badges, description, in file order ----------------------------------------
  const h1Lines = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (mask[i] !== true && /^# +\S/.test(lines[i] ?? "")) h1Lines.push(i);
  }
  if (h1Lines.length !== 1) {
    say("h1", `the file carries ${h1Lines.length} level-1 headings; exactly one is required`);
  }

  const h1 = h1Lines[0];
  if (h1 !== undefined) {
    for (let i = bannerLines.length; i < h1; i += 1) {
      if ((lines[i] ?? "").trim() !== "") {
        say("h1", `line ${i + 1} sits between the banner and the H1; nothing may`);
        break;
      }
    }

    const taglineStart = nextNonBlank(lines, h1 + 1);
    const taglineBlock = blockAt(lines, taglineStart);
    if (taglineBlock.length === 0 || !/^> /.test(taglineBlock[0] ?? "")) {
      say("tagline", "the H1 is not followed by a one-line blockquote tagline");
    } else if (taglineBlock.length > 1) {
      say("tagline", `the tagline runs ${taglineBlock.length} lines; it must be one`);
    } else {
      const tagline = (taglineBlock[0] ?? "").replace(/^> /, "");
      if (tagline.length >= TAGLINE_LIMIT) {
        say("tagline", `${tagline.length} characters; the ceiling is ${TAGLINE_LIMIT}`);
      }
    }

    const badgeStart = nextNonBlank(lines, taglineStart + taglineBlock.length);
    const badgeBlock = blockAt(lines, badgeStart);
    const wanted = expectedBadges({ name, isPrivate, floor });
    if (badgeBlock.join("\n") !== wanted.join("\n")) {
      say(
        "badges",
        `the badge row must be exactly these ${wanted.length}, in this order (npm version` +
          `${isPrivate ? " omitted: this package is private" : ""}, CI, License, Node):\n` +
          `${wanted.map((b) => `    want: ${b}`).join("\n")}\n` +
          `${badgeBlock.map((b) => `    got:  ${b}`).join("\n") || "    got:  (no badge row)"}`,
      );
    }

    // A shields badge anywhere else in the file is a fifth badge wearing a different position.
    for (let i = 0; i < lines.length; i += 1) {
      if (mask[i] === true) continue;
      if (i >= badgeStart && i < badgeStart + badgeBlock.length) continue;
      if (/\[!\[[^\]]*\]\(https:\/\/img\.shields\.io\//.test(lines[i] ?? "")) {
        say(
          "badges",
          `line ${i + 1} carries a badge outside the row; the house set of badges is the ceiling`,
        );
      }
    }

    const descStart = nextNonBlank(lines, badgeStart + badgeBlock.length);
    const descBlock = blockAt(lines, descStart);
    if (descBlock.length === 0) {
      say("description", "the badge row is not followed by a one-line description paragraph");
    } else if (descBlock.length > 1) {
      say("description", `the description runs ${descBlock.length} lines; it must be one`);
    } else if (/^(?:#|>|\||-|\*|\+|\d+\.|```|~~~)/.test((descBlock[0] ?? "").trim())) {
      say("description", "the badge row is not followed by a plain paragraph");
    } else {
      const found = unescapeMarkdown((descBlock[0] ?? "").trim());
      if (found !== description) {
        say(
          "description",
          `it must be byte-identical to this package's manifest description.\n` +
            `    package.json: ${JSON.stringify(description)}\n` +
            `    README.md:    ${JSON.stringify(found)}`,
        );
      }
    }
  }

  // --- The required sections, in order, License last ------------------------------------------
  const sections = sectionsOf(lines, mask);
  const titles = sections.map((s) => s.title);
  const byTitle = new Map();
  for (const section of sections) {
    if (!byTitle.has(section.title)) byTitle.set(section.title, section);
  }

  let previous = -1;
  for (const required of REQUIRED_HEADINGS) {
    const at = titles.indexOf(required);
    if (at === -1) {
      say("sections", `the required heading \`## ${required}\` is missing`);
      continue;
    }
    if (titles.indexOf(required, at + 1) !== -1) {
      say("sections", `the heading \`## ${required}\` appears more than once`);
    }
    if (at < previous) {
      say(
        "sections",
        `\`## ${required}\` appears before \`## ${REQUIRED_HEADINGS[REQUIRED_HEADINGS.indexOf(required) - 1]}\`; ` +
          `the required headings must appear in the order ${REQUIRED_HEADINGS.join(", ")}`,
      );
    }
    previous = Math.max(previous, at);
  }
  if (titles.length > 0 && titles[titles.length - 1] !== "License") {
    say(
      "sections",
      `\`## License\` must be the last heading; the last one is \`## ${titles[titles.length - 1]}\``,
    );
  }

  /**
   * The text of a required section, or `null` when it is absent.
   *
   * @param {string} title The heading text.
   * @returns {string | null} The section body.
   */
  const bodyOf = (title) => {
    const section = byTitle.get(title);
    if (section === undefined) return null;
    return lines.slice(section.start, section.end).join("\n");
  };

  const status = bodyOf("Status");
  if (status !== null) {
    const sentence = statusSentence(name, line);
    const statusLines = status.split("\n").filter((one) => one.trim() !== "");
    if ((statusLines[0] ?? "").trim() !== sentence) {
      say(
        "status",
        `a package on the ${lineLabel(line)} effective release line must OPEN with this exact ` +
          `sentence.\n` +
          `    want: ${sentence}\n` +
          `    got:  ${(statusLines[0] ?? "(empty section)").trim()}`,
      );
    }
    if (statusLines.length < 2) {
      say(
        "status",
        "the Status section must also name at least one surface that is still moving or not covered",
      );
    }
    // The settled-API refusal is a `0.0.x`-ladder rule and nothing else. On a settled line the
    // required sentence above says the API is settled, so refusing the wording there would refuse
    // the sentence this gate compels.
    if (isLadderLine(line)) {
      for (const claim of SETTLED_API_CLAIMS) {
        if (claim.test(status)) {
          say(
            "status",
            `it claims a settled or stable public API while its effective release line is 0.0.x ` +
              `(manifest ${JSON.stringify(version)}, with the pending changesets applied). ` +
              `That claim belongs to the 0.1.0 release, not to a 0.0.x package`,
          );
          break;
        }
      }
    }
  }

  // --- A ladder this package has left, asserted ANYWHERE in the file --------------------------
  //
  // Not scoped to `## Status`: the root README states the same policy again under `## Versioning`,
  // and a package README may repeat it in prose. Every one of these files ships inside a tarball,
  // so a retired ladder assertion three lines below a settled Status sentence is the repository
  // publishing two incompatible versions of its own policy.
  if (!isLadderLine(line)) {
    for (let i = 0; i < lines.length; i += 1) {
      for (const [pattern, what] of RETIRED_LADDER_CLAIMS) {
        const match = pattern.exec(lines[i] ?? "");
        if (match === null) continue;
        say(
          "ladder",
          `line ${i + 1} asserts ${what} (${JSON.stringify(match[0])}), which this package has ` +
            `left: its effective release line is ${lineLabel(line)}. A README is inside the npm ` +
            `tarball, so a retired ladder assertion is published policy text contradicting the ` +
            `version published beside it`,
        );
        break;
      }
    }
  }

  const install = bodyOf("Install");
  if (install !== null) {
    if (name !== "" && !install.includes(name)) {
      say("install", `it does not name this package's specifier \`${name}\``);
    }
    if (!install.includes(floor)) {
      say("install", `it does not name this package's effective Node engine floor \`${floor}\``);
    }
  }

  const usage = bodyOf("Usage");
  if (usage !== null && !/^ {0,3}(?:`{3,}|~{3,})/m.test(usage)) {
    say(
      "usage",
      "it carries no fenced code block; a Usage section without a runnable example is not one",
    );
  }

  const phi = bodyOf("PHI and safety");
  if (phi !== null && phi.trim() === "") {
    say(
      "phi",
      "the `## PHI and safety` section is empty. Every README this repository publishes owes the reader an answer",
    );
  }

  const contributing = bodyOf("Contributing");
  if (contributing !== null && !contributing.includes(ISSUES_URL)) {
    say("contributing", `it does not carry the issue tracker ${ISSUES_URL}`);
  }

  const license = bodyOf("License");
  if (license !== null) {
    // Graded against the RENDERED PROSE, not the raw source. The mandated absolute LICENSE link
    // carries the owner's name inside its URL, so a raw search can never fail here; see
    // stripLinkTargets. Labels survive, so `[MIT](https://opensource.org/licenses/MIT)` still names
    // the license, while a section whose only `MIT` or `Cosyte` is an address names neither.
    const prose = stripLinkTargets(license);
    if (!/\bMIT\b/.test(prose)) {
      say("license", "it does not name the MIT license anywhere a reader reads");
    }
    if (!/\bCosyte\b/i.test(prose)) {
      say(
        "license",
        "it does not name the owner, Cosyte. The owner inside the LICENSE link's URL is an address, " +
          "not an attribution",
      );
    }
  }

  // --- Claims the file may not make -----------------------------------------------------------
  //
  // The Node floor is scanned over the whole file EXCEPT the badge row, which is already graded
  // byte-exactly above and carries the floor in its URL-encoded form.
  const badgeRow = new Set();
  if (h1 !== undefined) {
    const taglineStart = nextNonBlank(lines, h1 + 1);
    const badgeStart = nextNonBlank(lines, taglineStart + blockAt(lines, taglineStart).length);
    for (let i = badgeStart; i < badgeStart + blockAt(lines, badgeStart).length; i += 1)
      badgeRow.add(i);
  }
  const wantedVersion = floor.replace(/^[^\d]*/, "");
  for (let i = 0; i < lines.length; i += 1) {
    if (badgeRow.has(i)) continue;
    for (const match of (lines[i] ?? "").matchAll(
      /\bnode\b[^\n]{0,40}?>=\s*`?v?(\d+(?:\.\d+){0,2})/gi,
    )) {
      if ((match[1] ?? "") !== wantedVersion) {
        say(
          "engines",
          `line ${i + 1} states the Node floor \`>=${match[1] ?? ""}\`, which this package's own ` +
            `manifest contradicts: its effective floor is \`${floor}\``,
        );
      }
    }
  }

  for (const [pattern, what] of UMBRELLA_REFERENCES) {
    const match = pattern.exec(text);
    if (match !== null) {
      say(
        "pointers",
        `it references the umbrella meta-repo surface ${JSON.stringify(match[0])} (${what}). ` +
          `A published README may not point a reader at a path only the private meta-repo has`,
      );
    }
  }

  for (const [pattern, what] of CADENCE_CLAIMS) {
    const match = pattern.exec(text);
    if (match !== null) {
      say(
        "cadence",
        `${JSON.stringify(match[0])} asserts ${what}. S0161-release-frequency-policy owns that ` +
          `policy and has not landed, so no README here may state it`,
      );
    }
  }

  return problems;
}

/**
 * Read and parse a JSON file, refusing rather than guessing.
 *
 * @param {string} path Absolute path.
 * @param {string} what What the file is, for the diagnostic.
 * @returns {Record<string, any>} The parsed object.
 */
function readManifest(path, what) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (cause) {
    throw new InvocationError(`cannot read ${what} at ${path}: ${String(cause)}`);
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not a JSON object");
    }
    return parsed;
  } catch (cause) {
    throw new InvocationError(`cannot parse ${what} at ${path}: ${String(cause)}`);
  }
}

/**
 * The workspace's package globs, read out of `pnpm-workspace.yaml`.
 *
 * Read rather than assumed, so the derivation below cannot silently go stale: if this repository
 * ever stops being a flat `packages/*` workspace, this gate REFUSES instead of grading whichever
 * subset the old assumption still happens to find. Deliberately a line reader rather than a YAML
 * one, for the same reason scripts/changeset-guard.mjs is: these gates take no dependency, so they
 * can run before `pnpm install`. A shape this cannot read is reported as unreadable (exit 2), never
 * as an empty workspace and never as fine.
 *
 * @param {string} workspaceRoot Repository root.
 * @returns {string[]} The declared globs.
 */
export function workspaceGlobs(workspaceRoot) {
  const path = join(workspaceRoot, "pnpm-workspace.yaml");
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (cause) {
    throw new InvocationError(`cannot read the workspace file ${path}: ${String(cause)}`);
  }
  const globs = [];
  let inPackages = false;
  for (const rawLine of raw.split("\n")) {
    const line = rawLine.replace(/\s+$/, "");
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (!inPackages) continue;
    const item = /^ {2,}- +["']?([^"'\s]+)["']?\s*$/.exec(line);
    if (item === null) break;
    globs.push(item[1] ?? "");
  }
  if (globs.length === 0) {
    throw new InvocationError(
      `${path} declares no \`packages:\` globs this reader can see. Refusing to grade READMEs ` +
        `against a workspace it cannot ground on, which would clear every package it failed to find.`,
    );
  }
  return globs;
}

/**
 * Every governed README: the repository root plus each `packages/*` member.
 *
 * DERIVED, never hardcoded (AC11). A directory under `packages/` that carries a `package.json` is
 * in the governed set by construction, so a tenth package cannot be added without a README: it
 * arrives as a refusal rather than as a skip.
 *
 * @param {string} workspaceRoot Repository root.
 * @returns {{ label: string, isRoot: boolean, readmePath: string, manifest: Record<string, any> }[]}
 *   The set.
 */
export function governedReadmes(workspaceRoot) {
  const globs = workspaceGlobs(workspaceRoot);
  if (globs.length !== 1 || globs[0] !== "packages/*") {
    throw new InvocationError(
      `pnpm-workspace.yaml declares ${JSON.stringify(globs)}, not the flat \`packages/*\` layout ` +
        `this gate derives its governed set from. Refusing to grade a subset of the workspace and ` +
        `report clean: teach this script the new layout instead.`,
    );
  }

  const entries = [{ label: "README.md", isRoot: true, dir: workspaceRoot }];

  const packagesDir = join(workspaceRoot, "packages");
  let names;
  try {
    names = readdirSync(packagesDir).sort();
  } catch (cause) {
    throw new InvocationError(`cannot read ${packagesDir}: ${String(cause)}`);
  }
  for (const entry of names) {
    const dir = join(packagesDir, entry);
    const manifestPath = join(dir, "package.json");
    let hasManifest = false;
    try {
      hasManifest = statSync(manifestPath).isFile();
    } catch {
      hasManifest = false;
    }
    if (!hasManifest) {
      // A directory carrying a README but NO manifest is a premise this checker cannot ground: the
      // README is plainly meant to be published and there is nothing to grade its description,
      // version, privacy or engine floor against. Skipping it would report clean over a file nobody
      // checked, so it refuses instead. A directory with neither is not a workspace member and is
      // genuinely none of this gate's business.
      let strayReadme = false;
      try {
        strayReadme = statSync(join(dir, "README.md")).isFile();
      } catch {
        strayReadme = false;
      }
      if (strayReadme) {
        throw new InvocationError(
          `packages/${entry}/ carries a README.md but no package.json, so there is nothing to ` +
            `grade its description, version and engine floor against. Refusing to skip it: a ` +
            `README this gate cannot ground is not a README this gate has cleared.`,
        );
      }
      continue;
    }
    entries.push({ label: `packages/${entry}/README.md`, isRoot: false, dir });
  }

  if (entries.length === 1) {
    throw new InvocationError(
      `no packages found under ${packagesDir}. Refusing to report clean over a workspace with no ` +
        `members, which would clear every one of them.`,
    );
  }

  return entries.map((entry) => ({
    label: entry.label,
    isRoot: entry.isRoot,
    readmePath: join(entry.dir, "README.md"),
    manifest: readManifest(join(entry.dir, "package.json"), `the manifest for ${entry.label}`),
  }));
}

/**
 * Run the check over a workspace.
 *
 * @param {{ workspaceRoot: string }} options Where to look.
 * @returns {{ ok: boolean, checked: number, report: string[] }} Result and the lines to print.
 */
export function check({ workspaceRoot }) {
  const rootManifest = readManifest(join(workspaceRoot, "package.json"), "the root manifest");
  const rootEngines = rootManifest.engines;
  const rootFloor =
    rootEngines !== null && typeof rootEngines === "object" && typeof rootEngines.node === "string"
      ? rootEngines.node
      : null;
  if (rootFloor === null) {
    throw new InvocationError(
      `the root package.json declares no \`engines.node\`, which is the fallback Node floor every ` +
        `package without its own one reports. Refusing to grade engine claims against a floor that ` +
        `does not exist.`,
    );
  }

  const governed = governedReadmes(workspaceRoot);

  // EVERY LINE IS RESOLVED BEFORE ANY README IS GRADED. A line this gate cannot ground is exit 2,
  // and it must be exit 2 even when some other README also carries a real violation: a run that
  // could not resolve what it was grading against has not graded anything.
  const lines = releaseLines(governed, join(workspaceRoot, ".changeset"));

  const report = [];
  let bad = 0;

  for (const entry of governed) {
    let text;
    try {
      text = readFileSync(entry.readmePath, "utf8");
    } catch (cause) {
      throw new InvocationError(
        `cannot read the governed README ${entry.label}: ${String(cause)}. Every package this ` +
          `workspace carries owes a README, so an absent one is a refusal and never a skip.`,
      );
    }
    const line = lines.get(entry.label);
    if (line === undefined) {
      throw new InvocationError(
        `no effective release line was resolved for ${entry.label}, so its \`## Status\` section ` +
          `would go ungraded. Refusing to report on a governed README this could not ground.`,
      );
    }
    const problems = gradeReadme({
      label: entry.label,
      text,
      manifest: entry.manifest,
      floor: effectiveFloor(entry.manifest, rootFloor),
      line,
    });
    // Every offending file is reported, in one run. Stopping at the first would turn a nine-file
    // sweep into nine pushes.
    if (problems.length === 0) continue;
    bad += 1;
    for (const problem of problems) report.push(`ERROR: ${problem}`);
  }

  if (bad > 0) {
    report.push(
      "",
      `Refusing: ${bad} of ${governed.length} governed README(s) do not carry the house skeleton.`,
      `The skeleton is process/templates/readme.md, carried into this repo by this gate: banner, H1,`,
      `tagline, badge row, the manifest description, then ${REQUIRED_HEADINGS.map((h) => `## ${h}`).join(", ")}.`,
      `A README is inside each package's \`files\` array, so a wrong string here is frozen into the`,
      `npm tarball at the next publish and correctable only by publishing again.`,
    );
    return { ok: false, checked: governed.length, report };
  }

  return {
    ok: true,
    checked: governed.length,
    report: [`readme-check: OK (${governed.length} governed README(s) carry the house skeleton)`],
  };
}

/**
 * CLI entry point.
 *
 * @param {string[]} argv Arguments after the script path.
 * @returns {number} Process exit code.
 */
function main(argv) {
  let workspaceRoot = process.cwd();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--workspace") {
      i += 1;
      const value = argv[i];
      if (value === undefined) throw new InvocationError("--workspace needs a value");
      workspaceRoot = value;
    } else {
      throw new InvocationError(`unknown argument ${JSON.stringify(arg)}`);
    }
  }

  const result = check({ workspaceRoot: resolve(workspaceRoot) });
  const stream = result.ok ? process.stdout : process.stderr;
  for (const line of result.report) stream.write(`${line}\n`);
  return result.ok ? 0 : 1;
}

// `isCliEntrypoint` is what keeps importing this file for tests from executing the CLI, and the
// InvocationError handler is what keeps a broken invocation on exit 2: left to node's default an
// uncaught throw exits 1, which is the code this contract reserves for "a README violates the
// skeleton", and the two must not be the same signal.
if (isCliEntrypoint(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    if (error instanceof InvocationError) {
      process.stderr.write(`ERROR: readme-check could not run: ${error.message}\n`);
      process.exit(2);
    }
    throw error;
  }
}
