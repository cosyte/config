---
"@cosyte/vitest-config": patch
---

`cosyte-mutate full` can run in shards. With `COSYTE_MUTATE_SHARD=<k>/<n>` set, it mutates only the files of the config whose 32-bit FNV-1a hash of the path is `k - 1` mod `n`, so every file is in exactly one of the `n` shards, and writes `reports/mutation/shard-<k>-of-<n>.json` and its HTML beside the full report, never `mutation.json`; a shard with no file writes an empty report and exits 0 without starting Stryker, and a malformed value exits 2. With `COSYTE_MUTATE_INCREMENTAL_FILE` set, Stryker keeps its incremental results in that file (`incremental: true`). With neither variable set, a full run is unchanged, and a changed run reads neither. `parseShard`, `fnv1a32`, `filesInShard`, `expandMutate` and `shardReportPath` are exported from `@cosyte/vitest-config/mutate`.
