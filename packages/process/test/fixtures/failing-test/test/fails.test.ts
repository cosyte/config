import { expect, it } from "vitest";

it("fails on purpose so the exit code can be observed", () => {
  expect(1).toBe(2);
});
