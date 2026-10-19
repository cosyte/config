import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseWorkflow } from "../scripts/credential-surface.mjs";

// WHICH JOB RUNS ON WHICH PUSH, EVALUATED FROM THE CONDITIONS release.yml SHIPS.
//
// The `release` environment asks a human for an approval every time a job that names it starts. Until
// 2026-10-19 the `publish` job started on every push to `main` without pending changesets, so an
// approval was requested on every ordinary push and the runs piled up waiting. The fix is a job
// condition, and a job condition cannot be run locally (`act` is not available here), so this suite
// does the next best thing: it reads the `if:` expressions out of the committed workflow, with the
// same YAML reader the credential-surface gate uses, and evaluates them on every path a push can
// take.
//
// THE EVALUATOR REFUSES WHAT IT DOES NOT KNOW. It implements exactly the subset these conditions use
// (context paths, single-quoted strings, `==`, `!=`, `&&`, `||`, parentheses) with GitHub's
// semantics for it: a missing output is the empty string, and string comparison ignores case. A
// condition that grows a function call or another operator makes this suite throw instead of
// evaluating something it does not understand.
//
// THE PROPERTY THAT MATTERS IS ONE-SIDED. Skipping `publish` is safe only on the path where
// `changeset publish` would publish nothing: no pending changesets, not a version commit, and the
// registry reported every version present. Every other combination must start it.

const WORKFLOW = readFileSync(
  join(import.meta.dirname, "..", ".github", "workflows", "release.yml"),
  "utf8",
);

interface Node {
  kind: "map" | "seq" | "scalar";
  entries?: Map<string, Node>;
  items?: Node[];
  value?: string | null;
}

const workflow = parseWorkflow(WORKFLOW) as Node;

function child(node: Node | undefined, key: string): Node | undefined {
  return node?.kind === "map" ? node.entries?.get(key) : undefined;
}

function scalar(node: Node | undefined): string | undefined {
  return node?.kind === "scalar" ? (node.value ?? undefined) : undefined;
}

const jobs = child(workflow, "jobs");

function jobIf(jobId: string): string {
  const expression = scalar(child(child(jobs, jobId), "if"));
  if (expression === undefined) throw new Error(`job ${jobId} has no \`if:\``);
  return expression;
}

function stepIf(jobId: string, stepName: string): string {
  const steps = child(child(jobs, jobId), "steps")?.items ?? [];
  const step = steps.find((candidate) => scalar(child(candidate, "name")) === stepName);
  if (step === undefined) throw new Error(`job ${jobId} has no step named ${stepName}`);
  const expression = scalar(child(step, "if"));
  if (expression === undefined) throw new Error(`step ${stepName} has no \`if:\``);
  return expression;
}

type Token =
  | { kind: "path"; value: string }
  | { kind: "string"; value: string }
  | { kind: "op"; value: "==" | "!=" | "&&" | "||" | "(" | ")" };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /\s*(?:([A-Za-z_][A-Za-z0-9_.-]*)|'((?:[^']|'')*)'|(==|!=|&&|\|\||\(|\)))/y;
  let at = 0;
  while (at < source.length) {
    if (/^\s*$/.test(source.slice(at))) break;
    pattern.lastIndex = at;
    const match = pattern.exec(source);
    if (match === null) {
      throw new Error(`the evaluator does not know ${JSON.stringify(source.slice(at))}`);
    }
    if (match[1] !== undefined) tokens.push({ kind: "path", value: match[1] });
    else if (match[2] !== undefined)
      tokens.push({ kind: "string", value: match[2].replace(/''/g, "'") });
    else tokens.push({ kind: "op", value: match[3] as "==" });
    at = pattern.lastIndex;
  }
  return tokens;
}

/**
 * Evaluate one `${{ }}` condition against a context of output values.
 *
 * @param expression The `if:` text as committed, with or without `${{ }}`.
 * @param context Every known path's value. A path not listed reads as `''`, as an unset output does.
 * @returns Whether the job or step would run.
 */
function evaluate(expression: string, context: Record<string, string>): boolean {
  const inner = /^\$\{\{([\s\S]*)\}\}$/.exec(expression.trim())?.[1] ?? expression;
  const tokens = tokenize(inner);
  let i = 0;
  const peek = () => tokens[i];
  const take = () => tokens[i++];

  const operand = (): string | boolean => {
    const token = take();
    if (token === undefined) throw new Error("the condition ends early");
    if (token.kind === "op" && token.value === "(") {
      const value = or();
      const close = take();
      if (close?.kind !== "op" || close.value !== ")") throw new Error("unbalanced parentheses");
      return value;
    }
    if (token.kind === "string") return token.value;
    if (token.kind === "path") {
      if (!/^(needs\.preflight|steps\.[a-z-]+)\.outputs\.[a-z-]+$/.test(token.value)) {
        throw new Error(`the evaluator does not know the context ${token.value}`);
      }
      return context[token.value] ?? "";
    }
    throw new Error(`unexpected ${token.value}`);
  };
  const comparison = (): string | boolean => {
    const left = operand();
    const next = peek();
    if (next?.kind === "op" && (next.value === "==" || next.value === "!=")) {
      take();
      const right = operand();
      const equal = String(left).toLowerCase() === String(right).toLowerCase();
      return next.value === "==" ? equal : !equal;
    }
    return left;
  };
  const truthy = (value: string | boolean) => value !== false && value !== "";
  const and = (): string | boolean => {
    let value = comparison();
    while (peek()?.kind === "op" && peek()?.value === "&&") {
      take();
      const right = comparison();
      value = truthy(value) ? right : value;
    }
    return value;
  };
  function or(): string | boolean {
    let value = and();
    while (peek()?.kind === "op" && peek()?.value === "||") {
      take();
      const right = and();
      value = truthy(value) ? value : right;
    }
    return value;
  }

  const result = or();
  if (i !== tokens.length) throw new Error("trailing tokens in the condition");
  return truthy(result);
}

/** What one push looks like to the jobs after `preflight`. */
interface Push {
  hasChangesets: "true" | "false";
  isRelease: "true" | "false";
  /** What the `pending` step wrote, or `undefined` when it did not run or did not report. */
  hasUnpublished?: "true" | "false" | "unknown";
}

function decide(push: Push) {
  const asked = evaluate(stepIf("preflight", "Is any package version missing from the registry"), {
    "steps.pending.outputs.has-changesets": push.hasChangesets,
  });
  const outputs: Record<string, string> = {
    "needs.preflight.outputs.has-changesets": push.hasChangesets,
    "needs.preflight.outputs.is-release": push.isRelease,
  };
  if (asked && push.hasUnpublished !== undefined) {
    outputs["needs.preflight.outputs.has-unpublished"] = push.hasUnpublished;
  }
  return {
    asked,
    version: evaluate(jobIf("version"), outputs),
    publish: evaluate(jobIf("publish"), outputs),
  };
}

describe("the evaluator itself", () => {
  it("follows GitHub's rules for the subset it implements", () => {
    expect(evaluate("${{ needs.preflight.outputs.x == 'true' }}", {})).toBe(false);
    expect(evaluate("${{ needs.preflight.outputs.x != 'false' }}", {})).toBe(true);
    expect(
      evaluate("${{ needs.preflight.outputs.x == 'TRUE' }}", {
        "needs.preflight.outputs.x": "true",
      }),
    ).toBe(true);
    expect(evaluate("${{ 'a' == 'b' || ('c' == 'c' && 'd' != 'e') }}", {})).toBe(true);
    expect(evaluate("${{ 'a' == 'a' && ('c' == 'd' || 'd' == 'e') }}", {})).toBe(false);
  });

  it("refuses a condition it does not understand rather than guessing", () => {
    expect(() => evaluate("${{ contains(needs.preflight.outputs.x, 'y') }}", {})).toThrow();
    expect(() => evaluate("${{ github.event_name == 'push' }}", {})).toThrow(/context/);
    expect(() => evaluate("${{ !cancelled() }}", {})).toThrow();
  });
});

describe("the job that asks for the release approval", () => {
  it("is the publish job and only the publish job", () => {
    const gated = [...(jobs?.entries ?? new Map<string, Node>())]
      .filter(([, job]) => child(job, "environment") !== undefined)
      .map(([id, job]) => [id, scalar(child(job, "environment"))]);
    expect(gated).toEqual([["publish", "release"]]);
    expect(scalar(child(child(jobs, "publish"), "needs"))).toBe("preflight");
  });

  it("grants id-token write and runs on a GitHub-hosted runner", () => {
    const publish = child(jobs, "publish");
    expect(scalar(child(child(publish, "permissions"), "id-token"))).toBe("write");
    expect(scalar(child(publish, "runs-on"))).toBe("ubuntu-latest");
  });
});

describe("which job runs on which push", () => {
  it("a push carrying a pending changeset: version runs, publish is skipped, nothing is asked", () => {
    for (const isRelease of ["true", "false"] as const) {
      const decision = decide({ hasChangesets: "true", isRelease });
      expect(decision).toEqual({ asked: false, version: true, publish: false });
    }
  });

  it("a version commit: publish runs, whatever the registry says", () => {
    // Including `false`: a re-run after a partial release finds every version published and still
    // owes tags and GitHub releases, which only the publish job creates.
    for (const hasUnpublished of ["true", "false", "unknown", undefined] as const) {
      const decision = decide({ hasChangesets: "false", isRelease: "true", hasUnpublished });
      expect(decision, `has-unpublished=${hasUnpublished}`).toEqual({
        asked: true,
        version: false,
        publish: true,
      });
    }
  });

  it("no changesets and a version the registry lacks: publish runs", () => {
    // A cancelled or failed publish, or a version merged by hand: what the old classifier-only rule
    // would have withheld silently.
    expect(decide({ hasChangesets: "false", isRelease: "false", hasUnpublished: "true" })).toEqual({
      asked: true,
      version: false,
      publish: true,
    });
  });

  it("no changesets and a registry that could not be read: publish runs", () => {
    expect(
      decide({ hasChangesets: "false", isRelease: "false", hasUnpublished: "unknown" }),
    ).toEqual({ asked: true, version: false, publish: true });
  });

  it("no changesets and a check that did not report: publish runs", () => {
    expect(decide({ hasChangesets: "false", isRelease: "false" })).toEqual({
      asked: true,
      version: false,
      publish: true,
    });
  });

  it("an ordinary push with every version on npm: neither arm runs, so no deployment is requested", () => {
    expect(decide({ hasChangesets: "false", isRelease: "false", hasUnpublished: "false" })).toEqual(
      {
        asked: true,
        version: false,
        publish: false,
      },
    );
  });

  it("skips publish on exactly one combination of outputs", () => {
    const skipped: Push[] = [];
    for (const hasChangesets of ["true", "false"] as const) {
      for (const isRelease of ["true", "false"] as const) {
        for (const hasUnpublished of ["true", "false", "unknown", undefined] as const) {
          const push = { hasChangesets, isRelease, hasUnpublished };
          if (hasChangesets === "false" && !decide(push).publish) skipped.push(push);
        }
      }
    }
    expect(skipped).toEqual([
      { hasChangesets: "false", isRelease: "false", hasUnpublished: "false" },
    ]);
  });

  it("asks the registry with the shipped command, writing to the job's outputs", () => {
    const steps = child(child(jobs, "preflight"), "steps")?.items ?? [];
    const step = steps.find(
      (candidate) =>
        scalar(child(candidate, "name")) === "Is any package version missing from the registry",
    );
    expect(scalar(child(step, "id"))).toBe("unpublished");
    expect(scalar(child(step, "run"))).toBe(
      'node scripts/registry-presence.mjs pending --output "$GITHUB_OUTPUT"',
    );
    expect(scalar(child(child(child(jobs, "preflight"), "outputs"), "has-unpublished"))).toBe(
      "${{ steps.unpublished.outputs.has-unpublished }}",
    );
  });
});
