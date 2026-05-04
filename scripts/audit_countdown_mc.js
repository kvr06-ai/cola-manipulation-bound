#!/usr/bin/env node
/**
 * Reproducible Countdown COLA Monte Carlo for paper Section 6.
 *
 * The production engine (docs/js/cola-engine.js) uses unseeded Math.random()
 * and 10,000 trials, which produces MC noise of ~0.5pp at p=0.3 between runs.
 * This script:
 *   1. Replaces Math.random() with mulberry32 seeded at 42.
 *   2. Reads the same data as the production engine (nba-data.json).
 *   3. Re-implements countdownTrial inline (identical logic to engine).
 *   4. Runs 100,000 trials for 2024-25 — sufficient to make MC variance
 *      negligible at the precision the paper reports (1 decimal place).
 *
 * Usage: node scripts/audit_countdown_mc.js
 *
 * Numbers from this script are the canonical values for the paper.
 * Re-run with the same seed to reproduce.
 */

const path = require('path');
const fs = require('fs');

// ── Seeded PRNG (mulberry32) replaces Math.random ──
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 42;
const TRIALS = 100000;
const rng = mulberry32(SEED);

// ── Engine constants (mirrored from cola-engine.js) ──
const COUNTDOWN_POOL_TICKETS = [6, 5, 4, 3, 2];

function countdownTrial(rankedIds) {
  const remaining = [...rankedIds].reverse();
  const assignment = {};
  const totalPicks = remaining.length;

  for (let pick = totalPicks; pick >= 1; pick--) {
    if (remaining.length === 1) {
      assignment[remaining[0]] = pick;
      break;
    }

    const poolSize = Math.min(5, remaining.length);
    const pool = remaining.slice(0, poolSize);
    const tickets = COUNTDOWN_POOL_TICKETS.slice(0, poolSize);
    const ticketTotal = tickets.reduce((a, b) => a + b, 0);

    const roll = rng() * ticketTotal;
    let cumulative = 0;
    let drawn = 0;
    for (let i = 0; i < poolSize; i++) {
      cumulative += tickets[i];
      if (roll < cumulative) {
        drawn = i;
        break;
      }
    }

    assignment[pool[drawn]] = pick;
    remaining.splice(drawn, 1);
  }

  return assignment;
}

function countdownMonteCarlo(rankedIds) {
  const n = rankedIds.length;
  const pickCounts = {};
  for (const id of rankedIds) {
    pickCounts[id] = new Array(n).fill(0);
  }
  for (let t = 0; t < TRIALS; t++) {
    const assignment = countdownTrial(rankedIds);
    for (const [id, pick] of Object.entries(assignment)) {
      pickCounts[id][pick - 1] += 1;
    }
  }
  const result = {};
  for (const id of rankedIds) {
    const probs = pickCounts[id].map(c => c / TRIALS);
    const expected = probs.reduce((sum, p, i) => sum + p * (i + 1), 0);
    result[id] = { pickProbs: probs, expectedPick: expected };
  }
  return result;
}

// ── Load data and replicate engine's drought + McCarty computation ──
const nba = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'docs', 'data', 'nba-data.json'), 'utf-8')
);

const TARGET_YEAR = 2025;

// Compute drought up to and including TARGET_YEAR for every team.
// Drought = consecutive seasons without a playoff series win OR top-3 lottery pick.
const teamHistory = {};
for (const season of nba.seasons) {
  for (const team of Object.values(season.teams)) {
    const teamId = team.id;
    if (!teamHistory[teamId]) teamHistory[teamId] = [];
    teamHistory[teamId].push({
      year: season.year,
      seriesWon: team.seriesWon || 0,
      draftPick: team.draftPick,
    });
  }
}

function computeDrought(teamId, throughYear) {
  const history = (teamHistory[teamId] || []).filter(h => h.year <= throughYear);
  let drought = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    const seriesWin = h.seriesWon > 0;
    const top3 = h.draftPick !== null && h.draftPick !== undefined && h.draftPick <= 3;
    if (seriesWin || top3) break;
    drought += 1;
  }
  return drought;
}

// Build the 2024-25 Countdown pool: 22 teams with seriesWon === 0
const targetSeason = nba.seasons.find(s => s.year === TARGET_YEAR);
const eligible = [];
for (const team of Object.values(targetSeason.teams)) {
  if ((team.seriesWon || 0) === 0) {
    const teamId = team.id;
    const drought = computeDrought(teamId, TARGET_YEAR);
    const mccarty = drought * (team.wins || 0);
    eligible.push({ teamId, mccarty, wins: team.wins || 0, drought });
  }
}

// Sort by McCarty desc, tiebreak by wins desc
eligible.sort((a, b) => {
  if (b.mccarty !== a.mccarty) return b.mccarty - a.mccarty;
  return b.wins - a.wins;
});

const rankedIds = eligible.map(e => e.teamId);

console.log(`Countdown COLA Monte Carlo: ${TARGET_YEAR}, seed=${SEED}, trials=${TRIALS.toLocaleString()}`);
console.log('='.repeat(80));
console.log('Pool (22 teams) ordered by McCarty:');
eligible.forEach((e, i) => {
  console.log(`  ${(i + 1).toString().padStart(2)}. ${e.teamId.padEnd(4)} mccarty=${e.mccarty.toString().padStart(4)}  drought=${e.drought}  wins=${e.wins}`);
});
console.log('');

const mc = countdownMonteCarlo(rankedIds);

console.log('Top 10 results:');
console.log('  Rank Team  McCarty   P[#1]    E[pick]');
console.log('  ----+-----+--------+--------+--------');
for (let i = 0; i < 10; i++) {
  const e = eligible[i];
  const r = mc[e.teamId];
  const p1 = (r.pickProbs[0] * 100).toFixed(1);
  const ep = r.expectedPick.toFixed(2);
  console.log(`  ${(i + 1).toString().padStart(2)}.  ${e.teamId.padEnd(4)}  ${e.mccarty.toString().padStart(5)}    ${p1.padStart(4)}%    ${ep.padStart(5)}`);
}

console.log('');
console.log('Paper case-study numbers (Sec 6 case-mil):');
['CHI', 'SAC', 'LAC', 'DET', 'TOR', 'MEM', 'MIL'].forEach(id => {
  const r = mc[id];
  if (!r) {
    console.log(`  ${id}: not in pool`);
    return;
  }
  const e = eligible.find(x => x.teamId === id);
  console.log(`  ${id} (McCarty ${e.mccarty}): P[#1]=${(r.pickProbs[0] * 100).toFixed(1)}%  E[pick]=${r.expectedPick.toFixed(2)}`);
});
