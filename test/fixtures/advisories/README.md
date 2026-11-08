# Advisory records, as the two sources actually returned them

These are the fixtures `test/drift-advisory.test.ts` grades the advisory half of
`scripts/drift-check.js` against. They exist so that suite makes NO request of its own: a unit
test that reached the network would be a flaky gate, and `pnpm test` has to pass with no egress.

They are REAL RESPONSE BODIES, trimmed to the keys the checker reads and to nothing else. Two
things are load-bearing about that:

- Nothing was rewritten. Every `vulnerable_version_range`, `first_patched_version`, `introduced`
  and `fixed` below is the byte the source returned. A fixture whose ranges were typed by hand
  would grade the checker against the same transcription this whole slice exists to remove.
- The prose fields (`summary`, `details`, `references`, `credits`) were dropped rather than kept.
  They are not read by anything under test, and advisory prose carries en and em dashes that this
  repository's own `no-emdash` gate refuses.

| file                              | fetched from                                            | on         |
| --------------------------------- | ------------------------------------------------------- | ---------- |
| `github-GHSA-5p4m-2wfm-xmqj.json` | `https://api.github.com/advisories/GHSA-5p4m-2wfm-xmqj` | 2026-08-28 |
| `osv-GHSA-5p4m-2wfm-xmqj.json`    | `https://api.osv.dev/v1/vulns/GHSA-5p4m-2wfm-xmqj`      | 2026-08-28 |
| `github-GHSA-h67p-54hq-rp68.json` | `https://api.github.com/advisories/GHSA-h67p-54hq-rp68` | 2026-08-28 |
| `osv-GHSA-h67p-54hq-rp68.json`    | `https://api.osv.dev/v1/vulns/GHSA-h67p-54hq-rp68`      | 2026-08-28 |
| `github-GHSA-g7r4-m6w7-qqqr.json` | `https://api.github.com/advisories/GHSA-g7r4-m6w7-qqqr` | 2026-08-28 |
| `osv-GHSA-g7r4-m6w7-qqqr.json`    | `https://api.osv.dev/v1/vulns/GHSA-g7r4-m6w7-qqqr`      | 2026-08-28 |
| `github-GHSA-2883-xcg3-v3hh.json` | `https://api.github.com/advisories/GHSA-2883-xcg3-v3hh` | 2026-11-08 |
| `osv-GHSA-2883-xcg3-v3hh.json`    | `https://api.osv.dev/v1/vulns/GHSA-2883-xcg3-v3hh`      | 2026-11-08 |

The unabridged bodies of the first six, with a sha256 and a fetch time beside each, are committed
in the umbrella under `work/specs/S0091-config-2/sources/`. The two GHSA-2883-xcg3-v3hh bodies were
fetched at 2026-11-08T02:24Z, when the js-yaml overrides moved to 4.3.2 and 3.15.2; the unabridged
GitHub body had sha256 `75d1a819d4d5f49575f42fb4f9b414690974c673eb4f45f4e95cbd68edda1050` and the
OSV body `8f10f055f4507d26a5fab14f299aa54699b9f4e47b2a099c97bfe8910848dbf6`. The two sources agree
on both branches for this one.

WHY BOTH SHAPES ARE KEPT FOR EVERY ADVISORY. The two sources do not always agree: for
`GHSA-h67p-54hq-rp68` GitHub reports the 4.x branch as `>= 4.0.0, <= 4.1.1` where OSV reports it
as introduced at 4.0.0 and fixed at 4.2.0. That disagreement is the reason the checker names the
record it read instead of asserting what "the advisory" says, and keeping both copies is what lets
a test hold it to that.
