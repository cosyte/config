/**
 * The measuring process. `spawn.ts` starts it with a job file and an out file; it runs the job and
 * exits 0 (measured) or 2 (could not). Its logic is `childMain`, which the tests run in-process; this
 * file is the two lines around it.
 *
 * @packageDocumentation
 */

import { childMain } from "./child.js";

process.exitCode = await childMain(process.argv[2] ?? "", process.argv[3] ?? "");
