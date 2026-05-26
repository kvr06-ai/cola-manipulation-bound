#!/usr/bin/env node
/**
 * Objective functions for the Basketball-GM COLA sweep.
 *
 * Four objectives are computed per (config, season-log) pair. The primary
 * objective is per Highley's guidance: minimise the max years between any
 * franchise's conference-finals appearances. Secondary objectives provide
 * analytical and per-series-cost views from the manipulation-bound paper.
 *
 * The simulation produces a `seasonLog` array where each entry records:
 *   {
 *     season: number,
 *     teams: [
 *       { tid: number, conf: 'E'|'W', wins: number,
 *         playoffRoundsWon: number,        // -1 = lottery, 0 = R1 loss, 1 = R2 loss, 2 = CF loss, 3 = finals loss, 4 = champion
 *         draftPick: number|null,          // 1..N if received a pick, null if not in lottery
 *         cola: number                     // post-update lottery index
 *       },
 *       ...
 *     ]
 *   }
 *
 * Conference-finals appearance: playoffRoundsWon >= 2 (made the CF round at
 * minimum). Two conferences each season, so two CF participants per season per
 * conference (loser + champion of each conference's semifinal bracket). For a
 * 30-team league this is 4 distinct franchises per season making the CF.
 */

// =============================================================================
// Primary objective: max years between conference-finals appearances.
// Per Highley's May 26 guidance: "we could use Basketball-GM to optimize for
// minimize max years between conference finals appearances."
// =============================================================================

/**
 * For each franchise, compute the longest consecutive run of seasons in which
 * that franchise did NOT make the conference finals. Return the max over all
 * franchises. Lower is better (more equitable parity).
 *
 * @param {Array} seasonLog - chronologically ordered season entries
 * @returns {{ maxGap: number, perTeamGaps: Object<tid, number>, neverReached: number[] }}
 */
function maxYearsBetweenConferenceFinals(seasonLog) {
    if (!Array.isArray(seasonLog) || seasonLog.length === 0) {
        throw new Error("maxYearsBetweenConferenceFinals: seasonLog must be a non-empty array");
    }

    // Build per-team appearance histories. CF appearance = playoffRoundsWon >= 2.
    const tids = new Set();
    for (const entry of seasonLog) {
        for (const t of entry.teams) tids.add(t.tid);
    }

    const appearanceSeasons = {};  // tid -> sorted list of season indices where team reached CF
    for (const tid of tids) appearanceSeasons[tid] = [];

    seasonLog.forEach((entry, seasonIdx) => {
        for (const t of entry.teams) {
            if (t.playoffRoundsWon >= 2) {
                appearanceSeasons[t.tid].push(seasonIdx);
            }
        }
    });

    const totalSeasons = seasonLog.length;
    const perTeamGaps = {};
    const neverReached = [];
    let maxGap = 0;

    for (const tid of tids) {
        const apps = appearanceSeasons[tid];
        if (apps.length === 0) {
            // Never reached CF: gap = total simulation length (worst-case)
            perTeamGaps[tid] = totalSeasons;
            neverReached.push(tid);
            maxGap = Math.max(maxGap, totalSeasons);
            continue;
        }
        // Gap-before-first-appearance, between-appearance gaps, gap-after-last-appearance.
        let teamMaxGap = apps[0];                                      // gap before first
        for (let i = 1; i < apps.length; i++) {
            teamMaxGap = Math.max(teamMaxGap, apps[i] - apps[i - 1] - 1);
        }
        teamMaxGap = Math.max(teamMaxGap, totalSeasons - 1 - apps[apps.length - 1]);
        perTeamGaps[tid] = teamMaxGap;
        maxGap = Math.max(maxGap, teamMaxGap);
    }

    return { maxGap, perTeamGaps, neverReached };
}

// =============================================================================
// Secondary objective: analytical manipulation-gain upper bound.
// Per Theorem 1 of the manipulation-bound paper: M_classic <= 1 + 4 * alpha / P
// for Classic COLA at pool P. For Capped COLA, the bound is governed by
// Lemma 2: per-series gain bounded by eta * C with eta in {0.2, 0.3}.
// Analytical, not simulation-derived; depends only on config.
// =============================================================================

/**
 * Compute the theoretical manipulation-gain upper bound for a given dial
 * configuration. This is the closed-form bound from Theorem 1; it does not
 * use the simulation output.
 *
 * @param {Object} config - dial configuration with fields { E, delta, C, S, ... }
 * @returns {{ bound: number, formula: string }}
 */
function manipulationGainUpperBound(config) {
    const { E, delta, C, S } = config;

    // Classic COLA: P = |E| * alpha (steady state with no diminishment activity).
    // Conservative upper bound per Theorem 1: multiplicative factor 1 + k*alpha/P
    // where k counts the number of pre-diminishment cliffs the manipulator can
    // surmount. For Classic (k = 4 draft cliffs), this reduces to:
    //   bound = 1 + 4 / |E|
    // For unbounded scope, the bound is a steady-state expression.
    // For bounded/capped scope, switch to Lemma 2.

    if (C !== null && C !== undefined) {
        // Capped: per-series cost from Lemma 2.
        // eta = 0.2 typical (regular round), 0.3 play-in-round.
        const etaTypical = 0.2;
        const etaPlayIn = 0.3;
        return {
            bound: etaTypical * C,
            bound_playin: etaPlayIn * C,
            formula: `eta * C = ${etaTypical} * ${C} = ${etaTypical * C} (typical); play-in: ${etaPlayIn} * ${C} = ${etaPlayIn * C}`,
            notes: "Capped configuration: per-series cost is the binding constraint (Lemma 2)."
        };
    }

    // Uncapped (Classic-style) bound.
    const eligibilitySize = typeof E === "number" ? E : (E === "16-tiered" ? 16 : 22);
    const bound = 1 + 4 / eligibilitySize;
    return {
        bound,
        formula: `1 + 4 / |E| = 1 + 4 / ${eligibilitySize} = ${bound}`,
        notes: `Classic-style uncapped bound. Steady-state assumption; |E| = ${eligibilitySize}.`
    };
}

// =============================================================================
// Secondary objective: per-series cost (capped variants only).
// Lemma 2 of the manipulation-bound paper: the manipulator's per-playoff-series
// cost is bounded by eta * C, where eta = 0.2 (typical round) or 0.3 (play-in).
// =============================================================================

/**
 * Compute the per-series cost ceiling for a capped configuration. Returns
 * null if the config is uncapped (in which case per-series cost is unbounded).
 *
 * @param {Object} config - dial configuration with field C
 * @returns {{ typical: number, playIn: number } | null}
 */
function perSeriesCost(config) {
    const { C } = config;
    if (C === null || C === undefined) return null;
    return {
        typical: 0.2 * C,
        playIn: 0.3 * C,
        cap: C,
        formula: `0.2 * ${C} typical; 0.3 * ${C} play-in (Lemma 2)`
    };
}

// =============================================================================
// Secondary objective: rank-1-to-5 spread (anti-tanking strength proxy).
// Expected pick position of the worst 5 teams over the simulation. A small
// spread between the worst team and the 5th-worst team's expected pick means
// tanking yields little marginal advantage.
// =============================================================================

/**
 * Compute the expected pick position for each of the worst-5 final-record
 * teams in each season, averaged across the simulation. The "spread" metric
 * is the difference between the 5th-worst team's expected pick and the worst
 * team's expected pick. A spread near zero implies tanking-resistant.
 *
 * @param {Array} seasonLog
 * @returns {{ expectedPickByWorstRank: number[], spread1To5: number }}
 */
function rankOneToFiveSpread(seasonLog) {
    const N_WORST = 5;
    const expectedSums = new Array(N_WORST).fill(0);
    let nSeasons = 0;

    for (const entry of seasonLog) {
        // Rank lottery-eligible teams by wins ASC (worst first).
        const lottery = entry.teams
            .filter(t => t.draftPick !== null && t.draftPick !== undefined)
            .slice()
            .sort((a, b) => a.wins - b.wins);

        if (lottery.length < N_WORST) continue;
        for (let i = 0; i < N_WORST; i++) {
            expectedSums[i] += lottery[i].draftPick;
        }
        nSeasons += 1;
    }

    if (nSeasons === 0) {
        return { expectedPickByWorstRank: [], spread1To5: NaN, nSeasons: 0 };
    }

    const expectedPickByWorstRank = expectedSums.map(s => s / nSeasons);
    const spread1To5 = expectedPickByWorstRank[N_WORST - 1] - expectedPickByWorstRank[0];

    return { expectedPickByWorstRank, spread1To5, nSeasons };
}

// =============================================================================
// Aggregator: run all four objectives, return a flat record for CSV output.
// =============================================================================

function evaluateAll(config, seasonLog) {
    const primary = maxYearsBetweenConferenceFinals(seasonLog);
    const manipGain = manipulationGainUpperBound(config);
    const seriesCost = perSeriesCost(config);
    const rankSpread = rankOneToFiveSpread(seasonLog);

    return {
        // Primary
        max_years_between_conf_finals: primary.maxGap,
        franchises_never_reached_cf: primary.neverReached.length,
        // Manipulation gain bound (analytical)
        manipulation_gain_bound: manipGain.bound,
        manipulation_gain_formula: manipGain.formula,
        // Per-series cost (capped only)
        per_series_cost_typical: seriesCost ? seriesCost.typical : null,
        per_series_cost_playin: seriesCost ? seriesCost.playIn : null,
        // Rank-1-to-5 spread
        rank_one_to_five_spread: rankSpread.spread1To5,
        expected_pick_worst: rankSpread.expectedPickByWorstRank[0],
        expected_pick_fifth_worst: rankSpread.expectedPickByWorstRank[4],
    };
}

module.exports = {
    maxYearsBetweenConferenceFinals,
    manipulationGainUpperBound,
    perSeriesCost,
    rankOneToFiveSpread,
    evaluateAll,
};

// Self-test when invoked directly.
if (require.main === module) {
    // Synthetic season log: 10 seasons, 4 teams, manufactured CF appearances.
    const synthetic = [];
    for (let s = 0; s < 10; s++) {
        synthetic.push({
            season: s,
            teams: [
                { tid: 0, conf: 'E', wins: 60, playoffRoundsWon: s % 3 === 0 ? 3 : -1, draftPick: s % 3 === 0 ? null : 1, cola: 0 },
                { tid: 1, conf: 'E', wins: 50, playoffRoundsWon: s % 3 === 1 ? 2 : 0, draftPick: 2, cola: 1000 },
                { tid: 2, conf: 'W', wins: 45, playoffRoundsWon: 2, draftPick: 3, cola: 500 },
                { tid: 3, conf: 'W', wins: 20, playoffRoundsWon: -1, draftPick: 4, cola: 2000 },
            ],
        });
    }
    const config = { E: 14, delta: 1000, C: null, S: "unbounded" };
    console.log("objectives.js self-test");
    console.log(JSON.stringify(evaluateAll(config, synthetic), null, 2));
}
