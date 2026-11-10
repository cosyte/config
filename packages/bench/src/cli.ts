#!/usr/bin/env node
/**
 * The `cosyte-bench` bin. Its logic is `main`, which the tests run in-process; this file is the
 * lines around it.
 *
 * @packageDocumentation
 */

import { environment } from "./environment.js";
import { measureImportCost } from "./import-cost.js";
import { main } from "./main.js";
import { runInChild } from "./spawn.js";

process.exitCode = await main(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  cwd: process.cwd(),
  env: process.env,
  runJob: (job) => runInChild(job),
  measureImport: (target) => measureImportCost(target),
  environment: () => environment(process.env),
  now: () => new Date(),
});
