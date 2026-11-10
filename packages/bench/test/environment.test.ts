import { describe, expect, it } from "vitest";

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { environment, readCgroupCpuMax } from "../src/environment.js";
import { scratchDir } from "./support/paths.js";

describe("environment", () => {
  it("describes a machine off CI, with no name, user or path in it", () => {
    const e = environment({ NODE_OPTIONS: "" }, () => null);
    expect(e).toMatchObject({
      node: process.version,
      v8: process.versions.v8,
      platform: process.platform,
      arch: process.arch,
      cgroupCpuMax: null,
      nodeOptionsSet: false,
      runner: {
        ci: false,
        provider: null,
        environment: null,
        imageOS: null,
        imageVersion: null,
        class: `local-${process.platform}-${process.arch}`,
      },
    });
    expect(e.logicalCpus).toBeGreaterThan(0);
    expect(e.totalMemoryBytes).toBeGreaterThan(0);
    expect(JSON.stringify(e)).not.toContain(process.env["HOME"] ?? "no home");
  });

  it("describes a GitHub-hosted runner by its image", () => {
    const e = environment(
      {
        CI: "true",
        GITHUB_ACTIONS: "true",
        RUNNER_ENVIRONMENT: "github-hosted",
        ImageOS: "ubuntu24",
        ImageVersion: "20261101.1",
        NODE_OPTIONS: "--max-old-space-size=4096",
      },
      () => "200000 100000",
    );
    expect(e.runner).toEqual({
      ci: true,
      provider: "github-actions",
      environment: "github-hosted",
      imageOS: "ubuntu24",
      imageVersion: "20261101.1",
      class: `github-actions-github-hosted-ubuntu24-${process.arch}`,
    });
    expect(e.cgroupCpuMax).toBe("200000 100000");
    expect(e.nodeOptionsSet).toBe(true);
  });

  it("reads the first CPU's model, trimmed, or none when Node lists no CPU", () => {
    expect(
      environment(
        {},
        () => null,
        () => [{ model: " Synthetic CPU  " }],
      ).cpuModel,
    ).toBe("Synthetic CPU");
    expect(
      environment(
        {},
        () => null,
        () => [],
      ).cpuModel,
    ).toBeNull();
  });

  it("records the load averages, rounded", () => {
    expect(
      environment(
        {},
        () => null,
        () => [],
        () => [1.234, 0.5, 12.999],
      ).loadAverage,
    ).toEqual([1.23, 0.5, 13]);
    expect(environment({}).loadAverage).toHaveLength(3);
  });

  it("names what it cannot see as unknown", () => {
    expect(environment({ GITHUB_ACTIONS: "true" }, () => null).runner.class).toBe(
      `github-actions-unknown-unknown-${process.arch}`,
    );
  });

  it("reads a cgroup quota file, trimmed, or null where there is none", () => {
    const dir = scratchDir("bench-cgroup-");
    writeFileSync(join(dir, "cpu.max"), "200000 100000\n");
    expect(readCgroupCpuMax(join(dir, "cpu.max"))).toBe("200000 100000");
    expect(readCgroupCpuMax(join(dir, "absent"))).toBeNull();
  });

  it("says NODE_OPTIONS was not set when it is absent", () => {
    expect(environment({}, () => null).nodeOptionsSet).toBe(false);
  });

  it("reads the cgroup quota by default, or null where there is none", () => {
    const e = environment({});
    expect(e.cgroupCpuMax === null || typeof e.cgroupCpuMax === "string").toBe(true);
  });
});
