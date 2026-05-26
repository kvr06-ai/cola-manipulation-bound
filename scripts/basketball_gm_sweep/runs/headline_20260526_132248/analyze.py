#!/usr/bin/env python3
"""
Headline sweep analysis — 48 configs x 50 replicates x 30 seasons.

Inputs:
  ./headline.csv (2,400 rows, seeds 1000-1049)
  ./sensitivity_30.csv (subset x 30 reps)         [optional, computed by separate driver call]
  ./sensitivity_100.csv (subset x 100 reps)       [optional]

Outputs:
  ./headline_summary.csv  (48 rows; per-config mean/median/std)
  ./pareto_summary.txt
  ./stability_report.md (after sensitivity 30/100 are present)
  ../../figures/pareto_primary_vs_manipulation.pdf
  ../../figures/pareto_primary_vs_rankspread.pdf
  ../../figures/pareto_parallel_coordinates.pdf

Pareto-optimality (3-objective universal dominance):
  - max_years_between_conf_finals : LOWER better
  - manipulation_gain_pct         : LOWER better (unified across capped/uncapped)
  - rank_one_to_five_spread       : HIGHER better
  per_series_cost_typical is reported as a 4th disclosure column but not used in
  dominance (NA for uncapped configs; mixing with capped would be a category error).

Uses MEDIAN (not mean) per the headline brief: more robust to single-replicate
outliers in max-gap statistics (which are extreme-value distributed).
"""

from __future__ import annotations

import math
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.lines import Line2D

HERE = Path(__file__).resolve().parent
SWEEP_ROOT = HERE.parent.parent  # .../basketball_gm_sweep
FIGURE_DIR = SWEEP_ROOT / "figures"


# ---------------------------------------------------------------------------
# Loading & per-config summary
# ---------------------------------------------------------------------------

OBJ_PRIMARY = "max_years_between_conf_finals"      # lower better
OBJ_MANIP   = "manipulation_gain_pct"              # lower better (unified)
OBJ_COST    = "per_series_cost_typical"            # lower better (capped only)
OBJ_SPREAD  = "rank_one_to_five_spread"            # higher better


def load_raw(csv_path: Path) -> pd.DataFrame:
    df = pd.read_csv(csv_path, dtype={"C": str, "E": str}, na_values=["null", ""])
    df["capped"] = df["C"].notna()
    df["E_label"] = df["E"].astype(str)
    df["S_label"] = df["S"].astype(str)
    df["C_num"] = pd.to_numeric(df["C"], errors="coerce")
    return df


def per_config_summary(df: pd.DataFrame) -> pd.DataFrame:
    """Aggregate replicates to a single per-config row with mean/median/std."""
    agg_cols = [OBJ_PRIMARY, OBJ_MANIP, OBJ_SPREAD, OBJ_COST, "franchises_never_reached_cf"]
    summary_rows = []
    for cid, grp in df.groupby("config_id"):
        first = grp.iloc[0]
        row = {
            "config_id": int(cid),
            "E": first["E_label"],
            "C": "null" if pd.isna(first["C_num"]) else str(int(first["C_num"])),
            "S": first["S_label"],
            "capped": bool(first["capped"]),
            "n_replicates": len(grp),
        }
        for col in agg_cols:
            v = grp[col].astype(float)
            row[f"{col}_mean"]   = v.mean()
            row[f"{col}_median"] = v.median()
            row[f"{col}_std"]    = v.std(ddof=1) if len(v) > 1 else 0.0
        summary_rows.append(row)
    return pd.DataFrame(summary_rows).sort_values("config_id").reset_index(drop=True)


# ---------------------------------------------------------------------------
# Pareto computation (3-objective universal dominance)
# ---------------------------------------------------------------------------

def _obj_vec(row: pd.Series, stat: str = "median") -> tuple:
    """Return objective tuple (3 dims) where ALL coordinates are lower-better.

    Uses {OBJ_PRIMARY}_{stat}, {OBJ_MANIP}_{stat}, {OBJ_SPREAD}_{stat}.
    Spread is flipped (higher better -> negate).
    """
    return (
        float(row[f"{OBJ_PRIMARY}_{stat}"]),
        float(row[f"{OBJ_MANIP}_{stat}"]),
        -float(row[f"{OBJ_SPREAD}_{stat}"]),
    )


def _dominates(a: tuple, b: tuple) -> bool:
    le = all(x <= y for x, y in zip(a, b))
    lt = any(x < y for x, y in zip(a, b))
    return le and lt


def pareto_optimal(summary: pd.DataFrame, stat: str = "median") -> list[int]:
    """Return Pareto-optimal config_ids in the 3-objective universal space."""
    vecs = {int(r.config_id): _obj_vec(r, stat=stat) for _, r in summary.iterrows()}
    optimal = []
    for cid, v in vecs.items():
        dominated = False
        for cid2, v2 in vecs.items():
            if cid2 == cid:
                continue
            if _dominates(v2, v):
                dominated = True
                break
        if not dominated:
            optimal.append(cid)
    return sorted(optimal)


# ---------------------------------------------------------------------------
# Named-variant mapping
# ---------------------------------------------------------------------------

NAMED_VARIANTS = [
    # (variant_name, E, C(None=uncapped), S, config_id_hint, note)
    ("Status quo NBA lottery",  "14", None, "single-season", 0,
     "E=14 non-playoff, uncapped, no carry-over. Approximation: status-quo uses fixed odds rather than COLA accumulation; this row represents the closest (E,C,S) tuple in the grid."),
    ("Classic COLA",            "14", None, "unbounded", 1,
     "Classic dial setting per Highley spec."),
    ("Simple COLA",             "22", None, "unbounded", 17,
     "Approximation: Simple uses drought-based ticketing, not a direct COLA accumulator. Closest tuple uses E=22 + uncapped + unbounded scope."),
    ("Capped@150",              "22", 150, "bounded-30yr", 26,
     "Approximation: Highley Substack Capped@150 default; bounded-30yr is closest S to 'long-window' in the grid."),
    ("3-2-1 proposal",          "16-tiered", None, "single-season", 32,
     "16-tiered pool, no cross-season memory, uncapped tickets per season."),
]


def identify_variants(summary: pd.DataFrame) -> dict[str, dict]:
    out = {}
    for name, E, C, S, cid_hint, note in NAMED_VARIANTS:
        mask = (summary["E"] == str(E)) & (summary["S"] == S)
        if C is None:
            mask &= (summary["C"] == "null")
        else:
            mask &= (summary["C"] == str(C))
        rows = summary[mask]
        if len(rows) != 1:
            out[name] = {"config_id": None, "note": f"NOT FOUND for E={E}, C={C}, S={S}. {note}"}
            continue
        row = rows.iloc[0]
        out[name] = {
            "config_id": int(row.config_id),
            "E": row.E,
            "C": row.C,
            "S": row.S,
            "primary_median": row[f"{OBJ_PRIMARY}_median"],
            "primary_mean":   row[f"{OBJ_PRIMARY}_mean"],
            "primary_std":    row[f"{OBJ_PRIMARY}_std"],
            "manip_median":   row[f"{OBJ_MANIP}_median"],
            "spread_median":  row[f"{OBJ_SPREAD}_median"],
            "cost_median":    row[f"{OBJ_COST}_median"],
            "note": note,
        }
        if out[name]["config_id"] != cid_hint:
            out[name]["note"] += f" [config_id resolved to {out[name]['config_id']}, hint was {cid_hint}]"
    return out


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


def _annotate_variants(ax, summary, variants, x_col, y_col, offsets=None):
    offsets = offsets or {}
    for name, info in variants.items():
        cid = info.get("config_id")
        if cid is None:
            continue
        row = summary[summary.config_id == cid].iloc[0]
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


def plot_primary_vs_manipulation(summary, pareto_set, variants, out):
    fig, ax = plt.subplots(figsize=(9.0, 6.2))
    df = summary
    df_other  = df[~df.config_id.isin(pareto_set)]
    df_pareto = df[df.config_id.isin(pareto_set)]
    x = f"{OBJ_MANIP}_median"
    y = f"{OBJ_PRIMARY}_median"
    yerr = f"{OBJ_PRIMARY}_std"
    # error bars first (light)
    ax.errorbar(df[x], df[y], yerr=df[yerr], fmt="none",
                ecolor="lightgray", elinewidth=0.6, alpha=0.6, zorder=1)
    # dominated
    ax.scatter(df_other[x], df_other[y], c="lightgray", s=42, alpha=0.85,
               edgecolor="dimgray", linewidth=0.4,
               label=f"Dominated ({len(df_other)})", zorder=2)
    # pareto
    cap_mask = df_pareto["capped"]
    ax.scatter(df_pareto.loc[~cap_mask, x], df_pareto.loc[~cap_mask, y],
               c="tab:orange", s=95, edgecolor="black", linewidth=0.7,
               label=f"Pareto-optimal, uncapped ({(~cap_mask).sum()})",
               zorder=3, marker="o")
    ax.scatter(df_pareto.loc[cap_mask, x], df_pareto.loc[cap_mask, y],
               c="tab:cyan", s=95, edgecolor="black", linewidth=0.7,
               label=f"Pareto-optimal, capped ({cap_mask.sum()})",
               zorder=3, marker="^")
    # cid labels
    for _, r in df.iterrows():
        ax.text(r[x], r[y] + 0.15, str(int(r.config_id)),
                fontsize=5.8, color="black", alpha=0.55, ha="center", zorder=4)
    _annotate_variants(
        ax, df, variants, x, y,
        offsets={
            "Status quo NBA lottery": ( 1.2, -1.2),
            "Classic COLA":           ( 1.2,  0.9),
            "Simple COLA":            (-0.8,  1.6),
            "Capped@150":             ( 1.3, -1.3),
            "3-2-1 proposal":         ( 1.2,  1.0),
        },
    )
    ax.set_xlabel("Manipulation-gain upper bound (Δp · 100, percentage points; unified across capped/uncapped)")
    ax.set_ylabel("Max years between conference-finals appearances\n(per-config median across 50 replicates; lower = more equitable)")
    ax.set_title("COLA headline frontier — primary objective vs. unified manipulation-gain bound\n"
                 "48 configs × 50 replicates × 30 simulated seasons (seeds 1000–1049)")
    ax.grid(True, ls="--", alpha=0.45)
    leg = ax.legend(loc="upper right", fontsize=8, framealpha=0.92)
    leg.set_title("Configuration class", prop={"size": 8.5})
    fig.tight_layout()
    fig.savefig(out)
    plt.close(fig)


def plot_primary_vs_rankspread(summary, pareto_set, variants, out):
    fig, ax = plt.subplots(figsize=(9.0, 6.2))
    df = summary
    df_other  = df[~df.config_id.isin(pareto_set)]
    df_pareto = df[df.config_id.isin(pareto_set)]
    x = f"{OBJ_SPREAD}_median"
    y = f"{OBJ_PRIMARY}_median"
    yerr = f"{OBJ_PRIMARY}_std"
    ax.errorbar(df[x], df[y], yerr=df[yerr], fmt="none",
                ecolor="lightgray", elinewidth=0.6, alpha=0.6, zorder=1)
    ax.scatter(df_other[x], df_other[y], c="lightgray", s=42, alpha=0.85,
               edgecolor="dimgray", linewidth=0.4,
               label=f"Dominated ({len(df_other)})", zorder=2)
    cap_mask = df_pareto["capped"]
    ax.scatter(df_pareto.loc[~cap_mask, x], df_pareto.loc[~cap_mask, y],
               c="tab:orange", s=95, edgecolor="black", linewidth=0.7,
               label=f"Pareto-optimal, uncapped ({(~cap_mask).sum()})",
               zorder=3, marker="o")
    ax.scatter(df_pareto.loc[cap_mask, x], df_pareto.loc[cap_mask, y],
               c="tab:cyan", s=95, edgecolor="black", linewidth=0.7,
               label=f"Pareto-optimal, capped ({cap_mask.sum()})",
               zorder=3, marker="^")
    for _, r in df.iterrows():
        ax.text(r[x], r[y] + 0.15, str(int(r.config_id)),
                fontsize=5.8, color="black", alpha=0.55, ha="center", zorder=4)
    _annotate_variants(
        ax, df, variants, x, y,
        offsets={
            "Status quo NBA lottery": ( 0.10, -1.3),
            "Classic COLA":           ( 0.10,  0.9),
            "Simple COLA":            (-0.40,  1.5),
            "Capped@150":             (-0.40, -1.3),
            "3-2-1 proposal":         ( 0.10,  0.7),
        },
    )
    ax.set_xlabel("Rank-1-to-5 expected-pick spread (per-config median; higher = stronger anti-tanking)")
    ax.set_ylabel("Max years between conference-finals appearances\n(per-config median across 50 replicates; lower = more equitable)")
    ax.set_title("COLA headline frontier — primary objective vs. anti-tanking spread\n"
                 "48 configs × 50 replicates × 30 simulated seasons (seeds 1000–1049)")
    ax.grid(True, ls="--", alpha=0.45)
    leg = ax.legend(loc="upper left", fontsize=8, framealpha=0.92)
    leg.set_title("Configuration class", prop={"size": 8.5})
    fig.tight_layout()
    fig.savefig(out)
    plt.close(fig)


def plot_parallel_coordinates(summary, pareto_set, variants, out):
    cols  = [f"{OBJ_PRIMARY}_median", f"{OBJ_MANIP}_median",
             f"{OBJ_COST}_median",    f"{OBJ_SPREAD}_median"]
    nice  = ["Max yrs between CF (lower=better)",
             "Manipulation-gain Δp·100 [pct points] (lower=better)",
             "Per-series cost ceiling, typical (lower=better; capped only)",
             "Rank-1-to-5 spread (higher=better)"]
    # Per-axis min-max norm
    norm = pd.DataFrame(index=summary.index, columns=cols, dtype=float)
    for c in cols:
        v = summary[c].astype(float)
        v_min = v.min(skipna=True)
        v_max = v.max(skipna=True)
        if v_max - v_min < 1e-9 or pd.isna(v_min) or pd.isna(v_max):
            norm[c] = 0.5
        else:
            norm[c] = (v - v_min) / (v_max - v_min)
    fig, ax = plt.subplots(figsize=(11, 6.8))
    x = np.arange(len(cols))
    for _, r in summary.iterrows():
        cid = int(r.config_id)
        is_pareto = cid in pareto_set
        if is_pareto:
            color = "tab:cyan" if r["capped"] else "tab:orange"
            lw, alpha, z = 1.8, 0.95, 3
        else:
            color = "lightgray"
            lw, alpha, z = 0.8, 0.55, 1
        ys = norm.loc[r.name, cols].astype(float).values
        valid = ~np.isnan(ys)
        if valid.all():
            ax.plot(x, ys, color=color, lw=lw, alpha=alpha, zorder=z)
        else:
            for i in range(len(cols) - 1):
                if valid[i] and valid[i + 1]:
                    ax.plot(x[i:i+2], ys[i:i+2], color=color, lw=lw,
                            alpha=alpha, zorder=z)
            na_idx = np.where(~valid)[0]
            for ni in na_idx:
                ax.scatter([x[ni]], [-0.05], marker="x", s=22, color=color,
                           alpha=alpha, zorder=z)
    # variants overlay
    for name, info in variants.items():
        cid = info.get("config_id")
        if cid is None:
            continue
        row = summary[summary.config_id == cid].iloc[0]
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
    ax.set_ylabel("Per-axis min-max normalized objective value (per-config median)")
    ax.set_ylim(-0.12, 1.08)
    ax.set_title("COLA headline frontier — parallel coordinates across four objectives\n"
                 "48 configs × 50 replicates × 30 simulated seasons (X marker = NA / uncapped per-series cost)")
    ax.grid(True, ls="--", alpha=0.4, axis="y")
    handles = [
        Line2D([0], [0], color="tab:orange", lw=1.8, label="Pareto-optimal, uncapped"),
        Line2D([0], [0], color="tab:cyan",   lw=1.8, label="Pareto-optimal, capped"),
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
# Pareto summary text
# ---------------------------------------------------------------------------

def write_pareto_summary(summary, pareto_set, variants, path):
    lines = []
    lines.append(
        f"# Pareto-optimal configs (n={len(pareto_set)} of 48). 3-objective universal dominance:\n"
        f"#   max_years_between_conf_finals (LOWER), manipulation_gain_pct (LOWER), rank_one_to_five_spread (HIGHER)\n"
        f"# Per-config summary = MEDIAN across 50 replicates (seeds 1000-1049, 30 simulated seasons each).\n"
        f"# per_series_cost_typical is reported as a 4th disclosure column (NA for uncapped) but NOT a dominance dimension.\n"
        f"#\n"
    )
    lines.append(
        "config_id\tE\tC\tS\tmax_yrs_CF_med\tmax_yrs_CF_std\tmanip_pct_med\tper_series_cost_typ_med\trank_spread_med\n"
    )
    for cid in pareto_set:
        r = summary[summary.config_id == cid].iloc[0]
        cost = r[f"{OBJ_COST}_median"]
        cost_str = "" if pd.isna(cost) else f"{cost:.3f}"
        lines.append(
            f"{cid}\t{r.E}\t{r.C}\t{r.S}\t"
            f"{r[f'{OBJ_PRIMARY}_median']:.2f}\t{r[f'{OBJ_PRIMARY}_std']:.2f}\t"
            f"{r[f'{OBJ_MANIP}_median']:.4f}\t{cost_str}\t{r[f'{OBJ_SPREAD}_median']:.3f}\n"
        )
    lines.append("\n# Named-variant mapping\n")
    for name, info in variants.items():
        if info.get("config_id") is None:
            lines.append(f"{name}\tNOT FOUND in grid\n")
            continue
        cid = info["config_id"]
        in_pareto = "Pareto" if cid in pareto_set else "dominated"
        cost = info["cost_median"]
        cost_str = "n/a" if (cost is None or (isinstance(cost, float) and math.isnan(cost))) else f"{cost:.3f}"
        lines.append(
            f"{name}\tconfig_id={cid}\tE={info['E']}\tC={info['C']}\tS={info['S']}\t"
            f"max_yrs_CF_med={info['primary_median']:.2f}\tmax_yrs_CF_std={info['primary_std']:.2f}\t"
            f"manip_pct={info['manip_median']:.4f}\tper_series={cost_str}\t"
            f"rank_spread={info['spread_median']:.3f}\t[{in_pareto}]\n"
        )
    Path(path).write_text("".join(lines))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    FIGURE_DIR.mkdir(parents=True, exist_ok=True)
    df = load_raw(HERE / "headline.csv")
    print(f"Loaded {len(df)} rows from headline.csv "
          f"({df['config_id'].nunique()} configs × ~{len(df)//df['config_id'].nunique()} reps)")

    summary = per_config_summary(df)
    summary.to_csv(HERE / "headline_summary.csv", index=False)
    print(f"Wrote headline_summary.csv ({len(summary)} rows)")

    # NaN guard
    if summary[[f"{OBJ_PRIMARY}_median", f"{OBJ_MANIP}_median", f"{OBJ_SPREAD}_median"]].isna().any().any():
        raise SystemExit("Per-config medians contain NaN; aborting before Pareto computation.")

    pareto_set = pareto_optimal(summary, stat="median")
    print(f"Pareto-optimal configs (3-obj universal, median): {pareto_set}")

    variants = identify_variants(summary)

    write_pareto_summary(summary, pareto_set, variants, HERE / "pareto_summary.txt")
    print(f"Wrote pareto_summary.txt ({len(pareto_set)} Pareto configs)")

    plot_primary_vs_manipulation(summary, set(pareto_set), variants,
                                 FIGURE_DIR / "pareto_primary_vs_manipulation.pdf")
    plot_primary_vs_rankspread(summary, set(pareto_set), variants,
                               FIGURE_DIR / "pareto_primary_vs_rankspread.pdf")
    plot_parallel_coordinates(summary, set(pareto_set), variants,
                              FIGURE_DIR / "pareto_parallel_coordinates.pdf")
    print(f"Wrote 3 PDFs to {FIGURE_DIR}/")

    # Print Pareto table to stdout for log capture
    print()
    print("--- Pareto frontier ---")
    print(Path(HERE / "pareto_summary.txt").read_text())


if __name__ == "__main__":
    main()
