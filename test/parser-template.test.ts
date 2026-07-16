import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { extractRunnableSnippets, runSnippet } from "@cosyte/vitest-config/snippets";

/**
 * Guards `scripts/parser-template/docs-content` — the full-spine scaffold every new parser copies.
 * It proves two things a broken template would otherwise ship to every future parser at once:
 *
 *  1. The sidebar is the canonical Diátaxis spine (canonical labels, canonical order, no authored
 *     API Reference — the shape `docs`' IA lint enforces).
 *  2. The runnable snippets the template ships actually execute green against the scaffold source —
 *     i.e. a freshly-scaffolded parser's doc/code-agreement gate passes on day one.
 *
 * Tokens are substituted here exactly as `scripts/scaffold-parser.mjs` does (name `demo`), so this
 * exercises the real post-scaffold content rather than the raw `{{...}}` template.
 */

const TEMPLATE = join(process.cwd(), "scripts", "parser-template");
const TMP = join(process.cwd(), ".cosyte-template-check");

const TOKENS: Record<string, string> = {
  "{{PKG}}": "@cosyte/demo",
  "{{NAME}}": "demo",
  "{{TITLE}}": "Demo",
  "{{Pascal}}": "Demo",
};

function substitute(text: string): string {
  let out = text;
  for (const [token, value] of Object.entries(TOKENS)) out = out.split(token).join(value);
  return out;
}

afterAll(() => {
  try {
    rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

describe("parser-template docs-content spine", () => {
  const sidebar = JSON.parse(readFileSync(join(TEMPLATE, "docs-content", "sidebars.json"), "utf8"));

  it("is the canonical spine: an intro doc then canonically-ordered categories, no authored API Reference", () => {
    const canonical = [
      "Overview",
      "Installation",
      "Quickstart",
      "Core Concepts",
      "Guides",
      "API Reference",
      "Troubleshooting",
    ];
    expect(Array.isArray(sidebar.docs)).toBe(true);
    expect(sidebar.docs[0]).toBe("intro"); // Overview slot

    const labels = sidebar.docs
      .filter(
        (d: unknown): d is { type: string; label: string } =>
          typeof d === "object" && d !== null && (d as { type?: string }).type === "category",
      )
      .map((c: { label: string }) => c.label);

    expect(labels).not.toContain("API Reference"); // resolver-injected, never authored (IA030)
    for (const label of labels) expect(canonical).toContain(label); // canonical labels only
    const positions = labels.map((l: string) => canonical.indexOf(l));
    expect(positions).toEqual([...positions].sort((a, b) => a - b)); // canonical order
  });
});

describe("parser-template runnable snippets pass against the scaffold source", () => {
  // Materialize the substituted scaffold source so a snippet's `import ... from "@cosyte/demo"` can be
  // remapped to it — the same fast source-resolution the template's own docs-content.test.ts uses.
  mkdirSync(TMP, { recursive: true });
  const srcPath = join(TMP, "index.ts");
  writeFileSync(
    srcPath,
    substitute(readFileSync(join(TEMPLATE, "src", "index.ts"), "utf8")),
    "utf8",
  );

  const quickstart = substitute(
    readFileSync(join(TEMPLATE, "docs-content", "quickstart.md"), "utf8"),
  );
  const snippets = extractRunnableSnippets(quickstart);

  it("ships at least one runnable snippet in the quickstart", () => {
    expect(snippets.length).toBeGreaterThan(0);
  });

  snippets.forEach((snippet, i) => {
    it(`quickstart runnable snippet #${i + 1} executes green`, async () => {
      await runSnippet(snippet, {
        tmpDir: TMP,
        resolve: (spec) => (spec === "@cosyte/demo" ? srcPath : undefined),
      });
    });
  });
});
