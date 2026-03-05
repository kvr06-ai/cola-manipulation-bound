"""
Analytic bound on pool manipulation gain in COLA.

The pool manipulation loophole: a team deliberately loses to a high-index
opponent near the playoff line, pushing them into the playoffs and shrinking
the lottery pool. This increases the manipulator's win probability.

Exact gain: G_i = L_i * Delta / (P * (P - Delta))
Approx:     G_i ~ p_i * (Delta / P)
Bound:      G_max <= T_max * (T_boundary - 1) / ((T_max + n - 1) * n * k_bar)
"""

import numpy as np

from .constants import (
    ALPHA, K_BAR_DEFAULT, N_LOTTERY, PAPER_SIM, T_BOUNDARY, T_MAX,
)


def manipulation_gain(L_i: float, L_h: float, L_l: float, P: float) -> float:
    """Exact probability gain from a single pool manipulation swap.

    Args:
        L_i: Lottery index of the manipulating team.
        L_h: Index of the high-index team pushed INTO the playoffs (removed).
        L_l: Index of the low-index team that REPLACES L_h in the lottery.
        P:   Total lottery pool before the swap.

    Returns:
        Probability gain G_i (as a fraction, not percentage).
    """
    delta = L_h - L_l
    if delta <= 0 or P <= delta:
        return 0.0
    return L_i * delta / (P * (P - delta))


def manipulation_gain_approx(p_i: float, delta_frac: float) -> float:
    """First-order approximation of manipulation gain.

    G ~ p_i * (Delta / P)

    Valid when Delta << P (typically Delta/P ~ 4%).

    Args:
        p_i: Manipulator's base win probability (L_i / P).
        delta_frac: Fractional pool change (Delta / P).
    """
    return p_i * delta_frac


def manipulation_bound(
    T_max: int = T_MAX,
    T_boundary: int = T_BOUNDARY,
    n: int = N_LOTTERY,
    k_bar: float = K_BAR_DEFAULT,
) -> float:
    """Conditioned upper bound on maximum manipulation gain.

    G_max <= T_max * (T_boundary - 1) / ((T_max + n - 1) * n * k_bar)

    This assumes no team misses playoffs for more than T_max consecutive
    years and no team near the playoff line has missed more than T_boundary
    consecutive years (structural anti-correlation: high index => weak team
    => far from playoff line).

    Args:
        T_max: Maximum consecutive non-playoff years for any team.
        T_boundary: Maximum consecutive misses for a team near the playoff line.
        n: Number of lottery teams.
        k_bar: Average index multiplier across lottery teams.
    """
    return T_max * (T_boundary - 1) / ((T_max + n - 1) * n * k_bar)


def steady_state_pool(n: int = N_LOTTERY, alpha: int = ALPHA,
                      avg_years: float = 3.1) -> float:
    """Estimate the steady-state total lottery pool.

    In steady state, ~n teams are in the lottery, each accumulating alpha
    per year. The average team spends ~avg_years in the lottery before
    either making the playoffs or having their index diminished.

    Paper's simulation average: 43,410. This estimate: n * alpha * avg_years.
    """
    return n * alpha * avg_years


def sweep_bound(
    T_max_range: np.ndarray | None = None,
    T_boundary_range: np.ndarray | None = None,
    n: int = N_LOTTERY,
    k_bar: float = K_BAR_DEFAULT,
) -> dict:
    """2D parameter sweep of the bound over (T_max, T_boundary).

    Returns dict with keys: T_max, T_boundary, bound (2D array).
    """
    if T_max_range is None:
        T_max_range = np.arange(3, 16)
    if T_boundary_range is None:
        T_boundary_range = np.arange(2, 9)

    bound = np.zeros((len(T_max_range), len(T_boundary_range)))
    for i, tm in enumerate(T_max_range):
        for j, tb in enumerate(T_boundary_range):
            bound[i, j] = manipulation_bound(int(tm), int(tb), n, k_bar)

    return {
        "T_max": T_max_range,
        "T_boundary": T_boundary_range,
        "bound": bound,
    }


def gain_curves(
    delta_frac_range: np.ndarray | None = None,
    p_i_values: list[float] | None = None,
) -> dict:
    """Compute exact and approximate gain curves for varying Delta/P.

    Returns dict with keys: delta_frac, p_i_values, exact (2D), approx (2D).
    """
    if delta_frac_range is None:
        delta_frac_range = np.linspace(0.001, 0.15, 200)
    if p_i_values is None:
        p_i_values = [0.05, 0.10, 0.15, 0.20]

    # For exact formula: G = p_i * delta_frac / (1 - delta_frac)
    # (derived from G = L_i * Delta / (P * (P - Delta)) with p_i = L_i/P)
    exact = np.zeros((len(p_i_values), len(delta_frac_range)))
    approx = np.zeros_like(exact)

    for i, p_i in enumerate(p_i_values):
        for j, df in enumerate(delta_frac_range):
            exact[i, j] = p_i * df / (1 - df)
            approx[i, j] = manipulation_gain_approx(p_i, df)

    return {
        "delta_frac": delta_frac_range,
        "p_i_values": p_i_values,
        "exact": exact,
        "approx": approx,
    }


def compare_to_paper() -> dict:
    """Summary comparison of analytic bound vs. paper's simulation."""
    bound = manipulation_bound()
    return {
        "bound": bound,
        "bound_pct": f"{bound * 100:.1f}%",
        "paper_avg": PAPER_SIM["avg_gain"],
        "paper_p90": PAPER_SIM["p90_gain"],
        "paper_max": PAPER_SIM["max_gain"],
        "ratio_to_max": bound / PAPER_SIM["max_gain"],
    }
