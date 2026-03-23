/**
 * COLA Engine — Pure-function state machines for Simple COLA and Classic COLA.
 *
 * No DOM, no Chart.js. Given nba-data.json, computes COLA state for every
 * team at every season.
 *
 * Constants ported from cola/constants.py (Highley et al. 2026).
 */

// =============================================================================
// Constants (source of truth: cola/constants.py)
// =============================================================================
const ALPHA = 1000;


// Fraction of index REMOVED. index *= (1 - fraction).
const PLAYOFF_DIMINISH = {
  champion: 1.0,      // index -> 0
  finals: 0.75,       // 75% removed
  conf_finals: 0.5,   // 50% removed
  second_round: 0.25, // 25% removed
  first_round: 0.0,   // unchanged
};

const DRAFT_DIMINISH = {
  1: 1.0,  // index -> 0
  2: 0.75,
  3: 0.5,
  4: 0.25,
};

// =============================================================================
// Simple COLA
// =============================================================================
// Drought = consecutive years without winning a playoff series OR receiving
// a top-3 draft pick. Draft order: longest drought DESC, tiebreak by wins DESC.

function computeSimpleCOLA(seasonsData) {
  const results = {};
  const drought = {}; // persistent state: { teamId: droughtLength }

  for (const season of seasonsData) {
    const year = season.year;

    // Initialize new teams (e.g., CHA in 2005)
    for (const team of season.teams) {
      if (!(team.id in drought)) {
        drought[team.id] = 0;
      }
    }

    // Phase A: Update drought from playoff results only (no draft picks yet).
    // Teams that won a playoff series get reset; everyone else increments.
    // This is the state AT LOTTERY TIME — before picks are assigned.
    for (const team of season.teams) {
      const wonPlayoffSeries = team.seriesWon >= 1;
      if (wonPlayoffSeries) {
        drought[team.id] = 0;
      } else {
        drought[team.id] += 1;
      }
    }

    // Compute draft order for all 22 eligible teams (using pre-draft drought).
    // Simple COLA eligibility: hasn't won a playoff series (seriesWon === 0).
    // This includes 14 non-playoff teams AND 8 first-round losers.
    // Classic COLA is different: only 14 non-playoff teams are lottery-eligible.
    const lotteryTeams = season.teams
      .filter(t => t.seriesWon === 0)
      .map(t => ({
        id: t.id,
        name: t.name,
        drought: drought[t.id],
        wins: t.wins,
        losses: t.losses,
        draftPick: t.draftPick, // actual pick received
      }))
      .sort((a, b) => {
        if (b.drought !== a.drought) return b.drought - a.drought;
        return b.wins - a.wins; // more wins = higher tiebreak
      });

    // Assign draft positions
    const draftOrder = lotteryTeams.map((t, i) => ({
      ...t,
      colaPosition: i + 1,
    }));

    // Build team lookup (all teams, including playoff)
    const teamStates = {};
    for (const team of season.teams) {
      teamStates[team.id] = {
        drought: drought[team.id],
        madePlayoffs: team.madePlayoffs,
        playoffResult: team.playoffResult,
        seriesWon: team.seriesWon,
        wins: team.wins,
        losses: team.losses,
        draftPick: team.draftPick,
        colaPosition: null,
      };
    }
    for (const d of draftOrder) {
      teamStates[d.id].colaPosition = d.colaPosition;
    }

    results[year] = {
      teams: teamStates,
      draftOrder: draftOrder,
    };

    // Phase B: Apply draft pick reset AFTER display state is captured.
    // This carries forward to the next season's computation.
    for (const team of season.teams) {
      const gotTop3Pick = team.draftPick != null && team.draftPick <= 3;
      if (gotTop3Pick) {
        drought[team.id] = 0;
      }
    }
  }

  return results;
}

// =============================================================================
// Simple Lottery COLA
// =============================================================================
// Same drought state as Simple COLA. Top 14 by drought get pre-2019 NBA
// lottery odds for picks 1-3. Picks 4-14 by drought order. Bottom 8 of
// the 22-team pool are excluded from lottery picks.
//
// Pre-2019 lottery: 3 picks drawn by lottery, picks 4-14 in order.
// Odds of #1 pick by drought rank (source: NBA.com, 1994-2018 system):

const PRE_2019_ODDS = [
  0.250, 0.199, 0.156, 0.119, 0.088, 0.063, 0.043,
  0.028, 0.017, 0.011, 0.008, 0.007, 0.006, 0.005,
];

function computeSimpleLotteryCOLA(seasonsData) {
  // Reuse Simple COLA's drought computation — identical state machine.
  const simpleResults = computeSimpleCOLA(seasonsData);
  const results = {};

  for (const [yearStr, simpleYear] of Object.entries(simpleResults)) {
    const year = Number(yearStr);

    // Take the same draft order (22 teams sorted by drought DESC, wins DESC)
    const draftOrder = simpleYear.draftOrder.map((t, i) => {
      const inLottery = i < 14;
      return {
        ...t,
        probability: inLottery ? PRE_2019_ODDS[i] : 0,
        inLottery: inLottery,
      };
    });

    // Build team lookup (copy from simple, add probability)
    const teamStates = {};
    for (const [id, state] of Object.entries(simpleYear.teams)) {
      teamStates[id] = {
        ...state,
        probability: null,
        inLottery: false,
      };
    }
    for (const d of draftOrder) {
      teamStates[d.id].probability = d.probability;
      teamStates[d.id].inLottery = d.inLottery;
      teamStates[d.id].colaPosition = d.colaPosition;
    }

    results[year] = {
      teams: teamStates,
      draftOrder: draftOrder,
    };
  }

  return results;
}

// =============================================================================
// Classic COLA
// =============================================================================
// Lottery index: +1000 per year for non-playoff teams.
// Playoff diminishment and draft pick diminishment applied.
// Picks 1-4 by weighted lottery (probability = L / total).
// Picks 5-14 by reverse standings.

function computeClassicCOLA(seasonsData) {
  const results = {};
  const index = {}; // persistent state: { teamId: lottteryIndex }

  for (const season of seasonsData) {
    const year = season.year;

    // Initialize new teams
    for (const team of season.teams) {
      if (!(team.id in index)) {
        index[team.id] = 0;
      }
    }

    // Phase A: Compute state AT LOTTERY TIME (before draft picks resolve).

    // Step 1: Increment non-playoff teams
    for (const team of season.teams) {
      if (!team.madePlayoffs) {
        index[team.id] += ALPHA;
      }
    }

    // Step 2: Playoff diminishment
    for (const team of season.teams) {
      if (team.playoffResult && team.playoffResult in PLAYOFF_DIMINISH) {
        const frac = PLAYOFF_DIMINISH[team.playoffResult];
        index[team.id] *= (1 - frac);
      }
    }

    // Round indices to avoid floating point drift
    for (const id in index) {
      index[id] = Math.round(index[id] * 100) / 100;
    }

    // Compute lottery probabilities for non-playoff teams (pre-draft state)
    const lotteryTeams = season.teams
      .filter(t => !t.madePlayoffs)
      .map(t => ({
        id: t.id,
        name: t.name,
        index: index[t.id],
        wins: t.wins,
        losses: t.losses,
        draftPick: t.draftPick,
      }));

    const totalPool = lotteryTeams.reduce((sum, t) => sum + t.index, 0);

    // Picks 1-4: weighted lottery probabilities
    const probabilities = {};
    for (const t of lotteryTeams) {
      probabilities[t.id] = totalPool > 0 ? t.index / totalPool : 0;
    }

    // Sort by index descending for display
    const byProbability = [...lotteryTeams]
      .sort((a, b) => {
        if (b.index !== a.index) return b.index - a.index;
        return a.wins - b.wins; // fewer wins = higher priority in ties
      });

    const draftOrder = byProbability.map((t, i) => ({
      ...t,
      probability: probabilities[t.id],
      colaPosition: i + 1,
    }));

    // Build team lookup (all teams, using pre-draft state)
    const teamStates = {};
    for (const team of season.teams) {
      teamStates[team.id] = {
        index: index[team.id],
        madePlayoffs: team.madePlayoffs,
        playoffResult: team.playoffResult,
        seriesWon: team.seriesWon,
        wins: team.wins,
        losses: team.losses,
        draftPick: team.draftPick,
        probability: probabilities[team.id] || null,
        colaPosition: null,
      };
    }
    for (const d of draftOrder) {
      teamStates[d.id].colaPosition = d.colaPosition;
    }

    results[year] = {
      teams: teamStates,
      draftOrder: draftOrder,
      totalPool: totalPool,
    };

    // Phase B: Apply draft pick diminishment AFTER display state is captured.
    // This carries forward to the next season's computation.
    for (const team of season.teams) {
      if (team.draftPick != null && team.draftPick in DRAFT_DIMINISH) {
        const frac = DRAFT_DIMINISH[team.draftPick];
        index[team.id] *= (1 - frac);
      }
    }
    for (const id in index) {
      index[id] = Math.round(index[id] * 100) / 100;
    }
  }

  return results;
}

// =============================================================================
// Combined
// =============================================================================

// =============================================================================
// Countdown COLA
// =============================================================================
// Same drought as Simple COLA. McCarty number = drought × wins (fresh each
// season). Teams ranked by McCarty number DESC, tiebreak by drought DESC.
//
// Survivor-style elimination lottery (bottom-up):
//   1. Rank all 22 teams by McCarty number (highest = rank 1).
//   2. Start from pick #22 (worst pick), working up to pick #1.
//   3. For each pick: form a pool from the 5 LOWEST-ranked remaining teams.
//      Tickets: lowest in pool → 6, next → 5, ..., highest in pool → 2.
//      Draw one team — they receive that pick and are eliminated.
//   4. When fewer than 5 teams remain, pool = all remaining with same
//      ticket ratio (truncated from the low end).
//   5. Last team standing gets pick #1.
//
// Properties (from Highley's Substack Part 3):
//   - No team falls more than 4 spots below expected position.
//   - Chances of getting a pick 6+ better than expected are <5%.
//
// Full pick-by-pick probabilities computed via Monte Carlo simulation
// (10,000 trials per season).

const COUNTDOWN_POOL_TICKETS = [6, 5, 4, 3, 2]; // tickets for ranks 1-5 in each pool
const MC_TRIALS = 10000;

/**
 * Run one trial of the Countdown COLA survivor-style draft.
 *
 * @param {Array} rankedIds - Team IDs sorted by McCarty DESC (index 0 = rank 1 = best).
 * @returns {Object} { teamId: pickNumber } mapping for this trial.
 */
function countdownTrial(rankedIds) {
  // "remaining" tracks teams still in play, ordered worst-to-best (reversed).
  // We pop from the end (worst remaining) to form pools.
  const remaining = [...rankedIds].reverse(); // index 0 = worst (lowest McCarty)
  const assignment = {};
  const totalPicks = remaining.length;

  for (let pick = totalPicks; pick >= 1; pick--) {
    if (remaining.length === 1) {
      assignment[remaining[0]] = pick;
      break;
    }

    // Form pool from the bottom (lowest McCarty) of remaining
    const poolSize = Math.min(5, remaining.length);
    const pool = remaining.slice(0, poolSize); // worst teams first

    // Assign tickets: worst (index 0) → 6, next → 5, ... best in pool → 2
    const tickets = COUNTDOWN_POOL_TICKETS.slice(0, poolSize);
    const ticketTotal = tickets.reduce((a, b) => a + b, 0);

    // Weighted random draw
    const roll = Math.random() * ticketTotal;
    let cumulative = 0;
    let drawn = 0;
    for (let i = 0; i < poolSize; i++) {
      cumulative += tickets[i];
      if (roll < cumulative) {
        drawn = i;
        break;
      }
    }

    // Assign pick and eliminate
    assignment[pool[drawn]] = pick;
    remaining.splice(drawn, 1);
  }

  return assignment;
}

/**
 * Run Monte Carlo simulation for one season's Countdown COLA.
 *
 * @param {Array} rankedIds - Team IDs sorted by McCarty DESC.
 * @returns {Object} { teamId: { pickProbs: [p1, p2, ...pN], expectedPick: number } }
 */
function countdownMonteCarlo(rankedIds) {
  const n = rankedIds.length;
  // pickCounts[teamId][pickIndex] = count of times team got that pick
  const pickCounts = {};
  for (const id of rankedIds) {
    pickCounts[id] = new Array(n).fill(0);
  }

  for (let t = 0; t < MC_TRIALS; t++) {
    const assignment = countdownTrial(rankedIds);
    for (const [id, pick] of Object.entries(assignment)) {
      pickCounts[id][pick - 1] += 1;
    }
  }

  // Convert counts to probabilities
  const result = {};
  for (const id of rankedIds) {
    const probs = pickCounts[id].map(c => c / MC_TRIALS);
    const expected = probs.reduce((sum, p, i) => sum + p * (i + 1), 0);
    result[id] = { pickProbs: probs, expectedPick: expected };
  }

  return result;
}

function computeCountdownCOLA(seasonsData) {
  // Reuse Simple COLA's drought computation.
  const simpleResults = computeSimpleCOLA(seasonsData);
  const results = {};

  for (const [yearStr, simpleYear] of Object.entries(simpleResults)) {
    const year = Number(yearStr);

    // Compute McCarty number and rank
    const ranked = simpleYear.draftOrder
      .map((t) => ({
        ...t,
        mccarty: t.drought * t.wins,
      }))
      .sort((a, b) => {
        if (b.mccarty !== a.mccarty) return b.mccarty - a.mccarty;
        if (b.drought !== a.drought) return b.drought - a.drought;
        return b.wins - a.wins;
      });

    const rankedIds = ranked.map(t => t.id);

    // Run Monte Carlo
    const mc = countdownMonteCarlo(rankedIds);

    const draftOrder = ranked.map((t, i) => ({
      ...t,
      colaPosition: i + 1,
      probability: mc[t.id].pickProbs[0], // P(get pick #1)
      expectedPick: mc[t.id].expectedPick,
      pickProbs: mc[t.id].pickProbs,
      inLottery: mc[t.id].pickProbs[0] >= 0.005, // show if ≥0.5%
    }));

    // Build team lookup
    const teamStates = {};
    for (const [id, state] of Object.entries(simpleYear.teams)) {
      teamStates[id] = {
        ...state,
        mccarty: state.drought * (state.wins || 0),
        probability: null,
        expectedPick: null,
        inLottery: false,
      };
    }
    for (const d of draftOrder) {
      teamStates[d.id].mccarty = d.mccarty;
      teamStates[d.id].probability = d.probability;
      teamStates[d.id].expectedPick = d.expectedPick;
      teamStates[d.id].inLottery = d.inLottery;
      teamStates[d.id].colaPosition = d.colaPosition;
    }

    results[year] = {
      teams: teamStates,
      draftOrder: draftOrder,
    };
  }

  return results;
}

function computeAllVariants(seasonsData) {
  return {
    simple: computeSimpleCOLA(seasonsData),
    simpleLottery: computeSimpleLotteryCOLA(seasonsData),
    countdown: computeCountdownCOLA(seasonsData),
    classic: computeClassicCOLA(seasonsData),
  };
}

// Export for use in app.js (and for Node.js testing)
if (typeof module !== "undefined" && module.exports) {
  module.exports = { computeSimpleCOLA, computeSimpleLotteryCOLA, computeCountdownCOLA, computeClassicCOLA, computeAllVariants, ALPHA, PLAYOFF_DIMINISH, DRAFT_DIMINISH, PRE_2019_ODDS, COUNTDOWN_POOL_TICKETS };
}
