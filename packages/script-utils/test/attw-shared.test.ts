/**
 * THE RECONCILIATION GRADER for `@cosyte/script-utils/attw`, plus the cases that only a SHARED
 * body can have.
 *
 * WHAT THIS FILE IS FOR, AND WHY IT IS NOT A THIRD COPY OF THE TWO CORPORA THIS REPO ALREADY HAS.
 * `packages/test-utils/test/attw-gate.test.ts` grades the gate this repository runs on its own
 * published package, and `test/attw-scaffold.test.ts` grades the gate a freshly scaffolded parser
 * inherits. Both of them ran against a COPY of the probe. Consolidating two bodies into one is a
 * merge, and the failure mode of a merge is a mode that quietly stops being reported, which
 * presents as a green run. So this file does two things neither corpus can:
 *
 *   1. IT GRADES THE INVENTORY AGAINST THE CORPORA. `conformance/attw-failure-modes.json` holds one
 *      entry per distinct failure mode and per distinct refusal either pre-consolidation body
 *      carried, with the corpus case that pins it. Every detection entry must name a case that
 *      EXISTS, is not skipped, and still carries the assertion recorded for it. Deleting a
 *      detection case, `it.skip`-ing it or removing the string it asserts therefore reds this file
 *      rather than passing quietly, which is the whole of what makes the inventory a grader instead
 *      of a list.
 *   2. IT RUNS THE MODES THAT HAVE NO HOME IN EITHER CORPUS. The refusal the 297-line variant had
 *      and the 1500-line one did not; the empty-artifact case only hl7's corpus pinned; the
 *      document-shape refusal neither corpus pinned; and the three modes the consolidation itself
 *      creates, all of which are about WHICH dependency tree the gate resolved its binary in.
 *
 * WHAT THE LIVE CASES USE FOR A BINARY, AND WHY IT IS USUALLY A SHIM. A case that must reach attw
 * itself uses the real CLI, resolved through `@cosyte/test-utils`, which is the only package here
 * that depends on it. A case whose whole subject is a refusal RAISED BEFORE THE SPAWN uses a shim
 * that records having been run: the real CLI would add a real `npm pack` to a run that never
 * reaches it, and a shim that leaves a mark on disk is how "the gate did not run this" becomes a
 * fact rather than an inference.
 *
 * SECURITY: every subprocess call uses spawnSync with array args. No exec, no shell form. Fixtures
 * are throwaway packages in a temp directory; nothing here touches this repository's own tree.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PACKAGE_DIR = join(import.meta.dirname, "..");
const REPO_ROOT = join(PACKAGE_DIR, "..", "..");
const CANONICAL = join(PACKAGE_DIR, "attw.js");
const INVENTORY = join(PACKAGE_DIR, "conformance", "attw-failure-modes.json");
/** The shipped caller, copied into every fixture: the file a consuming repo keeps. */
const CALLER = join(REPO_ROOT, "packages", "test-utils", "scripts", "attw.mjs");
const TEST_UTILS = join(REPO_ROOT, "packages", "test-utils");
const OFFLINE = ["--no-definitely-typed"];

interface Assertion {
  corpus: string;
  case: string;
  asserts?: string[];
  declares?: string[];
}

interface Entry {
  id: string;
  net: string;
  class: "detection" | "non-detection" | "reading-difference";
  detects: string;
  carriedBy: string[];
  canonical: string;
  note?: string;
  reason?: string;
  reExpressed?: boolean;
  input?: string;
  assertions?: Assertion[];
}

interface Inventory {
  bodies: Record<string, unknown>;
  corpora: Record<string, string>;
  entries: Entry[];
}

const inventory = JSON.parse(readFileSync(INVENTORY, "utf8")) as Inventory;

/** Corpus sources, read once. The `hl7` corpus is not in this repository and is never read. */
const CORPUS_SOURCE = new Map<string, string>();
for (const [key, rel] of Object.entries(inventory.corpora)) {
  if (key === "hl7") continue;
  CORPUS_SOURCE.set(key, readFileSync(join(REPO_ROOT, rel), "utf8"));
}

/**
 * The text of one test case, from the literal that identifies it to the next case in the file.
 *
 * SCOPED TO THE CASE RATHER THAN THE FILE, because "the file still contains that string somewhere"
 * is satisfied by a comment. A needle recorded for a case has to still be inside that case, which
 * is what makes WEAKENING an assertion (deleting the expectation but keeping the case) red here.
 *
 * `declares` needles are file-scoped on purpose and are used only where the input is a row in a
 * table that a single `it` iterates: there the fixture fragment is outside the case body by
 * construction, and pinning the row is pinning the input.
 */
function caseBlock(source: string, caseText: string): string | null {
  const at = source.indexOf(caseText);
  if (at < 0) return null;
  const rest = source.slice(at);
  const next = rest.slice(1).search(/\n {2,8}(it|describe)[.(]/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

/** Whether the case that contains `caseText` is skipped, todo'd or otherwise not run. */
function isDisabled(source: string, caseText: string): boolean {
  const at = source.indexOf(caseText);
  if (at < 0) return false;
  const before = source.slice(Math.max(0, at - 120), at);
  return /\b(it|test|describe)\.(skip|todo|fails|skipIf)\b/.test(before);
}

describe("the inventory is a grader, not a list", () => {
  it("every entry is well formed and unique", () => {
    const ids = inventory.entries.map((e) => e.id);
    expect(new Set(ids).size, "duplicate entry id").toBe(ids.length);
    // NON-VACUITY. An empty or truncated inventory would satisfy every loop below, which is the
    // shape a grader fails silently in. The floor is the pre-consolidation reconciliation's own
    // size: nets 1 to 4, the argument guard, the environment strip, and the modes consolidation
    // adds.
    expect(inventory.entries.length).toBeGreaterThanOrEqual(30);
    for (const entry of inventory.entries) {
      expect(entry.id, `${entry.id}: id`).toMatch(/^[a-zA-Z0-9-]+$/);
      expect(entry.detects.length, `${entry.id}: detects`).toBeGreaterThan(20);
      expect(
        ["detection", "non-detection", "reading-difference"],
        `${entry.id}: class`,
      ).toContain(entry.class);
      for (const body of entry.carriedBy) {
        expect(Object.keys(inventory.bodies), `${entry.id}: carriedBy`).toContain(body);
      }
      expect(
        ["carried", "added", "strengthened", "removed", "not-carried"],
        `${entry.id}: canonical`,
      ).toContain(entry.canonical);
    }
  });

  it("every DETECTION entry names at least one case in a corpus this repository has", () => {
    // THIS IS THE SUPERSET RULE IN ITS MECHANICAL FORM. A detection mode with no assertion behind
    // it is a mode nothing would notice losing, and losing one is the single failure this
    // consolidation can have.
    for (const entry of inventory.entries) {
      if (entry.class !== "detection") continue;
      const inTree = (entry.assertions ?? []).filter((a) => a.corpus !== "hl7");
      expect(
        inTree.length,
        `${entry.id} is a detection mode with no assertion behind it in this repository`,
      ).toBeGreaterThan(0);
    }
  });

  it("every recorded assertion still exists, is not skipped, and still asserts what it recorded", () => {
    for (const entry of inventory.entries) {
      for (const assertion of entry.assertions ?? []) {
        if (assertion.corpus === "hl7") continue;
        const source = CORPUS_SOURCE.get(assertion.corpus);
        expect(source, `${entry.id}: unknown corpus ${assertion.corpus}`).toBeDefined();
        const block = caseBlock(source ?? "", assertion.case);
        expect(
          block,
          `${entry.id}: ${assertion.corpus} no longer carries the case "${assertion.case}"`,
        ).not.toBeNull();
        expect(
          isDisabled(source ?? "", assertion.case),
          `${entry.id}: the case "${assertion.case}" is skipped`,
        ).toBe(false);
        for (const needle of assertion.asserts ?? []) {
          expect(
            block ?? "",
            `${entry.id}: the case "${assertion.case}" no longer asserts ${needle}`,
          ).toContain(needle);
        }
        for (const needle of assertion.declares ?? []) {
          expect(
            source ?? "",
            `${entry.id}: ${assertion.corpus} no longer declares the input ${needle}`,
          ).toContain(needle);
        }
      }
    }
  });

  it("every class-(b) entry carries its reason, and every re-expressed one carries its input", () => {
    // The Contract's enumeration requirement, machine-checked rather than left to a notes file: a
    // non-detection assertion may be re-expressed only where the canonical is strictly stricter or
    // strictly more structural, and every such change is recorded with the input and the reason.
    for (const entry of inventory.entries) {
      if (entry.class === "detection") continue;
      expect((entry.reason ?? "").length, `${entry.id}: reason`).toBeGreaterThan(40);
      if (entry.reExpressed === true) {
        expect((entry.input ?? "").length, `${entry.id}: input`).toBeGreaterThan(20);
      }
    }
  });

  it("the modes the two bodies disagreed about are all recorded", () => {
    // The reconciliation's own findings, pinned by id so that a later edit cannot drop one of them
    // and leave the file looking complete.
    const byId = new Map(inventory.entries.map((e) => [e.id, e]));
    for (const id of [
      "net1-zero-declared-refusal",
      "net1-declared-path-empty",
      "net2-document-shape-change",
      "hl7-untyped-prose-assertion",
      "hl7-accepts-no-summary-no-emoji-no-color",
      "hl7-green-run-prints-no-attw-gate",
      "hl7-attw-json-key-refusal",
      "exports-leaf-without-dot",
    ]) {
      expect(byId.get(id), `the inventory no longer records ${id}`).toBeDefined();
    }
    expect(byId.get("net1-zero-declared-refusal")?.canonical).toBe("added");
    expect(byId.get("net1-zero-declared-refusal")?.carriedBy).toEqual(["hl7-297"]);
  });
});

// ---------------------------------------------------------------------------
// The live half: one consuming package per case, built the way `pnpm install` builds one.
// ---------------------------------------------------------------------------

let root: string;
/** The real attw CLI entry point, resolved through the only package here that depends on it. */
let attwEntry: string;

interface Consumer {
  dir: string;
  /** Where a shim binary records that it was run, whether or not it should have been. */
  marker: string;
  installed: string;
}

interface RunResult {
  code: number;
  out: string;
}

function run(bin: string, args: string[], cwd: string): RunResult {
  const r = spawnSync(bin, args, { cwd, encoding: "utf8", timeout: 100_000 });
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/**
 * A consuming package: its manifest, its files, the shipped caller at `scripts/attw.mjs`, and the
 * canonical installed where `pnpm install` would put it.
 *
 * A COPY RATHER THAN A SYMLINK, for the reason the phi-scan scaffold suite gives: a symlink into
 * this workspace would let a case mutate the source tree, and one case here mutates the installed
 * copy deliberately. `node_modules` is filtered out of the copy so a test does not drag vitest into
 * every fixture.
 */
function makeConsumer(
  name: string,
  manifest: Record<string, unknown>,
  files: Record<string, string> = {},
  bin: "shim" | "real" | "none" | "not-executable" = "shim",
): Consumer {
  const dir = join(root, name);
  mkdirSync(join(dir, "scripts"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify(manifest, null, 2));
  for (const [file, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), body);
  }
  writeFileSync(join(dir, "scripts", "attw.mjs"), readFileSync(CALLER));

  const installed = join(dir, "node_modules", "@cosyte", "script-utils");
  cpSync(PACKAGE_DIR, installed, {
    recursive: true,
    dereference: true,
    filter: (src) => !src.includes(`${"node_modules"}`),
  });

  const marker = join(dir, "attw-shim-ran");
  const binDir = join(dir, "node_modules", ".bin");
  if (bin !== "none") {
    mkdirSync(binDir, { recursive: true });
    const path = join(binDir, "attw");
    if (bin === "real") {
      writeFileSync(path, `#!/bin/sh\n: > ${JSON.stringify(marker)}\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(attwEntry)} "$@"\n`);
    } else {
      // A shim that records being run and prints a PASSING document. `kind: "included"` is the one
      // shape net 2 accepts, so a case that reaches the spawn stays green for a reason that is not
      // the shim's.
      const report = JSON.stringify({
        analysis: {
          packageName: String(manifest["name"] ?? "fixture"),
          packageVersion: String(manifest["version"] ?? "1.0.0"),
          types: { kind: "included" },
        },
      });
      writeFileSync(
        path,
        `#!/bin/sh\n: > ${JSON.stringify(marker)}\ncat <<'ATTWJSON'\n${report}\nATTWJSON\n`,
      );
    }
    chmodSync(path, bin === "not-executable" ? 0o644 : 0o755);
  }
  return { dir, marker, installed };
}

/** Run the consuming package's own `scripts/attw.mjs`, the way its `attw` script does. */
function runGate(consumer: Consumer, args: string[] = OFFLINE): RunResult {
  return run(process.execPath, [join(consumer.dir, "scripts", "attw.mjs"), ...args], consumer.dir);
}

const WELL_FORMED = {
  manifest: {
    name: "attw-shared-fixture-wellformed",
    version: "1.0.0",
    main: "./index.js",
    types: "./index.d.ts",
    files: ["index.js", "index.d.ts"],
  },
  files: {
    "index.js": "module.exports.a = 1;\n",
    "index.d.ts": "export declare const a: number;\n",
  },
};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "attw-shared-"));
  const require = createRequire(join(TEST_UTILS, "package.json"));
  const manifestPath = require.resolve("@arethetypeswrong/cli/package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { bin: { attw: string } };
  attwEntry = join(dirname(manifestPath), manifest.bin.attw);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("the refusal the 297-line variant had and the 1500-line one did not", () => {
  it("refuses a manifest that declares no relative artifact path at all", () => {
    // AC-C2. The long body printed "declares no relative artifact paths, so net 3 had none to
    // check" and EXITED 0 here, which is a gate reporting a pass from a check it never made: nets
    // 1, 3 and 4 all grade that one set, so an empty set makes three of the four vacuous at once.
    const consumer = makeConsumer("declares-nothing", {
      name: "attw-shared-fixture-nothing",
      version: "1.0.0",
      private: true,
    });
    const r = runGate(consumer);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("checked nothing");
    // AND IT REFUSED BEFORE THE SPAWN, so it is not reporting from a run attw was allowed to
    // judge. The shim leaves a file behind when it runs; there is none.
    expect(existsSync(consumer.marker), "attw was spawned over a manifest that declared nothing").toBe(
      false,
    );
  });

  it("CONTROL: one declared path is enough, and the same fixture is then green", () => {
    // Without this the refusal above is satisfied by a gate that reds on everything.
    const consumer = makeConsumer("declares-one", WELL_FORMED.manifest, WELL_FORMED.files);
    const r = runGate(consumer);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("attw gate:");
    expect(existsSync(consumer.marker)).toBe(true);
  });

  it("reds on a declared artifact that is present but EMPTY", () => {
    // Carried by both bodies and pinned only in hl7's corpus, which is not in this repository.
    const consumer = makeConsumer(
      "empty-declaration",
      {
        name: "attw-shared-fixture-empty",
        version: "1.0.0",
        main: "./index.js",
        types: "./index.d.ts",
        files: ["index.js", "index.d.ts"],
      },
      { "index.js": "module.exports = {};\n", "index.d.ts": "" },
    );
    const r = runGate(consumer);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("./index.d.ts");
    expect(r.out).toContain("empty");
  });
});

describe("the modes neither corpus pinned", () => {
  it("reds on an attw document with no analysis.types, and says it is a shape change", () => {
    const consumer = makeConsumer("shape-change", WELL_FORMED.manifest, WELL_FORMED.files);
    // A document that parses and carries no verdict. Reported as attw's shape changing rather than
    // as an untyped package, because the two are different repairs.
    writeFileSync(
      join(consumer.dir, "node_modules", ".bin", "attw"),
      `#!/bin/sh\ncat <<'ATTWJSON'\n{"analysis":{"packageName":"x","packageVersion":"1.0.0"}}\nATTWJSON\n`,
    );
    chmodSync(join(consumer.dir, "node_modules", ".bin", "attw"), 0o755);
    const r = runGate(consumer);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("no analysis.types field");
    expect(r.out).toContain("shape change");
  });

  it("refuses the blinding spellings the 297-line variant enumerated", () => {
    // `-Pf json` is the one spelling hl7's table carried and config's does not: a short cluster
    // whose blinding letter is second and whose value rides separately. The allow-list refuses it
    // without needing to know that, which is the point of an allow-list.
    const consumer = makeConsumer("argv-spellings", WELL_FORMED.manifest, WELL_FORMED.files);
    for (const extra of [["-Pf", "json"], ["-qP"], ["--config-path", "other.json"]]) {
      const r = runGate(consumer, [...OFFLINE, ...extra]);
      expect(r.code, extra.join(" ")).not.toBe(0);
      expect(r.out).toContain("is not an argument this gate accepts");
      expect(existsSync(consumer.marker), `attw was spawned with ${extra.join(" ")}`).toBe(false);
    }
  });
});

describe("which dependency tree the binary came from, which only a SHARED body can get wrong", () => {
  it("reds, naming the path it looked for, when the consuming package has no attw binary", () => {
    const consumer = makeConsumer(
      "no-binary",
      WELL_FORMED.manifest,
      WELL_FORMED.files,
      "none",
    );
    const r = runGate(consumer);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain(join(consumer.dir, "node_modules", ".bin", "attw"));
    expect(r.out).toContain("not runnable");
  });

  it("reds, naming the path, when the binary is present but not executable", () => {
    const consumer = makeConsumer(
      "binary-not-executable",
      WELL_FORMED.manifest,
      WELL_FORMED.files,
      "not-executable",
    );
    const r = runGate(consumer);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain(join(consumer.dir, "node_modules", ".bin", "attw"));
  });

  it("never runs an attw belonging to a different package", () => {
    // THE FAILURE MODE CONSOLIDATION CREATES. The body now lives inside
    // `node_modules/@cosyte/script-utils`, so a gate that resolved its binary relative to ITSELF
    // would look inside `node_modules/@cosyte/` and, if something were there, would analyse a
    // dependency tree nobody asked about. A decoy is planted at exactly that path.
    const consumer = makeConsumer("foreign-binary", WELL_FORMED.manifest, WELL_FORMED.files, "none");
    const decoyMarker = join(consumer.dir, "decoy-ran");
    const decoyBin = join(consumer.dir, "node_modules", "@cosyte", "node_modules", ".bin");
    mkdirSync(decoyBin, { recursive: true });
    const decoy = join(decoyBin, "attw");
    writeFileSync(
      decoy,
      `#!/bin/sh\n: > ${JSON.stringify(decoyMarker)}\nprintf '%s' '{"analysis":{"packageName":"decoy","packageVersion":"1.0.0","types":{"kind":"included"}}}'\n`,
    );
    chmodSync(decoy, 0o755);

    const r = runGate(consumer);
    // It refused rather than falling back to the decoy, and it named the path it wanted.
    expect(r.code).not.toBe(0);
    expect(r.out).toContain(join(consumer.dir, "node_modules", ".bin", "attw"));
    expect(existsSync(decoyMarker), "the gate ran another package's attw").toBe(false);
  });

  it("refuses a call that passes no callerUrl, rather than defaulting to its own location", () => {
    const consumer = makeConsumer("no-caller-url", WELL_FORMED.manifest, WELL_FORMED.files);
    const probe = join(consumer.dir, "scripts", "no-caller-url.mjs");
    writeFileSync(
      probe,
      [
        'import { runAttwGate } from "@cosyte/script-utils/attw";',
        "process.exitCode = runAttwGate({});",
        "",
      ].join("\n"),
    );
    const r = run(process.execPath, [probe], consumer.dir);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("no callerUrl");
    expect(existsSync(consumer.marker), "a call with no callerUrl reached a binary").toBe(false);
  });
});

describe("one body, consumed rather than copied", () => {
  it("a refusal added to the canonical alone changes what an unedited consumer does", () => {
    // AC-C3, and the whole claim of the consolidation: a fix lands once and every consumer gets it
    // WITHOUT being edited. The consumer is built, measured green, and then only the INSTALLED
    // canonical is edited; the consumer's own files are hashed before and after so "unedited" is a
    // measurement rather than a description.
    const consumer = makeConsumer("unedited-consumer", WELL_FORMED.manifest, WELL_FORMED.files);
    const ownFiles = ["package.json", join("scripts", "attw.mjs")];
    const hash = (rel: string): string =>
      createHash("sha256").update(readFileSync(join(consumer.dir, rel))).digest("hex");
    const before = ownFiles.map(hash);

    const green = runGate(consumer);
    expect(green.code, green.out).toBe(0);

    // The new refusal, added to the shared body and to nothing else.
    const installedBody = join(consumer.installed, "attw.js");
    const src = readFileSync(installedBody, "utf8");
    const at = src.indexOf("const forwarded = forwardable(argv);");
    expect(at, "the canonical no longer has the line this mutation is anchored to").toBeGreaterThan(
      -1,
    );
    writeFileSync(
      installedBody,
      `${src.slice(0, at)}die("a refusal added to the canonical body alone.");\n  ${src.slice(at)}`,
    );

    const after = runGate(consumer);
    expect(after.code).not.toBe(0);
    expect(after.out).toContain("a refusal added to the canonical body alone");
    // ...and the consumer was not touched to get it.
    expect(ownFiles.map(hash), "the consumer's own files changed").toEqual(before);
  });

  it("the caller a consumer keeps is a caller, and carries no net of its own", () => {
    // What every consuming repo commits, pinned: it imports the shared body by the specifier a
    // consumer writes, hands it its OWN url, and contains none of the gate's logic.
    const caller = readFileSync(CALLER, "utf8");
    expect(caller).toContain('from "@cosyte/script-utils/attw"');
    expect(caller).toContain("runAttwGate({ callerUrl: import.meta.url })");
    expect(caller).not.toContain("declaredArtifacts");
    expect(caller).not.toContain("spawnSync");
    // Small enough to read in one sitting: the body is 1500 lines, and a caller that grew a net
    // would be the duplication coming back.
    expect(caller.split("\n").length).toBeLessThan(60);
  });
});

describe("the config route, which no argument guard can reach", () => {
  it("names .attw.json when a committed config empties the transcript", () => {
    // The 297-line variant refused `quiet` and `format` BY KEY NAME and its corpus asserts a
    // non-zero exit and an output naming `.attw.json`. The canonical has no key deny-list, because
    // enumerating keys bought exactly one more evasion per round. This is the route by which that
    // assertion still holds: the config empties the transcript, the parse fails closed, and the
    // message names the file. It runs the REAL CLI, because the config is only applied by attw.
    const consumer = makeConsumer(
      "attw-json-quiet",
      {
        name: "attw-shared-fixture-configquiet",
        version: "1.0.0",
        main: "./index.js",
        types: "./index.d.ts",
        files: ["index.js"],
      },
      {
        "index.js": "module.exports.a = 1;\n",
        "index.d.ts": "export declare const a: number;\n",
        ".attw.json": JSON.stringify({ quiet: true }),
      },
      "real",
    );
    const r = runGate(consumer);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain(".attw.json");
    expect(r.out).toContain("printed nothing to stdout");
  });
});
