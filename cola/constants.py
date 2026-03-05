"""
COLA mechanism parameters and NBA league structure.

All values sourced from:
  Highley, Duncan & Volkov (2026). "Carry-Over Lottery Allocation:
  Practical Incentive-Compatible Drafts." arXiv:2602.02487.
"""

# League structure
N_TEAMS = 30
N_PLAYOFF = 16
N_LOTTERY = N_TEAMS - N_PLAYOFF  # 14
GAMES_PER_SEASON = 82

# COLA mechanism (Classic variant)
ALPHA = 1000  # annual lottery ticket increment per non-playoff team
TOP_PICKS_RAFFLED = 4

# Diminishment: playoff success (fraction of index removed)
PLAYOFF_DIMINISH = {
    "champion": 1.00,       # index -> 0
    "runner_up": 0.75,
    "conf_finals": 0.50,
    "second_round": 0.25,
    "first_round": 0.00,    # unchanged
}

# Diminishment: draft lottery wins
DRAFT_DIMINISH = {
    1: 1.00,  # 1st pick: index -> 0
    2: 0.75,
    3: 0.50,
    4: 0.25,
}

# Bradley-Terry simulation parameters
S_MIN, S_MAX = 5.0, 100.0
DECAY_RANGE = (0.05, 0.15)
DRAFT_BETA = 7.5  # Rescorla-Wagner learning rate

# Draft quality coefficients c(pick) -- decreasing from pick 1 to 14.
# Linear interpolation from 1.0 (pick 1) to ~0.1 (pick 14).
DRAFT_COEFFS = {i: max(0.1, 1.0 - (i - 1) * 0.07) for i in range(1, 15)}

# Analytic bound parameters (from 1000-season simulation observations)
T_MAX = 10        # max consecutive non-playoff years observed
T_BOUNDARY = 5    # max consecutive misses for a team near the playoff line
K_BAR_DEFAULT = 3.1  # average index multiplier across lottery teams

# Paper's reported simulation results (for comparison)
PAPER_SIM = {
    "avg_pool": 43_410,
    "avg_delta": 1_805,
    "avg_gain": 0.006,       # 0.6 percentage points
    "p90_gain": 0.015,       # 1.5%
    "max_gain": 0.030,       # 3.0%
    "n_seasons": 1000,
}
