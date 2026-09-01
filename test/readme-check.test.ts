import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

// THE NEGATIVE CONTROL FOR THE README SHAPE GATE.
//
// The defect: a README is inside every published package's `files` array, so its text is FROZEN
// INTO THE TARBALL at publish time and a wrong string can be corrected only by publishing again.
// Before this gate none of the nine READMEs carried the banner, a badge row, a tagline, or the
// `Why this exists`, `Status`, `PHI and safety`, `Contributing` or `License` sections.
//
// A gate against a badly-shaped README is worth exactly what its negative control proves, so this
// suite asserts BOTH directions:
//
//   NEGATIVE  a README missing or misordering a required element must make the gate exit NON-ZERO.
//   POSITIVE  a conforming README must make it exit ZERO.
//
// Only the pair is evidence. A gate that refuses everything also fails the negative case, and a
// gate that refuses nothing also passes the positive one. The positive control matters more than
// usual here: every negative below is produced by MUTATING the conforming fixture, so if the
// baseline did not pass, each negative would prove nothing about the mutation it names.
//
// It drives the SHIPPED CLI with execFileSync rather than calling the exported `check()`, because
// what ci.yml depends on is the process exit code, and an exported function returning
// `{ ok: false }` proves nothing about what `node scripts/readme-check.mjs` exits with. This repo
// has already been bitten by that exact gap: `scripts/attw.mjs`'s wrapper exited 0 on an untyped
// pack while its unit surface reported the failure correctly (PR #42).

const CHECKER = join(import.meta.dirname, "..", "scripts", "readme-check.mjs");

const temporaryDirs: string[] = [];

afterEach(() => {
  while (temporaryDirs.length > 0) {
    const dir = temporaryDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

const BANNER = `<a href="https://cosyte.com">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://cosyte.com/tile/cosyte-lockup-tile-on-dark-1200x300.png">
    <img alt="The Cosyte logo on its own white ground: the icon beside the word Cosyte." src="https://cosyte.com/tile/cosyte-lockup-tile-on-light-1200x300.png">
  </picture>
</a>`;

const CI_BADGE =
  "[![CI](https://img.shields.io/github/actions/workflow/status/cosyte/config/ci.yml?branch=main&label=CI)](https://github.com/cosyte/config/actions/workflows/ci.yml)";
const LICENSE_BADGE =
  "[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/cosyte/config/blob/main/LICENSE)";

/** The npm version badge for a package name. */
function npmBadge(name: string): string {
  return `[![npm version](https://img.shields.io/npm/v/${name}.svg)](https://www.npmjs.com/package/${name})`;
}

/** The Node badge for an engine floor, URL-encoded the way shields.io needs it. */
function nodeBadge(floor: string): string {
  const label = `node-${floor.replaceAll(">", "%3E").replaceAll("=", "%3D")}`;
  return `[![Node](https://img.shields.io/badge/${label}-brightgreen.svg)](https://nodejs.org)`;
}

/**
 * The exact `## Status` opening sentence a release line owes, as the gate spells it.
 *
 * Written out here rather than imported from `scripts/readme-check.mjs` for the same reason this
 * suite drives the CLI rather than calling `check()`: a fixture built from the checker's own
 * constants agrees with the checker by construction and proves nothing about the string that
 * publishes. These two sentences are the contract.
 *
 * @param name The package's manifest name.
 * @param line The effective release line, for example `0.0.x` or `0.1.x`.
 * @returns The sentence that line's Status section must open with.
 */
function statusSentence(name: string, line: string): string {
  return line === "0.0.x"
    ? `\`${name}\` is on the cosyte 0.0.x ladder: the public API is not yet settled and may change in any release.`
    : `\`${name}\` is on the cosyte ${line} line: the public API is settled and bump types follow ordinary semver.`;
}

interface PackageSpec {
  /** Directory name under `packages/`. */
  dir: string;
  /** Manifest name. Defaults to `@cosyte/<dir>`. */
  name?: string;
  version?: string;
  /**
   * The EFFECTIVE release line this package's README should be written for, for example `0.1.x`.
   *
   * Defaults to the line the manifest `version` alone implies. It is a separate knob because the
   * two genuinely come apart: a package at manifest `0.0.4` with a pending `minor` changeset is on
   * the `0.1.x` line, and writing its README for `0.0.x` is exactly the defect AC2 grades.
   */
  effectiveLine?: string;
  description?: string;
  private?: boolean;
  /** The package's own `engines.node`, when it declares one. */
  engines?: string;
  /** Replaces the generated README entirely. */
  readme?: string;
  /** Rewrites the generated README. Applied after `readme`. */
  mutate?: (readme: string) => string;
  /** Omit the README file entirely. */
  noReadme?: boolean;
  /** Omit the package.json file entirely. */
  noManifest?: boolean;
  /** Write this instead of a valid package.json. */
  rawManifest?: string;
}

const ROOT_FLOOR = ">=22.14";

/**
 * The `## License` section EXACTLY AS THIS REPOSITORY SHIPS IT, absolute link included.
 *
 * The link is not decoration and this fixture may not drop it. No package here ships its own
 * `LICENSE` file, so the house skeleton REQUIRES the absolute one, and that URL carries the owner's
 * name: `github.com/cosyte/config`. A fixture whose License section were the bare
 * `MIT, copyright Cosyte.` would be a shape this repository does not publish, and a negative test
 * mutating it would prove nothing about the eight files that actually reach npm. That is exactly how
 * the owner check shipped unfailable the first time.
 */
const LICENSE_SECTION =
  "MIT, copyright Cosyte. See [LICENSE](https://github.com/cosyte/config/blob/main/LICENSE).";

/**
 * The release line a version alone implies, which is what a spec that names no pending bump means.
 *
 * @param version A plain `major.minor.patch` version.
 * @returns The line label, for example `0.0.x`.
 */
function lineOfVersion(version: string): string {
  const m = /^(\d+)\.(\d+)\./.exec(version);
  return m === null ? "0.0.x" : `${m[1]}.${m[2]}.x`;
}

/** The effective line a package spec's README is written for. */
function lineOf(spec: PackageSpec): string {
  return spec.effectiveLine ?? lineOfVersion(spec.version ?? "0.0.1");
}

/**
 * A README that conforms to the house skeleton, for one package on its effective release line.
 *
 * Every negative test below mutates this, so it is the one thing that must be right: a wrong
 * baseline turns every negative into a test of the baseline rather than of the mutation.
 *
 * @param spec The package to generate for.
 * @returns The README source.
 */
function conformingReadme(spec: PackageSpec): string {
  const name = spec.name ?? `@cosyte/${spec.dir}`;
  const floor = spec.engines ?? ROOT_FLOOR;
  const badges = [
    ...(spec.private === true ? [] : [npmBadge(name)]),
    CI_BADGE,
    LICENSE_BADGE,
    nodeBadge(floor),
  ];
  // The second line is the same on both lines on purpose: the "name something further" requirement
  // is one the settled line keeps, so a fixture that dropped it there would be testing two changes
  // at once.
  const status = `${statusSentence(name, lineOf(spec))}\n\nStill moving: the option surface.`;
  return `${BANNER}

# ${name}

> A short hook line.

${badges.join("\n")}

${spec.description ?? `Test fixture package ${spec.dir}.`}

## Why this exists

Because the fixture needs a section here.

## Status

${status}

## Install

\`\`\`sh
pnpm add -D ${name}
\`\`\`

Node \`${floor}\`.

## Usage

\`\`\`js
import x from "${name}";
\`\`\`

## PHI and safety

This fixture processes no patient data.

## Contributing

Ask at https://github.com/cosyte/config/issues.

## License

${LICENSE_SECTION}
`;
}

/** A pending changeset to drop into the fixture's `.changeset/`, keyed by filename. */
type Changesets = Record<string, string>;

/**
 * A changeset file body, in the shape changesets itself writes.
 *
 * @param releases The `name: type` pairs the frontmatter declares.
 * @param summary The summary under the frontmatter.
 * @returns The file contents.
 */
function changeset(releases: Record<string, string>, summary = "A fixture bump."): string {
  const body = Object.entries(releases)
    .map(([name, type]) => `"${name}": ${type}`)
    .join("\n");
  return `---\n${body}\n---\n\n${summary}\n`;
}

interface RootOverrides extends Partial<PackageSpec> {
  workspaceYaml?: string;
  /** Pending changesets, by filename. Defaults to none pending. */
  changesets?: Changesets;
  /** Omit `.changeset/` entirely, which the checker must refuse rather than read as "none". */
  noChangesetDir?: boolean;
}

/**
 * Build a throwaway workspace: a root manifest, a `pnpm-workspace.yaml`, `.changeset/`, and a
 * `packages/` tree.
 *
 * The checker derives its governed set AND every package's effective release line from the
 * workspace at run time, so a fixture has to carry a real one: asserting against an invented layout
 * would test a different program. `.changeset/` is written by default, carrying the two files that
 * are configuration or prose rather than changesets, because that is the shape the real repository
 * has and because the checker skipping them is a claim worth exercising on every case here.
 *
 * @param specs The packages to create.
 * @param rootOverrides Changes to the root package, its README, and the pending changesets.
 * @returns The workspace root.
 */
function workspaceWith(specs: PackageSpec[], rootOverrides: RootOverrides = {}): string {
  const root = mkdtempSync(join(tmpdir(), "readme-check-"));
  temporaryDirs.push(root);

  writeFileSync(
    join(root, "pnpm-workspace.yaml"),
    rootOverrides.workspaceYaml ?? 'packages:\n  - "packages/*"\n',
    "utf8",
  );

  if (rootOverrides.noChangesetDir !== true) {
    const changesetDir = join(root, ".changeset");
    mkdirSync(changesetDir, { recursive: true });
    writeFileSync(join(changesetDir, "config.json"), JSON.stringify({ changelog: false }), "utf8");
    writeFileSync(
      join(changesetDir, "README.md"),
      "# Changesets\n\nProse, not a changeset.\n",
      "utf8",
    );
    for (const [file, contents] of Object.entries(rootOverrides.changesets ?? {})) {
      writeFileSync(join(changesetDir, file), contents, "utf8");
    }
  }

  // THE ROOT'S LINE IS DERIVED FROM THE PUBLISHED PACKAGES, so the fixture derives it the same way
  // rather than letting the root's own `0.0.0` decide: the root package is private and never
  // versioned, and a fixture that wrote its README off that number would only ever exercise one
  // half of AC4.
  const publishedLines = new Set(
    specs.filter((spec) => spec.private !== true).map((spec) => lineOf(spec)),
  );
  const derivedRootLine = publishedLines.size === 1 ? [...publishedLines][0] : "0.0.x";

  const rootSpec: PackageSpec = {
    dir: "root",
    name: "cosyte-config",
    version: "0.0.0",
    private: true,
    description: "The fixture workspace root.",
    engines: ROOT_FLOOR,
    effectiveLine: derivedRootLine,
    ...rootOverrides,
  };
  if (rootOverrides.rawManifest !== undefined) {
    writeFileSync(join(root, "package.json"), rootOverrides.rawManifest, "utf8");
  } else {
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({
        name: rootSpec.name,
        version: rootSpec.version,
        private: true,
        description: rootSpec.description,
        engines: rootSpec.engines === undefined ? undefined : { node: rootSpec.engines },
      }),
      "utf8",
    );
  }
  if (rootOverrides.noReadme !== true) {
    const base = rootOverrides.readme ?? conformingReadme(rootSpec);
    writeFileSync(join(root, "README.md"), rootOverrides.mutate?.(base) ?? base, "utf8");
  }

  mkdirSync(join(root, "packages"), { recursive: true });
  for (const spec of specs) {
    const dir = join(root, "packages", spec.dir);
    mkdirSync(dir, { recursive: true });
    if (spec.rawManifest !== undefined) {
      writeFileSync(join(dir, "package.json"), spec.rawManifest, "utf8");
    } else if (spec.noManifest !== true) {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({
          name: spec.name ?? `@cosyte/${spec.dir}`,
          version: spec.version ?? "0.0.1",
          description: spec.description ?? `Test fixture package ${spec.dir}.`,
          private: spec.private,
          engines: spec.engines === undefined ? undefined : { node: spec.engines },
        }),
        "utf8",
      );
    }
    if (spec.noReadme === true) continue;
    const base = spec.readme ?? conformingReadme(spec);
    writeFileSync(join(dir, "README.md"), spec.mutate?.(base) ?? base, "utf8");
  }

  return root;
}

/**
 * Run the checker CLI against a workspace and capture its exit code and output.
 *
 * @param root The workspace root.
 * @param extraArgs Additional CLI arguments.
 * @returns The exit code and combined output.
 */
function runCheck(root: string, extraArgs: string[] = []): { code: number; output: string } {
  try {
    const stdout = execFileSync("node", [CHECKER, "--workspace", root, ...extraArgs], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, output: stdout };
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? -1, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

describe("readme-check: the positive control", () => {
  it("ACCEPTS a workspace whose READMEs all carry the house skeleton", () => {
    const { code, output } = runCheck(workspaceWith([{ dir: "alpha" }, { dir: "beta" }]));

    expect(code).toBe(0);
    expect(output).toContain("readme-check: OK");
    // Root plus the two packages. If this said 2, the root would be going ungraded.
    expect(output).toContain("3 governed README(s)");
  });
});

describe("readme-check: the required elements, in order (AC1, AC2)", () => {
  it("REFUSES a README missing a required heading, naming the file and the element", () => {
    const { code, output } = runCheck(
      workspaceWith([
        { dir: "alpha", mutate: (r) => r.replace("## Why this exists", "## Rationale") },
      ]),
    );

    expect(code).toBe(1);
    // AC2 wants BOTH: which file, and which element.
    expect(output).toContain("packages/alpha/README.md");
    expect(output).toContain("`## Why this exists` is missing");
  });

  it("REFUSES two required headings in the wrong order", () => {
    const { code, output } = runCheck(
      workspaceWith([
        {
          dir: "alpha",
          mutate: (r) =>
            r
              .replace(
                "## Install\n\n```sh\npnpm add -D @cosyte/alpha\n```\n\nNode `>=22.14`.\n\n",
                "",
              )
              .replace(
                "## Why this exists",
                "## Install\n\n```sh\npnpm add -D @cosyte/alpha\n```\n\nNode `>=22.14`.\n\n## Why this exists",
              ),
        },
      ]),
    );

    expect(code).toBe(1);
    expect(output).toContain("must appear in the order");
  });

  it("REFUSES a README whose last heading is not `## License`", () => {
    const { code, output } = runCheck(
      workspaceWith([{ dir: "alpha", mutate: (r) => `${r}\n## Afterword\n\nOne more thing.\n` }]),
    );

    expect(code).toBe(1);
    expect(output).toContain("`## License` must be the last heading");
  });

  it("REPORTS EVERY offending file in one run rather than stopping at the first", () => {
    // The whole point of AC2's second clause. A gate that stops at the first turns a nine-file
    // sweep into nine pushes, and the second file's defect is only discovered after the first is
    // fixed.
    const { code, output } = runCheck(
      workspaceWith([
        { dir: "alpha", mutate: (r) => r.replace("## Status", "## State") },
        { dir: "beta", mutate: (r) => r.replace("## Contributing", "## Help") },
        { dir: "gamma" },
      ]),
    );

    expect(code).toBe(1);
    expect(output).toContain("packages/alpha/README.md");
    expect(output).toContain("packages/beta/README.md");
    expect(output).not.toContain("packages/gamma/README.md");
    expect(output).toContain("2 of 4 governed README(s)");
  });

  it("REFUSES a README carrying more than one H1", () => {
    const { code, output } = runCheck(
      workspaceWith([{ dir: "alpha", mutate: (r) => `${r}\n# A second title\n` }]),
    );

    expect(code).toBe(1);
    expect(output).toContain("level-1 headings");
  });

  it("REFUSES a tagline at or past the 120-character ceiling", () => {
    const long = `> ${"x".repeat(130)}`;
    const { code, output } = runCheck(
      workspaceWith([{ dir: "alpha", mutate: (r) => r.replace("> A short hook line.", long) }]),
    );

    expect(code).toBe(1);
    expect(output).toContain("the ceiling is 120");
  });

  it("does NOT invent a heading out of a fenced code block", () => {
    // The negative control for the fence mask. `## Status` inside a fence is sample text, not a
    // section, and a checker that reads it as one would clear a file that has no real Status.
    const { code } = runCheck(
      workspaceWith([
        {
          dir: "alpha",
          mutate: (r) =>
            r.replace(
              'import x from "@cosyte/alpha";',
              '// ## Status\nimport x from "@cosyte/alpha";',
            ),
        },
      ]),
    );

    expect(code).toBe(0);
  });
});

describe("readme-check: the banner and images (AC3)", () => {
  it("REFUSES a banner whose alt string was hand-written", () => {
    const { code, output } = runCheck(
      workspaceWith([
        {
          dir: "alpha",
          mutate: (r) =>
            r.replace(
              "The Cosyte logo on its own white ground: the icon beside the word Cosyte.",
              "Cosyte logo",
            ),
        },
      ]),
    );

    expect(code).toBe(1);
    expect(output).toContain("banner");
  });

  it("REFUSES a banner whose dark-scheme source was dropped", () => {
    const { code, output } = runCheck(
      workspaceWith([
        {
          dir: "alpha",
          mutate: (r) =>
            r.replace(
              '    <source media="(prefers-color-scheme: dark)" srcset="https://cosyte.com/tile/cosyte-lockup-tile-on-dark-1200x300.png">\n',
              "",
            ),
        },
      ]),
    );

    expect(code).toBe(1);
    expect(output).toContain("banner");
  });

  it("REFUSES a banner whose image URLs were made relative", () => {
    const { code, output } = runCheck(
      workspaceWith([
        {
          dir: "alpha",
          mutate: (r) => r.replaceAll("https://cosyte.com/tile/", "../../assets/tile/"),
        },
      ]),
    );

    expect(code).toBe(1);
    expect(output).toContain("npm does not resolve it");
  });

  it("REFUSES a relative markdown image anywhere in the file", () => {
    const { code, output } = runCheck(
      workspaceWith([
        {
          dir: "alpha",
          mutate: (r) => r.replace("## License", "![a diagram](docs/diagram.png)\n\n## License"),
        },
      ]),
    );

    expect(code).toBe(1);
    expect(output).toContain("docs/diagram.png");
  });

  it("REFUSES a README that does not open with the banner", () => {
    const { code, output } = runCheck(
      workspaceWith([{ dir: "alpha", mutate: (r) => `Some preamble.\n\n${r}` }]),
    );

    expect(code).toBe(1);
    expect(output).toContain("banner");
  });
});

describe("readme-check: the badge row (AC4)", () => {
  it("REFUSES a fifth badge", () => {
    const { code, output } = runCheck(
      workspaceWith([
        {
          dir: "alpha",
          mutate: (r) =>
            r.replace(
              nodeBadge(ROOT_FLOOR),
              `${nodeBadge(ROOT_FLOOR)}\n[![downloads](https://img.shields.io/npm/dm/@cosyte/alpha.svg)](https://www.npmjs.com/package/@cosyte/alpha)`,
            ),
        },
      ]),
    );

    expect(code).toBe(1);
    expect(output).toContain("badges");
  });

  it("REFUSES a badge outside the row", () => {
    const { code, output } = runCheck(
      workspaceWith([
        {
          dir: "alpha",
          mutate: (r) =>
            r.replace(
              "## License",
              "[![downloads](https://img.shields.io/npm/dm/@cosyte/alpha.svg)](https://www.npmjs.com/package/@cosyte/alpha)\n\n## License",
            ),
        },
      ]),
    );

    expect(code).toBe(1);
    expect(output).toContain("carries a badge outside the row");
  });

  it("REFUSES a reordered badge row", () => {
    const { code, output } = runCheck(
      workspaceWith([
        {
          dir: "alpha",
          mutate: (r) =>
            r.replace(`${CI_BADGE}\n${LICENSE_BADGE}`, `${LICENSE_BADGE}\n${CI_BADGE}`),
        },
      ]),
    );

    expect(code).toBe(1);
    expect(output).toContain("in this order");
  });

  it("REFUSES an npm badge naming a package other than its own", () => {
    const { code, output } = runCheck(
      workspaceWith([
        {
          dir: "alpha",
          mutate: (r) => r.replace(npmBadge("@cosyte/alpha"), npmBadge("@cosyte/beta")),
        },
      ]),
    );

    expect(code).toBe(1);
    expect(output).toContain("badges");
  });

  it("REFUSES an npm version badge on a private package", () => {
    // A private package has no npm page, so the badge renders broken forever.
    const { code, output } = runCheck(
      workspaceWith([{ dir: "alpha" }], {
        mutate: (r) => r.replace(CI_BADGE, `${npmBadge("cosyte-config")}\n${CI_BADGE}`),
      }),
    );

    expect(code).toBe(1);
    expect(output).toContain("README.md: badges");
  });

  it("REFUSES a published package whose npm version badge is missing", () => {
    const { code, output } = runCheck(
      workspaceWith([
        { dir: "alpha", mutate: (r) => r.replace(`${npmBadge("@cosyte/alpha")}\n`, "") },
      ]),
    );

    expect(code).toBe(1);
    expect(output).toContain("badges");
  });

  it("carries each package's own effective Node floor in its badge", () => {
    // The floors in this workspace genuinely diverge, so a badge copied between packages is a
    // wrong claim rather than a cosmetic slip.
    const { code, output } = runCheck(
      workspaceWith([
        { dir: "alpha", engines: ">=22.0.0", mutate: (r) => r.replaceAll("22.0.0", "22.14") },
      ]),
    );

    expect(code).toBe(1);
    expect(output).toContain("badges");
  });
});

describe("readme-check: the description (AC5)", () => {
  it("REFUSES a description that differs from the manifest, naming both strings", () => {
    const { code, output } = runCheck(
      workspaceWith([
        {
          dir: "alpha",
          description: "The real one.",
          mutate: (r) => r.replace("The real one.", "A different one."),
        },
      ]),
    );

    expect(code).toBe(1);
    expect(output).toContain('"The real one."');
    expect(output).toContain('"A different one."');
  });

  it("ACCEPTS the markdown escaping Prettier applies to the manifest string", () => {
    // Measured, not assumed: `proseWrap: preserve` leaves the line alone but Prettier still
    // escapes the bare `*` in `@cosyte/*`. A gate that read source bytes literally would red on
    // `pnpm format`, and a gate nobody can keep green is a gate that gets deleted.
    const { code } = runCheck(
      workspaceWith([
        {
          dir: "alpha",
          description: "Shared config for @cosyte/* packages.",
          mutate: (r) =>
            r.replace(
              "Shared config for @cosyte/* packages.",
              "Shared config for @cosyte/\\* packages.",
            ),
        },
      ]),
    );

    expect(code).toBe(0);
  });

  it("REFUSES a description split across two lines", () => {
    const { code, output } = runCheck(
      workspaceWith([
        {
          dir: "alpha",
          description: "One line only.",
          mutate: (r) => r.replace("One line only.", "One line\nonly."),
        },
      ]),
    );

    expect(code).toBe(1);
    expect(output).toContain("description");
  });
});

describe("readme-check: the Status sentence (AC6)", () => {
  it("REFUSES a 0.0.x package whose Status sentence is not the exact one", () => {
    const { code, output } = runCheck(
      workspaceWith([
        {
          dir: "alpha",
          mutate: (r) => r.replace("is on the cosyte 0.0.x ladder", "is on the 0.0.x ladder"),
        },
      ]),
    );

    expect(code).toBe(1);
    expect(output).toContain("must OPEN with this exact sentence");
  });

  it("REFUSES a 0.0.x package that claims a settled public API", () => {
    const { code, output } = runCheck(
      workspaceWith([
        {
          dir: "alpha",
          mutate: (r) =>
            r.replace("Still moving: the option surface.", "The public API is settled."),
        },
      ]),
    );

    expect(code).toBe(1);
    expect(output).toContain("settled or stable public API");
  });

  it("REFUSES a Status section that names nothing still moving", () => {
    const { code, output } = runCheck(
      workspaceWith([
        { dir: "alpha", mutate: (r) => r.replace("\n\nStill moving: the option surface.", "") },
      ]),
    );

    expect(code).toBe(1);
    expect(output).toContain("at least one surface that is still moving");
  });

  it("keeps the 0.0.x branch when the only pending changeset is a patch", () => {
    // A patch never moves a line, so the ladder sentence is still the true one and is still
    // compelled. This is the case the repository is actually in.
    const { code } = runCheck(
      workspaceWith([{ dir: "alpha", version: "0.0.4" }], {
        changesets: { "fix.md": changeset({ "@cosyte/alpha": "patch" }) },
      }),
    );

    expect(code).toBe(0);
  });
});

describe("readme-check: the settled 0.1.x line (AC2)", () => {
  it("ACCEPTS a package whose pending minor changeset puts it on 0.1.x and whose README says so", () => {
    // The whole point. The manifest still reads 0.0.4 here, because `changeset version` is a
    // separate commit made by the release owner: the tree that decides the policy is one merge
    // ahead of the tree that carries the number.
    const { code, output } = runCheck(
      workspaceWith([{ dir: "alpha", version: "0.0.4", effectiveLine: "0.1.x" }], {
        changesets: { "settle.md": changeset({ "@cosyte/alpha": "minor" }) },
      }),
    );

    expect(code, output).toBe(0);
  });

  it("REQUIRES the 0.1.x sentence, not the ladder one, once a minor is pending", () => {
    // The tightening. A package on the settled line that still opens with the ladder sentence is
    // publishing a retired policy, and this is where that is caught.
    const { code, output } = runCheck(
      workspaceWith([{ dir: "alpha", version: "0.0.4", effectiveLine: "0.0.x" }], {
        changesets: { "settle.md": changeset({ "@cosyte/alpha": "minor" }) },
      }),
    );

    expect(code).toBe(1);
    expect(output).toContain("packages/alpha/README.md");
    expect(output).toContain("must OPEN with this exact sentence");
    expect(output).toContain(statusSentence("@cosyte/alpha", "0.1.x"));
  });

  it("REQUIRES the 0.1.x sentence of a package whose manifest is already 0.1.0", () => {
    // Supersedes the older "does NOT require the 0.0.x sentence of a package past 0.0.x". Leaving
    // that section ungraded was the silent-skip this gate refuses everywhere else.
    const { code, output } = runCheck(
      workspaceWith([{ dir: "alpha", version: "0.1.0", effectiveLine: "0.0.x" }]),
    );

    expect(code).toBe(1);
    expect(output).toContain("must OPEN with this exact sentence");
    expect(output).toContain(statusSentence("@cosyte/alpha", "0.1.x"));
  });

  it("does NOT refuse the settled-API wording on the settled line", () => {
    // The required 0.1.x sentence IS a settled-API claim, so a gate that kept refusing the wording
    // would refuse the sentence it compels. Asserted with a SECOND such claim in the section, so
    // this cannot pass just because the opening sentence is special-cased.
    const { code, output } = runCheck(
      workspaceWith([{ dir: "alpha", version: "0.1.0" }], {
        changesets: {},
      }),
    );

    expect(code, output).toBe(0);

    const withExtraClaim = runCheck(
      workspaceWith([
        {
          dir: "alpha",
          version: "0.1.0",
          mutate: (r) =>
            r.replace(
              "Still moving: the option surface.",
              "The public API is settled and safe to depend on.",
            ),
        },
      ]),
    );

    expect(withExtraClaim.code, withExtraClaim.output).toBe(0);
  });

  it("still REFUSES a Status section on the settled line that names nothing further", () => {
    const { code, output } = runCheck(
      workspaceWith([
        {
          dir: "alpha",
          version: "0.1.0",
          mutate: (r) => r.replace("\n\nStill moving: the option surface.", ""),
        },
      ]),
    );

    expect(code).toBe(1);
    expect(output).toContain("at least one surface that is still moving");
  });

  it("renders the package's OWN minor above 0.1.x", () => {
    const { code, output } = runCheck(
      workspaceWith([{ dir: "alpha", version: "0.2.0", effectiveLine: "0.1.x" }]),
    );

    expect(code).toBe(1);
    expect(output).toContain(statusSentence("@cosyte/alpha", "0.2.x"));

    const correct = runCheck(workspaceWith([{ dir: "alpha", version: "0.2.0" }]));
    expect(correct.code, correct.output).toBe(0);
  });

  it("takes the STRONGEST pending bump when two changesets name one package", () => {
    const { code, output } = runCheck(
      workspaceWith([{ dir: "alpha", version: "0.0.4", effectiveLine: "0.1.x" }], {
        changesets: {
          "a-fix.md": changeset({ "@cosyte/alpha": "patch" }),
          "b-settle.md": changeset({ "@cosyte/alpha": "minor" }),
        },
      }),
    );

    expect(code, output).toBe(0);
  });
});

describe("readme-check: a retired ladder assertion anywhere in the file (AC3)", () => {
  it("REFUSES the ladder sentence outside `## Status` once the package has left 0.0.x", () => {
    const { code, output } = runCheck(
      workspaceWith([
        {
          dir: "alpha",
          version: "0.1.0",
          mutate: (r) =>
            r.replace(
              "Because the fixture needs a section here.",
              "This package is on the cosyte 0.0.x ladder.",
            ),
        },
      ]),
    );

    expect(code).toBe(1);
    expect(output).toContain("packages/alpha/README.md");
    expect(output).toContain("ladder");
    // AC3 wants the LINE named, not just the file.
    expect(output).toMatch(/line \d+ asserts/);
  });

  it("REFUSES the `0.0.x until first alpha` form, which is the root README's second assertion", () => {
    const { code, output } = runCheck(
      workspaceWith([{ dir: "alpha", version: "0.1.0" }], {
        mutate: (r) =>
          r.replace(
            "Because the fixture needs a section here.",
            "Every package follows the cosyte ladder: **`0.0.x` until first alpha**.",
          ),
      }),
    );

    expect(code).toBe(1);
    expect(output).toContain("ERROR: README.md:");
    expect(output).toMatch(/line \d+ asserts/);
  });

  it("does NOT refuse the ladder assertion of a package still ON the ladder", () => {
    // The mirror control. On 0.0.x that sentence is the one this gate COMPELS, so a whole-file ban
    // would make the required text unfailable to write.
    const { code, output } = runCheck(
      workspaceWith([
        {
          dir: "alpha",
          mutate: (r) =>
            r.replace(
              "Because the fixture needs a section here.",
              "This package is on the cosyte 0.0.x ladder.",
            ),
        },
      ]),
    );

    expect(code, output).toBe(0);
  });

  it("does NOT refuse prose that merely NAMES 0.0.x without asserting the ladder", () => {
    // The over-breadth control, taken from this repository's own text: `vitest-config` says a
    // surface is "not covered by a stability promise at `0.0.x`" and the root README says each
    // package "is on its own `0.0.x` version". Neither asserts the policy, and a keyword ban on
    // the number would delete honest prose about history.
    const { code, output } = runCheck(
      workspaceWith([
        {
          dir: "alpha",
          version: "0.1.0",
          mutate: (r) =>
            r.replace(
              "Because the fixture needs a section here.",
              "The option surface was not covered by a stability promise at `0.0.x`, and every " +
                "release before this one was on its own `0.0.x` version.",
            ),
        },
      ]),
    );

    expect(code, output).toBe(0);
  });

  it("reports a ladder assertion as a VIOLATION (1), never as a broken check (2)", () => {
    const { code } = runCheck(
      workspaceWith([
        {
          dir: "alpha",
          version: "0.1.0",
          mutate: (r) => r.replace("## License", "On the 0.0.x ladder, anyway.\n\n## License"),
        },
      ]),
    );

    expect(code).toBe(1);
  });
});

describe("readme-check: the root README's line is DERIVED (AC4, AC5)", () => {
  it("grades the private root against the published packages, not against its own 0.0.0", () => {
    // The root manifest is `private: true` and pinned at 0.0.0 forever, so a gate keyed on its own
    // version would hold the root README on the ladder through every release this repo makes.
    const { code, output } = runCheck(
      workspaceWith(
        [
          { dir: "alpha", version: "0.1.0" },
          { dir: "beta", version: "0.1.2" },
        ],
        {
          effectiveLine: "0.0.x",
        },
      ),
    );

    expect(code).toBe(1);
    expect(output).toContain("ERROR: README.md:");
    expect(output).toContain(statusSentence("cosyte-config", "0.1.x"));
  });

  it("ACCEPTS the root on the derived line while its own manifest still reads 0.0.0", () => {
    const { code, output } = runCheck(
      workspaceWith(
        [
          { dir: "alpha", version: "0.0.4", effectiveLine: "0.1.x" },
          { dir: "beta", version: "0.0.1", effectiveLine: "0.1.x" },
        ],
        {
          changesets: {
            "settle.md": changeset({ "@cosyte/alpha": "minor", "@cosyte/beta": "minor" }),
          },
        },
      ),
    );

    expect(code, output).toBe(0);
  });

  it("exits 2, naming the packages, when the published packages disagree about their line", () => {
    const { code, output } = runCheck(
      workspaceWith([
        { dir: "alpha", version: "0.0.1" },
        { dir: "beta", version: "0.1.0" },
      ]),
    );

    expect(code).toBe(2);
    expect(output).toContain("not all on one effective release line");
    expect(output).toContain("@cosyte/alpha");
    expect(output).toContain("@cosyte/beta");
    expect(output).not.toContain("readme-check: OK");
  });

  it("exits 2 when a pending minor moves only SOME of the published packages", () => {
    // The half-migrated tree. Choosing a line for the root here would publish a policy claim the
    // repository cannot prove.
    const { code, output } = runCheck(
      workspaceWith(
        [
          { dir: "alpha", version: "0.0.4" },
          { dir: "beta", version: "0.0.1" },
        ],
        {
          changesets: { "settle.md": changeset({ "@cosyte/alpha": "minor" }) },
        },
      ),
    );

    expect(code).toBe(2);
    expect(output).toContain("not all on one effective release line");
  });
});

describe("readme-check: a line it has no sentence for (AC6)", () => {
  it("exits 2 on a package whose manifest is already 1.0.0", () => {
    const { code, output } = runCheck(workspaceWith([{ dir: "alpha", version: "1.0.0" }]));

    expect(code).toBe(2);
    expect(output).toContain("has no Status sentence for");
    expect(output).not.toContain("readme-check: OK");
  });

  it("exits 2 on a package a pending major would take to 1.0.0", () => {
    const { code, output } = runCheck(
      workspaceWith([{ dir: "alpha", version: "0.0.4" }], {
        changesets: { "one-oh.md": changeset({ "@cosyte/alpha": "major" }) },
      }),
    );

    expect(code).toBe(2);
    expect(output).toContain("1.0.x");
  });

  it("exits 2 on a version it cannot resolve to a line at all", () => {
    const { code, output } = runCheck(workspaceWith([{ dir: "alpha", version: "0.1.0-next.3" }]));

    expect(code).toBe(2);
    expect(output).toContain("cannot resolve to a release line");
  });
});

describe("readme-check: the pending changesets are a premise, not a guess (AC7, AC8, AC9)", () => {
  it("exits 2, naming the file, when a changeset has no frontmatter", () => {
    const { code, output } = runCheck(
      workspaceWith([{ dir: "alpha" }], {
        changesets: { "broken.md": "Just a summary and no frontmatter at all.\n" },
      }),
    );

    expect(code).toBe(2);
    expect(output).toContain(".changeset/broken.md");
    expect(output).toContain("frontmatter");
  });

  it("exits 2, naming the file, when a frontmatter line cannot be read", () => {
    const { code, output } = runCheck(
      workspaceWith([{ dir: "alpha" }], {
        changesets: { "flow.md": '---\n{ "@cosyte/alpha": minor }\n---\n\nA flow map.\n' },
      }),
    );

    expect(code).toBe(2);
    expect(output).toContain(".changeset/flow.md");
  });

  it("exits 2, naming the file, on a release type changesets would throw on", () => {
    const { code, output } = runCheck(
      workspaceWith([{ dir: "alpha" }], {
        changesets: { "typo.md": changeset({ "@cosyte/alpha": "mniro" }) },
      }),
    );

    expect(code).toBe(2);
    expect(output).toContain(".changeset/typo.md");
    expect(output).toContain("mniro");
  });

  it("exits 2, naming it, when a changeset names a package this workspace does not have", () => {
    const { code, output } = runCheck(
      workspaceWith([{ dir: "alpha" }], {
        changesets: { "typo.md": changeset({ "@cosyte/alhpa": "minor" }) },
      }),
    );

    expect(code).toBe(2);
    expect(output).toContain("@cosyte/alhpa");
    expect(output).toContain("not a package in this workspace");
  });

  it("exits 2 when `.changeset/` is absent, rather than reading it as no pending bumps", () => {
    // The two look identical from the outside and mean opposite things. A gate that could not read
    // the pending bumps must not report what one that read them and found none reports.
    const { code, output } = runCheck(workspaceWith([{ dir: "alpha" }], { noChangesetDir: true }));

    expect(code).toBe(2);
    expect(output).toContain("cannot read the changeset directory");
    expect(output).not.toContain("readme-check: OK");
  });

  it("SKIPS `.changeset/README.md` and `config.json`, which are prose and configuration", () => {
    // Both are written into every fixture, so this is the assertion that says their presence is
    // deliberate: a checker that read them as changesets would exit 2 on every case in this file.
    const { code, output } = runCheck(workspaceWith([{ dir: "alpha" }]));

    expect(code, output).toBe(0);
  });

  it("NEVER reports clean when a changeset is unreadable, even beside a real violation", () => {
    const { code, output } = runCheck(
      workspaceWith([{ dir: "alpha", mutate: (r) => r.replace("## Status", "## State") }], {
        changesets: { "broken.md": "no frontmatter here\n" },
      }),
    );

    expect(code).toBe(2);
    expect(output).not.toContain("readme-check: OK");
  });
});

describe("readme-check: what each section owes (AC7)", () => {
  it("REFUSES an Install section that does not name the package specifier", () => {
    const { code, output } = runCheck(
      workspaceWith([
        { dir: "alpha", mutate: (r) => r.replace("pnpm add -D @cosyte/alpha", "pnpm add -D it") },
      ]),
    );

    expect(code).toBe(1);
    expect(output).toContain("does not name this package's specifier");
  });

  it("REFUSES an Install section that does not name the effective Node floor", () => {
    const { code, output } = runCheck(
      workspaceWith([
        { dir: "alpha", mutate: (r) => r.replace("Node `>=22.14`.", "Recent Node.") },
      ]),
    );

    expect(code).toBe(1);
    expect(output).toContain("effective Node engine floor");
  });

  it("REFUSES a README stating a Node floor its own manifest contradicts", () => {
    const { code, output } = runCheck(
      workspaceWith([
        {
          dir: "alpha",
          engines: ">=22.0.0",
          mutate: (r) =>
            r.replace("Node `>=22.0.0`.", "Node `>=22.0.0`.\n\nRequires Node >=18.0.0."),
        },
      ]),
    );

    expect(code).toBe(1);
    expect(output).toContain("which this package's own");
  });

  it("REFUSES a Usage section with no fenced code block", () => {
    const { code, output } = runCheck(
      workspaceWith([
        {
          dir: "alpha",
          mutate: (r) =>
            r.replace('```js\nimport x from "@cosyte/alpha";\n```', "Import it and call it."),
        },
      ]),
    );

    expect(code).toBe(1);
    expect(output).toContain("no fenced code block");
  });

  it("REFUSES an empty `## PHI and safety` section", () => {
    const { code, output } = runCheck(
      workspaceWith([
        { dir: "alpha", mutate: (r) => r.replace("This fixture processes no patient data.\n", "") },
      ]),
    );

    expect(code).toBe(1);
    expect(output).toContain("owes the reader an answer");
  });

  it("REFUSES a Contributing section with no issue tracker", () => {
    const { code, output } = runCheck(
      workspaceWith([
        {
          dir: "alpha",
          mutate: (r) =>
            r.replace("Ask at https://github.com/cosyte/config/issues.", "Ask around."),
        },
      ]),
    );

    expect(code).toBe(1);
    expect(output).toContain("issue tracker");
  });

  // THE LICENSE SECTION IS GRADED ON THE SHAPE THAT SHIPS, WHICH CARRIES THE ABSOLUTE LINK.
  //
  // Every mutation below keeps that link, because the house skeleton requires it and because the URL
  // is where the first version of this check went wrong: `github.com/cosyte/config` contains the
  // owner's name, so a raw `/\bCosyte\b/i` over the section body matched the ADDRESS and the
  // attribution requirement could not fail on any of the eight READMEs that publish. Dropping the
  // link from the fixture would hide that all over again, so it is asserted present here.
  it("keeps the absolute LICENSE link in the fixture the negatives mutate", () => {
    expect(LICENSE_SECTION).toContain("https://github.com/cosyte/config/blob/main/LICENSE");
    expect(conformingReadme({ dir: "alpha" })).toContain(LICENSE_SECTION);
  });

  it("REFUSES a License section that drops the attribution but keeps the mandated link", () => {
    const { code, output } = runCheck(
      workspaceWith([
        {
          dir: "alpha",
          mutate: (r) =>
            r.replace(
              LICENSE_SECTION,
              "MIT. See [LICENSE](https://github.com/cosyte/config/blob/main/LICENSE).",
            ),
        },
      ]),
    );

    expect(code).toBe(1);
    expect(output).toContain("packages/alpha/README.md");
    expect(output).toContain("does not name the owner");
  });

  it("REFUSES a License section naming NEITHER, reporting both elements", () => {
    // The sharpest case: with the link still there, the owner half used to stay silent and the MIT
    // diagnostic was the only one raised, so half the requirement was invisible.
    const { code, output } = runCheck(
      workspaceWith([
        {
          dir: "alpha",
          mutate: (r) =>
            r.replace(
              LICENSE_SECTION,
              "See [the license file](https://github.com/cosyte/config/blob/main/LICENSE).",
            ),
        },
      ]),
    );

    expect(code).toBe(1);
    expect(output).toContain("does not name the MIT license");
    expect(output).toContain("does not name the owner");
  });

  it("REFUSES a License section whose only MIT is inside a URL", () => {
    const { code, output } = runCheck(
      workspaceWith([
        {
          dir: "alpha",
          mutate: (r) =>
            r.replace(
              LICENSE_SECTION,
              "Copyright Cosyte. See [the terms](https://opensource.org/licenses/MIT).",
            ),
        },
      ]),
    );

    expect(code).toBe(1);
    expect(output).toContain("does not name the MIT license");
  });

  it("ACCEPTS a License section whose MIT is a link LABEL, which a reader reads", () => {
    // The mirror control. Stripping targets must not delete text the reader sees, or the fix for
    // the URL false-positive becomes a false-negative on correct attribution.
    const { code } = runCheck(
      workspaceWith([
        {
          dir: "alpha",
          mutate: (r) =>
            r.replace(
              LICENSE_SECTION,
              "[MIT](https://opensource.org/licenses/MIT), copyright Cosyte. " +
                "See [LICENSE](https://github.com/cosyte/config/blob/main/LICENSE).",
            ),
        },
      ]),
    );

    expect(code).toBe(0);
  });

  it("REFUSES a License section that names no license, keeping the owner", () => {
    const { code, output } = runCheck(
      workspaceWith([
        {
          dir: "alpha",
          mutate: (r) =>
            r.replace(
              LICENSE_SECTION,
              "Copyright Cosyte. See [LICENSE](https://github.com/cosyte/config/blob/main/LICENSE).",
            ),
        },
      ]),
    );

    expect(code).toBe(1);
    expect(output).toContain("does not name the MIT license");
  });
});

describe("readme-check: claims a published README may not make (AC8, AC12)", () => {
  it("REFUSES a pointer at the umbrella meta-repo", () => {
    const { code, output } = runCheck(
      workspaceWith([
        {
          dir: "alpha",
          mutate: (r) =>
            r.replace(
              "Because the fixture needs a section here.",
              "The standard is documented in the meta-repo's `documentation/conventions.md`.",
            ),
        },
      ]),
    );

    expect(code).toBe(1);
    expect(output).toContain("documentation/conventions.md");
  });

  it("does NOT refuse this repository's own `documentation/` pointers", () => {
    // The mirror-image defect: `config` HAS a `documentation/decisions/` tree and its ADR pointers
    // are legitimate. A gate that banned the word would delete real links.
    const { code } = runCheck(
      workspaceWith([
        {
          dir: "alpha",
          mutate: (r) =>
            r.replace(
              "Because the fixture needs a section here.",
              "See [ADR 0001](documentation/decisions/0001-perf-measurement-contract.md).",
            ),
        },
      ]),
    );

    expect(code).toBe(0);
  });

  it("REFUSES a README over the 500 KiB ceiling", () => {
    const { code, output } = runCheck(
      workspaceWith([
        { dir: "alpha", mutate: (r) => `${r}\n${"padding padding padding\n".repeat(30_000)}` },
      ]),
    );

    expect(code).toBe(1);
    expect(output).toContain("GitHub truncates it");
  });

  it("REFUSES a release cadence, a release frequency or a support window", () => {
    for (const claim of [
      "Our release cadence is fixed.",
      "We publish monthly releases.",
      "A minor is released every six weeks.",
      "Each major has a support window of 18 months.",
      "Version 1 is supported until 2030.",
    ]) {
      const { code, output } = runCheck(
        workspaceWith([
          {
            dir: "alpha",
            mutate: (r) => r.replace("Because the fixture needs a section here.", claim),
          },
        ]),
      );

      expect(code, `claim: ${claim}`).toBe(1);
      expect(output).toContain("S0161-release-frequency-policy");
    }
  });
});

describe("readme-check: the governed set is derived, not listed (AC11)", () => {
  it("GRADES a package that did not exist when this gate was written", () => {
    // The half that keeps working after the gate is written. A hardcoded list of nine paths grades
    // nine paths forever; this asserts the tenth is graded too.
    const { code, output } = runCheck(
      workspaceWith([
        { dir: "alpha" },
        { dir: "beta" },
        { dir: "brand-new", mutate: (r) => r.replace("## Status", "## State") },
      ]),
    );

    expect(code).toBe(1);
    expect(output).toContain("packages/brand-new/README.md");
    expect(output).toContain("4 governed README(s)");
  });

  it("REFUSES rather than skips a package that has no README at all", () => {
    const { code, output } = runCheck(
      workspaceWith([{ dir: "alpha" }, { dir: "beta", noReadme: true }]),
    );

    // Non-zero is the requirement, and it must not be the violation code: this is the checker
    // failing to ground its premise, not a README it read and graded.
    expect(code).toBe(2);
    expect(output).toContain("packages/beta/README.md");
    expect(output).not.toContain("readme-check: OK");
  });

  it("counts the ROOT README as governed", () => {
    const { code, output } = runCheck(
      workspaceWith([{ dir: "alpha" }], { mutate: (r) => r.replace("## License", "## Licence") }),
    );

    expect(code).toBe(1);
    // The root's own label, not a package's.
    expect(output).toContain("ERROR: README.md:");
  });
});

describe("readme-check: a broken checker must not look like a caught violation (AC10)", () => {
  it("exits 2, not 1, when a governed README is absent", () => {
    const { code, output } = runCheck(workspaceWith([{ dir: "alpha", noReadme: true }]));

    expect(code).toBe(2);
    expect(output).toContain("could not run");
  });

  it("exits 2 when a package.json beside a governed README is unparseable", () => {
    const { code, output } = runCheck(
      workspaceWith([{ dir: "alpha", rawManifest: "{ not json at all" }]),
    );

    expect(code).toBe(2);
    expect(output).toContain("cannot parse");
  });

  it("exits 2 when a package.json beside a governed README is missing", () => {
    const { code, output } = runCheck(workspaceWith([{ dir: "alpha", noManifest: true }]));

    expect(code).toBe(2);
    expect(output).toContain("no package.json");
  });

  it("exits 2 when the root manifest declares no engine floor", () => {
    // Without it there is no fallback floor, so every package that declares none would be graded
    // against `undefined`. Refusing beats inventing one.
    const { code, output } = runCheck(
      workspaceWith([{ dir: "alpha" }], {
        rawManifest: JSON.stringify({ name: "cosyte-config", version: "0.0.0", private: true }),
      }),
    );

    expect(code).toBe(2);
    expect(output).toContain("engines.node");
  });

  it("exits 2 when the workspace layout is not the one it derives from", () => {
    const { code, output } = runCheck(
      workspaceWith([{ dir: "alpha" }], {
        workspaceYaml: 'packages:\n  - "apps/*"\n  - "libs/*"\n',
      }),
    );

    expect(code).toBe(2);
    expect(output).toContain("teach this script the new layout");
  });

  it("NEVER reports clean when it cannot run, even beside a real violation", () => {
    // The 1-versus-2 split exists so "broken" and "caught something" stay different signals. With
    // both present the answer must be 2: a run that did not read everything cannot claim to have
    // graded the file it did read.
    const { code, output } = runCheck(
      workspaceWith([
        { dir: "alpha", mutate: (r) => r.replace("## Status", "## State") },
        { dir: "beta", noReadme: true },
      ]),
    );

    expect(code).toBe(2);
    expect(output).not.toContain("readme-check: OK");
  });

  it("exits 2 on an unknown argument", () => {
    const { code } = runCheck(workspaceWith([{ dir: "alpha" }]), ["--bogus", "x"]);

    expect(code).toBe(2);
  });
});

describe("readme-check: the S0200 cross-check, on a 0.1.0 preparation tree (AC13)", () => {
  // THE TREE THIS GATE EXISTS TO MAKE LEGAL, built to the shape S0200 will actually land: the eight
  // published packages carry pending `minor` changesets taking them to 0.1.0, the manifests have
  // NOT moved (`changeset version` is the release owner's separate commit), and all nine READMEs
  // carry the settled sentence.
  //
  // Two gates run in the same required `verify` job and each fails the tree the other demands
  // unless this one is version-aware: this check, and S0200's criterion 13, which fails the
  // repository if ANY file still asserts the retired ladder. So both are asserted here, on one
  // fixture, in one test: exit 0 from the shipped CLI, and a ladder sweep over the same nine files
  // that finds nothing.
  const PUBLISHED = [
    "eslint-config",
    "prettier-config",
    "process",
    "script-utils",
    "test-utils",
    "tsconfig",
    "tsup-config",
    "vitest-config",
  ];

  /** The nine governed README paths of a fixture workspace, root first. */
  function governedPaths(root: string): string[] {
    return [
      join(root, "README.md"),
      ...PUBLISHED.map((dir) => join(root, "packages", dir, "README.md")),
    ];
  }

  /** Criterion 13's question, asked of one file: does it still assert the retired ladder? */
  function ladderAssertions(path: string): string[] {
    return readFileSync(path, "utf8")
      .split("\n")
      .map((line, i) => ({ line, at: i + 1 }))
      .filter(
        ({ line }) =>
          /\b0\.0\.x\b[^\n]{0,60}?\bladder\b/i.test(line) ||
          /\bladder\b[^\n]{0,60}?\b0\.0\.x\b/i.test(line) ||
          /\b0\.0\.x\b[^\n]{0,40}?\buntil\b[^\n]{0,40}?\balpha\b/i.test(line),
      )
      .map(({ line, at }) => `${path}:${at}: ${line.trim()}`);
  }

  it("ACCEPTS the tree, and no governed README in it still asserts the 0.0.x ladder", () => {
    const root = workspaceWith(
      PUBLISHED.map((dir) => ({ dir, version: "0.0.4", effectiveLine: "0.1.x" })),
      {
        changesets: {
          "settle-the-api.md": changeset(
            Object.fromEntries(PUBLISHED.map((dir) => [`@cosyte/${dir}`, "minor"])),
          ),
        },
      },
    );

    const { code, output } = runCheck(root);

    expect(code, output).toBe(0);
    expect(output).toContain("9 governed README(s)");

    const stillAsserting = governedPaths(root).flatMap((path) => ladderAssertions(path));
    expect(
      stillAsserting,
      `files still asserting the retired ladder:\n${stillAsserting.join("\n")}`,
    ).toEqual([]);
  });

  it("is not a tautology: the same tree with S0197's sentences fails BOTH halves", () => {
    // Without this the test above proves only that a fixture the fixture builder wrote agrees with
    // itself. On the ladder wording the CLI refuses AND the sweep finds nine assertions, which is
    // exactly the deadlock the conductor's ruling describes.
    const root = workspaceWith(
      PUBLISHED.map((dir) => ({ dir, version: "0.0.4", effectiveLine: "0.0.x" })),
      {
        effectiveLine: "0.0.x",
        changesets: {
          "settle-the-api.md": changeset(
            Object.fromEntries(PUBLISHED.map((dir) => [`@cosyte/${dir}`, "minor"])),
          ),
        },
      },
    );

    const { code } = runCheck(root);

    expect(code).toBe(1);
    expect(governedPaths(root).flatMap((path) => ladderAssertions(path))).toHaveLength(9);
  });
});

describe("readme-check: the real repository", () => {
  it("passes over this repo's own nine READMEs", () => {
    // Not a tautology: this is the state ci.yml will actually run the gate against, and it is the
    // assertion that catches a README edited after this gate landed.
    const { code, output } = runCheck(join(import.meta.dirname, ".."));

    expect(code).toBe(0);
    expect(output).toContain("9 governed README(s)");
  });
});
