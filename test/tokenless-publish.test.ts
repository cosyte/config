import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseWorkflow } from "../scripts/credential-surface.mjs";

// WHAT THE COMMITTED RELEASE PATH SAYS: NO REGISTRY CREDENTIAL, AND AN npm THAT CAN PUBLISH WITHOUT
// ONE (spec S0317-config-1).
//
// The objective: no long-lived npm credential exists that could publish a forged `@cosyte/*`
// version, because the release workflow's own OIDC identity is what the registry accepts. What that
// costs, if it is got wrong in the other direction, is the ability to publish at all, and an npm
// version is permanent, so every criterion here fails closed.
//
// This file grades what the committed workflow, declaration and allow-set SAY. The sibling file
// `publish-preflight-oidc.test.ts` grades what the release command path DOES when it runs.
//
// EVERY GRADER HERE IS RUN AGAINST A MUTATION THAT BREAKS THE PROPERTY IT ASSERTS. A check that
// cannot fail is not evidence, and a workflow assertion is the easiest place in a repository to
// write one by accident: the file is long, the property is narrow, and "it passed" and "it matched
// nothing" look identical from the outside.
//
// The workflow is PARSED rather than grepped, with the repository's own reader, for the reason
// `scripts/credential-surface.mjs` documents: this file's comments discuss npm tokens in ordinary
// English, and a text scan cannot tell prose from wiring. A reference to a secret is structure.

const REPO = join(import.meta.dirname, "..");
const RELEASE_WORKFLOW = join(".github", "workflows", "release.yml");
const CI_WORKFLOW = join(".github", "workflows", "ci.yml");
const DECLARATION = join(".github", "credential-surface.json");
const DOCS = "RELEASING.md";
const SURFACE_CHECK = join(REPO, "scripts", "credential-surface.mjs");
const TOOLCHAIN_CHECK = join(REPO, "scripts", "publish-toolchain.mjs");

const RELEASE_TEXT = readFileSync(join(REPO, RELEASE_WORKFLOW), "utf8");
const CI_TEXT = readFileSync(join(REPO, CI_WORKFLOW), "utf8");

/** The names an npm registry credential has ever had on this path. */
const REGISTRY_CREDENTIAL_NAMES = /NPM_TOKEN|NODE_AUTH_TOKEN/;

const temporaryDirs: string[] = [];

afterEach(() => {
  while (temporaryDirs.length > 0) {
    const dir = temporaryDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

interface Run {
  status: number;
  output: string;
}

/**
 * Run one of the shipped gates, because what CI depends on is the process exit code.
 *
 * @param script The gate to run.
 * @param args Arguments after the script name.
 * @returns Its exit status and both streams.
 */
function run(script: string, args: string[]): Run {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
  return { status: result.status ?? -1, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

/**
 * Copy the four files the release path's credential surface is made of into a throwaway directory.
 *
 * Copies rather than miniatures: a hand-written workflow proves a checker can read a workflow
 * written for the checker.
 *
 * @returns The fixture root.
 */
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "tokenless-publish-"));
  temporaryDirs.push(root);
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });
  for (const relative of [RELEASE_WORKFLOW, CI_WORKFLOW, DECLARATION, DOCS]) {
    copyFileSync(join(REPO, relative), join(root, relative));
  }
  return root;
}

/**
 * Rewrite one of the fixture's files, asserting the rewrite actually changed it.
 *
 * A stale replacement string would otherwise make a negative case pass by mutating nothing, which
 * is the one way a suite of mutations can quietly stop being evidence.
 *
 * @param root The fixture root.
 * @param relative Which file.
 * @param rewrite Receives the current contents and returns the new contents.
 */
function edit(root: string, relative: string, rewrite: (text: string) => string): void {
  const before = readFileSync(join(root, relative), "utf8");
  const after = rewrite(before);
  expect(after, `the mutation of ${relative} changed nothing, so it would prove nothing`).not.toBe(
    before,
  );
  writeFileSync(join(root, relative), after, "utf8");
}

type Node =
  | { kind: "scalar"; value: string; line: number }
  | { kind: "seq"; items: Node[]; line: number }
  | { kind: "map"; entries: Map<string, Node>; line: number };

/**
 * @param text A workflow file.
 * @returns Its parsed root node.
 */
function parse(text: string): Node {
  return parseWorkflow(text) as Node;
}

/**
 * @param node A node.
 * @param key The key to read.
 * @returns The child node, or undefined.
 */
function get(node: Node | undefined, key: string): Node | undefined {
  return node !== undefined && node.kind === "map" ? node.entries.get(key) : undefined;
}

/**
 * @param node A node.
 * @returns Its scalar value, or undefined.
 */
function scalar(node: Node | undefined): string | undefined {
  return node !== undefined && node.kind === "scalar" ? node.value : undefined;
}

/**
 * @param workflow A parsed workflow.
 * @param jobId The job.
 * @returns Its step nodes, in order.
 */
function steps(workflow: Node, jobId: string): Node[] {
  const list = get(get(get(workflow, "jobs"), jobId), "steps");
  return list !== undefined && list.kind === "seq" ? list.items : [];
}

/**
 * Every place a name appears in the WIRING of a workflow: a key of any mapping, or any scalar value.
 *
 * Comments are not here, and that is the point. The parser drops them, so a header that explains in
 * English why a token is gone is not mistaken for the token coming back, while a `${{ secrets.X }}`
 * expression, an `env:` key and a `run:` script that reads `$X` all are wiring and are all reported.
 *
 * @param node The node to walk.
 * @param path The path taken so far.
 * @param found Accumulator.
 * @returns Every `{ where, text }` pair in the tree.
 */
function wiring(node: Node, path: string[] = [], found: { where: string; text: string }[] = []) {
  if (node.kind === "scalar") {
    found.push({ where: path.join("."), text: node.value });
    return found;
  }
  if (node.kind === "seq") {
    node.items.forEach((item, index) => wiring(item, [...path, String(index)], found));
    return found;
  }
  for (const [key, value] of node.entries) {
    found.push({ where: [...path, key].join("."), text: key });
    wiring(value, [...path, key], found);
  }
  return found;
}

/**
 * Every way a registry credential could still be wired into a workflow. Empty means none is.
 *
 * @param text The workflow file.
 * @returns One problem per place a registry credential name appears in the wiring.
 */
function gradeCredentialFreedom(text: string): string[] {
  return wiring(parse(text))
    .filter((entry) => REGISTRY_CREDENTIAL_NAMES.test(entry.text))
    .map((entry) => `${entry.where} carries a registry credential name: ${entry.text}`);
}

// ---------------------------------------------------------------------------------------------
// AC-1: no npm registry credential is exposed to any job or step of the release workflow, and the
// publish job's only authentication is `id-token: write` plus the protected environment.
// ---------------------------------------------------------------------------------------------

describe("AC-1: the release workflow exposes no npm registry credential", () => {
  it("references no NPM_TOKEN or NODE_AUTH_TOKEN secret anywhere in the file", () => {
    expect(gradeCredentialFreedom(RELEASE_TEXT)).toEqual([]);
  });

  it("REFUSES a workflow where the token is wired back into the publish step", () => {
    const mutated = RELEASE_TEXT.replace(
      "          GITHUB_TOKEN: ${{ secrets.RELEASE_PR_TOKEN || secrets.GITHUB_TOKEN }}\n",
      "          GITHUB_TOKEN: ${{ secrets.RELEASE_PR_TOKEN || secrets.GITHUB_TOKEN }}\n          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}\n",
    );
    expect(mutated).not.toBe(RELEASE_TEXT);
    expect(gradeCredentialFreedom(mutated).join("\n")).toContain("NODE_AUTH_TOKEN");
  });

  it("REFUSES a workflow where the token is read by a run script rather than declared", () => {
    const mutated = RELEASE_TEXT.replace(
      "        run: node scripts/npm-config-allow.mjs\n",
      '        run: echo "$NPM_TOKEN" > /dev/null && node scripts/npm-config-allow.mjs\n',
    );
    expect(mutated).not.toBe(RELEASE_TEXT);
    expect(gradeCredentialFreedom(mutated).join("\n")).toContain("NPM_TOKEN");
  });

  it("does not mistake the header's prose for wiring", () => {
    // The header explains at length that no registry credential belongs here, and the configuration
    // gate's comment names the npmrc variable that is no longer generated. A grep would report both.
    expect(RELEASE_TEXT).toContain("NODE_AUTH_TOKEN");
    expect(gradeCredentialFreedom(RELEASE_TEXT)).toEqual([]);
  });

  it("keeps `id-token: write` and the protected release environment on the publish job, and grants them nowhere else", () => {
    const workflow = parse(RELEASE_TEXT);
    const jobs = get(workflow, "jobs");
    expect(jobs?.kind).toBe("map");

    const publish = get(jobs, "publish");
    expect(scalar(get(publish, "environment"))).toBe("release");
    expect(scalar(get(get(publish, "permissions"), "id-token"))).toBe("write");

    for (const jobId of ["preflight", "version"]) {
      const job = get(jobs, jobId);
      expect(scalar(get(get(job, "permissions"), "id-token")), `${jobId}`).toBeUndefined();
      expect(get(job, "environment"), `${jobId}`).toBeUndefined();
    }
  });

  it("generates no user npmrc whose only purpose is carrying a token", () => {
    // `actions/setup-node` given `registry-url` WRITES `//registry.npmjs.org/:_authToken=${...}` into
    // a generated user config and points NPM_CONFIG_USERCONFIG at it. On a tokenless path that file
    // carries a reference to a variable nothing sets, and what each resolver does with an
    // unresolvable reference is a property of its own version rather than of anything committed
    // here. The registry itself is pinned by `npm-config-allow.json`'s `require` rule instead.
    const setupNode = steps(parse(RELEASE_TEXT), "publish").filter((step) =>
      (scalar(get(step, "uses")) ?? "").startsWith("actions/setup-node@"),
    );
    expect(setupNode.length).toBe(1);
    expect(get(get(setupNode[0]!, "with"), "registry-url")).toBeUndefined();

    const allowSet = JSON.parse(readFileSync(join(REPO, "npm-config-allow.json"), "utf8")) as {
      allow: { key: string }[];
      require: { key: string; value: unknown }[];
    };
    // And the allow-set no longer permits a registry credential key by name, so one arriving from
    // any source at all is a refusal rather than a permitted value.
    expect(allowSet.allow.map((entry) => entry.key)).not.toContain(
      "//registry.npmjs.org/:_authToken",
    );
    expect(allowSet.require).toContainEqual(
      expect.objectContaining({ key: "registry", value: "https://registry.npmjs.org/" }),
    );
  });
});

// ---------------------------------------------------------------------------------------------
// AC-4 and AC-5: the required `verify` check refuses a publish path that does not declare an npm at
// or above the floor, and refuses a release dry run declaring a different toolchain.
// ---------------------------------------------------------------------------------------------

describe("AC-4: the npm CLI floor is provable from the workflow, at merge time", () => {
  it("passes over this repository as committed (positive control)", () => {
    const result = run(TOOLCHAIN_CHECK, ["--repo", REPO]);
    expect(result.status).toBe(0);
    expect(result.output).toContain("floor");
  });

  it("runs inside the required verify job, before the install, with nothing neutralizing it", () => {
    // `verify` is the only REQUIRED status check in this repository's ruleset, so this is the copy
    // that can refuse a merge. A gate in any other job runs, is visible, and blocks nothing.
    const verify = steps(parse(CI_TEXT), "verify");
    const gates = verify.filter((step) =>
      (scalar(get(step, "run")) ?? "").includes("scripts/publish-toolchain.mjs"),
    );
    expect(gates.length).toBe(1);
    expect(scalar(get(gates[0]!, "run"))).toBe("node scripts/publish-toolchain.mjs");
    expect(get(gates[0]!, "if")).toBeUndefined();
    expect(get(gates[0]!, "continue-on-error")).toBeUndefined();

    const runs = verify.map((step) => scalar(get(step, "run")) ?? "");
    expect(runs.findIndex((script) => script.includes("publish-toolchain"))).toBeLessThan(
      runs.findIndex((script) => script.includes("pnpm install")),
    );
  });

  it("REFUSES a publish path whose npm version is discoverable only at run time", () => {
    const root = fixture();
    edit(root, RELEASE_WORKFLOW, (text) =>
      text.replace('          NPM_CLI_VERSION: "11.19.1"\n', ""),
    );
    const result = run(TOOLCHAIN_CHECK, ["--repo", root]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("release.yml");
    expect(result.output).toContain("NPM_CLI_VERSION");
    expect(result.output).toContain("discoverable only at run time");
  });

  it("REFUSES a publish path declaring an npm below the floor, naming both", () => {
    const root = fixture();
    edit(root, RELEASE_WORKFLOW, (text) =>
      text.replace(
        '          NPM_CLI_VERSION: "11.19.1"\n',
        '          NPM_CLI_VERSION: "11.5.0"\n',
      ),
    );
    const result = run(TOOLCHAIN_CHECK, ["--repo", root]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("11.5.0");
    expect(result.output).toContain("11.5.1");
  });

  it("REFUSES a range where an exact version was required, because a range resolves at run time", () => {
    const root = fixture();
    edit(root, RELEASE_WORKFLOW, (text) =>
      text.replace(
        '          NPM_CLI_VERSION: "11.19.1"\n',
        '          NPM_CLI_VERSION: "^11.5.1"\n',
      ),
    );
    const result = run(TOOLCHAIN_CHECK, ["--repo", root]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("not an exact version");
  });

  it("REFUSES a declared version nothing installs, because a decorative pin is not a floor", () => {
    const root = fixture();
    edit(root, RELEASE_WORKFLOW, (text) =>
      text.replace('          npm install --global "npm@$NPM_CLI_VERSION"\n', ""),
    );
    const result = run(TOOLCHAIN_CHECK, ["--repo", root]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("decoration");
  });

  it("accepts the floor itself, so the comparison is not off by one", () => {
    const root = fixture();
    for (const file of [RELEASE_WORKFLOW, CI_WORKFLOW]) {
      edit(root, file, (text) =>
        text.replaceAll('NPM_CLI_VERSION: "11.19.1"', 'NPM_CLI_VERSION: "11.5.1"'),
      );
    }
    expect(run(TOOLCHAIN_CHECK, ["--repo", root]).status).toBe(0);
  });

  it("separates a gate that could not read its input from one that read it and refused", () => {
    const root = fixture();
    writeFileSync(join(root, DECLARATION), "{ not json", "utf8");
    const result = run(TOOLCHAIN_CHECK, ["--repo", root]);
    expect(result.status).toBe(2);
    expect(result.output).toContain("THE COMPARISON COULD NOT BE MADE");
  });
});

describe("AC-5: the release dry run declares the publish path's toolchain", () => {
  it("REFUSES a dry run pinning a different npm, naming both", () => {
    const root = fixture();
    edit(root, CI_WORKFLOW, (text) =>
      text.replace(
        '          NPM_CLI_VERSION: "11.19.1"\n',
        '          NPM_CLI_VERSION: "11.18.0"\n',
      ),
    );
    const result = run(TOOLCHAIN_CHECK, ["--repo", root]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("11.18.0");
    expect(result.output).toContain("11.19.1");
    expect(result.output).toContain("not evidence about the real publish");
  });

  it("REFUSES a dry run that declares no npm at all", () => {
    const root = fixture();
    edit(root, CI_WORKFLOW, (text) => text.replace('          NPM_CLI_VERSION: "11.19.1"\n', ""));
    const result = run(TOOLCHAIN_CHECK, ["--repo", root]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("release-dry-run");
  });

  it("REFUSES a dry run on a different node, naming both", () => {
    const root = fixture();
    edit(root, CI_WORKFLOW, (text) =>
      text.replace(
        '      - uses: actions/setup-node@v6\n        with:\n          node-version: "22.14"\n          cache: pnpm\n      # THE SAME TOOLCHAIN',
        '      - uses: actions/setup-node@v6\n        with:\n          node-version: "24.0.0"\n          cache: pnpm\n      # THE SAME TOOLCHAIN',
      ),
    );
    const result = run(TOOLCHAIN_CHECK, ["--repo", root]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("24.0.0");
    expect(result.output).toContain("22.14");
  });
});

// ---------------------------------------------------------------------------------------------
// AC-8: a publish that cannot authenticate fails the run, is not retried under another credential,
// and cannot report success while a bumped package is absent from the registry.
// ---------------------------------------------------------------------------------------------

/**
 * Every way the publish job could fail to authenticate and still look green. Empty means it cannot.
 *
 * @param text The release workflow.
 * @returns One problem per rule broken.
 */
function gradeFailedPublishHandling(text: string): string[] {
  const problems: string[] = [];
  const publish = steps(parse(text), "publish");

  const publishers = publish.filter((step) => get(get(step, "with"), "publish") !== undefined);
  if (publishers.length !== 1) {
    problems.push(`the publish job has ${publishers.length} publishing steps, not exactly one`);
  }
  for (const step of publish) {
    if (get(step, "continue-on-error") !== undefined) {
      problems.push(
        `step "${scalar(get(step, "name")) ?? scalar(get(step, "uses"))}" carries continue-on-error, so its failure cannot fail the run`,
      );
    }
  }

  const accounting = publish.find(
    (step) =>
      scalar(get(step, "name")) === "Every bumped package must be published, tagged and released",
  );
  if (accounting === undefined) {
    problems.push("the publish job has no per-package registry accounting step");
    return problems;
  }
  const condition = scalar(get(accounting, "if")) ?? "";
  if (!condition.includes("!cancelled()")) {
    problems.push(
      `the accounting step runs on \`${condition}\`, so a failed publish skips it and the run reports what the publish said about itself`,
    );
  }
  const script = scalar(get(accounting, "run")) ?? "";
  if (!script.includes("npm view")) {
    problems.push("the accounting step does not ask the registry whether each package is there");
  }
  if (!/Bumped but never published/.test(script) || !/exit 1/.test(script)) {
    problems.push("the accounting step does not fail the run when a bumped package is missing");
  }
  return problems;
}

describe("AC-8: a publish that cannot authenticate fails the run and stays failed", () => {
  it("holds for the workflow as shipped", () => {
    expect(gradeFailedPublishHandling(RELEASE_TEXT)).toEqual([]);
  });

  it("has nothing to fall back to: the publish step carries no credential but the GitHub one", () => {
    const publish = steps(parse(RELEASE_TEXT), "publish");
    const publisher = publish.find((step) => get(get(step, "with"), "publish") !== undefined);
    const env = get(publisher, "env");
    expect(env?.kind).toBe("map");
    expect([...(env as { entries: Map<string, Node> }).entries.keys()]).toEqual([
      "GITHUB_TOKEN",
      "NPM_CONFIG_PROVENANCE",
    ]);
  });

  it("REFUSES a workflow whose accounting step is skipped when the publish fails", () => {
    const mutated = RELEASE_TEXT.replace(
      "        if: ${{ !cancelled() && steps.notes.outputs.is-release == 'true' }}\n",
      "        if: ${{ steps.changesets.outputs.published == 'true' }}\n",
    );
    expect(mutated).not.toBe(RELEASE_TEXT);
    expect(gradeFailedPublishHandling(mutated).join("\n")).toContain("skips it");
  });

  it("REFUSES a workflow whose accounting step stopped asking the registry", () => {
    const mutated = RELEASE_TEXT.replaceAll('npm view "${name}@${version}" version', "true");
    expect(mutated).not.toBe(RELEASE_TEXT);
    expect(gradeFailedPublishHandling(mutated).join("\n")).toContain("ask the registry");
  });

  it("REFUSES a workflow whose publish step was made advisory", () => {
    const mutated = RELEASE_TEXT.replace(
      "      - name: Publish\n        id: changesets\n",
      "      - name: Publish\n        id: changesets\n        continue-on-error: true\n",
    );
    expect(mutated).not.toBe(RELEASE_TEXT);
    expect(gradeFailedPublishHandling(mutated).join("\n")).toContain("continue-on-error");
  });

  it("keeps the other direction too: a publish the notes gate never saw still reds the run", () => {
    const publish = steps(parse(RELEASE_TEXT), "publish");
    const refusal = publish.find(
      (step) => scalar(get(step, "name")) === "Refuse a publish the notes gate never saw",
    );
    expect(refusal).toBeDefined();
    expect(scalar(get(refusal, "run"))).toContain("exit 1");
  });
});

// ---------------------------------------------------------------------------------------------
// AC-12: a registry credential reintroduced into any ONE of the workflow, the declaration or
// RELEASING.md, without the other two following it, is refused by name. Both directions.
// ---------------------------------------------------------------------------------------------

describe("AC-12: a credential cannot come back through one file alone", () => {
  it("passes over an untouched copy of all three (positive control)", () => {
    expect(run(SURFACE_CHECK, ["--repo", fixture()]).status).toBe(0);
  });

  it("REFUSES a token wired into the workflow that the declaration does not name", () => {
    const root = fixture();
    edit(root, RELEASE_WORKFLOW, (text) =>
      text.replace(
        "          GITHUB_TOKEN: ${{ secrets.RELEASE_PR_TOKEN || secrets.GITHUB_TOKEN }}\n",
        "          GITHUB_TOKEN: ${{ secrets.RELEASE_PR_TOKEN || secrets.GITHUB_TOKEN }}\n          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}\n",
      ),
    );
    const result = run(SURFACE_CHECK, ["--repo", root]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("undeclared-secret");
    expect(result.output).toContain("secrets.NPM_TOKEN");
  });

  it("REFUSES a registry credential declared while the workflow and the docs stay tokenless", () => {
    const root = fixture();
    const path = join(root, DECLARATION);
    const declaration = JSON.parse(readFileSync(path, "utf8")) as {
      credentials: Record<string, unknown>[];
    };
    declaration.credentials.unshift({
      name: "NPM_TOKEN",
      tokenClass: "npm Automation token with publish rights on the @cosyte scope, reintroduced.",
      storage: "organization",
      requiredForPublish: true,
      registryAuth: true,
      exposures: [
        { job: "publish", step: "Publish", as: "env", name: "NODE_AUTH_TOKEN", mode: "value" },
      ],
      issuedForms: [{ id: "npm-automation-token", pattern: "npm_[A-Za-z0-9]{36}" }],
      retiredWhen: "When the trusted publisher this repository already uses is trusted again.",
    });
    writeFileSync(path, `${JSON.stringify(declaration, null, 2)}\n`, "utf8");

    const result = run(SURFACE_CHECK, ["--repo", root]);
    expect(result.status).toBe(1);
    // The contradiction with the declared authentication method is reported first, and the two
    // files that did not follow are reported with it rather than one run at a time.
    expect(result.output).toContain("registry-credential-declared");
    expect(result.output).toContain("declared-credential-absent");
    expect(result.output).toContain("docs-credential-absent");
  });

  it("REFUSES a rotation procedure for a credential the declaration does not name", () => {
    const root = fixture();
    edit(root, DOCS, (text) =>
      text.replace(
        "### `RELEASE_PR_TOKEN`\n",
        [
          "### `NPM_TOKEN`\n",
          "",
          "- **Issue.** On npmjs.com, generate a granular access token for the @cosyte scope.",
          "- **Install.** `gh secret set NPM_TOKEN --org cosyte --visibility all`, exactly one place.",
          "- **Verify.** Run the release workflow and read the publish job's output carefully.",
          "- **Revoke.** On npmjs.com, revoke it after the replacement is installed and verified.",
          "- **Compensating action.** Revoke first if compromised, then audit every published version.",
          "",
          "### `RELEASE_PR_TOKEN`\n",
        ].join("\n"),
      ),
    );
    const result = run(SURFACE_CHECK, ["--repo", root]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("docs-undeclared-credential");
    expect(result.output).toContain("NPM_TOKEN");
  });

  it("REFUSES a publish job stripped of the grant its declared authentication rests on", () => {
    // The quietest way back: delete `id-token: write` from the job AND from the declaration's
    // permissions block in one commit. The permissions comparison agrees with itself and goes
    // green; the publish path has lost the only credential it has.
    const root = fixture();
    // Matched as the JOB-LEVEL grant (six spaces, inside a `permissions:` block) rather than by its
    // trailing comment, which is prose and may be reworded without changing what is granted.
    edit(root, RELEASE_WORKFLOW, (text) => text.replace(/^ {6}id-token: write.*\n/m, ""));
    const path = join(root, DECLARATION);
    const declaration = JSON.parse(readFileSync(path, "utf8")) as {
      credentials: { permissions?: { jobs?: Record<string, Record<string, string>> } }[];
    };
    for (const credential of declaration.credentials) {
      if (credential.permissions?.jobs?.publish === undefined) continue;
      delete credential.permissions.jobs.publish["id-token"];
    }
    writeFileSync(path, `${JSON.stringify(declaration, null, 2)}\n`, "utf8");

    const result = run(SURFACE_CHECK, ["--repo", root]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("authentication-permission-absent");
  });

  it("REFUSES a trusted publisher registered against a workflow filename that does not publish", () => {
    const root = fixture();
    const path = join(root, DECLARATION);
    const declaration = JSON.parse(readFileSync(path, "utf8")) as {
      publishPath: { authentication: { trustedPublisher: { workflow: string } } };
    };
    declaration.publishPath.authentication.trustedPublisher.workflow = "publish.yml";
    writeFileSync(path, `${JSON.stringify(declaration, null, 2)}\n`, "utf8");

    const result = run(SURFACE_CHECK, ["--repo", root]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("trusted-publisher-workflow-mismatch");
  });
});
