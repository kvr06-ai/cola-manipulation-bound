# COLA Research Tools

Analytic bound on pool manipulation gain + interactive historical backtester for the Carry-Over Lottery Allocation (COLA) draft mechanism.

**[Launch the COLA Explorer →](https://kvr06-ai.github.io/cola-manipulation-bound/)**

---

## COLA Explorer (Interactive Backtester)

How would the NBA Draft have looked under COLA? This interactive tool lets you explore 25 years of counterfactuals (2000–2025) using real NBA data.

- **Simple COLA:** Deterministic draft order by drought length (years without a playoff series win or top-3 pick). No lottery.
- **Classic COLA:** Lottery index accumulates (+1,000/year for non-playoff teams), diminished by playoff success and high draft picks. Picks 1–4 by weighted lottery.

Features: season slider, variant comparison, team timeline, side-by-side ranking table.

Built on data from [Basketball Reference](https://www.basketball-reference.com). Mechanism by [Prof. Timothy Highley](https://highleytj.substack.com), La Salle University.

---

## Analytic Bound on Pool Manipulation

## Context

Highley, Duncan & Volkov (2026) propose [COLA](https://arxiv.org/abs/2602.02487) as a practical, incentive-compatible alternative to the NBA draft lottery. COLA sidesteps the [Munro-Banchio impossibility result](https://www.evanmunro.ca/files/targeting.pdf) (no single-season, record-based mechanism can simultaneously help weak teams and prevent tanking) by replacing end-of-season records with multi-year playoff track records.

COLA's incentive compatibility rests on five assumptions. Four are structural (playoff primacy, advancement preference, pick-range negligibility, no traded pick protections). The fifth -- **pool manipulation negligibility** -- is justified empirically via simulation rather than proven analytically.

**The loophole:** A team could deliberately lose to a high-index opponent near the playoff line, pushing them into the playoffs and shrinking the lottery pool. This increases the manipulator's win probability. The paper's 1,000-season simulation shows the maximum gain is small (average 0.5%, extreme max 3.0%), but no formal bound exists.

**This repo derives that bound.** Given realistic constraints on how large lottery indices can grow, we prove an analytic upper bound of ~4.0% on the maximum manipulation gain (confirming the paper's simulation results and converting an empirical assumption into a formal condition).

## The Bound

**Exact gain formula.** When team *i* (index L_i) benefits from a pool swap where a high-index team (L_h) is replaced by a low-index team (L_l):

```
G_i = L_i * Δ / (P * (P - Δ))
```

where Δ = L_h - L_l and P is the total lottery pool.

**First-order approximation.** When Δ << P (typically Δ/P ≈ 4%):

```
G_i ≈ p_i * (Δ / P)
```

where p_i = L_i / P is the manipulator's base win probability. The gain is the product of two independent ratios.

**Conditioned upper bound.** Under the assumption that no team misses the playoffs for more than T_max consecutive years:

```
G_max ≤ T_max * (T_boundary - 1) / ((T_max + n - 1) * n * k̄)
```

where T_boundary is the maximum consecutive misses for a team near the playoff line (high index implies weak team implies far from playoff boundary), n = 14 lottery teams, and k̄ ≈ 3.1 is the average index multiplier.

With baseline parameters (T_max = 10, T_boundary = 5, n = 14, k̄ = 3.1):

```
G_max ≤ 10 * 4 / (23 * 14 * 3.1) ≈ 4.0%
```

This contains the paper's simulation extreme (3.0%) with ~1.3x headroom.

**Derivation note.** The bound uses a pessimistic estimate of p_i (minimum possible pool, where only the manipulator has a long drought) and the average Δ/P (from the paper's steady-state pool). These two worst cases don't co-occur: high p_i requires a small pool (few long-drought teams), while high Δ requires a high-index team near the boundary (implying multiple long-drought teams, hence a larger pool). The structural anti-correlation between these factors is what makes the bound tight.

## Quick Start

```bash
pip install -e .
python -m cola              # full analysis: bound + simulation + plots
python -m cola --no-sim     # analytic bound only (instant)
python -m cola --seasons 500 --seed 123  # custom simulation
```

## Outputs

Running `python -m cola` produces four figures in `figures/`:

| Figure | Description |
|--------|-------------|
| `gain_vs_delta.pdf` | Gain curves for varying base probabilities, with bound and paper reference lines |
| `bound_sensitivity.pdf` | Heatmap of G_max over (T_max, T_boundary) parameter space |
| `simulation_histogram.pdf` | Distribution of simulated per-season max gains with bound overlay |
| `bound_vs_sim.pdf` | Time series of per-season gains vs. analytic bound |

Plus a summary table printed to stdout.

## Structure

```
cola/                    # Analytic bound (Python)
├── constants.py         # All NBA/COLA parameters (single source of truth)
├── bound.py             # Core: exact gain, first-order approx, conditioned bound
├── simulate.py          # Thin Bradley-Terry simulation + COLA mechanism
├── plots.py             # Publication-quality figures
└── __main__.py          # Entry point

scripts/                 # Data pipeline
└── collect_data.py      # Compiles NBA data 1999-2025 → web/data/nba-data.json

web/                     # Interactive backtester (GitHub Pages)
├── index.html           # Single-page app
├── js/cola-engine.js    # Simple + Classic COLA state machines
├── js/charts.js         # Chart.js wrappers
├── js/app.js            # UI state management
├── data/nba-data.json   # 26 seasons, 775 team-season records
└── css/                 # Dark theme
```

## Usage as a Library

```python
from cola import manipulation_gain, manipulation_bound, run_simulation

# Compute gain for a specific scenario
gain = manipulation_gain(L_i=6000, L_h=5000, L_l=1000, P=43000)

# Evaluate the bound under different assumptions
bound = manipulation_bound(T_max=8, T_boundary=3)

# Run simulation
results = run_simulation(n_seasons=300)
print(f"Max gain observed: {results['max']*100:.2f}%")
```

## References

1. Highley, T., Duncan, T., & Volkov, I. (2026). *Carry-Over Lottery Allocation: Practical Incentive-Compatible Drafts.* [arXiv:2602.02487](https://arxiv.org/abs/2602.02487).
2. Munro, E. & Banchio, M. (2020). *A No-Tanking Draft Allocation Policy.* MIT Sloan Sports Analytics Conference. [PDF](https://www.evanmunro.ca/files/targeting.pdf).
3. Highley, T. (2026). *Proof the NBA Draft Trade-Off Is Solved.* [YouTube](https://www.youtube.com/watch?v=p4mmmGGxBbw). Formal proof of Diet COLA incentive compatibility.
4. Highley, T. (2026). *NBA Tanking Is Solvable* series. [Substack](https://highleytj.substack.com). Parts [1](https://highleytj.substack.com/p/nba-tanking-is-solvable-heres-why), [2](https://highleytj.substack.com/p/nba-tanking-is-solvable-key-insights), [3](https://highleytj.substack.com/p/nba-tanking-is-solvable-four-candidates).

## License

MIT
