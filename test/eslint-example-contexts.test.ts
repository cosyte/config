/**
 * Every `jsdoc/require-example` context `@cosyte/eslint-config` lists must be able to report.
 *
 * A context that never reports reads, in the config, as a rule the lint holds, while every export
 * of that kind passes without an `@example`. `ExportNamedDeclaration > VariableDeclaration` was
 * one: an exported constant, an exported arrow function and an exported function expression all
 * passed with a doc comment and no `@example`, because the rule finds no doc comment on a
 * declaration whose comment sits before `export`.
 *
 * Each test lints one synthetic source file, written here into a scratch project, with the shared
 * config type-checked as a consumer runs it. No other repository is read.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import cosyteEslint from "@cosyte/eslint-config";

const RULE = "jsdoc/require-example";

/** One export of each kind, every one with a doc comment and none with an `@example`. */
const SOURCE = [
  "/** A constant. */",
  "export const LIMIT: number = 3;",
  "",
  "/** An arrow function. */",
  "export const twice = (n: number): number => n * 2;",
  "",
  "/** A function expression. */",
  "export const thrice = function (n: number): number {",
  "  return n * 3;",
  "};",
  "",
  "/** A function. */",
  "export function add(a: number, b: number): number {",
  "  return a + b;",
  "}",
  "",
  "/** A class. */",
  "export class Box {}",
  "",
].join("\n");

/** The 1-based line of a doc comment in `SOURCE`, where the rule reports a missing `@example`. */
function lineOf(comment: string): number {
  return SOURCE.split("\n").indexOf(comment) + 1;
}

type Config = ReturnType<typeof cosyteEslint>;
type Options = { contexts?: string[]; exemptedBy?: string[] };

interface LintMessage {
  ruleId: string | null;
  line: number;
}

interface EslintInstance {
  lintFiles(patterns: string[]): Promise<{ messages: LintMessage[] }[]>;
}

type EslintClass = new (options: {
  cwd: string;
  overrideConfigFile: boolean;
  overrideConfig: Config;
}) => EslintInstance;

let root: string;
let ESLint: EslintClass;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "eslint-example-"));
  writeFileSync(
    join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { strict: true, module: "nodenext", target: "es2023", noEmit: true },
      include: ["src"],
    }),
  );
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "exports.ts"), SOURCE);
  // ESLint is the package's peer, installed beside it rather than at this workspace's root.
  const fromPackage = createRequire(join(import.meta.dirname, "..", "packages/eslint-config/x.js"));
  const eslint = (await import(pathToFileURL(fromPackage.resolve("eslint")).href)) as {
    ESLint: EslintClass;
  };
  ESLint = eslint.ESLint;
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/** The shared config's own `require-example` options. */
function shippedOptions(): Options {
  const block = cosyteEslint(root).find((b) => b.rules?.[RULE] !== undefined);
  const entry = block?.rules?.[RULE];
  if (!Array.isArray(entry)) throw new Error(`the shared config does not set ${RULE}`);
  return entry[1] as Options;
}

/** The lines `require-example` reports on when the shared config runs with `options` for it. */
async function reported(options: Options): Promise<number[]> {
  const config = cosyteEslint(root).map((block) =>
    block.rules?.[RULE] === undefined
      ? block
      : { ...block, rules: { ...block.rules, [RULE]: ["error", options] } },
  ) as Config;
  const eslint = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: config });
  const [result] = await eslint.lintFiles(["src/exports.ts"]);
  return (result?.messages ?? []).filter((m) => m.ruleId === RULE).map((m) => m.line);
}

describe("@cosyte/eslint-config: jsdoc/require-example", () => {
  it("as shipped, reports the exported function and class with no @example", async () => {
    expect(await reported(shippedOptions())).toEqual([
      lineOf("/** A function. */"),
      lineOf("/** A class. */"),
    ]);
  }, 60_000);

  it("ExportNamedDeclaration > VariableDeclaration alone reports nothing", async () => {
    // The context the config used to list: it passes a constant, an arrow function and a function
    // expression alike, so it held nothing.
    const options = {
      ...shippedOptions(),
      contexts: ["ExportNamedDeclaration > VariableDeclaration"],
    };
    expect(await reported(options)).toEqual([]);
  }, 60_000);

  it("every context the config lists reports on its own", async () => {
    const options = shippedOptions();
    const silent: string[] = [];
    for (const context of options.contexts ?? []) {
      if ((await reported({ ...options, contexts: [context] })).length === 0) silent.push(context);
    }
    expect(silent).toEqual([]);
  }, 120_000);
});
