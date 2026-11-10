import { cosyteStryker } from "./stryker.js";

// This package's own mutation testing: `node bin/cosyte-mutate.js full` from this directory.
export default cosyteStryker({ mutate: ["stryker.js", "mutate.js"] });
