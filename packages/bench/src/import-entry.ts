/**
 * The cold import process. `import-cost.ts` starts it with a target and an out file. Its logic is
 * `importMain`, which the tests run in-process; this file is the two lines around it.
 *
 * @packageDocumentation
 */

import { importMain } from "./import-cost.js";

process.exitCode = await importMain(process.argv.slice(2));
