#!/usr/bin/env node
/**
 * Audit numerical claims in paper Section 6 against backtester output.
 * Prints all numbers referenced in the paper for verification.
 */

const path = require('path');
const fs = require('fs');

const engine = require(path.join(__dirname, '..', 'docs', 'js', 'cola-engine.js'));
const {
  computeClassicCOLA,
  computeSimpleCOLA,
  computeSimpleLotteryCOLA,
  computeCountdownCOLA,
  computeAllTradeRules,
} = engine;

const nbaData = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'docs', 'data', 'nba-data.json'), 'utf-8')
);
const tradeMetadata = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'docs', 'data', 'trade-metadata.json'), 'utf-8')
);

const seasons = nbaData.seasons;

console.log('='.repeat(80));
console.log('PAPER NUMBER AUDIT — Section 6 (Comparative Analysis)');
console.log('='.repeat(80));

// ── Classic COLA results across all seasons ──
const classic = computeClassicCOLA(seasons);
const simple = computeSimpleCOLA(seasons);
const simpleLottery = computeSimpleLotteryCOLA(seasons);
const countdown = computeCountdownCOLA(seasons);

// ─────────────────────────────────────────────────────────────
// 6.1 — Sacramento Kings (Max Drought)
// ─────────────────────────────────────────────────────────────
console.log('\n── 6.1 Sacramento Kings ──');
console.log('Claim: 16-season drought 2006-07 through 2021-22, top lottery team ~6 consecutive seasons');
console.log('Claim: Classic COLA index > 17,000 by 2023-24\n');

const sacYears = [];
for (const season of seasons) {
  const yr = season.year;
  const sac = classic[yr] && classic[yr].teams && classic[yr].teams['SAC'];
  if (!sac) continue;
  const topTeam = classic[yr].draftOrder && classic[yr].draftOrder[0];
  sacYears.push({
    year: yr,
    label: `${yr-1}-${String(yr).slice(2)}`,
    madePlayoffs: sac.madePlayoffs,
    seriesWon: sac.seriesWon,
    wins: sac.wins,
    losses: sac.losses,
    index: sac.index,
    classicRank: sac.colaPosition,
    draftPick: sac.draftPick,
    topTeam: topTeam ? `${topTeam.id} (${Math.round(topTeam.index)})` : '—',
  });
}
console.log('SAC Classic COLA trajectory (all years):');
console.log('Season      MP  SW  W-L     Index    Rank  Pick  TopTeam');
for (const r of sacYears) {
  console.log(
    `${r.label.padEnd(10)}  ${r.madePlayoffs ? 'Y' : 'N'}   ${r.seriesWon}   ${String(r.wins).padStart(2)}-${String(r.losses).padStart(2)}   ${String(Math.round(r.index)).padStart(7)}  ${String(r.classicRank || '—').padStart(4)}  ${String(r.draftPick || '—').padStart(4)}  ${r.topTeam}`
  );
}

const sacTopStreak = [];
let curStreak = 0;
for (const r of sacYears) {
  if (r.classicRank === 1) {
    curStreak++;
    sacTopStreak.push(r.label);
  } else {
    curStreak = 0;
  }
}
console.log(`\nSAC held Classic COLA rank 1 in ${sacTopStreak.length} seasons: ${sacTopStreak.join(', ')}`);

// Find max SAC index and which year
let sacMax = 0, sacMaxYear = null;
for (const r of sacYears) {
  if (r.index > sacMax) { sacMax = r.index; sacMaxYear = r.label; }
}
console.log(`SAC max index: ${Math.round(sacMax)} in ${sacMaxYear}`);

// ─────────────────────────────────────────────────────────────
// 6.2 — Philadelphia 76ers (The Process)
// ─────────────────────────────────────────────────────────────
console.log('\n── 6.2 Philadelphia 76ers (The Process) ──');
console.log('Claim table: 2013-14 to 2017-18 Classic COLA state for PHI');
console.log();

const processYears = [2014, 2015, 2016, 2017, 2018];
console.log('Season      W-L     Real Pick  Index(PRE-draft)  Rank    TopTeam(index)');
for (const yr of processYears) {
  const r = classic[yr];
  if (!r) { console.log(`${yr}: no data`); continue; }
  const phi = r.teams['PHI'];
  const top = r.draftOrder[0];
  console.log(
    `${yr-1}-${String(yr).slice(2)}    ${String(phi.wins).padStart(2)}-${String(phi.losses).padStart(2)}   ${String(phi.draftPick || '—').padStart(4)}       ${String(Math.round(phi.index)).padStart(7)}        ${String(phi.colaPosition || '—').padStart(3)}/${r.draftOrder.length}   ${top.id}(${Math.round(top.index)})`
  );
}

// ─────────────────────────────────────────────────────────────
// 6.3 — Milwaukee Bucks (Countdown COLA)
// ─────────────────────────────────────────────────────────────
console.log('\n── 6.3 Milwaukee Bucks (Countdown COLA, 2024-25) ──');
console.log('Claim: McCarty number = 144, P[#1 | MIL] ≈ 14%, E[pick | MIL] ≈ 7.2\n');

const milCountdown2025 = countdown[2025] && countdown[2025].teams && countdown[2025].teams['MIL'];
const milClassic2025 = classic[2025] && classic[2025].teams && classic[2025].teams['MIL'];
console.log('MIL 2024-25 Countdown entry:');
console.log(JSON.stringify(milCountdown2025, null, 2));
console.log('\nMIL 2024-25 Classic entry:');
console.log(JSON.stringify(milClassic2025, null, 2));

// Show the top 10 Countdown 2025
console.log('\nCountdown COLA 2024-25 top 10:');
if (countdown[2025] && countdown[2025].draftOrder) {
  const ord = countdown[2025].draftOrder.slice(0, 10);
  for (let i = 0; i < ord.length; i++) {
    const t = ord[i];
    console.log(
      `  ${i+1}. ${t.id}  mccarty=${t.mccarty || '?'}  tickets=${t.tickets || '?'}  P[#1]=${((t.probability || 0) * 100).toFixed(1)}%  E[pick]=${(t.expectedPick || 0).toFixed(2)}`
    );
  }
}

// ─────────────────────────────────────────────────────────────
// 6.4 — Trade Handling: BKN 2017 #1, BKN 2016 #3, LAC 2011 #1
// ─────────────────────────────────────────────────────────────
console.log('\n── 6.4 Trade Handling ──');
console.log('Claim table: post-trade Classic COLA index under 4 options\n');

const tradeResults = computeAllTradeRules(seasons, tradeMetadata);

function postDiminishIndex(yr, teamId, ruleName) {
  // Index at end of year yr (post-diminishment) = index in teams[yr+1]'s PRE state
  // For last year, we take the index shown in teams[yr] and manually apply diminishment.
  // Easier: check teams[yr+1] — the PRE state for next year equals post state of yr.
  // But teams[yr].index is PRE-diminishment (lottery time). Need POST. Use teams[yr+1] if exists.
  const nextYr = yr + 1;
  const r = tradeResults[ruleName] && tradeResults[ruleName][nextYr];
  if (!r || !r.teams[teamId]) {
    // Fall back: reconstruct from current yr state
    const curR = tradeResults[ruleName][yr];
    if (!curR || !curR.teams[teamId]) return null;
    return { note: 'no next-year data; returning PRE state', index: curR.teams[teamId].index };
  }
  // The next-year PRE state incorporates both this year's diminishment AND next year's alpha.
  // So POST this year = teams[yr+1].index - alpha (if team didn't make playoffs next year) or ... tricky.
  // Simpler: explicitly compute POST state from current PRE + diminishment based on rule.
  return null; // handled manually below
}

function explainRule(yr, pick, receiverTeam, originalOwner, rules) {
  const fracMap = { 1: 1.0, 2: 0.75, 3: 0.5, 4: 0.25 };
  const frac = fracMap[pick];
  console.log(`  Year ${yr}, Pick #${pick}: ${originalOwner} → ${receiverTeam}`);
  for (const ruleName of rules) {
    const r = tradeResults[ruleName][yr];
    if (!r) continue;
    const recState = r.teams[receiverTeam];
    const origState = r.teams[originalOwner];
    const recPre = recState ? Math.round(recState.index) : null;
    const origPre = origState ? Math.round(origState.index) : null;
    // Compute POST-diminishment for this specific rule
    let recPost, origPost;
    if (ruleName === 'exclude') {
      recPost = recPre;
      origPost = origPre;
    } else if (ruleName === 'receiving_team') {
      recPost = recPre !== null ? Math.round(recPre * (1 - frac)) : null;
      origPost = origPre;
    } else if (ruleName === 'original_owner') {
      recPost = recPre;
      origPost = origPre !== null ? Math.round(origPre * (1 - frac)) : null;
    } else if (ruleName === 'split') {
      recPost = recPre !== null ? Math.round(recPre * (1 - frac/2)) : null;
      origPost = origPre !== null ? Math.round(origPre * (1 - frac/2)) : null;
    }
    console.log(
      `    [${ruleName.padEnd(14)}] ${receiverTeam} pre=${recPre} post=${recPost}  |  ${originalOwner} pre=${origPre} post=${origPost}`
    );
  }
  console.log();
}

const rules = ['exclude', 'original_owner', 'receiving_team', 'split'];
console.log('LAC 2011 #1 (Kyrie Irving, Baron Davis trade — LAC → CLE):');
explainRule(2011, 1, 'CLE', 'LAC', rules);
console.log('BKN 2016 #3 (Jaylen Brown, Billy King trade — BKN → BOS):');
explainRule(2016, 3, 'BOS', 'BKN', rules);
console.log('BKN 2017 #1 (Billy King trade, lottery-day holder BOS — BKN → BOS):');
explainRule(2017, 1, 'BOS', 'BKN', rules);

// ─────────────────────────────────────────────────────────────
// 6.5 — Cross-Variant Summary
// ─────────────────────────────────────────────────────────────
console.log('── 6.5 Cross-Variant Summary ──');
console.log('Claim: top teams in 2024-25 under each variant, PHI 2016-17 rank, top team E[pick]\n');

const show2025 = (name, result) => {
  const r = result && result[2025];
  if (!r) { console.log(`${name} 2024-25: no data`); return; }
  const top = r.draftOrder && r.draftOrder[0];
  console.log(`${name} 2024-25 top 5:`);
  if (r.draftOrder) {
    r.draftOrder.slice(0, 5).forEach((t, i) => {
      const ep = t.expectedPick !== undefined ? `E[pick]=${t.expectedPick.toFixed(2)}` : '';
      const pr = t.probability !== undefined && t.probability !== null ? `P[#1]=${(t.probability * 100).toFixed(1)}%` : '';
      console.log(`  ${i+1}. ${t.id}  ${pr} ${ep}`);
    });
  }
};

show2025('Simple', simple);
show2025('Simple Lottery', simpleLottery);
show2025('Classic', classic);
show2025('Countdown', countdown);

console.log('\n── PHI 2016-17 rank under each variant ──');
const show2017PHI = (name, result) => {
  const r = result && result[2017];
  if (!r) { console.log(`${name}: no data`); return; }
  const phi = r.teams['PHI'];
  const total = r.draftOrder ? r.draftOrder.length : '?';
  console.log(`${name} 2016-17 PHI: rank=${phi ? phi.colaPosition : '?'}/${total}  pick=${phi ? phi.draftPick : '?'}`);
};
show2017PHI('Simple', simple);
show2017PHI('Simple Lottery', simpleLottery);
show2017PHI('Classic', classic);
show2017PHI('Countdown', countdown);

console.log('\n── Top-team E[pick] under each variant (2024-25) ──');
const topE = (name, result) => {
  const r = result && result[2025];
  if (!r || !r.draftOrder || r.draftOrder.length === 0) { console.log(`${name}: no data`); return; }
  const top = r.draftOrder[0];
  const ep = top.expectedPick !== undefined ? top.expectedPick.toFixed(2) : 'n/a';
  console.log(`${name}: top=${top.id}  E[pick]=${ep}`);
};
topE('Simple', simple);
topE('Simple Lottery', simpleLottery);
topE('Classic', classic);
topE('Countdown', countdown);

console.log('\n='.repeat(80));
console.log('Done.');
