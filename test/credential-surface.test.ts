import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

// THE NEGATIVE CONTROLS FOR THE CREDENTIAL-SURFACE GATE.
//
// The declaration in `.github/credential-surface.json` is only worth what its refusals prove. A
// check that reported success on an empty declaration, on a workflow it could not parse, or on a
// credential that had quietly moved would be indistinguishable from no check at all, and it would be
// worse than none, because CI would be green and the surface would read as verified.
//
// So every case below MUTATES A REAL COPY of this repository's own declaration, workflow and
// release documentation, one defect at a time, and asserts the gate refuses that mutation by name.
// The positive control is the first suite: the repository as committed must PASS. Only the pair is
// evidence. A gate that refuses everything also passes every negative case here.
//
// Fixtures are copies rather than hand-written miniatures on purpose. A miniature workflow proves
// the checker can read a workflow someone wrote for the checker; a copy of `release.yml` proves it
// can read the file this gate actually guards, comment blocks, block scalars, `${{ }}` expressions
// and all. Each mutation asserts it changed something, so a stale replacement string cannot make a
// negative case pass by silently mutating nothing.
//
// Like `changeset-guard.test.ts` this drives the SHIPPED CLI rather than an exported function,
// because what ci.yml depends on is the process exit code.

const REPO = join(import.meta.dirname, "..");
const CHECK = join(REPO, "scripts", "credential-surface.mjs");
const DECLARATION = join(".github", "credential-surface.json");
const WORKFLOW = join(".github", "workflows", "release.yml");
const DOCS = "RELEASING.md";

const temporaryDirs: string[] = [];

afterEach(() => {
  while (temporaryDirs.length > 0) {
    const dir = temporaryDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

interface Run {
  status: number;
  stdout: string;
  stderr: string;
  output: string;
}

/**
 * Run the shipped CLI.
 *
 * @param args Arguments after the script name.
 * @returns Its exit status and both streams.
 */
function run(args: string[]): Run {
  const result = spawnSync(process.execPath, [CHECK, ...args], { encoding: "utf8" });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  return { status: result.status ?? -1, stdout, stderr, output: `${stdout}${stderr}` };
}

/**
 * Copy this repository's real declaration, release workflow and release documentation into a
 * throwaway directory.
 *
 * @returns The fixture root.
 */
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "credential-surface-"));
  temporaryDirs.push(root);
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });
  for (const relative of [DECLARATION, WORKFLOW, DOCS]) {
    copyFileSync(join(REPO, relative), join(root, relative));
  }
  return root;
}

/**
 * Rewrite one of the fixture's files, asserting the rewrite actually changed it.
 *
 * @param root The fixture root.
 * @param relative Which file.
 * @param edit Receives the current contents and returns the new contents.
 */
function edit(root: string, relative: string, edit_: (text: string) => string): void {
  const before = readFileSync(join(root, relative), "utf8");
  const after = edit_(before);
  expect(after, `the mutation of ${relative} changed nothing, so it would prove nothing`).not.toBe(
    before,
  );
  writeFileSync(join(root, relative), after, "utf8");
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

interface Exposure {
  job: string;
  step: string;
  as: string;
  name: string;
  mode?: string;
}

interface Credential {
  name: string;
  tokenClass: string;
  storage: string;
  requiredForPublish: boolean;
  registryAuth: boolean;
  exposures: Exposure[];
  issuedForms: { id: string; pattern: string }[];
  retiredWhen: string;
  permissions?: {
    workflow?: Record<string, string>;
    jobs?: Record<string, Record<string, string>>;
  };
}

interface Declaration {
  publishPath: { workflow: string; job: string; environment: string; command: string };
  logRedaction: { job: string; step: string };
  documentation: { file: string; section: string };
  credentials: Credential[];
  settings?: { name: string; value: string; exposures: Exposure[] }[];
}

/**
 * @returns This repository's committed declaration.
 */
function realDeclaration(): Declaration {
  return JSON.parse(readFileSync(join(REPO, DECLARATION), "utf8")) as Declaration;
}

describe("the committed surface is the declared surface (positive control)", () => {
  it("passes against this repository as committed", () => {
    const result = run(["--repo", REPO]);
    expect(result.output).toContain("agrees with");
    expect(result.status).toBe(0);
  });

  it("passes against an untouched copy of it", () => {
    expect(run(["--repo", fixture()]).status).toBe(0);
  });

  // AC1. The declaration is the single machine-readable statement of the surface, and every
  // credential on it carries the four properties an operator and this gate both need.
  it("names, for every credential, its token class, its one storage location, the job and step permitted to receive it, and what retires it", () => {
    const declaration = realDeclaration();
    expect(declaration.credentials.length).toBeGreaterThan(0);
    for (const credential of declaration.credentials) {
      expect(credential.name, "every credential is named").toMatch(/^[A-Z][A-Z0-9_]*$/);
      expect(credential.tokenClass.length, `${credential.name} token class`).toBeGreaterThan(20);
      expect(
        ["organization", "repository", "environment", "github-provided"],
        `${credential.name} storage`,
      ).toContain(credential.storage);
      expect(credential.retiredWhen.length, `${credential.name} retirement`).toBeGreaterThan(20);
      expect(credential.exposures.length, `${credential.name} exposures`).toBeGreaterThan(0);
      for (const exposure of credential.exposures) {
        expect(exposure.job, `${credential.name} exposure job`).toBeTruthy();
        expect(exposure.step, `${credential.name} exposure step`).toBeTruthy();
      }
    }
  });

  // AC12's other half. The grade route is ci.yml itself; this keeps the wiring from being deleted
  // without a red test, which is the failure mode a file-graded criterion cannot cover on its own.
  it("is wired into the pull-request verify path, not only into the release path", () => {
    const ci = readFileSync(join(REPO, ".github", "workflows", "ci.yml"), "utf8");
    expect(ci).toContain("pull_request:");
    expect(ci).toContain("node scripts/credential-surface.mjs");
    const verify = ci.slice(ci.indexOf("  verify:"), ci.indexOf("  actionlint:"));
    expect(verify).toContain("node scripts/credential-surface.mjs");
  });
});

describe("a secret the declaration does not name (AC2)", () => {
  it("fails, and reports both the secret and where it was found", () => {
    const root = fixture();
    edit(root, WORKFLOW, (text) =>
      text.replace(
        "          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}\n",
        "          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}\n          SMUGGLED: ${{ secrets.LEGACY_DEPLOY_KEY }}\n",
      ),
    );
    const result = run(["--repo", root]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("undeclared-secret");
    expect(result.output).toContain("secrets.LEGACY_DEPLOY_KEY");
    expect(result.output).toContain('step "Publish" of job "publish"');
  });

  it("fails when the undeclared secret is added at workflow level rather than in a step", () => {
    const root = fixture();
    edit(root, WORKFLOW, (text) =>
      text.replace("jobs:\n", "env:\n  SMUGGLED: ${{ secrets.LEGACY_DEPLOY_KEY }}\njobs:\n"),
    );
    const result = run(["--repo", root]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("undeclared-secret");
    expect(result.output).toContain("workflow-level");
  });

  it("does not mistake the workflow's prose for wiring", () => {
    // release.yml's header comments name NPM_TOKEN, NODE_AUTH_TOKEN and RELEASE_PR_TOKEN in
    // ordinary English several times. A gate that grepped would report every one of those.
    const workflow = readFileSync(join(REPO, WORKFLOW), "utf8");
    expect(workflow).toContain("# register the npm-side Trusted Publisher, then remove NPM_TOKEN");
    const root = fixture();
    edit(root, WORKFLOW, (text) =>
      text.replace(
        "jobs:\n",
        "# A comment that mentions secrets.TOTALLY_INVENTED_TOKEN in passing.\njobs:\n",
      ),
    );
    expect(run(["--repo", root]).status).toBe(0);
  });
});

describe("a declared credential that is no longer where it says (AC3)", () => {
  it("fails and names the credential rather than passing because nothing extra was found", () => {
    const root = fixture();
    edit(root, WORKFLOW, (text) =>
      text.replace("          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}\n", ""),
    );
    const result = run(["--repo", root]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("declared-exposure-absent");
    expect(result.output).toContain("NPM_TOKEN");
    expect(result.output).toContain("NODE_AUTH_TOKEN");
    expect(result.output).not.toContain("undeclared-secret");
  });

  it("reports the whole credential when every one of its declared locations is gone", () => {
    const root = fixture();
    // `replaceAll`, not `replace`, and the difference is load-bearing rather than stylistic. This
    // case is about the credential being gone EVERYWHERE, so the mutation has to remove every
    // reference; a single-occurrence replace leaves one behind the moment a second step legitimately
    // consumes the token, and the checker then correctly reports per-exposure findings instead of
    // the whole-credential one. S0081 added exactly such a step (the configuration allow-check, which
    // must resolve the same npmrc the publish resolves and therefore needs the same NODE_AUTH_TOKEN),
    // and that is what turned this into a fixture bug rather than a checker bug. The assertion below
    // is unchanged: the refusal this case exists for is intact.
    edit(root, WORKFLOW, (text) =>
      text
        .replaceAll("          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}\n", "")
        .replaceAll("          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}\n", ""),
    );
    const result = run(["--repo", root]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("declared-credential-absent");
    expect(result.output).toContain("NPM_TOKEN");
  });

  it("reports a declared step that no longer exists in the workflow", () => {
    const root = fixture();
    editDeclaration(root, (declaration) => {
      const npm = declaration.credentials.find((entry) => entry.name === "NPM_TOKEN");
      npm!.exposures[0].step = "A step nobody wrote";
    });
    const result = run(["--repo", root]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("declared-exposure-absent");
    expect(result.output).toContain('has no step named "A step nobody wrote"');
  });
});

describe("a credential exposed more broadly than declared (AC4)", () => {
  it("fails when a step-scoped token is hoisted to job level, reporting both scopes", () => {
    const root = fixture();
    edit(root, WORKFLOW, (text) =>
      text.replace(
        "    environment: release\n    steps:\n",
        "    environment: release\n    env:\n      NPM_TOKEN: ${{ secrets.NPM_TOKEN }}\n    steps:\n",
      ),
    );
    const result = run(["--repo", root]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("scope-widened");
    expect(result.output).toContain('job-level `env` in job "publish"');
    expect(result.output).toContain('the declaration permits only step "Publish"');
  });

  it("fails when a step-scoped token is hoisted to workflow level", () => {
    const root = fixture();
    edit(root, WORKFLOW, (text) =>
      text.replace("jobs:\n", "env:\n  NPM_TOKEN: ${{ secrets.NPM_TOKEN }}\njobs:\n"),
    );
    const result = run(["--repo", root]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("scope-widened");
    expect(result.output).toContain("workflow-level");
  });

  it("fails when a token appears in a job the declaration never named", () => {
    const root = fixture();
    edit(root, WORKFLOW, (text) =>
      text.replace(
        "      - name: Changesets must be able to bump something\n",
        "      - name: Changesets must be able to bump something\n        env:\n          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}\n",
      ),
    );
    const result = run(["--repo", root]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("scope-widened");
    expect(result.output).toContain('job "preflight"');
  });

  it("fails when a declared presence test starts passing the value instead", () => {
    const root = fixture();
    edit(root, WORKFLOW, (text) =>
      text.replace(
        "          HAS_RELEASE_PR_TOKEN: ${{ secrets.RELEASE_PR_TOKEN != '' }}\n",
        "          HAS_RELEASE_PR_TOKEN: ${{ secrets.RELEASE_PR_TOKEN }}\n",
      ),
    );
    const result = run(["--repo", root]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("presence-test-became-a-value");
    expect(result.output).toContain("RELEASE_PR_TOKEN");
  });

  it("fails when a GITHUB_TOKEN permission grant is widened beyond the declaration", () => {
    const root = fixture();
    edit(root, WORKFLOW, (text) =>
      text.replace(
        "  preflight:\n    runs-on: ubuntu-latest\n    permissions:\n      contents: read\n",
        "  preflight:\n    runs-on: ubuntu-latest\n    permissions:\n      contents: write\n",
      ),
    );
    const result = run(["--repo", root]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("permissions-widened");
    expect(result.output).toContain('job "preflight"');
  });

  it("fails when a job carries no permissions block and would inherit the workflow-level grants", () => {
    const root = fixture();
    edit(root, WORKFLOW, (text) => text.replace("    permissions:\n      contents: read\n", ""));
    const result = run(["--repo", root]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("job-inherits-workflow-permissions");
    expect(result.output).toContain('job "preflight"');
  });

  it("fails when a new job is added that the declaration says nothing about", () => {
    const root = fixture();
    edit(root, WORKFLOW, (text) =>
      text.replace(
        "  version:\n    needs: preflight\n",
        "  smuggle:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hello\n\n  version:\n    needs: preflight\n",
      ),
    );
    const result = run(["--repo", root]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("job-permissions-undeclared");
    expect(result.output).toContain('job "smuggle"');
  });

  it("fails when the publish-path provenance switch is quietly removed", () => {
    const root = fixture();
    edit(root, WORKFLOW, (text) =>
      text.replace(
        "          NPM_CONFIG_PROVENANCE: ${{ github.event.repository.visibility == 'public' }}\n",
        "",
      ),
    );
    const result = run(["--repo", root]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("declared-setting-absent");
    expect(result.output).toContain("NPM_CONFIG_PROVENANCE");
  });
});

describe("the registry-reaching job and its protected environment (AC5)", () => {
  it("fails when the publish job stops declaring the deployment environment", () => {
    const root = fixture();
    edit(root, WORKFLOW, (text) => text.replace("    environment: release\n", ""));
    const result = run(["--repo", root]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("environment-missing");
    expect(result.output).toContain('job "publish"');
  });

  it("fails when the publish job is pointed at a different environment", () => {
    const root = fixture();
    edit(root, WORKFLOW, (text) =>
      text.replace("    environment: release\n", "    environment: staging\n"),
    );
    const result = run(["--repo", root]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("environment-changed");
    expect(result.output).toContain("staging");
  });

  it("fails when a registry credential turns up in an ungated job", () => {
    const root = fixture();
    edit(root, WORKFLOW, (text) =>
      text.replace(
        "      - name: Report whether a version PR would be able to run its checks\n        env:\n",
        "      - name: Report whether a version PR would be able to run its checks\n        env:\n          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}\n",
      ),
    );
    const result = run(["--repo", root]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("environment-missing");
    expect(result.output).toContain('job "version"');
  });
});

describe("nothing to compare is a failure, not a pass (AC6)", () => {
  it("fails when the declaration is absent", () => {
    const root = fixture();
    rmSync(join(root, DECLARATION));
    const result = run(["--repo", root]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("declaration-absent");
    expect(result.output).toContain("Refusing to report success on having compared nothing");
    expect(result.stdout).not.toContain("agrees with");
  });

  it("fails when the declaration is an empty file", () => {
    const root = fixture();
    writeFileSync(join(root, DECLARATION), "   \n", "utf8");
    const result = run(["--repo", root]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("declaration-empty");
  });

  it("fails when the declaration names no credentials at all", () => {
    const root = fixture();
    editDeclaration(root, (declaration) => {
      declaration.credentials = [];
    });
    const result = run(["--repo", root]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("declaration-empty");
  });

  it("fails when the declaration is not valid JSON", () => {
    const root = fixture();
    writeFileSync(join(root, DECLARATION), '{ "publishPath": ', "utf8");
    const result = run(["--repo", root]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("declaration-unparseable");
  });

  it("fails when the declaration parses but omits the fields the comparison needs", () => {
    const root = fixture();
    editDeclaration(root, (declaration) => {
      delete (declaration.credentials[0] as Partial<Credential>).retiredWhen;
    });
    const result = run(["--repo", root]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("declaration-invalid");
    expect(result.output).toContain("retiredWhen");
  });

  it("fails when the workflow the declaration describes cannot be read", () => {
    const root = fixture();
    rmSync(join(root, WORKFLOW));
    const result = run(["--repo", root]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("workflow-absent");
    expect(result.output).toContain("Refusing to report success on having compared nothing");
  });

  it("fails when the workflow cannot be parsed rather than guessing at its structure", () => {
    const root = fixture();
    writeFileSync(
      join(root, WORKFLOW),
      "name: Release\njobs:\n\tpublish:\n\t\truns-on: x\n",
      "utf8",
    );
    const result = run(["--repo", root]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("workflow-unparseable");
  });

  it("separates a bad invocation from a drifted surface", () => {
    const result = run(["--repo", REPO, "--nonsense"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("could not run");
  });
});

describe("log scrubbing must cover every declared issued form (AC7)", () => {
  it("fails when a declared credential's issued form has no redaction rule", () => {
    const root = fixture();
    editDeclaration(root, (declaration) => {
      declaration.credentials[0].issuedForms.push({
        id: "hypothetical-deploy-key",
        pattern: "dpl_[A-Za-z0-9]{40}",
      });
    });
    const result = run(["--repo", root]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("redaction-rule-missing");
    expect(result.output).toContain("dpl_[A-Za-z0-9]{40}");
  });

  it("fails when a form is redacted but the post-redaction assertion stops looking for it", () => {
    const root = fixture();
    edit(root, WORKFLOW, (text) =>
      text.replace("if grep -rqiE 'npm_[A-Za-z0-9]{36}|", "if grep -rqiE 'placeholder_no_match|"),
    );
    const result = run(["--repo", root]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("redaction-assertion-incomplete");
    expect(result.output).toContain("npm_[A-Za-z0-9]{36}");
  });

  it("fails when the scrubbing rule itself is dropped", () => {
    const root = fixture();
    edit(root, WORKFLOW, (text) =>
      text.replace("              -e 's/npm_[A-Za-z0-9]{36}/npm_REDACTED/g' \\\n", ""),
    );
    const result = run(["--repo", root]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("redaction-rule-missing");
  });

  it("fails when the redaction step stops asserting on the bytes it would upload", () => {
    const root = fixture();
    editDeclaration(root, (declaration) => {
      declaration.logRedaction.step = "Derive the release bodies";
    });
    const result = run(["--repo", root]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("redaction-assertion-absent");
  });
});

describe("every declared credential owes an operator a procedure (AC9)", () => {
  it("fails when a declared credential has no documented procedure at all", () => {
    const root = fixture();
    edit(root, DOCS, (text) =>
      text.replace("### `RELEASE_PR_TOKEN`", "### A heading about nothing in particular"),
    );
    const result = run(["--repo", root]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("docs-credential-absent");
    expect(result.output).toContain("RELEASE_PR_TOKEN");
  });

  it.each(["Issue", "Install", "Verify", "Revoke"])(
    "fails when a procedure omits its %s step",
    (label) => {
      const root = fixture();
      edit(root, DOCS, (text) => {
        const section = text.indexOf("### `GITHUB_TOKEN`");
        const marker = `**${label}.**`;
        const at = text.indexOf(marker, section);
        expect(at, `${label} must appear under GITHUB_TOKEN to be removable`).toBeGreaterThan(-1);
        return `${text.slice(0, at)}**Not the ${label} step.**${text.slice(at + marker.length)}`;
      });
      const result = run(["--repo", root]);
      expect(result.status).toBe(1);
      expect(result.output).toContain("docs-procedure-incomplete");
      expect(result.output).toContain(label);
    },
  );

  it("fails when a procedure step is a stub rather than a procedure", () => {
    const root = fixture();
    edit(root, DOCS, (text) => {
      const section = text.indexOf("### `GITHUB_TOKEN`");
      const at = text.indexOf("- **Verify.**", section);
      const end = text.indexOf("\n- **Revoke.**", at);
      return `${text.slice(0, at)}- **Verify.** TBD.${text.slice(end)}`;
    });
    const result = run(["--repo", root]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("docs-procedure-incomplete");
    expect(result.output).toContain("stub");
  });

  it("fails when the documentation file is gone entirely", () => {
    const root = fixture();
    rmSync(join(root, DOCS));
    const result = run(["--repo", root]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("docs-unreadable");
  });

  it("fails when the section the declaration points at is renamed out from under it", () => {
    const root = fixture();
    edit(root, DOCS, (text) =>
      text.replace(
        "## Credential rotation, revocation, and compensating actions",
        "## Some other heading",
      ),
    );
    const result = run(["--repo", root]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("docs-section-absent");
  });
});

describe("the no-rollback and registry-permanence statements (AC10)", () => {
  it("states both, for real, in the committed documentation", () => {
    const docs = readFileSync(join(REPO, DOCS), "utf8");
    expect(docs).toContain("**No automated rollback.**");
    expect(docs).toContain("**A published version is permanent.**");
    // Compared against the unwrapped text: the statement is prose and prettier keeps its line
    // breaks, so asserting on the raw bytes would grade the wrapping rather than the claim.
    const unwrapped = docs.replace(/\s+/g, " ");
    expect(unwrapped).toContain("is not undone by revoking the credential that published it");
    expect(unwrapped).toContain("There is no automated rollback for a credential change");
    for (const credential of realDeclaration().credentials) {
      const at = docs.indexOf(`### \`${credential.name}\``);
      expect(at, `${credential.name} needs its own subsection`).toBeGreaterThan(-1);
      const next = docs.indexOf("\n## ", at);
      const section = docs.slice(at, next < 0 ? undefined : next);
      expect(section, `${credential.name} compensating action`).toContain(
        "**Compensating action.**",
      );
    }
  });

  it("fails when the no-rollback statement is removed", () => {
    const root = fixture();
    edit(root, DOCS, (text) => text.replace("**No automated rollback.**", "Some other sentence."));
    const result = run(["--repo", root]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("docs-missing-no-rollback");
  });

  it("fails when the registry-permanence statement is removed", () => {
    const root = fixture();
    edit(root, DOCS, (text) =>
      text.replace("**A published version is permanent.**", "Some other sentence."),
    );
    const result = run(["--repo", root]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("docs-missing-registry-permanence");
  });

  it("fails when a declared credential has no compensating action recorded", () => {
    const root = fixture();
    edit(root, DOCS, (text) => {
      const section = text.indexOf("### `NPM_TOKEN`");
      const at = text.indexOf("- **Compensating action.**", section);
      expect(at).toBeGreaterThan(-1);
      return `${text.slice(0, at)}- **Something else.**${text.slice(at + "- **Compensating action.**".length)}`;
    });
    const result = run(["--repo", root]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("docs-procedure-incomplete");
    expect(result.output).toContain("Compensating action");
  });
});

describe("one run reports every disagreement (AC11)", () => {
  it("does not stop at the first, so one fix cycle can close the whole set", () => {
    const root = fixture();
    edit(root, WORKFLOW, (text) =>
      text
        // 1: an undeclared secret.
        .replace(
          "          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}\n",
          "          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}\n          SMUGGLED: ${{ secrets.LEGACY_DEPLOY_KEY }}\n",
        )
        // 2: a declared exposure that is gone.
        .replace("          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}\n", "")
        // 3: the protected environment removed.
        .replace("    environment: release\n", "")
        // 4: a permission grant widened.
        .replace(
          "  preflight:\n    runs-on: ubuntu-latest\n    permissions:\n      contents: read\n",
          "  preflight:\n    runs-on: ubuntu-latest\n    permissions:\n      contents: write\n",
        ),
    );
    edit(root, DOCS, (text) => text.replace("**No automated rollback.**", "Some other sentence."));
    const result = run(["--repo", root]);
    expect(result.status).toBe(1);
    for (const code of [
      "undeclared-secret",
      "declared-exposure-absent",
      "environment-missing",
      "permissions-widened",
      "docs-missing-no-rollback",
    ]) {
      expect(result.output, `every disagreement is reported, including ${code}`).toContain(code);
    }
    expect(result.output).toMatch(/[5-9]\d* disagreement\(s\)/);
  });
});
