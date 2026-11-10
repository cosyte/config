import { cosyteStryker } from "./stryker.js";

// This package's own mutation testing: `node bin/cosyte-mutate.js full` from this directory.
// Static mutants are kept: the barrel reading in stryker.js is a set of module-level patterns, and
// they are the code under test.
export default cosyteStryker({
  mutate: ["stryker.js", "mutate.js"],
  stryker: { ignoreStatic: false },
});
