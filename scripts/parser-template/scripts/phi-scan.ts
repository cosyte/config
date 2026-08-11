#!/usr/bin/env tsx
/**
 * `{{PKG}}` PHI scanner.
 *
 * ===========================================================================
 * THIS FILE IS DATA. THE PROCESS IS `@cosyte/script-utils/phi-scan`.
 *
 * The engine owns walking, reading, enumeration on all three routes, the union
 * of the working-tree walk with the bytes git carries, content deduplication,
 * the completeness rule and its per-root tier, every refusal, the cross-cutting
 * SSN/email floor, the report, the exit codes, and the process TAIL. None of
 * that is here, and none of it should ever come back: this file used to carry
 * the whole engine, `scripts/parser-template/` is a SCAFFOLD rather than a
 * dependency, and so a newly-found escape cost one pull request and one
 * adversarial review PER REPO. Three escape classes were paid for that way.
 *
 * WHAT IS HERE is what genuinely differs between repos: the roots, the
 * subtractions, the allow-list conventions, the views, and the per-standard
 * field VOCABULARY. Read the engine's own docblocks for what each rule closes
 * and what it costs; nothing is restated here, because a claim written down
 * twice is a claim that drifts.
 * ===========================================================================
 *
 * ===========================================================================
 * ██  STARTER: READ BEFORE YOU RELY ON THIS  ████████████████████████████████
 * ===========================================================================
 *
 *   As shipped, `detect` below is empty, so this scanner finds EXACTLY TWO
 *   cross-cutting shapes, both from the shared floor:
 *
 *       (1) a dashed Social Security Number
 *       (2) an email at a domain the allow-list does not declare
 *
 *   That is a FLOOR, not a gate. It does NOT understand {{TITLE}}. It will NOT
 *   catch a patient name, a date of birth, an MRN / member id, an address or a
 *   phone number sitting in a structured {{TITLE}} field.
 *
 *   ⚠  A scanner that silently ships SSN/email-only detection is a FALSE-
 *      CONFIDENCE RISK. Before you trust `pnpm phi-scan` as a safety gate for
 *      {{TITLE}}, fill in `detect` below.
 *
 *   🛑 HAVING NO FIELD VOCABULARY IS ALSO A LEGITIMATE ANSWER, and one sibling
 *   reached it correctly: a repo whose corpus is code-system content rather
 *   than patient demographics has no field to key a detector on. If that is
 *   this repo, say so in a comment where `detect` is left empty, so the next
 *   reader can tell a decision from an omission. The clean line says whether a
 *   detector ran at all, on every run, for exactly this reason.
 * ===========================================================================
 *
 * ===========================================================================
 * EXIT CONTRACT, DEFINED HERE AND NOT INHERITED:
 *
 *   0  the scan ran, READ EVERY TARGET IT ENUMERATED, and found nothing.
 *   1  HITS. Reserved for "this corpus contains something that looks like PHI".
 *   2  EVERY STATE THE ENGINE RAISES IN WHICH THE SCAN CANNOT ACCOUNT FOR
 *      SOMETHING. The full list is in the engine's `run()` docblock.
 *
 * 1 IS RESERVED BECAUSE CI AND THE PRE-COMMIT HOOK BRANCH ON THE CODE. A caller
 * must be able to tell "PHI was found here" from "this scan is not trustworthy".
 *
 * DO NOT PORT THESE NUMBERS INTO, OR OUT OF, A SIBLING PARSER. The `@cosyte/*`
 * scanners do not agree on them and are not required to. That is why the engine
 * has no default for them.
 * ===========================================================================
 */

import {
  runPhiScanCli,
  type DetectContext,
  type ScanRootSpec,
} from "@cosyte/script-utils/phi-scan";

/** This repo's exit contract, stated in the header block above. */
const EXIT_CODES = { clean: 0, hits: 1, refuse: 2 } as const;

/**
 * THE ROOTS.
 *
 * THE WHOLE REPOSITORY, AND THAT IS A DELIBERATE STARTING POINT RATHER THAN A
 * PLACEHOLDER. This template once shipped `["test/fixtures", "src"]`, measured
 * against a fresh scaffold: 35 tracked files, ONE in scope, so a tracked
 * `test/leak.test.ts` carrying a dashed SSN exited 0 on the sweep. A scaffolded
 * repo has not decided what its corpus is, so the only honest scope is
 * everything; the engine prunes gitignored directories during descent and skips
 * `.git` by name, so that costs nothing on a fresh tree.
 *
 * 🛑 THIS AXIS HAS NO SAFE DEFAULT IN EITHER DIRECTION, AND BOTH FAILURES ARE
 * MEASURED. Five repos need the whole repository. TWO measured that the whole
 * repository makes them exit 1 on their own `package.json` author address, and
 * both remedies are worse than narrow roots, widening the allowed email domain
 * weakens the floor on the commit-blocking route, and excluding the file leaves
 * it with no verdict at all. FIVE more measured that copying a sibling's narrow
 * roots silently DROPPED tracked files their index union had been reading.
 * Derive this for THIS repo, and measure what a narrowing stops reading rather
 * than assuming it stops reading nothing. NO FILE COUNT IS QUOTED HERE: a draft
 * carried per-repo counts with no attribution, and a reader in another repo
 * reasonably mistook one for their own.
 *
 * 🛑 BEFORE NARROWING, CHECK `unionScope`. The walk and the index union are two
 * axes. Six repos walk a narrow corpus while their index half was already
 * repository-wide, so narrowing `SCAN_ROOTS` alone silently stops reading
 * tracked files. `unionScope: "repository"` keeps the narrow walk and unions the
 * whole index, which is usually what a narrow-corpus repo actually wants.
 *
 * A root that is a regular FILE says so, and is then read regardless of the
 * read filter: naming a file as a root is the same explicit act as naming it on
 * the command line. A root that is not the shape it declares REFUSES.
 */
const SCAN_ROOTS: readonly ScanRootSpec[] = ["."];

/**
 * Repo-relative paths NO route reads.
 *
 * 🛑 EXCLUDE A LITERAL PATH, NEVER A CLASS. It is tempting to write a predicate
 * ("skip binary blobs", "skip generated files") because it needs no
 * maintenance. A sibling measured what that costs: two of its hand-written
 * sources embed NUL bytes as domain separators, so git's own binary heuristic
 * calls them binary and a "binary blob" predicate would have dropped them out
 * of the corpus silently. A literal path is reviewable in a diff; a class
 * quietly grows new members.
 *
 * AN ENTRY HERE IS A FILE THE SCAN HAS NO VERDICT ABOUT, so each one carries a
 * comment saying why. Every entry is ANNOUNCED on stderr on every run.
 */
const EXCLUDED_PATHS: ReadonlySet<string> = new Set<string>([
  // The scanner's OWN unit test. It must carry violator-shaped values to prove
  // the floor catches them, so it is a deliberate violator source rather than a
  // fixture. It is the ONLY file this template excludes.
  "test/scripts/phi-scan.test.ts",
]);

/**
 * A second VIEW of a target's bytes: the string escapes a TypeScript source
 * uses, decoded, so a wire payload written as a literal is judged as the bytes
 * it stands for rather than as the characters that spell it.
 *
 * STRICTLY ADDITIVE, the raw view is still scanned, so this can only ever add
 * a finding. It replaces the hand-written embedded-payload extractors two
 * siblings carried.
 *
 * 🛑 `appliesTo` HAS NO DEFAULT AND MUST NOT GROW CARELESSLY. If THIS repo's
 * wire format is itself source-shaped, JSON is the live example, do NOT add
 * its extension here: decoding a wire payload fabricates content the file does
 * not carry. One sibling needs `.json` in this list and another needs it out.
 */
const TEXT_VIEWS = [{ kind: "source-literals" as const, appliesTo: [".ts", ".tsx"] }];

/**
 * THE STANDARD-SPECIFIC FIELD DETECTION: the half the shared engine deliberately
 * does not own, because it differs per healthcare standard.
 *
 * The engine has already run the cross-cutting floor (SSN + email shapes) over
 * every view of this target and reported any hits against the correct locus.
 * Everything below is yours.
 *
 * 🛑 A DECLARATIVE VOCABULARY LAYER WAS BUILT FOR THIS AND THEN CUT, and the
 * reason is worth knowing before anyone rebuilds it: three consecutive
 * adversarial passes each found a blocker in it and each remedy grew a new one.
 * A JSON walk dropped primitives inside arrays, so FHIR given names and street
 * lines were invisible at exit 0. Delimiter DISCOVERY was blinded by one line of
 * prose naming a field; its remedy was blinded by a field table. Declaring the
 * delimiters instead moved three checked keys into an unchecked nested object,
 * so one transposed letter blinded a whole file again. And the record splitter
 * never covered X12 at all, whose segments end with a declared character rather
 * than a line break.
 *
 * None of that touched the PROCESS, which is why the process shipped and this
 * did not. Write the parsing here, where it is a reviewable function rather than
 * a table that has to be right about six things at once.
 *
 * ── TODO: add {{TITLE}}-specific structured field-level PHI detection here ──
 *
 *   At minimum: person NAMES, DATE OF BIRTH, MRN / MEMBER ID, ADDRESS and
 *   PHONE, parsed according to the {{TITLE}} wire format and checked against
 *   `ctx.allow` (`.names` / `.dobs` / `.ids` / `.addresses` / `.phones`), with a
 *   hit raised for anything not positively declared synthetic.
 *
 *   Parse the format properly (delimiters / segments / elements / tags). Do NOT
 *   bolt on a blind text regex for names: coded values produce false confidence.
 *
 *   🛑 KEY PATH LOGIC ON `ctx.targetPath`, NEVER ON `ctx.path`. The second is the
 *   reported LOCUS and carries an origin label for a hit found in the bytes git
 *   carries, so an extension test anchored anywhere but the start silently stops
 *   matching on the union half. Six repos derived this independently and two
 *   measured what it costs.
 *
 *   🛑 CHECK `ctx.allow` IN EVERY DETECTOR YOU ADD. The `--allow-fixture` bypass
 *   cannot reach a clean run, so a detector that consults nothing leaves a
 *   developer with a hit they cannot answer and a gate they will route around.
 *   Where the synthetic values live in a reserved space that is itself the
 *   provenance marker, prefer `RESERVED_SPACES` over a list of literals.
 *
 *   `ctx.views` carries every view the engine produced, `raw` first. Raise hits
 *   through `ctx.hit`, which fills in the locus; never build a path yourself.
 *
 *   Until this is implemented, treat a green `pnpm phi-scan` as "no SSN/email
 *   shapes found", NOT as "no PHI".
 * ───────────────────────────────────────────────────────────────────────────
 *
 * @param ctx The target's views and bytes, the parsed allow-list, and `hit`.
 */
function detect(ctx: DetectContext): void {
  void ctx;
}

runPhiScanCli({
  exitCodes: EXIT_CODES,
  scanRoots: SCAN_ROOTS,
  excludedPaths: EXCLUDED_PATHS,
  textViews: TEXT_VIEWS,
  detect,
  // `stagedRoots` is deliberately NOT set: it defaults to `scanRoots`, and the
  // engine refuses at configuration time if it is ever widened past them.
  //
  // `isReadable` is deliberately NOT set: the engine's default reads
  // everything. `exemptsMarkdown` is exported if this repo decides to stop
  // reading its own `.md` on the sweeping routes, but that is the third of
  // this item's three escape classes, `README.md` and `CHANGELOG.md` ship
  // inside the npm tarball, and it is a decision to write down, not to inherit.
});
