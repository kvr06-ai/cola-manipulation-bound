#!/usr/bin/env node
/**
 * Comprehensive audit of the live 2026 NBA Draft Lottery projection
 * across all six variants in the COLA Explorer.
 *
 * Each check has a clear PASS/FAIL with the source-of-truth citation.
 *
 * Source-of-truth references:
 *   - 2025-26 standings: ESPN + plaintextsports.com (cross-verified).
 *   - 2026 NBA Playoffs first-round bracket: ESPN.
 *   - 3-2-1 lottery proposal: Highley's Substack
 *     (https://highleytj.substack.com/p/a-professional-draft-reform-researcher).
 *   - CBS Sports explainer for 3-2-1 mechanics
 *     (https://www.cbssports.com/nba/news/nba-new-draft-lottery-system-tanking/).
 */

const path = require('path');
const fs = require('fs');

const eng = require(path.join(__dirname, '..', 'docs', 'js', 'cola-engine.js'));
const data = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'docs', 'data', 'nba-data.json'), 'utf-8')
);

const TARGET_YEAR = 2026;
const season = data.seasons.find((s) => s.year === TARGET_YEAR);
const all = eng.computeAllVariants(data.seasons, 150);

let pass = 0;
let fail = 0;
const failures = [];

function check(label, condition, detail) {
  if (condition) {
    pass++;
    console.log('  PASS  ' + label);
  } else {
    fail++;
    failures.push({ label, detail });
    console.log('  FAIL  ' + label + (detail ? '   (' + detail + ')' : ''));
  }
}

console.log('=== AUDIT: 2025-26 NBA SEASON DATA ===\n');

console.log('Regular-season records (cross-checked vs ESPN + plaintextsports.com):');
const expectedRecords = {
  // East
  DET: [60, 22], BOS: [56, 26], NYK: [53, 29], CLE: [52, 30],
  TOR: [46, 36], ATL: [46, 36], PHI: [45, 37], ORL: [45, 37],
  CHA: [44, 38], MIA: [43, 39], MIL: [32, 50], CHI: [31, 51],
  BKN: [20, 62], IND: [19, 63], WAS: [17, 65],
  // West
  OKC: [64, 18], SAS: [62, 20], DEN: [54, 28], LAL: [53, 29],
  HOU: [52, 30], MIN: [49, 33], PHX: [45, 37], POR: [42, 40],
  LAC: [42, 40], GSW: [37, 45], NOP: [26, 56], DAL: [26, 56],
  MEM: [25, 57], SAC: [22, 60], UTA: [22, 60],
};
for (const [id, [w, l]] of Object.entries(expectedRecords)) {
  const t = season.teams.find((t) => t.id === id);
  check(
    id + ' ' + w + '-' + l,
    t && t.wins === w && t.losses === l,
    t ? 'got ' + t.wins + '-' + t.losses : 'team not found'
  );
}

console.log('\nPlayoff-bracket structural invariants (from ESPN bracket):');
check(
  'East R1: DET(1) beat ORL(8) 4-3',
  season.teams.find((t) => t.id === 'DET').seriesWon === 1 &&
    season.teams.find((t) => t.id === 'ORL').playoffResult === 'first_round'
);
check(
  'East R1: PHI(7) beat BOS(2) 4-3 (upset)',
  season.teams.find((t) => t.id === 'PHI').seriesWon === 1 &&
    season.teams.find((t) => t.id === 'BOS').playoffResult === 'first_round'
);
check(
  'East R1: NYK(3) beat ATL(6) 4-2',
  season.teams.find((t) => t.id === 'NYK').seriesWon === 1 &&
    season.teams.find((t) => t.id === 'ATL').playoffResult === 'first_round'
);
check(
  'East R1: CLE(4) beat TOR(5) 4-3',
  season.teams.find((t) => t.id === 'CLE').seriesWon === 1 &&
    season.teams.find((t) => t.id === 'TOR').playoffResult === 'first_round'
);
check(
  'West R1: OKC(1) beat PHX(8) 4-0',
  season.teams.find((t) => t.id === 'OKC').seriesWon === 1 &&
    season.teams.find((t) => t.id === 'PHX').playoffResult === 'first_round'
);
check(
  'West R1: SAS(2) beat POR(7) 4-1',
  season.teams.find((t) => t.id === 'SAS').seriesWon === 1 &&
    season.teams.find((t) => t.id === 'POR').playoffResult === 'first_round'
);
check(
  'West R1: MIN(6) beat DEN(3) 4-2 (upset)',
  season.teams.find((t) => t.id === 'MIN').seriesWon === 1 &&
    season.teams.find((t) => t.id === 'DEN').playoffResult === 'first_round'
);
check(
  'West R1: LAL(4) beat HOU(5) 4-2',
  season.teams.find((t) => t.id === 'LAL').seriesWon === 1 &&
    season.teams.find((t) => t.id === 'HOU').playoffResult === 'first_round'
);

console.log('\nPlay-in tournament outcomes (from ESPN + Olympics article):');
check(
  'East 7-seed playoff = PHI (won 7v8)',
  season.teams.find((t) => t.id === 'PHI').playoffSeed === 7
);
check(
  'East 8-seed playoff = ORL (lost 7v8, won Game 3)',
  season.teams.find((t) => t.id === 'ORL').playoffSeed === 8
);
check(
  'West 7-seed playoff = POR (won 7v8 against PHX)',
  season.teams.find((t) => t.id === 'POR').playoffSeed === 7
);
check(
  'West 8-seed playoff = PHX (lost 7v8, beat GSW in Game 3)',
  season.teams.find((t) => t.id === 'PHX').playoffSeed === 8
);
check(
  'CHA, MIA play-in losers (East)',
  season.teams.find((t) => t.id === 'CHA').playInParticipant &&
    !season.teams.find((t) => t.id === 'CHA').playInAdvanced &&
    season.teams.find((t) => t.id === 'MIA').playInParticipant &&
    !season.teams.find((t) => t.id === 'MIA').playInAdvanced
);
check(
  'LAC, GSW play-in losers (West)',
  season.teams.find((t) => t.id === 'LAC').playInParticipant &&
    !season.teams.find((t) => t.id === 'LAC').playInAdvanced &&
    season.teams.find((t) => t.id === 'GSW').playInParticipant &&
    !season.teams.find((t) => t.id === 'GSW').playInAdvanced
);

console.log('\n=== AUDIT: 3-2-1 LOTTERY (Substack alignment) ===\n');

const tank = all.tank321[2026];

// Substack states 16 teams, 37 balls, 2.7% per ball
check('3-2-1 has 16 teams (Substack: "16 teams in the lottery")', tank.draftOrder.length === 16);
check('3-2-1 has 37 total balls (Substack: "With 37 total lottery balls")', tank.totalBalls === 37);

// Substack states "2.7%, 5.4%, or 8.1% chance" depending on balls
const probMap = {};
tank.draftOrder.forEach((t) => {
  const prob = +(t.probability * 100).toFixed(2);
  probMap[t.balls] = prob;
});
check(
  '1 ball -> 2.70% per team (Substack: 2.7%)',
  Math.abs(probMap[1] - 2.7) < 0.05,
  'got ' + probMap[1] + '%'
);
check(
  '2 balls -> 5.41% per team (Substack: 5.4%)',
  Math.abs(probMap[2] - 5.41) < 0.05,
  'got ' + probMap[2] + '%'
);
check(
  '3 balls -> 8.11% per team (Substack: 8.1%)',
  Math.abs(probMap[3] - 8.11) < 0.05,
  'got ' + probMap[3] + '%'
);

const tier1 = tank.draftOrder.filter((t) => t.balls === 2 && t.wins <= 22).map((t) => t.id).sort();
const tier2 = tank.draftOrder.filter((t) => t.balls === 3).map((t) => t.id).sort();
const tier3 = tank.draftOrder.filter((t) => t.balls === 2 && t.wins > 22).map((t) => t.id).sort();
const tier4 = tank.draftOrder.filter((t) => t.balls === 1).map((t) => t.id).sort();

check(
  'Tier 1 (bottom 3 by record, 2 balls): WAS, IND, BKN',
  JSON.stringify(tier1) === JSON.stringify(['BKN', 'IND', 'WAS'])
);
check(
  'Tier 2 (mid 7 non-play-in, 3 balls): MIL, CHI, NOP, DAL, MEM, UTA, SAC',
  JSON.stringify(tier2) === JSON.stringify(['CHI', 'DAL', 'MEM', 'MIL', 'NOP', 'SAC', 'UTA'])
);
check(
  'Tier 3 (record-9/10 in lottery, 2 balls): CHA, MIA, LAC, GSW',
  JSON.stringify(tier3) === JSON.stringify(['CHA', 'GSW', 'LAC', 'MIA'])
);
check(
  'Tier 4 (7v8 game losers, 1 ball): ORL, PHX',
  JSON.stringify(tier4) === JSON.stringify(['ORL', 'PHX'])
);

// Substack: "A team could be in the playoffs and even win in the playoffs but still be in the lottery"
const playoffsAndLottery = tank.draftOrder.filter(
  (t) => season.teams.find((tm) => tm.id === t.id).madePlayoffs
);
check(
  'Some lottery teams ALSO in playoffs (Substack edge case)',
  playoffsAndLottery.length === 2 &&
    playoffsAndLottery.map((t) => t.id).sort().join(',') === 'ORL,PHX'
);

console.log('\n=== AUDIT: COLA VARIANTS pool composition ===\n');

check(
  'Simple COLA pool size = 22 (14 non-playoff + 8 R1 losers)',
  all.simple[2026].draftOrder.length === 22
);
check(
  'Simple Lottery COLA pool size = 22',
  all.simpleLottery[2026].draftOrder.length === 22
);
check(
  'Classic COLA pool size = 14 (non-playoff only)',
  all.classic[2026].draftOrder.length === 14
);
check(
  'Countdown COLA pool size = 22',
  all.countdown[2026].draftOrder.length === 22
);
const cappedPool = all.capped[2026].draftOrder.length;
check(
  'Capped COLA pool size 9-17 (drought-based eligibility, depends on data)',
  cappedPool >= 9 && cappedPool <= 17,
  'got ' + cappedPool
);

console.log('\n=== AUDIT: probability sums ===\n');
for (const [name, r] of Object.entries(all)) {
  const yr = r[2026];
  const probs = yr.draftOrder.map((t) => t.probability).filter((p) => p !== null && p !== undefined);
  const sum = probs.reduce((a, b) => a + b, 0);
  if (probs.length === 0) continue;
  check(
    name + ' probability sum = 1.0000 (currently ' + sum.toFixed(4) + ')',
    Math.abs(sum - 1.0) < 0.005
  );
}

console.log('\n=== AUDIT: Capped COLA cap-binding teams ===\n');
const atCap = all.capped[2026].draftOrder.filter((t) => t.index === 150);
check(
  'Teams at MAX=150 cap >= 1 in 2026 (long-rebuild franchises)',
  atCap.length >= 1
);
check(
  'Teams at MAX=150 cap <= 4 (Highley target: "no more than 3-4")',
  atCap.length <= 4,
  'got ' + atCap.length
);

console.log('\n=== AUDIT: Cross-variant top-ranked team ===\n');
const top = {};
for (const [name, r] of Object.entries(all)) {
  top[name] = r[2026].draftOrder[0].id;
}
console.log('  Top team per variant:');
for (const [n, id] of Object.entries(top)) console.log('    ' + n.padEnd(15) + ' -> ' + id);

console.log('\n=== SUMMARY ===\n');
console.log('  PASS: ' + pass);
console.log('  FAIL: ' + fail);
if (fail > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log('  - ' + f.label));
  process.exit(1);
}
process.exit(0);
