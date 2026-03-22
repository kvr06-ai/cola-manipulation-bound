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
const TOP_PICKS_RAFFLED = 4;

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
// Survivor-style elimination lottery:
//   For each pick, the top 5 remaining teams form a pool.
//   Tickets: rank 1 in pool → 6, rank 2 → 5, rank 3 → 4, rank 4 → 3, rank 5 → 2.
//   Draw winner, remove, repeat for next pick.
//
// Properties (from Highley's Substack Part 3):
//   - No team falls more than 4 spots below expected position.
//   - Chances of getting a pick 6+ better than expected are <5%.
//
// For display: we show the #1 pick probability (always the top 5 teams:
// 30%, 25%, 20%, 15%, 10%). Full pick-by-pick probabilities require Monte
// Carlo simulation and are not computed here.

const COUNTDOWN_POOL_TICKETS = [6, 5, 4, 3, 2]; // tickets for ranks 1-5 in each pool
const COUNTDOWN_POOL_TOTAL = 20; // sum of tickets

function computeCountdownCOLA(seasonsData) {
  // Reuse Simple COLA's drought computation.
  const simpleResults = computeSimpleCOLA(seasonsData);
  const results = {};

  for (const [yearStr, simpleYear] of Object.entries(simpleResults)) {
    const year = Number(yearStr);

    // Compute McCarty number for each team in the 22-team pool
    const draftOrder = simpleYear.draftOrder
      .map((t) => ({
        ...t,
        mccarty: t.drought * t.wins,
      }))
      .sort((a, b) => {
        if (b.mccarty !== a.mccarty) return b.mccarty - a.mccarty;
        if (b.drought !== a.drought) return b.drought - a.drought;
        return b.wins - a.wins;
      })
      .map((t, i) => ({
        ...t,
        colaPosition: i + 1,
        // #1 pick probability: only top 5 have non-zero odds
        probability: i < 5 ? COUNTDOWN_POOL_TICKETS[i] / COUNTDOWN_POOL_TOTAL : 0,
        inLottery: i < 5, // "in lottery" for #1 pick purposes
      }));

    // Build team lookup
    const teamStates = {};
    for (const [id, state] of Object.entries(simpleYear.teams)) {
      teamStates[id] = {
        ...state,
        mccarty: state.drought * (state.wins || 0),
        probability: null,
        inLottery: false,
      };
    }
    for (const d of draftOrder) {
      teamStates[d.id].mccarty = d.mccarty;
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
