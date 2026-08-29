import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { extractRunnableSnippets, runSnippet } from "@cosyte/vitest-config/snippets";

import { evaluateRepo } from "../scripts/drift-check.js";
import { compareVersions, parseVersion } from "../scripts/install-hardening.mjs";

/**
 * Guards `scripts/parser-template/docs-content`: the full-spine scaffold every new parser copies.
 * It proves two things a broken template would otherwise ship to every future parser at once:
 *
 *  1. The sidebar is the canonical Diátaxis spine (canonical labels, canonical order, no authored
 *     API Reference: the shape `docs`' IA lint enforces).
 *  2. The runnable snippets the template ships actually execute green against the scaffold source,
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

describe("a scaffolded repo is born carrying the install hardening the baseline requires", () => {
  // AC-9. THE ASSERTION IS THE DRIFT CHECK'S OWN VERDICT, not a re-reading of the template's YAML:
  // "born compliant" means the tool that grades thirteen repos finds nothing to say about this one,
  // and asserting that by reading the same file the checker reads would only prove the file exists.
  const manifest = JSON.parse(readFileSync(join(process.cwd(), "drift-manifest.json"), "utf8"));
  const requirement =
    manifest.baselines.package.groups.installHardening.requirements.pnpmInstallHardening;

  it("produces no cooldown or trust-policy drift line", () => {
    // The scaffold copies the template tree wholesale (`copyTree` in scripts/scaffold-parser.mjs),
    // so a copy of the template under a repo-shaped name is the emitted tree for this requirement:
    // nothing in it carries a substitutable token.
    const root = mkdtempSync(join(tmpdir(), "scaffold-hardening-"));
    try {
      cpSync(TEMPLATE, join(root, "scaffolded"), { recursive: true });
      const result = evaluateRepo({
        name: "scaffolded",
        baselineName: "package",
        baseline: {
          repos: ["scaffolded"],
          missingPackageJson: "skip",
          groups: {
            installHardening: {
              provenance: "the committed requirement, read from drift-manifest.json",
              requirements: { pnpmInstallHardening: requirement },
            },
          },
        },
        root,
        probe: () => null,
      });
      expect(result.skipped, "the scaffold must be GRADED, not skipped").toBe(false);
      expect(result.findings).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("NEGATIVE CONTROL: a scaffold without the settings file WOULD be reported as drift", () => {
    // Without this, the assertion above is satisfied by a checker that reports nothing at all.
    const root = mkdtempSync(join(tmpdir(), "scaffold-no-settings-"));
    try {
      mkdirSync(join(root, "scaffolded"));
      writeFileSync(join(root, "scaffolded", "package.json"), "{}", "utf8");
      const result = evaluateRepo({
        name: "scaffolded",
        baselineName: "package",
        baseline: {
          repos: ["scaffolded"],
          missingPackageJson: "skip",
          groups: {
            installHardening: {
              provenance: "the committed requirement, read from drift-manifest.json",
              requirements: { pnpmInstallHardening: requirement },
            },
          },
        },
        root,
        probe: () => null,
      });
      expect(result.findings?.length).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("and it pins a pnpm new enough to actually read those settings", () => {
    // A settings file an older pnpm ignores is decoration rather than defence: minimumReleaseAge
    // arrived in 10.16.0 and trustPolicy in 10.21.0, and the template used to pin pnpm@10.0.0.
    const pinned = JSON.parse(readFileSync(join(TEMPLATE, "package.json"), "utf8")).packageManager;
    const [, version] = String(pinned).split("@");
    const addedIn = manifest.installHardeningProbe.supportedFrom.trustPolicy as string;
    expect(
      compareVersions(parseVersion(version)!, parseVersion(addedIn)!),
      `the template pins ${pinned}, older than the ${addedIn} that added trustPolicy`,
    ).toBeGreaterThanOrEqual(0);
  });
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
  // remapped to it: the same fast source-resolution the template's own docs-content.test.ts uses.
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
