import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  docSnippetSuite,
  extractRunnableSnippets,
  remapImports,
  rewriteAssertions,
  runSnippet,
} from "@cosyte/vitest-config/snippets";

// The temp dir for runSnippet's emitted modules MUST be inside the project root (Vitest does not
// transform files under node_modules or outside the workspace). The repo root is cwd during the run.
const TMP = join(process.cwd(), ".cosyte-doc-snippets-selftest");
afterAll(() => {
  try {
    rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

describe("extractRunnableSnippets", () => {
  it("extracts only opt-in `runnable` TypeScript blocks, in order", () => {
    const md = [
      "# Doc",
      "",
      "```ts",
      "const notRun = 1;",
      "```",
      "",
      "```ts runnable",
      "const a = 1;",
      "a; // => 1",
      "```",
      "",
      "```bash runnable",
      "echo skipped",
      "```",
      "",
      "```typescript runnable throws",
      "throw new Error('boom');",
      "```",
    ].join("\n");
    const got = extractRunnableSnippets(md);
    expect(got.length).toBe(2);
    expect(got[0].lang).toBe("ts");
    expect(got[0].throws).toBe(false);
    expect(got[0].code).toContain("const a = 1;");
    expect(got[0].line).toBe(8); // 1-based first code line of the runnable block
    expect(got[1].throws).toBe(true);
  });

  it("ignores fenced blocks that are not TypeScript or not tagged", () => {
    const md = ["```js runnable", "const x = 1;", "```", "```ts", "const y = 2;", "```"].join("\n");
    expect(extractRunnableSnippets(md)).toEqual([]);
  });
});

describe("rewriteAssertions", () => {
  it("turns `expr; // => value` into a strict-equal expectation", () => {
    const { code, assertions } = rewriteAssertions("const a = [1];\na; // => [1]");
    expect(assertions).toBe(1);
    expect(code).toContain("expect(a).toStrictEqual([1]);");
    expect(code).toContain("const a = [1];");
  });

  it("leaves non-assertion lines untouched", () => {
    const { code, assertions } = rewriteAssertions("doThing(); // just a note");
    expect(assertions).toBe(0);
    expect(code).toBe("doThing(); // just a note");
  });
});

describe("remapImports", () => {
  it("rewrites matching `from` specifiers and leaves others alone", () => {
    const src = 'import { a } from "@cosyte/hl7";\nimport { b } from "node:path";';
    const out = remapImports(src, (s) => (s === "@cosyte/hl7" ? "/abs/dist/index.js" : undefined));
    expect(out).toContain('from "/abs/dist/index.js"');
    expect(out).toContain('from "node:path"');
  });

  it("is a no-op without a resolver", () => {
    const src = 'import { a } from "x";';
    expect(remapImports(src, undefined)).toBe(src);
  });
});

describe("runSnippet (compile + execute + assert against the real module graph)", () => {
  it("passes a correct snippet, including a real import and an inline assertion", async () => {
    await expect(
      runSnippet(
        {
          code: 'import { join } from "node:path";\njoin("a", "b"); // => "a/b"',
          throws: false,
        } as never,
        { tmpDir: TMP },
      ),
    ).resolves.toBeUndefined();
  });

  // THE acceptance gate: a snippet whose asserted output is wrong MUST fail the harness.
  it("rejects a snippet whose asserted output is wrong (the seeded-wrong-snippet gate)", async () => {
    await expect(runSnippet("const two = 1 + 1;\ntwo; // => 3", { tmpDir: TMP })).rejects.toThrow();
  });

  it("rejects a snippet that throws when it was not supposed to", async () => {
    await expect(runSnippet("throw new Error('unexpected');", { tmpDir: TMP })).rejects.toThrow();
  });

  it("passes a `throws`-tagged snippet that throws", async () => {
    await expect(
      runSnippet({ code: "throw new Error('expected');", throws: true } as never, { tmpDir: TMP }),
    ).resolves.toBeUndefined();
  });

  it("rejects a `throws`-tagged snippet that does not throw", async () => {
    await expect(
      runSnippet({ code: "const ok = 1;", throws: true } as never, { tmpDir: TMP }),
    ).rejects.toThrow(/did not|without throwing/);
  });
});

describe("docSnippetSuite wiring", () => {
  // Build a fixture docs dir and let docSnippetSuite register tests over it. A correct snippet only,
  // so this nested suite stays green; the failure path is covered by runSnippet above.
  const dir = mkdtempSync(join(tmpdir(), "cosyte-docsuite-"));
  writeFileSync(
    join(dir, "intro.md"),
    ["# Intro", "", "```ts runnable", "const sum = 2 + 3;", "sum; // => 5", "```"].join("\n"),
  );
  afterAll(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  docSnippetSuite({
    docsDir: dir,
    tmpDir: TMP,
    name: "fixture doc/code agreement",
    requireSnippet: true,
  });
});

// A package with docs-content but no runnable snippets yet (the scaffold state) must not fail as an
// empty suite. Pointing at a non-existent dir yields zero snippets; the suite stays green.
docSnippetSuite({
  docsDir: join(tmpdir(), "cosyte-does-not-exist-xyz"),
  tmpDir: TMP,
  name: "empty doc/code agreement",
});
