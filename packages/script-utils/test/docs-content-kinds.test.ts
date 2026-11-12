/**
 * The rules of the docs-content check that read whether each page holds what its kind asks, the
 * kind being the sidebar category a page is listed in; the warning on measured numbers; and the
 * ratchet that holds each library to the findings it had when the rules landed. Every rule is shown
 * red on a page that breaks it and green on one that keeps it.
 *
 * Every page here is synthetic.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  applyDocsContentRatchet,
  checkDocsContent,
  DOCS_CONTENT_RATCHET,
  DOCS_CONTENT_RULES,
  docsContentWarnings,
  HELD_BY_KEY,
  IMPERATIVE_VERBS,
  isHeldByPath,
  KIND_PREFIXES,
  LIMITATIONS_PAGE,
  NUMBERS_HEADING,
  NUMBERS_PLACEHOLDER,
  pageKinds,
  RATCHETED_RULES,
  readDocsContent,
  runDocsContentCheck,
  TUTORIAL_ENDING,
  WARNING_RULES,
} from "../docs-content.js";

/** The repository's root, which git reads the ratchet's history from. */
const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

/** The ratchet file, by its path from the repository's root. */
const RATCHET_PATH = "packages/script-utils/docs-content-ratchet.json";

type Page = { name: string; text: string };
type Finding = { file: string; line: number; rule: string; message: string };

/** A page with front matter; the body starts on line 8. */
function page(name: string, title: string, body = "Text.\n", extra = ""): Page {
  return {
    name,
    text:
      `---\nid: ${name}\ntitle: ${title}\nsidebar_label: ${name}\n` +
      `description: "A page about ${name}."\n${extra}---\n\n${body}`,
  };
}

const QUALITY = [
  page(
    "testing-and-quality",
    "Testing and quality",
    `${NUMBERS_HEADING}\n\n${NUMBERS_PLACEHOLDER}\n`,
  ),
  page("performance", "Performance", `${NUMBERS_HEADING}\n\n${NUMBERS_PLACEHOLDER}\n`),
];

/** The fixed pages, which every tree here has. */
const FIXED = [
  page("intro", "An example library"),
  page("installation", "Install it"),
  page("quickstart", "Quickstart"),
  page("troubleshooting", "Troubleshooting"),
  ...QUALITY,
];

/**
 * A tree whose sidebar lists each extra page under the category given, beside the pages every tree
 * has: a how-to guide, an explanation and the limitations page in Reference.
 */
function tree(extra: { kind: string; page: Page }[] = [], options: { limitations?: boolean } = {}) {
  const by = (kind: string): string[] =>
    extra.filter((e) => e.kind === kind).map((e) => e.page.name);
  const category = (label: string, items: string[]) =>
    items.length === 0 ? [] : [{ type: "category", label, items }];
  const limitations = options.limitations ?? true;
  const sidebar = {
    docs: [
      "intro",
      { type: "category", label: "Installation", items: ["installation"] },
      { type: "category", label: "Quickstart", items: ["quickstart"] },
      ...category("Tutorials", by("Tutorials")),
      { type: "category", label: "How-to guides", items: ["read-a-field", ...by("How-to guides")] },
      { type: "category", label: "Explanation", items: ["the-model", ...by("Explanation")] },
      ...category("Reference", [...(limitations ? [LIMITATIONS_PAGE] : []), ...by("Reference")]),
      { type: "category", label: "Troubleshooting", items: ["troubleshooting"] },
      "testing-and-quality",
      "performance",
    ],
  };
  const pages = [
    ...FIXED,
    page("read-a-field", "Read a field"),
    page("the-model", "The model"),
    ...(limitations ? [page(LIMITATIONS_PAGE, "Known limitations")] : []),
    ...extra.map((e) => e.page),
  ];
  return { pages, sidebars: JSON.stringify(sidebar), misplaced: [] as string[] };
}

/** Every finding of a tree, as `file:line [rule] message`. */
function lines(findings: Finding[]): string[] {
  return findings.map((f) => `${f.file}:${f.line} [${f.rule}] ${f.message}`);
}

/** The findings of one rule, for a tree with these extra pages. */
function found(
  rule: string,
  extra: { kind: string; page: Page }[],
  sources?: Map<string, string>,
): string[] {
  const input = { ...tree(extra), ...(sources === undefined ? {} : { sources }) };
  return lines(checkDocsContent(input).filter((f) => f.rule === rule));
}

describe("the constants", () => {
  it("names the rules on kinds, which the ratchet holds, and the one that warns", () => {
    expect(RATCHETED_RULES).toEqual([
      "howto-title",
      "howto-steps",
      "explanation-content",
      "limitations",
      "tutorial-steps",
      "page-id",
      "reference-source",
      "example-page",
      "example-code",
    ]);
    expect(WARNING_RULES).toEqual(["measured-number"]);
    expect(DOCS_CONTENT_RULES).toMatchObject({
      "howto-title":
        "a how-to guide's title states its goal and begins with a verb in the imperative",
      "howto-steps":
        "a how-to holds steps; how and why it works goes in an explanation it links. A how-to " +
        "has no heading that begins How, Why or The alternatives",
      "explanation-content":
        "an explanation has no settings table and no steps: no table whose header starts Key or " +
        "Option with a Default column, and no numbered H2",
      limitations:
        "each library has one limitations page, id limitations, in Reference; no other page has " +
        "a heading Known limitations or Limitations",
      "tutorial-steps":
        "a tutorial's H2s are numbered steps in order and it ends with What you built and Next",
      "page-id":
        "a page id names what the page is about and shares a content word with its title; a new " +
        "id never begins guides-, concepts- or core-concepts",
      "reference-source":
        "a reference for a surface that is not TypeScript (config keys, CLI commands) is " +
        "generated from the code or a test holds every entry to it",
      "measured-number":
        "a measured number appears only in a Current numbers section, never in prose (a warning)",
    });
    expect(HELD_BY_KEY).toBe("held_by");
    expect(LIMITATIONS_PAGE).toBe("limitations");
    expect(TUTORIAL_ENDING).toEqual(["What you built", "Next"]);
    expect(KIND_PREFIXES).toEqual(["guides-", "concepts-", "core-concepts"]);
    expect(IMPERATIVE_VERBS).toEqual(
      expect.arrayContaining(["read", "de-identify", "property-test"]),
    );
    expect(IMPERATIVE_VERBS.every((verb) => /^[a-z]+(?:-[a-z]+)?$/.test(verb))).toBe(true);
    expect(new Set(IMPERATIVE_VERBS).size).toBe(IMPERATIVE_VERBS.length);
  });

  it("finds nothing on the tree that keeps every rule", () => {
    expect(checkDocsContent(tree())).toEqual([]);
    expect(docsContentWarnings(tree())).toEqual([]);
  });
});

describe("pageKinds", () => {
  it("names each listed page's top-level category, nested pages under their parent's", () => {
    const kinds = pageKinds({
      docs: [
        "intro",
        { type: "category", label: "How-to guides", items: ["a", { type: "doc", id: "b" }] },
        {
          type: "category",
          label: "Explanation",
          items: ["c", { type: "category", label: "Spec notes", items: ["d", "a"] }, { x: 1 }],
        },
        { type: "category", label: "Reference" },
        { type: "category", label: 5, items: ["e"] },
      ],
    });
    expect([...kinds]).toEqual([
      ["a", "How-to guides"],
      ["b", "How-to guides"],
      ["c", "Explanation"],
      ["d", "Explanation"],
    ]);
  });

  it.each([null, [], { docs: {} }, "text"])(
    "names no kinds for a sidebar of the wrong shape",
    (s) => {
      expect(pageKinds(s).size).toBe(0);
    },
  );
});

describe("howto-title", () => {
  it("accepts a title that begins with an imperative verb, with or without punctuation after it", () => {
    expect(
      found("howto-title", [
        { kind: "How-to guides", page: page("read-many", "Read many fields") },
        { kind: "How-to guides", page: page("de-identify", "De-identify: a message") },
        { kind: "How-to guides", page: page("property-test", "Property-test your code") },
      ]),
    ).toEqual([]);
  });

  it("reports a title that begins with a question word, an article, a gerund or a noun", () => {
    expect(
      found("howto-title", [
        { kind: "How-to guides", page: page("what-the-caller-owns", "What the caller owns") },
        { kind: "How-to guides", page: page("a-recipe", "A recipe") },
        { kind: "How-to guides", page: page("serializing", "Serializing Part 10") },
        { kind: "How-to guides", page: page("recipes", "Recipes") },
      ]),
    ).toEqual([
      'what-the-caller-owns.md:3 [howto-title] the title begins "What": a how-to guide\'s title ' +
        "begins with a verb in the imperative (a verb missing from IMPERATIVE_VERBS is added there)",
      'a-recipe.md:3 [howto-title] the title begins "A": a how-to guide\'s title begins with a ' +
        "verb in the imperative (a verb missing from IMPERATIVE_VERBS is added there)",
      'serializing.md:3 [howto-title] the title begins "Serializing": a how-to guide\'s title ' +
        "begins with a verb in the imperative (a verb missing from IMPERATIVE_VERBS is added there)",
      'recipes.md:3 [howto-title] the title begins "Recipes": a how-to guide\'s title begins ' +
        "with a verb in the imperative (a verb missing from IMPERATIVE_VERBS is added there)",
    ]);
  });

  it.each([
    "Release notes",
    "Support matrix",
    "Report formats",
    "Record layouts",
    "List of codes",
    "Index of segments",
    "Order messages",
    "Process overview",
    "Batch files",
    "Cache settings",
    "Plan limits",
    "Log format",
    "Patch levels",
    "Review checklist",
    "Schedule types",
    "View options",
    "Work queue",
    "Control characters",
    "Request lifecycle",
  ])("reports %j, a title that begins with a word read first as a noun", (title) => {
    const first = title.split(" ")[0];
    expect(found("howto-title", [{ kind: "How-to guides", page: page("notes", title) }])).toEqual([
      `notes.md:3 [howto-title] the title begins "${first}": a how-to guide's title begins with ` +
        "a verb in the imperative (a verb missing from IMPERATIVE_VERBS is added there)",
    ]);
  });

  it("reads only how-to guides, and leaves a missing or empty title to the front matter rule", () => {
    expect(
      found("howto-title", [
        { kind: "Explanation", page: page("what-the-model-is", "What the model is") },
        { kind: "How-to guides", page: { name: "untitled", text: "---\nid: untitled\n---\n" } },
        {
          kind: "How-to guides",
          page: { name: "blank", text: "---\nid: blank\ntitle: ' '\n---\n" },
        },
      ]),
    ).toEqual([]);
  });
});

describe("howto-steps", () => {
  it("reports an H2 or H3 that begins How, Why or The alternatives, on a how-to guide", () => {
    const body =
      "## Read it\n\n## How it works\n\n### Why it waits\n\n## The alternatives\n\n" +
      "## Alternatives\n\n#### How deep\n\n# How at the top\n\n## However many\n\n" +
      "```md\n## How in code\n```\n";
    expect(
      found("howto-steps", [{ kind: "How-to guides", page: page("read-it", "Read it", body) }]),
    ).toEqual([
      'read-it.md:10 [howto-steps] the heading "How it works" explains: move the section to an explanation and link it',
      'read-it.md:12 [howto-steps] the heading "Why it waits" explains: move the section to an explanation and link it',
      'read-it.md:14 [howto-steps] the heading "The alternatives" explains: move the section to an explanation and link it',
      'read-it.md:16 [howto-steps] the heading "Alternatives" explains: move the section to an explanation and link it',
    ]);
  });

  it("does not read an explanation's headings", () => {
    expect(
      found("howto-steps", [
        { kind: "Explanation", page: page("the-design", "The design", "## How it works\n") },
      ]),
    ).toEqual([]);
  });
});

describe("explanation-content", () => {
  it("reports a settings table: a first cell Key or Option and a Default column", () => {
    const body = [
      "| Key | Default | What it does |",
      "| --- | ------- | ------------ |",
      "| a   | 1       | b            |",
      "",
      "| `Option` | Type | `default` |",
      "|:--|:-:|--:|",
      "",
      "Key | Default",
      "--- | ---",
      "",
      "| Key | Meaning |",
      "| --- | ------- |",
      "",
      "| Flag | Default |",
      "| ---- | ------- |",
      "",
      "| Key | Default |",
      "",
      "| --- | --- |",
      "",
      "| Key | Default |",
      "| not | a delimiter |",
      "",
      "```md",
      "| Key | Default |",
      "| --- | ------- |",
      "```",
      "",
    ].join("\n");
    expect(
      found("explanation-content", [
        { kind: "Explanation", page: page("the-settings", "The settings", body) },
      ]),
    ).toEqual([
      "the-settings.md:8 [explanation-content] a settings table (Key or Option, with a Default column) belongs in a reference: move it and link it",
      "the-settings.md:12 [explanation-content] a settings table (Key or Option, with a Default column) belongs in a reference: move it and link it",
      "the-settings.md:15 [explanation-content] a settings table (Key or Option, with a Default column) belongs in a reference: move it and link it",
    ]);
  });

  it("reports a numbered H2, as 1. or Step 1:, and not a numbered H3 or a year", () => {
    const body =
      "## 1. The encoding\n\n## Step 2: the grammar\n\n## 3) Typing\n\n### 4. Deeper\n\n" +
      "## 2026 in review\n\n## Step two\n";
    expect(
      found("explanation-content", [
        { kind: "Explanation", page: page("the-encoding", "The encoding", body) },
      ]),
    ).toEqual([
      'the-encoding.md:8 [explanation-content] the heading "1. The encoding" is numbered, which reads as a step: steps go in a how-to guide or a tutorial',
      'the-encoding.md:10 [explanation-content] the heading "Step 2: the grammar" is numbered, which reads as a step: steps go in a how-to guide or a tutorial',
      'the-encoding.md:12 [explanation-content] the heading "3) Typing" is numbered, which reads as a step: steps go in a how-to guide or a tutorial',
    ]);
  });

  it("does not read a how-to guide's tables or headings", () => {
    const body = "## 1. Set it\n\n| Key | Default |\n| --- | --- |\n";
    expect(
      found("explanation-content", [
        { kind: "How-to guides", page: page("set-it", "Set it", body) },
      ]),
    ).toEqual([]);
  });
});

describe("limitations", () => {
  it("reports a library with no limitations page", () => {
    const input = tree([], { limitations: false });
    expect(lines(checkDocsContent(input).filter((f) => f.rule === "limitations"))).toEqual([
      'limitations.md:0 [limitations] every library has one limitations page, id "limitations", listed in Reference',
    ]);
  });

  it("reports the limitations page listed outside Reference, and not one the sidebar does not list", () => {
    const input = tree([], { limitations: false });
    const sidebar = JSON.parse(input.sidebars);
    sidebar.docs[4].items.push(LIMITATIONS_PAGE);
    const explained = {
      ...input,
      pages: [...input.pages, page(LIMITATIONS_PAGE, "Known limitations")],
      sidebars: JSON.stringify(sidebar),
    };
    expect(lines(checkDocsContent(explained).filter((f) => f.rule === "limitations"))).toEqual([
      'limitations.md:0 [limitations] the limitations page is listed in "Explanation": it belongs in Reference',
    ]);
    const unlisted = {
      ...input,
      pages: [...input.pages, page(LIMITATIONS_PAGE, "Known limitations")],
    };
    expect(checkDocsContent(unlisted).filter((f) => f.rule === "limitations")).toEqual([]);
  });

  it("reports a Known limitations or Limitations heading on any other page", () => {
    const body =
      "## Known limitations\n\n### Limitations (this release)\n\n## Limits\n\n## Known  limitations / non-goals\n";
    expect(
      found("limitations", [
        { kind: "How-to guides", page: page("read-more", "Read more", body) },
        { kind: "Reference", page: page("codes", "Codes", "## Limitations\n") },
      ]),
    ).toEqual([
      'read-more.md:8 [limitations] the heading "Known limitations" belongs on the limitations page, in Reference: move it there and link it',
      'read-more.md:10 [limitations] the heading "Limitations (this release)" belongs on the limitations page, in Reference: move it there and link it',
      'read-more.md:14 [limitations] the heading "Known  limitations / non-goals" belongs on the limitations page, in Reference: move it there and link it',
      'codes.md:8 [limitations] the heading "Limitations" belongs on the limitations page, in Reference: move it there and link it',
    ]);
  });

  it("accepts the heading on the limitations page itself", () => {
    const input = tree();
    input.pages = input.pages.map((p) =>
      p.name === LIMITATIONS_PAGE
        ? page(LIMITATIONS_PAGE, "Known limitations", "## Limitations\n")
        : p,
    );
    expect(checkDocsContent(input)).toEqual([]);
  });
});

describe("tutorial-steps", () => {
  const tutorial = (body: string) => [
    { kind: "Tutorials", page: page("build-a-feed", "Build a feed", body) },
  ];

  it("accepts numbered steps in order, in either form, then What you built and Next", () => {
    expect(
      found(
        "tutorial-steps",
        tutorial(
          "## 1. Start\n\n### A detail\n\n## Step 2: go on\n\n## What you built\n\n## Next\n",
        ),
      ),
    ).toEqual([]);
    expect(
      found("tutorial-steps", tutorial("## 1. Start\n\n## what YOU built\n\n## next\n")),
    ).toEqual([]);
  });

  it("reports a step out of order, a heading that is not a step, and a wrong ending", () => {
    expect(
      found(
        "tutorial-steps",
        tutorial("## 1. Start\n\n## 3. Skip\n\n## Put it together\n\n## What we built\n"),
      ),
    ).toEqual([
      'build-a-feed.md:10 [tutorial-steps] the heading "3. Skip" is not step 2 ("2. ..." or "Step 2: ...")',
      'build-a-feed.md:12 [tutorial-steps] the heading "Put it together" is not step 3 ("3. ..." or "Step 3: ...")',
      'build-a-feed.md:14 [tutorial-steps] the heading "What we built" is not step 4 ("4. ..." or "Step 4: ...")',
      'build-a-feed.md:14 [tutorial-steps] a tutorial ends with the sections "What you built" then "Next"',
    ]);
  });

  it("reports a tutorial with no steps, with or without the ending", () => {
    expect(found("tutorial-steps", tutorial("Text only.\n"))).toEqual([
      "build-a-feed.md:0 [tutorial-steps] a tutorial's H2s are numbered steps: it has none",
      'build-a-feed.md:0 [tutorial-steps] a tutorial ends with the sections "What you built" then "Next"',
    ]);
    expect(found("tutorial-steps", tutorial("## What you built\n\n## Next\n"))).toEqual([
      "build-a-feed.md:0 [tutorial-steps] a tutorial's H2s are numbered steps: it has none",
    ]);
  });

  it("does not read a how-to guide or the quickstart as a tutorial", () => {
    expect(
      found("tutorial-steps", [
        { kind: "How-to guides", page: page("read-twice", "Read twice", "## Read\n") },
      ]),
    ).toEqual([]);
  });
});

describe("page-id", () => {
  it("accepts an id that shares a content word with the title, a shorter word matching a longer", () => {
    expect(
      found("page-id", [
        { kind: "How-to guides", page: page("build-acks", "Build an ACK") },
        { kind: "How-to guides", page: page("testing", "Test your code") },
        { kind: "Explanation", page: page("tls", "Secure a link with TLS") },
      ]),
    ).toEqual([]);
  });

  it("reports an id that names the page's kind, whatever its title", () => {
    expect(
      found("page-id", [
        { kind: "How-to guides", page: page("guides-hl7", "Generate HL7 messages") },
        { kind: "Explanation", page: page("concepts-archetype", "The parser archetype") },
        { kind: "Explanation", page: page("core-concepts", "Core concepts") },
      ]),
    ).toEqual([
      'guides-hl7.md:0 [page-id] the id begins "guides-", which names the page\'s kind: a new id names what the page is about',
      'concepts-archetype.md:0 [page-id] the id begins "concepts-", which names the page\'s kind: a new id names what the page is about',
      'core-concepts.md:0 [page-id] the id begins "core-concepts", which names the page\'s kind: a new id names what the page is about',
    ]);
  });

  it("reports an id that shares no content word with its title, filler words and two letters not counting", () => {
    expect(
      found("page-id", [
        { kind: "How-to guides", page: page("overview", "Pin a golden fixture") },
        { kind: "Explanation", page: page("the-design", "The model") },
        { kind: "Explanation", page: page("ab-model", "Abc") },
      ]),
    ).toEqual([
      'overview.md:3 [page-id] the id "overview" shares no content word with the title "Pin a golden fixture"',
      'the-design.md:3 [page-id] the id "the-design" shares no content word with the title "The model"',
      'ab-model.md:3 [page-id] the id "ab-model" shares no content word with the title "Abc"',
    ]);
  });

  it("does not read the fixed pages, or a page with no title", () => {
    const input = tree([
      { kind: "Explanation", page: { name: "untitled", text: "---\nid: untitled\n---\n" } },
    ]);
    input.pages = input.pages.map((p) =>
      p.name === "intro" ? page("intro", "@cosyte/example") : p,
    );
    expect(checkDocsContent(input).filter((f) => f.rule === "page-id")).toEqual([]);
  });
});

describe("reference-source", () => {
  const configuration = (extra = "") =>
    page("configuration-reference", "Configuration reference", "Text.\n", extra);

  it("asks a configuration or command reference, or a reference with a settings table, for held_by", () => {
    expect(
      found("reference-source", [
        { kind: "Reference", page: configuration() },
        { kind: "Reference", page: page("cli", "The command line") },
        {
          kind: "Reference",
          page: page("server", "Server", "| Option | Type | Default |\n| --- | --- | --- |\n"),
        },
        { kind: "Reference", page: page("warning-codes", "Warning codes") },
        { kind: "How-to guides", page: page("set-options", "Set options") },
      ]),
    ).toEqual([
      'configuration-reference.md:0 [reference-source] a configuration or command reference: name the generator or the test that holds every entry to the code in "held_by:" in the front matter',
      'cli.md:0 [reference-source] a configuration or command reference: name the generator or the test that holds every entry to the code in "held_by:" in the front matter',
      'server.md:0 [reference-source] a settings table: name the generator or the test that holds every entry to the code in "held_by:" in the front matter',
    ]);
  });

  it("reports an empty held_by, one that is not a file in the repository, and one that never names the page", () => {
    const sources = new Map([
      ["test/docs.test.ts", "checks configuration-reference.md entry by entry"],
      ["test/other.test.ts", "checks nothing here"],
    ]);
    const cases = [
      "held_by: ' '\n",
      "held_by: test/missing.test.ts\n",
      "held_by: ../outside.ts\n",
      "held_by: test/other.test.ts\n",
    ];
    expect(
      cases.map((extra) =>
        found("reference-source", [{ kind: "Reference", page: configuration(extra) }], sources),
      ),
    ).toEqual([
      [
        'configuration-reference.md:0 [reference-source] a configuration or command reference: name the generator or the test that holds every entry to the code in "held_by:" in the front matter',
      ],
      [
        'configuration-reference.md:6 [reference-source] held_by names "test/missing.test.ts", which is not a file in the repository',
      ],
      [
        'configuration-reference.md:6 [reference-source] held_by names "../outside.ts", which is not a file in the repository',
      ],
      [
        'configuration-reference.md:6 [reference-source] held_by names "test/other.test.ts", which never names configuration-reference.md',
      ],
    ]);
    expect(
      found(
        "reference-source",
        [{ kind: "Reference", page: configuration("held_by: test/docs.test.ts\n") }],
        sources,
      ),
    ).toEqual([]);
    expect(
      found("reference-source", [
        { kind: "Reference", page: configuration("held_by: test/docs.test.ts\n") },
      ]),
    ).toEqual([
      'configuration-reference.md:6 [reference-source] held_by names "test/docs.test.ts", which is not a file in the repository',
    ]);
  });

  it.each([
    ["test/docs.test.ts", true],
    ["scripts/gen.mjs", true],
    ["", false],
    ["/etc/passwd", false],
    ["../x", false],
    ["a/../b", false],
    ["./a", false],
    ["a//b", false],
    ["a\\b", false],
  ])("reads %j as a held_by path inside the repository: %s", (path, ok) => {
    expect(isHeldByPath(path)).toBe(ok);
  });

  it.each([
    ["the page itself", "docs-content/configuration-reference.md"],
    ["another docs page", "docs-content/settings-index.md"],
    ["a Markdown file outside the docs", "README.md"],
    ["an MDX file", "notes/config.mdx"],
    ["a Markdown file in upper case", "NOTES.MD"],
    ["any file under docs-content", "docs-content/sidebars.json"],
  ])("refuses a held_by that names %s, even when it names the page", (_label, path) => {
    const sources = new Map([[path, "docs-content/configuration-reference.md"]]);
    expect(
      found(
        "reference-source",
        [{ kind: "Reference", page: configuration(`held_by: ${path}\n`) }],
        sources,
      ),
    ).toEqual([
      `configuration-reference.md:6 [reference-source] held_by names "${path}", which is a ` +
        "page, not the generator or the test that holds the reference to the code",
    ]);
  });

  it.each([
    ["a .markdown file", "notes/config.markdown", ""],
    ["a .markdown file in upper case", "NOTES.MARKDOWN", ""],
    ["a text file", "notes/config.txt", ""],
    ["a text file in upper case", "NOTES.TXT", ""],
    ["an extensionless file", "NOTES", ""],
    ["an extensionless file in a folder", "notes/config", ""],
    ["an extensionless dotfile", "notes/.config", ""],
    ["an extensionless file whose folder has a dot", "notes.d/config", ""],
    ["an extensionless file with #! after its first line", "bin/gen", "\n#!/bin/sh\n"],
  ])("refuses a held_by that names %s, even when it names the page", (_label, path, head) => {
    const text = `${head}docs-content/configuration-reference.md`;
    const sources = new Map([[path, text]]);
    expect(
      found(
        "reference-source",
        [{ kind: "Reference", page: configuration(`held_by: ${path}\n`) }],
        sources,
      ),
    ).toEqual([
      `configuration-reference.md:6 [reference-source] held_by names "${path}", which is a ` +
        "text file, not the generator or the test that holds the reference to the code",
    ]);
  });

  it.each([
    ["an extensionless script with a #! line", "bin/gen-config", "#!/bin/sh\n"],
    ["a script in a dotted folder", "scripts.d/gen.mjs", ""],
    ["a dotfile with an extension", "scripts/.gen.mjs", ""],
    ["a file whose name ends in txt", "scripts/gentxt.mjs", ""],
    ["a file whose extension holds txt", "scripts/gen.txts", ""],
    ["a file whose extension holds markdown", "scripts/gen.markdowns", ""],
  ])("takes a held_by that names %s", (_label, path, head) => {
    const sources = new Map([[path, `${head}docs-content/configuration-reference.md`]]);
    expect(
      found(
        "reference-source",
        [{ kind: "Reference", page: configuration(`held_by: ${path}\n`) }],
        sources,
      ),
    ).toEqual([]);
  });

  it.each([
    ["a longer file name that ends with it", "see docs-content/old-configuration-reference.md"],
    ["a file name with a dot before it", "see v2.configuration-reference.md"],
    ["the MDX file of the same name", "see docs-content/configuration-reference.mdx"],
    ["a longer extension", "see configuration-reference.md5"],
    ["a name with a suffix", "see configuration-reference.md-old"],
  ])("does not take %s for the page's file", (_label, text) => {
    const sources = new Map([["test/docs.test.ts", text]]);
    expect(
      found(
        "reference-source",
        [{ kind: "Reference", page: configuration("held_by: test/docs.test.ts\n") }],
        sources,
      ),
    ).toEqual([
      'configuration-reference.md:6 [reference-source] held_by names "test/docs.test.ts", which never names configuration-reference.md',
    ]);
  });

  it.each([
    ["alone", "configuration-reference.md"],
    ["under docs-content", 'read("docs-content/configuration-reference.md")'],
    ["joined as a segment", 'join(docs, "configuration-reference.md")'],
    ["at the end of a sentence", "checks configuration-reference.md."],
    ["in a Markdown link", "(./configuration-reference.md)"],
    ["after a backslash", "docs-content\\configuration-reference.md"],
  ])("takes the page's file named %s", (_label, text) => {
    const sources = new Map([["test/docs.test.ts", text]]);
    expect(
      found(
        "reference-source",
        [{ kind: "Reference", page: configuration("held_by: test/docs.test.ts\n") }],
        sources,
      ),
    ).toEqual([]);
  });
});

describe("docsContentWarnings", () => {
  const warned = (body: string, kind = "Explanation", name = "the-speed") =>
    docsContentWarnings(tree([{ kind, page: page(name, "The speed", body) }])).map(
      (w) => `${w.file}:${w.line} [${w.rule}] ${w.message}`,
    );

  it("warns on a number with a measured unit in prose, one warning a line", () => {
    const body = [
      "It reads 1,100 messages a second.",
      "Latency is 0.93 ms at p50, 12 µs per field, 40 ns a call.",
      "Peak heap was 118 MiB, about 5 MB, 3 KiB and 2 GB.",
      "Overhead was 1% to 5%.",
      "It runs 44 times faster, 3x faster, 200/s and 9 per second.",
      "Version 2.5 of the standard, 10 fields, 3 seconds.",
      "`5 ms` in code is not read.",
      "```text",
      "6 ms in a fence is not read",
      "```",
    ].join("\n");
    expect(warned(body)).toEqual([
      'the-speed.md:8 [measured-number] "1,100 messages a second" reads as a measured number: measured numbers go in the generated "Current numbers" section',
      'the-speed.md:9 [measured-number] "0.93 ms" reads as a measured number: measured numbers go in the generated "Current numbers" section',
      'the-speed.md:10 [measured-number] "118 MiB" reads as a measured number: measured numbers go in the generated "Current numbers" section',
      'the-speed.md:11 [measured-number] "1%" reads as a measured number: measured numbers go in the generated "Current numbers" section',
      'the-speed.md:12 [measured-number] "44 times faster" reads as a measured number: measured numbers go in the generated "Current numbers" section',
    ]);
  });

  it.each([
    "12 µs",
    "40 ns",
    "5 MB",
    "3 KiB",
    "2 GB",
    "3x faster",
    "200/s",
    "9 per second",
    "7 TiB",
  ])("reads %j as measured", (text) => {
    expect(warned(`It took ${text}.`)).toHaveLength(1);
  });

  it("does not read the Current numbers section, the front matter, or a page in Reference", () => {
    const body = `${NUMBERS_HEADING}\n\n100 ms typed here.\n\n### Deeper\n\n2 ms.\n\n## Method\n\n3 ms.\n`;
    expect(warned(body, "Explanation")).toEqual([
      'the-speed.md:18 [measured-number] "3 ms" reads as a measured number: measured numbers go in the generated "Current numbers" section',
    ]);
    expect(warned("4 ms.\n", "Reference", "speed-codes")).toEqual([]);
    const front = { name: "the-speed", text: "---\nid: the-speed\ndescription: 5 ms\n---\n" };
    expect(docsContentWarnings({ pages: [front], sidebars: null })).toEqual([]);
  });

  it("reads every page, from line 1, without front matter or a sidebar that parses", () => {
    const bare = { name: "notes", text: "5 ms\n" };
    for (const sidebars of [null, "{ not json", '{"docs": []}']) {
      expect(docsContentWarnings({ pages: [bare], sidebars })).toEqual([
        {
          file: "notes.md",
          line: 1,
          rule: "measured-number",
          message:
            '"5 ms" reads as a measured number: measured numbers go in the generated "Current numbers" section',
        },
      ]);
    }
  });
});

describe("applyDocsContentRatchet", () => {
  const finding = (rule: string, file = "a.md"): Finding => ({ file, line: 0, rule, message: "m" });

  it("holds a ratcheted rule at or under its count, fails it over, and names a count that can fall", () => {
    const findings = [
      finding("page-id", "a.md"),
      finding("page-id", "b.md"),
      finding("howto-steps"),
      finding("howto-steps", "c.md"),
      finding("limitations"),
      finding("listing"),
    ];
    const result = applyDocsContentRatchet(findings, {
      "page-id": 2,
      "howto-steps": 1,
      limitations: 3,
      "tutorial-steps": 1,
    });
    expect(result.failing).toEqual([
      finding("howto-steps"),
      finding("howto-steps", "c.md"),
      finding("listing"),
    ]);
    expect(result.held).toEqual([
      finding("page-id", "a.md"),
      finding("page-id", "b.md"),
      finding("limitations"),
    ]);
    expect(result.over).toEqual([{ rule: "howto-steps", count: 2, allowed: 1 }]);
    expect(result.loose).toEqual([
      { rule: "limitations", count: 1, allowed: 3 },
      { rule: "tutorial-steps", count: 0, allowed: 1 },
    ]);
  });

  it("holds nothing with no counts", () => {
    const result = applyDocsContentRatchet([finding("page-id")]);
    expect(result).toEqual({
      failing: [finding("page-id")],
      held: [],
      over: [{ rule: "page-id", count: 1, allowed: 0 }],
      loose: [],
    });
  });
});

describe("the ratchet file", () => {
  const file = JSON.parse(
    readFileSync(new URL("../docs-content-ratchet.json", import.meta.url), "utf8"),
  ) as {
    description: string;
    rules?: string[];
    measuredAt: Record<string, string>;
    examplesMeasuredAt?: Record<string, string>;
    libraries: Record<string, Record<string, number>>;
  };

  /**
   * The rules a copy of the file holds. A copy that names none is one from before the example
   * rules joined the ratchet, which held the seven rules on kinds.
   */
  const KIND_RULES = [
    "howto-title",
    "howto-steps",
    "explanation-content",
    "limitations",
    "tutorial-steps",
    "page-id",
    "reference-source",
  ];
  const heldRules = (copy: typeof file) => copy.rules ?? KIND_RULES;

  it("is the counts the check reads, frozen", () => {
    expect(DOCS_CONTENT_RATCHET).toEqual(file.libraries);
    expect(Object.isFrozen(DOCS_CONTENT_RATCHET)).toBe(true);
    expect(Object.values(DOCS_CONTENT_RATCHET).every((counts) => Object.isFrozen(counts))).toBe(
      true,
    );
  });

  it("counts only ratcheted rules, each at least one, for a library measured at a named commit", () => {
    for (const [library, counts] of Object.entries(file.libraries)) {
      expect(library).toMatch(/^@cosyte\/[a-z0-9-]+$/);
      expect(file.measuredAt[library]).toMatch(/^[0-9a-f]{7,40}$/);
      for (const [rule, count] of Object.entries(counts)) {
        expect(RATCHETED_RULES).toContain(rule);
        expect(Number.isInteger(count) && count >= 1).toBe(true);
      }
    }
  });

  it("names the rules it holds, and the commit each library's example counts were measured at", () => {
    expect(file.rules).toEqual([...RATCHETED_RULES]);
    for (const [library, counts] of Object.entries(file.libraries)) {
      const examples = ["example-page", "example-code"].some((rule) => Object.hasOwn(counts, rule));
      if (examples) expect(file.examplesMeasuredAt?.[library]).toMatch(/^[0-9a-f]{7,40}$/);
    }
    for (const library of Object.keys(file.examplesMeasuredAt ?? {})) {
      expect(Object.keys(file.libraries)).toContain(library);
    }
  });

  it("reads a copy that names no rules as one holding the seven rules on kinds", () => {
    const { rules: _rules, ...old } = file;
    expect(heldRules(old)).toEqual(KIND_RULES);
    expect(heldRules(file)).toEqual([...RATCHETED_RULES]);
  });

  // The counts only fall. Against main's copy of the file, no library gains a rule or a count, and
  // no library is added. CI checks out the whole history, so main's copy is there to read, and in
  // CI a main it cannot read fails the test rather than skipping it. Only a main that has no copy
  // of the file, the change that adds it, has nothing to compare.
  type Base =
    | { kind: "read"; file: typeof file }
    | { kind: "absent" }
    | { kind: "unreadable"; reason: string };

  /** The ratchet file as `ref` holds it. */
  function readRatchetAt(ref: string, path = RATCHET_PATH): Base {
    const git = (args: string[]) =>
      execFileSync("git", args, {
        cwd: REPO_ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    try {
      if (git(["ls-tree", "--full-tree", "--name-only", ref, "--", path]).trim() === "") {
        return { kind: "absent" };
      }
      return { kind: "read", file: JSON.parse(git(["show", `${ref}:${path}`])) as typeof file };
    } catch (error) {
      return { kind: "unreadable", reason: (error as Error).message.split("\n")[0] ?? "" };
    }
  }

  /** What the only-tightens test does with main's copy: compare, pass, skip, or fail. */
  function baseOutcome(base: Base, ci: boolean): "compare" | "nothing on main" | "skip" | "fail" {
    if (base.kind === "read") return "compare";
    if (base.kind === "absent") return "nothing on main";
    return ci ? "fail" : "skip";
  }

  it("reads the file at a ref, names a ref that has none, and names one it cannot read", () => {
    expect(readRatchetAt("HEAD").kind).toBe("read");
    expect(readRatchetAt("HEAD", "packages/script-utils/no-such-ratchet.json").kind).toBe("absent");
    expect(readRatchetAt("refs/heads/no-such-branch-for-this-test").kind).toBe("unreadable");
  });

  it("fails in CI on a main it cannot read, and skips only outside CI", () => {
    const unreadable: Base = { kind: "unreadable", reason: "no ref" };
    expect(baseOutcome(unreadable, true)).toBe("fail");
    expect(baseOutcome(unreadable, false)).toBe("skip");
    expect(baseOutcome({ kind: "absent" }, true)).toBe("nothing on main");
    expect(baseOutcome({ kind: "read", file }, true)).toBe("compare");
  });

  // A rule main's copy does not hold is new to the ratchet, and this change records its first
  // counts, measured from the libraries; every rule main holds is compared.
  it("never raises a count main records, nor adds a library or a rule main holds", (context) => {
    const base = readRatchetAt("origin/main");
    const outcome = baseOutcome(base, process.env.CI !== undefined && process.env.CI !== "");
    if (outcome === "fail" && base.kind === "unreadable") {
      expect.fail(`cannot read main's copy of the ratchet in CI: ${base.reason}`);
    }
    if (outcome === "skip") context.skip("main's copy of the ratchet cannot be read here");
    if (base.kind !== "read") return;
    const recorded = base.file.libraries;
    const held = heldRules(base.file);
    for (const rule of held) expect(heldRules(file)).toContain(rule);
    for (const [library, counts] of Object.entries(file.libraries)) {
      expect(Object.keys(recorded)).toContain(library);
      for (const [rule, count] of Object.entries(counts)) {
        if (!held.includes(rule)) continue;
        expect(count).toBeLessThanOrEqual(recorded[library]?.[rule] ?? 0);
      }
    }
  });
});

describe("readDocsContent and the command line", () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "docs-content-kinds-"));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** A repository holding a tree, its package.json and any other files. */
  function repo(label: string, input: ReturnType<typeof tree>, files: Record<string, string> = {}) {
    const dir = join(root, label);
    const all: Record<string, string> = { "docs-content/sidebars.json": input.sidebars };
    for (const p of input.pages) all[`docs-content/${p.name}.md`] = p.text;
    Object.assign(all, files);
    for (const [path, text] of Object.entries(all)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    return dir;
  }

  function cli(dir: string, ratchet?: Record<string, Record<string, number>>) {
    let out = "";
    let err = "";
    const code = runDocsContentCheck({
      dir,
      stdout: { write: (t: string) => (out += t) },
      stderr: { write: (t: string) => (err += t) },
      ...(ratchet === undefined ? {} : { ratchet }),
    });
    return { code, out, err };
  }

  const pkg = (name: unknown) => JSON.stringify({ name });

  it("reads the files held_by names, once each, and the library's name", () => {
    const held = (name: string, path: string) => page(name, name, "Text.\n", `held_by: ${path}\n`);
    const input = tree([
      { kind: "Reference", page: held("configuration-reference", "test/docs.test.ts") },
      { kind: "Reference", page: held("command-reference", "test/docs.test.ts") },
      { kind: "Reference", page: held("cli-options", "test/missing.ts") },
      { kind: "Reference", page: held("env-settings", "../outside.ts") },
      { kind: "Reference", page: held("other-settings", "test") },
      { kind: "Reference", page: held("linked-settings", "linked.ts") },
    ]);
    const dir = repo("read", input, {
      "package.json": pkg("@cosyte/example"),
      "test/docs.test.ts": "configuration-reference.md command-reference.md",
      "outside.ts": "x",
    });
    symlinkSync(join(dir, "test", "docs.test.ts"), join(dir, "linked.ts"));
    const read = readDocsContent(dir);
    expect([...read.sources]).toEqual([
      ["test/docs.test.ts", "configuration-reference.md command-reference.md"],
    ]);
    expect(read.library).toBe("@cosyte/example");
  });

  it.each([
    ["no package.json", undefined],
    ["one that is not JSON", "{"],
    ["one whose name is not a string", pkg(5)],
    ["one that is null", "null"],
  ])("names no library with %s", (label, text) => {
    const dir = repo(
      `library-${label.replaceAll(" ", "-")}`,
      tree(),
      text === undefined ? {} : { "package.json": text },
    );
    expect(readDocsContent(dir).library).toBeNull();
  });

  const twoIds = () =>
    tree([
      { kind: "How-to guides", page: page("guides-a", "Read a") },
      { kind: "How-to guides", page: page("guides-b", "Read b") },
    ]);

  it("holds findings at the library's counts, exits 0, and lists them with any warning", () => {
    const dir = repo("held", twoIds(), {
      "package.json": pkg("@cosyte/example"),
      "docs-content/the-model.md": page("the-model", "The model", "It took 5 ms.\n").text,
    });
    expect(cli(dir, { "@cosyte/example": { "page-id": 2 } })).toEqual({
      code: 0,
      out:
        '  docs-content/the-model.md:8 [measured-number] "5 ms" reads as a measured number: measured numbers go in the generated "Current numbers" section (a warning)\n' +
        "docs-content: 2 finding(s) held by the ratchet for @cosyte/example, at or under the counts docs-content-ratchet.json in @cosyte/script-utils records:\n" +
        '  docs-content/guides-a.md [page-id] the id begins "guides-", which names the page\'s kind: a new id names what the page is about\n' +
        '  docs-content/guides-b.md [page-id] the id begins "guides-", which names the page\'s kind: a new id names what the page is about\n' +
        "docs-content: OK (11 page(s) checked)\n",
      err: "",
    });
  });

  it("says a count can fall, and still exits 0", () => {
    const dir = repo("loose", twoIds(), { "package.json": pkg("@cosyte/example") });
    const r = cli(dir, { "@cosyte/example": { "page-id": 3 } });
    expect(r.code).toBe(0);
    expect(r.out).toContain(
      "docs-content: [page-id] is down to 2 from the 3 recorded for @cosyte/example: lower its count in docs-content-ratchet.json in @cosyte/script-utils\n",
    );
  });

  it("fails every finding of a rule over its count, naming the count", () => {
    const dir = repo("over", twoIds(), { "package.json": pkg("@cosyte/example") });
    expect(cli(dir, { "@cosyte/example": { "page-id": 1 } })).toEqual({
      code: 1,
      out: "",
      err:
        "docs-content: 2 finding(s) in 11 page(s).\n" +
        '  docs-content/guides-a.md [page-id] the id begins "guides-", which names the page\'s kind: a new id names what the page is about\n' +
        '  docs-content/guides-b.md [page-id] the id begins "guides-", which names the page\'s kind: a new id names what the page is about\n' +
        "docs-content: [page-id] has 2 finding(s), over the 1 recorded for @cosyte/example, so each one fails.\n",
    });
  });

  it("holds nothing for a library the ratchet does not name, or a repository with no name", () => {
    const named = repo("unnamed-library", twoIds(), { "package.json": pkg("__proto__") });
    expect(cli(named, {}).code).toBe(1);
    const anonymous = repo("no-name", twoIds());
    expect(cli(anonymous, { "@cosyte/example": { "page-id": 2 } }).err).toContain(
      "docs-content: [page-id] has 2 finding(s), over the 0 recorded for this repository, so each one fails.\n",
    );
  });

  it("fails a reference held by itself, or by a file that names only a longer file name", () => {
    const held = (name: string, title: string, path: string) =>
      page(name, title, "Text.\n", `held_by: ${path}\n`);
    const input = tree([
      {
        kind: "Reference",
        page: held("configuration", "Configuration", "docs-content/configuration.md"),
      },
      { kind: "Reference", page: held("options", "Options", "README.md") },
      { kind: "Reference", page: held("cli-settings", "CLI settings", "scripts/gen.mjs") },
    ]);
    const dir = repo("held-by-itself", input, {
      "README.md": "See docs-content/cli-options.md and cli-settings.md for the flags.\n",
      "scripts/gen.mjs": "// writes docs-content/old-cli-settings.md\n",
    });
    const findings = checkDocsContent(readDocsContent(dir)).filter(
      (f) => f.rule === "reference-source",
    );
    expect(lines(findings).sort()).toEqual([
      'cli-settings.md:6 [reference-source] held_by names "scripts/gen.mjs", which never names cli-settings.md',
      'configuration.md:6 [reference-source] held_by names "docs-content/configuration.md", which is a page, not the generator or the test that holds the reference to the code',
      'options.md:6 [reference-source] held_by names "README.md", which is a page, not the generator or the test that holds the reference to the code',
    ]);
    expect(cli(dir, {}).code).toBe(1);
  });

  it("reads the shipped ratchet by default", () => {
    const [library, counts] = Object.entries(DOCS_CONTENT_RATCHET)[0];
    const dir = repo("shipped", tree(), { "package.json": pkg(library) });
    const r = cli(dir);
    expect(r.code).toBe(0);
    for (const rule of Object.keys(counts)) expect(r.out).toContain(`[${rule}] is down to 0`);
  });
});
