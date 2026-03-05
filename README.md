# cola-manipulation-bound

Analytic upper bound on pool manipulation gain in the Carry-Over Lottery Allocation (COLA) draft mechanism.

## Context

Highley, Duncan & Volkov (2026) propose [COLA](https://arxiv.org/abs/2602.02487) as a practical, incentive-compatible alternative to the NBA draft lottery. COLA sidesteps the [Munro-Banchio impossibility result](https://www.evanmunro.ca/files/targeting.pdf) (no single-season, record-based mechanism can simultaneously help weak teams and prevent tanking) by replacing end-of-season records with multi-year playoff track records.

COLA's incentive compatibility rests on five assumptions. Four are structural (playoff primacy, advancement preference, pick-range negligibility, no traded pick protections). The fifth -- **pool manipulation negligibility** -- is justified empirically via simulation rather than proven analytically.

**The loophole:** A team could deliberately lose to a high-index opponent near the playoff line, pushing them into the playoffs and shrinking the lottery pool. This increases the manipulator's win probability. The paper's 1,000-season simulation shows the maximum gain is small (average 0.5%, extreme max 3.0%), but no formal bound exists.

**This repo derives that bound.** Given realistic constraints on how large lottery indices can grow, we prove an analytic upper bound of ~3.0% on the maximum manipulation gain -- confirming the paper's simulation results and converting an empirical assumption into a formal condition.

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

where T_boundary is the maximum consecutive misses for a team near the playoff line (structural anti-correlation: high index ⇒ weak team ⇒ far from playoff boundary), n = 14 lottery teams, and k̄ ≈ 3.1 is the average index multiplier.

With baseline parameters (T_max = 10, T_boundary = 4, n = 14, k̄ = 3.1):

```
G_max ≤ 10 * 3 / (23 * 14 * 3.1) ≈ 3.0%
```

This matches the paper's simulation extreme (3.0%) almost exactly — a tight bound.

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
cola/
├── constants.py   # All NBA/COLA parameters (single source of truth)
├── bound.py       # Core: exact gain, first-order approx, conditioned bound
├── simulate.py    # Thin Bradley-Terry simulation + COLA mechanism
├── plots.py       # Publication-quality figures
└── __main__.py    # Entry point
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

## License

MIT
