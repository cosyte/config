import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

// THE NEGATIVE CONTROL FOR THE EMPTY-CHANGESET GUARD.
//
// The defect: `changesets/action` given only inert changesets logs "All changesets are empty; not
// creating PR", publishes nothing, and EXITS 0. Run 30640138565 was approved as a real publish,
// reported success, and shipped none of six packages that were a patch ahead of the registry.
//
// A guard against a silent no-op is worth exactly what its negative control proves, so this suite
// asserts BOTH directions and is committed alongside the guard rather than run once by hand:
//
//   NEGATIVE  an inert changeset must make the guard exit NON-ZERO.
//   POSITIVE  a real changeset must make the guard exit ZERO.
//
// Only the pair is evidence. A guard that refuses everything also fails the negative case, and a
// guard that refuses nothing also passes the positive one.
//
// It drives the SHIPPED CLI with execFileSync rather than calling the exported `guard()`, because
// the thing release.yml depends on is the process exit code, and an exported function returning
// `{ ok: false }` proves nothing about what `node scripts/changeset-guard.mjs` exits with. This
// repo has already been bitten by that exact gap: `scripts/attw.mjs`'s wrapper exited 0 on an
// untyped pack while its unit surface reported the failure correctly (PR #42).

const GUARD = join(import.meta.dirname, "..", "scripts", "changeset-guard.mjs");

const temporaryDirs: string[] = [];

afterEach(() => {
  while (temporaryDirs.length > 0) {
    const dir = temporaryDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Build a throwaway workspace with a `packages/` tree and a `.changeset/` directory.
 *
 * The guard resolves real package names out of `packages/<dir>/package.json`, so the fixture has to
 * carry them: asserting against invented names would test a different program.
 *
 * @param changesets Map of changeset filename to contents.
 * @returns The workspace root.
 */
function workspaceWith(changesets: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "changeset-guard-"));
  temporaryDirs.push(root);
  for (const name of ["tsconfig", "eslint-config"]) {
    const dir = join(root, "packages", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: `@cosyte/${name}`, version: "0.0.1" }),
      "utf8",
    );
  }
  const changesetDir = join(root, ".changeset");
  mkdirSync(changesetDir, { recursive: true });
  writeFileSync(join(changesetDir, "config.json"), JSON.stringify({ changelog: false }), "utf8");
  writeFileSync(join(changesetDir, "README.md"), "# Changesets\n", "utf8");
  for (const [filename, contents] of Object.entries(changesets)) {
    writeFileSync(join(changesetDir, filename), contents, "utf8");
  }
  return root;
}

/**
 * Run the guard CLI against a workspace and capture its exit code and output.
 *
 * @param root The workspace root.
 * @returns The exit code and combined output.
 */
function runGuard(root: string): { code: number; output: string } {
  try {
    const stdout = execFileSync("node", [GUARD, "--workspace", root], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, output: stdout };
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? -1, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

/** A changeset that bumps a real package and says why. This is what a good one looks like. */
const REAL_CHANGESET = `---
"@cosyte/tsconfig": patch
---

Raise the compiler target, which every consumer inherits.
`;

/** The exact shape that shipped the silent no-op: valid file, human summary, zero releases. */
const EMPTY_FRONTMATTER_CHANGESET = `---
---

A perfectly good summary attached to a changeset that bumps nothing.
`;

describe("changeset-guard: the negative control", () => {
  it("REFUSES a changeset whose frontmatter declares no packages", () => {
    const { code, output } = runGuard(workspaceWith({ "inert.md": EMPTY_FRONTMATTER_CHANGESET }));

    // Non-zero is the whole point: the failure being closed is a green run that published nothing.
    expect(code).toBe(1);
    expect(output).toContain("inert.md");
    expect(output).toContain("declares no packages");
    // The message must name the consequence, not just the shape. A reader who sees "empty
    // frontmatter" fixes a lint; a reader who sees "publishes nothing and exits 0" fixes a release.
    expect(output).toContain("All changesets are empty; not creating PR");
  });

  it("ACCEPTS a changeset that bumps a real package and carries a summary", () => {
    const { code, output } = runGuard(workspaceWith({ "real.md": REAL_CHANGESET }));

    expect(code).toBe(0);
    expect(output).toContain("changeset-guard: OK");
  });

  it("still REFUSES when an inert changeset sits alongside a real one", () => {
    // The pairing matters. With a real changeset present the action DOES open a Version PR, so the
    // repo-level symptom disappears while the inert file remains a file that does nothing. A guard
    // keyed on "are they ALL empty" would clear this, which is why the grading is per file.
    const { code, output } = runGuard(
      workspaceWith({ "real.md": REAL_CHANGESET, "inert.md": EMPTY_FRONTMATTER_CHANGESET }),
    );

    expect(code).toBe(1);
    expect(output).toContain("inert.md");
    expect(output).not.toContain("real.md");
  });
});

describe("changeset-guard: the other ways to bump nothing", () => {
  it("REFUSES a changeset whose every release type is `none`", () => {
    // `none` is a VALID type in @changesets/parse's own validVersionTypes, so this file has a
    // non-empty releases list and does NOT trip the action's emptiness check. It instead opens a
    // Version PR that changes no version. Measured against the parser source, not assumed.
    const { code, output } = runGuard(
      workspaceWith({
        "none.md": `---\n"@cosyte/tsconfig": none\n---\n\nTouches the package without bumping it.\n`,
      }),
    );

    expect(code).toBe(1);
    expect(output).toContain("type `none`");
  });

  it("ACCEPTS `none` alongside a real bump, which is what `none` is for", () => {
    const { code } = runGuard(
      workspaceWith({
        "mixed.md": `---\n"@cosyte/tsconfig": patch\n"@cosyte/eslint-config": none\n---\n\nBump one, carry the other.\n`,
      }),
    );

    expect(code).toBe(0);
  });

  it("REFUSES a changeset naming a package that does not exist", () => {
    const { code, output } = runGuard(
      workspaceWith({
        "typo.md": `---\n"@cosyte/tscofnig": patch\n---\n\nA typo bumps nothing.\n`,
      }),
    );

    expect(code).toBe(1);
    expect(output).toContain("not a publishable package");
  });

  it("ACCEPTS a trailing YAML comment next to a real bump", () => {
    // Raised by the gate-refuter: `"@cosyte/tsconfig": patch # bump it` is valid YAML and a human
    // plausibly writes it, and the first draft exited 2 on it. Exit 2 was directionally safe (never
    // green on an inert file) but it is still a gate refusing correct work.
    const { code } = runGuard(
      workspaceWith({
        "commented.md": `---\n"@cosyte/tsconfig": patch # the compiler target moved\n---\n\nRaise the target.\n`,
      }),
    );

    expect(code).toBe(0);
  });

  it("still REFUSES an inert changeset that carries a trailing comment", () => {
    // The control for the line above: stripping comments must not become a way to smuggle an inert
    // file past the guard.
    const { code, output } = runGuard(
      workspaceWith({ "inert.md": `---\n# nothing here yet\n---\n\nA summary.\n` }),
    );

    expect(code).toBe(1);
    expect(output).toContain("declares no packages");
  });

  it("REFUSES a changeset with an empty summary", () => {
    const { code, output } = runGuard(
      workspaceWith({ "mute.md": `---\n"@cosyte/tsconfig": patch\n---\n` }),
    );

    expect(code).toBe(1);
    expect(output).toContain("summary is empty");
  });
});

describe("changeset-guard: what must NOT be refused", () => {
  it("ACCEPTS an empty .changeset directory, which is the publish arm", () => {
    // Refusing here would be the mirror-image defect: it would block every real release, since a
    // publish run is by definition the one with no changesets left.
    const { code, output } = runGuard(workspaceWith({}));

    expect(code).toBe(0);
    expect(output).toContain("publish arm");
  });

  it("ignores README.md and config.json, which are not changesets", () => {
    const { code } = runGuard(workspaceWith({}));
    expect(code).toBe(0);
  });
});

describe("changeset-guard: a broken guard must not look like a caught violation", () => {
  it("exits 2, not 1, when it cannot read the changeset directory", () => {
    const root = mkdtempSync(join(tmpdir(), "changeset-guard-missing-"));
    temporaryDirs.push(root);

    let code = -1;
    let output = "";
    try {
      execFileSync("node", [GUARD, "--workspace", root, "--dir", join(root, "nope")], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      code = 0;
    } catch (error) {
      const err = error as { status?: number; stderr?: string };
      code = err.status ?? -1;
      output = err.stderr ?? "";
    }

    // 1 means "an inert changeset was found". A guard that could not run must never borrow it, or
    // a broken gate and a caught defect become one signal in CI.
    expect(code).toBe(2);
    expect(output).toContain("could not run");
  });

  it("exits 2 on an unknown argument", () => {
    const root = workspaceWith({});
    let code = -1;
    try {
      execFileSync("node", [GUARD, "--workspace", root, "--bogus", "x"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      code = 0;
    } catch (error) {
      code = (error as { status?: number }).status ?? -1;
    }
    expect(code).toBe(2);
  });
});

describe("changeset-guard: the real repository", () => {
  it("passes over this repo's own .changeset directory", () => {
    // Not a tautology: this is the state release.yml will actually run the guard against, and it is
    // the assertion that would have caught the 2026-07-31 file before it was approved as a publish.
    const { code } = runGuard(join(import.meta.dirname, ".."));
    expect(code).toBe(0);
  });
});
