## Environment

`linux-x64` · Node `22.23.1` · V8 `12.4.254.21-node.56` · 56 CPU (`Intel(R) Xeon(R) CPU E5-2680 v4 @ 2.40GHz`) · 157.3 GiB RAM · cgroup memory.max `17179869184` · NODE_OPTIONS `unset`

Ratio rows: **1600** across 16 cell/phase groups.

## A1: ratio distribution, by cell (estimator: `median`)

Ideal is exactly **4.0**. The workload is linear, so no deviation here is a real regression, but do not read the spread as pure noise either: A3 shows a **reproducible** ordering and axis bias of a few percent sitting inside it. The tail is noise; the offset of the centre is not.

| axis | order | coverage | phase | n | min | p50 | p95 | p99 | max |
|---|---|---|---|---:|---:|---:|---:|---:|---:|
| count | NF | off | cold | 50 | 2.963 | 3.929 | 4.438 | 7.217 | 7.217 |
| count | NF | off | warm | 150 | 2.967 | 3.945 | 4.189 | 5.338 | 8.494 |
| count | NF | on | cold | 50 | 2.447 | 4.018 | 6.394 | 7.354 | 7.354 |
| count | NF | on | warm | 150 | 2.925 | 3.929 | 4.201 | 4.461 | 5.110 |
| count | FN | off | cold | 50 | 2.231 | 3.984 | 4.534 | 5.258 | 5.258 |
| count | FN | off | warm | 150 | 2.110 | 3.967 | 4.929 | 5.715 | 7.859 |
| count | FN | on | cold | 50 | 2.957 | 3.957 | 4.413 | 5.088 | 5.088 |
| count | FN | on | warm | 150 | 3.045 | 3.997 | 4.707 | 5.211 | 5.370 |
| size | NF | off | cold | 50 | 3.198 | 4.314 | 5.325 | 5.549 | 5.549 |
| size | NF | off | warm | 150 | 1.933 | 4.145 | 4.774 | 5.591 | 5.705 |
| size | NF | on | cold | 50 | 2.495 | 4.368 | 5.624 | 8.457 | 8.457 |
| size | NF | on | warm | 150 | 2.316 | 4.070 | 4.969 | 5.579 | 5.816 |
| size | FN | off | cold | 50 | 2.579 | 4.203 | 5.274 | 5.697 | 5.697 |
| size | FN | off | warm | 150 | 1.332 | 4.203 | 4.952 | 5.904 | 7.034 |
| size | FN | on | cold | 50 | 3.677 | 4.137 | 5.011 | 5.314 | 5.314 |
| size | FN | on | warm | 150 | 2.543 | 4.152 | 4.854 | 5.236 | 5.443 |

## A2: estimator comparison (worst observed ratio, all cells pooled)

| estimator | p50 | p95 | p99 | max | max (cold only) |
|---|---:|---:|---:|---:|---:|
| `min` | 4.071 | 4.607 | 5.328 | 6.649 | 5.587 |
| `median` | 4.027 | 4.966 | 5.591 | 8.494 | 8.457 |
| `trimmedMean` | 4.047 | 4.861 | 5.570 | 8.584 | 8.584 |
| `mean` | 4.056 | 4.933 | 5.641 | 8.252 | 8.252 |

## A3: ordering effect (C5: the confound a same-process ratio does NOT cancel)

| axis | coverage | phase | p50 N→4N | p50 4N→N | Δ p50 | max N→4N | max 4N→N |
|---|---|---|---:|---:|---:|---:|---:|
| count | off | cold | 3.929 | 3.984 | 1.4% | 7.217 | 5.258 |
| count | off | warm | 3.945 | 3.967 | 0.6% | 8.494 | 7.859 |
| count | on | cold | 4.018 | 3.957 | -1.5% | 7.354 | 5.088 |
| count | on | warm | 3.929 | 3.997 | 1.7% | 5.110 | 5.370 |
| size | off | cold | 4.314 | 4.203 | -2.6% | 5.549 | 5.697 |
| size | off | warm | 4.145 | 4.203 | 1.4% | 5.705 | 7.034 |
| size | on | cold | 4.368 | 4.137 | -5.3% | 8.457 | 5.314 |
| size | on | warm | 4.070 | 4.152 | 2.0% | 5.816 | 5.443 |

## A4: coverage effect (V1), against the pre-registered decision rule

Rule, recorded before the sweep: exclude perf tests from coverage iff |Δ p50| > 5% or Δ p95 > 15%.

| axis | order | phase | p50 off | p50 on | Δ p50 | p95 off | p95 on | Δ p95 | trips rule |
|---|---|---|---:|---:|---:|---:|---:|---:|---|
| count | NF | cold | 3.929 | 4.018 | 2.3% | 4.438 | 6.394 | 44.1% | **YES** |
| count | NF | warm | 3.945 | 3.929 | -0.4% | 4.189 | 4.201 | 0.3% | no |
| count | FN | cold | 3.984 | 3.957 | -0.7% | 4.534 | 4.413 | -2.7% | no |
| count | FN | warm | 3.967 | 3.997 | 0.7% | 4.929 | 4.707 | -4.5% | no |
| size | NF | cold | 4.314 | 4.368 | 1.2% | 5.325 | 5.624 | 5.6% | no |
| size | NF | warm | 4.145 | 4.070 | -1.8% | 4.774 | 4.969 | 4.1% | no |
| size | FN | cold | 4.203 | 4.137 | -1.6% | 5.274 | 5.011 | -5.0% | no |
| size | FN | warm | 4.203 | 4.152 | -1.2% | 4.952 | 4.854 | -2.0% | no |

**Decision rule verdict: TRIPPED.**

## A5: coverage overhead is NOT uniform across the two compared phases

V1's mechanism predicts the instrumentation cost scales with executed-block count and density, which differ between the phases. If the two multipliers below were equal, coverage would cancel exactly in the ratio; the gap between them is the non-cancellation, in the units that matter.

| axis | order | phase | base ×slower | quad ×slower | gap |
|---|---|---|---:|---:|---:|
| count | NF | cold | 1.17× | 1.33× | 14.4% |
| count | NF | warm | 1.19× | 1.19× | -0.1% |
| count | FN | cold | 1.35× | 1.35× | -0.3% |
| count | FN | warm | 1.33× | 1.24× | -6.7% |
| size | NF | cold | 1.39× | 1.38× | -0.6% |
| size | NF | warm | 1.32× | 1.33× | 1.0% |
| size | FN | cold | 1.43× | 1.39× | -2.9% |
| size | FN | warm | 1.32× | 1.35× | 1.7% |

## A6: warmup: is the sample vector still descending? (W1)

Each phase records 5 reps. If a fixed-count warmup were sufficient, rep 1 and rep 5 would be interchangeable. Ratio of the FIRST rep to the LAST, median across trials.

| axis | coverage | phase | base rep1/rep5 | quad rep1/rep5 |
|---|---|---|---:|---:|
| count | off | cold | 1.13× | 1.07× |
| count | off | warm | 1.00× | 1.01× |
| count | on | cold | 1.09× | 1.07× |
| count | on | warm | 1.02× | 1.02× |
| size | off | cold | 1.04× | 1.15× |
| size | off | warm | 1.02× | 0.97× |
| size | on | cold | 1.05× | 1.11× |
| size | on | warm | 1.01× | 0.99× |

## B1: `gc()` rounds to a `heapUsed` fixpoint (M3), Node 22.23.1 / V8 12.4.254.21-node.56

| leg | trials | rounds required (value→count) | settled spread, median | settled spread, WORST | baseline drift |
|---|---:|---|---:|---:|---:|
| sync `gc()` | 50 | 1→50 | 0.000% | 1120 B (0.028%) | 0.56% |
| async `gc({execution:'async'})` | 50 | 1→50 | 0.000% | 712 B (0.022%) | 0.49% |

The **worst** column is the one P3 has to design against: the median settled reading is exactly reproducible, but a minority of trials still move by ~1 KiB across settled rounds with no workload running. That is the noise floor of a settled `heapUsed` figure, and it is not zero.

## B2: what each `gc` argument form actually reclaims (M2)

Old-space garbage of ~22.9 MiB per trial.

| form | trials | median reclaimed | verdict |
|---|---:|---:|---|
| `gc()` | 10 | 22.88 MiB | **major GC** |
| `gc(true)` | 10 | -0.00 MiB | scavenge: reading is invalid |
| `gc(false)` | 10 | -0.00 MiB | scavenge: reading is invalid |
| `gc(1)` | 10 | -0.00 MiB | scavenge: reading is invalid |
| `gc(null)` | 10 | -0.00 MiB | scavenge: reading is invalid |
| `gc(undefined)` | 10 | -0.00 MiB | scavenge: reading is invalid |
| `gc({})` | 10 | -0.00 MiB | scavenge: reading is invalid |
| `gc({foo:1})` | 10 | -0.00 MiB | scavenge: reading is invalid |
| `gc({type:'major'})` | 10 | 22.88 MiB | **major GC** |
| `gc({type:'minor'})` | 10 | -0.00 MiB | scavenge: reading is invalid |
| `gc({execution:'sync'})` | 10 | 22.88 MiB | **major GC** |
| `await gc({execution:'async'})` | 10 | 22.88 MiB | **major GC** |
| `gc({flavor:'last-resort'})` | 10 | 22.88 MiB | **major GC** |

## D: the SIGNAL side: what an O(n²)-in-length regression actually scores

Same harness, same `min` estimator, same 4× size step: only the parser is quadratic. This is the number the ceiling is argued *against*, and it was inherited arithmetic ("≈16") until now.

| base OBX → 4× | coverage | n | min | p50 | max |
|---|---|---:|---:|---:|---:|
| 125 → 500 | off | 20 | 5.75 | 6.82 | 8.47 |
| 125 → 500 | on | 20 | 4.69 | 9.58 | 10.66 |
| 250 → 1000 | off | 20 | 8.09 | 10.56 | 11.35 |
| 250 → 1000 | on | 20 | 9.11 | 11.71 | 18.75 |
| 500 → 2000 | off | 20 | 8.84 | 11.75 | 16.02 |
| 500 → 2000 | on | 20 | 10.07 | 12.34 | 15.08 |
| 1000 → 4000 | off | 20 | 10.68 | 12.56 | 15.67 |
| 1000 → 4000 | on | 20 | 10.81 | 14.56 | 16.10 |

| base OBX → 4× | weakest signal seen | worst false alarm (`min`, all rows) | separated? |
|---|---:|---:|---|
| 125 → 500 | 4.69 | 6.65 | **NO: overlaps the noise** |
| 250 → 1000 | 8.09 | 6.65 | yes, by 1.22× |
| 500 → 2000 | 8.84 | 6.65 | yes, by 1.33× |
| 1000 → 4000 | 10.68 | 6.65 | yes, by 1.61× |

The signal is **not a constant**. It climbs with fixture size as the quadratic term overtakes the linear per-line work, so **the fixture size is part of the gate's calibration, not a free choice**. A package that picks fixtures too small gets a gate whose signal sits inside its own false-alarm tail: green while broken, which is roadmap §5's second-worst outcome.

## C: candidate constants, derived

Mechanical derivation only; the judgement about how much margin to buy is written up in ANALYSIS.md. Both populations are shown; the ALL column is the one ANALYSIS.md quotes, because the binding worst case turns out not to be a cold row.

| estimator | cold n | cold min…max | ALL n | ALL min…max | headroom of ceiling 8 (all) |
|---|---:|---|---:|---|---:|
| `min` | 400 | 1.753 … 5.587 | 1600 | 1.702 … 6.649 | 1.20× |
| `median` | 400 | 2.231 … 8.457 | 1600 | 1.332 … 8.494 | 0.94× |
| `trimmedMean` | 400 | 2.472 … 8.584 | 1600 | 1.416 … 8.584 | 0.93× |
| `mean` | 400 | 2.291 … 8.252 | 1600 | 1.805 … 8.252 | 0.97× |

Both populations are shown because the cold-only split, though pre-registered, was justified on the premise that warm rows are a quieter steady state. On the noisy leg they are not uniformly quieter, so a margin quoted from cold alone overstates the headroom. **The ALL column is the honest one** and is what ANALYSIS.md quotes.

