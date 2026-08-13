#!/usr/bin/env node
import { run } from "./run.js";

// The bin is deliberately this thin: everything worth testing lives in `run`, which takes argv and
// returns an exit code. `process.exitCode` rather than `process.exit` so inherited streams finish
// flushing before the process goes away.
process.exitCode = await run(process.argv.slice(2));
