import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  cleanupTempDirs,
  DECOY_VITEST_EXIT,
  DECOY_VITEST_MARKER,
  ensureBuilt,
  type OwnVitestFixture,
  PKG_ROOT,
  runCli,
  useFixtureWithOwnVitest,
} from "./helpers.js";
import { resolveToolBin } from "../src/resolve.js";

/**
 * Term 5 under Amendment 1: the consumer may declare its own vitest, and it changes nothing.
 *
 * `cosyte-process test` resolves vitest inside @cosyte/process's own installation (src/resolve.ts
 * walks node_modules upward from `import.meta.dirname`) and spawns that bin file with the current
 * node executable (src/run.ts). It never looks a bare `vitest` up on PATH or in the consumer's
 * `node_modules/.bin`. That distinction is what keeps term 5's two promises true once a consumer is
 * allowed its own vitest: a tool upgrade still reaches consumers through the @cosyte/process version
 * bump alone, and `@vitest/coverage-v8` - which a consumer never declares - still resolves.
 *
 * The fixture makes the other reading impossible to pass by accident: the consumer's vitest is a
 * decoy that announces itself and exits 97.
 */

beforeAll(ensureBuilt);
afterAll(cleanupTempDirs);

/** The environment with the consumer's own `node_modules/.bin` ahead of everything else on PATH. */
function pathFirst(fixture: OwnVitestFixture): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith("VITEST") && key !== "TEST") {
      env[key] = value;
    }
  }
  env["PATH"] = `${dirname(fixture.consumerBin)}${delimiter}${env["PATH"] ?? ""}`;
  return env;
}

describe("a consumer that declares its own vitest on the same major line", () => {
  it("is set up as term 5's Amendment 1 describes: same major, different patch, no coverage provider", () => {
    const fixture = useFixtureWithOwnVitest();
    const [providerMajor] = fixture.providerVersion.split(".");
    const [consumerMajor] = fixture.consumerVersion.split(".");

    expect(consumerMajor).toBe(providerMajor);
    expect(fixture.consumerVersion).not.toBe(fixture.providerVersion);

    // It is DECLARED, not just present: this is a consumer that ran `pnpm add -D vitest`.
    const manifest = JSON.parse(readFileSync(join(fixture.dir, "package.json"), "utf8")) as {
      devDependencies: Record<string, string>;
    };
    expect(manifest.devDependencies["vitest"]).toBe(fixture.consumerVersion);
    // Declaring it leaves the wiring conforming (term 6), so this is a consumer in good standing.
    expect(runCli(["check"], fixture.dir).code).toBe(0);

    // The consumer's copy is where an install puts it, bin shim included.
    expect(existsSync(join(fixture.dir, "node_modules", "vitest", "package.json"))).toBe(true);
    expect(existsSync(fixture.consumerBin)).toBe(true);
    // And @vitest/coverage-v8 is nowhere in the consumer's tree: term 5 keeps it provider-only.
    expect(existsSync(join(fixture.dir, "node_modules", "@vitest"))).toBe(false);
  });

  it("is a fixture where a bare `vitest` lookup really does find the consumer's copy", () => {
    const fixture = useFixtureWithOwnVitest();
    // The control for everything below: this is Reading B, run by hand. A bare command name with the
    // consumer's node_modules/.bin first on PATH - which is what `pnpm run` hands a script - selects
    // the consumer's vitest, and here that is the decoy, which says so and exits 97.
    const bare = spawnSync("vitest", ["run", "--coverage"], {
      cwd: fixture.dir,
      encoding: "utf8",
      env: pathFirst(fixture),
    });
    expect(bare.error).toBeUndefined();
    expect(bare.status).toBe(DECOY_VITEST_EXIT);
    expect(`${bare.stdout}${bare.stderr}`).toContain(DECOY_VITEST_MARKER);
  });

  it("runs THIS package's vitest and resolves @vitest/coverage-v8 from THIS package's tree", () => {
    const fixture = useFixtureWithOwnVitest();
    const result = runCli(["test", "--coverage"], fixture.dir);
    const output = `${result.stdout}${result.stderr}`;

    expect(result.code, output).toBe(0);
    // (a) the provider's vitest ran: its banner carries the provider's version, and the decoy - the
    // only other vitest in reach - never printed.
    expect(output).toContain(`v${fixture.providerVersion}`);
    expect(output).not.toContain(fixture.consumerVersion);
    expect(output).not.toContain(DECOY_VITEST_MARKER);
    expect(output).toContain("1 passed");
    // (b) the coverage provider resolved, from the only tree that has it: this package's own. It did
    // not merely load - it instrumented the consumer's source, which is what a written report proves.
    expect(output).toContain("Coverage enabled with v8");
    expect(output).toContain("Coverage report from v8");
    const report = join(fixture.dir, "coverage", "coverage-final.json");
    expect(existsSync(report), `no coverage report at ${report}`).toBe(true);
    expect(readFileSync(report, "utf8")).toContain(join("src", "index.ts"));
  });

  it("still does so with the consumer's node_modules/.bin first on PATH, as `pnpm run` leaves it", () => {
    const fixture = useFixtureWithOwnVitest();
    const result = runCli(["test", "--coverage"], fixture.dir, {
      PATH: pathFirst(fixture)["PATH"] ?? "",
    });
    const output = `${result.stdout}${result.stderr}`;

    // Same PATH the control above proved reaches the decoy, and the decoy still never runs.
    expect(result.code, output).toBe(0);
    expect(output).toContain(`v${fixture.providerVersion}`);
    expect(output).not.toContain(DECOY_VITEST_MARKER);
    expect(output).toContain("Coverage report from v8");
  });

  it("resolves the vitest bin from inside this package, not from the consumer directory", () => {
    const fixture = useFixtureWithOwnVitest();
    const bin = resolveToolBin("vitest");

    // Rooted in this package's own install (that is what src/resolve.ts's default `from` does)...
    expect(bin.startsWith(join(PKG_ROOT, "node_modules", "vitest"))).toBe(true);
    // ...and nowhere near the consumer, whose own copy is a different file entirely.
    expect(bin.startsWith(fixture.dir)).toBe(false);
    expect(bin).not.toBe(join(fixture.dir, "node_modules", "vitest", "vitest.mjs"));
  });
});
