# Basketball-GM COLA Sweep (Track B Empirical Testbed)

This directory is the empirical anchor for the MIT Sloan Sports Analytics
Conference (SSAC27, March 2027) paper submission. It runs simulations
against the ZenGM Basketball-GM engine — a public single-player NBA
simulator that already implements the COLA draft type — to compute Pareto
frontiers across the seven-dial configuration space defined in
`paper/sections/03-cola-family.tex` §3.1.2 (Definition 2).

## Why Basketball-GM

Prof. Highley's guidance, 2026-05-26: *"we could use [Basketball-GM] to
optimize for various parameters."* Primary objective per the same
exchange: *minimize max years between conference finals appearances*.

ZenGM is the only publicly available NBA simulator with COLA implemented
out of the box. Reference: <https://zengm.com/blog/2026/02/cola-draft-type/>.
Our fork: <https://github.com/kvr06-ai/zengm> (default branch unchanged this
session).

## Architecture

```
basketball_gm_sweep/
├── README.md              # this file
├── DIAL_MAPPING.md        # zengm internals -> 7-dial taxonomy
├── dial_grid.json         # 48-configuration grid spec
├── sweep.js               # main driver (loads grid, invokes engine, writes CSV)
├── objectives.js          # primary + 3 secondary objective functions
├── zengm-fork/            # local clone of kvr06-ai/zengm (GITIGNORED)
├── patches/               # per-config patch files (to be generated; see DIAL_MAPPING.md)
└── runs/                  # CSV outputs per sweep run (GITIGNORED)
```

## Dial grid

48 configurations swept over:

| Dial | Values | Count |
|---|---|---|
| E (eligibility) | 14, 22, 16-tiered | 3 |
| C (cap) | null, 100, 150, 200 | 4 |
| S (carry-over scope) | single-season, unbounded, bounded-30yr, reset-on-championship | 4 |

Held at Classic COLA defaults: Δ = 1000, ρ = playoff-success-step,
W = uniform, T = coin-flip.

Default replicates: **50 seasons per configuration**.
Sensitivity check: a 4-config subset re-run at 30 and 100 seasons to
verify Pareto frontier stability.

Full sweep at the default rate: 48 × 50 = 2,400 simulated seasons.

## Objectives

Per `objectives.js`:

1. **`maxYearsBetweenConferenceFinals(seasonLog)`** — primary objective
   per Highley. For each franchise, longest consecutive run of seasons
   without reaching the conference finals. Return the maximum over all
   franchises. **Lower is better** (more equitable parity).

2. **`manipulationGainUpperBound(config)`** — Theorem 1 closed-form bound
   on the manipulator's gain. Analytical (no simulation needed). For
   capped configurations, switches to Lemma 2 (per-series cost).

3. **`perSeriesCost(config)`** — Lemma 2 ceiling: `0.2 · C` (typical) or
   `0.3 · C` (play-in). Null for uncapped configurations.

4. **`rankOneToFiveSpread(seasonLog)`** — expected-pick spread between
   the worst team and the 5th-worst team over the simulation horizon. A
   small spread implies tanking yields little marginal advantage
   (anti-tanking strength proxy).

## How to run

```bash
# Smoke test (one config, one season, stub engine)
node sweep.js --smoke

# Single configuration (config_id = N) for `R` replicates
node sweep.js --config-id 0 --replicates 50

# Full sweep (all 48 configs, 50 replicates each = 2,400 simulated seasons)
node sweep.js --full
```

Output: CSV per run in `runs/sweep_${mode}_${timestamp}.csv`. One row per
`(config_id, replicate_id)`.

## Status (Track B scaffold, 2026-05-26)

| Component | Status |
|---|---|
| Grid expansion (`dial_grid.json` → 48 explicit configs) | Implemented |
| Objective functions (`objectives.js`) | Implemented |
| CSV aggregator | Implemented |
| zengm headless invocation (`runZengmSeason`) | **STUB** — see `DIAL_MAPPING.md` for the engineering ticket |
| Per-config dial patches in `patches/` | Not yet generated |
| Full sweep run | Blocked on the above two items |

## Blockers and next-session work

1. **Headless season driver.** ZenGM runs in a browser Web Worker. The
   recommended path is a Vitest node-environment driver that loads
   `src/worker/index.ts` with `fake-indexeddb`, then steps annual phases
   via the worker API. Existing tests exercise lottery generation but
   not full-season simulation. See `DIAL_MAPPING.md` for the three
   approaches (Vitest, Playwright, engine extraction).

2. **Dial patches.** Only `draftType` is exposed via `gameAttributes`.
   Every dial except T requires modifying source files. Build a
   patch-file generator in `patches/` that emits one diff per config
   against the COLA implementation in `src/worker/core/draft/cola.ts`.

3. **Run budget.** 2,400 simulated seasons. ZenGM's typical
   browser-side season takes seconds to tens of seconds depending on
   league size; under Node + fake IDB the throughput should be
   comparable. Budget: 4–12 hours of wall-clock for the full sweep.

## License reminder

`zengm-fork/` is a private local clone of a source-available repository.
The ZenGM license permits local private use and editing; it does NOT
permit hosting a modified playable version or distributing installers.
Our research use (headless figure-generation testbed) is permitted.

## Related files in the parent repo

| File | Role |
|---|---|
| `paper/sections/03-cola-family.tex` | §3.1.2 Definition 2 (seven dials) |
| `docs/js/cola-engine.js` | Our own JavaScript COLA engine; cross-check reference |
| `scripts/audit_dial_taxonomy.js` | Audits paper-cited dial values against `cola-engine.js` (code style template for this directory) |
