// Full-engine COLA sweep driver -- SCAFFOLD (step 1 of the tactical plan).
//
// Goal of this scaffold: prove the phase-stepping season loop with the dial
// hook works end-to-end for one grid config against the REAL ZenGM engine
// (real rosters / contracts / AI GMs / per-game sim), not the synthesized
// Track B testbed. This de-risks the lottery-boundary intercept before the
// full driver (all dials + Countdown/Beckett anchors + pruning) is built.
//
// Design (see collab doc "Full-engine driver: tactical execution plan"):
//   - Drive the season by phase-stepping (a synchronous, fully-awaited
//     version of autoPlay), NOT autoPlayUntil (which self-drives past the
//     hook and detaches promises).
//   - game.play() auto-advances phases at schedule exhaustion
//     (reg-season -> PLAYOFFS, playoffs -> DRAFT_LOTTERY). The
//     PLAYOFFS->DRAFT_LOTTERY transition runs the engine's own
//     cola.updateLotteryChancesAfterPlayoffs() internally.
//   - Two hook points bracket the cola update:
//       Hook A  @ PRESEASON   : carry-over scope (dial S), applied BEFORE the
//                               season so the reset precedes the increment.
//       Hook B  @ DRAFT_LOTTERY: eligibility mask (dial E) + cap clamp (dial C),
//                               applied AFTER updateLotteryChancesAfterPlayoffs
//                               (which already incremented every non-advancing
//                               team, R1 losers included) and BEFORE the draw.
//     NB: applying the E mask AFTER the cola update is the correction of a
//     latent Track B ordering bug -- Track B masked R1 losers BEFORE the
//     update, which re-incremented them straight back into the pool.
//
// Run: COLA_SPIKE=1 npx vitest --run src/test/colaFullEngineDriver.test.ts --project basketball

import "fake-indexeddb/auto";
import * as fs from "node:fs";
import { afterAll, expect, test } from "vitest";
import { draft, freeAgents, game, league, phase, season } from "../worker/core/index.ts";
import { idb } from "../worker/db/index.ts";
import { g, helpers, local } from "../worker/util/index.ts";
import "../worker/index.ts";
import createStreamFromLeagueObject from "../worker/core/league/create/createStreamFromLeagueObject.ts";
import { LEAGUE_DATABASE_VERSION, PHASE } from "../common/constants.ts";
import { getDefaultSettings } from "../worker/views/newLeague.ts";
import { last } from "../common/utils.ts";
import { defaultGameAttributes } from "../common/defaultGameAttributes.ts";

type Config = {
	id: number;
	E: number | "16-tiered";
	C: number | null;
	S: "single-season" | "unbounded" | "bounded-30yr" | "reset-on-championship";
	seasons: number;
};

type TeamRec = {
	tid: number;
	wins: number;
	playoffRoundsWon: number;
	draftPick: number | null;
	cola: number;
};
type SeasonRec = { season: number; teams: TeamRec[] };

const NO_COND = {};

// --- Dial transforms (ported from Track B, with corrected ordering) ---------

// Hook A: carry-over scope. Applied at PRESEASON, before the season runs.
async function applyCarryOverScope(
	S: Config["S"],
	priorChampionTid: number | null,
) {
	if (S === "unbounded") return; // engine default: cola carries over as-is
	const teams = await idb.cache.teams.getAll();
	if (S === "single-season") {
		for (const t of teams) {
			t.cola = 0;
			await idb.cache.teams.put(t);
		}
		return;
	}
	if (S === "reset-on-championship") {
		if (priorChampionTid === null) return;
		for (const t of teams) {
			if (t.tid === priorChampionTid) {
				t.cola = 0;
				await idb.cache.teams.put(t);
			}
		}
		return;
	}
	// bounded-30yr: SCAFFOLD STUB -- treated as unbounded for now; the real
	// 30-year-window truncation lands with the full driver (task #68).
}

// Hook B (part 1): eligibility mask. Applied at DRAFT_LOTTERY, AFTER the cola
// update, BEFORE the draw. Zeros cola for teams outside the pool so the lottery
// draw skips them (cola=0 -> zero chance -> falls through to rank order).
async function applyEligibilityMask(
	E: Config["E"],
	seasonTeamSeasons: { tid: number; playoffRoundsWon: number; won: number }[],
) {
	if (E === 22) return; // engine default pool (14 non-playoff + 8 R1 losers)
	const teams = await idb.cache.teams.getAll();
	if (E === 14) {
		// R1 losers (made playoffs, won 0 rounds) drop out; the 14 non-playoff
		// teams (playoffRoundsWon < 0) stay.
		for (const ts of seasonTeamSeasons) {
			if (ts.playoffRoundsWon === 0) {
				const t = teams.find((x) => x.tid === ts.tid);
				if (t) {
					t.cola = 0;
					await idb.cache.teams.put(t);
				}
			}
		}
		return;
	}
	if (E === "16-tiered") {
		// SCAFFOLD: approximate as the 16 worst-record teams (Track B B-2).
		const eligible = new Set(
			seasonTeamSeasons
				.slice()
				.sort((a, b) => a.won - b.won)
				.slice(0, 16)
				.map((ts) => ts.tid),
		);
		for (const t of teams) {
			if (!eligible.has(t.tid)) {
				t.cola = 0;
				await idb.cache.teams.put(t);
			}
		}
	}
}

// Hook B (part 2): cap clamp. Applied at DRAFT_LOTTERY, after the eligibility
// mask, before the draw.
async function applyCapClamp(C: Config["C"]) {
	if (C === null) return;
	const teams = await idb.cache.teams.getAll();
	for (const t of teams) {
		if (t.cola !== undefined && t.cola > C) {
			t.cola = C;
			await idb.cache.teams.put(t);
		}
	}
}

// --- League construction ----------------------------------------------------

async function createColaLeague(startSeason: number) {
	const settings = { ...getDefaultSettings(), draftType: "cola" as const };
	await league.createStream(createStreamFromLeagueObject({}), {
		confs: last(defaultGameAttributes.confs).value,
		divs: last(defaultGameAttributes.divs).value,
		fromFile: {
			gameAttributes: undefined,
			hasRookieContracts: true,
			maxGid: undefined,
			startingSeason: undefined,
			teams: undefined,
			version: LEAGUE_DATABASE_VERSION,
		},
		getLeagueOptions: undefined,
		keptKeys: new Set<any>(),
		lid: 0,
		name: "ColaFullEngine",
		setLeagueCreationStatus: () => {},
		settings,
		shuffleRosters: false,
		startingSeasonFromInput: String(startSeason),
		teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
		tid: 0,
	} as any);

	// Spectator mode: no human-managed team, so the AI fills/resigns every
	// roster (incl. tid 0) during resign + free agency. Without this,
	// team.checkRosterSizes("user") raises a blocking error once the user
	// team's roster falls below the minimum, and game.play() silently no-ops
	// (play.ts:614+). This is the headless-sweep equivalent of autoPlayUntil.
	g.setWithoutSavingToDB("spectator", true);
}

// --- Season capture ---------------------------------------------------------

async function captureSeasonRecord(seasonNow: number): Promise<SeasonRec> {
	const tss = (await idb.cache.teamSeasons.getAll()).filter(
		(ts: any) => ts.season === seasonNow,
	);
	const teams = await idb.cache.teams.getAll();
	const dps = await idb.cache.draftPicks.getAll();
	const pickByTid: Record<number, number> = {};
	for (const dp of dps as any[]) {
		if (dp.season === seasonNow && dp.round === 1) {
			pickByTid[dp.originalTid ?? dp.tid] = dp.pick;
		}
	}
	return {
		season: seasonNow,
		teams: tss.map((ts: any) => ({
			tid: ts.tid,
			wins: ts.won,
			playoffRoundsWon: ts.playoffRoundsWon,
			draftPick: pickByTid[ts.tid] ?? null,
			cola: teams.find((t: any) => t.tid === ts.tid)?.cola ?? 0,
		})),
	};
}

// --- Phase-stepping driver --------------------------------------------------

async function runConfig(config: Config): Promise<SeasonRec[]> {
	const START = 2025;
	await createColaLeague(START);

	const records: SeasonRec[] = [];
	const trace: string[] = [];
	let priorChampionTid: number | null = null;
	let guard = 0;
	const guardMax = config.seasons * 25 + 50;

	while (records.length < config.seasons && guard < guardMax) {
		guard += 1;
		const ph = g.get("phase");

		if (ph === PHASE.PRESEASON) {
			await applyCarryOverScope(config.S, priorChampionTid); // Hook A
			await phase.newPhase(PHASE.REGULAR_SEASON, NO_COND);
			trace.push(`${g.get("season")}:PRESEASON->REG`);
		} else if (
			ph === PHASE.REGULAR_SEASON ||
			ph === PHASE.AFTER_TRADE_DEADLINE
		) {
			const days = await season.getDaysLeftSchedule();
			trace.push(`${g.get("season")}:play(ph=${ph},days=${days})`);
			await game.play(days, NO_COND);
		} else if (ph === PHASE.PLAYOFFS) {
			await game.play(100, NO_COND);
		} else if (ph === PHASE.DRAFT_LOTTERY) {
			const seasonNow = g.get("season");
			const tss = (await idb.cache.teamSeasons.getAll())
				.filter((ts: any) => ts.season === seasonNow)
				.map((ts: any) => ({
					tid: ts.tid,
					playoffRoundsWon: ts.playoffRoundsWon,
					won: ts.won,
				}));
			await applyEligibilityMask(config.E, tss); // Hook B.1
			await applyCapClamp(config.C); // Hook B.2
			await phase.newPhase(PHASE.DRAFT, NO_COND); // runs genOrder (real lottery draw)
			const rec = await captureSeasonRecord(seasonNow);
			records.push(rec);
			const champ = rec.teams.find((t) => t.playoffRoundsWon === 4);
			priorChampionTid = champ ? champ.tid : null;
		} else if (ph === PHASE.DRAFT) {
			await draft.runPicks({ type: "untilEnd" }, NO_COND);
		} else if (ph === PHASE.AFTER_DRAFT) {
			await phase.newPhase(PHASE.RESIGN_PLAYERS, NO_COND);
		} else if (ph === PHASE.RESIGN_PLAYERS) {
			await phase.newPhase(PHASE.FREE_AGENCY, NO_COND);
		} else if (ph === PHASE.FREE_AGENCY) {
			await freeAgents.play(g.get("daysLeft"), NO_COND);
		} else {
			throw new Error(`Unexpected phase in driver loop: ${ph}`);
		}
	}

	if (records.length < config.seasons) {
		throw new Error(
			`Driver stalled: ${records.length}/${config.seasons} seasons, last phase ${g.get("phase")}, guard ${guard}\nlast trace:\n${trace.slice(-25).join("\n")}`,
		);
	}
	return records;
}

// --- Test -------------------------------------------------------------------

test.skipIf(!process.env.COLA_SPIKE)(
	"full-engine COLA driver scaffold: cfg 1 (Classic E=14) runs end-to-end",
	{ timeout: 10 * 60 * 1000 },
	async () => {
		const config: Config = {
			id: 1,
			E: 14,
			C: null,
			S: "unbounded",
			seasons: Number(process.env.COLA_DRIVER_SEASONS ?? 3),
		};

		const t0 = Date.now();
		const records = await runConfig(config);
		const wall = (Date.now() - t0) / 1000;

		// For each season: did the lottery use cola? (worst non-playoff teams
		// should hold the most cola and land top picks.) Did E=14 zero the R1
		// losers? Build a compact diagnostic per season.
		const perSeason = records.map((r) => {
			const sorted = r.teams.slice().sort((a, b) => b.cola - a.cola);
			const top3Cola = sorted.slice(0, 3).map((t) => ({
				tid: t.tid,
				wins: t.wins,
				prw: t.playoffRoundsWon,
				cola: t.cola,
				pick: t.draftPick,
			}));
			const r1Losers = r.teams.filter((t) => t.playoffRoundsWon === 0);
			const r1LoserColaMax = r1Losers.length
				? Math.max(...r1Losers.map((t) => t.cola))
				: 0;
			// Best (lowest) lottery pick any masked R1 loser received. With E=14
			// they are excluded from the 14-team lottery, so this should be >14.
			const r1LoserPicks = r1Losers
				.map((t) => t.draftPick)
				.filter((p): p is number => p !== null);
			const r1LoserBestPick = r1LoserPicks.length
				? Math.min(...r1LoserPicks)
				: null;
			const champ = r.teams.find((t) => t.playoffRoundsWon === 4);
			const lotteryTeams = r.teams.filter((t) => t.cola > 0).length;
			const maxCola = Math.max(...r.teams.map((t) => t.cola));
			return {
				season: r.season,
				lotteryTeamsWithCola: lotteryTeams,
				maxCola,
				r1LoserColaMax,
				r1LoserBestPick,
				championTid: champ?.tid ?? null,
				championCola: champ?.cola ?? null,
				top3ByCola: top3Cola,
			};
		});

		const diag = {
			config,
			wallSecs: Number(wall.toFixed(2)),
			secPerSeason: Number((wall / records.length).toFixed(2)),
			seasonsCompleted: records.length,
			endSeason: g.get("season"),
			perSeason,
		};
		console.log("\n===== FULL-ENGINE DRIVER SCAFFOLD =====");
		console.log(JSON.stringify(diag, null, 2));
		console.log("=======================================\n");
		fs.writeFileSync(
			"/tmp/cola_fulldriver_diag.json",
			JSON.stringify(diag, null, 2),
		);

		// Mechanism assertions (proving the phase-stepping loop + dial hook):
		expect(records.length).toBe(config.seasons);
		for (const r of records) {
			// Every season produced a real lottery order (pick 1 was assigned).
			const picks = r.teams
				.map((t) => t.draftPick)
				.filter((p): p is number => p !== null);
			expect(picks).toContain(1);
		}
		for (const s of perSeason) {
			// Hook B (E=14): R1 losers were zeroed before the draw...
			expect(s.r1LoserColaMax).toBe(0);
			// ...and the real engine honored it -- masked R1 losers fell OUT of
			// the 14-team lottery into rank order (pick > 14). This is the proof
			// that the dial transform flowed into genOrder, not just the cache.
			if (s.r1LoserBestPick !== null) {
				expect(s.r1LoserBestPick).toBeGreaterThan(14);
			}
		}
		// Hook A / carryover: under S=unbounded, cola accumulates across droughts;
		// by the final season some team has stacked more than one year's alpha.
		expect(perSeason[perSeason.length - 1]!.maxCola).toBeGreaterThanOrEqual(
			2000,
		);
	},
);

afterAll(async () => {
	try {
		local.autoPlayUntil = undefined;
		if (g.get("lid") !== undefined) {
			await league.remove(g.get("lid"));
		}
	} catch {}
});
