import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  docSnippetSuite,
  extractRunnableSnippets,
  extractSamples,
  planSamples,
  runSnippet,
  SAMPLE_LANGS,
  typecheckSamples,
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
    expect(got.map((s) => [s.lang, s.code, s.line, s.extension])).toEqual([
      ["ts", "const a = 1;", 3, ".ts"],
      ["typescript", "const b = 2;", 6, ".ts"],
      ["tsx", "const c = 3;", 9, ".tsx"],
      ["js", "const d = 4;", 12, ".mjs"],
      ["javascript", "const e = 5;", 15, ".mjs"],
      ["mjs", "const f = 6;", 18, ".mjs"],
      ["ts", "const g = 7;", 30, ".ts"],
    ]);
    expect(got.every((s) => s.skip === null && s.noTypecheck === null && s.throws === false)).toBe(
      true,
    );
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

  it("reads no-typecheck with its reason, the first of no-run and no-typecheck winning", () => {
    const md = [
      `${fence}ts throws no-typecheck  passes a value the types refuse`,
      "parse(42);",
      fence,
      `${fence}ts no-typecheck`,
      "bare();",
      fence,
      `${fence}ts no-run needs a peer, so no-typecheck is moot`,
      "connect();",
      fence,
      `${fence}tsx no-typecheck no-run is prose here`,
      "render();",
      fence,
    ].join("\n");
    expect(
      extractSamples(md).map((s) => ({
        throws: s.throws,
        skip: s.skip,
        noTypecheck: s.noTypecheck,
      })),
    ).toEqual([
      { throws: true, skip: null, noTypecheck: "passes a value the types refuse" },
      { throws: false, skip: null, noTypecheck: "" },
      { throws: false, skip: "needs a peer, so no-typecheck is moot", noTypecheck: null },
      { throws: false, skip: null, noTypecheck: "no-run is prose here" },
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
    expect(plan.map((p) => [p.label, p.kind, p.reason, p.typecheck])).toEqual([
      ["a.md:2", "run", null, true],
      ["a.md:5", "skip", "needs a peer", false],
      [
        "a.md:8",
        "invalid",
        "a no-run sample names its reason after no-run, as in: ts no-run <why>",
        false,
      ],
      ["a.md:11", "skip", "throws because", false],
    ]);
    expect(plan[0]?.snippet.code).toBe("const a = 1;");
  });

  it("type-checks each TypeScript sample that runs, unless it says why not", () => {
    const t = file("t.md", [
      `${fence}ts`,
      "1;",
      fence,
      `${fence}tsx`,
      "2;",
      fence,
      `${fence}js`,
      "3;",
      fence,
      `${fence}ts no-typecheck shows a value the types refuse`,
      "4;",
      fence,
      `${fence}ts no-typecheck`,
      "5;",
      fence,
      `${fence}mjs no-typecheck not TypeScript anyway`,
      "6;",
      fence,
    ]);
    expect(
      planSamples([t], { every: true, root: dir }).map((p) => [
        p.label,
        p.kind,
        p.reason,
        p.typecheck,
      ]),
    ).toEqual([
      ["t.md:2", "run", null, true],
      ["t.md:5", "run", null, true],
      ["t.md:8", "run", null, false],
      ["t.md:11", "run", "shows a value the types refuse", false],
      [
        "t.md:14",
        "invalid",
        "a no-typecheck sample names its reason after no-typecheck, as in: ts no-typecheck <why>",
        false,
      ],
      ["t.md:17", "run", "not TypeScript anyway", false],
    ]);
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
    expect(
      planSamples([b], { root: dir }).map((p) => [p.label, p.kind, p.reason, p.typecheck]),
    ).toEqual([["b.md:5", "run", null, false]]);
    expect(planSamples([b], { root: dir, every: false })[0]?.snippet.noTypecheck).toBeNull();
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
  /** The extension of each module runSnippet writes, in order, read from inside the module. */
  async function extensionsOf(snippets: Parameters<typeof runSnippet>[0][]): Promise<string[]> {
    const seen: string[] = [];
    for (const snippet of snippets) {
      const probe =
        'import { readdirSync } from "node:fs";\nglobalThis.__seen = readdirSync(import.meta.dirname);';
      await runSnippet(typeof snippet === "string" ? probe : { ...snippet, code: probe }, {
        tmpDir: TMP,
      });
      seen.push(
        ...(globalThis as { __seen?: string[] }).__seen!.filter((name) =>
          name.startsWith("snippet-"),
        ),
      );
    }
    return seen.map((name) => name.replace(/^snippet-\d+-\d+/, ""));
  }

  it("writes each sample from extractSamples to the module its language names", async () => {
    const md = ["js", "javascript", "mjs", "tsx", "ts", "typescript"]
      .map((lang) => `${fence}${lang}\nconst x = 1;\n${fence}`)
      .join("\n");
    expect(await extensionsOf(extractSamples(md))).toEqual([
      ".mjs",
      ".mjs",
      ".mjs",
      ".tsx",
      ".ts",
      ".ts",
    ]);
  });

  it("writes any other snippet to a .ts module, as it always has", async () => {
    const base = { meta: [], line: 1, throws: false };
    expect(
      await extensionsOf([
        { ...base, lang: "tsx", code: "" },
        { ...base, lang: "js", code: "" },
        { ...base, lang: "ts", code: "" },
        ...extractRunnableSnippets(`${fence}tsx runnable\nconst x = 1;\n${fence}`),
        "",
      ]),
    ).toEqual([".ts", ".ts", ".ts", ".ts", ".ts"]);
  });

  it("rejects TypeScript syntax in a js sample, which a .ts module would have accepted", async () => {
    const sample = { lang: "js", meta: [], line: 1, throws: false, skip: null, extension: ".mjs" };
    await expect(
      runSnippet({ ...sample, code: "const a: number = 1;" }, { tmpDir: TMP }),
    ).rejects.toThrow();
    await expect(
      runSnippet(
        { ...sample, lang: "ts", extension: ".ts", code: "const a: number = 1;" },
        { tmpDir: TMP },
      ),
    ).resolves.toBeUndefined();
  });

  it("removes its module after the run", async () => {
    await runSnippet("const z = 1;", { tmpDir: TMP });
    expect(readdirSync(TMP).filter((name) => name.startsWith("snippet-"))).toEqual([]);
  });
});

/**
 * A project to type-check samples in: a `tsconfig.json` that maps `@cosyte/example` to a declaration
 * file, the way a library's own config resolves its published name to its built declarations, and
 * that turns on an unused-name check a sample must not trip. It sits outside TMP, which each fixture
 * suite removes when it ends.
 */
const PROJECT = join(process.cwd(), ".cosyte-doc-snippets-types-project");
mkdirSync(PROJECT, { recursive: true });
afterAll(() => {
  rmSync(PROJECT, { recursive: true, force: true });
});
writeFileSync(
  join(PROJECT, "tsconfig.json"),
  JSON.stringify({
    compilerOptions: {
      target: "es2023",
      module: "nodenext",
      moduleResolution: "nodenext",
      strict: true,
      types: [],
      skipLibCheck: true,
      noUnusedLocals: true,
      paths: { "@cosyte/example": ["./example.d.ts"] },
    },
    // Matches no file, as a library's `include` matches none of the samples.
    include: ["src/**/*.ts"],
  }),
);
writeFileSync(
  join(PROJECT, "example.d.ts"),
  "/** Join path parts. */\nexport declare function join(...parts: string[]): string;\n",
);

/**
 * The project is a package too, published as `@cosyte/selfref` with its built declarations in
 * `dist/`, and a config that writes there: a library's own shape, whose samples import it by name.
 */
writeFileSync(
  join(PROJECT, "package.json"),
  JSON.stringify({
    name: "@cosyte/selfref",
    type: "module",
    exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } },
  }),
);
mkdirSync(join(PROJECT, "dist"), { recursive: true });
writeFileSync(
  join(PROJECT, "dist", "index.d.ts"),
  "/** Count the parts. */\nexport declare function count(...parts: string[]): number;\n",
);
writeFileSync(
  join(PROJECT, "tsconfig.build.json"),
  JSON.stringify({
    extends: "./tsconfig.json",
    compilerOptions: {
      outDir: "./dist",
      declaration: true,
      declarationMap: true,
      noUnusedParameters: true,
    },
  }),
);

/** A config that extends the project's and sets its own `jsx`, which the check keeps. */
writeFileSync(
  join(PROJECT, "tsconfig.react.json"),
  JSON.stringify({ extends: "./tsconfig.json", compilerOptions: { jsx: "react" } }),
);

describe("typecheckSamples", () => {
  const dir = join(PROJECT, "out");
  const tsconfig = join(PROJECT, "tsconfig.json");
  const sample = (code: string, line = 10, extension = ".ts") => ({ code, line, extension });

  it("finds each sample's errors at their markdown line, and none in a sample that compiles", async () => {
    const found = await typecheckSamples(
      [
        sample('import { join } from "@cosyte/example";\nconst path: string = join("a", "b");'),
        sample('import { join } from "@cosyte/example";\n\nconst n: number = join("a");', 20),
        sample("const = ;", 30),
        sample('import { missing } from "@cosyte/example";\nmissing();', 40),
      ],
      { tsconfig, dir },
    );
    expect(found).toEqual([
      [],
      [{ line: 22, code: 2322, message: "Type 'string' is not assignable to type 'number'." }],
      [{ line: 30, code: 1134, message: "Variable declaration expected." }],
      [
        {
          line: 40,
          code: 2305,
          message: "Module '\"@cosyte/example\"' has no exported member 'missing'.",
        },
      ],
    ]);
  });

  it("resolves the package's own name to its built declarations, under a config that writes them", async () => {
    const found = await typecheckSamples(
      [
        sample('import { count } from "@cosyte/selfref";\nconst n: number = count("a", "b");'),
        sample(
          'import { count } from "@cosyte/selfref";\ncount(1);\nfunction f(unused: number) {}',
          5,
        ),
      ],
      { tsconfig: join(PROJECT, "tsconfig.build.json"), dir },
    );
    expect(found).toEqual([
      [],
      [
        {
          line: 6,
          code: 2345,
          message: "Argument of type 'number' is not assignable to parameter of type 'string'.",
        },
      ],
    ]);
  });

  it("compiles each sample as its own module, without the unused-name checks", async () => {
    const found = await typecheckSamples(
      [
        sample("const shown = 1;"),
        sample("const shown = 2;\nfunction unused(a: number) {}"),
        sample("const value = await Promise.resolve(1);"),
      ],
      { tsconfig, dir },
    );
    expect(found).toEqual([[], [], []]);
  });

  it("compiles a .tsx sample as TSX, preserving JSX unless the config sets it", async () => {
    const tsx = [sample("const fragment = <></>;", 1, ".tsx"), sample("const n = <number>1;", 2)];
    expect(await typecheckSamples(tsx, { tsconfig, dir })).toEqual([[], []]);
    const react = await typecheckSamples(tsx, {
      tsconfig: join(PROJECT, "tsconfig.react.json"),
      dir,
    });
    // TypeScript's own words for JSX with no React in scope, which only the react mode asks for.
    expect(react[0]?.length).toBeGreaterThan(0);
    expect(react[0]?.every((e) => e.message.includes("React"))).toBe(true);
    expect(react[1]).toEqual([]);
  });

  it("reads a sample with no extension as .ts, and removes every file it wrote", async () => {
    expect(
      await typecheckSamples([{ code: "const n = <number>1;", line: 1 }], { dir, tsconfig }),
    ).toEqual([[]]);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("uses the working directory's tsconfig.json, and its own options without one", async () => {
    const cwd = vi.spyOn(process, "cwd");
    try {
      cwd.mockReturnValue(PROJECT);
      const code = 'import { join } from "@cosyte/example";\njoin("a");';
      expect(await typecheckSamples([sample(code)])).toEqual([[]]);
      expect(readdirSync(join(PROJECT, ".cosyte-doc-snippets", "typecheck"))).toEqual([]);
      cwd.mockReturnValue(join(PROJECT, "out"));
      const [errors] = await typecheckSamples([sample(code)], { dir });
      expect(errors?.map((e) => e.code)).toEqual([2307]);
      // Strict, as our libraries are.
      expect(
        (await typecheckSamples([sample("let a;\nfunction f(x) {}")], { dir }))[0]?.map(
          (e) => e.code,
        ),
      ).toEqual([7006]);
    } finally {
      cwd.mockRestore();
    }
  });

  it("refuses a config it cannot read or that has an error, and an error in the whole program", async () => {
    await expect(
      typecheckSamples([sample("1;")], { tsconfig: join(PROJECT, "absent.json"), dir }),
    ).rejects.toThrow(
      /^the samples could not be type-checked: Cannot read file '.*absent\.json'\.$/,
    );
    writeFileSync(
      join(PROJECT, "tsconfig.bad.json"),
      JSON.stringify({ compilerOptions: { notAnOption: true } }),
    );
    await expect(
      typecheckSamples([sample("1;")], { tsconfig: join(PROJECT, "tsconfig.bad.json"), dir }),
    ).rejects.toThrow(
      "the samples could not be type-checked: Unknown compiler option 'notAnOption'.",
    );
    writeFileSync(
      join(PROJECT, "tsconfig.types.json"),
      JSON.stringify({ compilerOptions: { types: ["no-such-types"] } }),
    );
    await expect(
      typecheckSamples([sample("1;")], { tsconfig: join(PROJECT, "tsconfig.types.json"), dir }),
    ).rejects.toThrow(
      /^the samples could not be type-checked: Cannot find type definition file for 'no-such-types'/,
    );
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe("runSnippet with a sample's type errors", () => {
  it("fails with each error and its line, before the sample runs", async () => {
    const g = globalThis as { __typedRan?: boolean };
    delete g.__typedRan;
    await expect(
      runSnippet("(globalThis as { __typedRan?: boolean }).__typedRan = true;", {
        tmpDir: TMP,
        typeErrors: [
          { line: 12, code: 2322, message: "Type 'string' is not assignable to type 'number'." },
          { line: 14, code: 2304, message: "Cannot find name 'x'." },
        ],
      }),
    ).rejects.toThrow(
      "the sample does not type-check against the package's types:\n" +
        "  line 12: TS2322: Type 'string' is not assignable to type 'number'.\n" +
        "  line 14: TS2304: Cannot find name 'x'.",
    );
    expect(g.__typedRan).toBeUndefined();
    await runSnippet("(globalThis as { __typedRan?: boolean }).__typedRan = true;", {
      tmpDir: TMP,
      typeErrors: [],
    });
    expect(g.__typedRan).toBe(true);
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
      `${fence}ts no-typecheck shows a value the types refuse`,
      'const count: number = "3";',
      'count; // => "3"',
      fence,
    ].join("\n"),
  );
  // The generated reference: its examples are parts of a signature's documentation, and one that
  // ran here would fail.
  mkdirSync(join(dir, "api", "deep"), { recursive: true });
  writeFileSync(
    join(dir, "api", "README.md"),
    [
      "# Reference",
      `${fence}ts`,
      "throw new Error('a generated example, not a sample');",
      fence,
    ].join("\n"),
  );
  writeFileSync(
    join(dir, "api", "deep", "page.md"),
    ["# Deeper", `${fence}ts`, "const generated = 1;", "generated; // => 1", fence].join("\n"),
  );
  // A folder named like the generated one but deeper is not the generated one.
  mkdirSync(join(dir, "guides", "api"), { recursive: true });
  writeFileSync(
    join(dir, "guides", "api", "page.md"),
    ["# Guide", `${fence}ts`, "const guide = 1;", "guide; // => 1", fence].join("\n"),
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
    tsconfig: join(PROJECT, "tsconfig.json"),
  });

  docSnippetSuite({
    docsDir: join(dir, "api"),
    tmpDir: TMP,
    name: "fixture generated pages, included",
    every: true,
    includeGenerated: true,
    include: /page\.md$/,
    tsconfig: join(PROJECT, "tsconfig.json"),
  });

  /** The tests a fixture suite registered, by name relative to the fixture folder, and mode. */
  function registered(
    task: { suite?: { tasks: { name: string; type: string; tasks?: unknown }[] } },
    name: string,
  ): [string, string][] {
    const fixture = task.suite?.tasks.find((t) => t.name === name) as
      { type: string; tasks: { name: string; mode: string }[] } | undefined;
    const tests = fixture?.type === "suite" ? fixture.tasks : [];
    return tests.map((t) => [t.name.replace(/^.*every\//, ""), t.mode]);
  }

  it("ran and type-checked each sample, listing the no-run and no-typecheck ones with their reasons", ({
    task,
  }) => {
    expect((globalThis as { __everySampleRan?: boolean }).__everySampleRan).toBe(true);
    expect(registered(task, "fixture every-sample agreement")).toEqual([
      ["guides/api/page.md:3", "run"],
      ["intro.md:3", "run"],
      ["intro.md:7", "run"],
      ["intro.md:11", "run"],
      ["intro.md:14 (not run: starts a listener that never closes)", "skip"],
      ["intro.md:17", "run"],
      ["intro.md:25 (not type-checked: shows a value the types refuse)", "run"],
      ["carries at least one runnable snippet", "run"],
    ]);
  });

  it("walks the generated folder when asked to", ({ task }) => {
    expect(registered(task, "fixture generated pages, included")).toEqual([
      ["api/deep/page.md:3", "run"],
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
      // Without every, a tsx sample runs as a .ts module, as it always has: an angle-bracket cast,
      // which a .tsx module refuses, still runs.
      `${fence}tsx runnable`,
      "const raw: unknown = 2;",
      "const cast = <number>raw;",
      "cast; // => 2",
      fence,
      // Without every, nothing is type-checked: this runs, as it always has.
      `${fence}ts runnable`,
      'const loose: number = "1";',
      'loose; // => "1"',
      fence,
    ].join("\n"),
  );
  // Without every, a runnable block on a generated page still runs, as it always has.
  mkdirSync(join(dir, "api"), { recursive: true });
  writeFileSync(
    join(dir, "api", "README.md"),
    ["# Reference", `${fence}ts runnable`, "const fromApi = 1;", "fromApi; // => 1", fence].join(
      "\n",
    ),
  );

  docSnippetSuite({ docsDir: dir, tmpDir: TMP, name: "fixture runnable-only agreement" });

  // With neither a folder nor files there is nothing to run, in either mode.
  docSnippetSuite({ tmpDir: TMP, name: "fixture with no docs", every: true });

  it("registers only the placeholder test when it is given no docs", ({ task }) => {
    const fixture = task.suite?.tasks.find((t) => t.name === "fixture with no docs");
    const tests = fixture?.type === "suite" ? fixture.tasks : [];
    expect(tests.map((t) => t.name)).toEqual(["no runnable snippets to check"]);
  });

  it("ran the runnable blocks, the generated page's among them, without type-checking", ({
    task,
  }) => {
    const fixture = task.suite?.tasks.find((t) => t.name === "fixture runnable-only agreement");
    const tests = fixture?.type === "suite" ? fixture.tasks : [];
    expect(tests.map((t) => t.name.replace(/^.*runnable-only\//, ""))).toEqual([
      "api/README.md:3",
      "page.md:6",
      "page.md:10",
      "page.md:15",
    ]);
  });
});

describe("a sample with a type error fails the suite", () => {
  // In a separate Vitest run, as below, since the failing tests would red this suite. The fixture
  // has no tsconfig.json, so the samples are checked under the runner's own strict options.
  it("reds a real Vitest run, naming the sample, the line and the error", () => {
    const root = join(TMP, "type-error");
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(
      join(root, "docs", "page.md"),
      [
        "# Page",
        `${fence}ts`,
        "const ok = 1;",
        'const wrong: number = "runs, but the types refuse it";',
        fence,
        `${fence}ts no-typecheck`,
        "1;",
        fence,
        `${fence}ts`,
        "2; // => 2",
        fence,
      ].join("\n"),
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
      "the sample does not type-check against the package's types:\n" +
        "  line 4: TS2322: Type 'string' is not assignable to type 'number'.",
    );
    expect(out).toContain(
      "docs/page.md:7: a no-typecheck sample names its reason after no-typecheck, as in: " +
        "ts no-typecheck <why>",
    );
    expect(out).toMatch(/2 failed \| 1 passed/);
  }, 120_000);
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
