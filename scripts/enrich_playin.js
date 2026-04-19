#!/usr/bin/env node
/**
 * Enriches nba-data.json with play-in tournament fields.
 *
 * Adds per team-season (for post-play-in seasons only):
 *   - playInParticipant: boolean — team was in the play-in tournament
 *   - playInAdvanced:    boolean — team advanced from play-in to playoffs
 *
 * Play-in tournament history:
 *   - 2019-20 (year 2020 in dataset): Bubble format. Only West had a play-in
 *     game, between MEM (8 seed) and POR (9 seed). POR won and became the
 *     8 seed. Single game, both teams classified as play-in participants.
 *   - 2020-21 onward (year 2021+): Standard format. Seeds 7-10 in each
 *     conference participate. 2 advance (become 7 and 8 seeds), 2 are
 *     eliminated.
 *
 * Inference strategy:
 *   For standard play-in seasons (2021+): within each conference, sort
 *   teams by wins descending. Seeds 1-6 are direct playoff qualifiers
 *   (no play-in). Seeds 7-10 are play-in participants. Among play-in
 *   participants, those with madePlayoffs=true advanced; those with
 *   madePlayoffs=false were eliminated.
 *
 *   For 2019-20 bubble: hard-coded (only MEM and POR).
 *
 * For pre-play-in seasons (2020 and earlier, excluding the 2020 bubble
 * special case), both fields are set to false.
 */

const fs = require('fs');
const path = require('path');

const dataPath = path.join(__dirname, '..', 'docs', 'data', 'nba-data.json');
const d = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

// Conference map (year-aware, NOP lineage reassigned in 2004-05 realignment).
const EASTERN_MODERN = new Set([
  'ATL', 'BOS', 'BKN', 'CHA', 'CHI', 'CLE', 'DET', 'IND',
  'MIA', 'MIL', 'NYK', 'ORL', 'PHI', 'TOR', 'WAS',
]);

function conferenceOf(teamId, year) {
  if (teamId === 'NOP' && year <= 2004) return 'E';
  if (EASTERN_MODERN.has(teamId)) return 'E';
  return 'W';
}

// 2019-20 bubble play-in: one West game between MEM (#8) and POR (#9).
// POR won, became 8 seed, made playoffs. MEM lost, eliminated.
const BUBBLE_PLAYIN_2020 = {
  POR: { participant: true, advanced: true },
  MEM: { participant: true, advanced: false },
};

let enrichedCount = 0;

for (const season of d.seasons) {
  const year = season.year;

  // Default all teams to false; overwrite for participants.
  for (const team of season.teams) {
    team.playInParticipant = false;
    team.playInAdvanced = false;
  }

  if (year < 2020) continue;

  if (year === 2020) {
    // 2019-20 bubble — only West had a play-in.
    for (const team of season.teams) {
      const hc = BUBBLE_PLAYIN_2020[team.id];
      if (hc) {
        team.playInParticipant = hc.participant;
        team.playInAdvanced = hc.advanced;
        enrichedCount++;
      }
    }
    continue;
  }

  // 2020-21 onward: standard play-in tournament.
  for (const confCode of ['E', 'W']) {
    const confTeams = season.teams
      .filter(t => conferenceOf(t.id, year) === confCode)
      .sort((a, b) => b.wins - a.wins);

    // Seeds 7-10 are play-in participants. We identify them by:
    //   - The 4 teams with madePlayoffs status (both in and out) whose
    //     wins sit in the 7th-10th rank-range of the conference.
    // Simpler: take the 4 teams that are either ranked 7-10 by wins AND
    // whose madePlayoffs status matches the tournament outcome pattern
    // (exactly 2 advanced = playoffs, exactly 2 eliminated = not).
    //
    // In practice: among the top 10 teams by wins, the 6 highest-win
    // teams are always direct qualifiers (seeds 1-6). The remaining
    // playoff qualifiers (seeds 7 and 8) came from play-in, and the
    // eliminated play-in teams are the 2 non-playoff teams with
    // sufficient wins to have entered the tournament.

    const top6 = new Set(confTeams.slice(0, 6).map(t => t.id));
    const playoffInConf = confTeams.filter(t => t.madePlayoffs);
    const nonPlayoffInConf = confTeams.filter(t => !t.madePlayoffs);

    // Seeds 7 and 8 = the 2 playoff teams not in top 6.
    const playInAdvancers = playoffInConf.filter(t => !top6.has(t.id));
    // Play-in losers = the 2 non-playoff teams with highest wins.
    const playInLosers = nonPlayoffInConf.slice(0, 2);

    for (const t of playInAdvancers) {
      const target = season.teams.find(x => x.id === t.id);
      target.playInParticipant = true;
      target.playInAdvanced = true;
      enrichedCount++;
    }
    for (const t of playInLosers) {
      const target = season.teams.find(x => x.id === t.id);
      target.playInParticipant = true;
      target.playInAdvanced = false;
      enrichedCount++;
    }
  }
}

fs.writeFileSync(dataPath, JSON.stringify(d, null, 2));
console.log(`Enriched ${enrichedCount} team-season records with play-in fields.`);

// Report per-season summary for verification.
console.log('\nPer-season play-in participants:');
console.log('Year  Participants  Advanced  Eliminated');
console.log('-'.repeat(48));
for (const s of d.seasons) {
  const participants = s.teams.filter(t => t.playInParticipant);
  if (participants.length === 0) continue;
  const advanced = participants.filter(t => t.playInAdvanced);
  const eliminated = participants.filter(t => !t.playInAdvanced);
  console.log(
    String(s.year).padEnd(6) +
    String(participants.length).padEnd(14) +
    advanced.map(t => t.id).join(',').padEnd(26) +
    eliminated.map(t => t.id).join(',')
  );
}
