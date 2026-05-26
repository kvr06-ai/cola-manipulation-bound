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

// ============================================================================
// Synthetic regular-season + playoff bracket.
//
// For each franchise, draw a season "strength" from a mild parity distribution.
// Convert to wins, sort within conference, top 8 enter playoffs, lottery teams
// are the rest. Walk a single-elimination bracket with probability proportional
// to relative strength (no home-court adjustment, no injuries, no mid-season
// trades — those are not what the paper's dial space controls).
// ============================================================================

function simulateSeasonOutcomes(
	rng: () => number,
	teams: { tid: number; cid: number }[],
): { wins: number; playoffRoundsWon: number; tid: number; cid: number }[] {
	const NUM_TEAMS = teams.length;
	// Strength: gamma-like proxy. 0..1, mean 0.5.
	const strength = teams.map(() => 0.2 + rng() * 0.6);
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

test("ZenGM COLA sweep driver: one config, N seasons", async () => {
	const configRaw = process.env.COLA_DRIVER_CONFIG;
	const outputPath = process.env.COLA_DRIVER_OUTPUT;
	if (!configRaw || !outputPath) {
		// Skip silently when not driven by the sweep harness; tests in this file
		// only execute when env is set.
		console.log("[colaSweepDriver] skipping: env not set");
		return;
	}
	const config = JSON.parse(configRaw) as Config;
	const SEASONS = config.seasons;
	const NUM_TEAMS = 30;
	const START_SEASON = 2025;

	const rng = mulberry32(hashSeed(config.id, config.seed, 42));
	configureEligibility(config.E);

	await bootstrapLeague(NUM_TEAMS, START_SEASON);
	const teamsForRng = (await idb.cache.teams.getAll()).map((t) => ({
		tid: t.tid,
		cid: t.cid,
	}));

	const seasonLog: SeasonEntry[] = [];
	const historyByTid: Record<number, { season: number; cola: number }[]> = {};

	for (let s = 0; s < SEASONS; s++) {
		const currentSeason = START_SEASON + s;
		g.setWithoutSavingToDB("season", currentSeason);

		// 1. Simulate season outcomes (wins + playoff bracket).
		const outcomes = simulateSeasonOutcomes(rng, teamsForRng);
		await appendTeamSeasons(currentSeason, outcomes);

		// 2. Apply carry-over scope (dial S) BEFORE the COLA update.
		const champion = outcomes.find((o) => o.playoffRoundsWon === 4);
		await applyCarryOverScope(
			config.S,
			s,
			historyByTid,
			champion ? champion.tid : null,
		);

		// 3. Apply eligibility mask (dial E): zero out cola for non-eligible teams
		// so the lottery draw effectively excludes them.
		await applyEligibilityMask(config.E, outcomes);

		// 4. REAL ZenGM: update lottery chances after playoffs.
		await cola.updateLotteryChancesAfterPlayoffs();

		// 5. Apply cap clamp (dial C).
		await applyCapClamp(config.C);

		// 6. REAL ZenGM: run the lottery draw (mock=true so it doesn't persist
		//    draft picks to a real DB; we read the returned draftPicks array).
		const draftRes = await draft.genOrder(true);
		const draftPickByTid: Record<number, number> = {};
		for (const dp of draftRes.draftPicks) {
			if (dp.round === 1 && dp.tid === dp.originalTid) {
				draftPickByTid[dp.tid] = dp.pick;
			}
		}

		// 7. REAL ZenGM: apply post-lottery diminishment to the top 4 picks.
		// Need to extract the top-4 tids from draftPicks (round 1, picks 1..4).
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
	}

	fs.writeFileSync(outputPath, JSON.stringify(seasonLog, null, 2));
	console.log(`[colaSweepDriver] wrote ${seasonLog.length} seasons to ${outputPath}`);
});
