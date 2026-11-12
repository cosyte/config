/**
 * The edges of the docs-content check that the other suites left unpinned, each one a behavior a
 * mutation run showed no test held: how a heading, a table, a step, a title and a measured number
 * are read, how an example page is rewritten, and how the command line reports two rules over their
 * counts. Each case names the input and what the check does with it.
 *
 * Every page and example here is synthetic.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  checkDocsContent,
  docsContentWarnings,
  exampleCodeSection,
  isExampleFile,
  LIMITATIONS_PAGE,
  NUMBERS_HEADING,
  NUMBERS_PLACEHOLDER,
  pageKinds,
  runDocsContentCheck,
  writeExamplePages,
} from "../docs-content.js";

type Page = { name: string; text: string };
type Finding = { file: string; line: number; rule: string; message: string };

/** A page with front matter; with no `extra`, the body starts on line 8. */
function page(name: string, title: string, body = "Text.\n", extra = ""): Page {
  return {
    name,
    text:
      `---\nid: ${name}\ntitle: ${title}\nsidebar_label: ${name}\n` +
      `description: "A page about ${name}."\n${extra}---\n\n${body}`,
  };
}

/** The pages every tree here has, which keep every rule of the standard. */
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

/** The sidebar of a tree with these extra pages, each under the category given. */
function sidebar(extra: { kind: string; page: Page }[], examples: string[] = []): string {
  const by = (kind: string): string[] =>
    extra.filter((e) => e.kind === kind).map((e) => e.page.name);
  const category = (label: string, items: string[]) =>
    items.length === 0 ? [] : [{ type: "category", label, items }];
  return JSON.stringify({
    docs: [
      "intro",
      { type: "category", label: "Installation", items: ["installation"] },
      { type: "category", label: "Quickstart", items: ["quickstart"] },
      ...category("Tutorials", by("Tutorials")),
      { type: "category", label: "How-to guides", items: ["read-a-field", ...by("How-to guides")] },
      ...category("Examples", examples),
      { type: "category", label: "Explanation", items: ["the-model", ...by("Explanation")] },
      { type: "category", label: "Reference", items: [LIMITATIONS_PAGE, ...by("Reference")] },
      { type: "category", label: "Troubleshooting", items: ["troubleshooting"] },
      "testing-and-quality",
      "performance",
    ],
  });
}

/** The findings of one rule for a tree with these extra pages, as `file:line [rule] message`. */
function found(rule: string, extra: { kind: string; page: Page }[]): string[] {
  return checkDocsContent({
    pages: [...basePages(), ...extra.map((e) => e.page)],
    sidebars: sidebar(extra),
    misplaced: [],
  })
    .filter((f: Finding) => f.rule === rule)
    .map((f: Finding) => `${f.file}:${f.line} [${f.rule}] ${f.message}`);
}

/** The findings of the explanation rule for one explanation page with this body. */
const explained = (body: string) =>
  found("explanation-content", [
    { kind: "Explanation", page: page("the-design", "The design", body) },
  ]);

const SETTINGS =
  "a settings table (Key or Option, with a Default column) belongs in a reference: move it and link it";
const STEP = (text: string) =>
  `the heading "${text}" is numbered, which reads as a step: steps go in a how-to guide or a tutorial`;

describe("pageKinds", () => {
  it("reads only a category's items, never the items of another kind of entry", () => {
    const kinds = pageKinds({
      docs: [
        {
          type: "category",
          label: "Reference",
          items: [
            "listed",
            { type: "link", label: "Out", href: "https://example.com", items: ["hidden"] },
          ],
        },
      ],
    });
    expect([...kinds]).toEqual([["listed", "Reference"]]);
  });
});

describe("headings, as the rules read them", () => {
  it("reads a heading indented by up to three spaces at the level of its # run", () => {
    expect(explained(" ## 1. Read the input\n")).toEqual([
      `the-design.md:8 [explanation-content] ${STEP("1. Read the input")}`,
    ]);
  });

  it("trims the text a code span leaves at the start of a heading", () => {
    const guide = page("fix-a-field", "Fix a field", "## ` `Why it fails\n");
    expect(found("howto-steps", [{ kind: "How-to guides", page: guide }])).toEqual([
      'fix-a-field.md:8 [howto-steps] the heading "Why it fails" explains: move the section to an explanation and link it',
    ]);
  });
});

describe("tables, as the settings rule reads them", () => {
  it.each([
    ["the delimiter row is indented four spaces", "| Key | Default |\n    | --- | --- |\n"],
    ["the delimiter row has text after its cells", "| Key | Default |\n| --- | --- | text\n"],
    ["the row under the header is not a delimiter row", "| Key | Default |\n| a-b | c |\n"],
    ["the header row has no pipe", "Key Default\n| --- |\n"],
    [
      "fenced code sits between the header and the delimiter",
      "| Key | Default |\n```\nx\n```\n| --- | --- |\n",
    ],
    ["the first cell only ends in Key", "| Primary key | Default |\n| --- | --- |\n"],
    [
      "the first cell is a code span of a space, with no leading pipe",
      "` ` | Key | Default |\n| --- | --- | --- |\n",
    ],
    ["a link in the first cell holds a pipe", "| ](|) Key | Default |\n| --- | --- | --- |\n"],
    ["the page's last line holds a pipe", "The value a | b"],
  ])("finds no settings table when %s", (_label, body) => {
    expect(explained(body)).toEqual([]);
  });

  it.each([
    ["a delimiter row that ends in a space", "| Key | Default |\n| --- | --- | \n"],
    ["a header row indented by a space", " | Key | Default |\n| --- | --- |\n"],
    ["a first cell that a code span of a space begins", "| ` `Key | Default |\n| --- | --- |\n"],
  ])("finds a settings table in %s", (_label, body) => {
    expect(explained(body)).toEqual([`the-design.md:8 [explanation-content] ${SETTINGS}`]);
  });
});

describe("numbered steps", () => {
  it.each([["Step 10: Ten"], ["Step 1 : One"], ["Step  1: One"], ["10. Ten"], ["1.  Two spaces"]])(
    "reads %j as a step",
    (text) => {
      expect(explained(`## ${text}\n`)).toEqual([
        `the-design.md:8 [explanation-content] ${STEP(text)}`,
      ]);
    },
  );

  it("reads a step only at the start of a heading", () => {
    expect(explained("## Run step 1: now\n")).toEqual([]);
  });
});

describe("the limitations heading", () => {
  it("is a heading that begins Limitations or Known limitations, not one that ends with it", () => {
    const other = page("the-scope", "The scope", "## Scope and limitations\n");
    expect(found("limitations", [{ kind: "Explanation", page: other }])).toEqual([]);
  });
});

describe("page ids and titles", () => {
  const ids = (name: string, title: string) =>
    found("page-id", [{ kind: "Explanation", page: page(name, title) }]);
  const shares = (name: string, title: string) =>
    `${name}.md:3 [page-id] the id "${name}" shares no content word with the title "${title}"`;

  it("does not read a title that is only blank", () => {
    expect(ids("anything", '" "')).toEqual([]);
  });

  it("needs one content word of the id in the title, not every one", () => {
    expect(ids("read-fields", "Read the logs")).toEqual([]);
  });

  it("matches a word to a longer one that begins with it, either way round, from three letters", () => {
    expect(ids("ack", "Acks")).toEqual([]);
    expect(ids("acks", "Ack")).toEqual([]);
    expect(ids("ack", "Ac")).toEqual([shares("ack", "Ac")]);
  });

  it("matches a word shorter than three letters only to itself", () => {
    expect(ids("db", "DB")).toEqual([]);
  });

  it("leaves out the filler words from either end of the list", () => {
    expect(ids("into-it", "Into it")).toEqual([shares("into-it", "Into it")]);
    expect(ids("your-data", "Your files")).toEqual([shares("your-data", "Your files")]);
  });
});

describe("how-to guides", () => {
  const titled = (title: string) =>
    found("howto-title", [{ kind: "How-to guides", page: page("fix-the-cache", title) }]);
  const steps = (heading: string) =>
    found("howto-steps", [
      { kind: "How-to guides", page: page("fix-the-cache", "Fix the cache", `## ${heading}\n`) },
    ]);

  it("reads the first word of a title after the blanks a quoted title begins with", () => {
    expect(titled('" Set it up"')).toEqual([]);
  });

  it("drops every mark that ends the first word, and none inside it", () => {
    expect(titled("Reset... the cache")).toEqual([]);
    expect(titled("Re:set the cache")).toEqual([
      'fix-the-cache.md:3 [howto-title] the title begins "Re:set": a how-to guide\'s title begins ' +
        "with a verb in the imperative (a verb missing from IMPERATIVE_VERBS is added there)",
    ]);
  });

  it("reads How, Why and The alternatives only at the start of a heading", () => {
    expect(steps("Choose how to log")).toEqual([]);
    expect(steps("Compare the alternatives")).toEqual([]);
    expect(steps("The  alternatives")).toEqual([
      'fix-the-cache.md:8 [howto-steps] the heading "The  alternatives" explains: move the section to an explanation and link it',
    ]);
  });
});

describe("tutorials", () => {
  it("ends with both closing sections, not one of them", () => {
    const body = "## 1. Install it\n\n## What you built\n\n## Then\n";
    const tutorial = page("first-steps", "First steps", body);
    expect(found("tutorial-steps", [{ kind: "Tutorials", page: tutorial }])).toContain(
      'first-steps.md:12 [tutorial-steps] a tutorial ends with the sections "What you built" then "Next"',
    );
  });
});

describe("measured numbers", () => {
  const warned = (text: string) =>
    docsContentWarnings({ pages: [{ name: "the-speed", text }], sidebars: null }).map(
      (w) => `${w.line} ${w.message}`,
    );
  const says = (line: number, number: string) =>
    `${line} "${number}" reads as a measured number: measured numbers go in the generated "Current numbers" section`;

  it("reads the first line after the front matter, even with no blank line before it", () => {
    expect(warned("---\nid: the-speed\ntitle: The speed\n---\nIt takes 5 ms.\n")).toEqual([
      says(5, "5 ms"),
    ]);
  });

  it("reads line 1 of a page with no front matter, and never the front matter itself", () => {
    expect(warned("It takes 5 ms.\n")).toEqual([says(1, "5 ms")]);
    expect(warned('---\nid: the-speed\ndescription: "It takes 5 ms."\n---\n\nText.\n')).toEqual([]);
  });

  it("reads a sidebar that is missing as no sidebar", () => {
    const text = "It takes 5 ms.\n";
    expect(docsContentWarnings({ pages: [{ name: "the-speed", text }] } as never)).toHaveLength(1);
  });

  it("takes a Current numbers heading with blanks after it as the section", () => {
    expect(warned(`${NUMBERS_HEADING}  \n\nIt takes 5 ms.\n`)).toEqual([]);
  });

  it("reads a rate a second and a ratio with a space before the unit", () => {
    expect(warned("It is 10 x faster.\n\nIt reads 500 /s.\n")).toEqual([
      says(1, "10 x faster"),
      says(3, "500 /s"),
    ]);
  });
});

describe("examples", () => {
  it("reads a name whose .d.ts is not its extension as an example", () => {
    expect(isExampleFile("notes.d.ts.mjs")).toBe(true);
    expect(isExampleFile("README")).toBe(false);
    expect(isExampleFile("read-name.")).toBe(false);
  });

  const EXAMPLE = { file: "read-name.ts", text: 'console.log("Patient: Jane Example");\n' };
  const CODE = exampleCodeSection(EXAMPLE.file, EXAMPLE.text);

  /** The hand-written part of the page, with what the Expected output section holds. */
  const hand = (output = "```text\nPatient: Jane Example\n```\n", shows = "It reads a name.\n") =>
    "---\nid: example-read-name\ntitle: Example read name\nsidebar_label: read-name\n" +
    'description: "What examples/read-name shows."\n---\n\n# read-name\n\n' +
    `## What it shows\n\n${shows}\n## Run it\n\n` +
    "```bash\npnpm tsx examples/read-name.ts\n```\n\n" +
    `## Expected output\n\n${output}`;

  const examplePages = (text: string, listed: string[]) =>
    checkDocsContent({
      pages: [...basePages(), { name: "example-read-name", text }],
      sidebars: sidebar([], listed),
      misplaced: [],
      examples: [EXAMPLE],
    })
      .filter((f: Finding) => f.rule === "example-page")
      .map((f: Finding) => `${f.file}:${f.line} ${f.message}`);

  it("does not say where a page is listed when the sidebar does not list it", () => {
    expect(examplePages(`${hand()}\n${CODE}`, [])).toEqual([]);
  });

  it("ends the Expected output section at the next H2, which a fence may follow", () => {
    const text = `${hand("It prints a name.\n")}## Notes\n\`\`\`text\nx\n\`\`\`\n\n${CODE}`;
    expect(examplePages(text, ["example-read-name"])).toEqual([
      "example-read-name.md:20 the Expected output section holds no fenced block: put what the " +
        "example prints in one, as it prints it",
    ]);
  });

  describe("writing the Code section", () => {
    let root: string;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), "docs-content-edges-"));
    });

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    /** Write the page over a repository holding the example, and read back what was written. */
    function rewrite(name: string, text: string): string {
      const dir = join(root, name);
      const target = join(dir, "docs-content/example-read-name.md");
      mkdirSync(dirname(target), { recursive: true });
      mkdirSync(join(dir, "examples"), { recursive: true });
      writeFileSync(target, text);
      writeFileSync(join(dir, "examples/read-name.ts"), EXAMPLE.text);
      expect(writeExamplePages(dir)).toEqual(["example-read-name.md"]);
      return readFileSync(target, "utf8");
    }

    it("reads a page saved with CRLF line endings, and writes it with LF", () => {
      const text = `${hand()}\n## Code\n\nOld text.\n`.replaceAll("\n", "\r\n");
      expect(rewrite("crlf", text)).toBe(`${hand()}\n${CODE}`);
    });

    it("replaces from the H2 Code heading, not from a deeper heading of that name", () => {
      const shows = "It reads a name.\n\n### Code\n\nA note on the code.\n";
      const text = `${hand(undefined, shows)}\n## Code\n\nOld text.\n`;
      expect(rewrite("deeper", text)).toBe(`${hand(undefined, shows)}\n${CODE}`);
    });

    it("leaves one blank line before the Code section, however many there were", () => {
      expect(rewrite("blanks", `${hand()}\n\n\n\n## Code\n\nOld text.\n`)).toBe(
        `${hand()}\n${CODE}`,
      );
    });

    it("writes a page shorter than the one it replaces with nothing of the old one after it", () => {
      const text = `${hand()}\n## Code\n\n${"An old line typed by hand.\n".repeat(200)}`;
      expect(rewrite("shorter", text)).toBe(`${hand()}\n${CODE}`);
    });

    it.skipIf(!existsSync("/proc/self/fd"))("closes every file it opens", () => {
      const dir = join(root, "closes");
      mkdirSync(join(dir, "docs-content"), { recursive: true });
      mkdirSync(join(dir, "examples"), { recursive: true });
      writeFileSync(join(dir, "docs-content/example-read-name.md"), `${hand()}\n## Code\n\nOld.\n`);
      writeFileSync(join(dir, "examples/read-name.ts"), EXAMPLE.text);
      const before = readdirSync("/proc/self/fd").length;
      expect(writeExamplePages(dir)).toEqual(["example-read-name.md"]);
      expect(writeExamplePages(dir)).toEqual([]);
      expect(readdirSync("/proc/self/fd").length).toBe(before);
    });
  });
});

describe("the command line", () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "docs-content-edges-cli-"));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("puts each rule over its count on a line of its own", () => {
    const guide = page("the-thing", "The thing");
    const other = page("zebra", "Lions");
    const extra = [
      { kind: "How-to guides", page: guide },
      { kind: "Explanation", page: other },
    ];
    for (const p of [...basePages(), guide, other]) {
      mkdirSync(join(root, "docs-content"), { recursive: true });
      writeFileSync(join(root, "docs-content", `${p.name}.md`), p.text);
    }
    writeFileSync(join(root, "docs-content/sidebars.json"), sidebar(extra));
    let err = "";
    const code = runDocsContentCheck({
      dir: root,
      ratchet: {},
      stdout: { write: () => true },
      stderr: { write: (t: string) => void (err += t) },
    });
    expect(code).toBe(1);
    expect(err).toMatch(
      /\ndocs-content: \[howto-title\] has 1 finding\(s\), over the 0 recorded for this repository, so each one fails\.\ndocs-content: \[page-id\] has 1 finding\(s\), over the 0 recorded for this repository, so each one fails\.\n$/,
    );
  });
});
