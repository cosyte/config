import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CONFIG_AXES } from "@cosyte/script-utils/internal-refs";

import {
  CONFLICTS,
  REPOS,
  loadCorpus,
  samplesOf,
  validateEntry,
} from "../conformance/internal-refs/index.js";

/**
 * THE CONFORMANCE CORPUS, graded on the two things a corpus can be silently wrong about.
 *
 * It can be INCOMPLETE: a repository that carries a variant and has no key is a repository nobody
 * can see is missing, and every claim derived from the corpus is then a claim about a smaller set
 * than it says. So the roster is asserted in both directions, and the state of every entry is part
 * of the assertion rather than a fact the graders read and trust.
 *
 * It can be MALFORMED: an entry with no sha records a rule set nobody can attribute to a tree, and
 * a rule with a sample in only one direction can only be graded in that direction. A malformed
 * entry is never skipped so the rest can pass, because an entry that drops out of the graded set
 * reads exactly like one that conformed.
 */

const CORPUS = await loadCorpus();
const ENTRY_DIR = join(import.meta.dirname, "..", "conformance", "internal-refs", "entries");

describe("the roster", () => {
  it("keys an entry for each of the twelve repositories that carry a variant", () => {
    expect(REPOS).toEqual([
      "hl7",
      "mllp",
      "x12",
      "ccda",
      "ncpdp",
      "fhir",
      "astm",
      "terminology",
      "transform",
      "cli",
      "deid",
      "synth",
    ]);
    expect(CORPUS.map((record) => record.repo)).toEqual([...REPOS]);
  });

  it("fails naming the repository when a key has no entry file", () => {
    // Both halves of "the key is absent". The FILE is checked here, because a roster entry whose
    // file never landed would otherwise arrive only as a load error at import time.
    const missing = REPOS.filter((repo) => !existsSync(join(ENTRY_DIR, `${repo}.js`)));
    expect(missing, `these roster keys have no entry file: ${missing.join(", ")}`).toEqual([]);

    // And the loader's own answer for an absent key, so the report NAMES it rather than taking the
    // suite down with a module-resolution error that says nothing about which repository lost it.
    const problems = validateEntry("ghost", null, "Error: Cannot find module './entries/ghost.js'");
    expect(problems.join("\n")).toContain("ghost:");
    expect(problems.join("\n")).toContain("could not be loaded");
  });

  it("declares every entry either populated or pending, and nothing else", () => {
    for (const record of CORPUS) {
      expect(["populated", "pending"], `${record.repo} is ${record.state}`).toContain(record.state);
    }
  });

  it("has hl7 populated, and the eleven that nobody has adopted pending", () => {
    const byRepo = new Map(CORPUS.map((record) => [record.repo, record]));
    expect(byRepo.get("hl7")?.state).toBe("populated");

    const populated = CORPUS.filter((record) => record.state === "populated").map((r) => r.repo);
    const pending = CORPUS.filter((record) => record.state === "pending").map((r) => r.repo);
    expect(populated).toEqual(["hl7"]);
    expect(populated.length + pending.length).toBe(REPOS.length);
  });

  it("holds no unreadable entry, and would say so if it did", () => {
    const unreadable = CORPUS.filter((record) => record.state === "unreadable");
    expect(
      unreadable.map((record) => `${record.repo}: ${record.loadError}`),
      "an entry the corpus could not load",
    ).toEqual([]);
  });
});

describe("every entry is well formed for the state it declares", () => {
  it.each(CORPUS.map((record) => [record.repo, record] as const))(
    "%s conforms to the shape its state requires",
    (_repo, record) => {
      const problems = validateEntry(record.repo, record.entry, record.loadError);
      expect(problems, `\n${problems.join("\n")}\n`).toEqual([]);
    },
  );

  it("gives every rule of every populated entry a sample in both directions", () => {
    const populated = CORPUS.filter((record) => record.state === "populated");
    expect(populated.length).toBeGreaterThan(0);
    for (const record of populated) {
      for (const set of record.entry.ruleSets) {
        for (const rule of set.rules) {
          expect(
            samplesOf(rule, "positive").length,
            `${record.repo}/${set.id}/${rule.name} has no positive sample`,
          ).toBeGreaterThan(0);
          expect(
            samplesOf(rule, "negative").length,
            `${record.repo}/${set.id}/${rule.name} has no negative sample`,
          ).toBeGreaterThan(0);
        }
      }
    }
  });

  it("records the sha every populated entry was read at", () => {
    for (const record of CORPUS.filter((r) => r.state === "populated")) {
      expect(record.entry.sha, `${record.repo} records no sha`).toMatch(/^[0-9a-f]{40}$/);
      expect(record.entry.sourcePath, `${record.repo} records no source path`).toBeTruthy();
    }
  });
});

describe("a malformed entry fails naming the repository and the field", () => {
  /** hl7's entry with one field broken, so each case is a single mutation of a real entry. */
  function mutate(change: (entry: Record<string, unknown>) => void): Record<string, unknown> {
    const populated = CORPUS.find((record) => record.repo === "hl7");
    const entry = structuredCloneEntry(populated?.entry as Record<string, unknown>);
    change(entry);
    return entry;
  }

  it("refuses a populated entry with no sha", () => {
    const report = validateEntry(
      "hl7",
      mutate((e) => delete e.sha),
    ).join("\n");
    expect(report).toContain("hl7:");
    expect(report).toContain("`sha`");
    expect(report).toContain("nobody can attribute to a tree");
  });

  it("refuses a sha that is not a commit id", () => {
    const report = validateEntry(
      "hl7",
      mutate((e) => (e.sha = "086ae19")),
    ).join("\n");
    expect(report).toContain("`sha`");
    expect(report).toContain("40-character");
  });

  it("refuses a rule with no positive sample, naming the rule", () => {
    const report = validateEntry(
      "hl7",
      mutate((e) => {
        delete (e.ruleSets as Record<string, unknown>[])[0].rules[1].positive;
      }),
    ).join("\n");
    expect(report).toContain("hl7:");
    expect(report).toContain("surface.rules[1].positive");
    expect(report).toContain("is missing");
  });

  it("refuses a rule with no negative sample, naming the rule", () => {
    const report = validateEntry(
      "hl7",
      mutate((e) => {
        delete (e.ruleSets as Record<string, unknown>[])[1].rules[3].negative;
      }),
    ).join("\n");
    expect(report).toContain("src-doc-comments.rules[3].negative");
  });

  it("refuses a sample that is not a string", () => {
    const report = validateEntry(
      "hl7",
      mutate((e) => {
        (e.ruleSets as Record<string, unknown>[])[0].rules[0].positive = 42;
      }),
    ).join("\n");
    expect(report).toContain("surface.rules[0].positive");
    expect(report).toContain("not a non-empty string");
  });

  it("refuses an empty sample list, which is the same as missing", () => {
    const report = validateEntry(
      "hl7",
      mutate((e) => {
        (e.ruleSets as Record<string, unknown>[])[0].rules[0].negative = [];
      }),
    ).join("\n");
    expect(report).toContain("surface.rules[0].negative");
  });

  it("refuses a rule set whose surface the implementation has no pass for", () => {
    const report = validateEntry(
      "hl7",
      mutate((e) => {
        (e.ruleSets as Record<string, unknown>[])[0].surface = "release-body";
      }),
    ).join("\n");
    expect(report).toContain("surface.surface");
    expect(report).toContain("release-body");
  });

  it("does not skip a malformed entry and pass on the rest", () => {
    // The failure this pins: a grader that caught the malformed entry, dropped it and reported the
    // remaining eleven green. What comes back is a REPORT naming the broken one, never a shorter
    // corpus. Two independent breakages both survive to the report.
    const broken = mutate((e) => {
      delete e.sha;
      delete (e.ruleSets as Record<string, unknown>[])[0].rules[0].negative;
    });
    const problems = validateEntry("hl7", broken);
    expect(problems.length).toBeGreaterThanOrEqual(2);
    expect(problems.every((line) => line.startsWith("hl7: "))).toBe(true);
  });

  it("refuses a pending entry carrying any sample material", () => {
    // Material nobody read inside that repository is material nobody can attribute, so this is a
    // malformed entry rather than a head start for the sweep.
    for (const field of ["ruleSets", "canonicalConfig", "sha", "sourcePath", "residuals"]) {
      const report = validateEntry("mllp", {
        repo: "mllp",
        state: "pending",
        reason: "nobody has adopted it",
        [field]: field === "sha" ? "0".repeat(40) : [],
      }).join("\n");
      expect(report, `a pending entry with \`${field}\` was accepted`).toContain(`\`${field}\``);
      expect(report).toContain("PENDING");
    }
  });

  it("refuses a pending entry with no reason", () => {
    const report = validateEntry("mllp", { repo: "mllp", state: "pending" }).join("\n");
    expect(report).toContain("`reason`");
  });

  it("refuses an entry filed under the wrong repository", () => {
    const report = validateEntry("mllp", {
      repo: "x12",
      state: "pending",
      reason: "nobody has adopted it",
    }).join("\n");
    expect(report).toContain("`repo`");
  });

  it("refuses a state that is neither populated nor pending", () => {
    const report = validateEntry("mllp", { repo: "mllp", state: "partial" }).join("\n");
    expect(report).toContain("`state`");
    expect(report).toContain("partial");
  });
});

describe("the conflict register", () => {
  const AXIS_NAMES = new Set(CONFIG_AXES.map((axis) => axis.name));
  const POPULATED = new Set(
    CORPUS.filter((record) => record.state === "populated").map((record) => record.repo),
  );

  it("records at least one contradiction, and the worked example among them", () => {
    expect(CONFLICTS.length).toBeGreaterThan(0);
    // The one the spec names: a prefix deliberately absent from hl7's set and present in the
    // upstream list its own variant records itself as transcribed from.
    const pkg = CONFLICTS.find((conflict) => conflict.id === "prefix-set-pkg");
    expect(pkg, "the PKG contradiction is not recorded").toBeDefined();
    expect(pkg?.rule).toBe("internal project identifier");
    expect(pkg?.resolution).toBe("configuration-axis");
    expect(pkg?.decidedAs).toBe("projectPrefixes");
  });

  it.each(CONFLICTS.map((conflict) => [conflict.id, conflict] as const))(
    "%s names both rule sets, the rule, and what it was decided as",
    (_id, conflict) => {
      expect(typeof conflict.rule).toBe("string");
      expect(conflict.rule.trim()).not.toBe("");

      // BOTH SIDES, each with a source and a position. A register that recorded only the answer
      // would be a design note: the point is that a reader can see what was given up.
      expect(conflict.between.length).toBeGreaterThanOrEqual(2);
      for (const side of conflict.between) {
        expect(typeof side.source).toBe("string");
        expect(side.source.trim()).not.toBe("");
        expect(side.position.trim().length).toBeGreaterThan(20);
      }
      const positions = new Set(conflict.between.map((side) => side.position));
      expect(positions.size, "both sides say the same thing, so nothing contradicts").toBe(
        conflict.between.length,
      );

      expect(["configuration-axis", "canonical"]).toContain(conflict.resolution);
      expect(conflict.why.trim().length).toBeGreaterThan(40);
    },
  );

  it("resolves an axis contradiction onto an axis that exists", () => {
    // The contradictions DECIDE the axes, so a row naming an axis the implementation does not have
    // is a decision nothing carries out.
    for (const conflict of CONFLICTS) {
      if (conflict.resolution !== "configuration-axis") continue;
      const named = conflict.decidedAs.split(/\s+plus\s+|,\s*/).map((part) => part.trim());
      for (const axis of named) {
        expect(AXIS_NAMES, `${conflict.id} resolves onto \`${axis}\``).toContain(axis);
      }
    }
  });

  it("is exposed only by entries that are actually populated", () => {
    // A row citing a pending entry would be a contradiction nobody read, which is the same defect
    // as sample material in a pending entry.
    for (const conflict of CONFLICTS) {
      expect(conflict.repos.length).toBeGreaterThan(0);
      for (const repo of conflict.repos) {
        expect(POPULATED, `${conflict.id} cites ${repo}, which is not populated`).toContain(repo);
      }
    }
  });
});

/** A structural clone that survives functions being absent, which `structuredClone` does not. */
function structuredCloneEntry(entry: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(entry)) as Record<string, unknown>;
}
