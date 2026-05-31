# Stability Report — Headline Sweep Sensitivity

**Headline:** 48 configs × 50 replicates × 30 simulated seasons (seeds 1000–1049).
**Sensitivity Pass A:** 30 replicates (seeds 1000–1029).
**Sensitivity Pass B:** 100 replicates (seeds 1000–1099).
**Subset:** Pareto-optimal configs from headline ∪ 5 named variants (deduplicated).

## Headline Pareto-optimal set (3-obj universal, median; n=5)

Config IDs: 11, 19, 26, 31, 45

## Per-config primary-objective stability across N

Reports MEDIAN of `max_years_between_conf_finals` and STD across replicates at each N. A material shift is flagged when |mean(N=100) − mean(N=30)| / |mean(N=30)| > 10%.

### Pareto-optimal configs (headline)
| config_id | E | C | S | N=30 med ± std | N=50 med ± std | N=100 med ± std |
|---:|---|---:|---|---|---|---|
| 11 | 14 | 150 | reset-on-championship | 27.50 ± 2.60 | 27.00 ± 2.71 | 28.50 ± 2.85 |
| 19 | 22 | null | reset-on-championship | 26.00 ± 3.31 | 26.00 ± 3.31 | 27.00 ± 3.10 |
| 31 | 22 | 200 | reset-on-championship | 28.50 ± 2.39 | 27.50 ± 2.76 | 27.00 ± 2.69 |
| 45 | 16-tiered | 200 | unbounded | 28.00 ± 2.35 | 27.50 ± 2.96 | 28.00 ± 3.25 |

### Named variants
| config_id | E | C | S | N=30 med ± std | N=50 med ± std | N=100 med ± std |
|---:|---|---:|---|---|---|---|
| 0 | 14 | null | single-season | 29.50 ± 3.30 | 28.50 ± 3.12 | 29.00 ± 3.03 |
| 1 | 14 | null | unbounded | 29.00 ± 3.20 | 27.50 ± 2.99 | 28.00 ± 2.79 |
| 17 | 22 | null | unbounded | 29.00 ± 2.80 | 29.00 ± 2.89 | 29.00 ± 2.91 |
| 26 | 22 | 150 | bounded-30yr | 28.00 ± 2.58 | 28.00 ± 2.57 | 28.00 ± 2.67 |
| 32 | 16-tiered | null | single-season | 28.00 ± 2.13 | 28.00 ± 2.40 | 28.00 ± 2.79 |

## Pareto recomputed at each replicate count (restricted to sensitivity subset)

- N=30  Pareto set : [0, 11, 19, 26, 45]
- N=50  Pareto set : [11, 19, 26, 31, 45] (subset slice of headline Pareto)
- N=100 Pareto set : [31]

NB: Pareto sets at N=30 and N=100 are computed within the SUBSET only (not against all 48 configs), so direct membership comparison to headline is meaningful only for configs that are in the subset.

## Flags

### Unstable at headline N (>10% mean shift from N=30 → N=100)

_None._ All sensitivity-subset configs have ≤10% relative drift in mean(max_yrs_CF) between N=30 and N=100.

### Pareto-borderline (Pareto-membership flips between N=30 / 50 / 100)

| config_id | In Pareto N=30 | In Pareto N=50 (headline) | In Pareto N=100 |
|---:|:---:|:---:|:---:|
| 0 | ✓ | — | — |
| 11 | ✓ | ✓ | — |
| 19 | ✓ | ✓ | — |
| 26 | ✓ | ✓ | — |
| 31 | — | ✓ | ✓ |
| 45 | ✓ | ✓ | — |

## Caveat

- `manipulation_gain_pct` is a closed-form analytical function of `E` and `C` (no Monte Carlo), so its median is identical across N. Stability flags use the simulated objective only.
- Pareto recomputation at N=30 / N=100 uses the SUBSET configs as the candidate pool. Membership flips reflect within-subset re-ordering, not full-grid re-ordering.
