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
  sharedPhiScanSource,
  templateScannerSource,
} from "../scripts/drift-check.js";

const REPO_ROOT = process.cwd();
const ALLOW_LIST = readFileSync(
  join(REPO_ROOT, "scripts", "parser-template", "scripts", "phi-allow-list.txt"),
  "utf8",
);
const SHARED_PACKAGE = join(REPO_ROOT, "packages", "script-utils");
const SPEC = phiScanProbeSpec("__test__");

/**
 * Substitute into a source, proving the substitution landed.
 *
 * THERE ARE NOW TWO SOURCES, and which one a case tampers with is the interesting part. The RULES
 * live in `@cosyte/script-utils/phi-scan`, so removing one is a change to the ENGINE, and the probe
 * has to plant the weakened engine rather than hand it to the scanner. The FIVE PER-REPO AXES
 * (the exit codes among them) live in the repo's own scanner, so renumbering the contract is a
 * change there. Every case below says which, because the split is the thing this slice changed.
 */
function tamper(source: string, subs: [string, string][]): string {
  let out = source;
  for (const [from, to] of subs) {
    expect(out, `the source no longer contains ${from}`).toContain(from);
    out = out.replace(from, to);
  }
  return out;
}

function probe(
  scannerSource: string,
  { spec = {}, engine }: { spec?: Record<string, unknown>; engine?: string } = {},
): {
  status: string;
  detail: string;
} {
  return probePhiScanCompleteness({
    scannerSource,
    allowList: ALLOW_LIST,
    spec: { ...SPEC, ...spec },
    sharedPackageDir: SHARED_PACKAGE,
    sharedOverrides: engine === undefined ? undefined : { "phi-scan.js": engine },
  }) as { status: string; detail: string };
}

/** The line whose removal removes the completeness rule, and nothing else. It is in the ENGINE. */
const COMPLETENESS_LINE = "const unread = [...enumerated].filter((p) => !read.has(p) && !tolerated.has(p));";

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

  it("PLANTS THE ENGINE: without the dependency the scanner cannot start, and that is not a pass", () => {
    // The one new failure mode the consolidation introduces, pinned so it can
    // never be mistaken for a verdict. A scanner that imports its machinery and
    // finds no `node_modules` throws on the import, prints no marker, and the
    // probe answers `inconclusive`. That is the same answer it gives for any
    // premise it cannot ground, and it is deliberately NOT `ok`.
    const r = probePhiScanCompleteness({
      scannerSource: templateScannerSource(),
      allowList: ALLOW_LIST,
      spec: SPEC,
      // No `sharedPackageDir`: nothing is planted.
    }) as { status: string; detail: string };
    expect(r.status, r.detail).not.toBe("ok");
    expect(r.status).toBe("inconclusive");
  });

  it("POSITIVE CONTROL: deleting the completeness rule FROM THE ENGINE makes the probe RED", () => {
    // The whole point. The rule is the SET DIFFERENCE between what the run
    // enumerated and what it read; delete it and the run reports its hits and
    // says nothing about the target it withdrew after enumerating.
    //
    // IT IS DELETED FROM THE ENGINE, WHICH IS THE POINT OF THE SLICE: the rule
    // is implemented once, so this is the only place it CAN be deleted from.
    const r = probe(templateScannerSource(), {
      engine: tamper(sharedPhiScanSource(), [[COMPLETENESS_LINE, "const unread = [];"]]),
    });
    expect(r.status, r.detail).toBe("drift");
    expect(r.detail).toContain("HITS code");
  });

  it("REDS on the worse shape too: a scanner that reports CLEAN over the unopened target", () => {
    // The defect as it was originally measured: the bypass withdrew the file
    // and the empty remainder read as clean. Here the violator is withdrawn
    // instead of the decoy, so the run has nothing left to report.
    const r = probe(templateScannerSource(), {
      engine: tamper(sharedPhiScanSource(), [[COMPLETENESS_LINE, "const unread = [];"]]),
      // Both names point at the violator, so the ONLY hit-bearing target is the
      // one the bypass withdraws.
      spec: { decoy: SPEC.violator, clean: SPEC.payload, marker: SPEC.marker },
    });
    // The probe cannot ground this shape (the withdrawn file is the only
    // violator, so no marker is printed), and it says so rather than passing.
    expect(["drift", "inconclusive"]).toContain(r.status);
    expect(r.status).not.toBe("ok");
  });

  it("DERIVES the exit codes rather than assuming them", () => {
    // The siblings deliberately do not agree on their exit codes, so a probe
    // carrying the number 2 would be the same porting mistake it exists to
    // catch. Renumber the whole contract and the verdict must not move.
    //
    // THE CODES ARE A PER-REPO AXIS, so this one tampers with the SCANNER. The
    // engine has no default for them at all, which is why they are still here to
    // renumber after the consolidation.
    const renumbered = tamper(templateScannerSource(), [
      [
        "const EXIT_CODES = { clean: 0, hits: 1, refuse: 2 } as const;",
        "const EXIT_CODES = { clean: 0, hits: 7, refuse: 9 } as const;",
      ],
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
      spec: {
        payload: "nothing a scanner would object to\n",
        marker: "nothing a scanner would object to",
      },
    });
    expect(r.status, r.detail).toBe("inconclusive");
    expect(r.detail).toContain("not detected");
  });

  it("says INCONCLUSIVE when the bypass never gets past the override-log gate", () => {
    // A scanner that refuses the bypass as unlogged refuses BEFORE it reads
    // anything, so the completeness rule was never reached. Refusing is not the
    // same as carrying the rule, and the probe must not read one as the other.
    const r = probe(templateScannerSource(), {
      engine: tamper(sharedPhiScanSource(), [
        ["loadOverrideLog() {", "loadOverrideLog() {\n    return new Set();"],
      ]),
    });
    expect(r.status, r.detail).toBe("inconclusive");
    expect(r.detail).toContain("override-log");
  });

  it("says INCONCLUSIVE when the scanner cannot run at all", () => {
    const r = probe("this is not typescript ((( \n");
    expect(r.status, r.detail).not.toBe("ok");
  });
});
