import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { readFloor } from "../src/floor.js";
import { USAGE, main, type MainIo } from "../src/main.js";
import { env, fixedRunner, importCost } from "./support/bodies.js";
import { scratchDir } from "./support/paths.js";
import { caseReading, readingDoc } from "./support/readings.js";

function harness() {
  const out: string[] = [];
  const err: string[] = [];
  const dir = scratchDir("bench-gate-");
  const io: MainIo = {
    stdout: (t) => out.push(t),
    stderr: (t) => err.push(t),
    cwd: dir,
    env: {},
    runJob: fixedRunner().runJob,
    measureImport: () => Promise.resolve(importCost),
    environment: () => env,
    now: () => new Date("2026-11-11T00:00:00Z"),
  };
  const write = (name: string, value: unknown) => {
    writeFileSync(join(dir, name), typeof value === "string" ? value : JSON.stringify(value));
    return name;
  };
  return { io, dir, write, out: () => out.join(""), err: () => err.join("") };
}

const aaSet = (h: ReturnType<typeof harness>) =>
  [0.5, 0.55, 0.52].map((ms, i) =>
    h.write(
      `aa-${String(i)}.json`,
      readingDoc([
        caseReading({
          throughput: {
            status: "measured",
            processes: [],
            medianMsPerOp: ms,
            opsPerSecond: 1000 / ms,
            bytesPerSecond: null,
          },
        }),
      ]),
    ),
  );

const budgets = (rules: unknown[], imp?: unknown) => ({
  schemaVersion: 1,
  kind: "budgets",
  rules,
  ...(imp === undefined ? {} : { import: imp }),
});

describe("cosyte-bench floor", () => {
  it("records a floor from an A/A set and writes it", async () => {
    const h = harness();
    expect(await main(["floor", ...aaSet(h), "--out", "floor.json"], h.io)).toBe(0);
    const floor = readFloor(readFileSync(join(h.dir, "floor.json"), "utf8"));
    expect(floor.cases[0]?.msPerOp).toEqual({ value: 0.55, noise: 0.05 });
    expect(h.out()).toBe(
      "floor.json: a floor of 1 case(s) from 3 readings on github-actions-github-hosted-ubuntu24-x64, Node 24\n",
    );
  });

  it("tightens an existing floor with --from", async () => {
    const h = harness();
    await main(["floor", ...aaSet(h), "--out", "floor.json"], h.io);
    const faster = [0.3, 0.32, 0.31].map((ms, i) =>
      h.write(
        `fast-${String(i)}.json`,
        readingDoc([
          caseReading({
            throughput: {
              status: "measured",
              processes: [],
              medianMsPerOp: ms,
              opsPerSecond: 1,
              bytesPerSecond: null,
            },
          }),
        ]),
      ),
    );
    expect(
      await main(["floor", ...faster, "--from", "floor.json", "--out", "next.json"], h.io),
    ).toBe(0);
    const next = readFloor(readFileSync(join(h.dir, "next.json"), "utf8"));
    expect(next.cases[0]?.msPerOp).toEqual({ value: 0.32, noise: 0.05 });
  });

  it("exits 2 on too few readings, a developer machine's reading, or a file it cannot read", async () => {
    const h = harness();
    const [a, b] = aaSet(h) as [string, string, string];
    expect(await main(["floor", a, b, "--out", "f.json"], h.io)).toBe(2);
    expect(h.err()).toContain("a floor is recorded from at least 3 readings");
    const local = h.write(
      "local.json",
      readingDoc([caseReading()], {
        runner: { ci: false, provider: null, environment: null, class: "local-linux-x64" },
      }),
    );
    expect(await main(["floor", a, b, local, "--out", "f.json"], h.io)).toBe(2);
    expect(h.err()).toContain("local.json: the reading was taken on local-linux-x64");
    expect(await main(["floor", a, b, "missing.json", "--out", "f.json"], h.io)).toBe(2);
    expect(h.err()).toContain("cannot read missing.json");
    h.write("bad.json", "{");
    expect(await main(["floor", a, b, "bad.json", "--out", "f.json"], h.io)).toBe(2);
    expect(h.err()).toContain("bad.json: @cosyte/bench: the results are not JSON");
    expect(await main(["floor", a, b, a, "--from", "bad.json", "--out", "f.json"], h.io)).toBe(2);
    expect(h.err()).toContain("bad.json: @cosyte/bench: the floor file is not JSON");
  });

  it("refuses a command line with no reading, no --out, or a flag of another command", async () => {
    for (const argv of [
      ["floor", "--out", "f.json"],
      ["floor", "a.json"],
      ["floor", "a.json", "--out", "f.json", "--budgets", "b.json"],
    ]) {
      const h = harness();
      if (argv[1] === "a.json") h.write("a.json", readingDoc());
      expect(await main(argv, h.io)).toBe(2);
      expect(h.err()).toContain(USAGE);
    }
  });
});

describe("cosyte-bench gate", () => {
  it("passes a reading within its budgets and its floor, and writes the summary", async () => {
    const h = harness();
    await main(["floor", ...aaSet(h), "--out", "floor.json"], h.io);
    const reading = h.write("reading.json", readingDoc());
    h.write("budgets.json", budgets([{ peakMultiple: { small: 20 } }], { maxColdImportMs: 15 }));
    const code = await main(
      [
        "gate",
        reading,
        "--budgets",
        "budgets.json",
        "--floor",
        "floor.json",
        "--base-floor",
        "floor.json",
        "--summary",
        "gate.md",
      ],
      h.io,
    );
    expect(code).toBe(0);
    const md = readFileSync(join(h.dir, "gate.md"), "utf8");
    expect(md).toBe(
      [
        "### Budgets (budgets.json)",
        "",
        "Every one of 2 limit(s) held.",
        "",
        "### Floor (floor.json)",
        "",
        "Every one of 5 limit(s) held.",
        "",
        "### The floor against the base branch's (floor.json)",
        "",
        "Every one of 1 limit(s) held.",
        "",
      ].join("\n"),
    );
    expect(h.out()).toContain(md);
  });

  it("exits 1 on a budget broken, a floor regression or a loosened floor", async () => {
    const h = harness();
    const reading = h.write("reading.json", readingDoc());
    h.write("tight.json", budgets([{ peakMultiple: { small: 1 } }]));
    expect(await main(["gate", reading, "--budgets", "tight.json"], h.io)).toBe(1);
    expect(h.out()).toContain("| breach | parse @ 1 KiB: peak 6.0 KiB is 6.00 times");

    await main(["floor", ...aaSet(h), "--out", "floor.json"], h.io);
    const slow = h.write(
      "slow.json",
      readingDoc([
        caseReading({
          throughput: {
            status: "measured",
            processes: [],
            medianMsPerOp: 0.9,
            opsPerSecond: 1,
            bytesPerSecond: null,
          },
        }),
      ]),
    );
    expect(await main(["gate", slow, "--floor", "floor.json"], h.io)).toBe(1);
    expect(h.out()).toContain("| regression | parse @ 1 KiB: ms an operation 0.9");

    const floor = readFloor(readFileSync(join(h.dir, "floor.json"), "utf8"));
    h.write("loose.json", { ...floor, import: null });
    expect(
      await main(["gate", reading, "--floor", "loose.json", "--base-floor", "floor.json"], h.io),
    ).toBe(1);
    expect(h.out()).toContain("| loosened | import: median cold import, ms has no floor any more");
  });

  it("exits 2 when a limit could not be judged", async () => {
    const h = harness();
    const reading = h.write("reading.json", readingDoc());
    h.write("budgets.json", budgets([{ benchmark: "gone" }]));
    expect(await main(["gate", reading, "--budgets", "budgets.json"], h.io)).toBe(2);
    expect(h.out()).toContain("**Could not judge.**");
  });

  it("exits 2 on a reading from a developer machine, or one it cannot read", async () => {
    const h = harness();
    h.write("budgets.json", budgets([]));
    const local = h.write(
      "local.json",
      readingDoc([], {
        runner: { ci: false, provider: null, environment: null, class: "local-x" },
      }),
    );
    expect(await main(["gate", local, "--budgets", "budgets.json"], h.io)).toBe(2);
    expect(h.err()).toContain(
      "local.json: the reading was taken on local-x, not a GitHub-hosted runner",
    );
    const reading = h.write("reading.json", readingDoc());
    h.write("bad.json", '{"schemaVersion": 1, "kind": "budgets"}');
    expect(await main(["gate", reading, "--budgets", "bad.json"], h.io)).toBe(2);
    expect(h.err()).toContain(
      'bad.json: @cosyte/bench: the budgets file does not match its schema:\n/: is missing "rules"',
    );
    expect(await main(["gate", reading, "--floor", "none.json"], h.io)).toBe(2);
    expect(h.err()).toContain("cannot read none.json");
    expect(
      await main(["gate", reading, "--floor", "bad.json", "--base-floor", "none.json"], h.io),
    ).toBe(2);
  });

  it("refuses a command line that names no limits, two readings, or a base floor alone", async () => {
    for (const [argv, message] of [
      [["gate"], "gate needs a reading"],
      [["gate", "r.json"], "gate needs --budgets, --floor or both"],
      [["gate", "r.json", "r.json", "--floor", "f.json"], "gate judges one reading"],
      [
        ["gate", "r.json", "--budgets", "b.json", "--base-floor", "f.json"],
        "--base-floor needs --floor",
      ],
      [["gate", "r.json", "--floor", "f.json", "--out", "x.json"], "--out does not apply to gate"],
    ] as const) {
      const h = harness();
      h.write("r.json", readingDoc());
      expect(await main(argv, h.io)).toBe(2);
      expect(h.err()).toContain(message);
    }
  });
});
