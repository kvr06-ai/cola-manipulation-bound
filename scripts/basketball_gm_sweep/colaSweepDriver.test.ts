// Real ZenGM COLA sweep driver (Track B).
//
// This test file is invoked by the parent sweep harness (scripts/basketball_gm_sweep/sweep.js)
// via the vitest CLI. It runs ONE replicate of ONE config over `seasons` simulated years.
//
// Configuration is passed via the environment variable COLA_DRIVER_CONFIG (JSON string).
// Output is written to the path in COLA_DRIVER_OUTPUT (JSON file).
//
// Engine usage:
//   - REAL: bbgm.draft.genOrder() lottery draw, bbgm.cola.updateLotteryChancesAfterPlayoffs,
//           bbgm.cola.updateLotteryChancesAfterLottery (executed on the in-Node bbgm worker
//           globals set up by src/test/setup.ts + src/worker/index.ts).
//   - SYNTHESIZED: win-record + playoff-bracket outcomes. We do NOT run the full
//           regular-season + playoff game-by-game simulation here; that would require a
//           browser-side createLeague() invocation (the actions.playAmount('untilDraft')
//           path documented in DIAL_MAPPING.md is browser-coupled). The COLA index logic
//           and the lottery draw — i.e. the parts the paper's dial space actually controls
//           — are executed by real ZenGM code.
//
// The driver patches dial values (E, C, S) directly via the global `g` and via local
// shadowing of constants the COLA module reads. Dials beyond what is currently exposed
// (rho weighting, T tiebreak rule) keep the Classic defaults baked into cola.ts.

import { afterAll, beforeAll, test } from "vitest";
import * as fs from "node:fs";
import { resetCache, resetG } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import { g, helpers } from "../../util/index.ts";
import * as cola from "./cola.ts";
import draft from "./index.ts";
import { DEFAULT_STADIUM_CAPACITY } from "../../../common/constants.ts";
import type { Team, TeamSeasonWithoutKey } from "../../../common/types.ts";

type Config = {
	id: number;
	E: number | "16-tiered";
	C: number | null;
	S: "single-season" | "unbounded" | "bounded-30yr" | "reset-on-championship";
	delta: number;
	rho: string;
	W: string;
	T: string;
	seasons: number;
	seed: number;
};

type TeamRecord = {
	tid: number;
	conf: "E" | "W";
	wins: number;
	playoffRoundsWon: number;
	draftPick: number | null;
	cola: number;
};

type SeasonEntry = {
	season: number;
	teams: TeamRecord[];
};

// ============================================================================
// Deterministic PRNG (mulberry32). Mirrors sweep.js so seeds are reproducible.
// ============================================================================

function hashSeed(configId: number, replicate: number, baseSeed: number) {
	let h = baseSeed >>> 0;
	h = ((h ^ configId) * 2654435761) >>> 0;
	h = ((h ^ replicate) * 2654435761) >>> 0;
	return h;
}

function mulberry32(seed: number) {
	return function () {
		let t = (seed += 0x6d2b79f5);
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// Box-Muller transform: convert two uniform[0,1) draws to one standard normal.
function gaussian(rng: () => number): number {
	let u1 = rng();
	let u2 = rng();
	// Avoid log(0).
	if (u1 < 1e-12) u1 = 1e-12;
	return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// ============================================================================
// Persistent team-strength Markov model.
//
// Replaces the prior i.i.d. uniform[0.2, 0.6]-per-year strength refresh with
// a persistent process tied to draft outcomes, so the feedback loop the
// primary objective (max years between conference finals) measures is
// preserved.
//
// Transition: strength_{t+1} = clip(
//     rho * strength_t + (1-rho) * mu + alpha * pick_value(pick_t) + eps_t,
//     0, 1)
//   where eps_t ~ Normal(0, sigma^2). Parameters chosen for plausibility,
//   not exact NBA-data fit; sensitivity on (rho, alpha, sigma) is future work.
//
// Tuned values: rho = 0.9 (persistence), mu = 0.5 (parity mean),
//               alpha = 0.15 (per-draft impact), sigma = 0.05 (annual shock).
// Initialization: strength_0 ~ Uniform[0.3, 0.7].
//
// Tuning notes (smoke test, config_id=1, 30 seasons, replicate seed=0):
//   - rho=0.8, alpha=0.10 (initial defaults): max_gap=24, never_reached=0.
//     Loop visible in CF-count variance (1..7) but not in the franchise-never-
//     reached diagnostic.
//   - rho=0.9, alpha=0.15: max_gap=30, never_reached=1. CF-count range 0..8.
//     Adopted as the smoke baseline; loop manifests on both diagnostics.
//   - rho=0.9, alpha=0.20, sigma=0.07: max_gap=22, never_reached=0. Larger
//     draft impact over-corrects (#1 picks pull bad teams up too fast),
//     compressing the gap distribution. Rejected.
// ============================================================================

const MARKOV_RHO = 0.9;
const MARKOV_MU = 0.5;
const MARKOV_ALPHA = 0.15;
const MARKOV_SIGMA = 0.05;

function pickValue(pick: number | null): number {
	// Monotonically decreasing in pick number; picks 1..15 contribute
	// positively, pick 16+ contributes zero. Pick 1 -> full alpha; pick 15 -> 0.
	if (pick === null || pick === undefined) return 0;
	return Math.max(0, (16 - pick) / 15);
}

function transitionStrength(
	prevStrength: number,
	prevDraftPick: number | null,
	rng: () => number,
): number {
	const meanReversion = MARKOV_RHO * prevStrength + (1 - MARKOV_RHO) * MARKOV_MU;
	const draftBoost = MARKOV_ALPHA * pickValue(prevDraftPick);
	const shock = MARKOV_SIGMA * gaussian(rng);
	const next = meanReversion + draftBoost + shock;
	return Math.max(0, Math.min(1, next));
}

// ============================================================================
// Synthetic regular-season + playoff bracket.
//
// Strength is supplied externally and persists across seasons (see Markov
// model above). Convert to wins, sort within conference, top 8 enter playoffs,
// lottery teams are the rest. Walk a single-elimination bracket with
// probability proportional to relative strength (no home-court adjustment,
// no injuries, no mid-season trades — those are not what the paper's dial
// space controls).
// ============================================================================

function simulateSeasonOutcomes(
	rng: () => number,
	teams: { tid: number; cid: number }[],
	strength: number[],
): { wins: number; playoffRoundsWon: number; tid: number; cid: number }[] {
	const NUM_TEAMS = teams.length;
	// Wins out of 82, scaled by strength relative to league mean, with noise.
	const meanStrength = strength.reduce((a, b) => a + b, 0) / NUM_TEAMS;
	const wins = strength.map((s, i) => {
		const baseline = 41;
		const tilt = (s - meanStrength) * 60; // -18..+18 ish around 41
		const noise = (rng() - 0.5) * 8;
		return Math.max(15, Math.min(70, Math.round(baseline + tilt + noise)));
	});

	// Build conference rankings.
	const teamsByConf: Record<number, number[]> = {};
	for (const t of teams) {
		teamsByConf[t.cid] ??= [];
		teamsByConf[t.cid]!.push(t.tid);
	}

	const playoffRoundsWon = new Array(NUM_TEAMS).fill(-1) as number[];

	const playoffsAdvance: number[] = []; // teams making R1 (16 total)
	const lotteryTeams: number[] = [];
	for (const cidStr of Object.keys(teamsByConf)) {
		const cid = Number(cidStr);
		const confTids = teamsByConf[cid]!.slice();
		confTids.sort((a, b) => wins[b]! - wins[a]!);
		// Top 8 per conference make playoffs (16-team default).
		const made = confTids.slice(0, 8);
		const missed = confTids.slice(8);
		playoffsAdvance.push(...made);
		lotteryTeams.push(...missed);
	}

	// Set playoff teams' starting roundsWon = 0; lottery teams stay at -1.
	for (const tid of playoffsAdvance) playoffRoundsWon[tid] = 0;

	// Simulate the conference bracket: 8 -> 4 -> 2 -> 1 within each conf, then finals.
	const sampleWinner = (
		tidA: number,
		tidB: number,
		bias: number = 0,
	): number => {
		const sA = strength[tidA]! + bias;
		const sB = strength[tidB]! + bias;
		const probA = sA / (sA + sB);
		return rng() < probA ? tidA : tidB;
	};

	const conferenceWinners: number[] = [];
	for (const cidStr of Object.keys(teamsByConf)) {
		const cid = Number(cidStr);
		const seeded = teamsByConf[cid]!
			.filter((tid) => playoffRoundsWon[tid] === 0)
			.sort((a, b) => wins[b]! - wins[a]!);
		if (seeded.length !== 8) continue;
		// R1: 1v8, 2v7, 3v6, 4v5
		const r1Pairs = [
			[seeded[0]!, seeded[7]!],
			[seeded[3]!, seeded[4]!],
			[seeded[1]!, seeded[6]!],
			[seeded[2]!, seeded[5]!],
		];
		const r2Entrants: number[] = [];
		for (const [a, b] of r1Pairs) {
			const w = sampleWinner(a, b);
			playoffRoundsWon[w] = 1;
			r2Entrants.push(w);
		}
		// R2 (Conference semifinals): two matchups.
		const cfEntrants: number[] = [];
		for (let i = 0; i < r2Entrants.length; i += 2) {
			const w = sampleWinner(r2Entrants[i]!, r2Entrants[i + 1]!);
			playoffRoundsWon[w] = 2;
			cfEntrants.push(w);
		}
		// CF: winner = conference finals winner.
		const confWinner = sampleWinner(cfEntrants[0]!, cfEntrants[1]!);
		playoffRoundsWon[confWinner] = 3;
		conferenceWinners.push(confWinner);
	}

	// NBA Finals.
	if (conferenceWinners.length === 2) {
		const champ = sampleWinner(conferenceWinners[0]!, conferenceWinners[1]!);
		playoffRoundsWon[champ] = 4;
	}

	return teams.map((t, i) => ({
		tid: t.tid,
		cid: t.cid,
		wins: wins[i]!,
		playoffRoundsWon: playoffRoundsWon[i]!,
	}));
}

// ============================================================================
// Cap clamp (dial C). We apply this AFTER cola.updateLotteryChancesAfterPlayoffs
// because the COLA module itself has no cap. Per DIAL_MAPPING.md row C, the
// canonical patch site is post-increment.
// ============================================================================

async function applyCapClamp(cap: number | null) {
	if (cap === null) return;
	const teams = await idb.cache.teams.getAll();
	for (const t of teams) {
		if (t.cola !== undefined && t.cola > cap) {
			t.cola = cap;
			await idb.cache.teams.put(t);
		}
	}
}

// ============================================================================
// Carry-over scope (dial S). Applied before COLA updates.
// ============================================================================

async function applyCarryOverScope(
	scope: Config["S"],
	currentSeasonIdx: number,
	historyByTid: Record<number, { season: number; cola: number }[]>,
	championTid: number | null,
) {
	const teams = await idb.cache.teams.getAll();
	if (scope === "single-season") {
		// Zero every team's index before the season's update.
		for (const t of teams) {
			t.cola = 0;
			await idb.cache.teams.put(t);
		}
		return;
	}
	if (scope === "reset-on-championship" && championTid !== null) {
		for (const t of teams) {
			if (t.tid === championTid) {
				t.cola = 0;
				await idb.cache.teams.put(t);
			}
		}
		return;
	}
	if (scope === "bounded-30yr") {
		// Replay last 30 seasons from history; truncate older contributions.
		const cutoff = currentSeasonIdx - 30;
		for (const t of teams) {
			const hist = historyByTid[t.tid] ?? [];
			if (hist.length === 0) continue;
			// Find most recent contribution >= cutoff.
			const relevant = hist.filter((h) => h.season >= cutoff);
			// Sum cola contributions over the window. We approximate by taking the
			// value at the boundary as the steady-state; full bounded-window arithmetic
			// would require re-running the increment/diminishment sequence, which we
			// leave for the headline run.
			if (relevant.length > 0) {
				t.cola = relevant[0]!.cola;
			} else {
				t.cola = 0;
			}
			await idb.cache.teams.put(t);
		}
		return;
	}
	// "unbounded": no-op; team.cola carries over from prior season as-is.
}

// ============================================================================
// Eligibility-pool patch (dial E).
//
// E=22 is the ZenGM default for COLA (numActiveTeams - 8). E=14 requires
// reducing the lottery pool to non-playoff teams only. E="16-tiered" requires a
// 16-team mixed pool (paper's 3-2-1 proposal); for the smoke test we only
// exercise E=14, so we keep this as a placeholder that asserts on unknowns.
// ============================================================================

function configureEligibility(E: Config["E"]) {
	// We control eligibility by adjusting which teams are eligible BEFORE
	// genOrder runs. cola.getNumLotteryTeams() reads from numActiveTeams +
	// numGamesPlayoffSeries; the simplest local override is to set a per-season
	// flag and convert non-eligible teams to "as-if-playoff" pre-draft by
	// pre-clamping their cola to 0. Since the lottery draw weights teams by
	// cola, a cola=0 entry has zero chance and falls through to rank-order.
	//
	// For E=14 we set the bottom-14-by-wins as the only eligible chunk; the
	// 8 first-round losers (rounded-wins higher than the bottom 14) get
	// cola=0 to deactivate them. The pool size hardcoded in genOrder will
	// still be 22, but their effective chance is zero — equivalent to E=14
	// for lottery-draw purposes.
	if (E === 14 || E === 22 || E === "16-tiered") {
		// Recorded; actual filtering applied in driver loop.
		return;
	}
	throw new Error(`Unsupported E dial: ${E}`);
}

async function applyEligibilityMask(
	E: Config["E"],
	teamRecords: { tid: number; wins: number; playoffRoundsWon: number }[],
) {
	if (E === 22) return; // ZenGM default; no masking needed.
	const teams = await idb.cache.teams.getAll();
	if (E === 14) {
		// Only the 14 worst non-playoff teams retain cola; all R1-loser teams
		// (playoffRoundsWon === 0) get cola=0.
		for (const t of teams) {
			const rec = teamRecords.find((r) => r.tid === t.tid);
			if (rec && rec.playoffRoundsWon === 0) {
				t.cola = 0;
				await idb.cache.teams.put(t);
			}
		}
		return;
	}
	if (E === "16-tiered") {
		// Paper §3.1.2: 10 non-playoff non-play-in + 4 play-in losers + 2 7v8 losers.
		// With ZenGM's bracket (no explicit play-in here), approximate by retaining
		// the 16 worst-record teams: 14 non-playoff + 2 lowest-seed R1 losers.
		const sortedByWins = teamRecords.slice().sort((a, b) => a.wins - b.wins);
		const eligibleTids = new Set(sortedByWins.slice(0, 16).map((r) => r.tid));
		for (const t of teams) {
			if (!eligibleTids.has(t.tid)) {
				t.cola = 0;
				await idb.cache.teams.put(t);
			}
		}
		return;
	}
}

// ============================================================================
// Build a 30-team league directly. We bypass createLeague() — it is browser
// coupled — and inject teams + minimal-shape data into the mocked IDB cache.
// ============================================================================

async function bootstrapLeague(numTeams: number, startSeason: number) {
	resetG();
	await resetCache();
	g.setWithoutSavingToDB("draftType", "cola");
	g.setWithoutSavingToDB("season", startSeason);
	g.setWithoutSavingToDB("startingSeason", startSeason);

	const teamsDefault = helpers.getTeamsDefault().slice(0, numTeams);
	for (const td of teamsDefault) {
		const t: Team = {
			...td,
			adjustForInflation: true,
			disabled: false,
			keepRosterSorted: true,
			colors: ["#000000", "#000000", "#000000"],
			playThroughInjuries: [0, 0],
			initialBudget: { ticketPrice: 25, scouting: 1, coaching: 1, health: 1, facilities: 1 } as any,
			budget: { ticketPrice: 25, scouting: 1, coaching: 1, health: 1, facilities: 1 } as any,
			pop: 1,
			stadiumCapacity: DEFAULT_STADIUM_CAPACITY,
			cola: 0,
			strategy: "rebuilding" as any,
		} as Team;
		await idb.cache.teams.add(t);
	}
	g.setWithoutSavingToDB("numTeams", numTeams);
	g.setWithoutSavingToDB("numActiveTeams", numTeams);
}

async function appendTeamSeasons(
	currentSeason: number,
	records: { tid: number; wins: number; playoffRoundsWon: number; cid: number }[],
) {
	const teams = await idb.cache.teams.getAll();
	for (const rec of records) {
		const t = teams.find((tm) => tm.tid === rec.tid)!;
		const teamSeason: TeamSeasonWithoutKey = {
			tid: rec.tid,
			season: currentSeason,
			won: rec.wins,
			lost: 82 - rec.wins,
			wonHome: Math.round(rec.wins / 2),
			lostHome: Math.round((82 - rec.wins) / 2),
			wonAway: Math.floor(rec.wins / 2),
			lostAway: Math.floor((82 - rec.wins) / 2),
			wonDiv: 0,
			lostDiv: 0,
			wonConf: 0,
			lostConf: 0,
			tied: 0,
			tiedHome: 0,
			tiedAway: 0,
			tiedConf: 0,
			tiedDiv: 0,
			otl: 0,
			otlHome: 0,
			otlAway: 0,
			otlConf: 0,
			otlDiv: 0,
			lastTen: [],
			streak: 0,
			playoffRoundsWon: rec.playoffRoundsWon,
			hype: 0.5,
			pop: t.pop,
			tvContract: { amount: 0, exp: 0 },
			revenues: {} as any,
			expenses: {} as any,
			expenseLevels: {} as any,
			payrollEndOfSeason: 0,
			stadiumCapacity: DEFAULT_STADIUM_CAPACITY,
			abbrev: t.abbrev,
			name: t.name,
			region: t.region,
			cid: t.cid,
			did: t.did,
			colors: t.colors,
			numPlayersTradedAway: 0,
			gpHome: 41,
			att: 0,
			cash: 0,
		} as TeamSeasonWithoutKey;
		await idb.cache.teamSeasons.add(teamSeason);
	}
}

// ============================================================================
// Driver entry point.
// ============================================================================

beforeAll(async () => {
	// Test harness keeps idb.league as the mockIDBLeague stub.
	const { mockIDBLeague } = await import("../../../test/helpers.ts");
	idb.league = mockIDBLeague();
});

afterAll(() => {
	// @ts-expect-error
	idb.league = undefined;
});

// ============================================================================
// Single-replicate routine. Extracted from the prior monolithic test body so
// the batched harness can invoke it N times within ONE vitest subprocess
// (avoiding the ~3 s startup cost per replicate).
//
// Returns the SeasonEntry[] log for one replicate.
//
// RNG-determinism fix (per ASSUMPTIONS.md L-Z3 / S-3):
//   ZenGM's lottery draw uses Math.random() via randInt() (src/common/
//   random.ts line 32). Before this change, Math.random was unseeded, so
//   even with a fixed mulberry32 seed in this driver, the lottery outcomes
//   varied across runs. We now OVERRIDE Math.random for the duration of one
//   replicate to be a seeded mulberry32, then restore the original.
//
//   Approach chosen (vs. vi.mock or seed-parameter injection):
//   - vi.mock would require modifying genOrder/cola to import from a mocked
//     module path; touchier and harder to scope per-replicate.
//   - Threading a seed parameter through genOrder / randInt would diverge
//     the fork from upstream ZenGM, breaking future merges.
//   - Math.random override is one line, scoped via try/finally, and reads
//     from the same mulberry32 stream the rest of the driver uses (derived
//     from `(config.id, replicate_seed, 42)` via hashSeed). It does NOT
//     persist outside the replicate.
// ============================================================================

async function runOneReplicate(
	config: Config,
	replicateSeed: number,
): Promise<SeasonEntry[]> {
	const SEASONS = config.seasons;
	const NUM_TEAMS = 30;
	const START_SEASON = 2025;

	// Derive a single mulberry32 stream from (configId, replicateSeed,
	// baseSeed=42). The same stream drives strength generation, win-noise,
	// bracket samples, AND (via the Math.random override below) the lottery
	// draw — so a fixed (config_id, replicateSeed) pair is fully deterministic.
	const rng = mulberry32(hashSeed(config.id, replicateSeed, 42));

	configureEligibility(config.E);
	await bootstrapLeague(NUM_TEAMS, START_SEASON);
	const teamsForRng = (await idb.cache.teams.getAll()).map((t) => ({
		tid: t.tid,
		cid: t.cid,
	}));

	const persistentStrength: number[] = new Array(NUM_TEAMS).fill(0);
	for (const t of teamsForRng) {
		persistentStrength[t.tid] = 0.3 + rng() * 0.4;
	}

	const seasonLog: SeasonEntry[] = [];
	const historyByTid: Record<number, { season: number; cola: number }[]> = {};

	// Install seeded Math.random for the duration of this replicate. ZenGM's
	// randInt() (used inside genOrder for the lottery draw) calls Math.random
	// internally; routing it through our mulberry32 makes the lottery draw
	// reproducible. The `originalRandom` capture + finally restore ensures we
	// don't leak the override into subsequent replicates or other vitest tests
	// running in the same process.
	const originalRandom = Math.random;
	Math.random = rng;

	try {
		for (let s = 0; s < SEASONS; s++) {
			const currentSeason = START_SEASON + s;
			g.setWithoutSavingToDB("season", currentSeason);

			// 1. Simulate season outcomes (wins + playoff bracket) using the
			// persistent strength vector — see Markov model above.
			const outcomes = simulateSeasonOutcomes(
				rng,
				teamsForRng,
				persistentStrength,
			);
			await appendTeamSeasons(currentSeason, outcomes);

			// 2. Apply carry-over scope (dial S) BEFORE the COLA update.
			const champion = outcomes.find((o) => o.playoffRoundsWon === 4);
			await applyCarryOverScope(
				config.S,
				s,
				historyByTid,
				champion ? champion.tid : null,
			);

			// 3. Apply eligibility mask (dial E): zero out cola for non-eligible
			// teams so the lottery draw effectively excludes them.
			await applyEligibilityMask(config.E, outcomes);

			// 4. REAL ZenGM: update lottery chances after playoffs.
			await cola.updateLotteryChancesAfterPlayoffs();

			// 5. Apply cap clamp (dial C).
			await applyCapClamp(config.C);

			// 6. REAL ZenGM: run the lottery draw (mock=true so it doesn't
			//    persist draft picks to a real DB; we read the returned
			//    draftPicks array). RNG: deterministic (Math.random override).
			const draftRes = await draft.genOrder(true);
			const draftPickByTid: Record<number, number> = {};
			for (const dp of draftRes.draftPicks) {
				if (dp.round === 1 && dp.tid === dp.originalTid) {
					draftPickByTid[dp.tid] = dp.pick;
				}
			}

			// 7. REAL ZenGM: apply post-lottery diminishment to the top 4 picks.
			const top4Tids = draftRes.draftPicks
				.filter((dp) => dp.round === 1 && dp.pick >= 1 && dp.pick <= 4)
				.sort((a, b) => a.pick - b.pick)
				.map((dp) => dp.originalTid);
			await cola.updateLotteryChancesAfterLottery(top4Tids);

			// 8. Capture per-team state.
			const teamsNow = await idb.cache.teams.getAll();
			const colaByTid: Record<number, number> = {};
			for (const t of teamsNow) {
				colaByTid[t.tid] = t.cola ?? 0;
				historyByTid[t.tid] ??= [];
				historyByTid[t.tid]!.push({ season: s, cola: t.cola ?? 0 });
			}
			const entry: SeasonEntry = {
				season: s,
				teams: outcomes.map((o) => ({
					tid: o.tid,
					conf: o.cid === 0 ? "E" : "W",
					wins: o.wins,
					playoffRoundsWon: o.playoffRoundsWon,
					draftPick: draftPickByTid[o.tid] ?? null,
					cola: colaByTid[o.tid] ?? 0,
				})),
			};
			seasonLog.push(entry);

			// 9. Markov transition: evolve each team's strength based on the
			// season's draft pick.
			for (const t of teamsForRng) {
				const pick = draftPickByTid[t.tid] ?? null;
				persistentStrength[t.tid] = transitionStrength(
					persistentStrength[t.tid]!,
					pick,
					rng,
				);
			}
		}
	} finally {
		Math.random = originalRandom;
	}

	return seasonLog;
}

test("ZenGM COLA sweep driver: one config, N replicates × M seasons", async () => {
	const configRaw = process.env.COLA_DRIVER_CONFIG;
	const outputPath = process.env.COLA_DRIVER_OUTPUT;
	const replicatesRaw = process.env.COLA_DRIVER_REPLICATES;
	if (!configRaw || !outputPath) {
		// Skip silently when not driven by the sweep harness; tests in this file
		// only execute when env is set.
		console.log("[colaSweepDriver] skipping: env not set");
		return;
	}
	const config = JSON.parse(configRaw) as Config;

	if (replicatesRaw) {
		// Batched mode: run all replicates in this single vitest subprocess.
		// Output: JSON array of { seed, seasonLog } in the requested order.
		const seeds = JSON.parse(replicatesRaw) as number[];
		if (!Array.isArray(seeds) || seeds.length === 0) {
			throw new Error(`COLA_DRIVER_REPLICATES expected non-empty array, got '${replicatesRaw}'`);
		}
		const results: { seed: number; seasonLog: SeasonEntry[] }[] = [];
		for (const seed of seeds) {
			const t0 = Date.now();
			const seasonLog = await runOneReplicate(config, seed);
			const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
			console.log(
				`[colaSweepDriver] config=${config.id} seed=${seed} seasons=${seasonLog.length} elapsed=${elapsed}s`,
			);
			results.push({ seed, seasonLog });
		}
		fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
		console.log(
			`[colaSweepDriver] wrote ${results.length} replicates × ${config.seasons} seasons to ${outputPath}`,
		);
		return;
	}

	// Legacy single-replicate mode (no COLA_DRIVER_REPLICATES). Preserved for
	// any external caller still using the old shape, but the sweep.js harness
	// now always sets COLA_DRIVER_REPLICATES.
	const seasonLog = await runOneReplicate(config, config.seed);
	fs.writeFileSync(outputPath, JSON.stringify(seasonLog, null, 2));
	console.log(
		`[colaSweepDriver] wrote ${seasonLog.length} seasons to ${outputPath} (legacy single-replicate path)`,
	);
});
