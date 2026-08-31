import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

interface PackageSpec {
  /** Directory name under `packages/`. */
  dir: string;
  /** Manifest name. Defaults to `@cosyte/<dir>`. */
  name?: string;
  version?: string;
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
 * A README that conforms to the house skeleton, for one package.
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
  const version = spec.version ?? "0.0.1";
  const status = version.startsWith("0.0.")
    ? `\`${name}\` is on the cosyte 0.0.x ladder: the public API is not yet settled and may change in any release.\n\nStill moving: the option surface.`
    : "Released and in use.\n\nStill moving: nothing worth naming.";
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

MIT, copyright Cosyte.
`;
}

/**
 * Build a throwaway workspace: a root manifest, a `pnpm-workspace.yaml`, and a `packages/` tree.
 *
 * The checker derives its governed set from the workspace at run time, so a fixture has to carry a
 * real one: asserting against an invented layout would test a different program.
 *
 * @param specs The packages to create.
 * @param rootOverrides Changes to the root package and its README.
 * @returns The workspace root.
 */
function workspaceWith(
  specs: PackageSpec[],
  rootOverrides: Partial<PackageSpec> & { workspaceYaml?: string } = {},
): string {
  const root = mkdtempSync(join(tmpdir(), "readme-check-"));
  temporaryDirs.push(root);

  writeFileSync(
    join(root, "pnpm-workspace.yaml"),
    rootOverrides.workspaceYaml ?? 'packages:\n  - "packages/*"\n',
    "utf8",
  );

  const rootSpec: PackageSpec = {
    dir: "root",
    name: "cosyte-config",
    version: "0.0.0",
    private: true,
    description: "The fixture workspace root.",
    engines: ROOT_FLOOR,
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

  it("does NOT require the 0.0.x sentence of a package past 0.0.x", () => {
    // The mirror-image defect. When S0200 bumps a package to 0.1.0 its Status sentence changes,
    // and a gate that still demanded the ladder sentence would block that release.
    const { code } = runCheck(workspaceWith([{ dir: "alpha", version: "0.1.0" }]));

    expect(code).toBe(0);
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

  it("REFUSES a License section that names no license or no owner", () => {
    const missingOwner = runCheck(
      workspaceWith([{ dir: "alpha", mutate: (r) => r.replace("MIT, copyright Cosyte.", "MIT.") }]),
    );
    expect(missingOwner.code).toBe(1);
    expect(missingOwner.output).toContain("does not name the owner");

    const missingLicense = runCheck(
      workspaceWith([
        { dir: "alpha", mutate: (r) => r.replace("MIT, copyright Cosyte.", "Copyright Cosyte.") },
      ]),
    );
    expect(missingLicense.code).toBe(1);
    expect(missingLicense.output).toContain("does not name the MIT license");
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

describe("readme-check: the real repository", () => {
  it("passes over this repo's own nine READMEs", () => {
    // Not a tautology: this is the state ci.yml will actually run the gate against, and it is the
    // assertion that catches a README edited after this gate landed.
    const { code, output } = runCheck(join(import.meta.dirname, ".."));

    expect(code).toBe(0);
    expect(output).toContain("9 governed README(s)");
  });
});
