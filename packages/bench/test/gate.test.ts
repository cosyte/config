import { describe, expect, it } from "vitest";

import {
  bytesPerInput,
  caseName,
  gateExitCode,
  notJudgeable,
  renderFindings,
  sizeClass,
} from "../src/gate.js";
import { documentBase } from "../src/results.js";
import { env } from "./support/bodies.js";
import { readingDoc } from "./support/readings.js";

describe("gateExitCode", () => {
  it("is 0 clean, 1 on any finding but unjudged, 2 when something could not be judged", () => {
    expect(gateExitCode([])).toBe(0);
    expect(gateExitCode([{ kind: "unjudged", message: "a" }])).toBe(2);
    for (const kind of ["breach", "regression", "loosened"] as const) {
      expect(
        gateExitCode([
          { kind: "unjudged", message: "a" },
          { kind, message: "b" },
        ]),
      ).toBe(1);
    }
  });
});

describe("notJudgeable", () => {
  it("judges a reading from a GitHub-hosted runner", () => {
    expect(notJudgeable(readingDoc())).toBeNull();
  });

  it("refuses a reading from a developer machine or a self-hosted runner, and another kind", () => {
    expect(
      notJudgeable(
        readingDoc([], {
          runner: { ci: false, provider: null, environment: null, class: "local-darwin-arm64" },
        }),
      ),
    ).toBe(
      "the reading was taken on local-darwin-arm64, not a GitHub-hosted runner; budgets and floors read only those",
    );
    expect(notJudgeable(readingDoc([], { runner: { environment: "self-hosted" } }))).toContain(
      "not a GitHub-hosted runner",
    );
    expect(
      notJudgeable({
        ...documentBase({ name: "s", file: "s.mjs" }, env),
        kind: "comparison",
        base: { target: "a", commit: null },
        head: { target: "b", commit: null },
        comparison: { rounds: 12, threshold: 0.03, alpha: 0.05, inject: 0, cases: [] },
      }),
    ).toBe("a comparison is not a reading");
  });
});

describe("size classes", () => {
  it("are small under 64 KiB, medium under 1 MiB, large at 1 MiB and over", () => {
    expect(sizeClass(65_535)).toBe("small");
    expect(sizeClass(65_536)).toBe("medium");
    expect(sizeClass(1_048_575)).toBe("medium");
    expect(sizeClass(1_048_576)).toBe("large");
  });

  it("read a case's bytes an input, or none", () => {
    expect(bytesPerInput({ bytesPerPass: 4096, inputsPerPass: 4 })).toBe(1024);
    expect(bytesPerInput({ bytesPerPass: null, inputsPerPass: 4 })).toBeNull();
    expect(caseName({ benchmark: "parse", size: "1 KiB" })).toBe("parse @ 1 KiB");
  });
});

describe("renderFindings", () => {
  it("says every limit held when nothing was found", () => {
    expect(renderFindings("Budgets", [], 3)).toBe("### Budgets\n\nEvery one of 3 limit(s) held.\n");
  });

  it("tables the findings, failed or unjudged, with a pipe escaped", () => {
    expect(renderFindings("Floor", [{ kind: "breach", message: "a | b" }], 1)).toBe(
      "### Floor\n\n**Failed.** At least one limit was not held.\n\n| Finding | What |\n| --- | --- |\n| breach | a \\| b |\n",
    );
    expect(renderFindings("Floor", [{ kind: "unjudged", message: "gone" }], 1)).toContain(
      "**Could not judge.**",
    );
  });
});
