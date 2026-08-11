/**
 * Guards the ONE behavioural assertion in `scripts/drift-check.js`: the PHI-scan
 * COMPLETENESS CAPABILITY PROBE.
 *
 * WHY IT IS A PROBE AND NOT A MATCHER, RESTATED HERE ONLY AS FAR AS THIS SUITE
 * TESTS IT. Every other drift check reads a declaration (a version, a script
 * name, a workflow filename), which is fair because those things ARE
 * declarations. The completeness rule is a BEHAVIOUR, and this lineage has
 * produced six defects that lived in a PROSE CARRIER while the code was right
 * every time. A regex over a scanner's source would grade the comment above the
 * rule. So the probe runs the scanner and reads its exit code and output.
 *
 * WHAT THIS SUITE ADDS ON TOP OF THE PROBE'S OWN CONTROLS. The probe reds when
 * the rule is removed, which is asserted here rather than only inside the tool,
 * because `pnpm drift` needs sibling checkouts and this repo's CI has none: the
 * controls would otherwise run nowhere. It also pins the two ways the probe
 * refuses to make a claim (an undetectable payload, and a bypass the repo's own
 * override-log gate never admits), and pins that the probe DERIVES a repo's exit
 * codes rather than assuming them, which is the porting mistake it exists to
 * catch.
 *
 * SECURITY / PHI: every payload here is synthetic, and the probe writes only
 * into a throwaway temp directory it removes afterwards.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  phiScanProbeControls,
  phiScanProbeSpec,
  probePhiScanCompleteness,
  templateScannerSource,
} from "../scripts/drift-check.js";

const REPO_ROOT = process.cwd();
const ALLOW_LIST = readFileSync(
  join(REPO_ROOT, "scripts", "parser-template", "scripts", "phi-allow-list.txt"),
  "utf8",
);
const SPEC = phiScanProbeSpec("__test__");

/** Substitute into the template's scanner, proving the substitution landed. */
function tampered(subs: [string, string][]): string {
  let source = templateScannerSource();
  for (const [from, to] of subs) {
    expect(source, `the scanner no longer contains ${from}`).toContain(from);
    source = source.replace(from, to);
  }
  return source;
}

function probe(
  scannerSource: string,
  spec: Record<string, unknown> = {},
): {
  status: string;
  detail: string;
} {
  return probePhiScanCompleteness({
    scannerSource,
    allowList: ALLOW_LIST,
    spec: { ...SPEC, ...spec },
  }) as { status: string; detail: string };
}

describe("the phi-scan completeness probe", () => {
  it("passes its own controls: the shipped template is ok, the rule removed REDS", () => {
    // The tool's own gate, run here because `pnpm drift` needs sibling
    // checkouts that this repo's CI does not have. An assertion nobody has seen
    // fail is indistinguishable from one that cannot.
    expect(phiScanProbeControls()).toEqual([]);
  });

  it("NEGATIVE CONTROL: the shipped parser-template scanner carries the rule", () => {
    const r = probe(templateScannerSource());
    expect(r.status, r.detail).toBe("ok");
  });

  it("POSITIVE CONTROL: deleting the completeness rule makes the probe RED", () => {
    // The whole point. The rule is the SET DIFFERENCE between what the run
    // enumerated and what it read; delete it and the run reports its hits and
    // says nothing about the target it withdrew after enumerating.
    const r = probe(
      tampered([
        ["const unread = [...enumerated].filter((p) => !read.has(p));", "const unread = [];"],
      ]),
    );
    expect(r.status, r.detail).toBe("drift");
    expect(r.detail).toContain("HITS code");
  });

  it("REDS on the worse shape too: a scanner that reports CLEAN over the unopened target", () => {
    // The defect as it was originally measured: the bypass withdrew the file
    // and the empty remainder read as clean. Here the violator is withdrawn
    // instead of the decoy, so the run has nothing left to report.
    const noRule = tampered([
      ["const unread = [...enumerated].filter((p) => !read.has(p));", "const unread = [];"],
    ]);
    const r = probePhiScanCompleteness({
      scannerSource: noRule,
      allowList: ALLOW_LIST,
      // Both names point at the violator, so the ONLY hit-bearing target is the
      // one the bypass withdraws.
      spec: { ...SPEC, decoy: SPEC.violator, clean: SPEC.payload, marker: SPEC.marker },
    }) as { status: string; detail: string };
    // The probe cannot ground this shape (the withdrawn file is the only
    // violator, so no marker is printed), and it says so rather than passing.
    expect(["drift", "inconclusive"]).toContain(r.status);
    expect(r.status).not.toBe("ok");
  });

  it("DERIVES the exit codes rather than assuming them", () => {
    // The siblings deliberately do not agree on their exit codes, so a probe
    // carrying the number 2 would be the same porting mistake it exists to
    // catch. Renumber the whole contract and the verdict must not move.
    const renumbered = tampered([
      ["const EXIT_HITS = 1;", "const EXIT_HITS = 7;"],
      ["const EXIT_REFUSE = 2;", "const EXIT_REFUSE = 9;"],
    ]);
    const r = probe(renumbered);
    expect(r.status, r.detail).toBe("ok");
    expect(r.detail).toContain("exit 9");
  });

  it("says INCONCLUSIVE when the payload is not detectable, rather than passing", () => {
    // A clean report over a payload the scanner cannot see proves nothing about
    // whether it READ the file. This is the state `dicom` was in against the
    // default payload, and it is why that repo has its own manifest entry.
    const r = probe(templateScannerSource(), {
      payload: "nothing a scanner would object to\n",
      marker: "nothing a scanner would object to",
    });
    expect(r.status, r.detail).toBe("inconclusive");
    expect(r.detail).toContain("not detected");
  });

  it("says INCONCLUSIVE when the bypass never gets past the override-log gate", () => {
    // A scanner that refuses the bypass as unlogged refuses BEFORE it reads
    // anything, so the completeness rule was never reached. Refusing is not the
    // same as carrying the rule, and the probe must not read one as the other.
    const noOverrides = tampered([
      [
        "function loadOverrideLog(): Set<string> {",
        "function loadOverrideLog(): Set<string> {\n  return new Set();",
      ],
    ]);
    const r = probe(noOverrides);
    expect(r.status, r.detail).toBe("inconclusive");
    expect(r.detail).toContain("override-log");
  });

  it("says INCONCLUSIVE when the scanner cannot run at all", () => {
    const r = probe("this is not typescript ((( \n");
    expect(r.status, r.detail).not.toBe("ok");
  });
});
