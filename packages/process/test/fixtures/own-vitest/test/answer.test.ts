import { expect, it } from "vitest";

import { answer } from "../src/index.js";

it("imports the consumer's own source, so coverage has something to report", () => {
  expect(answer).toBe(42);
});
