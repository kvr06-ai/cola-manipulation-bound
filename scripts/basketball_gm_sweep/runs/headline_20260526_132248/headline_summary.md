# COLA Headline Sweep — 48 configs × 50 replicates × 30 seasons

**Run timestamp:** 2026-05-26 18:52 UTC (run dir `runs/headline_20260526_132248/`)
**Configs:** 48 (E × C × S = 3 × 4 × 4)
**Replicates per config:** 50 (seeds 1000–1049, deterministic via overridden `Math.random`)
**Simulated seasons per replicate:** 30
**Engine:** real ZenGM (`zengm-fork/src/worker/core/draft/colaSweepDriver.test.ts`) via batched vitest invocation
**Wall time:** 219 s (≈ 4.56 s per config; ≈ 0.09 s per replicate amortised — batching saves ~7× vs. unbatched)
**Failures:** 0 — all 2,400 (config, replicate) rows produced non-NaN objectives

## Files

| File | Role |
|---|---|
| `headline.csv` | 2,400 rows (one per `(config_id, replicate_id)` pair) |
| `headline_summary.csv` | 48 rows (per-config mean / median / std for each objective) |
| `pareto_summary.txt` | Machine-readable Pareto-optimal set + named-variant map |
| `sensitivity_30.csv`  | Pass A: subset × 30 reps (slice of headline, seeds 1000–1029) |
| `sensitivity_100.csv` | Pass B: subset × 100 reps (headline 50 reps + new seeds 1050–1099) |
| `sensitivity_30_summary.csv`, `sensitivity_100_summary.csv` | Aggregated stats |
| `stability_report.md` | Cross-N stability analysis + Pareto-borderline flags |
| `analyze.py`, `sensitivity_analyze.py` | Reproducers |
| `../../figures/pareto_primary_vs_manipulation.pdf` | Scatter max-yrs-CF (Y) vs. manipulation_gain_pct (X) |
| `../../figures/pareto_primary_vs_rankspread.pdf` | Scatter max-yrs-CF (Y) vs. rank-1-to-5 spread (X) |
| `../../figures/pareto_parallel_coordinates.pdf` | Parallel-coordinates plot, 4 normalized objectives |
| `../../figures/CAPTIONS.md` | Caveat notes for each PDF |

## Pareto-optimal configs (n = 5 of 48)

3-objective universal dominance: max-yrs-CF (LOWER), manipulation_gain_pct (LOWER), rank-1-to-5 spread (HIGHER). Per-config summary = MEDIAN across 50 replicates.

| cid | E | C | S | max-yrs-CF (med ± std) | manip Δp·100 [%] | per-series cost | rank-spread (med) |
|---:|---|---:|---|---|---:|---:|---:|
| 11 | 14 | 150 | reset-on-championship | 27.0 ± 2.71 | 2.143 | 30.0 | 2.433 |
| 19 | 22 | uncapped | reset-on-championship | 26.0 ± 3.31 | 18.182 | n/a | 2.650 |
| 26 | 22 | 150 | bounded-30yr | 28.0 ± 2.57 | 1.364 | 30.0 | 2.867 |
| 31 | 22 | 200 | reset-on-championship | 27.5 ± 2.76 | 1.364 | 40.0 | 2.667 |
| 45 | 16-tiered | 200 | unbounded | 27.5 ± 2.96 | 1.875 | 40.0 | 2.700 |

**Key observations:**

1. **Capped@150 (cfg 26) is on the headline Pareto frontier.** Status quo, Classic, Simple, and 3-2-1 are all dominated. Under unified manipulation units, Capped@150's 13.7× lower manipulation bound (1.36% vs. 18.2% for Simple at the same E=22, or vs. 28.6% for Classic) is no longer "incomparable" — it is a direct, in-the-same-units improvement that no uncapped variant can recover.

2. **Cap value C cancels in the analytical bound — and the sweep confirms it.** Among capped configs at E=22, configs 26 (C=150) and 31 (C=200) both have manipulation_gain_pct = 1.364%. Among E=14 capped, all have 2.143%. The empirical CSV verifies this is constant across C ∈ {100, 150, 200} within each E.

3. **`reset-on-championship` carry-over is the modal winning scope.** 3 of 5 Pareto configs use S=reset-on-championship (cfg 11, 19, 31); 1 uses bounded-30yr (cfg 26, the Capped@150 named variant); 1 uses unbounded (cfg 45). `single-season` does NOT appear on the Pareto frontier — this overturns the sketch result where 3-2-1's single-season scope looked competitive. The headline shows reset-on-championship — event-based memory wipe on the rare-but-meaningful championship trigger — is the dominant carry-over rule.

4. **E=22 dominates the frontier.** 3 of 5 Pareto configs use the 22-team pool (configs 19, 26, 31); 1 uses E=14 (cfg 11, only the C=150 capped variant); 1 uses 16-tiered (cfg 45). The 22-team pool gives both more parity (lower max-yrs-CF) and a structurally lower manipulation bound (Δp ≤ 4/22 = 18.2% uncapped, or 0.3/22 = 1.36% capped).

5. **Status quo NBA lottery (cfg 0) is strictly dominated.** Median max-yrs-CF = 28.50 (worse than every Pareto config), manipulation_gain_pct = 28.57% (worse than every Pareto config), rank-spread = 2.77 (only marginally better than some). Under unified units, the "Status quo is at least manipulation-resistant" hedge does not survive.

## Sensitivity (N=30 ⇄ N=50 ⇄ N=100, subset of 9 configs)

- **Stability:** No config shifted mean(max-yrs-CF) by more than 10% from N=30 → N=100. The headline N=50 is well-calibrated.
- **Pareto-borderline:** Several subset configs flip Pareto membership between N=30/50/100 — but the Pareto recomputation at N=30 and N=100 is restricted to the SUBSET (not the full 48-config grid), so this reflects within-subset re-ordering, not full-grid instability. The headline N=50 Pareto set [11, 19, 26, 31, 45] is the canonical answer.
- See `stability_report.md` for the full table.
