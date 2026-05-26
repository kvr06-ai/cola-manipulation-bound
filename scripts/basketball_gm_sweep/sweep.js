#!/usr/bin/env node
/**
 * Basketball-GM COLA sweep driver (Track B scaffold).
 *
 * Reads `dial_grid.json`, expands the 7-dial grid into 48 configurations,
 * invokes the zengm engine headlessly for each (config, season), parses the
 * per-season output, evaluates the four objectives (objectives.js), and
 * aggregates one CSV row per (config_id, replicate_id, season).
 *
 * STATUS (Track B scaffold, 2026-05-26):
 *   - Grid expansion: implemented.
 *   - zengm invocation: STUB. Headless invocation of the full season+playoffs+
 *     draft pipeline requires a Node-side driver that mocks browser globals,
 *     loads src/worker/index.ts (via vitest's setup pattern), and steps the
 *     game phases manually. See DIAL_MAPPING.md for the engineering ticket.
 *   - Objective evaluation: implemented (objectives.js).
 *   - CSV output: implemented.
 *
 * USAGE (once zengm headless driver is plumbed):
 *   node sweep.js --config-id 0 --replicates 50 --seasons 30
 *   node sweep.js --full          # all 48 configs * 50 seasons
 *   node sweep.js --smoke         # one config, one season (for verification)
 */

const fs = require('fs');
const path = require('path');
const { evaluateAll } = require('./objectives.js');

// =============================================================================
// 1. Grid expansion: dial_grid.json -> 48 explicit configurations.
// =============================================================================

function loadGrid(gridPath) {
    const raw = JSON.parse(fs.readFileSync(gridPath, 'utf8'));
    const meta = raw._meta || {};
    const { dials, fixed_at_classic_cola_defaults } = raw;
    const seasonsPerConfig = meta.seasons_per_config;
    const sensitivityChecks = meta.sensitivity_checks || [];
    const expectedTotal = meta.total_configurations;

    const configs = [];
    let id = 0;
    for (const E of dials.E) {
        for (const C of dials.C) {
            for (const S of dials.S) {
                configs.push({
                    id: id++,
                    E,
                    C,
                    S,
                    delta: fixed_at_classic_cola_defaults.delta,
                    rho: fixed_at_classic_cola_defaults.rho,
                    W: fixed_at_classic_cola_defaults.W,
                    T: fixed_at_classic_cola_defaults.T,
                    seasons: seasonsPerConfig,
                });
            }
        }
    }
    if (expectedTotal !== undefined && configs.length !== expectedTotal) {
        throw new Error(`Grid expansion: expected ${expectedTotal} configs, got ${configs.length}`);
    }
    return { configs, meta, sensitivity_checks: sensitivityChecks };
}

// =============================================================================
// 2. zengm invocation (STUB).
//
// The zengm simulator is a browser-targeted Web Worker app. Reaching it
// headlessly requires one of three approaches (see DIAL_MAPPING.md):
//
//   (a) Vitest node-environment driver: load src/worker/index.ts with the
//       fake-indexeddb shim (zengm-fork/src/test/setup.ts) and step game
//       phases manually via the worker API. Existing genOrderNBA.test.ts
//       exercises the lottery in this mode but not full-season sims.
//
//   (b) Playwright e2e driver: spin up the dev server (`node --run dev`),
//       drive the UI via Playwright, intercept league state via window
//       globals. Higher overhead but no source modifications needed.
//
//   (c) Engine extraction: peel the simulation core (regular-season game
//       sim + playoff bracket + draft) into a standalone Node module. This
//       is the cleanest long-term path; substantial engineering ticket.
//
// For Track B scaffold, this stub returns a synthetic season log so the
// downstream pipeline (objectives + CSV) is testable end-to-end.
// =============================================================================

function runZengmSeason(config, replicate, seed) {
    // TODO: replace with real zengm invocation. See above for three approaches.
    // The stub fabricates one season's worth of team-result records, sufficient
    // for objectives.js to compute non-NaN outputs in the scaffold smoke test.

    const NUM_TEAMS = 30;
    const NUM_PLAYOFF_TEAMS = 16;  // NBA-style: 8 per conference
    const teams = [];

    // PRNG seeded by (config_id, replicate, seed) for reproducibility.
    const rng = mulberry32(hashSeed(config.id, replicate, seed));

    // Generate win totals with mild parity. Wins range 20..62.
    const winList = Array.from({ length: NUM_TEAMS }, () => 20 + Math.floor(rng() * 42));
    winList.sort((a, b) => b - a);

    // Assign top-8 from each conference (use shuffled indices) to the playoffs.
    const indices = Array.from({ length: NUM_TEAMS }, (_, i) => i);
    shuffle(indices, rng);
    const eastTids = indices.slice(0, NUM_TEAMS / 2);
    const westTids = indices.slice(NUM_TEAMS / 2);

    // For each conference, rank by win total and seed.
    const buildConf = (confTids, confLabel) => {
        const ranked = confTids
            .map(tid => ({ tid, wins: winList[tid], conf: confLabel }))
            .sort((a, b) => b.wins - a.wins);
        const playoffEntrants = ranked.slice(0, 8);
        const lotteryTeams = ranked.slice(8);
        return { ranked, playoffEntrants, lotteryTeams };
    };
    const east = buildConf(eastTids, 'E');
    const west = buildConf(westTids, 'W');

    // Round outcomes (uniform random with stub bracketing).
    const allLottery = [...east.lotteryTeams, ...west.lotteryTeams];
    const draftPickOrder = allLottery
        .slice()
        .sort((a, b) => a.wins - b.wins)
        .map((t, idx) => ({ ...t, draftPick: idx + 1 }));
    const tidToPick = Object.fromEntries(draftPickOrder.map(t => [t.tid, t.draftPick]));

    // Simulate playoff outcomes round by round (uniform random survivors).
    const simulateConfPlayoffs = (entrants) => {
        let alive = entrants.map(t => ({ ...t, playoffRoundsWon: 0 }));
        for (let round = 0; round < 3; round++) {  // R1 -> R2 -> CF
            const next = [];
            for (let i = 0; i < alive.length; i += 2) {
                const winner = rng() < 0.5 ? alive[i] : alive[i + 1];
                const loser = winner === alive[i] ? alive[i + 1] : alive[i];
                winner.playoffRoundsWon = round + 1;
                next.push(winner);
                // loser stays at playoffRoundsWon = round
            }
            alive = next;
        }
        return alive[0];  // conference champion (made finals)
    };
    const eastChamp = simulateConfPlayoffs(east.playoffEntrants);
    const westChamp = simulateConfPlayoffs(west.playoffEntrants);
    // Finals
    const champ = rng() < 0.5 ? eastChamp : westChamp;
    const runnerUp = champ === eastChamp ? westChamp : eastChamp;
    champ.playoffRoundsWon = 4;
    runnerUp.playoffRoundsWon = 3;

    // Assemble team-record list.
    for (const confData of [east, west]) {
        // Lottery teams: playoffRoundsWon = -1
        for (const t of confData.lotteryTeams) {
            teams.push({
                tid: t.tid,
                conf: t.conf,
                wins: t.wins,
                playoffRoundsWon: -1,
                draftPick: tidToPick[t.tid] ?? null,
                cola: Math.round(rng() * 5000),  // placeholder index value
            });
        }
        // Playoff teams: walk the bracket
        for (const t of confData.playoffEntrants) {
            let pr = 0;
            if (t === champ) pr = 4;
            else if (t === runnerUp) pr = 3;
            else {
                // Walked the bracket: deduce roundsWon from whether they appeared in CF/R2/R1.
                // For scaffold simplicity, sample uniformly.
                pr = Math.floor(rng() * 3);
            }
            teams.push({
                tid: t.tid,
                conf: t.conf,
                wins: t.wins,
                playoffRoundsWon: pr,
                draftPick: null,
                cola: 0,
            });
        }
    }

    return {
        season: replicate,
        teams,
    };
}

// =============================================================================
// 3. Utility: deterministic PRNG (mulberry32) and seed hash.
// =============================================================================

function hashSeed(configId, replicate, baseSeed) {
    // Combine three integers into a 32-bit seed deterministically.
    let h = baseSeed >>> 0;
    h = ((h ^ configId) * 2654435761) >>> 0;
    h = ((h ^ replicate) * 2654435761) >>> 0;
    return h;
}

function mulberry32(seed) {
    return function () {
        let t = (seed += 0x6D2B79F5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
}

// =============================================================================
// 4. Main driver: iterate configs, run replicates, aggregate, write CSV.
// =============================================================================

function runSweep({ gridPath, outPath, configIdsToRun, replicates, mode }) {
    const { configs } = loadGrid(gridPath);

    const targetConfigs = (configIdsToRun === 'all')
        ? configs
        : configs.filter(c => configIdsToRun.includes(c.id));

    const csvHeader = [
        'config_id', 'replicate_id', 'E', 'C', 'S', 'delta', 'seasons',
        'max_years_between_conf_finals',
        'franchises_never_reached_cf',
        'manipulation_gain_bound',
        'per_series_cost_typical',
        'per_series_cost_playin',
        'rank_one_to_five_spread',
        'expected_pick_worst',
        'expected_pick_fifth_worst',
    ];

    const rows = [csvHeader.join(',')];
    let runIdx = 0;

    for (const config of targetConfigs) {
        for (let rep = 0; rep < replicates; rep++) {
            // Build the season log for one replicate (one full simulation run
            // of `config.seasons` seasons).
            const seasonLog = [];
            for (let s = 0; s < config.seasons; s++) {
                const seasonEntry = runZengmSeason(config, rep * config.seasons + s, 42);
                seasonLog.push(seasonEntry);
            }
            const result = evaluateAll(config, seasonLog);

            rows.push([
                config.id,
                rep,
                config.E,
                config.C === null ? 'null' : config.C,
                config.S,
                config.delta,
                config.seasons,
                result.max_years_between_conf_finals,
                result.franchises_never_reached_cf,
                result.manipulation_gain_bound,
                result.per_series_cost_typical === null ? '' : result.per_series_cost_typical,
                result.per_series_cost_playin === null ? '' : result.per_series_cost_playin,
                result.rank_one_to_five_spread,
                result.expected_pick_worst,
                result.expected_pick_fifth_worst,
            ].join(','));

            runIdx++;
            if (mode === 'smoke') {
                console.log(`[smoke] config_id=${config.id} replicate=${rep}: ${JSON.stringify(result, null, 2)}`);
                break;
            }
        }
        if (mode === 'smoke') break;
    }

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, rows.join('\n') + '\n');
    console.log(`Wrote ${rows.length - 1} rows to ${outPath}`);
}

// =============================================================================
// 5. CLI.
// =============================================================================

function parseArgs(argv) {
    const args = { mode: 'normal', configIds: 'all', replicates: 1 };
    for (let i = 2; i < argv.length; i++) {
        if (argv[i] === '--smoke') args.mode = 'smoke';
        else if (argv[i] === '--full') args.mode = 'full';
        else if (argv[i] === '--config-id') args.configIds = [parseInt(argv[++i], 10)];
        else if (argv[i] === '--replicates') args.replicates = parseInt(argv[++i], 10);
        else if (argv[i] === '--seasons') args.seasonsOverride = parseInt(argv[++i], 10);
    }
    return args;
}

if (require.main === module) {
    const args = parseArgs(process.argv);
    const gridPath = path.join(__dirname, 'dial_grid.json');
    const outPath = path.join(__dirname, 'runs', `sweep_${args.mode}_${Date.now()}.csv`);

    let replicates = args.replicates;
    if (args.mode === 'full') replicates = 50;
    if (args.mode === 'smoke') replicates = 1;

    runSweep({
        gridPath,
        outPath,
        configIdsToRun: args.configIds,
        replicates,
        mode: args.mode,
    });
}

module.exports = { loadGrid, runZengmSeason, runSweep };
