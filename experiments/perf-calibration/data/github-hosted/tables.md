## Environment

`linux-x64` · Node `22.23.1` · V8 `12.4.254.21-node.56` · 4 CPU (`AMD EPYC 7763 64-Core Processor`) · 15.6 GiB RAM · cgroup memory.max `unset` · NODE_OPTIONS `unset`

GitHub-hosted: image `ubuntu24` version `20260720.247.2`, run `30169401396`.

Ratio rows: **1600** across 16 cell/phase groups.

## A1 — ratio distribution, by cell (estimator: `median`)

Ideal is exactly **4.0**. The workload is linear, so every deviation is measurement noise.

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

| leg | trials | rounds required (value→count) | settled spread, within trial | baseline drift, across trials |
|---|---:|---|---:|---:|
| sync `gc()` | 50 | 1→50 | 0.000% | 0.56% |
| async `gc({execution:'async'})` | 50 | 1→50 | 0.000% | 0.40% |

## B2 — what each `gc` argument form actually reclaims (M2)

Old-space garbage of ~22.9 MiB per trial.

| form | trials | median reclaimed | verdict |
|---|---:|---:|---|
| `gc()` | 10 | 22.88 MiB | **major GC** |
| `gc(true)` | 10 | -0.00 MiB | scavenge — reading is invalid |
| `gc(false)` | 10 | -0.00 MiB | scavenge — reading is invalid |
| `gc(1)` | 10 | -0.00 MiB | scavenge — reading is invalid |
| `gc({})` | 10 | -0.00 MiB | scavenge — reading is invalid |
| `gc({type:'major'})` | 10 | 22.88 MiB | **major GC** |
| `gc({type:'minor'})` | 10 | -0.00 MiB | scavenge — reading is invalid |

## C — candidate constants, derived

Mechanical derivation only; the judgement about how much margin to buy is written up in ANALYSIS.md. `cold` is the population that matters — it is the only measurement a gate takes.

| estimator | cold n | cold min | cold max | cold p99 | ceiling @2× worst | floor @0.5× best |
|---|---:|---:|---:|---:|---:|---:|
| `min` | 400 | 3.963 | 4.501 | 4.472 | 9.0 | 2.0 |
| `median` | 400 | 3.679 | 4.500 | 4.414 | 9.0 | 1.8 |
| `trimmedMean` | 400 | 3.819 | 4.707 | 4.678 | 9.4 | 1.9 |
| `mean` | 400 | 3.591 | 4.820 | 4.798 | 9.6 | 1.8 |

A genuine O(n²) regression on a 4× workload lands near **16**, so a ceiling has to sit below that to be worth anything. The gap between the worst false alarm above and 16 is the entire usable design space for the constant.

