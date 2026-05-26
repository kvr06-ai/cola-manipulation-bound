# Headline Frontier Plot Captions

Run: `runs/headline_20260526_132248/` (48 configs × 50 replicates × 30 seasons,
seeds 1000–1049; full sweep wall time 219 s on M-series hardware via batched
vitest invocation).

All plots use **per-config medians** across 50 replicates (more robust to
extreme-value outliers in max-gap statistics than means). Error bars on the
two scatter PDFs are std-dev of the simulated max-yrs-CF objective across the
50 replicates of that config.

## pareto_primary_vs_manipulation.pdf

Scatter: `max_years_between_conf_finals` median (Y-axis) vs.
`manipulation_gain_pct` median (X-axis), both lower-better. Pareto-optimal
points use the **3-objective universal dominance** rule (primary, manipulation
gain, rank-1-to-5 spread); per-series cost is *not* used for dominance because
it is N/A for uncapped configs.

**Caveat — the X-axis spans two analytical regimes.** Configs with C=null
(uncapped) sit at Δp·100 ≈ 4/|E|·100: 28.6% for E=14, 18.2% for E=22, 25.0%
for the 16-tiered pool. Capped configs collapse to a tight band at Δp·100 ≈
0.3/|E|·100: 2.14% (E=14), 1.36% (E=22), 1.88% (16-tiered) — the cap value C
**cancels analytically** (Lemma 2 worst-case pool C·|E|). This is the
empirical confirmation of the "cap-cancels" result: across C ∈ {100, 150, 200},
the manipulation bound is invariant to C within a given E.

## pareto_primary_vs_rankspread.pdf

Scatter: `max_years_between_conf_finals` median (Y, lower-better) vs.
`rank_one_to_five_spread` median (X, higher-better = stronger anti-tanking).
Same Pareto/variant annotation scheme.

**Caveat — rank-spread is not a monotonic anti-tanking proxy.** It measures
the gap between the worst team's expected pick and the 5th-worst team's
expected pick under the lottery; a higher spread means tanking the worst team
yields LESS marginal pick-position advantage versus tanking to 5th-worst.
Pareto-optimal configs cluster at moderate spreads (2.4–2.9) rather than at
the extreme right, because extreme rank-spread implies very heavy
worst-vs-rest weighting that may sacrifice primary parity.

## pareto_parallel_coordinates.pdf

All four objectives, per-axis min-max normalized. Pareto-optimal lines are
colored (orange=uncapped Pareto, cyan=capped Pareto); dominated lines are
gray. Named variants (Status quo, Classic, Simple, Capped@150, 3-2-1) are
overlaid in distinct colors.

**Caveat — per-series-cost axis has missing values.** Uncapped configs (24 of
48) have no per-series-cost ceiling (Lemma 2 is vacuous when there is no cap),
so their parallel-coordinates line *skips* that column; the line breaks
either side of the cost axis and an X marker is drawn at the bottom of the
plot to flag the gap. **Treat per-series-cost as a disclosure column, not a
dominance dimension.**
