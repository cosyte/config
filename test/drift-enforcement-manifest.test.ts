/**
 * THE STANDARD NOW DECLARES WHICH REPOS ITS VERDICT BINDS, AND THIS SUITE GRADES THAT DECLARATION.
 *
 * WHAT WAS WRONG. `drift-manifest.json` said what every repo owes and never said whose failure was
 * anybody's problem. `scripts/drift-check.js` has always exited 1 on drift, but nothing read that
 * code, so a repo could drift for a year without a merge ever being refused, and a run over a corpus
 * holding one green repo and missing the other twenty-three exited 0. A gate wired to that would
 * have inherited the hole.
 *
 * WHAT THE DECLARATION HAS TO SURVIVE, WHICH IS WHY EACH HAS ITS OWN CASE.
 *
 *  1. IT COULD GO STALE BY OMISSION. A submodule added to the estate and classified by nobody is a
 *     repo the standard has no opinion about, and silence there reads exactly like a decision. So
 *     every path in `estate.submodulePaths` must be BINDING or DEFERRED, and a hole is a refusal
 *     that names the path.
 *  2. A DEFERRAL COULD BECOME A PLACEHOLDER. "not yet" with no reason is how a temporary state
 *     becomes permanent, so a deferral carries a written reason at the same floor the standard
 *     already sets on a `configSubject` exemption's `why`, and a refusal names the REPO rather than
 *     a list index.
 *  3. IT COULD CLASSIFY A REPO THAT IS NOT THERE, OR CLASSIFY ONE TWICE. Both make the roster a
 *     measurement of nothing, and a manifest that does not validate must grade NO repo.
 *  4. THE SET COULD BE EMPTIED. A gate that binds no repo is not a gate, and emptying the list must
 *     not be a quiet way to switch enforcement off.
 *
 * Every case builds its own manifest variant in a temp file and runs the REAL validator over it.
 * Nothing here reads a sibling checkout and nothing reaches the network.
 *
 * SECURITY / PHI: no real repository is read and every fixture written here is synthetic.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { runCheck } from "../scripts/drift-check.js";
import {
  DEFAULT_MANIFEST,
  DEFAULT_SCHEMA,
  checkInvariants,
  validateManifest,
} from "../scripts/validate-drift-manifest.mjs";

const REPO_ROOT = process.cwd();
const VALIDATOR = join(REPO_ROOT, "scripts", "validate-drift-manifest.mjs");
const RAW_MANIFEST = readFileSync(DEFAULT_MANIFEST, "utf8");
const MANIFEST = JSON.parse(RAW_MANIFEST) as Record<string, any>;

const ESTATE: string[] = MANIFEST["estate"].submodulePaths;
const ENFORCEMENT = MANIFEST["enforcement"] as {
  provenance: string;
  binding: string[];
  deferred: Record<string, { why: string }>;
};

/** The floor a deferral's reason has to clear, written out rather than read from the file under test. */
const REASON_FLOOR = 40;

const TEMP_DIRS: string[] = [];
afterAll(() => {
  for (const dir of TEMP_DIRS) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "drift-enforcement-manifest-"));
  TEMP_DIRS.push(dir);
  return dir;
}

/** Write a mutated copy of the shipped manifest and hand back its path. */
function manifestFile(mutate: (draft: Record<string, any>) => void): string {
  const draft = JSON.parse(RAW_MANIFEST) as Record<string, any>;
  mutate(draft);
  // The schema is named by a relative `$schema`, so the copy has to point back at the real one.
  draft["$schema"] = DEFAULT_SCHEMA;
  const path = join(tempDir(), "drift-manifest.json");
  writeFileSync(path, JSON.stringify(draft, null, 2), "utf8");
  return path;
}

function runValidator(args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [VALIDATOR, ...args], { encoding: "utf8" });
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** Grade a manifest variant with the real drift run, which must report on NO repo when it refuses. */
function runOver(manifestPath: string): { code: number; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const code = runCheck({
    manifestPath,
    root: tempDir(),
    controls: () => [],
    probe: () => null,
    out: (line: string) => out.push(line),
    err: (line: string) => err.push(line),
  }) as unknown as number;
  return { code, out, err };
}

// ---------------------------------------------------------------------------
// The control: the shipped standard declares an enforcement set, and it validates.
// ---------------------------------------------------------------------------

describe("the standard declares who its verdict binds, with its own provenance", () => {
  it("validates as shipped, by both routes", () => {
    const result = validateManifest();
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(checkInvariants(MANIFEST)).toEqual([]);
    const cli = runValidator([]);
    expect(cli.stderr).toBe("");
    expect(cli.status).toBe(0);
  });

  it("carries a provenance note saying where the binding set came from", () => {
    expect(ENFORCEMENT.provenance.length).toBeGreaterThanOrEqual(REASON_FLOOR);
    // The set is DERIVED from a measurement, and the note has to say so and date it, or the roster
    // is a preference wearing the word `measured`.
    expect(ENFORCEMENT.provenance).toMatch(/2026-09-08/);
    expect(ENFORCEMENT.provenance).toMatch(/drift-check\.js/);
    // And that deferral is the migration's state rather than a permanent excuse.
    expect(ENFORCEMENT.provenance).toMatch(/never a permanent excuse/i);
  });

  it("binds at least config, the repo that publishes the standard", () => {
    expect(ENFORCEMENT.binding).toContain("config");
  });
});

// ---------------------------------------------------------------------------
// AC1: the roster cannot go stale by omission.
// ---------------------------------------------------------------------------

describe("AC1: every submodule path is classified, or validation refuses and names it", () => {
  it("classifies every estate path exactly once, as shipped", () => {
    const classified = [...ENFORCEMENT.binding, ...Object.keys(ENFORCEMENT.deferred)];
    expect([...classified].sort()).toEqual([...ESTATE].sort());
    expect(classified.length).toBe(new Set(classified).size);
  });

  it("REFUSES a standard that classifies a path neither way, naming that path", () => {
    // The stale-by-omission shape: the repo stays in the estate and in its baseline, and only its
    // classification is dropped. Nothing else about the manifest changes.
    const orphan = Object.keys(ENFORCEMENT.deferred)[0]!;
    const path = manifestFile((draft) => {
      delete draft["enforcement"].deferred[orphan];
    });
    const r = runValidator(["--manifest", path]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(orphan);
    expect(r.stderr).toContain("classified neither BINDING nor DEFERRED");
  });

  it("refuses the same way for a path dropped out of the binding set", () => {
    // A non-empty binding set throughout, so this grades TOTALITY and not emptiness: one repo is
    // promoted out of `deferred` and `config` is dropped out of `binding` and put nowhere.
    const promoted = Object.keys(ENFORCEMENT.deferred)[0]!;
    const path = manifestFile((draft) => {
      draft["enforcement"].binding = [promoted];
      delete draft["enforcement"].deferred[promoted];
    });
    const r = runValidator(["--manifest", path]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('"config" is classified neither BINDING nor DEFERRED');
  });

  it("grades NO repo over a standard with a hole in its roster", () => {
    const orphan = Object.keys(ENFORCEMENT.deferred)[0]!;
    const path = manifestFile((draft) => {
      delete draft["enforcement"].deferred[orphan];
    });
    const { code, out, err } = runOver(path);
    expect(code).toBe(2);
    expect(out).toEqual([]);
    expect(err.join("\n")).toContain("does not validate, so nothing was graded");
  });
});

// ---------------------------------------------------------------------------
// AC2: a deferral is a written reason, at the floor an exemption already carries.
// ---------------------------------------------------------------------------

describe("AC2: every deferred repo carries a reason of at least 40 characters", () => {
  it("holds for every deferral the standard ships", () => {
    const deferred = Object.entries(ENFORCEMENT.deferred);
    expect(deferred.length).toBeGreaterThan(0);
    for (const [repo, entry] of deferred) {
      expect(entry.why.length, `${repo} carries a placeholder reason`).toBeGreaterThanOrEqual(
        REASON_FLOOR,
      );
      // It says what that repo MEASURED, which is the thing that makes the deferral arguable.
      expect(entry.why, repo).toMatch(/drift\(s\)/);
    }
  });

  it("is the same floor the standard sets on a configSubject exemption's reason", () => {
    for (const entry of MANIFEST["configSubject"].exemptions as { why: string }[]) {
      expect(entry.why.length).toBeGreaterThanOrEqual(REASON_FLOOR);
    }
  });

  it("REFUSES a deferral whose reason is shorter than the floor, naming the REPO", () => {
    const repo = Object.keys(ENFORCEMENT.deferred)[0]!;
    const path = manifestFile((draft) => {
      draft["enforcement"].deferred[repo].why = "because";
    });
    const r = runValidator(["--manifest", path]);
    expect(r.status).toBe(1);
    // A list index would not tell a reader which repo, which is why `deferred` is keyed by path.
    expect(r.stderr).toContain(`enforcement.deferred.${repo}.why: want at least 40 characters`);
  });

  it("REFUSES a deferral one character under the floor, so the bound is the declared one", () => {
    const repo = Object.keys(ENFORCEMENT.deferred)[0]!;
    const under = manifestFile((draft) => {
      draft["enforcement"].deferred[repo].why = "x".repeat(REASON_FLOOR - 1);
    });
    expect(runValidator(["--manifest", under]).status).toBe(1);
    const at = manifestFile((draft) => {
      draft["enforcement"].deferred[repo].why = "x".repeat(REASON_FLOOR);
    });
    expect(runValidator(["--manifest", at]).status).toBe(0);
  });

  it("REFUSES a deferral with no reason at all, naming the REPO", () => {
    const repo = Object.keys(ENFORCEMENT.deferred)[0]!;
    const path = manifestFile((draft) => {
      delete draft["enforcement"].deferred[repo].why;
    });
    const r = runValidator(["--manifest", path]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`enforcement.deferred.${repo}: missing required property "why"`);
  });

  it("REFUSES a deferral that smuggles in a key the schema does not declare", () => {
    const repo = Object.keys(ENFORCEMENT.deferred)[0]!;
    const path = manifestFile((draft) => {
      draft["enforcement"].deferred[repo].until = "someday";
    });
    const r = runValidator(["--manifest", path]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`enforcement.deferred.${repo}.until: unexpected property`);
  });
});

// ---------------------------------------------------------------------------
// AC3: a repo the estate does not carry, or one classified twice.
// ---------------------------------------------------------------------------

describe("AC3: a classification of a repo that is not there, or of one repo twice", () => {
  it("REFUSES a deferral naming a repo the estate does not carry, and grades nothing", () => {
    const path = manifestFile((draft) => {
      draft["enforcement"].deferred["nosuchrepo"] = {
        why: "a repo that no .gitmodules row carries, so classifying it classifies nothing at all",
      };
    });
    const r = runValidator(["--manifest", path]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("nosuchrepo");
    expect(r.stderr).toContain("is not one of estate.submodulePaths");

    const { code, out } = runOver(path);
    expect(code).toBe(2);
    expect(out).toEqual([]);
  });

  it("REFUSES a binding entry naming a repo the estate does not carry, and grades nothing", () => {
    const path = manifestFile((draft) => {
      draft["enforcement"].binding.push("nosuchrepo");
    });
    const r = runValidator(["--manifest", path]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("enforcement.binding[");
    expect(r.stderr).toContain("nosuchrepo");

    expect(runOver(path).code).toBe(2);
  });

  it("REFUSES a repo that is BINDING and DEFERRED at once, and grades nothing", () => {
    const path = manifestFile((draft) => {
      draft["enforcement"].deferred["config"] = {
        why: "the same repo classified twice, which is two answers to whether its drift fails a run",
      };
    });
    const r = runValidator(["--manifest", path]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("config");
    expect(r.stderr).toContain("is already classified at");

    const { code, out } = runOver(path);
    expect(code).toBe(2);
    expect(out).toEqual([]);
  });

  it("REFUSES the same repo listed twice in the binding set", () => {
    const path = manifestFile((draft) => {
      draft["enforcement"].binding = ["config", "config"];
    });
    const r = runValidator(["--manifest", path]);
    expect(r.status).toBe(1);
    // `uniqueItems` sees the byte-identical pair; the invariant would see it too if it did not.
    expect(r.stderr).toMatch(/duplicate entry "config"|is already classified at/);
  });

  it("REFUSES a repo path the schema's own vocabulary cannot express", () => {
    // The org profile repo is NAMED `.github` and PATHED `github-profile`. A leading dot cannot be
    // written here, so it cannot be classified by name even by accident.
    const path = manifestFile((draft) => {
      draft["enforcement"].deferred[".github"] = {
        why: "addressed by NAME rather than by PATH, which is the one thing this vocabulary refuses",
      };
    });
    const r = runValidator(["--manifest", path]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("(property name)");
  });
});

// ---------------------------------------------------------------------------
// AC4: emptying the set is not a quiet way to switch enforcement off.
// ---------------------------------------------------------------------------

describe("AC4: a gate that binds no repo is not a gate", () => {
  it("REFUSES an empty binding set at the schema", () => {
    const path = manifestFile((draft) => {
      draft["enforcement"].binding = [];
      // Every repo has to stay classified, or this would be graded by the totality invariant
      // instead of by the emptiness one.
      draft["enforcement"].deferred["config"] = {
        why: "moved to deferred by this fixture so that ONLY the emptiness of binding is under test",
      };
    });
    const r = runValidator(["--manifest", path]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("enforcement.binding: want at least 1 item(s), got 0");
  });

  it("REFUSES it at the invariant too, which is the route a direct caller takes", () => {
    const emptied = JSON.parse(RAW_MANIFEST) as Record<string, any>;
    emptied["enforcement"].binding = [];
    emptied["enforcement"].deferred["config"] = {
      why: "moved to deferred by this fixture so that ONLY the emptiness of binding is under test",
    };
    expect(checkInvariants(emptied).join("\n")).toContain(
      "enforcement.binding: empty. A gate that binds no repo is not a gate",
    );
  });

  it("REFUSES a standard with the whole enforcement block deleted", () => {
    const path = manifestFile((draft) => {
      delete draft["enforcement"];
    });
    const r = runValidator(["--manifest", path]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('(root): missing required property "enforcement"');
    expect(runOver(path).code).toBe(2);
  });

  it("REFUSES a standard whose enforcement block drops binding or deferred", () => {
    for (const key of ["binding", "deferred", "provenance"]) {
      const path = manifestFile((draft) => {
        delete draft["enforcement"][key];
      });
      const r = runValidator(["--manifest", path]);
      expect(r.status, key).toBe(1);
      expect(r.stderr, key).toContain(`enforcement: missing required property "${key}"`);
    }
  });
});
