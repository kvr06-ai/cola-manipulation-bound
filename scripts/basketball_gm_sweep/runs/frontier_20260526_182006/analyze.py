#!/usr/bin/env python3
"""
Frontier-sketch analysis for the 48-config x 1-replicate COLA sweep.

Inputs:
  ./frontier_sketch.csv  (48 rows, one per config)

Outputs:
  ../../figures/pareto_primary_vs_manipulation.pdf
  ../../figures/pareto_primary_vs_rankspread.pdf
  ../../figures/pareto_parallel_coordinates.pdf
  ./pareto_summary.txt           (machine-readable Pareto set + variant map)
  ./frontier_sketch_summary.md   (human-readable summary)

Pareto-optimality:
  - max_years_between_conf_finals : LOWER better
  - manipulation_gain_bound       : LOWER better
  - per_series_cost_typical       : LOWER better (None for uncapped configs)
  - rank_one_to_five_spread       : HIGHER better
Pareto compare uses the 3 objectives common to a config's regime
(uncapped: 3 objectives; capped: 4 objectives). Dominance is NOT
computed across the capped/uncapped boundary.
"""

from __future__ import annotations

import csv
import math
import os
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.lines import Line2D
from matplotlib.patches import Patch

HERE = Path(__file__).resolve().parent
SWEEP_ROOT = HERE.parent.parent  # .../basketball_gm_sweep
FIGURE_DIR = SWEEP_ROOT / "figures"
CSV_PATH = HERE / "frontier_sketch.csv"


# ---------------------------------------------------------------------------
# Load & prepare
# ---------------------------------------------------------------------------

def load_frontier() -> pd.DataFrame:
    # Read raw so we can normalize C ourselves (sweep.js writes literal "null").
    df = pd.read_csv(CSV_PATH, dtype={"C": str, "E": str}, na_values=["null", ""])
    df["capped"] = df["C"].notna()
    df["E_label"] = df["E"].astype(str)
    df["S_label"] = df["S"].astype(str)
    # Numeric C column for downstream display & filtering
    df["C_num"] = pd.to_numeric(df["C"], errors="coerce")
    return df


# ---------------------------------------------------------------------------
# Pareto computation
# ---------------------------------------------------------------------------

OBJ_PRIMARY = "max_years_between_conf_finals"      # lower better
OBJ_MANIP   = "manipulation_gain_bound"            # lower better
OBJ_COST    = "per_series_cost_typical"            # lower better (None = NA)
OBJ_SPREAD  = "rank_one_to_five_spread"            # higher better


def _obj_vec(row: pd.Series, include_cost: bool) -> tuple:
    """Return objective tuple where ALL coordinates are lower-better."""
    base = (
        float(row[OBJ_PRIMARY]),
        float(row[OBJ_MANIP]),
        -float(row[OBJ_SPREAD]),  # flip spread so lower=better
    )
    if include_cost:
        return base + (float(row[OBJ_COST]),)
    return base


def dominates(a: tuple, b: tuple) -> bool:
    """a dominates b iff a <= b coordinate-wise and a < b on at least one."""
    le = all(x <= y for x, y in zip(a, b))
    lt = any(x < y for x, y in zip(a, b))
    return le and lt


def pareto_optimal(df: pd.DataFrame, include_cost: bool) -> list[int]:
    """Return list of config_ids that are Pareto-optimal within this DataFrame."""
    vecs = {int(r.config_id): _obj_vec(r, include_cost) for _, r in df.iterrows()}
    optimal = []
    for cid, v in vecs.items():
        dominated = False
        for cid2, v2 in vecs.items():
            if cid2 == cid:
                continue
            if dominates(v2, v):
                dominated = True
                break
        if not dominated:
            optimal.append(cid)
    return sorted(optimal)


# ---------------------------------------------------------------------------
# Named-variant mapping
# ---------------------------------------------------------------------------

def identify_variants(df: pd.DataFrame) -> dict[str, dict]:
    """Approximate-map named COLA variants onto config rows in the grid."""
    # Filter helpers
    def pick(E, C, S):
        mask = (df["E_label"] == str(E)) & (df["S_label"] == S)
        if C is None:
            mask &= df["C"].isna()
        else:
            mask &= df["C_num"] == float(C)
        rows = df[mask]
        if len(rows) != 1:
            return None
        return rows.iloc[0]

    variants = {}
    mapping = [
        # (variant_name, E, C(None=uncapped), S, note)
        ("Status quo NBA lottery", 14, None, "single-season",
         "E=14 non-playoff, uncapped, no carry-over. Approximation: status-quo uses fixed odds rather than COLA accumulation; this row represents the closest (E,C,S) tuple in the grid."),
        ("Classic COLA",           14, None, "unbounded",
         "Classic dial setting per Highley spec."),
        ("Simple COLA",            22, None, "unbounded",
         "Approximation: Simple uses drought-based ticketing, not a direct COLA accumulator. Closest tuple uses E=22 (Simple eligibility pool) + uncapped + unbounded scope."),
        ("Capped@150",             22, 150, "bounded-30yr",
         "Approximation: Highley Substack Capped@150 default; bounded-30yr is closest S to 'long-window' in the grid."),
        ("3-2-1 proposal",         "16-tiered", None, "single-season",
         "16-tiered pool, no cross-season memory, uncapped tickets per season."),
    ]
    for name, E, C, S, note in mapping:
        row = pick(E, C, S)
        if row is None:
            variants[name] = {"config_id": None, "note": f"NOT FOUND for E={E}, C={C}, S={S}. {note}"}
        else:
            variants[name] = {
                "config_id": int(row.config_id),
                "E": row.E_label,
                "C": "null" if pd.isna(row.C_num) else str(int(row.C_num)),
                "S": row.S_label,
                OBJ_PRIMARY: row[OBJ_PRIMARY],
                OBJ_MANIP:   row[OBJ_MANIP],
                OBJ_COST:    row[OBJ_COST],
                OBJ_SPREAD:  row[OBJ_SPREAD],
                "note": note,
            }
    return variants


# ---------------------------------------------------------------------------
# Plotting
# ---------------------------------------------------------------------------

VARIANT_MARKERS = {
    "Status quo NBA lottery": ("D", "tab:gray"),
    "Classic COLA":            ("s", "tab:blue"),
    "Simple COLA":             ("P", "tab:purple"),
    "Capped@150":              ("X", "tab:green"),
    "3-2-1 proposal":          ("*", "tab:red"),
}


def _annotate_variants(ax, df, variants, x_col, y_col, offsets=None):
    offsets = offsets or {}
    for name, info in variants.items():
        cid = info.get("config_id")
        if cid is None:
            continue
        row = df[df.config_id == cid].iloc[0]
        marker, color = VARIANT_MARKERS[name]
        ax.scatter(
            row[x_col], row[y_col],
            marker=marker, s=180, edgecolor=color, facecolor="none",
            linewidth=2.2, zorder=5, label=name,
        )
        dx, dy = offsets.get(name, (0.5, 0.5))
        ax.annotate(
            name,
            xy=(row[x_col], row[y_col]),
            xytext=(row[x_col] + dx, row[y_col] + dy),
            fontsize=8.5, color=color,
            arrowprops=dict(arrowstyle="-", color=color, lw=0.6, alpha=0.65),
            zorder=6,
        )


def plot_primary_vs_manipulation(df, pareto_set, variants, out):
    fig, ax = plt.subplots(figsize=(8.5, 6.0))
    df_other  = df[~df.config_id.isin(pareto_set)]
    df_pareto = df[df.config_id.isin(pareto_set)]
    # Dominated configs
    ax.scatter(df_other[OBJ_MANIP], df_other[OBJ_PRIMARY],
               c="lightgray", s=42, alpha=0.85, edgecolor="dimgray", linewidth=0.4,
               label=f"Dominated ({len(df_other)})", zorder=2)
    # Pareto-optimal
    cap_mask = df_pareto["capped"]
    ax.scatter(df_pareto.loc[~cap_mask, OBJ_MANIP], df_pareto.loc[~cap_mask, OBJ_PRIMARY],
               c="tab:orange", s=85, edgecolor="black", linewidth=0.6,
               label=f"Pareto-optimal, uncapped ({(~cap_mask).sum()})", zorder=3, marker="o")
    ax.scatter(df_pareto.loc[cap_mask, OBJ_MANIP], df_pareto.loc[cap_mask, OBJ_PRIMARY],
               c="tab:cyan", s=85, edgecolor="black", linewidth=0.6,
               label=f"Pareto-optimal, capped ({cap_mask.sum()})", zorder=3, marker="^")
    # Light config_id labels
    for _, r in df.iterrows():
        ax.text(r[OBJ_MANIP], r[OBJ_PRIMARY] + 0.18, str(int(r.config_id)),
                fontsize=6.0, color="black", alpha=0.55, ha="center", zorder=4)
    _annotate_variants(
        ax, df, variants, OBJ_MANIP, OBJ_PRIMARY,
        offsets={
            "Status quo NBA lottery": ( 2.5, -0.9),
            "Classic COLA":            ( 2.5,  0.7),
            "Simple COLA":             ( 2.5,  1.4),
            "Capped@150":              (-7.5,  1.2),
            "3-2-1 proposal":          ( 2.5,  0.3),
        },
    )
    ax.set_xlabel("Manipulation-gain upper bound (analytical; multiplicative for uncapped, η·C for capped)")
    ax.set_ylabel("Max years between conference-finals appearances (lower = more equitable)")
    ax.set_title("COLA frontier sketch — primary objective vs. manipulation-gain bound\n"
                 "48 configs × 1 replicate × 30 simulated seasons")
    ax.set_xscale("symlog", linthresh=2)
    ax.grid(True, ls="--", alpha=0.45)
    leg = ax.legend(loc="upper right", fontsize=8, framealpha=0.92)
    leg.set_title("Configuration class", prop={"size": 8.5})
    fig.tight_layout()
    fig.savefig(out)
    plt.close(fig)


def plot_primary_vs_rankspread(df, pareto_set, variants, out):
    fig, ax = plt.subplots(figsize=(8.5, 6.0))
    df_other  = df[~df.config_id.isin(pareto_set)]
    df_pareto = df[df.config_id.isin(pareto_set)]
    ax.scatter(df_other[OBJ_SPREAD], df_other[OBJ_PRIMARY],
               c="lightgray", s=42, alpha=0.85, edgecolor="dimgray", linewidth=0.4,
               label=f"Dominated ({len(df_other)})", zorder=2)
    cap_mask = df_pareto["capped"]
    ax.scatter(df_pareto.loc[~cap_mask, OBJ_SPREAD], df_pareto.loc[~cap_mask, OBJ_PRIMARY],
               c="tab:orange", s=85, edgecolor="black", linewidth=0.6,
               label=f"Pareto-optimal, uncapped ({(~cap_mask).sum()})", zorder=3, marker="o")
    ax.scatter(df_pareto.loc[cap_mask, OBJ_SPREAD], df_pareto.loc[cap_mask, OBJ_PRIMARY],
               c="tab:cyan", s=85, edgecolor="black", linewidth=0.6,
               label=f"Pareto-optimal, capped ({cap_mask.sum()})", zorder=3, marker="^")
    for _, r in df.iterrows():
        ax.text(r[OBJ_SPREAD], r[OBJ_PRIMARY] + 0.18, str(int(r.config_id)),
                fontsize=6.0, color="black", alpha=0.55, ha="center", zorder=4)
    _annotate_variants(
        ax, df, variants, OBJ_SPREAD, OBJ_PRIMARY,
        offsets={
            "Status quo NBA lottery": ( 0.18, -0.9),
            "Classic COLA":            ( 0.18,  0.7),
            "Simple COLA":             ( 0.18,  1.4),
            "Capped@150":              (-0.55,  1.2),
            "3-2-1 proposal":          ( 0.18,  0.3),
        },
    )
    ax.set_xlabel("Rank-1-to-5 expected-pick spread (higher = stronger anti-tanking)")
    ax.set_ylabel("Max years between conference-finals appearances (lower = more equitable)")
    ax.set_title("COLA frontier sketch — primary objective vs. anti-tanking spread\n"
                 "48 configs × 1 replicate × 30 simulated seasons")
    ax.grid(True, ls="--", alpha=0.45)
    leg = ax.legend(loc="upper left", fontsize=8, framealpha=0.92)
    leg.set_title("Configuration class", prop={"size": 8.5})
    fig.tight_layout()
    fig.savefig(out)
    plt.close(fig)


def plot_parallel_coordinates(df, pareto_set, variants, out):
    cols = [OBJ_PRIMARY, OBJ_MANIP, OBJ_COST, OBJ_SPREAD]
    nice = ["Max yrs between CF (lower=better)",
            "Manipulation-gain bound (lower=better)",
            "Per-series cost ceiling, typical (lower=better; capped only)",
            "Rank-1-to-5 spread (higher=better)"]
    # Normalize each axis to [0,1]; for the uncapped cost cell, plot a tick at the bottom
    # using a separate normalization that highlights NA.
    norm = pd.DataFrame(index=df.index, columns=cols, dtype=float)
    for c in cols:
        v = df[c].astype(float)
        v_min = v.min(skipna=True)
        v_max = v.max(skipna=True)
        if v_max - v_min < 1e-9:
            norm[c] = 0.5
        else:
            norm[c] = (v - v_min) / (v_max - v_min)
    fig, ax = plt.subplots(figsize=(10, 6.5))
    x = np.arange(len(cols))
    for _, r in df.iterrows():
        cid = int(r.config_id)
        is_pareto = cid in pareto_set
        if is_pareto:
            color = "tab:cyan" if r["capped"] else "tab:orange"
            lw = 1.8
            alpha = 0.95
            zorder = 3
        else:
            color = "lightgray"
            lw = 0.8
            alpha = 0.55
            zorder = 1
        ys = norm.loc[r.name, cols].astype(float).values
        # Draw NA cost with a marker at bottom and skip the segment around it
        valid = ~np.isnan(ys)
        if valid.all():
            ax.plot(x, ys, color=color, lw=lw, alpha=alpha, zorder=zorder)
        else:
            for i in range(len(cols) - 1):
                if valid[i] and valid[i + 1]:
                    ax.plot(x[i:i+2], ys[i:i+2], color=color, lw=lw,
                            alpha=alpha, zorder=zorder)
            na_idx = np.where(~valid)[0]
            for ni in na_idx:
                ax.scatter([x[ni]], [-0.05], marker="x", s=22, color=color,
                           alpha=alpha, zorder=zorder)
    # Variant overlays (thicker, named)
    for name, info in variants.items():
        cid = info.get("config_id")
        if cid is None:
            continue
        row = df[df.config_id == cid].iloc[0]
        ys = norm.loc[row.name, cols].astype(float).values
        marker, vcolor = VARIANT_MARKERS[name]
        valid = ~np.isnan(ys)
        if valid.all():
            ax.plot(x, ys, color=vcolor, lw=2.4, alpha=0.95, zorder=4, label=name)
        else:
            for i in range(len(cols) - 1):
                if valid[i] and valid[i + 1]:
                    ax.plot(x[i:i+2], ys[i:i+2], color=vcolor, lw=2.4,
                            alpha=0.95, zorder=4)
            ax.plot([], [], color=vcolor, lw=2.4, label=name)
            na_idx = np.where(~valid)[0]
            for ni in na_idx:
                ax.scatter([x[ni]], [-0.05], marker="x", s=55, color=vcolor,
                           zorder=5)
    ax.set_xticks(x)
    ax.set_xticklabels(nice, fontsize=9, rotation=8, ha="center")
    ax.set_ylabel("Per-axis min-max normalized objective value")
    ax.set_ylim(-0.12, 1.08)
    ax.set_title("COLA frontier sketch — parallel coordinates across four objectives\n"
                 "48 configs × 1 replicate × 30 simulated seasons (X markers = NA / uncapped)")
    ax.grid(True, ls="--", alpha=0.4, axis="y")
    handles = [
        Line2D([0], [0], color="tab:orange", lw=1.8, label=f"Pareto-optimal, uncapped"),
        Line2D([0], [0], color="tab:cyan",   lw=1.8, label=f"Pareto-optimal, capped"),
        Line2D([0], [0], color="lightgray",  lw=0.8, label="Dominated"),
    ]
    for name, (marker, vcolor) in VARIANT_MARKERS.items():
        handles.append(Line2D([0], [0], color=vcolor, lw=2.4, label=name))
    ax.legend(handles=handles, loc="upper right", fontsize=8, framealpha=0.92,
              title="Configuration class / variant", title_fontsize=8.5)
    fig.tight_layout()
    fig.savefig(out)
    plt.close(fig)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    FIGURE_DIR.mkdir(parents=True, exist_ok=True)
    df = load_frontier()

    uncapped = df[~df["capped"]].copy()
    capped = df[df["capped"]].copy()

    pareto_uncapped = pareto_optimal(uncapped, include_cost=False)
    pareto_capped   = pareto_optimal(capped, include_cost=True)
    pareto_set = sorted(set(pareto_uncapped) | set(pareto_capped))

    variants = identify_variants(df)

    # Save Pareto summary (TSV-like)
    summary_lines = []
    summary_lines.append(
        f"# Pareto-optimal configs (n={len(pareto_set)} of 48). "
        f"Uncapped Pareto computed in 3-objective space; "
        f"capped Pareto computed in 4-objective space. "
        f"Dominance NOT compared across capped/uncapped.\n"
    )
    summary_lines.append(
        "config_id\tE\tC\tS\tmax_yrs_CF\tmanip_bound\tper_series_cost_typ\trank1to5_spread\n"
    )
    for cid in pareto_set:
        r = df[df.config_id == cid].iloc[0]
        c_str = "null" if pd.isna(r.C_num) else str(int(r.C_num))
        cost = "" if pd.isna(r[OBJ_COST]) else f"{r[OBJ_COST]:.3f}"
        summary_lines.append(
            f"{cid}\t{r.E_label}\t{c_str}\t{r.S_label}\t"
            f"{int(r[OBJ_PRIMARY])}\t{r[OBJ_MANIP]:.4f}\t{cost}\t{r[OBJ_SPREAD]:.3f}\n"
        )
    summary_lines.append("\n# Named-variant mapping (E, C, S match in grid)\n")
    for name, info in variants.items():
        if info.get("config_id") is None:
            summary_lines.append(f"{name}\tNOT FOUND in grid\n")
            continue
        cid = info["config_id"]
        in_pareto = "Pareto" if cid in pareto_set else "dominated"
        cost = info[OBJ_COST]
        cost_str = "n/a" if (cost is None or (isinstance(cost, float) and math.isnan(cost))) else f"{cost:.3f}"
        summary_lines.append(
            f"{name}\tconfig_id={cid}\tE={info['E']}\tC={info['C']}\tS={info['S']}\t"
            f"max_yrs_CF={int(info[OBJ_PRIMARY])}\tmanip={info[OBJ_MANIP]:.4f}\t"
            f"per_series={cost_str}\trank_spread={info[OBJ_SPREAD]:.3f}\t[{in_pareto}]\n"
        )

    (HERE / "pareto_summary.txt").write_text("".join(summary_lines))

    # Plots
    plot_primary_vs_manipulation(
        df, set(pareto_set), variants,
        FIGURE_DIR / "pareto_primary_vs_manipulation.pdf"
    )
    plot_primary_vs_rankspread(
        df, set(pareto_set), variants,
        FIGURE_DIR / "pareto_primary_vs_rankspread.pdf"
    )
    plot_parallel_coordinates(
        df, set(pareto_set), variants,
        FIGURE_DIR / "pareto_parallel_coordinates.pdf"
    )

    # Print to stdout for log capture
    print("".join(summary_lines))
    print(f"Wrote 3 PDFs to {FIGURE_DIR}/")


if __name__ == "__main__":
    main()
