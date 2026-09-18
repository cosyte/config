import { afterAll, describe, expect, it } from "vitest";

import { CANONICAL_RULE_INDEX } from "@cosyte/script-utils/internal-refs";

import { REPOS, loadCorpus, planSuperset } from "../conformance/internal-refs/index.js";
import { makeScratchRepo, runGate, type ScratchRepo } from "./support/internal-refs-repo";

/**
 * THE SUPERSET GRADER: the shared implementation carries every rule each adopted variant carries.
 *
 * ONE CASE PER REPOSITORY PER RULE IN BOTH DIRECTIONS, and both directions matter for different
 * reasons. The POSITIVE direction is the claim the consolidation rests on: a repository that
 * adopts the shared gate and stops catching something its own copy caught has lost detection, and
 * the loss presents as a green run. The NEGATIVE direction is the trap that makes this class of
 * rule dangerous: a shared implementation that flags the reference material a variant deliberately
 * let through would tell a remediator to rewrite a segment-field reference, which destroys the
 * documentation the gate exists to protect.
 *
 * IT IS GRADED END TO END, through the real entry point against a real tracked tree, rather than by
 * comparing compiled patterns. A pattern that matches proves nothing about a run that never reads
 * the file the pattern would have matched.
 *
 * A PENDING ENTRY NEVER COUNTS TOWARD A PASS. It contributes no case and is reported as pending.
 */

const CORPUS = await loadCorpus();
const PLAN = planSuperset(CORPUS);

const CANONICAL_NAMES = new Map(CANONICAL_RULE_INDEX.map((rule) => [rule.id, rule.name]));

/** One scratch repository per surface, reused across cases: the content is what each case varies. */
const PUBLIC_REPO = makeScratchRepo("irefs-superset-public");
const SOURCE_REPO = makeScratchRepo("irefs-superset-source");
SOURCE_REPO.write(
  "src/index.ts",
  ["/**", " * Placeholder.", " */", "export const x = 1;", ""].join("\n"),
);
SOURCE_REPO.track("src/index.ts");

afterAll(() => {
  PUBLIC_REPO.dispose();
  SOURCE_REPO.dispose();
});

/** Run one corpus case through the real gate, with the sample on the surface its rule set guards. */
function runCase(entry: {
  surface: string;
  sample: string;
  config: Record<string, unknown>;
}): ReturnType<typeof runGate> {
  const source = entry.surface === "source";
  const repo: ScratchRepo = source ? SOURCE_REPO : PUBLIC_REPO;

  if (source) {
    repo.write(
      "src/index.ts",
      ["/**", ` * ${entry.sample}`, " */", "export const x = 1;", ""].join("\n"),
    );
  } else {
    repo.write("README.md", `# Scratch\n\n${entry.sample}\n`);
  }

  return runGate({
    ...entry.config,
    // The scratch tree has one page and one source file, so the surface is narrowed to them. Every
    // OTHER axis is the repository's own: its prefixes, its designations, its extra samples.
    surfacePaths: ["README.md"],
    accountedTarballFiles: [],
    sourceDocComments: source
      ? { enabled: true, paths: ["src/*.ts", "src/**/*.ts"] }
      : { enabled: false },
    repoRoot: repo.root,
  });
}

describe("the corpus the superset claim is made over", () => {
  it("can be graded at all, or says why not", () => {
    // The refusal check comes FIRST, so a corpus that could not be read never reaches the cases
    // below and reports a pass over what happened to load.
    expect(PLAN.refusals, `\n${PLAN.refusals.join("\n")}\n`).toEqual([]);
    expect(PLAN.cases.length, "no populated entry contributed a case").toBeGreaterThan(0);
  });

  it("reports every pending entry as pending rather than counting it", () => {
    const graded = new Set(PLAN.cases.map((entry) => entry.repo));
    const pendingRepos = PLAN.pending.map((entry) => entry.repo);

    for (const repo of pendingRepos) {
      expect(graded, `${repo} is pending and contributed a case`).not.toContain(repo);
      const record = PLAN.pending.find((entry) => entry.repo === repo);
      expect(record?.reason, `${repo} is pending with no reason`).toBeTruthy();
    }
    // Every roster key is accounted for in exactly one of the two lists.
    expect([...graded, ...pendingRepos].sort()).toEqual([...REPOS].sort());
  });

  it("refuses rather than passing when an entry declared on the roster cannot be read", () => {
    // AN UNREADABLE ENTRY IS NOT A SKIP. The corpus below is the real one with hl7's entry
    // replaced by a load failure; the plan must come back with a refusal naming it, and the eleven
    // pending keys must not add up to a pass.
    const broken = CORPUS.map((record) =>
      record.repo === "hl7"
        ? { repo: "hl7", state: "unreadable", entry: null, loadError: "Error: EACCES" }
        : record,
    );
    const plan = planSuperset(broken);
    expect(plan.refusals.join("\n")).toContain("hl7:");
    expect(plan.refusals.join("\n")).toContain("could not be read");
    expect(plan.cases).toEqual([]);
  });

  it("refuses a corpus in which every entry is pending", () => {
    const plan = planSuperset(
      REPOS.map((repo) => ({
        repo,
        state: "pending",
        entry: { repo, state: "pending", reason: "nobody has adopted it" },
        loadError: null,
      })),
    );
    expect(plan.cases).toEqual([]);
    expect(plan.refusals.join("\n")).toContain("assert nothing about any repository");
  });

  it("refuses a malformed populated entry rather than grading the rules it could parse", () => {
    const plan = planSuperset(
      CORPUS.map((record) =>
        record.repo === "hl7"
          ? { ...record, entry: { ...(record.entry as object), sha: undefined } }
          : record,
      ),
    );
    expect(plan.refusals.join("\n")).toContain("hl7:");
    expect(plan.refusals.join("\n")).toContain("`sha`");
    expect(plan.cases).toEqual([]);
  });
});

describe("every rule of every populated variant, in both directions", () => {
  const cases = PLAN.cases.map(
    (entry) =>
      [`${entry.repo}/${entry.ruleSetId}/${entry.ruleName}/${entry.direction}`, entry] as const,
  );

  it.each(cases)("%s", (_label, entry) => {
    const result = runCase(entry);

    if (entry.direction === "positive") {
      // WHAT THE VARIANT FLAGS, THE SHARED IMPLEMENTATION FLAGS. Adopting must not lose detection.
      expect(
        result.code,
        `${entry.repo} (${entry.sha}) flags this and the shared implementation did not:\n` +
          `${entry.sample}\n${result.all}`,
      ).not.toBe(0);
      // A HIT, NOT A REFUSAL. The self-test floor writes the canonical rule name into its own
      // refusal, so "non-zero, and the report names the rule" is satisfied by a run that could not
      // flag the sample at all. The hit report is the line that separates the two.
      expect(
        result.err,
        `no hit was reported, so this may be a refusal rather than a flag:\n${result.all}`,
      ).toContain("internal project bookkeeping found on a public surface");
      const canonical = entry.canonicalId === null ? null : CANONICAL_NAMES.get(entry.canonicalId);
      if (canonical !== null && canonical !== undefined) {
        expect(
          result.err,
          `the hit did not name the canonical rule \`${canonical}\`:\n${result.all}`,
        ).toContain(canonical);
      }
      return;
    }

    // WHAT THE VARIANT LETS THROUGH, THE SHARED IMPLEMENTATION LETS THROUGH. A widening here is
    // how a shared gate starts telling a remediator to rewrite reference material.
    expect(
      result.code,
      `${entry.repo} (${entry.sha}) lets this through and the shared implementation did not:\n` +
        `${entry.sample}\n${result.all}`,
    ).toBe(0);
  });

  it("covers every rule of every rule set of every populated entry", () => {
    // A control on the DERIVATION. The cases above are generated, so the thing that can go wrong
    // silently is generating fewer of them: a rule set that contributed nothing would simply not
    // appear, and the run would be green over a smaller claim than it states.
    for (const record of CORPUS.filter((r) => r.state === "populated")) {
      for (const set of record.entry.ruleSets) {
        for (const rule of set.rules) {
          for (const direction of ["positive", "negative"]) {
            const found = PLAN.cases.some(
              (entry) =>
                entry.repo === record.repo &&
                entry.ruleSetId === set.id &&
                entry.ruleName === rule.name &&
                entry.direction === direction,
            );
            expect(found, `${record.repo}/${set.id}/${rule.name} has no ${direction} case`).toBe(
              true,
            );
          }
        }
      }
    }
  });

  it("maps every transcribed rule onto a canonical rule that exists", () => {
    // A variant rule keyed onto an id the implementation does not have would be graded only on
    // "something reddened", which is weaker than the claim this file makes.
    for (const entry of PLAN.cases) {
      if (entry.canonicalId === null) continue;
      expect(
        CANONICAL_NAMES.has(entry.canonicalId),
        `${entry.repo}/${entry.ruleName} maps onto \`${entry.canonicalId}\`, which is not a ` +
          "canonical rule",
      ).toBe(true);
    }
  });
});
