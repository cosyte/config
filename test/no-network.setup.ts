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
 * test worker, so a hostname belonging to somebody else cannot be turned into a connection there.
 * It does NOT reach into child processes: several suites spawn the real tools (the phi-scan
 * capability probe, the manifest validator, the `changeset` binary, `attw`), and a guard that broke
 * those would be blocking the thing being measured rather than a stray request. Those are all local
 * by construction.
 *
 * AND IT DOES NOT BLOCK THE LOOPBACK INTERFACE, WHICH IS NOT A NETWORK DEPENDENCY. The
 * install-hardening suite serves a FIXTURE REGISTRY it starts itself on 127.0.0.1 so that pnpm's
 * cooldown and trust-policy behaviour can be measured rather than assumed, and binding a local
 * server goes through `dns.lookup` like anything else. A run against a server this process started
 * cannot fail on somebody else's uptime or a rate limit, which is the whole failure class this file
 * exists to keep out of a required check. Every other host is refused, including a hostname that
 * would merely RESOLVE to a loopback address, because the resolution itself is the reach.
 *
 * WHEN A TEST LEGITIMATELY NEEDS AN OFF-BOX HOST, it does not belong in this suite. There is no
 * opt-out here on purpose: an opt-out is how a rule becomes a comment.
 */

/** Literal loopback hosts. A NAME that resolves to one is not here: resolving it is the reach. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0", "::"]);

const isLoopback = (host: unknown): boolean =>
  LOOPBACK_HOSTS.has(
    String(host ?? "")
      .toLowerCase()
      .replace(/^\[|\]$/g, ""),
  );

const refusal = (what: string, target: unknown): Error =>
  new Error(
    `this test suite makes no network request, and ${what} was called with ` +
      `${JSON.stringify(target ?? null)}. Inject the lookup instead: the advisory check in ` +
      `scripts/drift-check.js takes its fetcher as an argument for exactly this reason. ` +
      `(A server this suite starts on the loopback interface is allowed; a host it does not own ` +
      `is not.)`,
  );

/** The host a `fetch` argument addresses, or `null` when it is not a URL this can read. */
const fetchHost = (input: unknown): string | null => {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : typeof (input as { url?: unknown })?.url === "string"
          ? (input as { url: string }).url
          : null;
  if (raw === null) return null;
  try {
    return new URL(raw).hostname;
  } catch {
    return null;
  }
};

const realFetch = globalThis.fetch;

globalThis.fetch = ((input: unknown, init?: unknown) => {
  const host = fetchHost(input);
  if (host !== null && isLoopback(host)) {
    return (realFetch as (...args: unknown[]) => unknown)(input, init);
  }
  throw refusal("fetch", host ?? input);
}) as unknown as typeof globalThis.fetch;

const dns = await import("node:dns");

/** Delegate a loopback literal to the real resolver; refuse every other host. */
const guardLookup = <T extends (...args: never[]) => unknown>(what: string, real: T): T =>
  ((...args: unknown[]) => {
    if (isLoopback(args[0])) return (real as (...inner: unknown[]) => unknown)(...args);
    throw refusal(what, args[0]);
  }) as unknown as T;

dns.default.lookup = guardLookup("dns.lookup", dns.default.lookup);
dns.default.resolve = guardLookup("dns.resolve", dns.default.resolve);
dns.default.promises.lookup = guardLookup("dns.promises.lookup", dns.default.promises.lookup);
