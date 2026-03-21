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

function computeAllVariants(seasonsData) {
  return {
    simple: computeSimpleCOLA(seasonsData),
    classic: computeClassicCOLA(seasonsData),
  };
}

// Export for use in app.js (and for Node.js testing)
if (typeof module !== "undefined" && module.exports) {
  module.exports = { computeSimpleCOLA, computeClassicCOLA, computeAllVariants, ALPHA, PLAYOFF_DIMINISH, DRAFT_DIMINISH };
}
