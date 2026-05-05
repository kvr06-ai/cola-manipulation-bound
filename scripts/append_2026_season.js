#!/usr/bin/env node
/**
 * Append the 2025-26 NBA season to docs/data/nba-data.json for live
 * 2026 draft projection in the Explorer.
 *
 * Data sources:
 *   - Final regular-season standings (2025-26): plaintextsports.com /
 *     ESPN, cross-checked.
 *   - 2026 NBA Playoffs first-round results: ESPN bracket.
 *
 * Snapshot: end of first round (May 5, 2026). R2+ outcomes are not yet
 * known and are left null on each R1-winner team. The Capped COLA
 * engine (docs/js/cola-engine.js, computeCappedCOLA) applies first-round
 * diminishment pre-lottery and deeper-run diminishment post-lottery, so
 * a null playoffResult on an R1 winner correctly carries no
 * current-season diminishment for the live lottery snapshot.
 *
 * Usage: node scripts/append_2026_season.js
 *
 * Idempotent: refuses to append if year=2026 already exists.
 */

const path = require('path');
const fs = require('fs');

const DATA_PATH = path.join(__dirname, '..', 'docs', 'data', 'nba-data.json');

// ── Final 2025-26 regular-season standings ──
// Sources cross-checked: ESPN + plaintextsports.com.
// Conference seeds 1-6 are direct playoff entries; 7-10 are play-in.
// Records confirmed; play-in advancers identified via ESPN playoff
// bracket. Tiebreakers between identical records resolved via NBA
// official standings.
const SEASON_2026 = [
  // EAST — direct playoff (1-6)
  { id: 'DET', name: 'Detroit Pistons',         wins: 60, losses: 22, conf: 'E', seed: 1 },
  { id: 'BOS', name: 'Boston Celtics',          wins: 56, losses: 26, conf: 'E', seed: 2 },
  { id: 'NYK', name: 'New York Knicks',         wins: 53, losses: 29, conf: 'E', seed: 3 },
  { id: 'CLE', name: 'Cleveland Cavaliers',     wins: 52, losses: 30, conf: 'E', seed: 4 },
  { id: 'TOR', name: 'Toronto Raptors',         wins: 46, losses: 36, conf: 'E', seed: 5 },
  { id: 'ATL', name: 'Atlanta Hawks',           wins: 46, losses: 36, conf: 'E', seed: 6 },
  // EAST — play-in (7-10 by record)
  { id: 'PHI', name: 'Philadelphia 76ers',      wins: 45, losses: 37, conf: 'E', seed: 7 },
  { id: 'ORL', name: 'Orlando Magic',           wins: 45, losses: 37, conf: 'E', seed: 8 },
  { id: 'CHA', name: 'Charlotte Hornets',       wins: 44, losses: 38, conf: 'E', seed: 9 },
  { id: 'MIA', name: 'Miami Heat',              wins: 43, losses: 39, conf: 'E', seed: 10 },
  // EAST — lottery
  { id: 'MIL', name: 'Milwaukee Bucks',         wins: 32, losses: 50, conf: 'E', seed: 11 },
  { id: 'CHI', name: 'Chicago Bulls',           wins: 31, losses: 51, conf: 'E', seed: 12 },
  { id: 'BKN', name: 'Brooklyn Nets',           wins: 20, losses: 62, conf: 'E', seed: 13 },
  { id: 'IND', name: 'Indiana Pacers',          wins: 19, losses: 63, conf: 'E', seed: 14 },
  { id: 'WAS', name: 'Washington Wizards',      wins: 17, losses: 65, conf: 'E', seed: 15 },

  // WEST — direct playoff (1-6)
  { id: 'OKC', name: 'Oklahoma City Thunder',   wins: 64, losses: 18, conf: 'W', seed: 1 },
  { id: 'SAS', name: 'San Antonio Spurs',       wins: 62, losses: 20, conf: 'W', seed: 2 },
  { id: 'DEN', name: 'Denver Nuggets',          wins: 54, losses: 28, conf: 'W', seed: 3 },
  { id: 'LAL', name: 'Los Angeles Lakers',      wins: 53, losses: 29, conf: 'W', seed: 4 },
  { id: 'HOU', name: 'Houston Rockets',         wins: 52, losses: 30, conf: 'W', seed: 5 },
  { id: 'MIN', name: 'Minnesota Timberwolves',  wins: 49, losses: 33, conf: 'W', seed: 6 },
  // WEST — play-in (7-10 by record)
  { id: 'PHX', name: 'Phoenix Suns',            wins: 45, losses: 37, conf: 'W', seed: 7 },
  { id: 'LAC', name: 'Los Angeles Clippers',    wins: 42, losses: 40, conf: 'W', seed: 8 },
  { id: 'POR', name: 'Portland Trail Blazers',  wins: 42, losses: 40, conf: 'W', seed: 9 },
  { id: 'GSW', name: 'Golden State Warriors',   wins: 37, losses: 45, conf: 'W', seed: 10 },
  // WEST — lottery
  { id: 'NOP', name: 'New Orleans Pelicans',    wins: 26, losses: 56, conf: 'W', seed: 11 },
  { id: 'DAL', name: 'Dallas Mavericks',        wins: 26, losses: 56, conf: 'W', seed: 12 },
  { id: 'MEM', name: 'Memphis Grizzlies',       wins: 25, losses: 57, conf: 'W', seed: 13 },
  { id: 'SAC', name: 'Sacramento Kings',        wins: 22, losses: 60, conf: 'W', seed: 14 },
  { id: 'UTA', name: 'Utah Jazz',               wins: 22, losses: 60, conf: 'W', seed: 15 },
];

// ── 2026 Playoff first round (R1 results only, R2+ TBD) ──
// East R1: DET d ORL 4-3, BOS l PHI 4-3, NYK d ATL 4-2, CLE d TOR 4-3
// West R1: OKC d PHX 4-0, SAS d POR 4-1, DEN l MIN 4-2, LAL d HOU 4-2
// Play-in advancers (made playoffs as 7/8 seeds): PHI, ORL (East), POR, PHX (West).
// Play-in losers (didn't make playoffs): CHA, MIA, LAC, GSW.

const R1_WINNERS = new Set(['DET', 'PHI', 'NYK', 'CLE', 'OKC', 'SAS', 'MIN', 'LAL']);
const R1_LOSERS  = new Set(['ORL', 'BOS', 'ATL', 'TOR', 'PHX', 'POR', 'DEN', 'HOU']);
const PLAYIN_ADVANCED = new Set(['PHI', 'ORL', 'POR', 'PHX']);
const PLAYIN_PARTICIPANT = new Set(['PHI', 'ORL', 'CHA', 'MIA', 'PHX', 'LAC', 'POR', 'GSW']);

// Playoff seeds (1-8) per conference, from R1 bracket pairings.
// East R1: DET(1)vsORL(8), BOS(2)vsPHI(7), NYK(3)vsATL(6), CLE(4)vsTOR(5).
// West R1: OKC(1)vsPHX(8), SAS(2)vsPOR(7), DEN(3)vsMIN(6), LAL(4)vsHOU(5).
// Source: ESPN 2026 NBA playoff bracket.
const PLAYOFF_SEEDS = {
  // East
  DET: 1, BOS: 2, NYK: 3, CLE: 4, TOR: 5, ATL: 6, PHI: 7, ORL: 8,
  // West
  OKC: 1, SAS: 2, DEN: 3, LAL: 4, HOU: 5, MIN: 6, POR: 7, PHX: 8,
};

function buildTeam(t) {
  const playoffParticipant = R1_WINNERS.has(t.id) || R1_LOSERS.has(t.id);
  const madePlayoffs = playoffParticipant;

  // R1 losers: playoffResult = 'first_round' (engine applies pre-lottery
  //   diminishment of -20% direct or -10% play-in advancer).
  // R1 winners (still alive in R2+): playoffResult = null. Engine treats
  //   as no current-season diminishment yet, correct for pre-lottery
  //   live snapshot.
  // Non-playoff teams: playoffResult = null.
  let playoffResult = null;
  if (R1_LOSERS.has(t.id)) playoffResult = 'first_round';

  const seriesWon = R1_WINNERS.has(t.id) ? 1 : 0;

  return {
    id: t.id,
    name: t.name,
    wins: t.wins,
    losses: t.losses,
    madePlayoffs,
    playoffResult,
    seriesWon,
    draftPick: null, // Lottery has not occurred yet; live projection.
    playInParticipant: PLAYIN_PARTICIPANT.has(t.id),
    playInAdvanced: PLAYIN_ADVANCED.has(t.id),
    playoffSeed: PLAYOFF_SEEDS[t.id] !== undefined ? PLAYOFF_SEEDS[t.id] : null,
  };
}

// ── Append to dataset, preserving the existing numeric-key ordering ──
const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));

// Idempotency: replace existing 2026 entry if present so the script
// can be re-run after spec corrections.
const existingIdx = data.seasons.findIndex(s => s.year === 2026);
if (existingIdx !== -1) {
  data.seasons.splice(existingIdx, 1);
  console.log('Existing 2026 entry removed; will replace.');
}

// Preserve the same array ordering as the most recent season. The
// engine iterates `season.teams` as an array; positional ordering
// matches across seasons for tooling consistency.
const lastSeason = data.seasons[data.seasons.length - 1];
const idToIndex = {};
lastSeason.teams.forEach((team, i) => { idToIndex[team.id] = i; });

// Verify all 30 ids are accounted for.
for (const t of SEASON_2026) {
  if (!(t.id in idToIndex)) {
    console.error(`Team ID ${t.id} not found in last season's mapping. Aborting.`);
    process.exit(1);
  }
}

const teams = new Array(30);
for (const t of SEASON_2026) {
  teams[idToIndex[t.id]] = buildTeam(t);
}

const newSeason = {
  year: 2026,
  teams,
};

data.seasons.push(newSeason);

fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));

// ── Summary output ──
console.log(`Appended 2025-26 season (year=2026) with ${Object.keys(teams).length} teams.`);
console.log('');
console.log('Playoff state snapshot (post R1, pre R2):');
console.log('  R1 winners (alive, no current-season diminishment yet):');
for (const id of R1_WINNERS) console.log('    ', id);
console.log('  R1 losers (will get pre-lottery diminishment in Capped):');
for (const id of R1_LOSERS) {
  const isPlayin = PLAYIN_ADVANCED.has(id);
  console.log('    ', id, isPlayin ? '(play-in advancer R1 loser, -10%)' : '(direct R1 loser, -20%)');
}
console.log('  Play-in losers (lottery teams):');
console.log('    East: CHA, MIA');
console.log('    West: LAC, GSW');
console.log('  Lottery teams (no playoffs):');
const lotteryEast = ['MIL','CHI','BKN','IND','WAS'];
const lotteryWest = ['NOP','DAL','MEM','SAC','UTA'];
console.log('    East:', lotteryEast.join(', '));
console.log('    West:', lotteryWest.join(', '));
console.log('  All 30 teams have draftPick=null (lottery not yet held).');
