#!/usr/bin/env node
import { runDocsReference } from "./docs-reference.js";

// The `cosyte-docs-reference` bin, as thin as `cosyte-process`'s: everything worth testing lives in
// `runDocsReference`, which takes argv and returns an exit code.
process.exitCode = await runDocsReference(process.argv.slice(2));
