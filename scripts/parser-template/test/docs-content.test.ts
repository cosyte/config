import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { beforeAll } from "vitest";

import { docSnippetSuite } from "@cosyte/vitest-config/snippets";

/**
 * Doc/code-agreement gate. Every TypeScript and JavaScript sample on a hand-written page of
 * `docs-content/` is extracted, type-checked, and run, and its inline `// =>` assertions are
 * checked, so a documented example cannot drift from the shipped code. A sample that cannot run
 * says why in its fence (`ts no-run <reason>`). The generated pages under `docs-content/api/` are
 * left out: their `@example` blocks are fragments written for an editor's tooltip.
 *
 * A sample imports the package the way a consumer does, from the built ESM entry point: it runs as
 * a standalone module, and `dist/index.mjs` is what an installer loads. The shared CI job runs
 * `test` before `build`, so the build is made here rather than assumed.
 */
const root = join(import.meta.dirname, "..");

beforeAll(() => {
  execFileSync("pnpm", ["build"], { cwd: root, stdio: "inherit" });
}, 120_000);

docSnippetSuite({
  docsDir: join(root, "docs-content"),
  every: true,
  resolve: (specifier) =>
    specifier === "{{PKG}}" ? join(root, "dist", "index.mjs") : undefined,
});
