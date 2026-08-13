import { existsSync } from "node:fs";

import { afterAll, describe, expect, it } from "vitest";

import { cleanupTempDirs, makeTempDir, PKG_ROOT } from "./helpers.js";
import { resolveToolBin, ToolResolutionError } from "../src/resolve.js";
import { TOOL_PACKAGES, type ToolName } from "../src/verbs.js";

/**
 * Term 5: every baseline tool resolves from THIS package's dependencies.
 *
 * The failure case is the interesting half. Under term 5 an unresolvable tool is a provider defect,
 * so the message has to say which tool and say that it is not the consumer's problem.
 */

afterAll(cleanupTempDirs);

const TOOLS = Object.keys(TOOL_PACKAGES) as ToolName[];

describe("resolving the baseline tools", () => {
  it.each(TOOLS)("resolves %s to a file inside this package's dependencies", (tool) => {
    const bin = resolveToolBin(tool);
    expect(existsSync(bin)).toBe(true);
    expect(bin).toContain(`node_modules/${TOOL_PACKAGES[tool]}/`);
  });

  it("resolves the same bin from a nested starting point", () => {
    expect(resolveToolBin("eslint", PKG_ROOT)).toBe(resolveToolBin("eslint"));
  });

  it("declares the five tools of term 5, mapping tsc to typescript", () => {
    expect(TOOL_PACKAGES).toEqual({
      tsup: "tsup",
      vitest: "vitest",
      eslint: "eslint",
      tsc: "typescript",
      prettier: "prettier",
    });
  });
});

describe("a tool that does not resolve", () => {
  it("throws naming the tool, the npm package, and whose defect it is", () => {
    const empty = makeTempDir("cosyte-process-no-tools-");
    let thrown: unknown;
    try {
      resolveToolBin("tsc", empty);
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ToolResolutionError);
    const error = thrown as ToolResolutionError;
    expect(error.tool).toBe("tsc");
    expect(error.message).toContain('cannot resolve the "tsc" tool');
    expect(error.message).toContain('npm package "typescript"');
    expect(error.message).toContain("not a missing dependency in this repo");
  });
});
