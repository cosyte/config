/**
 * The README gate, `@cosyte/script-utils/readme`: one README that follows the house skeleton, and
 * for every rule a mutation of it that must go red on that rule.
 *
 * Every README here is built in this file from a synthetic manifest (`@cosyte/demo`). No other
 * repository is read.
 *
 * SECURITY: every subprocess call uses spawnSync with array args. No exec, no shell form.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  README_CHARACTER_LIMIT,
  README_RULES,
  REQUIRED_SECTIONS,
  TILE,
  TILE_ALT,
  badgeRow,
  checkReadme,
} from "../readme.js";

const GATE = join(import.meta.dirname, "..", "readme.js");

const MANIFEST = {
  name: "@cosyte/demo",
  version: "0.1.0",
  repository: { type: "git", url: "git+https://github.com/cosyte/demo.git" },
  engines: { node: ">=22" },
};

const LICENSE_URL = "https://github.com/cosyte/demo/blob/main/LICENSE";

/** A README that follows the skeleton, with one extra section and a code fence in the body. */
function good(): string {
  return [
    TILE,
    "",
    "# @cosyte/demo",
    "",
    "> Parse demo messages and pull out the fields you need in one line.",
    "",
    ...badgeRow(MANIFEST),
    "",
    "## Why this exists",
    "",
    "Demo messages are hard to read by hand.",
    "",
    "## Status",
    "",
    "On the 0.1 line.",
    "",
    "## Install",
    "",
    "```sh",
    "pnpm add @cosyte/demo",
    "```",
    "",
    "## Usage",
    "",
    "```ts",
    'import { parseDemo } from "@cosyte/demo";',
    "## Not a heading, because it is inside a fence",
    "```",
    "",
    "## Documentation",
    "",
    "The full reference is at [docs.cosyte.com](https://docs.cosyte.com/demo).",
    "",
    "## Support",
    "",
    "Ask in [GitHub issues](https://github.com/cosyte/demo/issues).",
    "",
    "## Security",
    "",
    "Report a vulnerability to security@cosyte.com.",
    "",
    "## Contributing",
    "",
    "Pull requests are welcome.",
    "",
    "## License",
    "",
    `MIT, Cosyte LLC. See [LICENSE](${LICENSE_URL}).`,
    "",
  ].join("\n");
}

/** Replace exactly one occurrence, and fail if the anchor is not there, so no case goes vacuous. */
function replaceOnce(text: string, from: string, to: string): string {
  const at = text.indexOf(from);
  if (at < 0 || text.indexOf(from, at + 1) >= 0) {
    throw new Error(`the fixture does not contain ${JSON.stringify(from)} exactly once`);
  }
  return text.slice(0, at) + to + text.slice(at + from.length);
}

function rules(text: string, manifest: Record<string, unknown> = MANIFEST): string[] {
  return checkReadme(text, manifest).map((f) => f.rule);
}

describe("a README that follows the skeleton", () => {
  it("has no findings", () => {
    expect(checkReadme(good(), MANIFEST)).toEqual([]);
  });

  it("names every rule it can raise, and each case below exercises one", () => {
    expect(Object.keys(README_RULES).sort()).toEqual(
      [
        "badges",
        "docs-link",
        "license-last",
        "license-link",
        "section-empty",
        "section-missing",
        "section-order",
        "size",
        "tagline",
        "tile",
        "tile-alt",
        "title",
      ].sort(),
    );
    expect(REQUIRED_SECTIONS).toEqual([
      "Why this exists",
      "Status",
      "Install",
      "Usage",
      "Support",
      "Security",
      "Contributing",
      "License",
    ]);
  });

  it("derives the badge row from package.json", () => {
    expect(badgeRow(MANIFEST)).toEqual([
      "[![npm version](https://img.shields.io/npm/v/@cosyte/demo.svg)](https://www.npmjs.com/package/@cosyte/demo)",
      "[![CI](https://img.shields.io/github/actions/workflow/status/cosyte/demo/ci.yml?branch=main&label=CI)](https://github.com/cosyte/demo/actions/workflows/ci.yml)",
      `[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](${LICENSE_URL})`,
      "[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](https://nodejs.org)",
    ]);
  });
});

describe("each rule goes red on its own", () => {
  it("tile: a README that does not open with the tile", () => {
    const text = good().slice(TILE.length + 1);
    expect(rules(text)).toEqual(["tile"]);
  });

  it("tile: a tile with the dark image as the fallback", () => {
    const text = replaceOnce(
      good(),
      'src="https://cosyte.com/tile/cosyte-lockup-tile-on-light-1200x300.png"',
      'src="https://cosyte.com/tile/cosyte-lockup-tile-on-dark-1200x300.png"',
    );
    expect(rules(text)).toEqual(["tile"]);
  });

  it("tile-alt: the right tile with any other alt text", () => {
    const text = replaceOnce(
      good(),
      `alt="${TILE_ALT}"`,
      'alt="Cosyte: a plus mark set in two overlapping rounded squares"',
    );
    expect(rules(text)).toEqual(["tile-alt"]);
    expect(checkReadme(text, MANIFEST)[0]?.message).toContain(TILE_ALT);
  });

  it("title: an H1 that is not the package name", () => {
    expect(rules(replaceOnce(good(), "# @cosyte/demo\n", "# Demo\n"))).toEqual(["title"]);
  });

  it("tagline: missing", () => {
    const text = replaceOnce(
      good(),
      "> Parse demo messages and pull out the fields you need in one line.\n\n",
      "",
    );
    expect(rules(text)).toContain("tagline");
  });

  it("tagline: wrapped onto a second line", () => {
    const text = replaceOnce(good(), "you need in one line.", "you need\n> in one line.");
    expect(rules(text)).toEqual(["tagline"]);
  });

  it("tagline: longer than the limit", () => {
    const text = replaceOnce(good(), "in one line.", `in one line. ${"x".repeat(80)}`);
    expect(rules(text)).toEqual(["tagline"]);
  });

  it("badges: one missing", () => {
    const text = replaceOnce(good(), `${badgeRow(MANIFEST)[1]}\n`, "");
    expect(rules(text)).toEqual(["badges"]);
  });

  it("badges: a relative LICENSE link, which breaks on npm", () => {
    const text = replaceOnce(good(), `(${LICENSE_URL})\n[![Node]`, "(./LICENSE)\n[![Node]");
    expect(rules(text)).toEqual(["badges"]);
  });

  it("badges: a fifth badge in the row", () => {
    const text = replaceOnce(
      good(),
      "(https://nodejs.org)\n",
      "(https://nodejs.org)\n[![Extra](https://img.shields.io/badge/x-y-blue.svg)](https://cosyte.com)\n",
    );
    expect(rules(text)).toEqual(["badges"]);
  });

  it("badges: a Node badge that disagrees with engines.node", () => {
    expect(rules(good(), { ...MANIFEST, engines: { node: ">=24" } })).toEqual(["badges"]);
  });

  for (const name of REQUIRED_SECTIONS) {
    if (name === "License" || name === "Usage" || name === "Support") continue;
    it(`section-missing: no "## ${name}"`, () => {
      const text = replaceOnce(good(), `## ${name}\n`, `### ${name}\n`);
      expect(rules(text)).toEqual(["section-missing"]);
      expect(checkReadme(text, MANIFEST)[0]?.message).toContain(`## ${name}`);
    });
  }

  it('section-missing: "## Security" only inside a code fence does not count', () => {
    const text = replaceOnce(
      good(),
      "## Security\n\nReport a vulnerability to security@cosyte.com.\n\n",
      "```md\n## Security\n```\n\n",
    );
    expect(rules(text)).toEqual(["section-missing"]);
  });

  it("section-order: Security before Support", () => {
    const text = replaceOnce(
      replaceOnce(good(), "## Support\n", "## Security-placeholder\n"),
      "## Security\n",
      "## Support\n",
    ).replace("## Security-placeholder\n", "## Security\n");
    expect(rules(text)).toContain("section-order");
  });

  it("section-empty: a heading with nothing under it", () => {
    const text = replaceOnce(good(), "On the 0.1 line.\n\n", "");
    expect(rules(text)).toEqual(["section-empty"]);
  });

  it("license-last: a section after License", () => {
    expect(rules(`${good()}\n## Appendix\n\nMore.\n`)).toEqual(["license-last"]);
  });

  it("license-last: a ### inside the License section is part of it", () => {
    expect(rules(`${good()}\n### Third-party notices\n\nNone.\n`)).toEqual([]);
  });

  it("license-link: a relative LICENSE link in the License section", () => {
    const text = replaceOnce(good(), `See [LICENSE](${LICENSE_URL}).`, "See [LICENSE](./LICENSE).");
    expect(rules(text)).toEqual(["license-link"]);
  });

  it("docs-link: no link to docs.cosyte.com", () => {
    const text = replaceOnce(
      good(),
      "The full reference is at [docs.cosyte.com](https://docs.cosyte.com/demo).",
      "The full reference is on our documentation site.",
    );
    expect(rules(text)).toEqual(["docs-link"]);
  });

  it("docs-link: a link to another package's page", () => {
    const text = replaceOnce(
      good(),
      "(https://docs.cosyte.com/demo)",
      "(https://docs.cosyte.com/demox)",
    );
    expect(rules(text)).toEqual(["docs-link"]);
  });

  it("docs-link: the link only after Support", () => {
    const text = replaceOnce(
      replaceOnce(
        good(),
        "The full reference is at [docs.cosyte.com](https://docs.cosyte.com/demo).",
        "See below.",
      ),
      "Pull requests are welcome.",
      "Pull requests are welcome. [Docs](https://docs.cosyte.com/demo/intro).",
    );
    expect(rules(text)).toEqual(["docs-link"]);
  });

  it("docs-link: a page under the package's docs, or an autolink, counts", () => {
    const deeper = replaceOnce(
      good(),
      "(https://docs.cosyte.com/demo)",
      "(https://docs.cosyte.com/demo/intro#start)",
    );
    expect(rules(deeper)).toEqual([]);
    const autolink = replaceOnce(
      good(),
      "[docs.cosyte.com](https://docs.cosyte.com/demo)",
      "<https://docs.cosyte.com/demo>",
    );
    expect(rules(autolink)).toEqual([]);
  });

  it("size: one character over the limit, and not at the limit", () => {
    const base = good();
    const pad = (n: number): string =>
      replaceOnce(base, "Pull requests are welcome.", `Pull requests are welcome.${"a".repeat(n)}`);
    const atLimit = pad(README_CHARACTER_LIMIT - base.length);
    expect(atLimit.length).toBe(README_CHARACTER_LIMIT);
    expect(rules(atLimit)).toEqual([]);
    const over = pad(README_CHARACTER_LIMIT - base.length + 1);
    expect(rules(over)).toEqual(["size"]);
  });
});

describe("input the gate does not control", () => {
  it("reads a heading line padded with a long run of tabs in linear time", () => {
    // A heading pattern of the shape `[ \t]+(.*?)[ \t]*#*[ \t]*$` backtracks polynomially on
    // this line; the reader that replaced it walks it once.
    const started = Date.now();
    checkReadme(`${good()}\n## ${"\t".repeat(200_000)}x\n`, MANIFEST);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe("a manifest the skeleton cannot be derived from is refused, not graded", () => {
  it.each([
    ["no @cosyte name", { ...MANIFEST, name: "demo" }],
    ["no github.com/cosyte repository", { ...MANIFEST, repository: "https://example.com/demo" }],
    ["no engines.node", { ...MANIFEST, engines: {} }],
  ])("%s", (_label, manifest) => {
    expect(() => checkReadme(good(), manifest)).toThrow(TypeError);
  });
});

describe("the CLI", () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "readme-gate-"));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function pkg(label: string, readme: string | null, manifest: unknown = MANIFEST): string {
    const dir = join(root, label);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify(manifest));
    if (readme !== null) writeFileSync(join(dir, "README.md"), readme);
    return dir;
  }

  function cli(args: string[], cwd: string, gate = GATE): { code: number; out: string } {
    const r = spawnSync(process.execPath, [gate, ...args], { cwd, encoding: "utf8" });
    return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  }

  it("exits 0 on a README that follows the skeleton", () => {
    const r = cli([], pkg("good", good()));
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("follows the house skeleton");
  });

  it("exits 1 and names the rule and the line on a finding", () => {
    const r = cli([], pkg("finding", replaceOnce(good(), "# @cosyte/demo\n", "# Demo\n")));
    expect(r.code).toBe(1);
    expect(r.out).toContain("README.md:8 [title]");
  });

  it("reads --dir, and -- before it as pnpm forwards it", () => {
    const dir = pkg("by-dir", good());
    expect(cli(["--dir", dir], root).code).toBe(0);
    expect(cli(["--", "--dir", dir], root).code).toBe(0);
  });

  it("exits 2 when there is no README", () => {
    const r = cli([], pkg("no-readme", null));
    expect(r.code).toBe(2);
    expect(r.out).toContain("could not read");
  });

  it("exits 2 when package.json cannot supply the skeleton", () => {
    const r = cli([], pkg("bad-manifest", good(), { name: "demo" }));
    expect(r.code).toBe(2);
    expect(r.out).toContain("Nothing was checked");
  });

  it("exits 2 on an argument it does not accept", () => {
    const r = cli(["--fix"], pkg("bad-arg", good()));
    expect(r.code).toBe(2);
  });

  it("runs when reached through a symlinked node_modules, as a consumer reaches it", () => {
    // pnpm links an installed package into node_modules, so the path node is handed is not the
    // file's real path. A guard that compared the two as strings would exit 0 without running; the
    // finding below proves it ran.
    const consumer = pkg("consumer", replaceOnce(good(), "# @cosyte/demo\n", "# Demo\n"));
    mkdirSync(join(consumer, "node_modules", "@cosyte"), { recursive: true });
    symlinkSync(
      join(import.meta.dirname, ".."),
      join(consumer, "node_modules", "@cosyte", "script-utils"),
      "dir",
    );
    const r = cli(
      [],
      consumer,
      join(consumer, "node_modules", "@cosyte", "script-utils", "readme.js"),
    );
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("[title]");
  });
});
