"""
Thin simulation layer for validating the analytic bound.

Two modes:
  1. Full Bradley-Terry league simulation with COLA mechanism (slow, realistic).
  2. Fast Monte Carlo over random pool configurations (fast, targeted).

Neither aims to replicate the paper's full 1000-season analysis. The goal is
to confirm the analytic bound holds across randomly generated scenarios.
"""

from __future__ import annotations

import numpy as np

from .bound import manipulation_gain
from .constants import (
    ALPHA, DECAY_RANGE, DRAFT_BETA, DRAFT_COEFFS, DRAFT_DIMINISH,
    GAMES_PER_SEASON, N_LOTTERY, N_PLAYOFF, N_TEAMS, PLAYOFF_DIMINISH,
    S_MAX, S_MIN, T_MAX,
)


class BradleyTerryLeague:
    """Simulates NBA-like seasons using the Bradley-Terry model."""

    def __init__(self, n_teams: int = N_TEAMS, seed: int = 42):
        self.n_teams = n_teams
        self.rng = np.random.default_rng(seed)
        self.strengths = self.rng.uniform(S_MIN, S_MAX, n_teams)

    def play_season(self) -> tuple[np.ndarray, np.ndarray]:
        """Simulate one 82-game season. Returns (wins_array, rankings)."""
        wins = np.zeros(self.n_teams, dtype=int)
        # Each team plays GAMES_PER_SEASON games against random opponents
        for team in range(self.n_teams):
            opponents = self.rng.choice(
                [j for j in range(self.n_teams) if j != team],
                size=GAMES_PER_SEASON,
                replace=True,
            )
            for opp in opponents:
                p_win = self.strengths[team] / (
                    self.strengths[team] + self.strengths[opp]
                )
                if self.rng.random() < p_win:
                    wins[team] += 1
        rankings = np.argsort(-wins)  # best to worst
        return wins, rankings

    def apply_decay(self):
        """Annual strength decay: S_i *= (1 - d_i), d_i ~ U(0.05, 0.15)."""
        d = self.rng.uniform(*DECAY_RANGE, self.n_teams)
        self.strengths *= (1 - d)

    def apply_draft_boost(self, team_idx: int, pick: int):
        """Rescorla-Wagner draft improvement."""
        c = DRAFT_COEFFS.get(pick, 0.1)
        delta_s = c * (S_MAX - self.strengths[team_idx]) * DRAFT_BETA
        self.strengths[team_idx] += delta_s
        # Clamp
        self.strengths[team_idx] = min(self.strengths[team_idx], S_MAX)


class COLAMechanism:
    """Tracks COLA lottery indices and computes manipulation gains."""

    def __init__(self, n_teams: int = N_TEAMS, alpha: int = ALPHA):
        self.n_teams = n_teams
        self.alpha = alpha
        self.indices = np.zeros(n_teams, dtype=float)

    def increment_lottery_teams(self, lottery_mask: np.ndarray):
        """Add alpha to each lottery team's index."""
        self.indices[lottery_mask] += self.alpha

    def diminish_playoff(self, team_idx: int, result: str):
        """Apply playoff diminishment."""
        frac = PLAYOFF_DIMINISH.get(result, 0.0)
        self.indices[team_idx] *= (1 - frac)

    def diminish_draft(self, team_idx: int, pick: int):
        """Apply draft pick diminishment."""
        if pick in DRAFT_DIMINISH:
            frac = DRAFT_DIMINISH[pick]
            self.indices[team_idx] *= (1 - frac)

    def max_manipulation_gain(
        self, lottery_teams: np.ndarray, playoff_teams: np.ndarray,
    ) -> float:
        """Find maximum gain across all possible single-team swaps.

        For each lottery team i, consider pushing each playoff team h
        (near the boundary) into the playoffs, replacing them with the
        lowest-index team that would drop out. Returns the max gain.
        """
        if len(lottery_teams) == 0 or len(playoff_teams) == 0:
            return 0.0

        lottery_indices = self.indices[lottery_teams]
        playoff_indices = self.indices[playoff_teams]
        P = lottery_indices.sum()

        if P <= 0:
            return 0.0

        # The "pushable" team: highest-index team among lottery teams
        # near the playoff boundary (could be pushed into playoffs).
        # The replacement: lowest-index team in playoffs (would drop
        # to lottery if a lottery team takes their spot).
        # For simplicity, consider the swap of the highest-index lottery
        # team with the lowest-index playoff team.
        L_h = lottery_indices.max()  # highest lottery index (near boundary)
        L_l = self.alpha  # minimum index (team just fell out of playoffs)

        max_gain = 0.0
        for i, L_i in enumerate(lottery_indices):
            g = manipulation_gain(L_i, L_h, L_l, P)
            max_gain = max(max_gain, g)

        return max_gain


def run_simulation(n_seasons: int = 200, seed: int = 42) -> dict:
    """Run multi-season simulation, return gains distribution.

    This is a simplified simulation for bound validation. It does not
    replicate the paper's full analysis (1000 seasons with structured
    playoffs). It runs enough seasons to confirm the bound holds.
    """
    league = BradleyTerryLeague(n_teams=N_TEAMS, seed=seed)
    cola = COLAMechanism(n_teams=N_TEAMS)

    gains = []
    pool_sizes = []

    for _ in range(n_seasons):
        wins, rankings = league.play_season()
        playoff_teams = rankings[:N_PLAYOFF]
        lottery_teams = rankings[N_PLAYOFF:]

        # Create boolean mask for lottery teams
        lottery_mask = np.zeros(N_TEAMS, dtype=bool)
        lottery_mask[lottery_teams] = True

        # Increment lottery teams
        cola.increment_lottery_teams(lottery_mask)

        # Record pool size and max manipulation gain
        P = cola.indices[lottery_teams].sum()
        pool_sizes.append(P)
        g_max = cola.max_manipulation_gain(lottery_teams, playoff_teams)
        gains.append(g_max)

        # Simulate simple playoff diminishment (champion + runner-up)
        if len(playoff_teams) >= 2:
            cola.diminish_playoff(playoff_teams[0], "champion")
            cola.diminish_playoff(playoff_teams[1], "runner_up")

        # Draft: top pick goes to lottery team with highest index
        lottery_by_index = sorted(
            lottery_teams, key=lambda t: cola.indices[t], reverse=True
        )
        for pick in range(1, min(5, len(lottery_by_index) + 1)):
            team = lottery_by_index[pick - 1]
            cola.diminish_draft(team, pick)
            league.apply_draft_boost(team, pick)

        # Annual decay
        league.apply_decay()

    gains = np.array(gains)
    pool_sizes = np.array(pool_sizes)

    return {
        "gains": gains,
        "mean": float(np.mean(gains)),
        "p90": float(np.percentile(gains, 90)),
        "max": float(np.max(gains)),
        "pool_sizes": pool_sizes,
        "n_seasons": n_seasons,
    }


def compute_empirical_gains(n_samples: int = 10_000, seed: int = 42) -> dict:
    """Fast Monte Carlo over random pool configurations.

    Generates random lottery pools from the implied steady-state
    distribution and computes the maximum manipulation gain for each.
    Much faster than the full BT simulation.
    """
    rng = np.random.default_rng(seed)
    gains = np.zeros(n_samples)

    for i in range(n_samples):
        # Random number of years for each lottery team (1 to T_MAX)
        n = N_LOTTERY
        years = rng.integers(1, T_MAX + 1, size=n)
        indices = years * ALPHA

        P = indices.sum()
        if P <= 0:
            continue

        # Swap: highest-index lottery team vs. a 1-year team
        L_h = indices.max()
        L_l = ALPHA  # 1-year minimum

        # Max gain goes to the team with the highest remaining index
        # (excluding the swapped-out team, but for an upper bound we
        # include it)
        for L_i in indices:
            g = manipulation_gain(L_i, L_h, L_l, P)
            gains[i] = max(gains[i], g)

    return {
        "gains": gains,
        "mean": float(np.mean(gains)),
        "p90": float(np.percentile(gains, 90)),
        "max": float(np.max(gains)),
        "n_samples": n_samples,
    }
