// Lets a child process run this package's TypeScript sources directly, the way the tests run them:
// Node strips the types, and this hook maps the `.js` specifiers the sources import to their `.ts`
// files. Only for tests; the package itself runs from `dist`.

import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier.startsWith(".") &&
      specifier.endsWith(".js") &&
      context.parentURL?.endsWith(".ts")
    ) {
      return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});
