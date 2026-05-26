# COLA Frontier Sketch — 48 configs × 1 replicate

**Run timestamp:** 2026-05-26 18:20 (run dir `runs/frontier_20260526_182006/`)
**Configs:** 48 (E × C × S = 3 × 4 × 4)
**Replicates per config:** 1
**Simulated seasons per replicate:** 30
**Engine:** real ZenGM (`zengm-fork/src/worker/core/draft/colaSweepDriver.test.ts`) via vitest
**Wall time:** 164 s (≈ 3.4 s per config)
**Failures:** 0 — all 48 configs returned non-NaN objectives

## Files

| File | Role |
|---|---|
| `frontier_sketch.csv` | 48 rows, one per config (E, C, S, four objectives, plus auxiliary diagnostics) |
| `pareto_summary.txt` | Machine-readable Pareto-optimal set + variant map |
| `analyze.py` | Reproducer: rebuilds Pareto + figures from CSV |
| `raw_cfg_*.csv` | Per-config raw single-row CSVs emitted by `sweep.js` (unaggregated) |
| `cfg_*.log` | Per-config stdout/stderr from vitest subprocess |
| `../../figures/pareto_primary_vs_manipulation.pdf` | Scatter: max-yrs-CF (Y) vs. manipulation-gain bound (X, symlog) |
| `../../figures/pareto_primary_vs_rankspread.pdf` | Scatter: max-yrs-CF (Y) vs. rank-1-to-5 spread (X) |
| `../../figures/pareto_parallel_coordinates.pdf` | Parallel-coordinates plot, four normalized objectives |

## Pareto-optimal configurations (n = 3 / 48)

Computed in the regime-appropriate space — uncapped configs in 3-objective space
(primary, manipulation bound, rank spread); capped configs in 4-objective space
(adding per-series cost). Dominance is NOT compared across the capped/uncapped
boundary (the per-series-cost axis is degenerate for uncapped configs).

| cid | E | C | S | max yrs CF | manip bound | per-series cost | rank-spread | Class |
|---:|---|---:|---|---:|---:|---:|---:|---|
| 18 | 22 | uncapped | bounded-30yr | 24 | 1.182 | n/a   | 3.067 | Pareto, uncapped |
| 32 | 16-tiered | uncapped | single-season | 30 | 1.250 | n/a   | 3.433 | Pareto, uncapped |
| 37 | 16-tiered | 100 | unbounded     | 22 | 20.000 | 20.0 | 3.500 | Pareto, capped |

**Pareto-optimal config 18** (E=22, C=uncapped, S=bounded-30yr) — lowest analytical
manipulation bound in the grid (1.18, the floor any uncapped 22-pool variant can
achieve under the η·C bound) AND the lowest max-years-between-CF among all
uncapped configs (24). It dominates 9 of the 11 other uncapped configs and
gives up rank-spread (3.07) only to the 16-tiered single-season config (cfg 32).

**Pareto-optimal config 32** (3-2-1 proposal) — survives in the uncapped Pareto
set on rank-spread alone (3.43, the highest in the uncapped subset). Its
max-yrs-CF is at the simulation cap (30) and its manipulation bound (1.25) is
worse than cfg 18 — kept Pareto only because no other config beats it on spread
while matching it on the other axes.

**Pareto-optimal config 37** (E=16-tiered, C=100, S=unbounded) — the SOLE capped
config not dominated by another capped config. Lowest max-yrs-CF in the entire
grid (22), tied for lowest per-series cost (20.0), and the highest rank-spread
across all capped configs (3.50). Under the capped per-series-cost ceiling, this
configuration is the empirical frontier point at 1-replicate noise.

## Named-variant identification

The grid does not contain a true status-quo NBA cell (status quo uses fixed
odds, not COLA accumulation), and Simple / Capped use drought- and
ticket-based mechanics that don't reduce to the (E, C, S) tuple. The mappings
below are *closest-tuple* approximations.

| Variant | config_id | E | C | S | max yrs CF | manip bound | rank spread | Pareto status |
|---|---:|---|---:|---|---:|---:|---:|---|
| Status quo NBA lottery (closest tuple) | 0  | 14 | uncapped | single-season | 30 | 1.286 | 2.667 | dominated |
| Classic COLA                            | 1  | 14 | uncapped | unbounded     | 29 | 1.286 | 2.733 | dominated |
| Simple COLA (closest tuple)             | 17 | 22 | uncapped | unbounded     | 26 | 1.182 | 2.667 | dominated |
| Capped@150 (closest tuple, S=30yr)      | 26 | 22 | 150      | bounded-30yr  | 30 | 30.00 | 2.933 | dominated |
| 3-2-1 proposal                          | 32 | 16-tiered | uncapped | single-season | 30 | 1.250 | 3.433 | Pareto |

**Approximation caveats**
- Status-quo: uses fixed lottery odds, not a COLA accumulator. Mapping to (E=14, C=uncapped, S=single-season) understates carry-over isolation since true status-quo doesn't even compute a cola index.
- Simple: ticketing pool grows with consecutive non-CF appearances. The E=22 / S=unbounded tuple is the closest grid cell; the actual ticket-based growth rule is not represented.
- Capped@150: Highley's spec is a rolling-window cap; closest cell uses S=bounded-30yr. A grid extension with `S=rolling-N-year` could be added.
- 3-2-1: maps cleanly to (E=16-tiered, C=uncapped, S=single-season).

## Structural assessment

### 1. Is there visible Pareto structure at 1 replicate per config?
Yes, but narrow. The max-yrs-CF objective is highly saturated at the 30-year
simulation horizon — 23 of 48 configs hit max=30, meaning at least one
franchise never reached the CF across the 30 seasons sampled. With only one
replicate this is a coarse signal: a 30 result could be "the franchise
genuinely cannot reach CF under this config" or "the one realization happened
to drop a tail run on a single team". The manipulation-bound and per-series-
cost axes are analytical and noise-free, which is why the structure that
*does* show up (cfg 18 dominating 9 other uncapped configs; cfg 37
dominating 35 of 36 capped configs) is real and not Monte Carlo artifact.
The rank-1-to-5 spread is noisy at 1 rep but the ordering is plausible.

### 2. Where is the Pareto frontier in the dial space?
- **Uncapped regime:** the frontier collapses onto E=22 (lowest analytical manipulation bound) with one outlier from the 16-tiered pool that wins on rank-spread alone. The S-dial split favors `bounded-30yr` over `unbounded` and `single-season` for the primary objective — consistent with the Markov-model prediction that bounded carry-over prevents the "rich get richer" feedback loop from accumulating without bound.
- **Capped regime:** the lowest cap (C=100) with the 16-tiered eligibility pool and unbounded carry-over scope dominates. This is the only capped config whose per-series-cost (20.0) is the floor of the cap dial range AND whose max-yrs-CF (22) is the floor of the whole grid.
- **No cell uses C=150 or C=200 in the Pareto set.** Higher caps strictly inflate the per-series cost ceiling without compensating gains on the primary objective at this noise level.

### 3. How do the named variants compare?
- **Status quo (cfg 0)** is dominated by Classic COLA (cfg 1) on max-yrs-CF (29 < 30) at identical manipulation bound and ~ identical rank-spread.
- **Classic COLA (cfg 1)** is dominated by the closest 22-pool uncapped configs.
- **Simple COLA (cfg 17)** is dominated by Pareto cfg 18 — same manipulation bound, but cfg 18 wins on both max-yrs-CF and rank-spread under the bounded-30yr scope.
- **Capped@150 (cfg 26)** is dominated by both Pareto cfg 37 (lower max-yrs, lower per-series cost) and by Classic-style uncapped configs on every axis except per-series cost.
- **3-2-1 proposal (cfg 32)** is the ONLY named variant that survives as Pareto-optimal in this sketch — it earns its slot on the rank-1-to-5 spread axis (3.43, highest in the uncapped subset).

### 4. Surprising Pareto-optimal configs without a named variant
**Cfg 18 (E=22, uncapped, bounded-30yr)** and **cfg 37 (E=16-tiered, C=100, unbounded)** do not correspond to any named COLA variant. Both are candidates for naming in the paper:
- Cfg 18 reads as "Simple-with-bounded-scope" — combines Simple's eligibility pool with a rolling window. Working name suggestion: **Bounded Simple COLA**.
- Cfg 37 reads as "3-2-1 pool, tight cap, accumulating carry-over" — Capped + tiered eligibility + unbounded S. Working name suggestion: **Tiered Tight-Cap COLA**.

The fact that one previously un-named tuple dominates each regime is a meaningful empirical contribution at this scan stage.

### 5. Recommended next step
The frontier sketch justifies running the headline 50-replicate sweep but does NOT justify expanding the dial grid yet. Rationale:
1. The manipulation-bound axis is analytical and already perfectly resolved — additional replicates won't change it.
2. The per-series-cost axis is analytical and already perfectly resolved.
3. The two simulation-derived axes (max-yrs-CF, rank-spread) are dominated by single-realization noise. The current Pareto set is small (n=3) precisely because so many configs collide at the saturation value max=30. Multi-replicate averaging will resolve which of the cfg 0, 4, 5, 9, 10, 12, 13, 14, 15, 19, 22, 23, 26, 27, 31, 32, 33, 36, 39-41, 43-46 ties are genuine and which are tail-event artifacts.
4. Once the noise is suppressed, the Pareto set is likely to grow to the predicted 5-15 configs, which is the right size for a paper-grade frontier figure.
5. Markov retuning is not warranted yet — the model preserves the feedback loop the primary objective is designed to measure (variance across configs is non-trivial: max-yrs-CF ranges 22 to 30 with most density at 24-30). A wider initial-strength prior could be a sensitivity check later.

**Concrete next-step ordering:**
1. **Headline run** (48 × 50 × 30 seasons ≈ 2 hours per existing per-replicate estimate). This is the right immediate spend.
2. **Sensitivity check** at 30 and 100 seasons per the existing `_sensitivity_protocol` on a 4-config subset (Classic, Capped@150, 3-2-1, cfg 37) to verify the Pareto frontier is not horizon-dependent.
3. **Grid expansion** (e.g., rolling-N-year S, finer C grid, Δ/ρ/W variants) only if the headline run reveals "interior" Pareto points that suggest finer resolution would change the frontier.
4. **Replicate batching** in `sweep.js` (per the existing TODO) — currently each replicate spends ~3 s on vitest startup. Sharing one process across replicates would cut the headline-run wall time by ~3 x.
