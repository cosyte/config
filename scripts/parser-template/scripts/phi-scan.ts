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
 *   As shipped, this scanner declares NO field vocabulary, so it detects
 *   EXACTLY TWO cross-cutting shapes, both from the shared floor:
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
 *      {{TITLE}}, fill in `DETECTORS` below.
 *
 *   🛑 DECLARING NO VOCABULARY IS ALSO A LEGITIMATE ANSWER, and one sibling
 *   reached it correctly: a repo whose corpus is code-system content rather
 *   than patient demographics has no field to key a detector on. If that is
 *   this repo, say so in a comment where `DETECTORS` is left empty, so the
 *   next reader can tell a decision from an omission. The clean line prints
 *   the declared-detector count on every run for exactly this reason.
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
  type DetectorSpec,
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
 * THE PER-STANDARD FIELD VOCABULARY: the half that genuinely differs, declared
 * as DATA.
 *
 * ── TODO: declare {{TITLE}}'s PHI-bearing fields here ──────────────────────
 *
 *   A vocabulary entry is a POSITION, an optional equality GUARD over a sibling
 *   position, and a named value RULE. The engine ships the rules (`name`,
 *   `dob`, `id`, `address`, `city`, `postal-code`, `phone`, `email`) and the
 *   grammars (`delimited-record` for HL7 v2 / X12 / ASTM, `xml`, `json`), so
 *   what you write here is a table.
 *
 *   A worked example, for a delimited wire format:
 *
 *     const DETECTORS: readonly DetectorSpec[] = [
 *       {
 *         id: "{{PKG}}",
 *         grammar: { kind: "delimited-record" },
 *         appliesTo: { pathSuffixes: [".hl7"], pathPrefixes: ["test/"] },
 *         fields: [
 *           { record: "PID", field: 5, kind: "name", id: "PID-5" },
 *           { record: "PID", field: 7, component: 0, kind: "dob",
 *             pattern: /^\d{8}$/, id: "PID-7" },
 *           { record: "PID", field: 3, component: 0, kind: "id",
 *             guard: [{ component: 4, oneOf: ["MR", "MRN"] }],
 *             minDigits: 6, id: "PID-3" },
 *           { record: "PID", field: 11, component: 0, kind: "address",
 *             id: "PID-11" },
 *           { record: "PID", field: 13, kind: "phone",
 *             reservedSpaces: ["nanp-fictional"], id: "PID-13" },
 *         ],
 *       },
 *     ];
 *
 *   🛑 KEY ON STRUCTURE, NOT ON A BARE WORD. `family`, `given`, `line` and
 *   `city` are ordinary English and ordinary property names; a detector keyed
 *   on the word alone fires on prose. The delimited grammar keys on a record id
 *   PLUS a field number, and the JSON grammar keys on a dotted property PATH,
 *   for exactly this reason.
 *
 *   🛑 A DECLARED FORMAT THAT FAILS TO PARSE REFUSES, and it must. A sibling's
 *   shipped scanner falls back to the floor alone when its JSON parse throws,
 *   and reports 0 hits at exit 0 over a FRAGMENTARY resource carrying a name, a
 *   date of birth AND a street address. Narrow `appliesTo` rather than widening
 *   the fallback.
 *
 *   WHAT STAYS CODE, IN `detect`: anything needing a conditional or an
 *   expression. A rule keyed on the cardinality of distinct digits, a policy
 *   cutoff on a date, a wall-clock-relative recency window, or a heuristic over
 *   the adjacency of two components. All four are real and all four are less
 *   reviewable written as data. Do not build a configuration mini-language;
 *   reviewability is what this gate is for.
 *
 *   Until this table is filled in, treat a green `pnpm phi-scan` as "no
 *   SSN/email shapes found", NOT as "no PHI".
 * ───────────────────────────────────────────────────────────────────────────
 */
const DETECTORS: readonly DetectorSpec[] = [];

runPhiScanCli({
  exitCodes: EXIT_CODES,
  scanRoots: SCAN_ROOTS,
  excludedPaths: EXCLUDED_PATHS,
  textViews: TEXT_VIEWS,
  detectors: DETECTORS,
  // `stagedRoots` is deliberately NOT set: it defaults to `scanRoots`, and the
  // engine refuses at configuration time if it is ever widened past them.
  //
  // `isReadable` is deliberately NOT set: the engine's default reads
  // everything. `exemptsMarkdown` is exported if this repo decides to stop
  // reading its own `.md` on the sweeping routes, but that is the third of
  // this item's three escape classes, `README.md` and `CHANGELOG.md` ship
  // inside the npm tarball, and it is a decision to write down, not to inherit.
});
