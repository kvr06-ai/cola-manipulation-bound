"""
Publication-quality figures for the COLA manipulation bound analysis.

Four plots:
  1. gain_vs_delta    -- Gain curves for varying base probabilities
  2. bound_sensitivity -- Heatmap of bound over (T_max, T_boundary)
  3. sim_histogram    -- Distribution of simulated max gains
  4. bound_vs_sim     -- Per-season gains vs. analytic bound
"""

from __future__ import annotations

from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np

from .bound import gain_curves, manipulation_bound, sweep_bound
from .constants import PAPER_SIM, T_BOUNDARY, T_MAX


def set_style():
    """Academic figure style."""
    plt.rcParams.update({
        "font.family": "serif",
        "font.size": 11,
        "axes.linewidth": 0.8,
        "axes.grid": False,
        "figure.figsize": (6, 4),
        "savefig.dpi": 300,
        "savefig.bbox": "tight",
        "savefig.pad_inches": 0.1,
    })


def plot_gain_vs_delta(out_dir: Path):
    """Plot 1: Gain curves for varying p_i with bound and paper references."""
    set_style()
    data = gain_curves()
    fig, ax = plt.subplots()

    colors = ["#2c7bb6", "#d7191c", "#fdae61", "#abd9e9"]
    for i, p_i in enumerate(data["p_i_values"]):
        ax.plot(
            data["delta_frac"] * 100, data["exact"][i] * 100,
            color=colors[i], linewidth=1.5,
            label=f"$p_i = {p_i:.2f}$ (exact)",
        )
        ax.plot(
            data["delta_frac"] * 100, data["approx"][i] * 100,
            color=colors[i], linewidth=1.0, linestyle="--", alpha=0.6,
        )

    # Reference lines
    bound = manipulation_bound() * 100
    ax.axhline(bound, color="black", linewidth=1.2, linestyle="-.",
               label=f"Analytic bound ({bound:.1f}%)")
    ax.axhline(PAPER_SIM["max_gain"] * 100, color="gray", linewidth=0.8,
               linestyle=":", label=f"Paper max ({PAPER_SIM['max_gain']*100:.1f}%)")
    ax.axhline(PAPER_SIM["p90_gain"] * 100, color="gray", linewidth=0.8,
               linestyle=":", alpha=0.5,
               label=f"Paper 90th pctl ({PAPER_SIM['p90_gain']*100:.1f}%)")

    # Mark the typical operating point
    ax.axvline(PAPER_SIM["avg_delta"] / PAPER_SIM["avg_pool"] * 100,
               color="gray", linewidth=0.6, linestyle="--", alpha=0.4)
    ax.text(
        PAPER_SIM["avg_delta"] / PAPER_SIM["avg_pool"] * 100 + 0.3,
        bound * 0.85,
        r"typical $\Delta/P$",
        fontsize=9, color="gray",
    )

    ax.set_xlabel(r"Pool change $\Delta / P$ (%)")
    ax.set_ylabel("Manipulation gain (%)")
    ax.set_title("Pool manipulation gain vs. fractional pool change")
    ax.legend(fontsize=8, loc="upper left")
    ax.set_xlim(0, 15)
    ax.set_ylim(0, min(bound * 2, 10))

    fig.savefig(out_dir / "gain_vs_delta.pdf")
    plt.close(fig)


def plot_bound_sensitivity(out_dir: Path):
    """Plot 2: Heatmap of bound over (T_max, T_boundary)."""
    set_style()
    data = sweep_bound()
    fig, ax = plt.subplots()

    im = ax.imshow(
        data["bound"] * 100,
        aspect="auto",
        origin="lower",
        cmap="YlOrRd",
        extent=[
            data["T_boundary"].min() - 0.5,
            data["T_boundary"].max() + 0.5,
            data["T_max"].min() - 0.5,
            data["T_max"].max() + 0.5,
        ],
    )
    cbar = fig.colorbar(im, ax=ax, label="Bound G_max (%)")

    # Mark baseline
    ax.plot(T_BOUNDARY, T_MAX, marker="*", markersize=14,
            color="black", markeredgecolor="white", markeredgewidth=1.0)
    ax.annotate(
        f"Baseline\n({T_MAX}, {T_BOUNDARY})",
        xy=(T_BOUNDARY, T_MAX),
        xytext=(T_BOUNDARY + 1.2, T_MAX - 2),
        fontsize=9,
        arrowprops=dict(arrowstyle="->", color="black", lw=0.8),
    )

    ax.set_xlabel(r"$T_{\mathrm{boundary}}$ (max years near playoff line)")
    ax.set_ylabel(r"$T_{\mathrm{max}}$ (max consecutive non-playoff years)")
    ax.set_title("Sensitivity of manipulation bound to structural parameters")

    fig.savefig(out_dir / "bound_sensitivity.pdf")
    plt.close(fig)


def plot_sim_histogram(sim_results: dict, out_dir: Path):
    """Plot 3: Histogram of simulated max gains with bound overlay."""
    set_style()
    gains = sim_results["gains"] * 100
    fig, ax = plt.subplots()

    ax.hist(gains, bins=40, color="#2c7bb6", alpha=0.7, edgecolor="white",
            linewidth=0.5, density=True)

    # Reference lines
    bound = manipulation_bound() * 100
    ax.axvline(sim_results["mean"] * 100, color="#d7191c", linewidth=1.2,
               linestyle="--", label=f"Sim mean ({sim_results['mean']*100:.2f}%)")
    ax.axvline(sim_results["p90"] * 100, color="#fdae61", linewidth=1.2,
               linestyle="--", label=f"Sim 90th pctl ({sim_results['p90']*100:.2f}%)")
    ax.axvline(sim_results["max"] * 100, color="#d7191c", linewidth=1.2,
               linestyle="-", label=f"Sim max ({sim_results['max']*100:.2f}%)")
    ax.axvline(bound, color="black", linewidth=1.5, linestyle="-.",
               label=f"Analytic bound ({bound:.1f}%)")

    ax.set_xlabel("Maximum manipulation gain per season (%)")
    ax.set_ylabel("Density")
    ax.set_title(f"Distribution of max gains ({sim_results['n_seasons']} seasons)")
    ax.legend(fontsize=8)

    fig.savefig(out_dir / "simulation_histogram.pdf")
    plt.close(fig)


def plot_bound_vs_sim(sim_results: dict, out_dir: Path):
    """Plot 4: Per-season gains vs. analytic bound."""
    set_style()
    gains = sim_results["gains"] * 100
    seasons = np.arange(1, len(gains) + 1)
    fig, ax = plt.subplots()

    ax.scatter(seasons, gains, s=8, alpha=0.5, color="#2c7bb6",
               edgecolors="none", label="Per-season max gain")

    bound = manipulation_bound() * 100
    ax.axhline(bound, color="black", linewidth=1.5, linestyle="-.",
               label=f"Analytic bound ({bound:.1f}%)")

    # Paper's reported range as gray band
    ax.axhspan(0, PAPER_SIM["max_gain"] * 100, alpha=0.08, color="gray")
    ax.text(
        len(gains) * 0.02, PAPER_SIM["max_gain"] * 100 - 0.15,
        f"Paper range (0 - {PAPER_SIM['max_gain']*100:.1f}%)",
        fontsize=8, color="gray",
    )

    ax.set_xlabel("Season")
    ax.set_ylabel("Maximum manipulation gain (%)")
    ax.set_title("Analytic bound vs. simulated per-season maxima")
    ax.legend(fontsize=9, loc="upper right")
    ax.set_ylim(bottom=0)

    fig.savefig(out_dir / "bound_vs_sim.pdf")
    plt.close(fig)


def generate_all(sim_results: dict | None, out_dir: Path):
    """Generate all plots. sim_results can be None for analytic-only mode."""
    out_dir.mkdir(parents=True, exist_ok=True)

    # Always generate analytic plots
    plot_gain_vs_delta(out_dir)
    plot_bound_sensitivity(out_dir)

    # Simulation plots only if results are provided
    if sim_results is not None:
        plot_sim_histogram(sim_results, out_dir)
        plot_bound_vs_sim(sim_results, out_dir)
