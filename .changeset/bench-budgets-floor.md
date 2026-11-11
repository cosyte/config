---
"@cosyte/bench": patch
---

`@cosyte/bench` now checks a reading against a package's performance budgets and its floor.

- `cosyte-bench gate <reading.json> --budgets <file> --floor <file> [--base-floor <file>]` exits 1
  when a case is over a budget (peak as a multiple of its input by size class, bytes allocated an
  operation, the least bytes or operations a second, the median cold import, the gzipped bytes the
  import loads), when a measure is above the highest of the floor's recorded readings plus 3 times
  their spread, or when the floor file is looser than the base branch's. It exits 2 when a limit names
  something the reading did not measure or a file holds no limit, and on any reading not taken on a
  GitHub-hosted runner.
- `cosyte-bench floor <reading.json>... --out <file> [--from <file>]` records a floor from at least
  seven readings of one commit, or tightens an existing one only where a new set is better beyond
  the old set's noise: a floor only improves, and does not drift down on a lucky set.
- With `--floor`, `gate` needs `--base-floor <file>` or, for a package's first floor,
  `--no-base-floor`.
- New exports: `readBudgets`, `BUDGETS_SCHEMA`, `readFloor`, `FLOOR_SCHEMA` and their types, and the
  schemas as `schema/budgets-v1.schema.json` and `schema/floor-v1.schema.json`. `BENCH_CONTRACT`
  gains `LARGE_INPUT_BYTES`, `FLOOR_MIN_READINGS` and `FLOOR_NOISE_MULTIPLE`. Nothing a caller uses today changes.
