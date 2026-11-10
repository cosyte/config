import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  docSnippetSuite,
  extractSamples,
  planSamples,
  runSnippet,
  SAMPLE_LANGS,
} from "@cosyte/vitest-config/snippets";

/**
 * The sample runner's "every sample" mode: every TypeScript and JavaScript block in docs-content
 * runs, not only the ones tagged `runnable`, and a block that cannot run says why in its fence
 * (`no-run <reason>`), so each exception is listed in the test report with its reason.
 */

const TMP = join(process.cwd(), ".cosyte-doc-snippets-every-selftest");
afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

const fence = "```";

describe("extractSamples", () => {
  it("takes every TypeScript and JavaScript block, tagged or not, and nothing else", () => {
    const md = [
      "# Doc",
      `${fence}ts`,
      "const a = 1;",
      fence,
      `${fence}typescript runnable`,
      "const b = 2;",
      fence,
      `${fence}tsx`,
      "const c = 3;",
      fence,
      `${fence}js`,
      "const d = 4;",
      fence,
      `${fence}javascript`,
      "const e = 5;",
      fence,
      `${fence}mjs`,
      "const f = 6;",
      fence,
      `${fence}bash`,
      "pnpm add @cosyte/hl7",
      fence,
      `${fence}json`,
      "{}",
      fence,
      `${fence}`,
      "no language",
      fence,
      `${fence}TS`,
      "const g = 7;",
      fence,
    ].join("\n");
    const got = extractSamples(md);
    expect(got.map((s) => [s.lang, s.code, s.line])).toEqual([
      ["ts", "const a = 1;", 3],
      ["typescript", "const b = 2;", 6],
      ["tsx", "const c = 3;", 9],
      ["js", "const d = 4;", 12],
      ["javascript", "const e = 5;", 15],
      ["mjs", "const f = 6;", 18],
      ["ts", "const g = 7;", 30],
    ]);
    expect(got.every((s) => s.skip === null && s.throws === false)).toBe(true);
    expect([...SAMPLE_LANGS].sort()).toEqual([
      "javascript",
      "js",
      "mjs",
      "ts",
      "tsx",
      "typescript",
    ]);
  });

  it("reads throws, and no-run with the reason that follows it", () => {
    const md = [
      `${fence}ts throws`,
      "throw new Error('x');",
      fence,
      `${fence}ts no-run   opens a socket that   stays open`,
      "listen();",
      fence,
      `${fence}js runnable no-run needs a running peer`,
      "connect();",
      fence,
      `${fence}ts no-run`,
      "bare();",
      fence,
      `${fence}ts no-run throws when run here`,
      "boom();",
      fence,
    ].join("\n");
    expect(
      extractSamples(md).map((s) => ({ throws: s.throws, skip: s.skip, meta: s.meta })),
    ).toEqual([
      { throws: true, skip: null, meta: ["throws"] },
      {
        throws: false,
        skip: "opens a socket that stays open",
        meta: ["no-run", "opens", "a", "socket", "that", "stays", "open"],
      },
      {
        throws: false,
        skip: "needs a running peer",
        meta: ["runnable", "no-run", "needs", "a", "running", "peer"],
      },
      { throws: false, skip: "", meta: ["no-run"] },
      {
        throws: false,
        skip: "throws when run here",
        meta: ["no-run", "throws", "when", "run", "here"],
      },
    ]);
  });

  it("closes a block on a fence with trailing spaces, and not on a fence with an info string", () => {
    const md = [
      `${fence}ts`,
      "a();",
      `${fence}   `,
      `${fence}ts`,
      "b();",
      `${fence}js`,
      "c();",
      fence,
    ].join("\n");
    expect(extractSamples(md).map((s) => s.code)).toEqual(["a();", `b();\n${fence}js\nc();`]);
  });

  it("closes a tilde fence on tildes, and a fence only at its own indentation", () => {
    const md = ["~~~ts", "a();", "~~~", "```ts", "b();", "  ```", "c();", "```"].join("\n");
    expect(extractSamples(md).map((s) => s.code)).toEqual(["a();", "b();\n  ```\nc();"]);
    const long = ["````ts", "d();", "```", "~~~~", "e();", "x````", "````"].join("\n");
    expect(extractSamples(long).map((s) => s.code)).toEqual(["d();\n```\n~~~~\ne();\nx````"]);
  });

  it("keeps a block's indentation rule and an unclosed block's body", () => {
    const md = [
      "  ```js",
      "  const a = 1;",
      "    nested();",
      " short();",
      "  ```",
      "```ts",
      "open();",
    ].join("\n");
    expect(extractSamples(md).map((s) => s.code)).toEqual([
      "const a = 1;\n  nested();\n short();",
      "open();",
    ]);
  });
});

describe("planSamples", () => {
  const dir = mkdtempSync(join(tmpdir(), "cosyte-plan-samples-"));
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function file(name: string, lines: string[]): string {
    const path = join(dir, name);
    writeFileSync(path, lines.join("\n"));
    return path;
  }

  it("plans a run for each sample, a skip with its reason, and an error for a bare no-run", () => {
    const a = file("a.md", [
      `${fence}ts`,
      "const a = 1;",
      fence,
      `${fence}ts no-run needs a peer`,
      "x();",
      fence,
      `${fence}ts no-run`,
      "y();",
      fence,
      `${fence}ts no-run throws because`,
      "z();",
      fence,
    ]);
    const plan = planSamples([a], { every: true, root: dir });
    expect(plan.map((p) => [p.label, p.kind, p.reason])).toEqual([
      ["a.md:2", "run", null],
      ["a.md:5", "skip", "needs a peer"],
      [
        "a.md:8",
        "invalid",
        "a no-run sample names its reason after no-run, as in: ts no-run <why>",
      ],
      ["a.md:11", "skip", "throws because"],
    ]);
    expect(plan[0]?.snippet.code).toBe("const a = 1;");
  });

  it("plans only runnable blocks, as before, when every is off", () => {
    const b = file("b.md", [
      `${fence}ts`,
      "const notRun = 1;",
      fence,
      `${fence}ts runnable`,
      "const run = 1;",
      fence,
      `${fence}js runnable`,
      "const js = 1;",
      fence,
    ]);
    expect(planSamples([b], { root: dir }).map((p) => [p.label, p.kind])).toEqual([
      ["b.md:5", "run"],
    ]);
    expect(planSamples([b], { root: dir, runnableTag: "doctest" })).toEqual([]);
  });

  it("labels a sample by its path from the working directory by default", () => {
    const c = file("c.md", [`${fence}ts`, "1;", fence]);
    const [only] = planSamples([c], { every: true });
    expect(only?.label.endsWith("c.md:2")).toBe(true);
    expect(only?.label).not.toBe("c.md:2");
  });
});

describe("runSnippet runs a JavaScript sample as JavaScript", () => {
  it("writes a js sample to a .mjs module, and a tsx one to .tsx", async () => {
    const seen: string[] = [];
    const watch = (lang: string) =>
      runSnippet(
        {
          lang,
          meta: [],
          line: 1,
          throws: false,
          skip: null,
          code: 'import { readdirSync } from "node:fs";\nglobalThis.__seen = readdirSync(import.meta.dirname);',
        },
        { tmpDir: TMP },
      ).then(() =>
        seen.push(
          ...(globalThis as { __seen?: string[] }).__seen!.filter((name) =>
            name.startsWith("snippet-"),
          ),
        ),
      );
    await watch("js");
    await watch("javascript");
    await watch("mjs");
    await watch("tsx");
    await watch("ts");
    expect(seen.map((name) => name.replace(/^snippet-\d+-\d+/, ""))).toEqual([
      ".mjs",
      ".mjs",
      ".mjs",
      ".tsx",
      ".ts",
    ]);
  });

  it("rejects TypeScript syntax in a js sample, which a .ts module would have accepted", async () => {
    const sample = { lang: "js", meta: [], line: 1, throws: false, skip: null };
    await expect(
      runSnippet({ ...sample, code: "const a: number = 1;" }, { tmpDir: TMP }),
    ).rejects.toThrow();
    await expect(
      runSnippet({ ...sample, lang: "ts", code: "const a: number = 1;" }, { tmpDir: TMP }),
    ).resolves.toBeUndefined();
  });

  it("removes its module after the run", async () => {
    await runSnippet("const z = 1;", { tmpDir: TMP });
    expect(readdirSync(TMP).filter((name) => name.startsWith("snippet-"))).toEqual([]);
  });
});

describe("docSnippetSuite in every-sample mode", () => {
  // A fixed folder rather than a fresh temp one, so each sample's test name is the same on every
  // run: a mutation tester picks the tests to rerun by name.
  const dir = join(TMP, "every");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "intro.md"),
    [
      "# Intro",
      `${fence}ts`,
      "const sum = 2 + 3;",
      "sum; // => 5",
      fence,
      `${fence}js`,
      "const twice = [1, 2].map((n) => n * 2);",
      "twice; // => [2, 4]",
      fence,
      `${fence}ts throws`,
      "JSON.parse('{');",
      fence,
      `${fence}ts no-run starts a listener that never closes`,
      "while (true) {}",
      fence,
      `${fence}ts`,
      'import { join } from "@cosyte/example";',
      'join("a", "b"); // => "a/b"',
      "(globalThis as { __everySampleRan?: boolean }).__everySampleRan = true;",
      fence,
      `${fence}bash`,
      "exit 1",
      fence,
    ].join("\n"),
  );
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  beforeAll(() => {
    delete (globalThis as { __everySampleRan?: boolean }).__everySampleRan;
  });

  docSnippetSuite({
    docsDir: dir,
    tmpDir: TMP,
    name: "fixture every-sample agreement",
    every: true,
    requireSnippet: true,
    resolve: (specifier) => (specifier === "@cosyte/example" ? "node:path" : undefined),
  });

  it("ran each sample's code, and listed the no-run sample as skipped with its reason", ({
    task,
  }) => {
    expect((globalThis as { __everySampleRan?: boolean }).__everySampleRan).toBe(true);
    const fixture = task.suite?.tasks.find((t) => t.name === "fixture every-sample agreement");
    const tests = fixture?.type === "suite" ? fixture.tasks : [];
    expect(tests.map((t) => [t.name.replace(/^.*intro\.md/, "intro.md"), t.mode])).toEqual([
      ["intro.md:3", "run"],
      ["intro.md:7", "run"],
      ["intro.md:11", "run"],
      ["intro.md:14 (not run: starts a listener that never closes)", "skip"],
      ["intro.md:17", "run"],
      ["carries at least one runnable snippet", "run"],
    ]);
  });
});

describe("docSnippetSuite without every", () => {
  // Built from a fixed folder for the same reason as above.
  const dir = join(TMP, "runnable-only");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "page.md"),
    [
      "# Page",
      `${fence}ts`,
      "throw new Error('an illustrative block, not run without every');",
      fence,
      `${fence}ts runnable`,
      "const ran = 1;",
      "ran; // => 1",
      fence,
    ].join("\n"),
  );

  docSnippetSuite({ docsDir: dir, tmpDir: TMP, name: "fixture runnable-only agreement" });
});

describe("a no-run sample with no reason fails the suite", () => {
  // The failing test lives in a separate Vitest run, because a failing test registered here would
  // red this suite. The fixture sits inside the repository so it resolves the workspace package.
  it("reds a real Vitest run and names the sample and the rule", () => {
    const root = join(TMP, "bare-no-run");
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(
      join(root, "docs", "page.md"),
      ["# Page", `${fence}ts no-run`, "1;", fence, `${fence}ts`, "2; // => 2", fence].join("\n"),
    );
    writeFileSync(
      join(root, "vitest.config.mjs"),
      'export default { test: { include: ["*.test.mjs"] } };\n',
    );
    writeFileSync(
      join(root, "samples.test.mjs"),
      [
        'import { join } from "node:path";',
        'import { docSnippetSuite } from "@cosyte/vitest-config/snippets";',
        'docSnippetSuite({ docsDir: join(import.meta.dirname, "docs"), every: true,',
        '  tmpDir: join(import.meta.dirname, "tmp") });',
        "",
      ].join("\n"),
    );
    const vitest = join(process.cwd(), "node_modules", "vitest", "vitest.mjs");
    const run = spawnSync(process.execPath, [vitest, "run", "--root", root], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, CI: "", NO_COLOR: "1" },
      timeout: 120_000,
    });
    const out = `${run.stdout}${run.stderr}`;
    expect(run.status, out).toBe(1);
    expect(out).toContain(
      "docs/page.md:3: a no-run sample names its reason after no-run, as in: ts no-run <why>",
    );
    expect(out).toMatch(/1 failed \| 1 passed/);
  }, 120_000);
});
