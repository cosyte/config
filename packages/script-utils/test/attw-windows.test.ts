/**
 * THE attw GATE ON WINDOWS, and the two helpers that make it start there.
 *
 * On Windows a package manager writes three files into `node_modules/.bin` for one binary: `attw`
 * (a POSIX shell script), `attw.cmd` and `attw.ps1`. The gate used to check the extensionless one,
 * find it, and start it without a shell, which Windows cannot do: it failed with ENOENT. npm and
 * pnpm are `.cmd` files there too, and Node will not start a `.cmd` file without a shell at all.
 *
 * The live case below builds a consuming package the way a Windows install leaves one (both the
 * shell script and the `.cmd` file, the real attw CLI behind them) in a directory whose path has a
 * space in it, and runs the `cosyte-attw` command over it. It runs on every system: CI's `windows`
 * job runs this file on `windows-latest`, which is the proof that the gate starts there.
 *
 * SECURITY: every subprocess call here uses spawnSync with array arguments and no shell. Fixtures
 * are throwaway packages in a temporary directory.
 */

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { attwBinaryPath, runAttwGate, toolCommand } from "../attw.js";

const PACKAGE_DIR = join(import.meta.dirname, "..");
const TEST_UTILS = join(PACKAGE_DIR, "..", "test-utils");

describe("attwBinaryPath", () => {
  const caller = pathToFileURL(join(PACKAGE_DIR, "fixture", "scripts", "attw.mjs")).href;
  const bin = join(PACKAGE_DIR, "fixture", "node_modules", ".bin");

  it("is the extensionless binary off Windows", () => {
    expect(attwBinaryPath(caller, "linux")).toBe(join(bin, "attw"));
    expect(attwBinaryPath(caller, "darwin")).toBe(join(bin, "attw"));
  });

  it("is the .cmd file on Windows, the one Windows can start", () => {
    expect(attwBinaryPath(caller, "win32")).toBe(join(bin, "attw.cmd"));
  });

  it("follows this process's own platform when none is given", () => {
    expect(attwBinaryPath(caller)).toBe(attwBinaryPath(caller, process.platform));
  });
});

describe("toolCommand", () => {
  it("starts the file with its arguments and no shell off Windows", () => {
    expect(toolCommand("/a b/attw", ["--pack", "."], "linux")).toEqual({
      file: "/a b/attw",
      args: ["--pack", "."],
      shell: false,
    });
  });

  it("hands cmd.exe one line on Windows, every part but a bare name in double quotes", () => {
    expect(
      toolCommand(
        "C:\\a b\\node_modules\\.bin\\attw.cmd",
        ["--pack", ".", "--format", "json"],
        "win32",
      ),
    ).toEqual({
      file: '"C:\\a b\\node_modules\\.bin\\attw.cmd" "--pack" "." "--format" "json"',
      args: [],
      shell: true,
    });
    expect(toolCommand("npm", ["pack", "--dry-run", "--json"], "win32")).toEqual({
      file: 'npm "pack" "--dry-run" "--json"',
      args: [],
      shell: true,
    });
  });

  it("takes cmd.exe's other special characters literally inside the quotes", () => {
    expect(toolCommand("pnpm", ["C:\\x&y|z<w>v^u (1)"], "win32").file).toBe(
      'pnpm "C:\\x&y|z<w>v^u (1)"',
    );
  });

  it("throws on Windows for a quote, a percent sign or a line break, rather than escaping it", () => {
    for (const bad of ['a"b', "%PATH%", "a\nb", "a\rb"]) {
      expect(() => toolCommand("attw.cmd", ["--profile", bad], "win32")).toThrow(/cmd\.exe/);
      expect(() => toolCommand(bad, [], "win32")).toThrow(/cmd\.exe/);
    }
  });

  it("leaves those characters alone off Windows, where no shell reads them", () => {
    expect(toolCommand("attw", ['a"b%c'], "linux").args).toEqual(['a"b%c']);
  });

  it("follows this process's own platform when none is given", () => {
    expect(toolCommand("npm", ["pack"])).toEqual(toolCommand("npm", ["pack"], process.platform));
  });
});

// ---------------------------------------------------------------------------
// The live case: the real attw CLI, behind the files a Windows install writes.
// ---------------------------------------------------------------------------

let root: string;
let consumer: string;

beforeAll(() => {
  // A SPACE IN THE PATH, on purpose: on Windows the gate quotes every part of the command line it
  // hands cmd.exe, and an unquoted path with a space in it would start the wrong program.
  root = mkdtempSync(join(tmpdir(), "attw windows "));
  consumer = join(root, "consumer");
  mkdirSync(consumer, { recursive: true });
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify(
      {
        name: "attw-windows-fixture",
        version: "1.0.0",
        main: "./index.js",
        types: "./index.d.ts",
        files: ["index.js", "index.d.ts"],
        // A `publishConfig` object turns on the net that runs `pnpm pack`, so all three tools start.
        publishConfig: { access: "public" },
      },
      null,
      2,
    ),
  );
  writeFileSync(join(consumer, "index.js"), "module.exports.a = 1;\n");
  writeFileSync(join(consumer, "index.d.ts"), "export declare const a: number;\n");

  const installed = join(consumer, "node_modules", "@cosyte", "script-utils");
  cpSync(PACKAGE_DIR, installed, {
    recursive: true,
    dereference: true,
    filter: (src) => !src.includes("node_modules"),
  });

  // The real attw CLI, resolved through the only package here that depends on it.
  const require = createRequire(join(TEST_UTILS, "package.json"));
  const manifestPath = require.resolve("@arethetypeswrong/cli/package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { bin: { attw: string } };
  const attwEntry = join(dirname(manifestPath), manifest.bin.attw);

  // BOTH FILES A WINDOWS INSTALL WRITES. The shell script is there on every system, so on Windows
  // the old check for it passed and the start then failed; the `.cmd` file is the one Windows runs.
  const bin = join(consumer, "node_modules", ".bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, "attw"),
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(attwEntry)} "$@"\n`,
  );
  chmodSync(join(bin, "attw"), 0o755);
  writeFileSync(join(bin, "attw.cmd"), `@ECHO off\r\n"${process.execPath}" "${attwEntry}" %*\r\n`);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("cosyte-attw over a package installed the way Windows installs one", () => {
  it("starts attw, npm and pnpm, and passes a well-formed package", () => {
    const r = spawnSync(
      process.execPath,
      [
        join(consumer, "node_modules", "@cosyte", "script-utils", "bin", "cosyte-attw.js"),
        "--no-definitely-typed",
      ],
      { cwd: consumer, encoding: "utf8", timeout: 100_000 },
    );
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    expect(out).not.toContain("not runnable");
    expect(out).not.toContain("could not run");
    expect(out).toContain("✓ attw gate: attw-windows-fixture@1.0.0");
    expect(r.status, out).toBe(0);
  });

  it("does the same in this process, the way a caller's scripts/attw.mjs runs it", () => {
    // In this process as well as in a child, so the lines that start each tool are measured.
    const callerUrl = pathToFileURL(join(consumer, "scripts", "attw.mjs")).href;
    const before = process.cwd();
    process.chdir(consumer);
    try {
      expect(runAttwGate({ callerUrl, argv: ["--no-definitely-typed"] })).toBe(0);
      expect(runAttwGate({ callerUrl, argv: ["--profile", 'node16"'] })).toBe(1);
    } finally {
      process.chdir(before);
    }
  });

  it("refuses an argument cmd.exe could not take, on every system, before attw starts", () => {
    const r = spawnSync(
      process.execPath,
      [
        join(consumer, "node_modules", "@cosyte", "script-utils", "bin", "cosyte-attw.js"),
        "--profile=%PATH%",
      ],
      { cwd: consumer, encoding: "utf8", timeout: 100_000 },
    );
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    expect(r.status, out).toBe(1);
    expect(out).toContain("a percent sign");
  });
});
