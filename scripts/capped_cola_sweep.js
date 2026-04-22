#!/usr/bin/env node
/**
 * Capped COLA sensitivity sweep.
 *
 * Runs computeCappedCOLA across a range of max-stockpile values
 * {75, 100, 125, 150, 175, 200} on the 26-season backtest and
 * reports four metrics per value:
 *
 *   1. Teams-at-cap count per season (mean, max) — checks Highley's
 *      "no more than 3 or 4 at once" target.
 *   2. Separation gap (rank 1 index minus rank 5 index) — confirms
 *      the cap preserves meaningful ordering among eligible teams.
 *   3. MARGINAL per-series bound (Highley's Substack framing, Apr 2026):
 *      theoretical max cost of winning one more playoff series.
 *        - Max marginal = 0.3 × MAX (play-in R1 winner edge case,
 *          going from -10% to -40% diminishment = +30% incremental).
 *        - Typical marginal = 0.2 × MAX (all other series transitions).
 *      At MAX=150: max 45 tickets, typical 30 tickets.
 *   4. CUMULATIVE regret (secondary; kept for appendix reference):
 *      max stockpile a team could preserve by tanking R1 and losing
 *      immediately instead of advancing to realized playoff depth.
 *      For a team realized at depth d, gap = (0.8 - (1 - d)) × pre.
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
    // "Teams at cap" is measured among lottery-eligible teams at end of
    // regular season (post-wins-increment, pre any playoff diminishment)
    // — the moment the cap is binding. This matches Highley's Substack
    // claim "no more than three teams at a time, on average fewer than 2,
    // have a stockpile at the maximum of 150." Non-eligible teams (top 6
    // seeds who won a playoff series) are excluded even if they carry a
    // maxed-out stockpile into the lottery period, since the mechanism's
    // cap-binding question is about the lottery pool.
    let teamsAtCap = 0;
    for (const t of ord) {
      const st = r.teams[t.id];
      if (!st) continue;
      if (st.preLotteryIndex >= cap - TOL) teamsAtCap += 1;
    }
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

function aggregate(stats, fromYear, cap) {
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
    // Marginal per-series bounds (Highley's Substack framing).
    // These are theoretical (depend only on MAX), not empirical, but included
    // here so each MAX row carries its full bound set.
    marginalMaxPerSeries: 0.3 * cap,
    marginalTypicalPerSeries: 0.2 * cap,
    // Cumulative regret (secondary metric, retained for appendix).
    meanCumulativeRegret: mean(filtered, s => s.maxTankingIncentive),
    maxCumulativeRegret: max(filtered, s => s.maxTankingIncentive),
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
  const agg = aggregate(stats, stableYear, cap);
  rows.push({ cap, agg });
}

console.log('\nPrimary table: per-series marginal bound (Substack framing)');
console.log('='.repeat(92));
console.log('MAX'.padEnd(6) + 'Mean@cap'.padEnd(11) + 'Max@cap'.padEnd(11) +
  'Mean Sep'.padEnd(11) + 'Min Sep'.padEnd(11) + 'Max $/series'.padEnd(15) + 'Typ $/series');
console.log('-'.repeat(74));
for (const { cap, agg } of rows) {
  console.log(
    String(cap).padEnd(6) +
    agg.meanTeamsAtCap.toFixed(2).padEnd(11) +
    String(agg.maxTeamsAtCap).padEnd(11) +
    agg.meanSeparation.toFixed(1).padEnd(11) +
    agg.minSeparation.toFixed(1).padEnd(11) +
    agg.marginalMaxPerSeries.toFixed(1).padEnd(15) +
    agg.marginalTypicalPerSeries.toFixed(1)
  );
}

console.log('\nLegend:');
console.log('  MAX            Maximum stockpile cap');
console.log('  Mean@cap       Average number of teams sitting at the cap per season (2005+)');
console.log('  Max@cap        Maximum number of teams at cap in any single season');
console.log('  Mean/Min Sep   Separation gap (rank 1 stockpile minus rank 5 stockpile)');
console.log('  Max $/series   Marginal max cost of winning one more playoff series = 0.3 × MAX');
console.log('                 (play-in R1 winner: -10% to -40% diminishment = +30% incremental)');
console.log('  Typ $/series   Typical marginal cost = 0.2 × MAX (all non-edge-case transitions)');

console.log('\nSecondary (appendix): cumulative regret across full playoff run');
console.log('='.repeat(92));
console.log('MAX'.padEnd(6) + 'Mean Cumul$'.padEnd(15) + 'Max Cumul$'.padEnd(15) + 'Ceiling (0.8 × MAX)');
console.log('-'.repeat(74));
for (const { cap, agg } of rows) {
  console.log(
    String(cap).padEnd(6) +
    agg.meanCumulativeRegret.toFixed(1).padEnd(15) +
    agg.maxCumulativeRegret.toFixed(1).padEnd(15) +
    (0.8 * cap).toFixed(1)
  );
}
console.log('\n  Mean/Max Cumul$  Empirical regret: (0.8 × pre) - ((1 - d) × pre), where d is realized');
console.log('                   diminishment and pre is pre-tournament stockpile (bounded by MAX).');
console.log('                   Theoretical ceiling is 0.8 × MAX (champion at cap).');

// Per-season detail for Highley's chosen cap (Substack default: MAX=150)
const detailCap = 150;
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
