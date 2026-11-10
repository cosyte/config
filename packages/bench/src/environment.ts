/**
 * The machine a measurement was taken on. Every results document carries it, because a number
 * means nothing apart from its machine: ADR 0001 measured a significant shift from a runner image
 * update with no code change.
 *
 * Nothing here names a person: no host name, no user, no absolute path.
 *
 * @packageDocumentation
 */

import { readFileSync } from "node:fs";
import { availableParallelism, cpus, loadavg, release, totalmem } from "node:os";

/** Where a measurement ran. */
export interface Environment {
  readonly node: string;
  readonly v8: string;
  readonly platform: string;
  readonly arch: string;
  readonly osRelease: string;
  readonly cpuModel: string | null;
  readonly logicalCpus: number;
  readonly totalMemoryBytes: number;
  /** The cgroup CPU quota (`cpu.max`), when Linux reports one: a throttled container measures differently. */
  readonly cgroupCpuMax: string | null;
  /** Whether `NODE_OPTIONS` was set. Its value is not recorded; it can hold paths. */
  readonly nodeOptionsSet: boolean;
  /**
   * The 1, 5 and 15 minute load averages when the document was written (zeros where the platform
   * has none). A busy machine is a noisy one: this is how a reader tells.
   */
  readonly loadAverage: readonly number[];
  readonly runner: Runner;
}

/** The CI runner, when there is one. */
export interface Runner {
  readonly ci: boolean;
  /** `github-actions`, or `null` off CI. */
  readonly provider: string | null;
  /** `github-hosted` or `self-hosted` (`RUNNER_ENVIRONMENT`). */
  readonly environment: string | null;
  /** The runner image (`ImageOS`) and its version (`ImageVersion`). */
  readonly imageOS: string | null;
  readonly imageVersion: string | null;
  /**
   * A key for "the same kind of machine": the provider, image and architecture on CI, or
   * `local-<platform>-<arch>` off it. Results are only compared within one class.
   */
  readonly class: string;
}

/**
 * The cgroup CPU quota, or `null` where the file is absent (not Linux, or no cgroup v2 limit).
 *
 * @internal
 */
// Stryker disable next-line StringLiteral: the default path is the machine's own file, present or not depending on the machine; tests pass a path.
export function readCgroupCpuMax(path = "/sys/fs/cgroup/cpu.max"): string | null {
  try {
    return String(readFileSync(path)).trim();
  } catch {
    return null;
  }
}

/**
 * Describe this machine and, from `env`, the CI runner.
 *
 * @internal
 */
export function environment(
  env: NodeJS.ProcessEnv = process.env,
  cgroupCpuMax: () => string | null = () => readCgroupCpuMax(),
  cpuList: () => readonly { readonly model: string }[] = cpus,
  load: () => readonly number[] = loadavg,
): Environment {
  const cpu = cpuList()[0];
  const provider = env["GITHUB_ACTIONS"] === "true" ? "github-actions" : null;
  const imageOS = env["ImageOS"] ?? null;
  const runnerClass =
    provider === null
      ? `local-${process.platform}-${process.arch}`
      : `${provider}-${env["RUNNER_ENVIRONMENT"] ?? "unknown"}-${imageOS ?? "unknown"}-${process.arch}`;
  return {
    node: process.version,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
    osRelease: release(),
    cpuModel: cpu === undefined ? null : cpu.model.trim(),
    logicalCpus: availableParallelism(),
    totalMemoryBytes: totalmem(),
    cgroupCpuMax: cgroupCpuMax(),
    nodeOptionsSet: (env["NODE_OPTIONS"] ?? "") !== "",
    loadAverage: load().map((x) => Math.round(x * 100) / 100),
    runner: {
      ci: env["CI"] === "true",
      provider,
      environment: env["RUNNER_ENVIRONMENT"] ?? null,
      imageOS,
      imageVersion: env["ImageVersion"] ?? null,
      class: runnerClass,
    },
  };
}
