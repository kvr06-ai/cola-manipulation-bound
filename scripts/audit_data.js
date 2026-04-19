#!/usr/bin/env node
/**
 * Comprehensive data audit for nba-data.json.
 *
 * Checks:
 *   1. Team count per season (29 pre-2005; 30 from 2004-05 onward).
 *   2. Playoff field integrity (16 teams; 1 champion; 1 finals; 2 conf_finals;
 *      4 second_round; 8 first_round).
 *   3. seriesWon consistency with playoffResult
 *      (champion=4, finals=3, conf_finals=2, second_round=1, first_round=0).
 *   4. Win+loss totals per team-season (82 standard; 50 for 1998-99 lockout,
 *      66 for 2011-12 lockout, 65-73 for 2019-20 bubble, 72 for 2020-21).
 *   5. Draft pick range (1-30 non-null; picks assigned correctly).
 *   6. Lottery picks: exactly 14 non-playoff teams receive picks 1-14
 *      (after lottery-day attribution).
 *   7. Conference balance where derivable.
 *   8. Trade metadata cross-references.
 *
 * Reports all issues found, plus per-season summary.
 */

const path = require('path');
const fs = require('fs');

const dataPath = path.join(__dirname, '..', 'docs', 'data', 'nba-data.json');
const tradePath = path.join(__dirname, '..', 'docs', 'data', 'trade-metadata.json');

const nbaData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
const tradeData = JSON.parse(fs.readFileSync(tradePath, 'utf-8'));

// =============================================================================
// Conference map (year-aware).
//
// Stable teams:
//   East (15 in the modern era): ATL BOS BKN CHA CHI CLE DET IND MIA MIL NYK
//                                ORL PHI TOR WAS
//   West (15 in the modern era): DAL DEN GSW HOU LAC LAL MEM MIN NOP OKC PHX
//                                POR SAC SAS UTA
//
// Historical exception: NOP represents the franchise lineage
//   Charlotte Hornets (1988-2002) -> New Orleans Hornets (2002-2013) ->
//   New Orleans Pelicans (2013-present). This franchise was in the
//   Eastern Conference through 2003-04 season (year 2004 in our dataset)
//   and moved to the Western Conference in the 2004-05 realignment
//   (coincident with the Charlotte Bobcats expansion, now tracked as
//   CHA from year 2005 onward).
// =============================================================================
const EASTERN_MODERN = new Set([
  'ATL', 'BOS', 'BKN', 'CHA', 'CHI', 'CLE', 'DET', 'IND',
  'MIA', 'MIL', 'NYK', 'ORL', 'PHI', 'TOR', 'WAS',
]);
const WESTERN_MODERN = new Set([
  'DAL', 'DEN', 'GSW', 'HOU', 'LAC', 'LAL', 'MEM', 'MIN',
  'NOP', 'OKC', 'PHX', 'POR', 'SAC', 'SAS', 'UTA',
]);

function conferenceOf(teamId, year) {
  // Pre-2005 realignment: NOP lineage (CHA Hornets / NOH Hornets) was East.
  if (teamId === 'NOP' && year <= 2004) return 'E';
  if (EASTERN_MODERN.has(teamId)) return 'E';
  if (WESTERN_MODERN.has(teamId)) return 'W';
  return null;
}

// =============================================================================
// Expected game counts per season (accommodates lockouts and COVID)
// =============================================================================
const EXPECTED_GAMES = {
  // 2019-20 bubble: teams played varied games (64-75). Looser tolerance.
  2020: { min: 60, max: 76, isUneven: true },
  // 2020-21 shortened season: 72 games
  2021: { min: 72, max: 72, isUneven: false },
  // 2011-12 lockout: 66 games (not in our dataset range but safe to include)
  2012: { min: 66, max: 66, isUneven: false },
};
const DEFAULT_GAMES = { min: 82, max: 82, isUneven: false };

function expectedGames(year) {
  return EXPECTED_GAMES[year] || DEFAULT_GAMES;
}

// =============================================================================
// Playoff result distribution per season
// =============================================================================
const EXPECTED_PLAYOFF_DISTRIBUTION = {
  champion: 1,
  finals: 1,
  conf_finals: 2,
  second_round: 4,
  first_round: 8,
};

const SERIES_WON_BY_RESULT = {
  champion: 4,
  finals: 3,
  conf_finals: 2,
  second_round: 1,
  first_round: 0,
};

// =============================================================================
// Audit runner
// =============================================================================

const issues = [];
const perSeasonSummary = [];

function report(level, year, msg) {
  issues.push({ level, year, msg });
}

for (const season of nbaData.seasons) {
  const year = season.year;
  const teams = season.teams;
  const expected = expectedGames(year);

  const summary = {
    year,
    teamCount: teams.length,
    playoffCount: teams.filter(t => t.madePlayoffs).length,
    lotteryPicks: 0,
    unknownConference: 0,
  };

  // Check 1: Team count
  const expectedTeams = year <= 2004 ? 29 : 30;
  if (teams.length !== expectedTeams) {
    report('ERROR', year, `Expected ${expectedTeams} teams, found ${teams.length}`);
  }

  // Check 2: Playoff count
  if (summary.playoffCount !== 16) {
    report('ERROR', year, `Expected 16 playoff teams, found ${summary.playoffCount}`);
  }

  // Check 3: Playoff result distribution
  const resultCounts = {};
  for (const t of teams) {
    if (t.playoffResult) {
      resultCounts[t.playoffResult] = (resultCounts[t.playoffResult] || 0) + 1;
    }
  }
  for (const [result, expectedCount] of Object.entries(EXPECTED_PLAYOFF_DISTRIBUTION)) {
    const actual = resultCounts[result] || 0;
    if (actual !== expectedCount) {
      report('ERROR', year, `Expected ${expectedCount} '${result}' teams, found ${actual}`);
    }
  }

  // Check 4: seriesWon consistency
  for (const t of teams) {
    if (!t.playoffResult) {
      if (t.seriesWon !== 0) {
        report('ERROR', year, `${t.id} has no playoffResult but seriesWon=${t.seriesWon}`);
      }
      if (t.madePlayoffs) {
        report('ERROR', year, `${t.id} has madePlayoffs=true but no playoffResult`);
      }
      continue;
    }
    const expectedSW = SERIES_WON_BY_RESULT[t.playoffResult];
    if (expectedSW === undefined) {
      report('ERROR', year, `${t.id} has unknown playoffResult '${t.playoffResult}'`);
    } else if (t.seriesWon !== expectedSW) {
      report('ERROR', year, `${t.id} playoffResult='${t.playoffResult}' expects seriesWon=${expectedSW}, found ${t.seriesWon}`);
    }
    if (!t.madePlayoffs) {
      report('ERROR', year, `${t.id} has playoffResult='${t.playoffResult}' but madePlayoffs=false`);
    }
  }

  // Check 5: W+L totals
  for (const t of teams) {
    const total = t.wins + t.losses;
    if (total < expected.min || total > expected.max) {
      const severity = expected.isUneven ? 'INFO' : 'WARN';
      report(severity, year, `${t.id} played ${total} games (expected ${expected.min}-${expected.max})`);
    }
  }

  // Check 6: Draft pick validity
  const picksSeen = {};
  for (const t of teams) {
    if (t.draftPick === null || t.draftPick === undefined) continue;
    if (t.draftPick < 1 || t.draftPick > 30) {
      report('ERROR', year, `${t.id} has invalid draftPick ${t.draftPick}`);
    }
    if (picksSeen[t.draftPick]) {
      report('ERROR', year, `Pick ${t.draftPick} assigned to both ${picksSeen[t.draftPick]} and ${t.id}`);
    }
    picksSeen[t.draftPick] = t.id;
    if (t.draftPick <= 14) summary.lotteryPicks += 1;
  }

  // Check 7: Lottery picks (14 picks 1-14)
  for (let i = 1; i <= 14; i++) {
    if (!picksSeen[i]) {
      report('WARN', year, `No team has draftPick=${i}`);
    }
  }

  // Check 8: Lottery picks should go to non-playoff teams (pre-2020) or
  // non-playoff + non-play-in-advancers (post-2020). After lottery-day
  // attribution, a pick held by a team that made playoffs indicates a
  // post-lottery trade that we've corrected for (e.g., BKN 2017).
  // This is not an error, but we'll flag for the post-2020 era.
  for (const t of teams) {
    if (t.draftPick !== null && t.draftPick <= 14 && t.madePlayoffs) {
      // Only report if no trade metadata explains it
      const tradeLookup = tradeData.trades.find(
        tr => tr.year === year && tr.pick === t.draftPick
      );
      if (!tradeLookup) {
        report('WARN', year, `${t.id} has lottery pick ${t.draftPick} but made playoffs (no trade found)`);
      }
    }
  }

  // Check 9: Conference membership
  for (const t of teams) {
    const conf = conferenceOf(t.id, year);
    if (!conf) {
      summary.unknownConference += 1;
      report('ERROR', year, `${t.id} has unknown conference`);
    }
  }

  // Check 10: Conference playoff counts (8 East + 8 West)
  const playoffByConf = { E: 0, W: 0 };
  for (const t of teams) {
    if (t.madePlayoffs) {
      const c = conferenceOf(t.id, year);
      if (c) playoffByConf[c] += 1;
    }
  }
  if (playoffByConf.E !== 8) report('ERROR', year, `Expected 8 East playoff teams, found ${playoffByConf.E}`);
  if (playoffByConf.W !== 8) report('ERROR', year, `Expected 8 West playoff teams, found ${playoffByConf.W}`);

  summary.eastPlayoff = playoffByConf.E;
  summary.westPlayoff = playoffByConf.W;
  perSeasonSummary.push(summary);
}

// =============================================================================
// Trade metadata cross-reference
// =============================================================================
for (const tr of tradeData.trades) {
  const season = nbaData.seasons.find(s => s.year === tr.year);
  if (!season) {
    report('ERROR', tr.year, `Trade entry ${tr.year} #${tr.pick} references missing season`);
    continue;
  }
  const receiver = season.teams.find(t => t.id === tr.receivedBy);
  if (!receiver) {
    report('ERROR', tr.year, `Trade ${tr.year} #${tr.pick}: receivedBy team '${tr.receivedBy}' not found`);
    continue;
  }
  if (receiver.draftPick !== tr.pick) {
    report('WARN', tr.year, `Trade ${tr.year} #${tr.pick}: ${tr.receivedBy} has draftPick=${receiver.draftPick}, expected ${tr.pick}`);
  }
  const origOwner = season.teams.find(t => t.id === tr.originalOwner);
  if (!origOwner) {
    report('ERROR', tr.year, `Trade ${tr.year} #${tr.pick}: originalOwner '${tr.originalOwner}' not found`);
  }
}

// =============================================================================
// Report
// =============================================================================

console.log('='.repeat(88));
console.log('DATA AUDIT — nba-data.json + trade-metadata.json');
console.log('='.repeat(88));

const errors = issues.filter(i => i.level === 'ERROR');
const warns = issues.filter(i => i.level === 'WARN');
const infos = issues.filter(i => i.level === 'INFO');

console.log(`\nTotal issues: ${issues.length} (${errors.length} ERRORS, ${warns.length} WARNINGS, ${infos.length} INFO)`);
console.log(`Seasons audited: ${nbaData.seasons.length} (${nbaData.seasons[0].year} - ${nbaData.seasons[nbaData.seasons.length - 1].year})`);

if (errors.length > 0) {
  console.log('\n--- ERRORS ---');
  errors.forEach(i => console.log(`  [${i.year}] ${i.msg}`));
}
if (warns.length > 0) {
  console.log('\n--- WARNINGS ---');
  warns.forEach(i => console.log(`  [${i.year}] ${i.msg}`));
}
if (infos.length > 0) {
  console.log('\n--- INFO (expected variation, e.g., 2019-20 bubble) ---');
  infos.forEach(i => console.log(`  [${i.year}] ${i.msg}`));
}

console.log('\n--- PER-SEASON SUMMARY ---');
console.log('Year  Teams  Playoff  E/W   LottPicks  UnkConf');
console.log('-'.repeat(55));
for (const s of perSeasonSummary) {
  console.log(
    String(s.year).padEnd(6) +
    String(s.teamCount).padEnd(7) +
    String(s.playoffCount).padEnd(9) +
    `${s.eastPlayoff}/${s.westPlayoff}`.padEnd(6) +
    String(s.lotteryPicks).padEnd(11) +
    String(s.unknownConference)
  );
}

if (errors.length === 0) {
  console.log('\nPASS: No errors detected.');
  process.exit(0);
} else {
  console.log(`\nFAIL: ${errors.length} error(s) detected.`);
  process.exit(1);
}
