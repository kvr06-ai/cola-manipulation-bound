# Testbed Assumptions (Comprehensive)

Date: 2026-05-26.
Companion to `sweep.js`, `colaSweepDriver.test.ts`, `objectives.js`,
`dial_grid.json`, `DIAL_MAPPING.md`.

This file enumerates every assumption baked into the Track B testbed. Each
item: the assumption, the reason, the source file/line where it lives, and
any deviation from Highley's published spec.

The distilled, policy-relevant subset is in `ASSUMPTIONS_FOR_HIGHLEY.md` —
this file is the exhaustive reference for internal review.

---

## 1. ZenGM Engine Assumptions

**Z-1. Lottery-pool default is 22 teams, not 14.**
ZenGM's `getNumLotteryTeams()` (zengm-fork/src/worker/core/draft/cola.ts:15-28)
returns `numActiveTeams - 8` for a 4-round playoff bracket — i.e. all teams
that did not win at least one round are eligible. For a 30-team league this
is 22 teams (14 non-playoff + 8 first-round losers), matching the paper's
**Simple/Capped** pool, not **Classic's 14**. To recover the 14-team Classic
pool we apply an eligibility mask in the driver (`applyEligibilityMask` in
colaSweepDriver.test.ts:194) that zeros the COLA index of R1-loser teams
before the lottery draw, making them effectively ineligible while leaving
ZenGM's source untouched.

**Z-2. Team-strength model is a persistent Markov process tied to draft outcomes.**
We do not run ZenGM's full game-by-game simulation in the Node driver (that
requires a browser-side `createLeague()` invocation; see Z-3). Instead, we
synthesize per-season win records from a per-team strength variable that
persists across seasons (`simulateSeasonOutcomes` +
`transitionStrength` in colaSweepDriver.test.ts). The transition is

    strength_{t+1} = clip(rho * strength_t + (1 - rho) * mu
                          + alpha * pick_value(draft_pick_t)
                          + eps_t,
                          0, 1)

with `eps_t ~ Normal(0, sigma^2)`. Pick value is monotone-decreasing in
pick number, `pick_value(p) = max(0, (16 - p) / 15)` (pick 1 contributes
full alpha, pick 15 contributes zero, picks 16+ contribute zero). Tuned
parameters: rho=0.9 (persistence), mu=0.5 (parity mean), alpha=0.15
(per-draft impact), sigma=0.05 (annual shock). Initial strength
~ Uniform[0.3, 0.7]. Strength is converted to wins around a mean of 41
with a ±18-win tilt; bracket outcomes are sampled with
`P(A beats B) = strength_A / (strength_A + strength_B)`.

Rationale: the prior i.i.d. Uniform[0.2, 0.6] refresh broke the feedback
loop the primary objective (max years between conference finals) is
designed to measure. With i.i.d. refresh, every franchise reaches the CF
across a 30-season horizon by chance, and the per-team CF-count
distribution is tight. The Markov model restores the link between draft
outcomes and subsequent team quality, which is the mechanism COLA is
designed to manage. Calibration philosophy: parameters chosen for
plausibility, not exact NBA-data fit. Documented limitations in L-Z2 below.

The model still omits ZenGM's contracts/trades/injuries, which the paper's
dial space does not control.

**Z-3. Regular-season game simulation is bypassed.**
ZenGM's `actions.playAmount('untilDraft')` requires a fully constructed
league (players, contracts, schedule, salary cap state), which the worker
builds via `createLeague()` — a browser-coupled path involving leagueFile
upload streams (zengm-fork/src/worker/api/index.ts:545+). In Node with
`fake-indexeddb`, the upload-stream API is not viable without porting
substantial browser globals. We accept the cost: the paper's dial space
controls the lottery mechanism, not the game engine, so this is the right
trade.

**Z-4. Playoff bracket: single-elimination, 8-team-per-conference NBA-style.**
We hardcode the bracket structure (1v8, 2v7, 3v6, 4v5 reseeded to single-
elim) in `simulateSeasonOutcomes` (colaSweepDriver.test.ts:121). This
matches the default ZenGM `numGamesPlayoffSeries: [7,7,7,7]` shape, and
the paper's `ρ = playoff-success-step` increment pattern. No play-in
tournament is simulated (the 16-tiered E dial is supported but not
exercised in the smoke run).

**Z-5. Default lottery weighting (W=uniform) and tiebreak (T=coin-flip)
are baked into ZenGM's cola.ts.**
We do not vary W or T in the 48-config grid. `genOrder.ts` (line 244-264)
computes lottery chances as `t.cola + addAlpha` per team and
`divideChancesOverTiedTeams` is bypassed for `draftType === "cola"`. Top-4
diminishment factors `DRAFT_LOTTERY_FACTORS = [0, 0.25, 0.5, 0.75]` and
playoff factors `PLAYOFF_FACTORS = [0.75, 0.5, 0.25, 0]` are file-local
constants in cola.ts; varying them would require source modification.

**Z-6. Champion's cola is fully reset (not just decremented).**
`PLAYOFF_FACTORS[champion_index]` indexes out of bounds (length 4, indices
0..3 for `playoffRoundsWon - offset` ∈ {0,1,2,3} → champion at index 4
returns `undefined`, falling into the increment branch). Actually wait —
cola.ts:79-84 shows champion → `factor === undefined` → goes into the
ADD-ALPHA branch. Reading more carefully: champion = `playoffRoundsWon =
numPlayoffRounds = 4`. `offset = 4 - 4 + 1 = 1`. So index = `4 - 1 = 3` →
`factor = 0` → `cola *= 0`. **The champion's cola is reset to 0.** Match
to paper's ρ_champion = 1.0 (full diminishment).

**Z-7. Top-4 lottery winners receive ZenGM-specified diminishment.**
DRAFT_LOTTERY_FACTORS = [0, 0.25, 0.5, 0.75]: 1st pick → cola *= 0,
2nd → *= 0.25, 3rd → *= 0.5, 4th → *= 0.75. Matches paper's draft-cliff
schedule.

**Z-8. League size: 30 teams.**
`bootstrapLeague` (colaSweepDriver.test.ts:225) uses
`helpers.getTeamsDefault().slice(0, 30)`. The first 30 are the ZenGM
canonical NBA team set (Atlanta first; standard conferences/divisions).
Modifying league size would change the lottery pool size (E) coupling.

**Z-9. Conference alignment: 2 conferences of 15 teams each.**
Inherited from ZenGM's default `teamsDefault`. `cid` 0 = East, 1 = West.
Bracket is per-conference (8 playoff teams per conference, conference
winner emerges).

**Z-10. Salary cap and free agency: bypassed.**
The driver does not advance the post-draft phases (free agency, contract
negotiation). Per-team `budget`/`expenses`/`revenues` are stubbed to
empty objects in `appendTeamSeasons`. This is safe: the lottery + COLA
update logic does not depend on these.

**Z-11. Draft class generation: bypassed.**
`draft.genOrder(mock=true)` returns draft-pick order but does not generate
players. The mock flag prevents `idb.cache.draftPicks.add` from persisting
results. We capture pick→tid mapping from the returned `draftPicks` array.

**Z-12. Trade engine: not simulated.**
No mid-season trades. `draftPicksIndexed[t.tid]?.[1]?.tid` check in
genOrder.ts:251 always returns `t.tid` (no traded picks).

**Z-13. ZenGM-version pin.**
The fork is `kvr06-ai/zengm@master` at the commit cloned 2026-05-26
(zengm 5.1.0 per package.json). Changes upstream to cola.ts /
genOrder.ts after this date would require re-validating Z-1..Z-12.

---

## 2. License Compliance Assumptions

**L-1. ZenGM license permits private headless research use.**
zengm-fork/LICENSE.md is a custom source-available license, not GPL/MIT.
The license permits running locally and editing for personal/research
use. We are NOT publishing the modified fork, hosting a playable
instance, or distributing installers. The patches we generate
(see DA-7) live only in the local clone.

**L-2. The fork remains private and gitignored.**
`scripts/basketball_gm_sweep/zengm-fork/` is `.gitignore`'d in the
`cola-manipulation-bound` repo. No ZenGM source is committed to public
git. We do not push to the `kvr06-ai/zengm` GitHub fork; that fork
remains an unmodified mirror.

**L-3. Aggregate research outputs are derivative work, not redistribution.**
The CSV outputs in `runs/` are objective metrics — counts, gaps, expected
picks — derived from simulation. They contain no zengm source, player
names, or proprietary fixtures. Publishing the CSVs and resulting Pareto
plots in the paper is permitted as scholarly use.

**Violation conditions (what we are NOT doing):**
- Hosting a playable web-deployed version of the modified zengm.
- Distributing installers, binaries, or playable forks publicly.
- Pushing modified zengm source to a public git remote.
- Including zengm fixtures (players, leagues) in our paper repo.

---

## 3. Dial-Grid Assumptions

**D-1. Dimensionality reduction: E × C × S = 3 × 4 × 4 = 48 configurations.**
Δ, ρ, W, T are held fixed at Classic defaults (`dial_grid.json:21-26`).
Rationale: paper §3.1.2 names E, C, S as the dials with the most
contested policy intuitions; Δ scales linearly (already established in
Theorem 1), and ρ/W/T variations require source rewrites with no
public-discourse anchor to compare against. Cross-dial sweeps (e.g.,
Δ × C interactions) are NOT explored in this grid.

**D-2. E dial values: {14, 22, "16-tiered"}.**
14 = paper's Classic. 22 = ZenGM default (= paper's Simple/Capped). 
16-tiered = paper's 3-2-1 proposal pool (10 non-playoff non-play-in + 4
record-9/10 + 2 7v8 losers). Values 15..21 are not swept — we anchor on
the policy-relevant cardinalities and trust the bound's monotone-in-E
shape (Theorem 1) for interpolation.

**D-3. C dial values: {null, 100, 150, 200}.**
null = no cap (Classic). 100 = stricter than Capped default. 150 = Capped
COLA default per Highley Substack. 200 = looser cap.

**D-4. S dial values: {single-season, unbounded, bounded-30yr,
reset-on-championship}.**
single-season = no cross-year memory (3-2-1 baseline pattern).
unbounded = Classic multi-year accumulation. bounded-30yr = sliding
30-year window. reset-on-championship = clear on title (event-based).

**D-5. Δ fixed at 1000.**
ZenGM's `COLA_ALPHA = 1000` (zengm-fork/src/common/constants.ts:14). The
absolute scale of Δ does not affect the lottery (only ratios matter); we
hold at the default for parity with Highley's framing.

**D-6. ρ fixed at "playoff-success-step".**
ZenGM's `PLAYOFF_FACTORS = [0.75, 0.5, 0.25, 0]` plus
`DRAFT_LOTTERY_FACTORS = [0, 0.25, 0.5, 0.75]`. Matches paper's Classic ρ
schedule (champion = 0 residual, monotone increasing as you exit earlier).

**D-7. W fixed at "uniform" (i.e., L_i / P chance proportional to cola).**
genOrder.ts:248-261. Picks 1-4 are sampled chance-weighted; picks 5+ are
strict rank order (lowest cola first). Matches paper's Classic W.

**D-8. T fixed at "coin-flip".**
ZenGM's lottery draw is intrinsically random when chances are tied; no
explicit tiebreak rule is exercised. Matches paper's Classic T (random
draw subsumed by W).

---

## 4. Simulation Assumptions

**S-1. Default horizon: 30 seasons per replicate for smoke; 50 for headline.**
`dial_grid.json` field `seasons_per_config: 50`. The smoke test
overrides to 30 (per task spec). 30 years is long enough for carry-over
scope (S=bounded-30yr) to manifest. 50 years is the headline horizon
for the Pareto frontier.

**S-2. Default replicates: 1 for smoke, 50 for headline.**
The smoke test uses 1 replicate to validate the engine path. Headline
runs use 50 replicates per config (2,400 total simulated seasons at the
50-season horizon). Sensitivity runs at 30 and 100 replicates (per
dial_grid.json `_sensitivity_protocol`) verify the frontier is not a
Monte Carlo artefact.

**S-3. Reproducibility: deterministic PRNG keyed by `(config_id, replicate, base_seed=42)`.**
`hashSeed(configId, replicate, baseSeed)` in colaSweepDriver.test.ts:60.
Each (config, replicate) gets a unique 32-bit seed; mulberry32 produces
the bracket samples and strength values. ZenGM's own lottery draw uses
its internal random (via `randInt`); the driver does not currently
override this, so the lottery draw RNG is independent. To make the
lottery draw reproducible, future work should override ZenGM's random
source via dependency injection.

**S-4. League starting state: each replicate starts from a fresh new-league.**
`bootstrapLeague` zeroes all team.cola at the start of the run. No prior
historical seasons are loaded. This is the standard "new league" starting
condition — equivalent to `initializeCola()` with no prior season data,
which is a no-op.

**S-5. Single replicate vs. multiple replicates per config.**
The driver currently launches one vitest subprocess per replicate. The
2.9s per-replicate startup overhead dominates for short horizons; for
the headline 48×50 run (~2,400 vitest invocations), batching multiple
replicates per vitest invocation would cut wall time materially. This
optimization is left for the headline pass.

**S-6. Team strength persists across seasons via a Markov model tied to draft outcomes.**
See Z-2 for the transition equation and parameter values. Team strength
is initialized from Uniform[0.3, 0.7] at t=0 and updated each season as
a function of the prior season's strength, the prior season's draft
pick value, and a Normal shock. This replaces the earlier i.i.d.
Uniform[0.2, 0.6] refresh; aging curves, free agency, and trades are
still abstracted into the single strength variable. The dial space
tests the lottery mechanism, not roster-construction dynamics, but the
feedback loop (lottery position → draft pick → next-season strength)
that the primary objective measures is now wired in.

---

## 5. Objective Assumptions

**O-1. Primary objective: `maxYearsBetweenConferenceFinals`.**
Per Highley's 2026-05-26 guidance. For each franchise, compute the
longest run of consecutive seasons without making the conference finals
(`playoffRoundsWon >= 2`); take the max across franchises. Lower is
better. Computed in `objectives.js:43-90`.

**O-2. CF definition: `playoffRoundsWon >= 2`.**
Mapped to ZenGM convention: 0 = lost R1, 1 = lost R2, 2 = lost CF, 3 =
lost Finals, 4 = champion. `>=2` means appeared in CF at minimum (i.e.,
won R2 to advance to CF, or further). Per-season this yields 4
distinct franchises across the 2 conferences.

**O-3. Aggregation: max-of-max (worst franchise's worst gap).**
The primary objective is the maximum over franchises of the maximum gap.
Per Highley: this captures the *worst-served* franchise. Alternative
aggregations (median, p90) are NOT computed in the primary metric but
the per-team gaps are retained in `perTeamGaps` for diagnostic use.

**O-4. Secondary objective: `manipulationGainUpperBound` is analytical, not simulation-derived.**
Computed from `config` directly via the closed-form bound from Theorem
1: `1 + 4/E` for uncapped, `η · C` for capped (η ∈ {0.2, 0.3}). Does
not use seasonLog. The bound is an upper bound — actual realized
manipulation gain in simulation may be lower.

**O-5. Secondary objective: `perSeriesCost` returns null for uncapped.**
Per Lemma 2: per-series cost = `η · C`. Null when C = null
(unbounded). Reported as analytical only — not measured from simulated
manipulator behavior.

**O-6. Secondary objective: `rankOneToFiveSpread` measures expected-pick
divergence between worst and 5th-worst team.**
Average over seasons of (5th-worst's pick − worst's pick). Small spread
= flat tanking incentive curve at the bottom. Computed from seasonLog,
filtered to lottery-eligible teams (`draftPick !== null`).

**O-7. Horizon for objective evaluation: full replicate length.**
30 seasons in smoke; 50 in headline. No truncation, no burn-in. The
first season's COLA index is 0 by construction, but Highley's primary
objective is gap-based so a zero-cola start doesn't bias it.

**O-8. No franchise relocation, contraction, or expansion.**
Franchise tids are constant across all simulated seasons. The 30 teams
defined at bootstrap remain in place. ZenGM supports relocations and
expansion drafts; we do not exercise these.

---

## 6. Comparison Baseline Assumptions

**B-1. "Status quo NBA lottery" = config_id 0 (E=14, C=null, S=single-season).**
This approximates the current NBA flattened-odds system. Other
single-season variants (E=22, etc.) sweep nearby points.

**B-2. "3-2-1 baseline" = E="16-tiered", C=null, S=single-season.**
Maps to the proposal Highley's Explorer evaluates. The exact eligibility
mask (10 non-playoff non-play-in + 4 record-9/10 + 2 7v8 losers) is
approximated in the driver as the 16 worst-record teams (see Z-1
masking). Refinement to the full 3-2-1 tier weighting is a follow-up
ticket.

**B-3. NBA historical record (1999-2025) is NOT factored into this sweep.**
The sweep is forward-simulated. The COLA Explorer
(`life/research/Collaborations/wip-papers/cola-manipulation-bound/docs/`)
handles the historical backtest; the testbed handles forward Pareto
exploration. The two evidence streams are complementary, not redundant.

**B-4. Classic COLA = config_id 1 (E=14, C=null, S=unbounded).**
Canonical reference for the paper's primary parity claim. Smoke test
verifies this config first.

---

## 7. Patch-File Architecture Assumptions

**P-1. Non-default dials are applied at runtime, not via persistent patches.**
The current driver applies E, C, S dials via runtime modifications to
the in-cache `team.cola` (eligibility mask, cap clamp, scope reset) —
no `git apply` is invoked. This is cleaner than patch-file management
for the smoke test and headline run, and equivalent in semantics:
ZenGM's `cola.updateLotteryChancesAfterPlayoffs` and `draft.genOrder`
read team.cola from cache, so mutating cache pre/post call achieves the
same outcome as patching the file.

**P-2. ρ, W, T variations would require source patches.**
Per DIAL_MAPPING.md "Dial exposure summary": ρ is encoded in file-local
constants in cola.ts, W is encoded in genOrder.ts chance logic, T in
divideChancesOverTiedTeams.ts. If a future run sweeps these dials, the
patch-file path (`patches/config_${id}.patch` applied via `git apply`)
will be needed. Current grid does not exercise this.

**P-3. Patches assume no cross-dial coupling in zengm source.**
We rely on the modularity of cola.ts (independent functions for
playoff/lottery updates) and the orthogonality of E (pool size), C
(cap), S (carry-over) at the implementation level. A patch that
modifies one would not interfere with another applied at runtime — but
this has not been stress-tested.

**P-4. The fork is pinned to a single commit.**
All assumptions hold against the cloned snapshot of `kvr06-ai/zengm`.
Upstream changes (e.g., a refactor of `PLAYOFF_FACTORS` into game
attributes) would invalidate the runtime-patch approach.

---

## 8. Driver Architecture Assumptions

**A-1. Vitest is the only viable headless harness.**
ZenGM's worker is initialized via `src/worker/index.ts`, which expects
browser globals (`self`, `window`, IDB). The project's own vitest setup
(`src/test/setup.ts`) provides all required shims (fake-indexeddb,
mocked fetch, `self`/`window` aliases). Bypassing vitest would require
duplicating this shim layer. We piggyback on it instead.

**A-2. Each replicate is one vitest subprocess.**
The driver test file reads `COLA_DRIVER_CONFIG` from env, runs the
configured seasons, writes JSON to `COLA_DRIVER_OUTPUT`, and exits. The
overhead (~2.5s startup) is acceptable for the smoke test but should be
batched for the headline run.

**A-3. The driver uses `idb.cache` directly, bypassing `idb.league`
(IndexedDB persistence).**
Mocked `idb.league` via `mockIDBLeague()` returns empty arrays for all
queries. `idb.cache` is the in-memory layer used by `helpers.ts:
resetCache()`. All ZenGM functions called by the driver operate on
cache, never persisting to fake-indexeddb. This is functionally
identical to a normal ZenGM session that runs purely in cache (the
flush path is no-op'd in `resetCache`).

**A-4. Mock flag `genOrder(true)` prevents draft-pick persistence and
prevents `updateLotteryChancesAfterLottery` from being called inside
genOrder.**
We call `updateLotteryChancesAfterLottery(top4Tids)` manually after
extracting the top-4 from the returned draftPicks. This ensures the
post-lottery diminishment is applied for COLA carry-over to the next
season's cycle.

**A-5. Driver does NOT log lottery events / notifications.**
genOrder.ts:349-355: `logLotteryChances` / `logLotteryWinners` are
skipped under `mock=true`. The driver does not depend on UI
notification side effects.

---

## 9. Limitations

**L-Z2. Strength Markov model is parametrically calibrated, not fit to
historical NBA team-strength trajectories.**
The (rho, alpha, sigma) values were tuned on the Classic-COLA smoke
config so that the per-team CF-gap distribution dispersed (max gap 22 →
28, occasional franchises with zero CF appearances over 30 years)
relative to the prior i.i.d. baseline. They were not estimated from
NBA team-strength time series, ratings-system rankings, or any other
empirical anchor. Sensitivity analysis on (rho, alpha, sigma), and a
formal calibration against either NBA SRS / Elo trajectories or
Basketball Reference SoS data, is future work.

**L-Z3. Lottery-draw nondeterminism propagates into the strength
trajectory.**
Per S-3, ZenGM's lottery draw uses an unseeded `Math.random`, so the
draft pick assigned to each team is nondeterministic across replicates
even when the mulberry32 seed is fixed. Under the prior i.i.d. strength
model this nondeterminism was confined to the `draftPick` field of one
season; under the Markov model it now feeds into next season's strength
via the alpha * pick_value term, so two runs with identical seeds can
produce materially different `max_years_between_conf_finals` (observed
range 22-30 across 5 single-replicate smoke runs). Headline runs use
multiple replicates per config, so this nondeterminism is absorbed into
the Monte Carlo error bar; the smoke test should be interpreted as a
single random draw, not a deterministic baseline. Dependency-injecting
ZenGM's random source is tracked as future work (README "Next-session
work" item 1).

---

## Cross-References

- Paper: `paper/sections/03-cola-family.tex` §3.1.2 Definition 2 (seven
  dials).
- Dial map: `DIAL_MAPPING.md`.
- Engine: `zengm-fork/src/worker/core/draft/cola.ts`,
  `zengm-fork/src/worker/core/draft/genOrder.ts`.
- Driver: `zengm-fork/src/worker/core/draft/colaSweepDriver.test.ts`.
- Sweep harness: `sweep.js`.
- Objectives: `objectives.js`.
- Highley Substack reference: <https://zengm.com/blog/2026/02/cola-draft-type/>
