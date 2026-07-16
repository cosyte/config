import { join } from "node:path";

import { docSnippetSuite } from "@cosyte/vitest-config/snippets";

/**
 * Doc/code-agreement gate. Every ```` ```ts runnable ```` block in `docs-content/` is extracted,
 * compiled, and executed, and its inline `// =>` assertions are checked — so a documented example can
 * never silently drift from the shipped code (the documentation analog of the conformance runners).
 *
 * `resolve` points a snippet's `import ... from "{{PKG}}"` at this repo's source, the same way the
 * rest of the suite imports it — a fast local gate. To assert against the *built* artifact a consumer
 * installs, run `pnpm build` first and map the specifier to `../dist/index.js` instead.
 */
docSnippetSuite({
  docsDir: join(import.meta.dirname, "..", "docs-content"),
  resolve: (specifier) =>
    specifier === "{{PKG}}" ? join(import.meta.dirname, "..", "src", "index.ts") : undefined,
});
