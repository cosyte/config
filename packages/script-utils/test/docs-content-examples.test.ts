/**
 * The example pages of the docs-content check: every runnable example under examples/ has a page,
 * docs-content/example-<name>.md, listed under the Examples category, that states what the example
 * shows, how to run it and its expected output, and ends with the example's code, written from the
 * file by `cosyte-docs-content --write` and never by hand. Every rule is shown red on a tree that
 * breaks it and green on one that keeps it, and the command line is graded on its exit codes.
 *
 * Every page and example here is synthetic.
 */

import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CATEGORIES,
  checkDocsContent,
  CODE_HEADING,
  DOCS_CONTENT_RATCHET,
  DOCS_CONTENT_RULES,
  EXAMPLE_HEADINGS,
  EXAMPLE_PAGE_PREFIX,
  EXAMPLE_RULES,
  EXAMPLES_CATEGORY,
  EXAMPLES_DIR,
  exampleCodeSection,
  exampleLanguage,
  exampleStem,
  isExampleFile,
  LIMITATIONS_PAGE,
  NUMBERS_HEADING,
  NUMBERS_PLACEHOLDER,
  RATCHETED_RULES,
  readDocsContent,
  runDocsContentCheck,
  writeExamplePages,
} from "../docs-content.js";

type Page = { name: string; text: string };
type Example = { file: string; text: string };
type Finding = { file: string; line: number; rule: string; message: string };

/** A page with front matter. */
function page(name: string, title: string, body = "Text.\n"): Page {
  return {
    name,
    text:
      `---\nid: ${name}\ntitle: ${title}\nsidebar_label: ${name}\n` +
      `description: "A page about ${name}."\n---\n\n${body}`,
  };
}

/** The pages every tree here has, which keep every other rule of the standard. */
function basePages(): Page[] {
  return [
    page("intro", "An example library"),
    page("installation", "Install it"),
    page("quickstart", "Quickstart"),
    page("read-a-field", "Read a field"),
    page("the-model", "The model"),
    page(LIMITATIONS_PAGE, "Known limitations"),
    page("troubleshooting", "Troubleshooting"),
    page(
      "testing-and-quality",
      "Testing and quality",
      `${NUMBERS_HEADING}\n\n${NUMBERS_PLACEHOLDER}\n`,
    ),
    page("performance", "Performance", `${NUMBERS_HEADING}\n\n${NUMBERS_PLACEHOLDER}\n`),
  ];
}

/** A synthetic example script. */
const READ_NAME: Example = {
  file: "read-name.ts",
  text:
    'import { parse } from "@cosyte/example";\n\n' +
    'const message = parse("PID|1||MRN-0000^^^SAMPLE||Example^Jane");\n' +
    "console.log(`Patient: ${message.patient.name}`);\n",
};

/** The hand-written part of an example page, down to its Code section. */
function written(stem: string, output = "Patient: Jane Example"): string {
  return (
    `---\nid: example-${stem}\ntitle: Example ${stem.replaceAll("-", " ")}\n` +
    `sidebar_label: ${stem}\ndescription: "What examples/${stem} shows."\n---\n\n` +
    `# ${stem}\n\n## What it shows\n\nIt reads a name.\n\n## Run it\n\n` +
    "```bash\npnpm tsx examples/" +
    `${stem}.ts\n` +
    "```\n\n## Expected output\n\n```text\n" +
    `${output}\n` +
    "```\n"
  );
}

/** A whole example page, its Code section generated from the example. */
function examplePage(example: Example, hand = written(exampleStem(example.file))): Page {
  return {
    name: `example-${exampleStem(example.file)}`,
    text: `${hand}\n${exampleCodeSection(example.file, example.text)}`,
  };
}

/** The sidebar, with the Examples category when it has items. */
function sidebar(examples: string[], options: { label?: string } = {}): string {
  return JSON.stringify({
    docs: [
      "intro",
      { type: "category", label: "Installation", items: ["installation"] },
      { type: "category", label: "Quickstart", items: ["quickstart"] },
      { type: "category", label: "How-to guides", items: ["read-a-field"] },
      ...(examples.length === 0
        ? []
        : [{ type: "category", label: options.label ?? "Examples", items: examples }]),
      { type: "category", label: "Explanation", items: ["the-model"] },
      { type: "category", label: "Reference", items: [LIMITATIONS_PAGE] },
      { type: "category", label: "Troubleshooting", items: ["troubleshooting"] },
      "testing-and-quality",
      "performance",
    ],
  });
}

/** Every finding of a tree, as `file:line [rule] message`. */
function lines(findings: Finding[]): string[] {
  return findings.map((f) => `${f.file}:${f.line} [${f.rule}] ${f.message}`);
}

/** The findings of a tree with these example pages and examples. */
function check(pages: Page[], examples: Example[], listed?: string[]): string[] {
  return lines(
    checkDocsContent({
      pages: [...basePages(), ...pages],
      sidebars: sidebar(listed ?? pages.map((p) => p.name)),
      misplaced: [],
      examples,
    }),
  );
}

describe("the constants", () => {
  it("names the folder, the category, the page prefix, the headings and the two rules", () => {
    expect(EXAMPLES_DIR).toBe("examples");
    expect(EXAMPLES_CATEGORY).toBe("Examples");
    expect(EXAMPLE_PAGE_PREFIX).toBe("example-");
    expect(EXAMPLE_HEADINGS).toEqual(["What it shows", "Run it", "Expected output", "Code"]);
    expect(CODE_HEADING).toBe("## Code");
    expect(EXAMPLE_RULES).toEqual(["example-page", "example-code"]);
    expect(DOCS_CONTENT_RULES).toMatchObject({
      "example-page":
        "every runnable example in examples/ has a page, example-<name>, listed under Examples, " +
        "with the headings What it shows, Run it, Expected output (holding a fenced block) and Code",
      "example-code":
        "an example page's Code section is the example's file, written by cosyte-docs-content --write",
    });
    for (const rule of EXAMPLE_RULES) expect(RATCHETED_RULES).toContain(rule);
  });

  it("puts Examples after How-to guides, and no library has to have it", () => {
    const labels = CATEGORIES.map((c) => c.label);
    expect(labels.indexOf("Examples")).toBe(labels.indexOf("How-to guides") + 1);
    expect(CATEGORIES.find((c) => c.label === "Examples")).toEqual({
      label: "Examples",
      required: false,
      first: null,
    });
  });
});

describe("which files are examples", () => {
  it.each(["read-name.ts", "read-name.mts", "read-name.js", "read-name.mjs", "a.ts"])(
    "%s is a runnable example",
    (name) => {
      expect(isExampleFile(name)).toBe(true);
    },
  );

  it.each([
    "_cosyte.ts",
    ".hidden.ts",
    "eslint.config.js",
    "vitest.config.ts",
    "types.d.ts",
    "types.d.mts",
    "read-name.test.ts",
    "read-name.spec.mjs",
    "README.md",
    "tsconfig.json",
    "fixture.hl7",
    "read-name.tsx",
    "read-name.cjs",
    "ts",
  ])("%s is not", (name) => {
    expect(isExampleFile(name)).toBe(false);
  });

  it("names a page after the file's name without its extension, and a fence after its language", () => {
    expect(exampleStem("read-name.ts")).toBe("read-name");
    expect(exampleStem("read-name.mjs")).toBe("read-name");
    expect(exampleStem("v1.2-upgrade.js")).toBe("v1.2-upgrade");
    expect(exampleStem("noextension")).toBe("noextension");
    expect(exampleStem(".hidden")).toBe(".hidden");
    expect(exampleLanguage("a.ts")).toBe("ts");
    expect(exampleLanguage("a.mts")).toBe("ts");
    expect(exampleLanguage("a.js")).toBe("js");
    expect(exampleLanguage("a.mjs")).toBe("js");
    expect(exampleLanguage("a.cjs")).toBe("js");
  });
});

describe("the generated Code section", () => {
  it("is the whole file in a fence titled with its path, marked no-run with its reason", () => {
    expect(exampleCodeSection("read-name.ts", "const a = 1;\nconsole.log(a);\n\n\n")).toBe(
      "## Code\n\n" +
        "The whole of `examples/read-name.ts`, included from the file: `cosyte-docs-content " +
        "--write` writes this section, and the check fails when it differs from the file, so it " +
        "is never edited by hand.\n\n" +
        '```ts title="examples/read-name.ts" no-run the example file itself, which the library ' +
        "runs from examples/\n" +
        "const a = 1;\nconsole.log(a);\n" +
        "```\n",
    );
  });

  it("takes a fence longer than any backtick run in the file, and reads CRLF as LF", () => {
    const section = exampleCodeSection("b.mjs", "const s = `x`;\r\n// ````\r\n");
    expect(section).toContain('\n`````js title="examples/b.mjs" no-run ');
    expect(section).toContain("\nconst s = `x`;\n// ````\n`````\n");
    expect(section).not.toContain("\r");
  });
});

describe("the example rules", () => {
  it("passes a tree whose every example has its page, listed under Examples", () => {
    expect(check([examplePage(READ_NAME)], [READ_NAME])).toEqual([]);
  });

  it("passes a tree with no examples and no Examples category", () => {
    expect(check([], [])).toEqual([]);
  });

  it("passes a tree read before examples were read (no examples key)", () => {
    const findings = checkDocsContent({ pages: basePages(), sidebars: sidebar([]) });
    expect(findings).toEqual([]);
  });

  it("fails an example with no page, and says what to write", () => {
    expect(check([], [READ_NAME])).toEqual([
      "example-read-name.md:0 [example-page] examples/read-name.ts has no page: write " +
        "docs-content/example-read-name.md with the headings What it shows, Run it, Expected " +
        "output and Code, list it under Examples in sidebars.json, and run cosyte-docs-content " +
        "--write to fill in its Code section",
    ]);
  });

  it("fails a page whose example is gone", () => {
    const gone = examplePage(READ_NAME);
    expect(check([gone], [])).toEqual([
      "example-read-name.md:0 [example-page] there is no example for this page: no " +
        "examples/read-name.ts, .mts, .js or .mjs",
    ]);
  });

  it("fails a Code section that differs from the file", () => {
    const stale = examplePage({ ...READ_NAME, text: `${READ_NAME.text}console.log("more");\n` });
    expect(check([stale], [READ_NAME])).toEqual([
      "example-read-name.md:26 [example-code] the Code section differs from examples/read-name.ts: " +
        "run cosyte-docs-content --write and commit what it writes",
    ]);
  });

  it("fails a Code section edited by hand, even by one character", () => {
    const good = examplePage(READ_NAME);
    const edited = { ...good, text: good.text.replace("Example^Jane", "Example^Jana") };
    expect(check([edited], [READ_NAME])).toHaveLength(1);
    expect(check([edited], [READ_NAME])[0]).toContain("[example-code]");
  });

  it("fails text added after the Code section", () => {
    const good = examplePage(READ_NAME);
    const added = { ...good, text: `${good.text}\nMore prose.\n` };
    expect(check([added], [READ_NAME])[0]).toContain("[example-code]");
  });

  it("reads a page saved with CRLF line endings as the same page", () => {
    const good = examplePage(READ_NAME);
    const crlf = { ...good, text: good.text.replaceAll("\n", "\r\n") };
    expect(check([crlf], [READ_NAME])).toEqual([]);
  });

  it("fails a page with no Code section at all", () => {
    const bare = { name: "example-read-name", text: written("read-name") };
    expect(check([bare], [READ_NAME])).toEqual([
      'example-read-name.md:0 [example-page] the page has no "## Code" heading: an example page ' +
        "has the headings What it shows, Run it, Expected output and Code, in that order",
    ]);
  });

  it.each(EXAMPLE_HEADINGS.slice(0, 3))("fails a page with no '%s' heading", (heading) => {
    const hand = written("read-name").replace(`## ${heading}\n`, "## Something else\n");
    const findings = check([examplePage(READ_NAME, hand)], [READ_NAME]);
    expect(findings).toContain(
      `example-read-name.md:0 [example-page] the page has no "## ${heading}" heading: an example ` +
        "page has the headings What it shows, Run it, Expected output and Code, in that order",
    );
  });

  it("fails headings out of order", () => {
    const hand = written("read-name")
      .replace("## What it shows\n", "## TEMP\n")
      .replace("## Run it\n", "## What it shows\n")
      .replace("## TEMP\n", "## Run it\n");
    expect(check([examplePage(READ_NAME, hand)], [READ_NAME])).toEqual([
      'example-read-name.md:10 [example-page] the heading "Run it" is out of order: an ' +
        "example page has the headings What it shows, Run it, Expected output and Code, in that order",
    ]);
  });

  it("does not read a heading inside a fence, or at level three, as one of the four", () => {
    const hand = written("read-name").replace(
      "## What it shows\n",
      "```md\n## What it shows\n```\n\n### What it shows\n",
    );
    expect(check([examplePage(READ_NAME, hand)], [READ_NAME])[0]).toContain(
      'the page has no "## What it shows" heading',
    );
  });

  it("fails an Expected output section with no fenced block", () => {
    const hand = written("read-name").replace(
      "## Expected output\n\n```text\nPatient: Jane Example\n```\n",
      "## Expected output\n\nIt prints the name.\n",
    );
    expect(check([examplePage(READ_NAME, hand)], [READ_NAME])).toEqual([
      "example-read-name.md:20 [example-page] the Expected output section holds no fenced block: " +
        "put what the example prints in one, as it prints it",
    ]);
  });

  it("does not take a fence in a later section for the Expected output's own", () => {
    const hand = written("read-name").replace(
      "## Expected output\n\n```text\nPatient: Jane Example\n```\n",
      "## Expected output\n\nIt prints the name.\n\n## Notes\n\n```text\nPatient: Jane Example\n```\n",
    );
    expect(check([examplePage(READ_NAME, hand)], [READ_NAME])[0]).toContain(
      "the Expected output section holds no fenced block",
    );
  });

  it("fails an example page listed outside Examples", () => {
    const good = examplePage(READ_NAME);
    const findings = lines(
      checkDocsContent({
        pages: [...basePages(), good],
        sidebars: JSON.stringify({
          docs: [
            "intro",
            { type: "category", label: "Installation", items: ["installation"] },
            { type: "category", label: "Quickstart", items: ["quickstart"] },
            { type: "category", label: "How-to guides", items: ["read-a-field", good.name] },
            { type: "category", label: "Explanation", items: ["the-model"] },
            { type: "category", label: "Reference", items: [LIMITATIONS_PAGE] },
            { type: "category", label: "Troubleshooting", items: ["troubleshooting"] },
            "testing-and-quality",
            "performance",
          ],
        }),
        examples: [READ_NAME],
      }).filter((f) => f.rule.startsWith("example-")),
    );
    expect(findings).toEqual([
      'example-read-name.md:0 [example-page] the page is listed in "How-to guides": an example ' +
        "page is listed under Examples",
    ]);
  });

  it("fails a page under Examples that is not an example page", () => {
    expect(
      check([examplePage(READ_NAME)], [READ_NAME], ["example-read-name", "the-model"]).filter((l) =>
        l.includes("[example-page]"),
      ),
    ).toEqual([
      "the-model.md:0 [example-page] the Examples category holds only example pages, " +
        "example-<name>, one for each example in examples/",
    ]);
  });

  it("fails an example whose name cannot be a page name, and two examples with one name", () => {
    const camel = { file: "readName.ts", text: "console.log(1);\n" };
    const twin = { ...READ_NAME, file: "read-name.mjs" };
    expect(check([examplePage(READ_NAME)], [READ_NAME, twin, camel])).toEqual([
      "example-readName.md:0 [example-page] examples/readName.ts: an example's name is lower-case " +
        "words joined by single hyphens, since its page is example-<name>.md: rename the file",
      "example-read-name.md:0 [example-page] examples/read-name.mjs and examples/read-name.ts " +
        "would share the page example-read-name.md: rename one",
    ]);
  });

  it("checks the Examples category's place among the others", () => {
    const findings = lines(
      checkDocsContent({
        pages: [...basePages(), examplePage(READ_NAME)],
        sidebars: JSON.stringify({
          docs: [
            "intro",
            { type: "category", label: "Installation", items: ["installation"] },
            { type: "category", label: "Quickstart", items: ["quickstart"] },
            { type: "category", label: "How-to guides", items: ["read-a-field"] },
            { type: "category", label: "Explanation", items: ["the-model"] },
            { type: "category", label: "Examples", items: ["example-read-name"] },
            { type: "category", label: "Reference", items: [LIMITATIONS_PAGE] },
            { type: "category", label: "Troubleshooting", items: ["troubleshooting"] },
            "testing-and-quality",
            "performance",
          ],
        }),
        examples: [READ_NAME],
      }).filter((f) => f.rule === "sidebar"),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('"Examples" is out of order');
  });
});

describe("reading and writing a repository", () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "docs-content-examples-"));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** A repository with these files, by path from its root, in a fresh folder. */
  function repo(name: string, files: Record<string, string>): string {
    const dir = join(root, name);
    for (const page of basePages()) files[`docs-content/${page.name}.md`] ??= page.text;
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    return dir;
  }

  function capture(): {
    out: string;
    err: string;
    stdout: { write(t: string): void };
    stderr: { write(t: string): void };
  } {
    const sink = {
      out: "",
      err: "",
      stdout: { write: (t: string) => void (sink.out += t) },
      stderr: { write: (t: string) => void (sink.err += t) },
    };
    return sink;
  }

  it("reads the top level of examples/, runnable examples only, in name order", () => {
    const dir = repo("read", {
      "docs-content/sidebars.json": sidebar([]),
      "examples/b-second.mjs": "b\n",
      "examples/a-first.ts": "a\n",
      "examples/_helper.ts": "h\n",
      "examples/eslint.config.js": "e\n",
      "examples/README.md": "# Examples\n",
      "examples/data/fixture.ts": "f\n",
    });
    expect(readDocsContent(dir).examples).toEqual([
      { file: "a-first.ts", text: "a\n" },
      { file: "b-second.mjs", text: "b\n" },
    ]);
  });

  it("reads no examples from a repository without examples/", () => {
    const dir = repo("none", { "docs-content/sidebars.json": sidebar([]) });
    expect(readDocsContent(dir).examples).toEqual([]);
  });

  it("refuses an examples/ that is not a directory, and an example that is not a regular file", () => {
    const file = repo("flat", { "docs-content/sidebars.json": sidebar([]), examples: "x\n" });
    expect(() => readDocsContent(file)).toThrow(/examples is not a directory/);
    const linked = repo("linked", {
      "docs-content/sidebars.json": sidebar([]),
      "elsewhere.ts": "x\n",
    });
    mkdirSync(join(linked, "examples"));
    symlinkSync(join(linked, "elsewhere.ts"), join(linked, "examples", "read-name.ts"));
    expect(() => readDocsContent(linked)).toThrow(/is not a regular file/);
    const out = capture();
    expect(runDocsContentCheck({ dir: linked, stdout: out.stdout, stderr: out.stderr })).toBe(2);
    expect(out.err).toContain("Nothing was checked.");
  });

  it("exits 1 on an example with no page, and 0 once the page is written and filled in", () => {
    const dir = repo("cli", {
      "docs-content/sidebars.json": sidebar(["example-read-name"]),
      "examples/read-name.ts": READ_NAME.text,
    });
    const first = capture();
    expect(runDocsContentCheck({ dir, stdout: first.stdout, stderr: first.stderr })).toBe(1);
    expect(first.err).toContain("[example-page] examples/read-name.ts has no page");

    writeFileSync(join(dir, "docs-content/example-read-name.md"), written("read-name"));
    const unfilled = capture();
    expect(runDocsContentCheck({ dir, stdout: unfilled.stdout, stderr: unfilled.stderr })).toBe(1);
    expect(unfilled.err).toContain('the page has no "## Code" heading');

    const filled = capture();
    expect(
      runDocsContentCheck({ dir, argv: ["--write"], stdout: filled.stdout, stderr: filled.stderr }),
    ).toBe(0);
    expect(filled.out).toContain("docs-content: wrote docs-content/example-read-name.md");
    expect(readFileSync(join(dir, "docs-content/example-read-name.md"), "utf8")).toBe(
      examplePage(READ_NAME).text,
    );

    writeFileSync(join(dir, "examples/read-name.ts"), `${READ_NAME.text}console.log(2);\n`);
    const stale = capture();
    expect(runDocsContentCheck({ dir, stdout: stale.stdout, stderr: stale.stderr })).toBe(1);
    expect(stale.err).toContain(
      "[example-code] the Code section differs from examples/read-name.ts",
    );

    const again = capture();
    expect(
      runDocsContentCheck({ dir, argv: ["--write"], stdout: again.stdout, stderr: again.stderr }),
    ).toBe(0);
    const quiet = capture();
    expect(
      runDocsContentCheck({ dir, argv: ["--write"], stdout: quiet.stdout, stderr: quiet.stderr }),
    ).toBe(0);
    expect(quiet.out).not.toContain("wrote");
  });

  it("writes only the Code section, keeps the hand-written part, and writes no missing page", () => {
    const hand = written("read-name");
    const dir = repo("write", {
      "docs-content/sidebars.json": sidebar(["example-read-name"]),
      "docs-content/example-read-name.md": `${hand}\n## Code\n\nOld text typed by hand.\n`,
      "examples/read-name.ts": READ_NAME.text,
      "examples/write-name.ts": "console.log(3);\n",
      "examples/badName.ts": "console.log(4);\n",
    });
    expect(writeExamplePages(dir)).toEqual(["example-read-name.md"]);
    expect(readFileSync(join(dir, "docs-content/example-read-name.md"), "utf8")).toBe(
      `${hand}\n${exampleCodeSection("read-name.ts", READ_NAME.text)}`,
    );
    expect(() => readFileSync(join(dir, "docs-content/example-write-name.md"))).toThrow();
    expect(() => readFileSync(join(dir, "docs-content/example-badName.md"))).toThrow();
    expect(writeExamplePages(dir)).toEqual([]);
  });

  it("refuses to write when it cannot read, and says nothing was checked", () => {
    const dir = repo("refuse", {
      "docs-content/sidebars.json": sidebar([]),
      examples: "not a folder\n",
    });
    expect(() => writeExamplePages(dir)).toThrow(/examples is not a directory/);
    const out = capture();
    expect(
      runDocsContentCheck({ dir, argv: ["--write"], stdout: out.stdout, stderr: out.stderr }),
    ).toBe(2);
    expect(out.err).toContain("Nothing was checked.");
  });

  it("refuses to write without docs-content/", () => {
    const dir = join(root, "no-docs");
    mkdirSync(join(dir, "examples"), { recursive: true });
    expect(() => writeExamplePages(dir)).toThrow(/docs-content is not a directory/);
  });

  it.skipIf(process.getuid?.() === 0)("refuses a page it cannot write", () => {
    const dir = repo("read-only", {
      "docs-content/sidebars.json": sidebar(["example-read-name"]),
      "docs-content/example-read-name.md": written("read-name"),
      "examples/read-name.ts": READ_NAME.text,
    });
    const target = join(dir, "docs-content/example-read-name.md");
    chmodSync(target, 0o444);
    try {
      expect(() => writeExamplePages(dir)).toThrow(/example-read-name\.md could not be written/);
    } finally {
      chmodSync(target, 0o644);
    }
  });

  it("refuses a page that is a folder, and writes through no link where the platform refuses one", () => {
    const dir = repo("folder-page", {
      "docs-content/sidebars.json": sidebar(["example-read-name"]),
      "docs-content/example-read-name.md/inside.txt": "x\n",
      "examples/read-name.ts": READ_NAME.text,
    });
    expect(() => writeExamplePages(dir)).toThrow(/example-read-name\.md could not be written/);
    if (process.platform === "win32") return;
    const linked = repo("linked-page", {
      "docs-content/sidebars.json": sidebar(["example-read-name"]),
      "elsewhere.md": written("read-name"),
      "examples/read-name.ts": READ_NAME.text,
    });
    symlinkSync(join(linked, "elsewhere.md"), join(linked, "docs-content/example-read-name.md"));
    expect(() => writeExamplePages(linked)).toThrow(/example-read-name\.md could not be written/);
    expect(readFileSync(join(linked, "elsewhere.md"), "utf8")).toBe(written("read-name"));
  });

  /** Examples with no page, `count` of them, each a synthetic script. */
  function unpaged(count: number): Record<string, string> {
    const files: Record<string, string> = {};
    for (let i = 1; i <= count; i += 1) files[`examples/read-name-${i}.ts`] = READ_NAME.text;
    return files;
  }

  /** A library named `name` whose examples have no pages, checked against `ratchet`. */
  function ratcheted(
    label: string,
    name: string,
    files: Record<string, string>,
    ratchet?: Record<string, Record<string, number>>,
  ) {
    const dir = repo(label, {
      "package.json": JSON.stringify({ name }),
      "docs-content/sidebars.json": sidebar([]),
      ...files,
    });
    const out = capture();
    const code = runDocsContentCheck({
      dir,
      stdout: out.stdout,
      stderr: out.stderr,
      ...(ratchet === undefined ? {} : { ratchet }),
    });
    return { code, out: out.out, err: out.err };
  }

  it("holds a library's examples with no page at its recorded count, and fails one over it", () => {
    const ratchet = { "@cosyte/example": { "example-page": 2 } };
    const at = ratcheted("at-count", "@cosyte/example", unpaged(2), ratchet);
    expect(at.code).toBe(0);
    expect(at.out).toContain("docs-content: 2 finding(s) held by the ratchet for @cosyte/example");
    expect(at.out).toContain("[example-page] examples/read-name-1.ts has no page");
    const under = ratcheted("under-count", "@cosyte/example", unpaged(1), ratchet);
    expect(under.code).toBe(0);
    expect(under.out).toContain("[example-page] is down to 1 from the 2 recorded");
    const over = ratcheted("over-count", "@cosyte/example", unpaged(3), ratchet);
    expect(over.code).toBe(1);
    expect(over.err).toContain("[example-page] examples/read-name-3.ts has no page");
    expect(over.err).toContain(
      "docs-content: [example-page] has 3 finding(s), over the 2 recorded for @cosyte/example, so each one fails.",
    );
    const unnamed = ratcheted("not-recorded", "@cosyte/other", unpaged(1), ratchet);
    expect(unnamed.code).toBe(1);
  });

  it("holds no Code section that differs from its file, at a count of none", () => {
    const stale = {
      "examples/read-name.ts": READ_NAME.text,
      "docs-content/example-read-name.md": `${written("read-name")}\n## Code\n\nTyped by hand.\n`,
      "docs-content/sidebars.json": sidebar(["example-read-name"]),
    };
    const dir = repo("stale-code", {
      "package.json": JSON.stringify({ name: "@cosyte/example" }),
      ...stale,
    });
    const out = capture();
    const ratchet = { "@cosyte/example": { "example-page": 4 } };
    expect(runDocsContentCheck({ dir, stdout: out.stdout, stderr: out.stderr, ratchet })).toBe(1);
    expect(out.err).toContain("[example-code] the Code section differs from examples/read-name.ts");
    const held = capture();
    const allowed = { "@cosyte/example": { "example-code": 1 } };
    expect(
      runDocsContentCheck({ dir, stdout: held.stdout, stderr: held.stderr, ratchet: allowed }),
    ).toBe(0);
  });

  it("holds each library the shipped ratchet records to its count of examples with no page", () => {
    const recorded = Object.entries(DOCS_CONTENT_RATCHET).filter(([, counts]) =>
      Object.hasOwn(counts, "example-page"),
    );
    expect(recorded.length).toBeGreaterThan(0);
    for (const [library, counts] of recorded) {
      const count = (counts as Record<string, number>)["example-page"] ?? 0;
      const slug = library.replace("@cosyte/", "");
      expect(ratcheted(`shipped-${slug}`, library, unpaged(count)).code).toBe(0);
      const over = ratcheted(`shipped-over-${slug}`, library, unpaged(count + 1));
      expect(over.code).toBe(1);
      expect(over.err).toContain(`[example-page] has ${count + 1} finding(s), over the ${count}`);
    }
  });

  it("names --write among the arguments it accepts", () => {
    const out = capture();
    expect(
      runDocsContentCheck({ dir: root, argv: ["--wrong"], stdout: out.stdout, stderr: out.stderr }),
    ).toBe(2);
    expect(out.err).toContain("(only --dir <repository root> and --write)");
  });
});
