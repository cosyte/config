/**
 * The docs-content structure check. Every rule is shown red on a tree that breaks it and green on
 * the smallest tree that keeps the standard, and the command line is graded on its exit codes:
 * 0 clean, 1 a finding, 2 could not read its input.
 *
 * Every page here is synthetic.
 */

import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  CATEGORIES,
  checkDocsContent,
  DESCRIPTION_LIMIT,
  DOCS_CONTENT_RULES,
  DocsContentRefusal,
  GENERATED_DIR,
  headingAnchors,
  NUMBERS_HEADING,
  NUMBERS_PLACEHOLDER,
  parseFrontMatter,
  QUALITY_PAGES,
  readDocsContent,
  REFERENCE_LINK_PREFIX,
  REQUIRED_PAGES,
  runDocsContentCheck,
} from "../docs-content.js";

type Page = { name: string; text: string };

/** A page that keeps the front matter rules, with an optional body. */
function page(name: string, body = "Text.\n"): Page {
  return {
    name,
    text:
      `---\nid: ${name}\ntitle: ${name}\nsidebar_label: ${name}\n` +
      `description: "A page about ${name}."\n---\n\n# ${name}\n\n${body}`,
  };
}

/** The two quality pages, with the numbers section holding its placeholder. */
const QUALITY = QUALITY_PAGES.map((name) =>
  page(name, `${NUMBERS_HEADING}\n\n${NUMBERS_PLACEHOLDER}\n`),
);

/** The smallest sidebar the standard accepts. */
function minimalSidebar(): { docs: unknown[] } {
  return {
    docs: [
      "intro",
      { type: "category", label: "Installation", items: ["installation"] },
      { type: "category", label: "Quickstart", items: ["quickstart"] },
      { type: "category", label: "How-to guides", items: ["read-a-field"] },
      { type: "category", label: "Explanation", items: ["the-model"] },
      { type: "category", label: "Troubleshooting", items: ["troubleshooting"] },
      "testing-and-quality",
      "performance",
    ],
  };
}

/** The pages the minimal sidebar lists. */
function minimalPages(): Page[] {
  return [
    page("intro"),
    page("installation"),
    page("quickstart"),
    page("read-a-field"),
    page("the-model"),
    page("troubleshooting"),
    ...QUALITY,
  ];
}

function check(
  overrides: {
    pages?: Page[];
    sidebars?: unknown;
    misplaced?: string[];
    reference?: Map<string, string>;
  } = {},
): { file: string; line: number; rule: string; message: string }[] {
  const sidebars =
    overrides.sidebars === undefined
      ? JSON.stringify(minimalSidebar())
      : overrides.sidebars === null
        ? null
        : typeof overrides.sidebars === "string"
          ? overrides.sidebars
          : JSON.stringify(overrides.sidebars);
  return checkDocsContent({
    pages: overrides.pages ?? minimalPages(),
    sidebars,
    misplaced: overrides.misplaced ?? [],
    ...(overrides.reference === undefined ? {} : { reference: overrides.reference }),
  });
}

/** Findings as `file:line [rule] message` lines, which is what a failure prints. */
function lines(
  findings: { file: string; line: number; rule: string; message: string }[],
): string[] {
  return findings.map((f) => `${f.file}:${f.line} [${f.rule}] ${f.message}`);
}

function withSidebar(edit: (docs: unknown[]) => void): { docs: unknown[] } {
  const sidebar = minimalSidebar();
  edit(sidebar.docs);
  return sidebar;
}

describe("the standard's constants", () => {
  it("names the required pages, the categories in order, and the two quality pages", () => {
    expect(REQUIRED_PAGES).toEqual([
      "intro",
      "installation",
      "quickstart",
      "troubleshooting",
      "testing-and-quality",
      "performance",
    ]);
    expect(CATEGORIES.map((c) => [c.label, c.required, c.first])).toEqual([
      ["Installation", true, "installation"],
      ["Quickstart", true, "quickstart"],
      ["Tutorials", false, null],
      ["How-to guides", true, null],
      ["Explanation", true, null],
      ["Reference", false, null],
      ["Troubleshooting", true, "troubleshooting"],
    ]);
    expect(QUALITY_PAGES).toEqual(["testing-and-quality", "performance"]);
    expect(NUMBERS_HEADING).toBe("## Current numbers");
    expect(NUMBERS_PLACEHOLDER).toBe(
      "The numbers for this section are measured on `main` at each release and filled in when " +
        "the release is built. They are never typed by hand.",
    );
    expect(GENERATED_DIR).toBe("api");
    expect(REFERENCE_LINK_PREFIX).toBe("./api/");
    expect(DESCRIPTION_LIMIT).toBe(160);
    expect(Object.keys(DOCS_CONTENT_RULES)).toEqual([
      "sidebar",
      "listing",
      "required-page",
      "front-matter",
      "file-name",
      "numbers",
      "reference-link",
    ]);
    expect(DOCS_CONTENT_RULES).toEqual({
      sidebar: "sidebars.json holds one `docs` sidebar in the standard shape",
      listing: "every page is listed in the sidebar exactly once, and every listed id is a page",
      "required-page": "the pages every library has exist",
      "front-matter":
        "every page opens with front matter carrying id, title, sidebar_label, description",
      "file-name": "pages are lower-case, hyphenated .md files at the top of docs-content/",
      numbers:
        'both quality pages carry the "Current numbers" section, holding only the placeholder',
      "reference-link":
        "a link into the generated reference names a page under api/ and, after #, a heading on it",
    });
  });
});

describe("a tree that keeps the standard", () => {
  it("has no findings", () => {
    expect(check()).toEqual([]);
  });

  it("has none when the input names no misplaced markdown at all", () => {
    expect(
      checkDocsContent({ pages: minimalPages(), sidebars: JSON.stringify(minimalSidebar()) }),
    ).toEqual([]);
  });

  it("has none with every optional category, nested categories and object doc references", () => {
    const sidebar = {
      docs: [
        { type: "doc", id: "intro" },
        { type: "category", label: "Installation", items: ["installation"] },
        { type: "category", label: "Quickstart", collapsed: false, items: ["quickstart"] },
        { type: "category", label: "Tutorials", items: ["build-a-feed"] },
        { type: "category", label: "How-to guides", items: ["read-a-field"] },
        {
          type: "category",
          label: "Explanation",
          items: [
            "the-model",
            { type: "category", label: "Spec notes", items: [{ type: "doc", id: "escapes" }] },
          ],
        },
        { type: "category", label: "Reference", items: ["codes"] },
        { type: "category", label: "Troubleshooting", items: ["troubleshooting", "limits"] },
        { type: "doc", id: "testing-and-quality" },
        "performance",
      ],
    };
    const pages = [
      ...minimalPages(),
      page("build-a-feed"),
      page("escapes"),
      page("codes"),
      page("limits"),
    ];
    expect(check({ pages, sidebars: sidebar })).toEqual([]);
  });
});

describe("sidebar", () => {
  it("reports a missing sidebars.json", () => {
    expect(lines(check({ sidebars: null }))).toEqual([
      "sidebars.json:0 [sidebar] there is no sidebars.json",
    ]);
  });

  it("reports a sidebars.json that is not JSON, naming the parse error", () => {
    const found = lines(check({ sidebars: "{ docs: [" }));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/^sidebars\.json:0 \[sidebar\] is not JSON: \S/);
  });

  it.each([
    ["an array", "[]"],
    ["null", "null"],
    ["docs that is not an array", '{"docs": {"type": "autogenerated"}}'],
    ["no docs", '{"other": []}'],
  ])("reports %s as the wrong shape, and lists nothing", (_label, text) => {
    expect(lines(check({ sidebars: text })).filter((l) => l.includes("[sidebar]"))).toEqual([
      'sidebars.json:0 [sidebar] sidebars.json is not an object whose "docs" is an array',
    ]);
  });

  it("reports a second sidebar by name", () => {
    expect(lines(check({ sidebars: { ...minimalSidebar(), api: [] } }))).toEqual([
      'sidebars.json:0 [sidebar] at /api: one sidebar, "docs": remove "api"',
    ]);
  });

  it("reports a sidebar that does not open with intro", () => {
    const sidebar = withSidebar((docs) => docs.shift());
    expect(lines(check({ sidebars: sidebar }))).toEqual([
      'sidebars.json:0 [sidebar] at /docs/0: the sidebar opens with the overview page, "intro"',
      "intro.md:0 [listing] the sidebar does not list it",
    ]);
  });

  it("reports a category outside the standard, naming the ones it has", () => {
    const sidebar = withSidebar((docs) =>
      docs.splice(4, 0, { type: "category", label: "Guides", items: ["guide"] }),
    );
    expect(lines(check({ sidebars: sidebar, pages: [...minimalPages(), page("guide")] }))).toEqual([
      'sidebars.json:0 [sidebar] at /docs/4: "Guides" is not a category of the standard ' +
        "(Installation, Quickstart, Tutorials, How-to guides, Explanation, Reference, Troubleshooting)",
    ]);
  });

  it("reports a category out of order", () => {
    const sidebar = withSidebar((docs) => {
      const [explanation] = docs.splice(4, 1);
      docs.splice(3, 0, explanation);
    });
    expect(lines(check({ sidebars: sidebar }))).toEqual([
      'sidebars.json:0 [sidebar] at /docs/4: "How-to guides" is out of order: the categories run ' +
        "Installation, Quickstart, Tutorials, How-to guides, Explanation, Reference, Troubleshooting",
      'sidebars.json:0 [sidebar] at /docs: the category "How-to guides" is missing',
    ]);
  });

  it("reports a category that appears twice as out of order", () => {
    const sidebar = withSidebar((docs) =>
      docs.splice(4, 0, { type: "category", label: "How-to guides", items: ["guide"] }),
    );
    expect(lines(check({ sidebars: sidebar, pages: [...minimalPages(), page("guide")] }))).toEqual([
      'sidebars.json:0 [sidebar] at /docs/4: "How-to guides" is out of order: the categories run ' +
        "Installation, Quickstart, Tutorials, How-to guides, Explanation, Reference, Troubleshooting",
    ]);
  });

  it.each([
    ["Installation", 1, "installation"],
    ["Quickstart", 2, "quickstart"],
    ["Troubleshooting", 5, "troubleshooting"],
  ])("reports %s that does not open with its page", (label, index, first) => {
    const sidebar = withSidebar((docs) => {
      (docs[index] as { items: string[] }).items.unshift("extra");
    });
    expect(lines(check({ sidebars: sidebar, pages: [...minimalPages(), page("extra")] }))).toEqual([
      `sidebars.json:0 [sidebar] at /docs/${index}/items/0: "${label}" opens with the page "${first}"`,
    ]);
  });

  it.each(["Installation", "Quickstart", "How-to guides", "Explanation", "Troubleshooting"])(
    "reports the required category %s when it is missing",
    (label) => {
      const sidebar = withSidebar((docs) => {
        const at = docs.findIndex((item) => (item as { label?: string }).label === label);
        docs.splice(at, 1);
      });
      const found = lines(check({ sidebars: sidebar }));
      expect(found).toContain(
        `sidebars.json:0 [sidebar] at /docs: the category "${label}" is missing`,
      );
      expect(found.filter((l) => l.includes("[sidebar]"))).toHaveLength(1);
    },
  );

  it("reports a category with no items, and one whose items are not an array", () => {
    const sidebar = withSidebar((docs) => {
      docs.splice(3, 0, { type: "category", label: "Tutorials", items: [] });
      docs.splice(6, 0, { type: "category", label: "Reference" });
    });
    expect(lines(check({ sidebars: sidebar }))).toEqual([
      'sidebars.json:0 [sidebar] at /docs/3: the category "Tutorials" has no items',
      'sidebars.json:0 [sidebar] at /docs/6: the category "Reference" has no items',
    ]);
  });

  it("reports the docs site's own API Reference category, at the top or nested", () => {
    const top = withSidebar((docs) =>
      docs.splice(6, 0, { type: "category", label: "API Reference", items: ["x"] }),
    );
    expect(lines(check({ sidebars: top }))).toContain(
      'sidebars.json:0 [sidebar] at /docs/6: the "API Reference" category is the docs site\'s own, made from api/: remove it',
    );
    const nested = withSidebar((docs) => {
      (docs[4] as { items: unknown[] }).items.push({
        type: "category",
        label: "API Reference",
        items: ["the-model"],
      });
    });
    expect(lines(check({ sidebars: nested }))).toEqual([
      'sidebars.json:0 [sidebar] at /docs/4/items/1: the "API Reference" category is the docs site\'s own, made from api/: remove it',
    ]);
  });

  it("reports an item that is neither a doc nor a category, at either level", () => {
    const sidebar = withSidebar((docs) => {
      (docs[3] as { items: unknown[] }).items.push({ type: "autogenerated", dirName: "." });
      (docs[4] as { items: unknown[] }).items.push({
        type: "category",
        label: "Deep",
        items: [{ type: "category", label: "Deeper", items: ["the-model"] }],
      });
    });
    expect(lines(check({ sidebars: sidebar }))).toEqual([
      "sidebars.json:0 [sidebar] at /docs/3/items/1: a category holds doc ids, or categories of doc ids one level down",
      "sidebars.json:0 [sidebar] at /docs/4/items/1/items/0: a category one level down holds doc ids only",
    ]);
  });

  it("reads only a doc item with a string id as a doc, and only a labelled category as one", () => {
    const sidebar = withSidebar((docs) => {
      docs[0] = { type: "ref", id: "intro" };
      (docs[3] as { items: unknown[] }).items.push({ type: "doc", id: 5 }, { type: "doc" });
      (docs[4] as { items: unknown[] }).items.push({
        type: "link",
        label: "Out",
        href: "https://x",
      });
    });
    expect(lines(check({ sidebars: sidebar }))).toEqual([
      'sidebars.json:0 [sidebar] at /docs/0: the sidebar opens with the overview page, "intro"',
      "sidebars.json:0 [sidebar] at /docs/3/items/1: a category holds doc ids, or categories of doc ids one level down",
      "sidebars.json:0 [sidebar] at /docs/3/items/2: a category holds doc ids, or categories of doc ids one level down",
      "sidebars.json:0 [sidebar] at /docs/4/items/1: a category holds doc ids, or categories of doc ids one level down",
      "intro.md:0 [listing] the sidebar does not list it",
    ]);
  });

  it("ends the categories at the first item that is not a labelled category", () => {
    const sidebar = withSidebar((docs) => {
      docs.splice(1, 0, { type: "category", label: 5, items: ["installation"] });
    });
    const found = lines(check({ sidebars: sidebar }));
    expect(found).toContain(
      'sidebars.json:0 [sidebar] at /docs: the category "Installation" is missing',
    );
    expect(found).toContain(
      'sidebars.json:0 [sidebar] at /docs/1: after the categories, the sidebar lists "testing-and-quality" then "performance" and nothing else',
    );
    const unlabelled = withSidebar((docs) => {
      docs.splice(1, 0, { type: "link", label: "Home", href: "https://x" });
    });
    expect(lines(check({ sidebars: unlabelled }))).toContain(
      'sidebars.json:0 [sidebar] at /docs: the category "Installation" is missing',
    );
    const notRecord = withSidebar((docs) => docs.splice(1, 0, ["category"]));
    expect(lines(check({ sidebars: notRecord }))).toContain(
      'sidebars.json:0 [sidebar] at /docs: the category "Installation" is missing',
    );
  });

  it("reports quality pages that are missing, out of order, or followed by anything", () => {
    const missing = withSidebar((docs) => docs.splice(6, 2));
    expect(lines(check({ sidebars: missing }))).toEqual([
      'sidebars.json:0 [sidebar] at /docs/6: after the categories, the sidebar lists "testing-and-quality" then "performance" and nothing else',
      'sidebars.json:0 [sidebar] at /docs/7: after the categories, the sidebar lists "testing-and-quality" then "performance" and nothing else',
      "testing-and-quality.md:0 [listing] the sidebar does not list it",
      "performance.md:0 [listing] the sidebar does not list it",
    ]);
    const swapped = withSidebar((docs) => docs.splice(6, 2, "performance", "testing-and-quality"));
    expect(lines(check({ sidebars: swapped }))).toEqual([
      'sidebars.json:0 [sidebar] at /docs/6: after the categories, the sidebar lists "testing-and-quality" then "performance" and nothing else',
      'sidebars.json:0 [sidebar] at /docs/7: after the categories, the sidebar lists "testing-and-quality" then "performance" and nothing else',
      "testing-and-quality.md:0 [listing] the sidebar does not list it",
      "performance.md:0 [listing] the sidebar does not list it",
    ]);
    const extra = withSidebar((docs) => docs.push("extra", { type: "link", href: "https://x" }));
    expect(lines(check({ sidebars: extra, pages: [...minimalPages(), page("extra")] }))).toEqual([
      'sidebars.json:0 [sidebar] at /docs/8: after the categories, the sidebar lists "testing-and-quality" then "performance" and nothing else',
      'sidebars.json:0 [sidebar] at /docs/9: after the categories, the sidebar lists "testing-and-quality" then "performance" and nothing else',
    ]);
  });

  it("reports a category after the quality pages as an item out of place", () => {
    const sidebar = withSidebar((docs) =>
      docs.push({ type: "category", label: "Reference", items: ["codes"] }),
    );
    expect(lines(check({ sidebars: sidebar, pages: [...minimalPages(), page("codes")] }))).toEqual([
      'sidebars.json:0 [sidebar] at /docs/8: after the categories, the sidebar lists "testing-and-quality" then "performance" and nothing else',
      "codes.md:0 [listing] the sidebar does not list it",
    ]);
  });
});

describe("listing", () => {
  it("reports an id that is not a page, and a page listed twice", () => {
    const sidebar = withSidebar((docs) => {
      (docs[3] as { items: unknown[] }).items.push("gone", "the-model");
    });
    expect(lines(check({ sidebars: sidebar }))).toEqual([
      'sidebars.json:0 [listing] lists "gone", which is not a page',
      'sidebars.json:0 [listing] lists "the-model" 2 times',
    ]);
  });

  it("reports a page the sidebar does not list", () => {
    expect(lines(check({ pages: [...minimalPages(), page("orphan")] }))).toEqual([
      "orphan.md:0 [listing] the sidebar does not list it",
    ]);
  });
});

describe("required-page", () => {
  it.each(REQUIRED_PAGES)("reports %s when it is missing", (name) => {
    const found = lines(check({ pages: minimalPages().filter((p) => p.name !== name) }));
    expect(found).toContain(`${name}.md:0 [required-page] every library has this page`);
    expect(found).toContain(`sidebars.json:0 [listing] lists "${name}", which is not a page`);
  });
});

describe("front-matter", () => {
  function frontMatter(name: string, block: string): Page {
    return { name, text: `---\n${block}\n---\n\n# ${name}\n` };
  }

  function only(p: Page): string[] {
    const pages = minimalPages().map((existing) => (existing.name === p.name ? p : existing));
    return lines(check({ pages })).filter((l) => l.includes("[front-matter]"));
  }

  it("reports a page with no front matter, and one that never closes it", () => {
    expect(only({ name: "the-model", text: "# The model\n" })).toEqual([
      "the-model.md:1 [front-matter] the page does not open with front matter (a first line ---)",
    ]);
    expect(only({ name: "the-model", text: "---\nid: the-model\n# The model\n" })).toEqual([
      "the-model.md:1 [front-matter] the front matter opens with --- and never closes",
      "the-model.md:1 [front-matter] id is missing",
      "the-model.md:1 [front-matter] title is missing",
      "the-model.md:1 [front-matter] sidebar_label is missing",
      "the-model.md:1 [front-matter] description is missing",
    ]);
  });

  it("reports each missing and each empty key, a value of spaces counting as empty", () => {
    expect(only(frontMatter("the-model", "id: the-model\ntitle:\nsidebar_label: '  '"))).toEqual([
      "the-model.md:3 [front-matter] title is empty",
      "the-model.md:4 [front-matter] sidebar_label is empty",
      "the-model.md:1 [front-matter] description is missing",
    ]);
  });

  it("reports an id that is not the file name", () => {
    expect(
      only(frontMatter("the-model", 'id: model\ntitle: T\nsidebar_label: T\ndescription: "D."')),
    ).toEqual([
      'the-model.md:2 [front-matter] id is "model"; it must be the file name, "the-model"',
    ]);
  });

  it("reports a description over the limit, and accepts one at it", () => {
    const at = "d".repeat(DESCRIPTION_LIMIT);
    const block = (d: string) => `id: the-model\ntitle: T\nsidebar_label: T\ndescription: "${d}"`;
    expect(only(frontMatter("the-model", block(at)))).toEqual([]);
    expect(only(frontMatter("the-model", block(`${at}d`)))).toEqual([
      "the-model.md:5 [front-matter] description is 161 characters; the limit is 160",
    ]);
  });

  it("reports sidebar_position", () => {
    expect(
      only(
        frontMatter(
          "the-model",
          "id: the-model\ntitle: T\nsidebar_label: T\ndescription: D.\nsidebar_position: 3",
        ),
      ),
    ).toEqual([
      "the-model.md:6 [front-matter] sidebar_position: the sidebar sets the order, remove it",
    ]);
  });

  it("skips blank lines, and reports a key that is indented or not followed by a space", () => {
    expect(
      only(
        frontMatter(
          "the-model",
          "id: the-model\n   \n title: T\nsidebar_label:T\ntitle: T\nsidebar_label: T\ndescription: D.",
        ),
      ),
    ).toEqual([
      "the-model.md:4 [front-matter] is not one `key: value` line",
      "the-model.md:5 [front-matter] is not one `key: value` line",
    ]);
  });

  it("reports a line that is not key: value, an unclosed quote and a repeated key", () => {
    expect(
      only(
        frontMatter(
          "the-model",
          'id: the-model\ntitle: T\n  - list\nsidebar_label: "open\ndescription: D.\ntitle: again',
        ),
      ),
    ).toEqual([
      "the-model.md:4 [front-matter] is not one `key: value` line",
      "the-model.md:5 [front-matter] sidebar_label: the quoted value is not closed",
      "the-model.md:7 [front-matter] title appears twice",
      "the-model.md:1 [front-matter] sidebar_label is missing",
    ]);
  });
});

describe("parseFrontMatter", () => {
  it("unquotes double and single quoted values, with their escapes", () => {
    const { fields, errors, present } = parseFrontMatter(
      [
        "---",
        'a: "say \\"hi\\" \\\\ there"',
        "b: 'it''s'",
        "f: ''",
        "c: plain: with colon ",
        "",
        "d:",
        'e: ""',
        "---",
        "body",
      ].join("\n"),
    );
    expect(present).toBe(true);
    expect(errors).toEqual([]);
    expect(Object.fromEntries([...fields].map(([k, v]) => [k, v]))).toEqual({
      a: { value: 'say "hi" \\ there', line: 2 },
      b: { value: "it's", line: 3 },
      c: { value: "plain: with colon", line: 5 },
      d: { value: "", line: 7 },
      e: { value: "", line: 8 },
      f: { value: "", line: 4 },
    });
  });

  it.each([
    ['"', 'a: "'],
    ["'", "a: '"],
    ['"x', 'a: "x'],
    ["'x", "a: 'x"],
    ['"x\\"', 'a: "x\\"'],
  ])("refuses the unclosed quote %s", (_label, line) => {
    expect(parseFrontMatter(`---\n${line}\n---\n`).errors).toEqual([
      { line: 2, message: "a: the quoted value is not closed" },
    ]);
  });

  it("reads CRLF line endings", () => {
    const { fields, errors } = parseFrontMatter("---\r\nid: x\r\n---\r\n");
    expect(errors).toEqual([]);
    expect(fields.get("id")).toEqual({ value: "x", line: 2 });
  });

  it("is absent when the first line is not ---", () => {
    expect(parseFrontMatter("\n---\nid: x\n---\n")).toEqual({
      fields: new Map(),
      errors: [],
      present: false,
    });
  });
});

describe("file-name", () => {
  it("reports a page name that is not lower-case and hyphenated", () => {
    const sidebar = withSidebar((docs) => {
      (docs[3] as { items: unknown[] }).items.push("Read_A_Field", "a--b", "-a", "a-");
    });
    const pages = [...minimalPages(), page("Read_A_Field"), page("a--b"), page("-a"), page("a-")];
    expect(
      lines(check({ sidebars: sidebar, pages })).filter((l) => l.includes("[file-name]")),
    ).toEqual([
      "Read_A_Field.md:0 [file-name] a page name is lower-case words joined by single hyphens",
      "a--b.md:0 [file-name] a page name is lower-case words joined by single hyphens",
      "-a.md:0 [file-name] a page name is lower-case words joined by single hyphens",
      "a-.md:0 [file-name] a page name is lower-case words joined by single hyphens",
    ]);
  });

  it("reports markdown that is not a top-level .md page", () => {
    expect(lines(check({ misplaced: ["guides/a.md", "b.mdx"] }))).toEqual([
      "guides/a.md:0 [file-name] a page is a .md file at the top of docs-content/: move or rename it",
      "b.mdx:0 [file-name] a page is a .md file at the top of docs-content/: move or rename it",
    ]);
  });
});

describe("numbers", () => {
  it.each(QUALITY_PAGES)("reports %s without the numbers heading", (name) => {
    const pages = minimalPages().map((p) =>
      p.name === name ? page(name, "## Current numbers soon\n\n### Current numbers\n") : p,
    );
    expect(lines(check({ pages }))).toEqual([
      `${name}.md:0 [numbers] the page has no "## Current numbers" heading: the generated numbers go in that section`,
    ]);
  });

  it("does not ask another page for the heading", () => {
    expect(check({ pages: minimalPages() })).toEqual([]);
  });

  it("reads the heading on a CRLF page", () => {
    const pages = minimalPages().map((p) =>
      p.name === "performance" ? { ...p, text: p.text.replaceAll("\n", "\r\n") } : p,
    );
    expect(check({ pages })).toEqual([]);
  });
});

describe("numbers: the section holds only the placeholder", () => {
  /** The finding for a section whose heading is on `line` of the page `name`. */
  const finding = (name: string, line: number): string =>
    `${name}.md:${line} [numbers] the section holds only the placeholder until the release ` +
    `fills it in: "${NUMBERS_PLACEHOLDER}"`;

  /** The minimal tree with one quality page's body replaced. */
  function withBody(name: string, body: string): Page[] {
    return minimalPages().map((p) => (p.name === name ? page(name, body) : p));
  }

  // page() puts the body on line 10: 6 lines of front matter, a blank, the title and a blank.
  const at = 10;

  it.each(QUALITY_PAGES)("reports %s with hand-typed numbers in the section", (name) => {
    const body = `${NUMBERS_HEADING}\n\n| Lines | 98% |\n| --- | --- |\n`;
    expect(lines(check({ pages: withBody(name, body) }))).toEqual([finding(name, at)]);
  });

  it("reports the placeholder with anything added before or after it", () => {
    for (const body of [
      `${NUMBERS_HEADING}\n\n${NUMBERS_PLACEHOLDER} Coverage is 98%.\n`,
      `${NUMBERS_HEADING}\n\nCoverage is 98%.\n\n${NUMBERS_PLACEHOLDER}\n`,
      `${NUMBERS_HEADING}\n\n${NUMBERS_PLACEHOLDER}\n\n### Coverage\n\n98%.\n`,
      `${NUMBERS_HEADING}\n\n${NUMBERS_PLACEHOLDER.slice(0, -1)}\n`,
    ]) {
      expect(lines(check({ pages: withBody("performance", body) }))).toEqual([
        finding("performance", at),
      ]);
    }
  });

  it("reports an empty section, at the end of the page or before the next heading", () => {
    for (const body of [`${NUMBERS_HEADING}\n`, `${NUMBERS_HEADING}\n\n## Method\n\nText.\n`]) {
      expect(lines(check({ pages: withBody("performance", body) }))).toEqual([
        finding("performance", at),
      ]);
    }
  });

  it("accepts the placeholder wrapped over lines, with CRLF ends, before a heading of level 1 or 2", () => {
    const wrapped = NUMBERS_PLACEHOLDER.replace(" at each", "\nat each").replace(
      " They",
      "\n  They",
    );
    for (const body of [
      `${NUMBERS_HEADING}\n\n${wrapped}\n\n## Method\n\nAnything, typed by hand.\n`,
      `${NUMBERS_HEADING}\n${NUMBERS_PLACEHOLDER}\n   # Next\n\n| Lines | 98% |\n`,
      `${NUMBERS_HEADING}\n\n${NUMBERS_PLACEHOLDER}\n##\nText.\n`,
      `${NUMBERS_HEADING}\n\n${NUMBERS_PLACEHOLDER}\n##\tTabbed\nText.\n`,
      `Intro.\n\n${NUMBERS_HEADING}\r\n\r\n${wrapped.replaceAll("\n", "\r\n")}\r\n`,
    ]) {
      expect(check({ pages: withBody("testing-and-quality", body) })).toEqual([]);
    }
  });

  it("reads a deeper heading, or one indented four spaces, as part of the section", () => {
    for (const body of [
      `${NUMBERS_HEADING}\n\n${NUMBERS_PLACEHOLDER}\n### Coverage\n`,
      `${NUMBERS_HEADING}\n\n${NUMBERS_PLACEHOLDER}\n    ## Indented\n`,
      `${NUMBERS_HEADING}\n\n${NUMBERS_PLACEHOLDER}\n##Joined\n`,
    ]) {
      expect(lines(check({ pages: withBody("performance", body) }))).toEqual([
        finding("performance", at),
      ]);
    }
  });

  it("checks every section with the heading, each at its own line", () => {
    const body =
      `${NUMBERS_HEADING}\n\n${NUMBERS_PLACEHOLDER}\n\n` +
      `## Method\n\nText.\n\n${NUMBERS_HEADING}\n\n| p50 | 2 ms |\n`;
    expect(lines(check({ pages: withBody("performance", body) }))).toEqual([
      finding("performance", 18),
    ]);
  });

  it("reads a section that runs to the end of a page with no last line end", () => {
    const pages = withBody("performance", `${NUMBERS_HEADING}\n\n${NUMBERS_PLACEHOLDER}`);
    expect(check({ pages })).toEqual([]);
  });

  it("does not read the section of a page that is not a quality page", () => {
    const pages = [...minimalPages().filter((p) => p.name !== "the-model")];
    pages.push(page("the-model", `${NUMBERS_HEADING}\n\nAnything.\n`));
    expect(check({ pages })).toEqual([]);
  });
});

describe("headingAnchors", () => {
  /** The anchors of a page, in the order they were made. */
  const anchors = (text: string): string[] => [...headingAnchors(text)];

  it("slugs a heading the way the docs site does", () => {
    expect(
      anchors(
        [
          "# @cosyte/hl7",
          "## Functions",
          "### parseHL7()",
          "### ACK\\_CODES",
          "##### $ref?",
          "##### OML^O59\\_A",
          "## Class: Field\\<T\\>",
          "## Two  spaces and a\ttab",
          "## Café Über ½ ²",
          "###### Get Signature",
        ].join("\n"),
      ),
    ).toEqual([
      "cosytehl7",
      "functions",
      "parsehl7",
      "ack_codes",
      "ref",
      "omlo59_a",
      "class-fieldt",
      "two--spaces-and-atab",
      "café-über--",
      "get-signature",
    ]);
  });

  it("numbers a repeated slug in page order, skipping one already taken", () => {
    expect(
      anchors(
        ["## Example", "## Example", "### Example", "## Example-1", "## a-1", "## a", "## a"].join(
          "\n",
        ),
      ),
    ).toEqual(["example", "example-1", "example-2", "example-1-1", "a-1", "a", "a-2"]);
    expect(anchors("## !\n## ?\n## Text")).toEqual(["", "-1", "text"]);
  });

  it("reads a code span as its content, and a link or an image as its text", () => {
    expect(
      anchors(
        [
          "## `parse_HL7`",
          "## ``a`b`` c",
          "## `unclosed",
          "## ``two` one",
          "## [Field](./field.md) and ![Logo](./img/logo.png)",
          "## [Open](no closing",
          "## Ends with ]",
          "## \\`not code\\`",
          "## a\\b \\_c\\",
          "## `a](b)c`",
          "## \\](not a link)",
          "## a\\](b)",
          "## \\`a](b)\\`",
          "## x]y (z)",
          "##   Padded   ",
          "## End\\",
        ].join("\n"),
      ),
    ).toEqual([
      "parse_hl7",
      "ab-c",
      "unclosed",
      "two-one",
      "field-and-logo",
      "openno-closing",
      "ends-with-",
      "not-code",
      "ab-_c",
      "abc",
      "not-a-link",
      "ab",
      "a",
      "xy-z",
      "padded",
      "end",
    ]);
  });

  it("drops the closing run of # and keeps a # that is part of the text", () => {
    expect(
      anchors(["## Title ##", "## Title\t#", "## C#", "## #", "### ###", "## A # B"].join("\n")),
    ).toEqual(["title", "title-1", "c", "", "-1", "a--b"]);
  });

  it("reads only ATX headings of one to six #, indented at most three spaces, outside code", () => {
    expect(
      anchors(
        [
          "   ### Indented three",
          "    ## Indented four",
          "####### Seven",
          "#hashtag",
          "##",
          "```ts",
          "## In a fence",
          "```",
          "~~~~",
          "## In a tilde fence",
          "~~~",
          "```",
          "## Still in it",
          "~~~~",
          "## After",
          "```",
          "  ````md",
          "## In a fence that a longer run with text after it does not close",
          "```` trailing",
          "````  ",
          "## Out",
          "````",
          "```",
          "## Hidden: a shorter run does not close a fence",
          "````",
          "~~~",
          "```",
          "## Hidden: backticks do not close a tilde fence",
          "~~~",
          "Prose with ``` in it opens no fence.",
          "## Visible",
          "```",
          "## In an unclosed fence",
        ].join("\n"),
      ),
    ).toEqual(["indented-three", "", "after", "out", "visible"]);
  });

  it("reads CRLF line ends", () => {
    expect(anchors("## One\r\n## Two ##\r\n")).toEqual(["one", "two"]);
  });
});

describe("reference-link", () => {
  const REFERENCE = new Map([
    [
      "README.md",
      "# @cosyte/example\n\n## Functions\n\n### parseThing()\n\n#### Example\n\n#### Example\n",
    ],
    ["@cosyte/namespaces/text.md", "# text\n\n## Variables\n\n### ESCAPES\n"],
  ]);

  /** The minimal tree with a how-to guide whose body is `body`, checked against REFERENCE. */
  function guide(body: string, reference: Map<string, string> | null = REFERENCE): string[] {
    const pages = minimalPages().map((p) => (p.name === "read-a-field" ? page(p.name, body) : p));
    return lines(check({ pages, ...(reference === null ? {} : { reference }) }));
  }

  it("accepts a link to a generated page, with or without an anchor its headings give", () => {
    expect(
      guide(
        [
          "See [`parseThing`](./api/README.md#parsething) and [the reference](./api/README.md).",
          "The [second example](./api/README.md#example-1), and",
          '[`ESCAPES`](./api/@cosyte/namespaces/text.md#escapes "title").',
          "[With brackets](<./api/README.md#functions>), [spaced]( ./api/README.md#example).",
          "[defined]: ./api/README.md#cosyteexample",
          "   [defined too]: <./api/@cosyte/namespaces/text.md#variables> 'title'",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("reports a page that is not generated, naming the page and the line", () => {
    expect(guide("Text.\n\nSee [x](./api/Missing.md#x).\n")).toEqual([
      "read-a-field.md:12 [reference-link] links ./api/Missing.md#x, but there is no page api/Missing.md",
    ]);
  });

  it("reports an anchor no heading on the page gives", () => {
    expect(
      guide(
        "[a](./api/README.md#parseThing) [b](./api/README.md#example-2)\n[c]: ./api/README.md#",
      ),
    ).toEqual([
      'read-a-field.md:10 [reference-link] links ./api/README.md#parseThing, but no heading on api/README.md has the anchor "parseThing"',
      'read-a-field.md:10 [reference-link] links ./api/README.md#example-2, but no heading on api/README.md has the anchor "example-2"',
      'read-a-field.md:11 [reference-link] links ./api/README.md#, but no heading on api/README.md has the anchor ""',
    ]);
  });

  it("reads a destination after spaces or in angle brackets, or running to the end of the line", () => {
    const missing = (target: string, line = 10): string =>
      `read-a-field.md:${line} [reference-link] links ${target}, but there is no page api/Missing.md`;
    expect(
      guide(
        [
          "[`a`](./api/Missing.md#code-in-the-text) and `b` after it",
          "[a](./api/Missing.md#before-a-stray-backtick) and a stray `",
          "[a label]: ./api/Missing.md#long-label",
          "[x]:./api/Missing.md#no-space",
        ].join("\n"),
      ),
    ).toEqual([
      missing("./api/Missing.md#code-in-the-text"),
      missing("./api/Missing.md#before-a-stray-backtick", 11),
      missing("./api/Missing.md#long-label", 12),
      missing("./api/Missing.md#no-space", 13),
    ]);
    expect(guide("[x](  ./api/Missing.md)")).toEqual([missing("./api/Missing.md")]);
    expect(guide("[x](<./api/Missing.md#a b>)")).toEqual([missing("./api/Missing.md#a")]);
    expect(guide("[x](./api/Missing.md#open")).toEqual([missing("./api/Missing.md#open")]);
  });

  it("reports a link into the reference that names no page", () => {
    const shape = (target: string): string =>
      `read-a-field.md:10 [reference-link] links ${target}: a link into the reference is ` +
      "./api/<page>.md, with an optional #<anchor>";
    for (const target of [
      "./api/",
      "./api/README",
      "./api/#functions",
      "./api/../intro.md",
      "./api/./README.md",
      "./api//README.md",
      "./api/README.mdx",
    ]) {
      expect(guide(`[x](${target})`)).toEqual([shape(target)]);
    }
  });

  it("reports every link into the reference as missing when no generated page was read", () => {
    expect(guide("[x](./api/README.md)", null)).toEqual([
      "read-a-field.md:10 [reference-link] links ./api/README.md, but there is no page api/README.md",
    ]);
  });

  it("reads no link in code, and no link outside the reference", () => {
    expect(
      guide(
        [
          "`[x](./api/Missing.md)` and ``[y](./api/Missing.md) ` `` and `[z](./api/README.md#functions)",
          "```md",
          "[x](./api/Missing.md)",
          "```",
          "[x](./api.md) [y](../api/Missing.md) [z](https://example.com/api/Missing.md)",
          "[w](api/Missing.md) [v](./guides/api/Missing.md) [u]: ../api/Missing.md",
          "[t](./other.md#api) ](",
          "  ./api/Missing.md is a path in prose, not a link",
          "]`code`(./api/Missing.md) is no link, nor is [x]`(./api/Missing.md)",
          "See [x]: ./api/Missing.md, which is prose and no definition.",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("checks every page that links, caching each generated page's anchors", () => {
    const pages = minimalPages().map((p) =>
      p.name === "the-model" || p.name === "intro"
        ? page(p.name, "[a](./api/README.md#functions) [b](./api/README.md#nope)")
        : p,
    );
    expect(lines(check({ pages, reference: REFERENCE }))).toEqual([
      'intro.md:10 [reference-link] links ./api/README.md#nope, but no heading on api/README.md has the anchor "nope"',
      'the-model.md:10 [reference-link] links ./api/README.md#nope, but no heading on api/README.md has the anchor "nope"',
    ]);
  });
});

describe("readDocsContent and the command line", () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "docs-content-check-"));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function tree(label: string, files: Record<string, string>): string {
    const dir = join(root, label);
    mkdirSync(dir, { recursive: true });
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    return dir;
  }

  function minimalTree(label: string, extra: Record<string, string> = {}): string {
    const files: Record<string, string> = {
      "docs-content/sidebars.json": JSON.stringify(minimalSidebar()),
    };
    for (const p of minimalPages()) files[`docs-content/${p.name}.md`] = p.text;
    return tree(label, { ...files, ...extra });
  }

  function capture(): { stream: { write(text: string): boolean }; text: () => string } {
    let text = "";
    return {
      stream: {
        write(chunk: string) {
          text += chunk;
          return true;
        },
      },
      text: () => text,
    };
  }

  function cli(argv: string[], dir?: string): { code: number; out: string; err: string } {
    const out = capture();
    const err = capture();
    const code = runDocsContentCheck({
      argv,
      ...(dir === undefined ? {} : { dir }),
      stdout: out.stream,
      stderr: err.stream,
    });
    return { code, out: out.text(), err: err.text() };
  }

  it("reads top-level pages, the sidebar, the generated pages, and lists misplaced markdown", () => {
    const dir = minimalTree("read", {
      "docs-content/zz/z.md": "# nested, written first\n",
      "docs-content/api/README.md": "# generated\n",
      "docs-content/api/deep/x.md": "# generated, deeper\n",
      "docs-content/api/deep/x.mdx": "# not a generated page\n",
      "docs-content/api/sidebars.json": "{}",
      "docs-content/api/notes.txt": "not markdown",
      "docs-content/guides/a.md": "# nested\n",
      "docs-content/guides/sidebars.json": "{}",
      "docs-content/guides/notes.md.bak": "a backup",
      "docs-content/guides/img.png": "png",
      "docs-content/b.mdx": "# mdx\n",
      "docs-content/C.MD": "# upper\n",
      "docs-content/notes.txt": "not markdown",
      "docs-content/img/logo.svg": "<svg/>",
    });
    const input = readDocsContent(dir);
    expect(input.pages.map((p) => p.name)).toEqual([...minimalPages().map((p) => p.name)].sort());
    expect(input.sidebars).toBe(JSON.stringify(minimalSidebar()));
    expect(input.misplaced).toEqual(["C.MD", "b.mdx", "guides/a.md", "zz/z.md"]);
    expect([...input.reference]).toEqual([
      ["README.md", "# generated\n"],
      ["deep/x.md", "# generated, deeper\n"],
    ]);
  });

  it("refuses a generated page that is not a regular file", () => {
    const dir = minimalTree("linked-reference", { "docs-content/api/README.md": "# x\n" });
    symlinkSync(
      join(dir, "docs-content", "api", "README.md"),
      join(dir, "docs-content", "api", "x.md"),
    );
    expect(() => readDocsContent(dir)).toThrow(/api\/x\.md is not a regular file\.$/);
  });

  it("exits 1 on a link into the reference that does not resolve, and 0 once it does", () => {
    const body = (anchor: string): string =>
      page("read-a-field", `See [\`parseThing\`](./api/README.md#${anchor}).\n`).text;
    const broken = minimalTree("reference-broken", {
      "docs-content/read-a-field.md": body("parse-thing"),
      "docs-content/api/README.md": "# @cosyte/example\n\n### parseThing()\n",
    });
    expect(cli(["--dir", broken])).toEqual({
      code: 1,
      out: "",
      err:
        "docs-content: 1 finding(s) in 8 page(s).\n" +
        "  docs-content/read-a-field.md:10 [reference-link] links ./api/README.md#parse-thing, " +
        'but no heading on api/README.md has the anchor "parse-thing"\n',
    });
    const fixed = minimalTree("reference-fixed", {
      "docs-content/read-a-field.md": body("parsething"),
      "docs-content/api/README.md": "# @cosyte/example\n\n### parseThing()\n",
    });
    expect(cli(["--dir", fixed]).code).toBe(0);
  });

  it("returns a null sidebar when sidebars.json is absent", () => {
    const dir = tree("no-sidebar", { "docs-content/intro.md": page("intro").text });
    expect(readDocsContent(dir).sidebars).toBeNull();
  });

  it("refuses a repository with no docs-content/ folder, or a file in its place", () => {
    expect(() => readDocsContent(tree("none", { "README.md": "# x\n" }))).toThrow(
      DocsContentRefusal,
    );
    expect(() => readDocsContent(tree("file", { "docs-content": "not a folder" }))).toThrow(
      /docs-content is not a directory\.$/,
    );
  });

  it("refuses a page or a sidebar that is not a regular file", () => {
    const linked = minimalTree("linked");
    rmSync(join(linked, "docs-content", "intro.md"));
    symlinkSync(
      join(linked, "docs-content", "quickstart.md"),
      join(linked, "docs-content", "intro.md"),
    );
    expect(() => readDocsContent(linked)).toThrow(/intro\.md is not a regular file\.$/);
    const sidebar = minimalTree("linked-sidebar", { "elsewhere.json": "{}" });
    rmSync(join(sidebar, "docs-content", "sidebars.json"));
    symlinkSync(join(sidebar, "elsewhere.json"), join(sidebar, "docs-content", "sidebars.json"));
    expect(() => readDocsContent(sidebar)).toThrow(DocsContentRefusal);
    expect(() => readDocsContent(sidebar)).toThrow(/sidebars\.json is not a regular file\.$/);
  });

  it.skipIf(process.getuid?.() === 0)("refuses a page or a folder it cannot read", () => {
    const page = minimalTree("unreadable-page");
    const intro = join(page, "docs-content", "intro.md");
    chmodSync(intro, 0o000);
    try {
      expect(() => readDocsContent(page)).toThrow(/intro\.md could not be read \(EACCES\)\.$/);
    } finally {
      chmodSync(intro, 0o644);
    }
    const folder = minimalTree("unreadable-folder", { "docs-content/guides/a.md": "# a\n" });
    const guides = join(folder, "docs-content", "guides");
    chmodSync(guides, 0o000);
    try {
      expect(() => readDocsContent(folder)).toThrow(/guides could not be listed \(EACCES\)\.$/);
    } finally {
      chmodSync(guides, 0o755);
    }
  });

  it("exits 0 on a tree that keeps the standard, saying how many pages it read", () => {
    const r = cli(["--dir", minimalTree("clean")]);
    expect(r).toEqual({ code: 0, out: "docs-content: OK (8 page(s) checked)\n", err: "" });
  });

  it("exits 1 on a finding, naming the file, the line and the rule", () => {
    const dir = minimalTree("finding", {
      "docs-content/the-model.md":
        "---\nid: other\ntitle: T\nsidebar_label: T\ndescription: D.\n---\n",
    });
    const r = cli(["--dir", dir]);
    expect(r.code).toBe(1);
    expect(r.out).toBe("");
    expect(r.err).toBe(
      "docs-content: 1 finding(s) in 8 page(s).\n" +
        '  docs-content/the-model.md:2 [front-matter] id is "other"; it must be the file name, "the-model"\n',
    );
  });

  it("prints a finding with no line without a line number, one finding a line", () => {
    const dir = minimalTree("no-line", {
      "docs-content/orphan.md": page("orphan").text,
      "docs-content/stray.md": page("stray").text,
    });
    expect(cli(["--dir", dir]).err).toBe(
      "docs-content: 2 finding(s) in 10 page(s).\n" +
        "  docs-content/orphan.md [listing] the sidebar does not list it\n" +
        "  docs-content/stray.md [listing] the sidebar does not list it\n",
    );
  });

  it("exits 2 when it cannot read, and on an argument it does not accept", () => {
    const missing = cli(["--dir", join(root, "absent")]);
    expect(missing.code).toBe(2);
    expect(missing.err).toBe(
      `docs-content: ${join(root, "absent", "docs-content")} is not a directory. Nothing was checked.\n`,
    );
    for (const argv of [["--strict"], ["--dir"], ["--strict", "x"]]) {
      const r = cli(argv, minimalTree("args"));
      expect(r.code).toBe(2);
      expect(r.err).toBe(
        `docs-content: ${JSON.stringify(argv[0])} is not an argument this check accepts (only ` +
          "--dir <repository root>). Nothing was checked.\n",
      );
    }
  });

  it("reads the working directory and writes to the process streams by default", () => {
    const cwd = vi.spyOn(process, "cwd");
    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      cwd.mockReturnValue(minimalTree("cwd"));
      expect(runDocsContentCheck()).toBe(0);
      expect(out).toHaveBeenCalledWith("docs-content: OK (8 page(s) checked)\n");
      cwd.mockReturnValue(root);
      expect(runDocsContentCheck()).toBe(2);
      expect(err).toHaveBeenCalledWith(
        `docs-content: ${join(root, "docs-content")} is not a directory. Nothing was checked.\n`,
      );
    } finally {
      cwd.mockRestore();
      out.mockRestore();
      err.mockRestore();
    }
  });
});
