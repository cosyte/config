/**
 * The command-line bins of @cosyte/script-utils (D56): one per gate, and `script-utils`, the
 * dispatcher npx runs by the package's own name. Every bin is run here: its `--help`, and one real
 * verdict, so a bin that loads nothing, or loads the gate and never calls it, reds. Under CI every
 * `--help` is refused, so a CI step that only asks for help cannot pass.
 *
 * Fixtures are throwaway directories and git repositories in a temp directory; every value is
 * synthetic.
 *
 * SECURITY: every subprocess call uses spawnSync with array args. No exec, no shell form.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PACKAGE_DIR = join(import.meta.dirname, "..");
const BIN_DIR = join(PACKAGE_DIR, "bin");
const MANIFEST = JSON.parse(readFileSync(join(PACKAGE_DIR, "package.json"), "utf8")) as {
  bin: Record<string, string>;
  files: string[];
};

const GATE_BINS = [
  "cosyte-no-emdash",
  "cosyte-attw",
  "cosyte-phi-scan",
  "cosyte-internal-refs",
  "cosyte-readme",
  "cosyte-claude-card",
  "cosyte-agent-notes",
  "cosyte-catalog",
  "cosyte-ratchet",
  "cosyte-docs-content",
  "cosyte-release-pr",
];

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "script-utils-bins-"));
  // The dash bin runs the shell gate shipped beside the entry points, which the build copies in.
  if (!existsSync(join(PACKAGE_DIR, "check-no-emdash.sh"))) {
    const built = spawnSync(
      process.execPath,
      [join(PACKAGE_DIR, "..", "..", "scripts", "pack-emdash-gate.mjs")],
      {
        cwd: PACKAGE_DIR,
        encoding: "utf8",
      },
    );
    if (built.status !== 0) throw new Error(`could not build the dash gate: ${built.stderr}`);
  }
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/** The environment of this run with `CI` removed, the way a terminal session sees it. */
function withoutCi(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env["CI"];
  return env;
}

function run(
  bin: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = withoutCi(),
): { code: number; out: string; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [join(BIN_DIR, `${bin}.js`), ...args], {
    cwd,
    env,
    encoding: "utf8",
    timeout: 120_000,
  });
  const stdout = r.stdout ?? "";
  const stderr = r.stderr ?? "";
  return { code: r.status ?? -1, out: `${stdout}${stderr}`, stdout, stderr };
}

/** A directory with these files, as a git repository with every file tracked when `git` is set. */
function fixture(label: string, files: Record<string, string>, git = false): string {
  const dir = join(root, label);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  mkdirSync(dir, { recursive: true });
  if (git) {
    for (const args of [
      ["init", "-q", "."],
      ["add", "."],
    ]) {
      const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
      if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
    }
  }
  return dir;
}

describe("the bin map", () => {
  it("declares the dispatcher and one bin per gate, each a file that is packed", () => {
    expect(Object.keys(MANIFEST.bin).sort()).toEqual(["script-utils", ...GATE_BINS].sort());
    expect(MANIFEST.files).toContain("bin");
    for (const [name, target] of Object.entries(MANIFEST.bin)) {
      expect(target, name).toBe(`bin/${name}.js`);
      expect(existsSync(join(PACKAGE_DIR, target)), target).toBe(true);
      expect(readFileSync(join(PACKAGE_DIR, target), "utf8"), target).toMatch(
        /^#!\/usr\/bin\/env node\n/,
      );
    }
  });
});

describe.each(GATE_BINS)("%s", (bin) => {
  it("prints its help and exits 0 at a terminal", () => {
    for (const flag of ["--help", "-h"]) {
      const r = run(bin, [flag], root);
      expect(r.code, r.out).toBe(0);
      expect(r.stdout.length, flag).toBeGreaterThan(40);
    }
  });

  it("refuses --help under CI, so a CI step that only asks for help cannot pass", () => {
    // A package script `"attw": "cosyte-attw --help"` passed CI having checked nothing.
    for (const ci of ["true", "1"]) {
      for (const flag of ["--help", "-h"]) {
        const r = run(bin, [flag], root, { ...withoutCi(), CI: ci });
        expect(r.code, `${flag} with CI=${ci}: ${r.out}`).not.toBe(0);
        expect(r.stdout, `${flag} with CI=${ci}`).toBe("");
        expect(r.stderr, `${flag} with CI=${ci}`).toContain("refusing --help under CI");
      }
    }
    // `CI=false` and `CI=0` are the runners' own way of saying "not CI".
    for (const ci of ["false", "0", ""]) {
      expect(run(bin, ["--help"], root, { ...withoutCi(), CI: ci }).code, `CI=${ci}`).toBe(0);
    }
  });
});

describe("each bin reaches its gate and returns the gate's verdict", () => {
  it("cosyte-no-emdash: refuses a tracked dash and passes a clean tree", () => {
    const dash = String.fromCharCode(0x2014);
    expect(
      run("cosyte-no-emdash", [], fixture("dash-red", { "a.txt": `a ${dash} b\n` }, true)).code,
    ).toBe(1);
    const clean = run("cosyte-no-emdash", [], fixture("dash-green", { "a.txt": "a, b\n" }, true));
    expect(clean.code, clean.out).toBe(0);
  });

  it("cosyte-attw: refuses, naming the binary, in a package with no attw installed", () => {
    const dir = fixture("attw", {
      "package.json": JSON.stringify({ name: "x", version: "1.0.0", main: "./index.js" }),
      "index.js": "module.exports = 1;\n",
    });
    const r = run("cosyte-attw", ["--no-definitely-typed"], dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain(join(dir, "node_modules", ".bin", "attw"));
  });

  it("cosyte-phi-scan: finds the floor's shape and names the place, not the value", () => {
    const ssn = ["123", "45", "6789"].join("-");
    const dir = fixture(
      "phi",
      { "scripts/phi-allow-list.txt": "EMAILDOMAIN example.com\n", "a.txt": `id ${ssn}\n` },
      true,
    );
    const r = run("cosyte-phi-scan", [], dir);
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("a.txt");
    expect(r.out).not.toContain(ssn);
  });

  it("cosyte-phi-scan: scans a repository with no allow list against the one --allow-list names", () => {
    const ssn = ["123", "45", "6789"].join("-");
    const dir = fixture("phi-bare", { "a.txt": `id ${ssn}\n` }, true);
    const list = join(root, "phi-empty-allow-list.txt");
    writeFileSync(list, "");
    expect(run("cosyte-phi-scan", [], dir).code).toBe(2);
    const r = run("cosyte-phi-scan", ["--allow-list", list], dir);
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("a.txt");
    expect(r.out).not.toContain(ssn);
  });

  it("cosyte-internal-refs: exits 2 with no axes file, so a missing config is not read as clean", () => {
    const r = run("cosyte-internal-refs", [], fixture("irefs", { "README.md": "# x\n" }, true));
    expect(r.code).toBe(2);
    expect(r.out).toContain("scripts/internal-refs.json");
  });

  it("cosyte-readme: refuses a README with no skeleton", () => {
    const dir = fixture("readme", {
      "package.json": JSON.stringify({
        name: "@cosyte/demo",
        repository: "https://github.com/cosyte/demo",
        engines: { node: ">=22" },
      }),
      "README.md": "# @cosyte/demo\n",
    });
    const r = run("cosyte-readme", [], dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain("[tile]");
  });

  it("cosyte-claude-card: passes a card that follows the spec", () => {
    const card =
      "# demo\n\nOur demo.\n\n## Gate\n\npnpm test\n\n## Hazard\n\nNone.\n\n## Rules\n\n- One.\n";
    const r = run("cosyte-claude-card", [], fixture("card", { "CLAUDE.md": card }));
    expect(r.code, r.out).toBe(0);
  });

  it("cosyte-agent-notes: refuses a dangling pointer", () => {
    const dir = fixture(
      "notes",
      {
        "CLAUDE.md": "# demo\n\nSee documentation/agent-notes.md#gone.\n",
        "documentation/agent-notes.md": "# Notes\n\n## Here\n\nText.\n",
      },
      true,
    );
    const r = run("cosyte-agent-notes", [], dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain("[dangling]");
  });

  it("cosyte-agent-notes: passes a repository whose notes are gone, with one line (D62)", () => {
    const dir = fixture(
      "notes-gone",
      { "CLAUDE.md": "# demo\n\nSee documentation/agent-notes.md#gone.\n" },
      true,
    );
    const r = run("cosyte-agent-notes", [], dir);
    expect(r.code, r.out).toBe(0);
    expect(r.stdout).toBe("agent notes: OK, no agent notes (retired, D62)\n");
    expect(r.stderr).toBe("");
  });

  it("cosyte-agent-notes: says in its help that it is deprecated", () => {
    const r = run("cosyte-agent-notes", ["--help"], root);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("deprecated (D62)");
    // Help checks nothing, so it never prints the line a passing run prints.
    expect(r.stdout).not.toContain("agent notes: OK");
  });

  it("cosyte-catalog: notes a package the catalog does not list, and refuses it with --strict", () => {
    const dir = fixture("catalog", {
      "package.json": JSON.stringify({ name: "@cosyte/nothing", description: "x" }),
    });
    const advisory = run("cosyte-catalog", [], dir);
    expect(advisory.code, advisory.out).toBe(0);
    expect(advisory.out).toContain("does not list");
    expect(run("cosyte-catalog", ["--strict"], dir).code).toBe(2);
  });
});

describe("cosyte-ratchet, from its bin", () => {
  it("passes a floor that held, fails one that dropped, and exits 2 with no floor file", () => {
    const summary = (pct: number) =>
      JSON.stringify({
        total: Object.fromEntries(
          ["lines", "branches", "functions", "statements"].map((m) => [m, { pct }]),
        ),
      });
    const floor = JSON.stringify({ packages: { ".": { coverage: { lines: 80 } } } });
    const held = fixture("ratchet-held", {
      "quality-floor.json": floor,
      "coverage/coverage-summary.json": summary(85),
    });
    const ok = run("cosyte-ratchet", ["check"], held);
    expect(ok.code, ok.out).toBe(0);
    expect(ok.stdout).toContain("  lines          85.00     80.00     15.00\n");
    const dropped = fixture("ratchet-dropped", {
      "quality-floor.json": floor,
      "coverage/coverage-summary.json": summary(79.99),
    });
    expect(run("cosyte-ratchet", ["check"], dropped).code).toBe(1);
    const none = run("cosyte-ratchet", ["check"], fixture("ratchet-none", { "a.txt": "a\n" }));
    expect(none.code).toBe(2);
    expect(none.stderr).toMatch(/^cosyte-ratchet: could not run: the floor file /);
    expect(none.stdout).toBe("");
  });
});

describe("cosyte-docs-content reaches its check", () => {
  it("refuses a page with no front matter, and exits 2 with no docs-content/ folder", () => {
    const dir = fixture("docs-content", {
      "docs-content/sidebars.json": JSON.stringify({ docs: ["intro"] }),
      "docs-content/intro.md": "# Intro\n",
    });
    const r = run("cosyte-docs-content", [], dir);
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("docs-content/intro.md:1 [front-matter]");
    expect(run("cosyte-docs-content", [], fixture("no-docs", { "a.txt": "a\n" })).code).toBe(2);
    expect(run("script-utils", ["docs-content", "--dir", dir], root).code).toBe(1);
  });
});

describe("cosyte-release-pr reaches its check", () => {
  it("refuses a version script that skips the API reference, and exits 2 with no package.json", () => {
    const dir = fixture("release-pr", {
      "package.json": JSON.stringify({
        name: "@cosyte/demo",
        scripts: { version: "changeset version && cosyte-process sync-version" },
      }),
      "src/index.ts": 'export const VERSION: string = "0.0.0";\n',
    });
    const r = run("cosyte-release-pr", [], dir);
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("package.json [version-script]");
    expect(r.out).toContain("cosyte-docs-reference");
    expect(r.out).toContain("test/ [version-test]");
    expect(run("cosyte-release-pr", [], fixture("no-package", { "a.txt": "a\n" })).code).toBe(2);
    expect(run("script-utils", ["release-pr", "--dir", dir], root).code).toBe(1);
  });
});

describe("script-utils, the dispatcher npx runs by the package's name", () => {
  it("lists every command with --help, and exits 2 with none", () => {
    const help = run("script-utils", ["--help"], root);
    expect(help.code).toBe(0);
    for (const command of [
      "no-emdash",
      "attw",
      "phi-scan",
      "internal-refs",
      "readme",
      "claude-card",
      "agent-notes",
      "catalog",
      "ratchet",
      "docs-content",
      "release-pr",
    ]) {
      expect(help.out, command).toContain(command);
    }
    expect(help.out).toMatch(/agent-notes +the agent-notes checker, deprecated by D62/);
    expect(run("script-utils", [], root).code).toBe(2);
    expect(run("script-utils", ["no-such-gate"], root).code).toBe(2);
  });

  it("refuses --help under CI, its own and a gate's", () => {
    const ci = { ...withoutCi(), CI: "true" };
    const own = run("script-utils", ["--help"], root, ci);
    expect(own.code).toBe(2);
    expect(own.stderr).toContain("refusing --help under CI");
    const gate = run("script-utils", ["readme", "--help"], root, ci);
    expect(gate.code).toBe(2);
    expect(gate.stderr).toContain("cosyte-readme: refusing --help under CI");
  });

  it("runs a gate and returns its verdict, its help included", () => {
    const card =
      "# demo\n\nOur demo.\n\n## Gate\n\npnpm test\n\n## Hazard\n\nNone.\n\n## Rules\n\n- One.\n";
    const dir = fixture("dispatch", { "CLAUDE.md": card });
    expect(run("script-utils", ["claude-card"], dir).code).toBe(0);
    expect(run("script-utils", ["claude-card", "--dir", join(root, "nowhere")], dir).code).toBe(2);
    const help = run("script-utils", ["readme", "--help"], dir);
    expect(help.code).toBe(0);
    expect(help.out).toContain("cosyte-readme");
  });
});
