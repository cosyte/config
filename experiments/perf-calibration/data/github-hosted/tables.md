## Environment

`linux-x64` · Node `22.23.1` · V8 `12.4.254.21-node.56` · 4 CPU (`AMD EPYC 7763 64-Core Processor`) · 15.6 GiB RAM · cgroup memory.max `unset` · NODE_OPTIONS `unset`

GitHub-hosted: image `ubuntu24` version `20260720.247.2`, run `30169401396`.

Ratio rows: **1600** across 16 cell/phase groups.

## A1 — ratio distribution, by cell (estimator: `median`)

Ideal is exactly **4.0**. The workload is linear, so no deviation here is a real regression — but do not read the spread as pure noise either: A3 shows a **reproducible** ordering and axis bias of a few percent sitting inside it. The tail is noise; the offset of the centre is not.

| axis | order | coverage | phase | n | min | p50 | p95 | p99 | max |
|---|---|---|---|---:|---:|---:|---:|---:|---:|
| count | NF | off | cold | 50 | 3.881 | 3.958 | 4.118 | 4.290 | 4.290 |
| count | NF | off | warm | 150 | 3.106 | 3.918 | 3.988 | 4.275 | 4.496 |
| count | NF | on | cold | 50 | 3.679 | 4.000 | 4.041 | 4.047 | 4.047 |
| count | NF | on | warm | 150 | 3.780 | 3.917 | 3.993 | 4.014 | 4.148 |
| count | FN | off | cold | 50 | 4.029 | 4.110 | 4.162 | 4.191 | 4.191 |
| count | FN | off | warm | 150 | 3.772 | 3.978 | 4.034 | 4.060 | 4.074 |
| count | FN | on | cold | 50 | 3.827 | 3.924 | 4.007 | 4.093 | 4.093 |
| count | FN | on | warm | 150 | 3.917 | 3.985 | 4.029 | 4.061 | 4.148 |
| size | NF | off | cold | 50 | 4.133 | 4.226 | 4.314 | 4.381 | 4.381 |
| size | NF | off | warm | 150 | 4.167 | 4.397 | 4.458 | 4.506 | 4.518 |
| size | NF | on | cold | 50 | 4.092 | 4.181 | 4.344 | 4.414 | 4.414 |
| size | NF | on | warm | 150 | 4.040 | 4.277 | 4.334 | 4.349 | 4.356 |
| size | FN | off | cold | 50 | 4.203 | 4.288 | 4.422 | 4.500 | 4.500 |
| size | FN | off | warm | 150 | 4.193 | 4.422 | 4.487 | 4.513 | 4.517 |
| size | FN | on | cold | 50 | 4.090 | 4.198 | 4.265 | 4.420 | 4.420 |
| size | FN | on | warm | 150 | 4.060 | 4.288 | 4.340 | 4.363 | 4.373 |

## A2 — estimator comparison (worst observed ratio, all cells pooled)

| estimator | p50 | p95 | p99 | max | max (cold only) |
|---|---:|---:|---:|---:|---:|
| `min` | 4.167 | 4.339 | 4.449 | 4.501 | 4.501 |
| `median` | 4.133 | 4.434 | 4.481 | 4.518 | 4.500 |
| `trimmedMean` | 4.161 | 4.500 | 4.643 | 4.711 | 4.707 |
| `mean` | 4.140 | 4.604 | 4.764 | 4.820 | 4.820 |

## A3 — ordering effect (C5: the confound a same-process ratio does NOT cancel)

| axis | coverage | phase | p50 N→4N | p50 4N→N | Δ p50 | max N→4N | max 4N→N |
|---|---|---|---:|---:|---:|---:|---:|
| count | off | cold | 3.958 | 4.110 | 3.8% | 4.290 | 4.191 |
| count | off | warm | 3.918 | 3.978 | 1.5% | 4.496 | 4.074 |
| count | on | cold | 4.000 | 3.924 | -1.9% | 4.047 | 4.093 |
| count | on | warm | 3.917 | 3.985 | 1.7% | 4.148 | 4.148 |
| size | off | cold | 4.226 | 4.288 | 1.5% | 4.381 | 4.500 |
| size | off | warm | 4.397 | 4.422 | 0.6% | 4.518 | 4.517 |
| size | on | cold | 4.181 | 4.198 | 0.4% | 4.414 | 4.420 |
| size | on | warm | 4.277 | 4.288 | 0.2% | 4.356 | 4.373 |

## A4 — coverage effect (V1), against the pre-registered decision rule

Rule, recorded before the sweep: exclude perf tests from coverage iff |Δ p50| > 5% or Δ p95 > 15%.

| axis | order | phase | p50 off | p50 on | Δ p50 | p95 off | p95 on | Δ p95 | trips rule |
|---|---|---|---:|---:|---:|---:|---:|---:|---|
| count | NF | cold | 3.958 | 4.000 | 1.1% | 4.118 | 4.041 | -1.9% | no |
| count | NF | warm | 3.918 | 3.917 | -0.0% | 3.988 | 3.993 | 0.1% | no |
| count | FN | cold | 4.110 | 3.924 | -4.5% | 4.162 | 4.007 | -3.7% | no |
| count | FN | warm | 3.978 | 3.985 | 0.2% | 4.034 | 4.029 | -0.1% | no |
| size | NF | cold | 4.226 | 4.181 | -1.1% | 4.314 | 4.344 | 0.7% | no |
| size | NF | warm | 4.397 | 4.277 | -2.7% | 4.458 | 4.334 | -2.8% | no |
| size | FN | cold | 4.288 | 4.198 | -2.1% | 4.422 | 4.265 | -3.5% | no |
| size | FN | warm | 4.422 | 4.288 | -3.0% | 4.487 | 4.340 | -3.3% | no |

**Decision rule verdict: not tripped.**

## A5 — coverage overhead is NOT uniform across the two compared phases

V1's mechanism predicts the instrumentation cost scales with executed-block count and density, which differ between the phases. If the two multipliers below were equal, coverage would cancel exactly in the ratio; the gap between them is the non-cancellation, in the units that matter.

| axis | order | phase | base ×slower | quad ×slower | gap |
|---|---|---|---:|---:|---:|
| count | NF | cold | 1.25× | 1.27× | 1.1% |
| count | NF | warm | 1.26× | 1.27× | 0.5% |
| count | FN | cold | 1.33× | 1.27× | -4.5% |
| count | FN | warm | 1.28× | 1.29× | 0.4% |
| size | NF | cold | 1.38× | 1.37× | -0.8% |
| size | NF | warm | 1.41× | 1.37× | -2.8% |
| size | FN | cold | 1.38× | 1.35× | -1.7% |
| size | FN | warm | 1.40× | 1.36× | -3.1% |

## A6 — warmup: is the sample vector still descending? (W1)

Each phase records 5 reps. If a fixed-count warmup were sufficient, rep 1 and rep 5 would be interchangeable. Ratio of the FIRST rep to the LAST, median across trials.

| axis | coverage | phase | base rep1/rep5 | quad rep1/rep5 |
|---|---|---|---:|---:|
| count | off | cold | 1.15× | 1.09× |
| count | off | warm | 1.05× | 1.01× |
| count | on | cold | 1.11× | 1.05× |
| count | on | warm | 1.02× | 1.00× |
| size | off | cold | 1.01× | 1.23× |
| size | off | warm | 1.01× | 0.96× |
| size | on | cold | 1.03× | 1.17× |
| size | on | warm | 1.01× | 0.97× |

## B1 — `gc()` rounds to a `heapUsed` fixpoint (M3), Node 22.23.1 / V8 12.4.254.21-node.56

| leg | trials | rounds required (value→count) | settled spread, median | settled spread, WORST | baseline drift |
|---|---:|---|---:|---:|---:|
| sync `gc()` | 50 | 1→50 | 0.000% | 1120 B (0.028%) | 0.56% |
| async `gc({execution:'async'})` | 50 | 1→50 | 0.000% | 712 B (0.022%) | 0.50% |

The **worst** column is the one P3 has to design against: the median settled reading is exactly reproducible, but a minority of trials still move by ~1 KiB across settled rounds with no workload running. That is the noise floor of a settled `heapUsed` figure, and it is not zero.

## B2 — what each `gc` argument form actually reclaims (M2)

Old-space garbage of ~22.9 MiB per trial.

| form | trials | median reclaimed | verdict |
|---|---:|---:|---|
| `gc()` | 10 | 22.88 MiB | **major GC** |
| `gc(true)` | 10 | -0.00 MiB | scavenge — reading is invalid |
| `gc(false)` | 10 | -0.00 MiB | scavenge — reading is invalid |
| `gc(1)` | 10 | -0.00 MiB | scavenge — reading is invalid |
| `gc(null)` | 10 | -0.00 MiB | scavenge — reading is invalid |
| `gc(undefined)` | 10 | -0.00 MiB | scavenge — reading is invalid |
| `gc({})` | 10 | -0.00 MiB | scavenge — reading is invalid |
| `gc({foo:1})` | 10 | -0.00 MiB | scavenge — reading is invalid |
| `gc({type:'major'})` | 10 | 22.88 MiB | **major GC** |
| `gc({type:'minor'})` | 10 | -0.00 MiB | scavenge — reading is invalid |
| `gc({execution:'sync'})` | 10 | 22.88 MiB | **major GC** |
| `await gc({execution:'async'})` | 10 | 22.88 MiB | **major GC** |
| `gc({flavor:'last-resort'})` | 10 | 22.88 MiB | **major GC** |

## D — the SIGNAL side: what an O(n²)-in-length regression actually scores

Same harness, same `min` estimator, same 4× size step — only the parser is quadratic. This is the number the ceiling is argued *against*, and it was inherited arithmetic ("≈16") until now.

| base OBX → 4× | coverage | n | min | p50 | max |
|---|---|---:|---:|---:|---:|
| 125 → 500 | off | 20 | 6.69 | 9.11 | 9.34 |
| 125 → 500 | on | 20 | 9.37 | 9.73 | 10.70 |
| 250 → 1000 | off | 20 | 10.91 | 11.15 | 11.34 |
| 250 → 1000 | on | 20 | 11.58 | 11.81 | 12.22 |
| 500 → 2000 | off | 20 | 11.57 | 12.98 | 13.20 |
| 500 → 2000 | on | 20 | 11.43 | 13.42 | 13.84 |
| 1000 → 4000 | off | 20 | 14.71 | 14.85 | 14.97 |
| 1000 → 4000 | on | 20 | 14.47 | 14.83 | 15.01 |

| base OBX → 4× | weakest signal seen | worst false alarm (`min`, all rows) | separated? |
|---|---:|---:|---|
| 125 → 500 | 6.69 | 4.50 | yes, by 1.49× |
| 250 → 1000 | 10.91 | 4.50 | yes, by 2.42× |
| 500 → 2000 | 11.43 | 4.50 | yes, by 2.54× |
| 1000 → 4000 | 14.47 | 4.50 | yes, by 3.21× |

The signal is **not a constant**. It climbs with fixture size as the quadratic term overtakes the linear per-line work, so **the fixture size is part of the gate's calibration, not a free choice**. A package that picks fixtures too small gets a gate whose signal sits inside its own false-alarm tail — green while broken, which is roadmap §5's second-worst outcome.

## C — candidate constants, derived

Mechanical derivation only; the judgement about how much margin to buy is written up in ANALYSIS.md. Both populations are shown; the ALL column is the one ANALYSIS.md quotes, because the binding worst case turns out not to be a cold row.

| estimator | cold n | cold min…max | ALL n | ALL min…max | headroom of ceiling 8 (all) |
|---|---:|---|---:|---|---:|
| `min` | 400 | 3.963 … 4.501 | 1600 | 3.222 … 4.501 | 1.78× |
| `median` | 400 | 3.679 … 4.500 | 1600 | 3.106 … 4.518 | 1.77× |
| `trimmedMean` | 400 | 3.819 … 4.707 | 1600 | 3.037 … 4.711 | 1.70× |
| `mean` | 400 | 3.591 … 4.820 | 1600 | 3.031 … 4.820 | 1.66× |

Both populations are shown because the cold-only split, though pre-registered, was justified on the premise that warm rows are a quieter steady state. On the noisy leg they are not uniformly quieter, so a margin quoted from cold alone overstates the headroom. **The ALL column is the honest one** and is what ANALYSIS.md quotes.

