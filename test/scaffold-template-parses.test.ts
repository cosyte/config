/**
 * Every script in `scripts/parser-template/` parses as it stands, placeholders and all, unless it
 * carries the `.tmpl` suffix the scaffolder drops on copy.
 *
 * CodeQL reads every `.ts` and `.js` file in this repository. Two template files with `{{Pascal}}`
 * in identifier positions did not parse and were 83 open js/syntax-error alerts, and the shared
 * CodeQL workflow takes no configuration file that could skip them. They are now `.tmpl` files, and
 * this keeps the next one from arriving as a `.ts`: a file that does not parse until it is
 * generated is named `.tmpl` (scripts/scaffold-parser.mjs, TEMPLATE_SUFFIX).
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const TEMPLATE = join(import.meta.dirname, "..", "scripts", "parser-template");
const SCRIPT = /\.(?:[cm]?[jt]s|tsx|jsx)$/;

/** Every file under `dir`, recursively, as paths relative to the template. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return filesUnder(path);
    return entry.isFile() ? [relative(TEMPLATE, path)] : [];
  });
}

/** The syntax errors TypeScript reports for one file, as `line: message` strings. */
function syntaxErrors(path: string, name = path): string[] {
  const { diagnostics = [] } = ts.transpileModule(readFileSync(path, "utf8"), {
    fileName: name,
    reportDiagnostics: true,
    compilerOptions: { allowJs: true, jsx: ts.JsxEmit.Preserve },
  });
  return diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
}

const FILES = filesUnder(TEMPLATE);

describe("the parser template's scripts parse before they are generated", () => {
  it("finds the template's scripts", () => {
    expect(FILES.filter((f) => SCRIPT.test(f)).length).toBeGreaterThan(5);
  });

  it.each(FILES.filter((f) => SCRIPT.test(f)))("%s parses", (file) => {
    expect(syntaxErrors(join(TEMPLATE, file))).toEqual([]);
  });

  it.each(FILES.filter((f) => f.endsWith(".tmpl")))(
    "%s does not, so it carries the suffix that keeps CodeQL from reading it",
    (file) => {
      // The negative control: the check above can see a placeholder that breaks the parse. A
      // `.tmpl` that parses should lose the suffix and be held to the check above.
      expect(
        syntaxErrors(join(TEMPLATE, file), file.slice(0, -".tmpl".length)).length,
      ).toBeGreaterThan(0);
    },
  );
});
