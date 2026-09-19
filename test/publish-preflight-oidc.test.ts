import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseWorkflow } from "../scripts/credential-surface.mjs";

// WHAT THE RELEASE COMMAND PATH DOES WHEN IT RUNS, WITH NO REGISTRY CREDENTIAL ANYWHERE
// (spec S0317-config-1).
//
// The sibling file `tokenless-publish.test.ts` grades what the committed workflow, declaration and
// allow-set SAY. This one runs the two scripts on the release command path and grades what they DO:
//
//   scripts/publish-preflight.mjs   runs first in `pnpm run release`, before the build and long
//                                   before anything is packed. AC-3, AC-6, AC-7.
//   scripts/npm-config-allow.mjs    runs inside the gated publish job, before the publish. AC-9.
//
// BOTH DIRECTIONS, EVERY TIME. A preflight that refuses everything passes every negative case here
// and takes the release path down; a preflight that passes everything is not a preflight. And the
// refusals are separated by exit code the way every gate in this repository separates them: 1 is
// "checked, and it was not there", 2 is "could not check", because a broken gate and a caught defect
// must not be one signal in CI.
//
// NOTHING HERE READS A CREDENTIAL VALUE, and one case proves it: a sentinel is placed in the
// environment and the whole output is asserted not to contain it. This repository is public and its
// build logs are public with it.

const REPO = join(import.meta.dirname, "..");
const DECLARATION = join(".github", "credential-surface.json");
const RELEASE_WORKFLOW = join(".github", "workflows", "release.yml");
const PREFLIGHT = join(REPO, "scripts", "publish-preflight.mjs");
const ALLOW_CHECK = join(REPO, "scripts", "npm-config-allow.mjs");

/** The allow-check spawns npm twice and pnpm twice. Vitest's five second default is not a budget. */
const SLOW = 180_000;

/** A value no message may ever echo. If it appears in the output, something leaked a secret. */
const SENTINEL = "npm_thisvalueMUSTneverBEprinted000000";

/** What GitHub gives a job holding `id-token: write`, as the declaration names them. */
const OIDC_URL = "ACTIONS_ID_TOKEN_REQUEST_URL";
const OIDC_TOKEN = "ACTIONS_ID_TOKEN_REQUEST_TOKEN";

/** An environment in which the workflow's OIDC identity is available, as a runner presents it. */
const AUTHENTICATED = {
  [OIDC_URL]: "https://pipelines.example.invalid/_apis/distributedtask/hubs/Actions/oidctoken",
  [OIDC_TOKEN]: SENTINEL,
};

const temporaryDirs: string[] = [];

afterEach(() => {
  while (temporaryDirs.length > 0) {
    const dir = temporaryDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Make a throwaway directory that is cleaned up after the test.
 *
 * @param prefix Name prefix.
 * @returns The directory.
 */
function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `${prefix}-`));
  temporaryDirs.push(dir);
  return dir;
}

interface Run {
  status: number;
  stdout: string;
  output: string;
}

/**
 * Run the shipped preflight in a controlled environment.
 *
 * Nothing is inherited from this process, so a variable that happens to be set on the machine the
 * suite runs on cannot turn a negative case green. `--npm-bin` stands in for the BOUNDARY, the npm
 * binary `pnpm publish` would call, and never for the preflight itself.
 *
 * @param root The repository root to check against.
 * @param env The environment to inspect.
 * @param npmBin The npm binary the preflight should ask for its version.
 * @returns Its exit status and output.
 */
function preflight(root: string, env: Record<string, string>, npmBin?: string): Run {
  const args = [PREFLIGHT, "--repo", root, ...(npmBin === undefined ? [] : ["--npm-bin", npmBin])];
  const result = spawnSync(process.execPath, args, {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", ...env },
  });
  const stdout = result.stdout ?? "";
  return { status: result.status ?? -1, stdout, output: `${stdout}${result.stderr ?? ""}` };
}

/**
 * Copy this repository's real declaration into a throwaway directory.
 *
 * @returns The fixture root.
 */
function fixture(): string {
  const root = temp("publish-preflight-oidc");
  mkdirSync(join(root, ".github"), { recursive: true });
  copyFileSync(join(REPO, DECLARATION), join(root, DECLARATION));
  return root;
}

/**
 * Rewrite the fixture's declaration through a callback that mutates the parsed object.
 *
 * @param root The fixture root.
 * @param mutate Receives the parsed declaration.
 */
function editDeclaration(root: string, mutate: (declaration: Declaration) => void): void {
  const path = join(root, DECLARATION);
  const declaration = JSON.parse(readFileSync(path, "utf8")) as Declaration;
  mutate(declaration);
  writeFileSync(path, `${JSON.stringify(declaration, null, 2)}\n`, "utf8");
}

interface Declaration {
  publishPath: {
    job: string;
    workflow: string;
    authentication: {
      method: string;
      npmCliFloor: string;
      runtimeEvidence: { variable: string; note?: string }[];
    };
  };
  credentials: { name: string; requiredForPublish: boolean }[];
}

/**
 * @returns This repository's committed declaration.
 */
function realDeclaration(): Declaration {
  return JSON.parse(readFileSync(join(REPO, DECLARATION), "utf8")) as Declaration;
}

/**
 * Write an executable stand-in for the npm binary, answering one version.
 *
 * @param version What `npm --version` should print. Empty means print nothing usable.
 * @returns The path to the fake binary.
 */
function fakeNpm(version: string): string {
  const path = join(temp("fake-npm"), "npm");
  writeFileSync(path, `#!/bin/sh\nprintf '%s\\n' '${version}'\n`, "utf8");
  chmodSync(path, 0o755);
  return path;
}

/** An npm that meets the declared floor, so a case about authentication is only about that. */
const NPM_AT_FLOOR = (): string =>
  fakeNpm(realDeclaration().publishPath.authentication.npmCliFloor);

// ---------------------------------------------------------------------------------------------
// AC-6: the release command path checks that the declared authentication is available here, and
// refuses before the build, without contacting the registry, naming what was missing.
// ---------------------------------------------------------------------------------------------

describe("AC-6: the declared authentication must be available in this environment", () => {
  it("refuses with nothing set, naming every variable the declared authentication needs", () => {
    const result = preflight(fixture(), {}, NPM_AT_FLOOR());
    expect(result.status).toBe(1);
    expect(result.output).toContain("REFUSING TO PUBLISH");
    expect(result.output).toContain(OIDC_URL);
    expect(result.output).toContain(OIDC_TOKEN);
    expect(result.output).toContain("the registry has NOT been contacted");
  });

  it("names the method the declaration gave, rather than a credential hardcoded here", () => {
    const result = preflight(fixture(), {}, NPM_AT_FLOOR());
    expect(result.output).toContain(realDeclaration().publishPath.authentication.method);
  });

  it("says what to do about it: run it where that authentication exists", () => {
    const declaration = realDeclaration();
    const result = preflight(fixture(), {}, NPM_AT_FLOOR());
    expect(result.output).toContain("ACTION:");
    expect(result.output).toContain(declaration.publishPath.job);
    expect(result.output).toContain(declaration.publishPath.workflow);
  });

  it("treats an empty value as absent", () => {
    const result = preflight(fixture(), { [OIDC_URL]: "", [OIDC_TOKEN]: "" }, NPM_AT_FLOOR());
    expect(result.status).toBe(1);
    expect(result.output).toContain(OIDC_URL);
  });

  it("treats a whitespace-only value as absent", () => {
    const result = preflight(
      fixture(),
      { [OIDC_URL]: "   ", [OIDC_TOKEN]: "  \t " },
      NPM_AT_FLOOR(),
    );
    expect(result.status).toBe(1);
    expect(result.output).toContain(OIDC_URL);
  });

  it("catches the half-set case, where one of the two variables is missing", () => {
    const result = preflight(fixture(), { [OIDC_URL]: AUTHENTICATED[OIDC_URL] }, NPM_AT_FLOOR());
    expect(result.status).toBe(1);
    expect(result.output).toContain(OIDC_TOKEN);
  });

  it("never echoes a credential value", () => {
    // One of the two variables IS a credential. It is tested for presence and never read.
    const result = preflight(fixture(), { [OIDC_TOKEN]: SENTINEL }, NPM_AT_FLOOR());
    expect(result.status).toBe(1);
    expect(result.output).not.toContain(SENTINEL);
  });

  it("passes when the declared authentication is present (positive control)", () => {
    const result = preflight(fixture(), AUTHENTICATED, NPM_AT_FLOOR());
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Proceeding to build and publish");
    expect(result.output).not.toContain(SENTINEL);
  });

  it("still names the token class and the one place it may live, for a credential that needs one", () => {
    // The credential route is not dead code just because this repository authenticates without one:
    // the declaration decides, and a token method would restore it. A declaration that requires a
    // credential must still produce the operator's two questions ("which token, and where does it
    // live") in the refusal, rather than only the OIDC sentence.
    const root = fixture();
    const path = join(root, DECLARATION);
    const declaration = JSON.parse(readFileSync(path, "utf8")) as {
      publishPath: { job: string };
      credentials: Record<string, unknown>[];
    };
    declaration.credentials.unshift({
      name: "A_REGISTRY_TOKEN",
      tokenClass: "An automation token with publish rights, which is what this case is about.",
      storage: "organization",
      requiredForPublish: true,
      registryAuth: true,
      exposures: [
        { job: declaration.publishPath.job, step: "Publish", as: "env", name: "A_REGISTRY_TOKEN" },
      ],
      issuedForms: [],
      retiredWhen: "When the publish path stops declaring it as required for publishing.",
    });
    writeFileSync(path, `${JSON.stringify(declaration, null, 2)}\n`, "utf8");

    const result = preflight(root, AUTHENTICATED, NPM_AT_FLOOR());
    expect(result.status).toBe(1);
    expect(result.output).toContain("A_REGISTRY_TOKEN");
    expect(result.output).toContain("organization");
    expect(result.output).toContain("automation token with publish rights");
    expect(result.output).toContain("Credential rotation, revocation, and compensating actions");
  });

  it("does not fail closed on a credential the declaration marks optional", () => {
    // RELEASE_PR_TOKEN is optional by design: failing on its absence would take the release path
    // down to protect against a state this repository is already able to be in.
    const declaration = realDeclaration();
    const optional = declaration.credentials.find((entry) => entry.name === "RELEASE_PR_TOKEN");
    expect(optional?.requiredForPublish, "RELEASE_PR_TOKEN is optional by design").toBe(false);
    expect(preflight(fixture(), AUTHENTICATED, NPM_AT_FLOOR()).status).toBe(0);
  });

  it("runs before the build is paid for, and guards the command path rather than one step list", () => {
    const manifest = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const release = manifest.scripts.release;
    expect(release.startsWith("node scripts/publish-preflight.mjs &&")).toBe(true);
    expect(release.indexOf("publish-preflight")).toBeLessThan(release.indexOf("build"));
    expect(release.indexOf("publish-preflight")).toBeLessThan(release.indexOf("changeset publish"));
    // The release workflow reaches the registry through `publish: pnpm run release`, so the guard
    // sits on that command. A step in release.yml would guard release.yml and nothing else.
    expect(readFileSync(join(REPO, RELEASE_WORKFLOW), "utf8")).toContain(
      "publish: pnpm run release",
    );
  });
});

// ---------------------------------------------------------------------------------------------
// AC-7: a declaration that cannot be read, or that names no authentication at all for the publish
// path, is a refusal. A check that would pass on an empty environment is a declaration bug.
// ---------------------------------------------------------------------------------------------

describe("AC-7: a preflight that cannot know what to check is not a preflight that passed", () => {
  it("refuses when the declaration is absent", () => {
    const root = fixture();
    rmSync(join(root, DECLARATION));
    const result = preflight(root, AUTHENTICATED, NPM_AT_FLOOR());
    expect(result.status).toBe(2);
    expect(result.output).toContain("REFUSING TO PUBLISH");
    expect(result.output).toContain("declaration-absent");
  });

  it("refuses when the declaration is not valid JSON", () => {
    const root = fixture();
    writeFileSync(join(root, DECLARATION), "{ nope", "utf8");
    const result = preflight(root, AUTHENTICATED, NPM_AT_FLOOR());
    expect(result.status).toBe(2);
    expect(result.output).toContain("declaration-unparseable");
  });

  it("refuses a declaration carrying no authentication block at all", () => {
    const root = fixture();
    const path = join(root, DECLARATION);
    const declaration = JSON.parse(readFileSync(path, "utf8")) as {
      publishPath: Record<string, unknown>;
    };
    delete declaration.publishPath.authentication;
    writeFileSync(path, `${JSON.stringify(declaration, null, 2)}\n`, "utf8");

    const result = preflight(root, AUTHENTICATED, NPM_AT_FLOOR());
    expect(result.status).toBe(2);
    expect(result.output).toContain("publishPath.authentication");
    expect(result.output).toContain("cannot be conformed to");
  });

  it("refuses a declaration naming nothing to check, rather than passing on any environment at all", () => {
    const root = fixture();
    editDeclaration(root, (declaration) => {
      // A declaration that says the path is token-authenticated, names no runtime evidence, and
      // marks no credential required. Every check it implies is vacuous.
      declaration.publishPath.authentication.method = "npm-token";
      declaration.publishPath.authentication.runtimeEvidence = [];
      for (const credential of declaration.credentials) credential.requiredForPublish = false;
    });
    const result = preflight(root, {}, NPM_AT_FLOOR());
    expect(result.status).toBe(2);
    expect(result.output).toContain("names no authentication");
    expect(result.output).toContain("declaration bug");
  });

  it("refuses an OIDC declaration whose runtime evidence was emptied", () => {
    const root = fixture();
    editDeclaration(root, (declaration) => {
      declaration.publishPath.authentication.runtimeEvidence = [];
    });
    const result = preflight(root, AUTHENTICATED, NPM_AT_FLOOR());
    expect(result.status).toBe(2);
    expect(result.output).toContain("runtimeEvidence");
  });

  it("separates a bad invocation from a missing credential", () => {
    const result = spawnSync(process.execPath, [PREFLIGHT, "--nonsense"], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "" },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("could not run");
  });
});

// ---------------------------------------------------------------------------------------------
// AC-3: an npm below the floor fails the release before any package is packed, naming the version
// found and the floor it failed.
// ---------------------------------------------------------------------------------------------

describe("AC-3: the npm on the publish path must be one trusted publishing can use", () => {
  it("refuses an npm below the floor, naming the version it found and the floor", () => {
    const floor = realDeclaration().publishPath.authentication.npmCliFloor;
    const result = preflight(fixture(), AUTHENTICATED, fakeNpm("10.9.2"));
    expect(result.status).toBe(1);
    expect(result.output).toContain("REFUSING TO PUBLISH");
    expect(result.output).toContain("10.9.2");
    expect(result.output).toContain(floor);
    expect(result.output).toContain("nothing has been packed");
  });

  it("refuses the version one patch below the floor, so the comparison is not off by one", () => {
    const result = preflight(fixture(), AUTHENTICATED, fakeNpm("11.5.0"));
    expect(result.status).toBe(1);
    expect(result.output).toContain("11.5.0");
  });

  it("accepts the floor itself", () => {
    expect(preflight(fixture(), AUTHENTICATED, fakeNpm("11.5.1")).status).toBe(0);
  });

  it("accepts an npm above the floor, and says which one it found", () => {
    const result = preflight(fixture(), AUTHENTICATED, fakeNpm("11.19.1"));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("11.19.1");
  });

  it("refuses when the npm it would publish with cannot be asked at all", () => {
    const result = preflight(fixture(), AUTHENTICATED, join(temp("gone"), "no-such-npm"));
    expect(result.status).toBe(2);
    expect(result.output).toContain("npm-version-unreadable");
  });

  it("refuses when npm answers something that is not a version", () => {
    const result = preflight(fixture(), AUTHENTICATED, fakeNpm("not a version"));
    expect(result.status).toBe(2);
    expect(result.output).toContain("npm-version-unreadable");
  });

  it("reads the floor from the declaration rather than from a number written here", () => {
    const root = fixture();
    editDeclaration(root, (declaration) => {
      declaration.publishPath.authentication.npmCliFloor = "12.0.0";
    });
    const result = preflight(root, AUTHENTICATED, fakeNpm("11.19.1"));
    expect(result.status).toBe(1);
    expect(result.output).toContain("12.0.0");
  });
});

// ---------------------------------------------------------------------------------------------
// AC-9: the publish configuration allow-check resolves the effective configuration completely and
// permits it with no registry credential in its environment, and still refuses a `provenance` that
// is not true.
// ---------------------------------------------------------------------------------------------

describe("AC-9: the configuration allow-check runs credential-free", () => {
  /**
   * The environment release.yml gives the allow-check step, read off the workflow rather than
   * invented here, so a change to that step's `env:` block changes what this suite runs.
   *
   * @returns The variable names that step declares.
   */
  function allowCheckEnvKeys(): string[] {
    const workflow = parseWorkflow(readFileSync(join(REPO, RELEASE_WORKFLOW), "utf8")) as {
      entries: Map<string, { entries: Map<string, unknown> }>;
    };
    const jobs = workflow.entries.get("jobs") as { entries: Map<string, never> };
    const publish = jobs.entries.get("publish") as unknown as {
      entries: Map<string, { items: { entries: Map<string, { entries: Map<string, never> }> }[] }>;
    };
    const steps = publish.entries.get("steps")!.items;
    const step = steps.find(
      (candidate) =>
        (candidate.entries.get("name") as unknown as { value?: string })?.value ===
        "The publish configuration must be one the allow-set permits",
    );
    const env = step?.entries.get("env");
    return env === undefined ? [] : [...env.entries.keys()];
  }

  /**
   * The publish job's context, with no registry credential in it because that job has none.
   *
   * @param overrides Extra variables for a specific case.
   * @returns The environment.
   */
  function publishJobContext(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
    const home = temp("allow-check-home");
    const emptyRc = join(home, "empty-npmrc");
    writeFileSync(emptyRc, "", "utf8");
    return {
      PATH: process.env.PATH,
      HOME: home,
      // The check measures the package managers' own defaults in a throwaway directory under the
      // machine's temp dir, and a runner supplies one. Carried through rather than left to default,
      // so the case is about the allow-set and not about the size of `/tmp` on the machine.
      ...(process.env.TMPDIR === undefined ? {} : { TMPDIR: process.env.TMPDIR }),
      NPM_CONFIG_GLOBALCONFIG: emptyRc,
      NPM_CONFIG_PROVENANCE: "true",
      ...overrides,
    };
  }

  it("is given no registry credential by the workflow, so the environment used below is the real one", () => {
    const keys = allowCheckEnvKeys();
    expect(keys).toEqual(["NPM_CONFIG_PROVENANCE"]);
    for (const key of keys) {
      expect(key).not.toMatch(/TOKEN|AUTH|PASSWORD|SECRET/i);
    }
  });

  it(
    "resolves the effective configuration completely and permits it, with no credential present",
    () => {
      const result = spawnSync(process.execPath, [ALLOW_CHECK, "--workspace", REPO], {
        encoding: "utf8",
        env: publishJobContext(),
      });
      const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
      expect(result.status, output).toBe(0);
      expect(output).toContain("npm-config-allow: OK");
      // RESOLVED, not merely unrefused: the publish configuration of all eight published packages
      // was read, and both resolvers answered. A run that resolved nothing would also print OK.
      expect(output.match(/publishConfig:access/g)?.length).toBe(8);
      expect(output).toContain("provenance = true");
      expect(output).not.toContain("could not run");
    },
    SLOW,
  );

  it(
    "still refuses a provenance that is not true, which is the value it exists to pin",
    () => {
      const result = spawnSync(process.execPath, [ALLOW_CHECK, "--workspace", REPO], {
        encoding: "utf8",
        env: publishJobContext({ NPM_CONFIG_PROVENANCE: "false" }),
      });
      const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
      expect(result.status, output).toBe(1);
      expect(output).toContain("provenance");
      expect(output).toContain("NOT permitted");
    },
    SLOW,
  );
});
