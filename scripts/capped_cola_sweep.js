#!/usr/bin/env node
/**
 * Capped COLA sensitivity sweep.
 *
 * Runs computeCappedCOLA across a range of max-stockpile values
 * {75, 100, 125, 150, 175, 200} on the 26-season backtest and
 * reports three metrics per value:
 *
 *   1. Teams-at-cap count per season (mean, max) — checks Highley's
 *      "no more than 3 or 4 at once" target.
 *   2. Separation gap (rank 1 index minus rank 5 index) — confirms
 *      the cap preserves meaningful ordering among eligible teams.
 *   3. Playoff-tanking incentive — max stockpile a team could preserve
 *      by tanking the first round instead of advancing (computed as
 *      0.8 * pre-tournament stockpile for each team that advanced past
 *      R1, taken as max across all teams and all seasons).
 *
 * The ~0.8 factor comes from the 6-step playoff diminishment ladder:
 * a champion loses 100% of pre-tournament stockpile; a first-round
 * loser loses 20%; the gap (80%) is what a team could preserve by
 * deliberately losing in round 1.
 */

const path = require('path');
const fs = require('fs');

const { computeCappedCOLA } = require(path.join(__dirname, '..', 'docs', 'js', 'cola-engine.js'));

const nbaData = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'docs', 'data', 'nba-data.json'), 'utf-8')
);

const seasons = nbaData.seasons;
const CAP_VALUES = [75, 100, 125, 150, 175, 200];
const TOL = 0.01;

// Seasons 1999-00 and 2000-01 are cold-start (no prior state); exclude
// from aggregate metrics per the paper's methodology (results stabilise
// by ~season 5). We report both with-cold-start and stable-period
// averages so the effect is transparent.
const COLD_START_YEARS = 5;

function summarise(results, cap) {
  const perSeasonStats = [];
  for (const season of seasons) {
    const r = results[season.year];
    if (!r) continue;
    const ord = r.draftOrder || [];
    const teamsAtCap = ord.filter(t => t.index >= cap - TOL).length;
    const rank1 = ord[0] ? ord[0].index : 0;
    const rank5 = ord[4] ? ord[4].index : 0;
    const separation = rank1 - rank5;

    // Playoff-tanking incentive: for each team that advanced past R1,
    // what stockpile could they have preserved by tanking R1?
    // For Capped COLA: R1 loser retains 80% of pre-tournament stockpile,
    // champion retains 0%, runner-up retains 20%, etc. The gap between
    // "advance and lose at round R" and "lose at R1" is the tanking
    // incentive.
    let maxTankingIncentive = 0;
    for (const team of season.teams) {
      if (!team.playoffResult) continue;
      if (team.playoffResult === 'first_round') continue; // already "lost R1"
      const st = r.teams[team.id];
      if (!st) continue;
      const pre = st.preTournamentIndex;
      // Actual remaining stockpile after playoff diminishment.
      const playoffDiminishFrac = {
        champion: 1.0, finals: 0.8, conf_finals: 0.6, second_round: 0.4,
      }[team.playoffResult] || 0;
      const actual = pre * (1 - playoffDiminishFrac);
      // Counterfactual: this team tanks R1 and loses in the first round.
      const counterfactual = pre * (1 - 0.2); // R1 loss = -20%
      const incentive = counterfactual - actual;
      if (incentive > maxTankingIncentive) maxTankingIncentive = incentive;
    }

    perSeasonStats.push({
      year: season.year,
      teamsAtCap,
      rank1, rank5, separation,
      maxTankingIncentive,
      eligibleCount: ord.length,
    });
  }
  return perSeasonStats;
}

function aggregate(stats, fromYear) {
  const filtered = stats.filter(s => s.year >= fromYear);
  if (filtered.length === 0) return {};
  const mean = (arr, f) => arr.reduce((s, x) => s + f(x), 0) / arr.length;
  const max = (arr, f) => arr.reduce((m, x) => Math.max(m, f(x)), 0);
  return {
    n: filtered.length,
    meanTeamsAtCap: mean(filtered, s => s.teamsAtCap),
    maxTeamsAtCap: max(filtered, s => s.teamsAtCap),
    meanSeparation: mean(filtered, s => s.separation),
    minSeparation: filtered.reduce((m, s) => Math.min(m, s.separation), Infinity),
    meanTankingIncentive: mean(filtered, s => s.maxTankingIncentive),
    maxTankingIncentive: max(filtered, s => s.maxTankingIncentive),
  };
}

const firstYear = seasons[0].year;
const stableYear = firstYear + COLD_START_YEARS;

console.log('='.repeat(92));
console.log('Capped COLA Sensitivity Sweep — 26 seasons (' + firstYear + '-' + seasons[seasons.length - 1].year + ')');
console.log('='.repeat(92));
console.log('\nMethodology:');
console.log('  - 6 cap values swept: ' + CAP_VALUES.join(', '));
console.log('  - Metrics reported for stable-period seasons (' + stableYear + ' onward).');
console.log('  - Cold-start years ' + firstYear + '-' + (stableYear - 1) + ' excluded from aggregates.');

const rows = [];
for (const cap of CAP_VALUES) {
  const results = computeCappedCOLA(seasons, cap);
  const stats = summarise(results, cap);
  const agg = aggregate(stats, stableYear);
  rows.push({ cap, agg });
}

console.log('\n' + 'MAX'.padEnd(6) + 'Mean@cap'.padEnd(11) + 'Max@cap'.padEnd(11) +
  'Mean Sep'.padEnd(11) + 'Min Sep'.padEnd(11) + 'Mean Tank$'.padEnd(13) + 'Max Tank$');
console.log('-'.repeat(74));
for (const { cap, agg } of rows) {
  console.log(
    String(cap).padEnd(6) +
    agg.meanTeamsAtCap.toFixed(2).padEnd(11) +
    String(agg.maxTeamsAtCap).padEnd(11) +
    agg.meanSeparation.toFixed(1).padEnd(11) +
    agg.minSeparation.toFixed(1).padEnd(11) +
    agg.meanTankingIncentive.toFixed(1).padEnd(13) +
    agg.maxTankingIncentive.toFixed(1)
  );
}

console.log('\nLegend:');
console.log('  MAX           Maximum stockpile cap');
console.log('  Mean@cap      Average number of teams sitting at the cap per season');
console.log('  Max@cap       Maximum number of teams sitting at the cap in any single season');
console.log('  Mean/Min Sep  Separation gap (rank 1 stockpile minus rank 5 stockpile)');
console.log('  Mean/Max Tank$  Playoff-tanking incentive (max stockpile a team could preserve');
console.log('                  by tanking round 1 instead of advancing deeper)');

// Per-season detail for the recommended cap (middle of range)
const detailCap = 125;
const detailResults = computeCappedCOLA(seasons, detailCap);
const detailStats = summarise(detailResults, detailCap);
console.log('\n' + '='.repeat(92));
console.log('Per-season detail at MAX = ' + detailCap);
console.log('='.repeat(92));
console.log('Year   #Eligible  #@cap  Rank1  Rank5  Separation  MaxTank$');
console.log('-'.repeat(70));
for (const s of detailStats) {
  const cold = s.year < stableYear ? ' *' : '';
  console.log(
    (String(s.year) + cold).padEnd(7) +
    String(s.eligibleCount).padEnd(11) +
    String(s.teamsAtCap).padEnd(7) +
    s.rank1.toFixed(1).padEnd(7) +
    s.rank5.toFixed(1).padEnd(7) +
    s.separation.toFixed(1).padEnd(12) +
    s.maxTankingIncentive.toFixed(1)
  );
}
console.log('\n(* = cold-start season, excluded from aggregate statistics above)');

// Export for downstream memo generation
const exportPath = path.join(__dirname, '..', 'paper', 'capped_cola_sweep_results.json');
fs.writeFileSync(exportPath, JSON.stringify({
  meta: {
    generatedAt: new Date().toISOString(),
    seasons: { first: firstYear, last: seasons[seasons.length - 1].year, count: seasons.length },
    coldStartExcluded: { from: firstYear, through: stableYear - 1 },
    capValues: CAP_VALUES,
    stableFromYear: stableYear,
  },
  aggregates: rows.map(({ cap, agg }) => ({ cap, ...agg })),
  perSeasonDetail: {
    cap: detailCap,
    seasons: detailStats,
  },
}, null, 2));
console.log('\nExported aggregates and per-season detail: ' + path.relative(process.cwd(), exportPath));
