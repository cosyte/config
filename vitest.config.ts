import { defineConfig } from "vitest/config";

// Plain config: this repo ships configs, not library source, so there is nothing to gate coverage on.
// The smoke tests in test/ assert each exported config is valid and encodes the cosyte standard.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
