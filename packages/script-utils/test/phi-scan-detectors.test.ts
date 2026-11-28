/**
 * The engine takes a library's field detectors as plug-ins, reads every allow-list tag the format
 * libraries use, holds phones to the fictional block, and never prints a detector's own message.
 *
 * WHAT EACH CASE GRADES IS A LEAK THE ENGINE MUST STILL CATCH OR REFUSE, not only the happy path:
 * a plug-in that tries to hand back the value it matched, a detector whose thrown message carries
 * scanned text, a declaration that would make a real-looking phone synthetic, and an address
 * declared for one file that turns up in another.
 *
 * SECURITY / PHI: every payload here is synthetic and lives only in a throwaway temp directory.
 * `example.com` and `.invalid` are reserved names, the phones are invented, and `PLANTED` marks
 * a value a case plants so it can assert the value never reaches the output.
 * SECURITY: every subprocess call uses spawnSync with array args. No exec, no shell form.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { exemptsMarkdown, isFictionalPhone, runPhiScan } from "../phi-scan.js";

const CODES = { clean: 0, hits: 1, refuse: 2 } as const;

/** A value a case plants in a file, a finding or an error, so it can assert the value is not printed. */
const PLANTED = "PLANTEDVALUE^ZQX";

type Config = Parameters<typeof runPhiScan>[0];
type Detector = NonNullable<Config["detectors"]>[number];
type Allow = Parameters<Detector["detect"]>[0]["allow"];

let repo: string;

function git(args: string[], cwd = repo): { code: number; out: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function write(rel: string, content: string): void {
  const target = join(repo, ...rel.split("/"));
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, content, "utf8");
}

function allowList(...lines: string[]): void {
  write("scripts/phi-allow-list.txt", `EMAILDOMAIN example.com\n${lines.join("\n")}\n`);
}

function commitAll(): void {
  git(["add", "-A"]);
  expect(git(["commit", "-qm", "corpus", "--no-verify"]).code).toBe(0);
}

/** Run the engine in process, with both streams merged: a value must reach neither. */
function run(config: Partial<Config> = {}): { code: number; out: string } {
  let out = "";
  const sink = (chunk: unknown): boolean => {
    out += String(chunk);
    return true;
  };
  const err = vi.spyOn(process.stderr, "write").mockImplementation(sink);
  const std = vi.spyOn(process.stdout, "write").mockImplementation(sink);
  try {
    const code = runPhiScan({
      repoRoot: repo,
      argv: [],
      exitCodes: CODES,
      scanRoots: ["."],
      isStagedReadable: exemptsMarkdown,
      ...config,
    });
    return { code, out };
  } finally {
    err.mockRestore();
    std.mockRestore();
  }
}

/** A detector that reports nothing and keeps the allow-list it was handed. */
function capture(): { detector: Detector; allow: () => Allow } {
  let seen: Allow | undefined;
  return {
    detector: {
      name: "capture",
      places: ["PID-5"],
      detect: (input) => {
        seen = input.allow;
        return [];
      },
    },
    allow: () => {
      if (seen === undefined) throw new Error("the detector was never called");
      return seen;
    },
  };
}

/** A detector that returns `result` for the file at `test/fixtures/record.txt` and nothing else. */
function returning(result: unknown, places: string[] = ["PID-5"]): Detector {
  return {
    name: "demo-fields",
    places,
    detect: (input) =>
      (input.path === "test/fixtures/record.txt" ? result : []) as ReturnType<Detector["detect"]>,
  };
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "phi-scan-detectors-"));
  allowList();
  write(".gitignore", "node_modules/\n");
  git(["init", "-q", "."]);
  git(["config", "user.email", "probe@example.com"]);
  git(["config", "user.name", "probe"]);
  git(["config", "commit.gpgsign", "false"]);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("the allow-list reads every tag the format libraries use", () => {
  it("reads ADDR and ADDRESS as one address declaration, lowercased", () => {
    allowList("ADDR 123 Main St", "ADDRESS 456 OAK AVE");
    write("test/fixtures/record.txt", "nothing\n");
    commitAll();
    const c = capture();
    expect(run({ detectors: [c.detector] }).code).toBe(0);
    expect([...c.allow().addresses].sort()).toEqual(["123 main st", "456 oak ave"]);
  });

  it("reads CITY uppercased and ZIP as written", () => {
    allowList("CITY Springfield", "ZIP 00000-0000");
    write("test/fixtures/record.txt", "nothing\n");
    commitAll();
    const c = capture();
    expect(run({ detectors: [c.detector] }).code).toBe(0);
    expect([...c.allow().cities]).toEqual(["SPRINGFIELD"]);
    expect([...c.allow().zips]).toEqual(["00000-0000"]);
  });

  it("reads a PHONE inside the fictional block as its digits", () => {
    allowList("PHONE (202) 555-0142");
    write("test/fixtures/record.txt", "nothing\n");
    commitAll();
    const c = capture();
    expect(run({ detectors: [c.detector] }).code).toBe(0);
    expect([...c.allow().phones]).toEqual(["2025550142"]);
  });

  it("REFUSES a PHONE outside the fictional block, naming the line and never the number", () => {
    allowList("NAME SYNTHETIC", "PHONE 202-555-1234");
    write("test/fixtures/record.txt", "nothing\n");
    commitAll();
    const r = run();
    expect(r.code, r.out).toBe(2);
    expect(r.out).toContain(
      "[phi-scan] scripts/phi-allow-list.txt line 3: a PHONE declaration must be a number in the " +
        "fictional block 555-0100 to 555-0199, and this one is not. A synthetic fixture uses a " +
        "number from that block; no declaration makes another number synthetic.\n",
    );
    expect(r.out).not.toContain("1234");
    expect(r.out).not.toContain("OK: no hits");
  });

  it("clears an EMAIL address everywhere, and only that address", () => {
    allowList("EMAIL Desk@Clinic.invalid");
    write("test/fixtures/a.txt", "write to desk@clinic.invalid\n");
    commitAll();
    expect(run().code).toBe(0);
    // ANTI-VACUITY: another mailbox at the same domain is still a hit.
    write("test/fixtures/b.txt", "or to other@clinic.invalid\n");
    commitAll();
    const r = run();
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain(
      "[phi-scan] HIT: test/fixtures/b.txt\n  segment=(email) (email with non-test domain)\n",
    );
    expect(r.out).not.toContain("HIT: test/fixtures/a.txt");
    expect(r.out).not.toContain("other@clinic.invalid");
  });

  it("clears an EMAIL scoped to a path in that file only", () => {
    // The allow-list is itself scanned, so the address it names is declared for it too.
    allowList(
      "EMAIL ./test/fixtures/a.txt \t Desk@Clinic.invalid",
      "EMAIL scripts/phi-allow-list.txt desk@clinic.invalid",
    );
    write("test/fixtures/a.txt", "write to desk@clinic.invalid\n");
    write("test/fixtures/b.txt", "write to desk@clinic.invalid\n");
    commitAll();
    const r = run();
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("HIT: test/fixtures/b.txt");
    expect(r.out).not.toContain("HIT: test/fixtures/a.txt");
    expect(r.out).not.toContain("desk@clinic.invalid");
  });

  it("clears a scoped EMAIL in an escape-encoded source literal of that file", () => {
    allowList(
      "EMAIL src/a.ts desk@clinic.invalid",
      "EMAIL scripts/phi-allow-list.txt desk@clinic.invalid",
    );
    write("src/a.ts", 'export const to = "desk\\u0040clinic.invalid";\n');
    commitAll();
    expect(run().code).toBe(0);
    allowList();
    const r = run();
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("escape-encoded in a source literal");
  });

  it.each([
    ["an address with no @", "EMAIL desk.clinic.invalid"],
    ["a path with an address that has no @", "EMAIL test/a.txt desk.clinic.invalid"],
    ["three words", "EMAIL test/a.txt other desk@clinic.invalid"],
  ])("REFUSES a malformed EMAIL line (%s), naming the line", (_label, line) => {
    allowList(line);
    write("test/fixtures/record.txt", "nothing\n");
    commitAll();
    const r = run();
    expect(r.code, r.out).toBe(2);
    expect(r.out).toContain(
      '[phi-scan] scripts/phi-allow-list.txt line 2: an EMAIL declaration is "EMAIL <address>" ' +
        'or "EMAIL <path> <address>", and this one is neither.\n',
    );
    expect(r.out).not.toContain("clinic.invalid");
  });

  it("reads the DICOM forms: a bare person name, a bare prefix ending in ^, and DATE:", () => {
    allowList(
      "SYNTHETIC^",
      "ANON^^",
      "TEST^PATIENT",
      "Van Der^Probe",
      "DATE:19000101",
      "DATE: 20240115 ",
      "DATE:",
      "# DOE^JANE in a comment is no declaration",
      "",
      "NOTAG",
      "NAME",
      "PHONE",
      "EMAIL",
    );
    write("test/fixtures/record.txt", "nothing\n");
    commitAll();
    const c = capture();
    expect(run({ detectors: [c.detector] }).code).toBe(0);
    const allow = c.allow();
    expect([...allow.personNames].sort()).toEqual(["TEST^PATIENT", "Van Der^Probe"]);
    expect([...allow.personNamePrefixes].sort()).toEqual(["ANON^^", "SYNTHETIC^"]);
    expect([...allow.dates].sort()).toEqual(["19000101", "20240115"]);
    // A tagged line is never read as a DICOM name, and a tag with no value declares nothing.
    expect(allow.names.size).toBe(0);
    expect(allow.phones.size + allow.emails.size + allow.fileEmails.size).toBe(0);
  });

  it("keeps reading the four older tags as it always did", () => {
    allowList("NAME probe", "DOB 19000101", "ID ab-12", "EMAILDOMAIN Clinic.Invalid");
    write("test/fixtures/record.txt", "nothing\n");
    commitAll();
    const c = capture();
    expect(run({ detectors: [c.detector] }).code).toBe(0);
    const allow = c.allow();
    expect([...allow.names]).toEqual(["PROBE"]);
    expect([...allow.dobs]).toEqual(["19000101"]);
    expect([...allow.ids]).toEqual(["AB-12"]);
    expect([...allow.emailDomains].sort()).toEqual(["clinic.invalid", "example.com"]);
    expect(allow.personNames.size + allow.personNamePrefixes.size).toBe(0);
  });
});

describe("the email floor still clears a declared domain", () => {
  it("reports clean over an address at an EMAILDOMAIN, with no EMAIL line", () => {
    write("test/fixtures/a.txt", "write to desk@example.com\n");
    commitAll();
    const r = run();
    expect(r.code, r.out).toBe(0);
  });
});

describe("phones are held to the fictional block 555-0100 to 555-0199", () => {
  it("admits the block at both edges, with any area code and a leading 1", () => {
    for (const value of [
      "555-0100",
      "555-0199",
      "(202) 555-0150",
      "1-202-555-0150",
      "+1 202 555 0150",
    ]) {
      expect(isFictionalPhone(value), value).toBe(true);
    }
  });

  it("refuses a number just outside the block, a short one, and a long one", () => {
    for (const value of [
      "555-0099",
      "555-0200",
      "202-555-1234",
      "2-202-555-0150",
      "44-202-555-0150",
      "1-555-0150",
      "1-1202-555-0150",
      "55-0150",
      "",
    ]) {
      expect(isFictionalPhone(value), value).toBe(false);
    }
  });
});

describe("a library's field detectors plug in, and report only a place and a rule", () => {
  it("reports a finding as the declared place, the engine's text for the rule, and the detector", () => {
    write("test/fixtures/record.txt", `PID|1||${PLANTED}\n`);
    commitAll();
    const seen: string[] = [];
    const detector: Detector = {
      name: "demo-fields",
      places: ["PID-5", "(0010,0010)"],
      detect: (input) => {
        seen.push(input.path);
        if (!input.text.includes(PLANTED)) return [];
        expect(input.bytes.toString("utf8")).toBe(input.text);
        return [
          { place: "PID-5", rule: "name", line: 1 },
          { place: "(0010,0010)", rule: "birth-date", offset: 0 },
        ];
      },
    };
    const r = run({ detectors: [detector] });
    expect(r.code, r.out).toBe(1);
    expect(seen).toContain("test/fixtures/record.txt");
    expect(r.out).toContain("HIT: test/fixtures/record.txt");
    expect(r.out).toContain(
      "segment=PID-5 line 1 (person name not declared synthetic in the allow-list, detector demo-fields)",
    );
    expect(r.out).toContain(
      "segment=(0010,0010) offset 0 (date of birth not declared synthetic in the allow-list, detector demo-fields)",
    );
    expect(r.out).not.toContain(PLANTED);
  });

  it.each([
    ["name", "person name not declared synthetic in the allow-list"],
    ["birth-date", "date of birth not declared synthetic in the allow-list"],
    ["date", "date not declared synthetic in the allow-list"],
    ["identifier", "identifier not declared synthetic in the allow-list"],
    ["ssn", "Social Security number not declared synthetic in the allow-list"],
    ["address", "address not declared synthetic in the allow-list"],
    ["phone", "phone number outside the fictional block 555-0100 to 555-0199"],
    ["email", "email address not declared synthetic in the allow-list"],
    ["provider-id", "provider identifier that could be a real registration"],
    ["phi-field", "PHI-bearing field value not declared synthetic in the allow-list"],
  ])("prints the engine's own words for the rule %s", (rule, text) => {
    write("test/fixtures/record.txt", "nothing\n");
    commitAll();
    const r = run({ detectors: [returning([{ place: "PID-5", rule }])] });
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain(`segment=PID-5 (${text}, detector demo-fields)`);
  });

  it("runs every detector, after the caller's detect, and reports each under its own name", () => {
    write("test/fixtures/record.txt", "nothing\n");
    commitAll();
    const order: string[] = [];
    const r = run({
      detect: () => {
        order.push("detect");
      },
      detectors: [
        {
          name: "first",
          places: ["A"],
          detect: () => {
            order.push("first");
            return [{ place: "A", rule: "name" }];
          },
        },
        {
          name: "second",
          places: ["B"],
          detect: () => {
            order.push("second");
            return [];
          },
        },
      ],
    });
    expect(r.code, r.out).toBe(1);
    expect(order.slice(0, 3)).toEqual(["detect", "first", "second"]);
    expect(r.out).toContain("detector first");
    expect(r.out).not.toContain("detector second");
  });

  it("hands a detector the bare path, while the report carries the index label", () => {
    write("test/fixtures/record.txt", "the tracked bytes\n");
    commitAll();
    writeFileSync(join(repo, "test", "fixtures", "record.txt"), "the disk bytes\n", "utf8");
    const seen: string[] = [];
    const r = run({
      detectors: [
        {
          name: "demo-fields",
          places: ["PID-5"],
          detect: (input) => {
            seen.push(input.path);
            return input.text.includes("tracked") ? [{ place: "PID-5", rule: "name" }] : [];
          },
        },
      ],
    });
    expect(r.code, r.out).toBe(1);
    expect(seen.filter((p) => p === "test/fixtures/record.txt")).toHaveLength(2);
    expect(r.out).toContain("HIT: test/fixtures/record.txt (git index; the working tree differs)");
  });

  it("runs over the decoded view of a source literal, adding only what the raw view did not raise", () => {
    write("src/fixture.ts", 'export const msg = "MSH|A\\rPID|1";\n');
    commitAll();
    const r = run({
      detectors: [
        {
          name: "demo-fields",
          places: ["MSH-1", "PID-5"],
          detect: (input) =>
            input.path !== "src/fixture.ts" || input.bytes.toString("utf8") !== input.text
              ? []
              : input.text.includes("\r")
                ? [
                    { place: "MSH-1", rule: "name" },
                    { place: "PID-5", rule: "name" },
                  ]
                : [{ place: "MSH-1", rule: "name" }],
        },
      ],
    });
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("segment=MSH-1 (person name not declared synthetic");
    expect(r.out).not.toContain(
      "segment=MSH-1 (person name not declared synthetic in the allow-list, detector demo-fields, escape",
    );
    expect(r.out).toContain(
      "segment=PID-5 (person name not declared synthetic in the allow-list, detector demo-fields, escape-encoded in a source literal)",
    );
    expect(r.out.match(/segment=MSH-1/g)).toHaveLength(1);
  });

  it("reports clean when every detector returns no findings", () => {
    write("test/fixtures/record.txt", "nothing\n");
    commitAll();
    const r = run({ detectors: [returning([])] });
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("OK: no hits");
  });
});

describe("a finding that could carry the matched text is refused, and the text is never printed", () => {
  it.each([
    [
      "carries the value in an extra key",
      [{ place: "PID-5", rule: "name", value: PLANTED }],
      "a finding has a key the engine does not take",
    ],
    [
      "carries the value as its rule",
      [{ place: "PID-5", rule: PLANTED }],
      "a finding names a rule outside the engine's set",
    ],
    [
      "carries a rule that is an array",
      [{ place: "PID-5", rule: ["name"] }],
      "a finding names a rule outside the engine's set",
    ],
    [
      "carries a rule that is not a string",
      [{ place: "PID-5", rule: 7 }],
      "a finding names a rule outside the engine's set",
    ],
    [
      "carries the value as its place",
      [{ place: PLANTED, rule: "name" }],
      "a finding names a place the detector did not declare",
    ],
    [
      "carries a place that is not a string",
      [{ place: 7, rule: "name" }],
      "a finding names a place the detector did not declare",
    ],
    [
      "names a rule from the prototype",
      [{ place: "PID-5", rule: "toString" }],
      "a finding names a rule outside the engine's set",
    ],
    [
      "carries a value under a key named by the value",
      [{ place: "PID-5", rule: "name", [PLANTED]: 1 }],
      "a finding has a key the engine does not take",
    ],
    ["is a string", [PLANTED], "a finding is not a plain object"],
    ["is null", [null], "a finding is not a plain object"],
    ["is an array", [["PID-5", "name"]], "a finding is not a plain object"],
    [
      "has a fractional line",
      [{ place: "PID-5", rule: "name", line: 1.5 }],
      "a finding's line is not a positive integer",
    ],
    [
      "has a zero line",
      [{ place: "PID-5", rule: "name", line: 0 }],
      "a finding's line is not a positive integer",
    ],
    [
      "has a line that is text",
      [{ place: "PID-5", rule: "name", line: PLANTED }],
      "a finding's line is not a positive integer",
    ],
    [
      "has a negative offset",
      [{ place: "PID-5", rule: "name", offset: -1 }],
      "a finding's offset is not a non-negative integer",
    ],
    [
      "has an offset that is text",
      [{ place: "PID-5", rule: "name", offset: PLANTED }],
      "a finding's offset is not a non-negative integer",
    ],
    [
      "is the second of two, after a good one",
      [
        { place: "PID-5", rule: "name" },
        { place: PLANTED, rule: "name" },
      ],
      "a finding names a place the detector did not declare",
    ],
    ["is not an array at all", PLANTED, "it did not return an array"],
    ["is undefined", undefined, "it did not return an array"],
    ["is a promise", Promise.resolve([]), "it did not return an array"],
  ])("REFUSES a result that %s", (_label, result, reason) => {
    write("test/fixtures/record.txt", `PID|1||${PLANTED}\n`);
    allowList(`NAME ${PLANTED}`);
    commitAll();
    const r = run({ detectors: [returning(result)] });
    expect(r.code, r.out).toBe(2);
    expect(r.out).toContain(
      `[phi-scan] the field detector "demo-fields" returned a malformed result on ` +
        `test/fixtures/record.txt: ${String(reason)}. A detector returns an array of findings, ` +
        `each { place, rule, line?, offset? } with a place it declared and a rule from the ` +
        `engine's set, and nothing else, so a finding cannot carry text from the file.\n`,
    );
    expect(r.out).not.toContain(PLANTED);
    expect(r.out).not.toContain("OK: no hits");
  });

  it("REFUSES a finding whose getter throws, rather than taking node's own exit code", () => {
    write("test/fixtures/record.txt", "nothing\n");
    commitAll();
    const finding = {
      place: "PID-5",
      get rule(): string {
        throw new Error(PLANTED);
      },
    };
    const r = run({ detectors: [returning([finding])] });
    expect(r.code, r.out).toBe(2);
    expect(r.out).toContain(
      'the field detector "demo-fields" returned a malformed result on test/fixtures/record.txt: ' +
        "reading its findings threw.",
    );
    expect(r.out).not.toContain(PLANTED);
  });

  it("prints the hits it already found before refusing a malformed finding", () => {
    write("test/fixtures/a.txt", "ssn 123-45-6789\n");
    write("test/fixtures/record.txt", "nothing\n");
    commitAll();
    const r = run({ detectors: [returning([{ place: PLANTED, rule: "name" }])] });
    expect(r.code, r.out).toBe(2);
    expect(r.out.indexOf("segment=(ssn)")).toBeGreaterThanOrEqual(0);
    expect(r.out.indexOf("segment=(ssn)")).toBeLessThan(r.out.indexOf("returned"));
  });
});

describe("a detector's thrown message is never printed", () => {
  it("names the plug-in and the file, and drops a message that carries a planted value", () => {
    write("test/fixtures/record.txt", `PID|1||${PLANTED}\n`);
    allowList(`NAME ${PLANTED}`);
    commitAll();
    const r = run({
      detectors: [
        {
          name: "demo-fields",
          places: ["PID-5"],
          detect: (input) => {
            if (input.path === "test/fixtures/record.txt") {
              throw new Error(`cannot parse ${input.text}`);
            }
            return [];
          },
        },
      ],
    });
    expect(r.code, r.out).toBe(2);
    expect(r.out).toContain(
      'the field detector threw on test/fixtures/record.txt (detector "demo-fields")',
    );
    expect(r.out).toContain(
      '[phi-scan] the field detector threw on test/fixtures/record.txt (detector "demo-fields"), ' +
        "so the scan has no verdict about that file. The detector's own message is not printed, " +
        "because it may hold text from the file it was reading: run that detector on that file " +
        "outside the gate to see why.\n",
    );
    expect(r.out).not.toContain(PLANTED);
    expect(r.out).not.toContain("cannot parse");
  });

  it("does the same for the caller's detect, and for a thrown value that is not an Error", () => {
    write("test/fixtures/record.txt", `PID|1||${PLANTED}\n`);
    allowList(`NAME ${PLANTED}`);
    commitAll();
    for (const thrown of [new Error(PLANTED), PLANTED]) {
      const r = run({
        detect: (ctx) => {
          if (ctx.path === "test/fixtures/record.txt") throw thrown;
        },
      });
      expect(r.code, r.out).toBe(2);
      expect(r.out).toContain(
        'the field detector threw on test/fixtures/record.txt (detector "detect")',
      );
      expect(r.out).not.toContain(PLANTED);
    }
  });

  it("names the decoded view when the throw came from it", () => {
    write("src/fixture.ts", 'export const msg = "A\\rB";\n');
    commitAll();
    const r = run({
      detectors: [
        {
          name: "demo-fields",
          places: ["PID-5"],
          detect: (input) => {
            if (input.text.includes("\r")) throw new Error(PLANTED);
            return [];
          },
        },
      ],
    });
    expect(r.code, r.out).toBe(2);
    expect(r.out).toContain(
      'the field detector threw on src/fixture.ts (its escape-decoded source literals) (detector "demo-fields")',
    );
    expect(r.out).not.toContain(PLANTED);
  });
});

describe("the detectors setting is checked before any scan begins", () => {
  const ok = (): Detector => ({ name: "demo-fields", places: ["PID-5"], detect: () => [] });
  const bad = (detectors: unknown): (() => number) => {
    return () =>
      runPhiScan({
        repoRoot: repo,
        argv: [],
        exitCodes: CODES,
        scanRoots: ["."],
        isStagedReadable: exemptsMarkdown,
        detectors: detectors as Config["detectors"],
      });
  };

  it.each([
    ["is not an array", { 0: "x" }, /`detectors` must be an array/],
    [
      "holds something that is not an object",
      [null],
      "runPhiScan: each detector must be an object { name, places, detect }.",
    ],
    [
      "holds a string",
      ["demo-fields"],
      "runPhiScan: each detector must be an object { name, places, detect }.",
    ],
    [
      "has a name that is an array",
      [{ ...ok(), name: ["demo"] }],
      "runPhiScan: a detector's `name` must be a lowercase word of letters, digits and hyphens, at most 64 characters, starting with a letter. It is printed in the report.",
    ],
    [
      "has a name that is not a lowercase word",
      [{ ...ok(), name: "Demo Fields" }],
      "runPhiScan: a detector's `name` must be a lowercase word of letters, digits and hyphens, at most 64 characters, starting with a letter. It is printed in the report.",
    ],
    [
      "has an empty name",
      [{ ...ok(), name: "" }],
      "runPhiScan: a detector's `name` must be a lowercase word of letters, digits and hyphens, at most 64 characters, starting with a letter. It is printed in the report.",
    ],
    [
      "has a name that is too long",
      [{ ...ok(), name: `a${"b".repeat(64)}` }],
      "runPhiScan: a detector's `name` must be a lowercase word of letters, digits and hyphens, at most 64 characters, starting with a letter. It is printed in the report.",
    ],
    ["has two detectors of one name", [ok(), ok()], /more than once/],
    ["has no detect function", [{ ...ok(), detect: "x" }], /`detect` function/],
    [
      "declares no places",
      [{ ...ok(), places: [] }],
      'runPhiScan: the detector "demo-fields" must declare its `places`, a non-empty array of the locators its findings may name.',
    ],
    [
      "declares places that are not an array",
      [{ ...ok(), places: "PID-5" }],
      'runPhiScan: the detector "demo-fields" must declare its `places`, a non-empty array of the locators its findings may name.',
    ],
    [
      "declares a place with a space",
      [{ ...ok(), places: ["PID 5"] }],
      'runPhiScan: the detector "demo-fields" declares a place that is not 1 to 80 printable characters with no space.',
    ],
    [
      "declares an empty place",
      [{ ...ok(), places: [""] }],
      'runPhiScan: the detector "demo-fields" declares a place that is not 1 to 80 printable characters with no space.',
    ],
    [
      "declares a place that is too long",
      [{ ...ok(), places: ["P".repeat(81)] }],
      'runPhiScan: the detector "demo-fields" declares a place that is not 1 to 80 printable characters with no space.',
    ],
    [
      "declares a place that is not a string",
      [{ ...ok(), places: [5] }],
      'runPhiScan: the detector "demo-fields" declares a place that is not 1 to 80 printable characters with no space.',
    ],
  ])("throws when it %s", (_label, detectors, message) => {
    expect(bad(detectors)).toThrow(TypeError);
    expect(bad(detectors)).toThrow(message);
  });

  it("takes a name and a place at the edges of what is allowed", () => {
    write("test/fixtures/record.txt", "nothing\n");
    commitAll();
    const name = `a${"b".repeat(63)}`;
    const place = `/${"p".repeat(79)}`;
    const r = run({
      detectors: [{ name, places: [place], detect: () => [{ place, rule: "name" }] }],
    });
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain(`segment=${place} (`);
    expect(r.out).toContain(`detector ${name})`);
  });
});

describe("a promise a plug-in returns cannot reach the output when it rejects", () => {
  it("refuses at 2 as a run of its own process, and the rejection's text appears nowhere", () => {
    // IN A SUBPROCESS, because the leak is Node's own: an unhandled rejection is printed by the
    // process and turns the exit code into 1 after the engine has already returned 2.
    write("test/fixtures/record.txt", "nothing\n");
    commitAll();
    const engine = join(import.meta.dirname, "..", "phi-scan.js");
    const script = join(repo, "..", `${repo.split(/[\\/]/).at(-1) ?? "x"}-run.mjs`);
    writeFileSync(
      script,
      `import { runPhiScan, exemptsMarkdown } from ${JSON.stringify(engine)};\n` +
        `process.exitCode = runPhiScan({\n` +
        `  repoRoot: ${JSON.stringify(repo)}, argv: [],\n` +
        `  exitCodes: { clean: 0, hits: 1, refuse: 2 }, scanRoots: ["."],\n` +
        `  isStagedReadable: exemptsMarkdown,\n` +
        `  detectors: [{ name: "demo-fields", places: ["PID-5"],\n` +
        `    detect: () => Promise.reject(new Error("cannot parse ${PLANTED}")) }],\n` +
        `});\n`,
      "utf8",
    );
    try {
      const r = spawnSync(process.execPath, [script], { encoding: "utf8" });
      const out = `${r.stdout}${r.stderr}`;
      expect(r.status, out).toBe(2);
      expect(out).toContain("it did not return an array");
      expect(out).not.toContain(PLANTED);
      expect(out).not.toContain("cannot parse");
    } finally {
      rmSync(script, { force: true });
    }
  });

  it("hands any result with a callable then a handler that swallows a rejection", () => {
    write("test/fixtures/record.txt", "nothing\n");
    commitAll();
    const calls: [unknown, unknown][] = [];
    const record = (onFulfilled: unknown, onRejected: unknown): void => {
      calls.push([onFulfilled, onRejected]);
    };
    const asObject = { then: record };
    const asFunction = Object.assign(() => undefined, { then: record });
    for (const result of [asObject, asFunction]) {
      calls.length = 0;
      const r = run({ detectors: [returning(result)] });
      expect(r.code, r.out).toBe(2);
      expect(calls).toHaveLength(1);
      const [onFulfilled, onRejected] = calls[0] ?? [];
      expect(onFulfilled).toBeUndefined();
      expect(typeof onRejected).toBe("function");
      expect((onRejected as (e: unknown) => unknown)(new Error(PLANTED))).toBeUndefined();
    }
  });

  it("refuses a thenable whose then throws, without taking node's own exit code", () => {
    write("test/fixtures/record.txt", "nothing\n");
    commitAll();
    const thenable = {
      then(): never {
        throw new Error(PLANTED);
      },
    };
    const r = run({ detectors: [returning(thenable)] });
    expect(r.code, r.out).toBe(2);
    expect(r.out).toContain("it did not return an array");
    expect(r.out).not.toContain(PLANTED);
  });
});

describe("an EMAIL declaration clears only the address it names", () => {
  it.each([["%"], ["+"], ["-"], ["."], ["_"]])(
    "still reports the address with %s before it",
    (lead) => {
      allowList("EMAIL desk@clinic.invalid");
      write("test/fixtures/a.txt", `write to ${lead}desk@clinic.invalid\n`);
      commitAll();
      const r = run();
      expect(r.code, r.out).toBe(1);
      expect(r.out).toContain("HIT: test/fixtures/a.txt");
      expect(r.out).not.toContain("desk@clinic.invalid");
    },
  );
});

describe("a plug-in cannot change what the engine allows", () => {
  it("leaves the floor and later detectors with the list as written, whatever a plug-in does to its copy", () => {
    allowList(
      "ID 123-45-6789",
      "EMAILDOMAIN clinic.invalid",
      "NAME PROBE",
      "EMAIL test/fixtures/b.txt desk@other.invalid",
      "EMAIL scripts/phi-allow-list.txt desk@other.invalid",
    );
    write("test/fixtures/a.txt", "nothing\n");
    write("test/fixtures/b.txt", "ssn 123-45-6789 mail desk@clinic.invalid desk@other.invalid\n");
    commitAll();
    const seen: number[] = [];
    const r = run({
      detectors: [
        {
          name: "vandal",
          places: ["PID-5"],
          detect: (input) => {
            const allow = input.allow as unknown as Record<string, unknown>;
            try {
              input.allow.ids.add("123-45-6789");
              input.allow.ids.clear();
              input.allow.emailDomains.clear();
              for (const inFile of input.allow.fileEmails.values()) inFile.clear();
              input.allow.fileEmails.clear();
            } catch {
              // A frozen view may refuse the write outright, which is as good as ignoring it.
            }
            try {
              allow.names = new Set();
            } catch {
              // Likewise for replacing a field.
            }
            return [];
          },
        },
        {
          name: "reader",
          places: ["PID-5"],
          detect: (input) => {
            seen.push(input.allow.names.size);
            seen.push(input.allow.fileEmails.get("test/fixtures/b.txt")?.size ?? 0);
            return [];
          },
        },
      ],
    });
    expect(r.code, r.out).toBe(0);
    expect(seen.every((n) => n === 1)).toBe(true);
    expect(seen.length).toBeGreaterThan(1);
  });
});

describe("a detector written as a method keeps its object", () => {
  it("calls detect with the detector as this", () => {
    write("test/fixtures/record.txt", "nothing\n");
    commitAll();
    class Fields {
      readonly name = "demo-fields";
      readonly places = ["PID-5"];
      readonly rule = "name" as const;
      detect(input: { path: string }): { place: string; rule: "name" }[] {
        return input.path === "test/fixtures/record.txt"
          ? [{ place: "PID-5", rule: this.rule }]
          : [];
      }
    }
    const r = run({ detectors: [new Fields()] });
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("detector demo-fields");
  });
});
