/**
 * REFUSE NETWORK ACCESS FROM INSIDE A TEST, FOR EVERY FILE IN THE ROOT SUITE.
 *
 * WHY IT IS A SETUP FILE AND NOT A CONVENTION. `pnpm test` is the required `verify` check, and a
 * test that reaches the network is a required gate that fails for a reason having nothing to do
 * with the code under test. That is a rule every suite here already followed, and a rule nothing
 * enforced: the advisory lookup added in S0091-config-2 is the first thing in this repository that
 * COULD reach the network, its default really does call `fetch`, and the distance between "every
 * case injects a stub" and "one case forgot" is a single merge.
 *
 * WHAT IT BLOCKS, AND WHAT IT DELIBERATELY DOES NOT. `fetch` and DNS resolution raise inside the
 * test worker, so a hostname cannot be turned into a connection there. It does NOT reach into
 * child processes: several suites spawn the real tools (the phi-scan capability probe, the manifest
 * validator, `changeset status`, `attw`), and a guard that broke those would be blocking the thing
 * being measured rather than a stray request. Those are all local by construction.
 *
 * WHEN A TEST LEGITIMATELY NEEDS THE NETWORK, it does not belong in this suite. There is no opt-out
 * here on purpose: an opt-out is how a rule becomes a comment.
 */

const refuse = (what: string) => {
  return (...args: unknown[]): never => {
    throw new Error(
      `this test suite makes no network request, and ${what} was called with ` +
        `${JSON.stringify(args[0] ?? null)}. Inject the lookup instead: the advisory check in ` +
        `scripts/drift-check.js takes its fetcher as an argument for exactly this reason.`,
    );
  };
};

globalThis.fetch = refuse("fetch") as unknown as typeof globalThis.fetch;

const dns = await import("node:dns");
dns.default.lookup = refuse("dns.lookup") as never;
dns.default.resolve = refuse("dns.resolve") as never;
dns.default.promises.lookup = refuse("dns.promises.lookup") as never;
