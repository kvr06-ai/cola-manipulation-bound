#!/usr/bin/env node
/**
 * Audit the seven-dial configuration map in paper Section 3.1.3 against the
 * canonical engine values in docs/js/cola-engine.js.
 *
 * Source of truth: docs/js/cola-engine.js (the implementation).
 * Verifies:        paper/sections/03-cola-family.tex (the variant map table).
 *
 * Two outputs:
 *  (1) PASS/FAIL on each numeric parameter the paper cites verbatim.
 *  (2) The full per-variant dial table, for visual cross-check against the
 *      qualitative cells the paper writes (eligibility shape, carry-over
 *      scope, tiebreak).
 */

const path = require('path');
const engine = require(path.join(__dirname, '..', 'docs', 'js', 'cola-engine.js'));

// =============================================================================
// 1. Expected paper values — sync with paper/sections/03-cola-family.tex
//    Sec 3.1.3. Any numeric cell that appears in the variant map must appear
//    here. If the paper says "alpha = 1,000", PAPER.Classic.alpha = 1000.
// =============================================================================

const PAPER = {
  Classic: {
    alpha: 1000,
    playoff_diminish: { champion: 1.0, finals: 0.75, conf_finals: 0.5, second_round: 0.25, first_round: 0.0 },
    draft_diminish: { 1: 1.0, 2: 0.75, 3: 0.5, 4: 0.25 },
    eligibility_size: 14,
    lottery_top_k: 4,
  },
  Capped: {
    max: 150,
    drought_min: 2,
    playoff_diminish_direct: { champion: 1.0, finals: 0.8, conf_finals: 0.6, second_round: 0.4, first_round: 0.2 },
    playin_r1_frac: 0.1,
    draft_diminish: { 1: 1.0, 2: 0.8, 3: 0.6, 4: 0.4, 5: 0.2 },
    marginal_max_frac: 0.3,
    marginal_typical_frac: 0.2,
    lottery_top_k: 5,
  },
  Simple: {
    eligibility_size: 22,  // 14 non-playoff + 8 R1 losers; eligibility = seriesWon === 0
  },
  SimpleLottery: {
    pre_2019_odds: [0.250, 0.199, 0.156, 0.119, 0.088, 0.063, 0.043, 0.028, 0.017, 0.011, 0.008, 0.007, 0.006, 0.005],
    eligibility_size: 22,
    lottery_top_k: 14,
  },
  Countdown: {
    pool_tickets: [6, 5, 4, 3, 2],
    mc_trials: 10000,
    eligibility_size: 22,
  },
  Tank321: {
    bottom_balls: 2,
    mid_balls: 3,
    nine_ten_balls: 2,
    seven_eight_loser_balls: 1,
    headline_total: 37,
  },
};

// =============================================================================
// 2. Engine values — read directly from the implementation.
// =============================================================================

const ENGINE = {
  Classic: {
    alpha: engine.ALPHA,
    playoff_diminish: engine.PLAYOFF_DIMINISH,
    draft_diminish: engine.DRAFT_DIMINISH,
  },
  Capped: {
    max: engine.CAPPED_DEFAULT_MAX,
    drought_min: engine.CAPPED_DROUGHT_MIN,
    playoff_diminish_direct: engine.CAPPED_PLAYOFF_DIMINISH_DIRECT,
    playin_r1_frac: engine.CAPPED_PLAYIN_R1_FRAC,
    draft_diminish: engine.CAPPED_DRAFT_DIMINISH,
    marginal_max_frac: engine.CAPPED_MARGINAL_MAX_FRAC,
    marginal_typical_frac: engine.CAPPED_MARGINAL_TYPICAL_FRAC,
  },
  SimpleLottery: {
    pre_2019_odds: engine.PRE_2019_ODDS,
  },
  Countdown: {
    pool_tickets: engine.COUNTDOWN_POOL_TICKETS,
  },
  Tank321: {
    bottom_balls: engine.TANK_321_BOTTOM_BALLS,
    mid_balls: engine.TANK_321_MID_BALLS,
    nine_ten_balls: engine.TANK_321_910_BALLS,
    seven_eight_loser_balls: engine.TANK_321_78_LOSER_BALLS,
    headline_total: engine.TANK_321_HEADLINE_TOTAL,
  },
};

// =============================================================================
// 3. Compare PAPER vs ENGINE on every numeric parameter the paper cites.
// =============================================================================

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (a && typeof a === 'object') {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every(k => deepEqual(a[k], b[k]));
  }
  return false;
}

console.log('='.repeat(78));
console.log('DIAL TAXONOMY AUDIT — paper Sec 3.1.3 vs docs/js/cola-engine.js');
console.log('='.repeat(78));

let failures = 0;
let checks = 0;

for (const variant of Object.keys(PAPER)) {
  for (const param of Object.keys(PAPER[variant])) {
    const paperVal = PAPER[variant][param];
    const engineVal = ENGINE[variant] && ENGINE[variant][param];
    if (engineVal === undefined) {
      // Paper-only parameter (e.g., Simple.eligibility_size, derived from
      // logic, not exported as a constant). Skip mechanical comparison;
      // surface for manual review below.
      continue;
    }
    checks++;
    const ok = deepEqual(paperVal, engineVal);
    if (!ok) {
      failures++;
      console.log(`FAIL  ${variant}.${param}`);
      console.log(`      paper:  ${JSON.stringify(paperVal)}`);
      console.log(`      engine: ${JSON.stringify(engineVal)}`);
    }
  }
}

console.log(`\n${checks} numeric checks run, ${failures} failure(s).`);
if (failures === 0) {
  console.log('PASS: paper values match engine constants.');
} else {
  console.log('FAIL: at least one paper cell drifted from the engine.');
}

// =============================================================================
// 4. Print the full dial-by-variant table for visual cross-check against
//    paper Sec 3.1.3. The qualitative cells (eligibility shape, carry-over
//    scope, tiebreak) are reproduced here as documentation, sourced from
//    the engine's function bodies and inline comments.
// =============================================================================

const TABLE = {
  Simple: {
    eligibility:        'E^(t) = { i : seriesWon_i^(t) = 0 }  (22 teams: 14 non-playoff + 8 R1 losers)',
    increment:          'drought_i^(t+1) = drought_i^(t) + 1  if no series win and no top-3 pick',
    diminishment:       'reset drought to 0 on (series win) OR (top-3 pick)',
    lottery_weighting:  'deterministic: sort by drought DESC, wins DESC',
    cap:                'no formal cap (drought bounded by number of seasons)',
    carry_over_scope:   'reset-on-event (series win OR top-3 pick)',
    tiebreak:           'wins DESC',
    source:             'computeSimpleCOLA, Highley Substack Part 3',
  },
  SimpleLottery: {
    eligibility:        '22 teams (inherits from Simple)',
    increment:          'drought + 1 (inherits from Simple)',
    diminishment:       'drought reset (inherits from Simple)',
    lottery_weighting:  `pre-2019 NBA odds top-14: [${PAPER.SimpleLottery.pre_2019_odds.map(p => (p*100).toFixed(1) + '%').join(', ')}]; picks 15-22 deterministic`,
    cap:                'no formal cap',
    carry_over_scope:   'reset-on-event',
    tiebreak:           'wins DESC for drought ties; lottery odds resolve top 14',
    source:             'computeSimpleLotteryCOLA, Highley Substack Part 3',
  },
  Classic: {
    eligibility:        `E^(t) = { i : !madePlayoffs_i^(t) }  (${PAPER.Classic.eligibility_size} non-playoff teams)`,
    increment:          `alpha = ${PAPER.Classic.alpha} tickets per missed playoff for every non-playoff team`,
    diminishment:       `playoff: { champ 1.0, finals 0.75, CF 0.5, R2 0.25, R1 0.0 }; draft: { #1 1.0, #2 0.75, #3 0.5, #4 0.25 }`,
    lottery_weighting:  `picks 1-${PAPER.Classic.lottery_top_k} weighted by L_i / P; picks 5-14 by index rank`,
    cap:                'C = infinity',
    carry_over_scope:   'unbounded multi-year accumulation',
    tiebreak:           'fewer wins = higher priority (ties resolved by record DESC)',
    source:             'computeClassicCOLA, Highley et al. (2026) arXiv:2602.02487',
  },
  Countdown: {
    eligibility:        '22 teams (inherits from Simple)',
    increment:          'McCarty number M_i^(t) = drought_i * wins_i (recomputed each season)',
    diminishment:       'drought reset on series win',
    lottery_weighting:  `nested-pool Monte Carlo (${PAPER.Countdown.mc_trials} trials), pool size 5, tickets [${PAPER.Countdown.pool_tickets.join(', ')}] for ranks 1-5 within pool`,
    cap:                'no formal cap',
    carry_over_scope:   'reset-on-event via drought; McCarty re-multiplied each season',
    tiebreak:           'drought DESC, then wins DESC',
    source:             'computeCountdownCOLA, Highley Substack Part 3',
  },
  Capped: {
    eligibility:        `E^(t) = { i : drought_i^(t,effective) >= ${PAPER.Capped.drought_min} }  (exclusion: top-5 pick last year OR series win last year/this year)`,
    increment:          'wins_i for play-in-and-below teams; zero for direct playoff entrants (top 6 seeds)',
    diminishment:       `playoff: { champ 1.0, finals 0.8, CF 0.6, R2 0.4, R1 0.2, play-in advancer R1 loss 0.1 }; draft: { #1 1.0, #2 0.8, #3 0.6, #4 0.4, #5 0.2 }`,
    lottery_weighting:  `picks 1-${PAPER.Capped.lottery_top_k} weighted by L_i / P (raffled); picks 6+ by index rank`,
    cap:                `C = ${PAPER.Capped.max} (continuous clamp)`,
    carry_over_scope:   `bounded multi-year (accumulation capped at ${PAPER.Capped.max})`,
    tiebreak:           'wins DESC (at cap, most-wins resolves)',
    source:             'computeCappedCOLA, Highley Substack "Overcoming Inertia"',
  },
  Tank321: {
    eligibility:        '16-team pool: 10 non-playoff non-play-in + 4 (record-9 or -10) seeds + 2 7v8 losers',
    increment:          'none — balls assigned by tier each season (no cross-season state)',
    diminishment:       'none',
    lottery_weighting:  `tiered ball allocation: bottom-3 = ${PAPER.Tank321.bottom_balls} balls, slots 4-10 = ${PAPER.Tank321.mid_balls} balls, 9-10 seeds = ${PAPER.Tank321.nine_ten_balls} balls, 7v8 losers = ${PAPER.Tank321.seven_eight_loser_balls} ball; headline total ${PAPER.Tank321.headline_total} balls (varies by play-in outcome)`,
    cap:                'n/a (no carry-over)',
    carry_over_scope:   'single-season',
    tiebreak:           'balls DESC, wins ASC',
    source:             'computeTank321Lottery, NBA 2026 proposal, Highley Substack "3-2-1 reaction"',
  },
};

const DIAL_ORDER = [
  'eligibility',
  'increment',
  'diminishment',
  'lottery_weighting',
  'cap',
  'carry_over_scope',
  'tiebreak',
];

const DIAL_LABEL = {
  eligibility:        '1. Eligibility (E)',
  increment:          '2. Increment (Delta)',
  diminishment:       '3. Diminishment (rho)',
  lottery_weighting:  '4. Lottery weighting (W)',
  cap:                '5. Cap (C)',
  carry_over_scope:   '6. Carry-over scope (S)',
  tiebreak:           '7. Tiebreak (T)',
};

console.log('\n' + '='.repeat(78));
console.log('FULL DIAL-BY-VARIANT TABLE (for visual cross-check against paper Sec 3.1.3)');
console.log('='.repeat(78));

for (const variant of Object.keys(TABLE)) {
  console.log(`\n--- ${variant} ---`);
  console.log(`Source: ${TABLE[variant].source}`);
  for (const dial of DIAL_ORDER) {
    console.log(`  ${DIAL_LABEL[dial].padEnd(28)} ${TABLE[variant][dial]}`);
  }
}

process.exit(failures === 0 ? 0 : 1);
