# Testbed Assumptions Worth Surfacing

For inclusion in the cover note to Prof. Highley accompanying the
Track B Basketball-GM testbed. These are the policy-relevant
assumptions that warrant your sign-off before we lock the
headline sweep.

Comprehensive assumption list lives in `ASSUMPTIONS.md`; the items
below are the distilled subset that materially shapes interpretation
of the resulting Pareto frontier.

---

1. **ZenGM's default COLA pool is 22 teams (14 non-playoff + 8
   first-round losers), not 14. We recover the 14-team Classic pool by
   zeroing the COLA index of R1 losers before the lottery draw, leaving
   ZenGM's source unmodified.** This means our E=14 sweep matches your
   Classic-pool definition behaviorally even though it does not touch
   `getNumLotteryTeams()`; the lottery weights are correct but the
   pool size constant inside ZenGM still reads 22. If you would prefer
   the pool size itself be patched (so the reported `numLotteryTeams`
   in any future diagnostic also reads 14), we'd swap to a per-config
   patch file — flag if so.

2. **Dial-space dimensionality is reduced to E × C × S = 48 configurations;
   Δ, ρ, W, T are held at Classic defaults.** Rationale: Δ scales the
   bound linearly (already in Theorem 1), and ρ/W/T variations require
   ZenGM-source modifications with no published-policy anchor to compare
   against. If you want the headline grid to include any of these (e.g.,
   ρ = playoff-success-linear vs. step), we should add it before locking
   the run.

3. **The lottery mechanism is real ZenGM; regular-season game outcomes
   are synthesized AND team strength persists across seasons via a
   Markov model tied to draft outcomes.** ZenGM's full game engine
   (`actions.playAmount`) requires a browser-side `createLeague()`
   invocation that is impractical to port to Node. The synthesis
   bypasses contracts/trades/injuries (none of which the dial space
   controls) but preserves the feedback loop the primary objective
   measures by evolving team strength via

       strength_{t+1} = clip(rho * strength_t + (1 - rho) * mu
                             + alpha * pick_value(pick_t) + eps_t,
                             0, 1)

   with `eps_t ~ Normal(0, sigma^2)`. Tuned parameters:
   rho=0.9 (persistence), mu=0.5 (parity mean), alpha=0.15 (per-draft
   impact), sigma=0.05 (annual shock). Initial strength
   ~ Uniform[0.3, 0.7]. The pick-value function is monotone-decreasing
   in pick number (`max(0, (16-p)/15)`): pick 1 gives a full +alpha
   boost, pick 15 gives zero, picks 16+ give zero. Parameters were
   tuned on the Classic-COLA smoke config so that the per-team CF-gap
   distribution dispersed relative to the prior i.i.d. baseline (max
   gap 22 → 28+, occasional franchises now never reach CF in 30 years
   under a single replicate). Calibration is parametric, not fit to
   historical NBA team-strength trajectories; sensitivity on (rho,
   alpha, sigma) is future work.

4. **30-year simulation horizon for the smoke; 50-year horizon for the
   headline; 50 replicates per configuration at the headline.** 30 years
   lets the bounded-30yr carry-over scope manifest. Sensitivity sweeps at
   30 and 100 replicates (4 representative configs) verify the Pareto
   frontier is not a Monte Carlo artefact. Total headline cost: 48 × 50
   = 2,400 simulated seasons, currently ~3 s per replicate at the 30-
   season horizon (one vitest subprocess per replicate; batching is a
   known optimization for the headline pass).

5. **Evidence type is forward-simulated, not historical.** This testbed
   answers "what does each dial setting look like under a synthetic but
   ZenGM-calibrated 30-team league?" — distinct from the COLA Explorer's
   backtest of NBA 1999-2025. The paper will need both: backtest for
   historical anchoring, forward-sim for the Pareto frontier across
   counterfactual dial settings.

6. **Lottery-draw nondeterminism propagates into the strength
   trajectory under the Markov model.** ZenGM's lottery draw uses an
   unseeded `Math.random` (the driver's mulberry32 only seeds the
   synthetic season/bracket sim). Under the prior i.i.d. strength
   model that nondeterminism was confined to the per-season draftPick
   field; under the Markov model in item 3, the draft pick feeds into
   next season's strength, so two single-replicate runs with identical
   mulberry32 seeds can produce materially different
   `max_years_between_conf_finals` (observed range 22-30 across five
   smoke runs of the Classic-COLA config). The headline run uses
   multiple replicates per config so this nondeterminism is absorbed
   into Monte Carlo error bars; single-replicate smoke results should
   be read as one random draw, not as a deterministic baseline.
   Dependency-injecting ZenGM's random source is tracked as a
   known-future-work item.

7. **License compliance: source-available private research use only.**
   The cloned `kvr06-ai/zengm` fork is gitignored from the public paper
   repo; no modified zengm source is pushed anywhere. Aggregate metrics
   (CSV, Pareto plots) are derivative work and publishable as scholarly
   output.

8. **The 16-tiered E dial (paper's 3-2-1 proposal pool) is approximated
   in the driver as "the 16 worst-record teams" rather than the exact
   tier composition (10 non-playoff non-play-in + 4 record-9/10 + 2 7v8
   losers).** The smoke test does not exercise this; if 16-tiered shows
   up on the frontier in the headline, refining to the exact tier
   weighting is a follow-up ticket before submission.
