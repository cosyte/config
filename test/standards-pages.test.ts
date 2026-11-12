import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseFrontMatter } from "../packages/script-utils/docs-content.js";
import {
  DOCS_DIR,
  PAGES,
  RECORDS_DIR,
  pageFromRecord,
  rewriteTarget,
  run,
  splitCodeSpans,
} from "../scripts/standards-pages.mjs";

/**
 * The testing and performance standards as pages for docs.cosyte.com: written from their decision
 * records by scripts/standards-pages.mjs, held to them in CI by its `--check`, and packed into the
 * `docs-content.tar.gz` a release carries by scripts/pack-docs-content.sh.
 */

const REPO_ROOT = join(import.meta.dirname, "..");
const SCRIPT = join(REPO_ROOT, "scripts", "standards-pages.mjs");
const PACK = join(REPO_ROOT, "scripts", "pack-docs-content.sh");
const read = (path: string): string => readFileSync(join(REPO_ROOT, path), "utf8");

const scratches: string[] = [];
afterEach(() => {
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A throwaway tree holding the records and the pages, as the repository has them. */
function scratchRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "standards-pages-"));
  scratches.push(root);
  mkdirSync(join(root, RECORDS_DIR), { recursive: true });
  mkdirSync(join(root, DOCS_DIR));
  for (const name of readdirSync(join(REPO_ROOT, RECORDS_DIR))) {
    copyFileSync(join(REPO_ROOT, RECORDS_DIR, name), join(root, RECORDS_DIR, name));
  }
  // What the records link to elsewhere in the repository, as an empty file or folder of its kind.
  for (const page of PAGES) {
    const text = read(`${RECORDS_DIR}/${page.record}`);
    for (const [, path] of text.matchAll(/\]\(\.\.\/\.\.\/([^)#\s]+?)\/?(?:#[^)]*)?\)/g)) {
      if (statSync(join(REPO_ROOT, path!)).isDirectory()) {
        mkdirSync(join(root, path!), { recursive: true });
      } else {
        mkdirSync(dirname(join(root, path!)), { recursive: true });
        writeFileSync(join(root, path!), "");
      }
    }
  }
  for (const name of readdirSync(join(REPO_ROOT, DOCS_DIR))) {
    copyFileSync(join(REPO_ROOT, DOCS_DIR, name), join(root, DOCS_DIR, name));
  }
  return root;
}

const context = (root: string) => ({ root, pages: PAGES });
const PAGE = PAGES[0]!;

describe("the committed pages", () => {
  it("match what their records write", async () => {
    const lines: string[] = [];
    expect(await run({ root: REPO_ROOT, check: true, log: (l) => lines.push(l) })).toBe(0);
    expect(lines).toEqual(["standards-pages: 2 page(s) match their records."]);
  });

  it("are the sidebar's Explanation category, after the overview, and nothing else", () => {
    const sidebars = JSON.parse(read(`${DOCS_DIR}/sidebars.json`)) as unknown;
    expect(sidebars).toEqual({
      docs: ["intro", { type: "category", label: "Explanation", items: PAGES.map((p) => p.id) }],
    });
    expect(readdirSync(join(REPO_ROOT, DOCS_DIR)).sort()).toEqual(
      ["intro.md", "sidebars.json", ...PAGES.map((p) => `${p.id}.md`)].sort(),
    );
  });

  it("carry the front matter the site reads, an id that is the file name and a short description", () => {
    for (const id of ["intro", ...PAGES.map((p) => p.id)]) {
      const front = parseFrontMatter(read(`${DOCS_DIR}/${id}.md`));
      expect(front.present && front.errors).toEqual([]);
      expect(front.fields.get("id")?.value).toBe(id);
      for (const key of ["title", "sidebar_label", "description"]) {
        expect(front.fields.get(key)?.value, `${id}: ${key}`).toBeTruthy();
      }
      expect(front.fields.get("description")!.value.length).toBeLessThanOrEqual(160);
    }
  });

  it("send every relative link of a record to the site or to GitHub, none left relative", () => {
    for (const page of PAGES) {
      const text = read(`${DOCS_DIR}/${page.id}.md`);
      expect(text).not.toMatch(/\]\(\.\.\//);
      expect(text).not.toMatch(/\]\(\d{4}-/);
      expect(text).toContain(`${RECORDS_DIR}/${page.record}`);
    }
  });
});

describe("rewriteTarget", () => {
  it("sends a record that is a page to that page, keeping the anchor", () => {
    expect(
      rewriteTarget("0005-the-performance-standard.md#4-the-comparison", context(REPO_ROOT)),
    ).toBe("./performance-standard.md#4-the-comparison");
  });

  it("sends a file to its blob and a folder to its tree on GitHub", () => {
    expect(rewriteTarget("../../quality-floor.json", context(REPO_ROOT))).toBe(
      "https://github.com/cosyte/config/blob/main/quality-floor.json",
    );
    expect(rewriteTarget("../../packages/bench/", context(REPO_ROOT))).toBe(
      "https://github.com/cosyte/config/tree/main/packages/bench",
    );
  });

  it("leaves an address, an anchor and a site path alone", () => {
    for (const target of [
      "https://diataxis.fr",
      "#context",
      "/hl7/intro",
      "ftp://example.org/standard.txt",
    ]) {
      expect(rewriteTarget(target, context(REPO_ROOT))).toBe(target);
    }
  });

  it("refuses a target that is not in the tree or is outside it", () => {
    expect(rewriteTarget("../../no-such-file.md", context(REPO_ROOT))).toBeNull();
    expect(rewriteTarget("../../../hl7/README.md", context(REPO_ROOT))).toBeNull();
  });
});

describe("splitCodeSpans", () => {
  it("keeps prose at even indexes and code spans at odd ones, a span running across lines", () => {
    expect(splitCodeSpans("a `b <c>` d ``e`f`` g `open")).toEqual([
      "a ",
      "`b <c>`",
      " d ",
      "``e`f``",
      " g `open",
    ]);
    expect(splitCodeSpans("x `y\nz` w")).toEqual(["x ", "`y\nz`", " w"]);
  });
});

describe("pageFromRecord", () => {
  const make = (record: string) => pageFromRecord(record, PAGE, context(REPO_ROOT));

  it("puts front matter and the source line in place of the title", () => {
    const { text, findings } = make("# 0004: Old title\n\n## Context\n\nProse.\n");
    expect(findings).toEqual([]);
    expect(text.startsWith(`---\nid: ${PAGE.id}\ntitle: ${PAGE.title}\n`)).toBe(true);
    expect(text).not.toContain("Old title");
    expect(text).toContain("The record is the source");
    expect(text.endsWith("## Context\n\nProse.\n")).toBe(true);
  });

  it("refuses a record with no title", () => {
    expect(make("No title here.\n").findings).toEqual([
      `${RECORDS_DIR}/${PAGE.record}:1: the record has no "# " title line to replace`,
    ]);
  });

  it("rewrites inline links and reference definitions, not links inside code", () => {
    const { text, findings } = make(
      [
        "# T",
        "",
        "See [floor](../../quality-floor.json) and `[x](../../nope.md)`.",
        "",
        "[perf]: 0005-the-performance-standard.md",
        "",
        "```md",
        "[y](../../nope.md) {",
        "```",
      ].join("\n"),
    );
    expect(findings).toEqual([]);
    expect(text).toContain(
      "[floor](https://github.com/cosyte/config/blob/main/quality-floor.json)",
    );
    expect(text).toContain("`[x](../../nope.md)`");
    expect(text).toContain("[perf]: ./performance-standard.md");
    expect(text).toContain("[y](../../nope.md) {");
  });

  it("names the line of a link into nothing, and of a brace or angle bracket in prose", () => {
    const { findings } = make(
      ["# T", "", "One [gone](../../gone.md).", "", "Two", "a {brace} and `a\n<code>` span."].join(
        "\n",
      ),
    );
    expect(findings).toEqual([
      `${RECORDS_DIR}/${PAGE.record}:3: "../../gone.md" is not in this repository`,
      `${RECORDS_DIR}/${PAGE.record}:6: a brace or an angle bracket outside code, which the site's MDX build reads as markup; put it in code`,
    ]);
  });
});

describe("run, against a scratch copy", () => {
  it("reds a page whose record changed, names it, and writes it right", async () => {
    const root = scratchRepo();
    const record = join(root, RECORDS_DIR, PAGES[1]!.record);
    writeFileSync(record, `${readFileSync(record, "utf8")}\nOne more line.\n`);
    const lines: string[] = [];
    expect(await run({ root, check: true, log: (l) => lines.push(l) })).toBe(1);
    expect(lines).toEqual([
      `standards-pages: ${DOCS_DIR}/${PAGES[1]!.id}.md differs from its record; run node scripts/standards-pages.mjs`,
    ]);
    expect(await run({ root, check: false, log: () => undefined })).toBe(0);
    expect(readFileSync(join(root, DOCS_DIR, `${PAGES[1]!.id}.md`), "utf8")).toContain(
      "One more line.",
    );
    expect(await run({ root, check: true, log: () => undefined })).toBe(0);
  });

  it("names a missing page, and writes no page when a record holds a finding", async () => {
    const root = scratchRepo();
    rmSync(join(root, DOCS_DIR, `${PAGE.id}.md`));
    const lines: string[] = [];
    expect(await run({ root, check: true, log: (l) => lines.push(l) })).toBe(1);
    expect(lines[0]).toContain(`${DOCS_DIR}/${PAGE.id}.md is missing`);

    writeFileSync(join(root, RECORDS_DIR, PAGE.record), "# T\n\nA {brace}.\n");
    expect(await run({ root, check: false, log: () => undefined })).toBe(1);
    expect(readdirSync(join(root, DOCS_DIR))).not.toContain(`${PAGE.id}.md`);
  });
});

describe("the command line", () => {
  const cli = (...args: string[]) =>
    spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });

  it("exits 0 on this checkout and 1 on a stale page", () => {
    expect(cli("--check").status).toBe(0);
    const root = scratchRepo();
    writeFileSync(join(root, DOCS_DIR, `${PAGE.id}.md`), "stale\n");
    const result = cli("--check", "--root", root);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("differs from its record");
  });

  it("exits 2 when a record cannot be read, or on an unknown argument", () => {
    const root = scratchRepo();
    rmSync(join(root, RECORDS_DIR, PAGE.record));
    const missing = cli("--check", "--root", root);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain(`could not read ${RECORDS_DIR}/${PAGE.record}`);
    const unknown = cli("--fix");
    expect(unknown.status).toBe(2);
    expect(unknown.stderr).toContain('unknown argument "--fix"');
  });
});

describe("the docs-content archive a release carries", () => {
  /** A scratch tree holding a copy of the packing script and the given docs-content files. */
  const packRoot = (files: Record<string, string>): string => {
    const root = mkdtempSync(join(tmpdir(), "pack-docs-content-"));
    scratches.push(root);
    mkdirSync(join(root, "scripts"));
    copyFileSync(PACK, join(root, "scripts", "pack-docs-content.sh"));
    mkdirSync(join(root, DOCS_DIR));
    for (const [name, text] of Object.entries(files))
      writeFileSync(join(root, DOCS_DIR, name), text);
    return root;
  };
  const pack = (root: string, out: string) =>
    spawnSync("bash", [join(root, "scripts", "pack-docs-content.sh"), out], { encoding: "utf8" });
  const list = (archive: string) =>
    spawnSync("tar", ["--list", "--gzip", "--file", archive], { encoding: "utf8" }).stdout;

  it("holds every file of docs-content/ at its root, and packs the same bytes twice", () => {
    const out = mkdtempSync(join(tmpdir(), "pack-out-"));
    scratches.push(out);
    const first = pack(REPO_ROOT, join(out, "a.tar.gz"));
    expect(first.status, first.stderr).toBe(0);
    expect(list(join(out, "a.tar.gz")).trim().split("\n")).toEqual(
      readdirSync(join(REPO_ROOT, DOCS_DIR)).sort(),
    );
    expect(pack(REPO_ROOT, join(out, "b.tar.gz")).status).toBe(0);
    expect(readFileSync(join(out, "b.tar.gz")).equals(readFileSync(join(out, "a.tar.gz")))).toBe(
      true,
    );
  });

  it("refuses a folder without intro.md or sidebars.json, writing nothing", () => {
    const root = packRoot({ "sidebars.json": "{}\n" });
    const result = pack(root, join(root, "out.tar.gz"));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("docs-content/intro.md is missing");
    expect(readdirSync(root)).not.toContain("out.tar.gz");
    const noSidebar = packRoot({ "intro.md": "x\n" });
    expect(pack(noSidebar, join(noSidebar, "out.tar.gz")).status).toBe(1);
  });

  it("exits 2 without an output file", () => {
    const result = spawnSync("bash", [PACK], { encoding: "utf8" });
    expect(result.status).toBe(2);
  });
});

describe("the workflows", () => {
  it("check the pages and their links on every pull request, in the required verify job", () => {
    const ci = read(".github/workflows/ci.yml");
    const verify = ci.slice(ci.indexOf("  verify:"), ci.indexOf("\n  windows:"));
    expect(verify).toContain("- run: node scripts/standards-pages.mjs --check");
    expect(verify).toContain('node "${checker}" --repo .');
    expect(verify).toMatch(/CHECKER_SHA256: [0-9a-f]{64}\n/);
    expect(verify).toContain("sha256sum --check --strict");
  });

  it("attach the archive to the latest release after the releases are made", () => {
    const release = read(".github/workflows/release.yml");
    const reconcile = release.indexOf(
      "- name: Every package version on npm must have its tag and release",
    );
    const attach = release.indexOf("- name: The latest release carries docs-content.tar.gz");
    expect(reconcile).toBeGreaterThan(-1);
    expect(attach).toBeGreaterThan(reconcile);
    const step = release.slice(attach, release.indexOf("\n      - name:", attach + 1));
    expect(step).toContain('bash scripts/pack-docs-content.sh "$asset"');
    expect(step).toContain('gh release upload "$tag" "$asset" --clobber');
    expect(step).toContain("grep -qx 'docs-content.tar.gz'");
  });
});
