#!/usr/bin/env python3
"""
Sensitivity & stability analysis for the headline sweep.

Reads:
  ./headline.csv          (48 configs x 50 reps)
  ./sensitivity_30.csv    (subset x 30 reps; seeds 1000-1029)
  ./sensitivity_100.csv   (subset x 100 reps; seeds 1000-1099)
  ./pareto_summary.txt    (Pareto config_ids -- for completeness)

Produces:
  ./sensitivity_30_summary.csv
  ./sensitivity_100_summary.csv
  ./stability_report.md
"""

from __future__ import annotations

import re
from pathlib import Path

import pandas as pd

HERE = Path(__file__).resolve().parent

OBJ_PRIMARY = "max_years_between_conf_finals"
OBJ_MANIP   = "manipulation_gain_pct"
OBJ_COST    = "per_series_cost_typical"
OBJ_SPREAD  = "rank_one_to_five_spread"

NAMED_VARIANTS_TABLE = [
    ("Status quo NBA lottery", 0),
    ("Classic COLA",           1),
    ("Simple COLA",           17),
    ("Capped@150",            26),
    ("3-2-1 proposal",        32),
]


def load_raw(p: Path) -> pd.DataFrame:
    df = pd.read_csv(p, dtype={"C": str, "E": str}, na_values=["null", ""])
    df["capped"] = df["C"].notna()
    df["E_label"] = df["E"].astype(str)
    df["S_label"] = df["S"].astype(str)
    df["C_num"]   = pd.to_numeric(df["C"], errors="coerce")
    return df


def per_config_summary(df: pd.DataFrame) -> pd.DataFrame:
    agg_cols = [OBJ_PRIMARY, OBJ_MANIP, OBJ_SPREAD, OBJ_COST]
    rows = []
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
        rows.append(row)
    return pd.DataFrame(rows).sort_values("config_id").reset_index(drop=True)


def _obj_vec(row: pd.Series) -> tuple:
    return (
        float(row[f"{OBJ_PRIMARY}_median"]),
        float(row[f"{OBJ_MANIP}_median"]),
        -float(row[f"{OBJ_SPREAD}_median"]),
    )


def _dominates(a, b):
    le = all(x <= y for x, y in zip(a, b))
    lt = any(x < y for x, y in zip(a, b))
    return le and lt


def pareto_optimal(summary: pd.DataFrame) -> list[int]:
    vecs = {int(r.config_id): _obj_vec(r) for _, r in summary.iterrows()}
    optimal = []
    for cid, v in vecs.items():
        dominated = any(_dominates(v2, v) for cid2, v2 in vecs.items() if cid2 != cid)
        if not dominated:
            optimal.append(cid)
    return sorted(optimal)


def read_pareto_ids_from_summary(path: Path) -> list[int]:
    """Parse pareto_summary.txt for config_ids (lines starting with a digit)."""
    text = path.read_text()
    ids = []
    for line in text.splitlines():
        m = re.match(r"^(\d+)\t", line)
        if m:
            ids.append(int(m.group(1)))
    return ids


def stability_section(label: str, ids: list[int], headline_sum: pd.DataFrame,
                      s30: pd.DataFrame | None, s100: pd.DataFrame | None) -> str:
    out = [f"### {label}\n"]
    out.append("| config_id | E | C | S | N=30 med ± std | N=50 med ± std | N=100 med ± std |\n")
    out.append("|---:|---|---:|---|---|---|---|\n")
    for cid in ids:
        h = headline_sum[headline_sum.config_id == cid].iloc[0]
        cell30 = "n/a"
        cell100 = "n/a"
        if s30 is not None and cid in s30.config_id.values:
            r = s30[s30.config_id == cid].iloc[0]
            cell30 = f"{r[f'{OBJ_PRIMARY}_median']:.2f} ± {r[f'{OBJ_PRIMARY}_std']:.2f}"
        if s100 is not None and cid in s100.config_id.values:
            r = s100[s100.config_id == cid].iloc[0]
            cell100 = f"{r[f'{OBJ_PRIMARY}_median']:.2f} ± {r[f'{OBJ_PRIMARY}_std']:.2f}"
        cell50 = f"{h[f'{OBJ_PRIMARY}_median']:.2f} ± {h[f'{OBJ_PRIMARY}_std']:.2f}"
        out.append(
            f"| {cid} | {h['E']} | {h['C']} | {h['S']} | {cell30} | {cell50} | {cell100} |\n"
        )
    return "".join(out)


def stability_flags(ids: list[int], headline_sum: pd.DataFrame,
                    s30: pd.DataFrame | None, s100: pd.DataFrame | None,
                    headline_pareto: set[int],
                    pareto_30: set[int],
                    pareto_100: set[int]) -> tuple[list[dict], list[dict]]:
    """Identify unstable configs (mean shift > 10% from N=30 -> N=100) and
    Pareto-borderline configs (Pareto at N=50 but not N=30 or N=100)."""
    unstable = []
    if s30 is not None and s100 is not None:
        for cid in ids:
            r30  = s30[s30.config_id == cid]
            r100 = s100[s100.config_id == cid]
            if len(r30) == 0 or len(r100) == 0:
                continue
            m30  = r30.iloc[0][f"{OBJ_PRIMARY}_mean"]
            m100 = r100.iloc[0][f"{OBJ_PRIMARY}_mean"]
            if m30 == 0:
                continue
            rel = abs(m100 - m30) / abs(m30)
            if rel > 0.10:
                unstable.append({
                    "config_id": cid,
                    "mean_n30": m30,
                    "mean_n100": m100,
                    "relative_change_pct": rel * 100.0,
                })

    borderline = []
    for cid in ids:
        in50  = cid in headline_pareto
        in30  = cid in pareto_30
        in100 = cid in pareto_100
        if in50 and not (in30 and in100):
            borderline.append({
                "config_id": cid,
                "in_pareto_n30":  in30,
                "in_pareto_n50":  in50,
                "in_pareto_n100": in100,
            })
        elif (in30 or in100) and not in50:
            borderline.append({
                "config_id": cid,
                "in_pareto_n30":  in30,
                "in_pareto_n50":  in50,
                "in_pareto_n100": in100,
                "note": "Pareto in subset eval (N=30 or N=100) but NOT at headline N=50",
            })
    return unstable, borderline


def main():
    headline_raw = load_raw(HERE / "headline.csv")
    headline_sum = per_config_summary(headline_raw)
    headline_sum.to_csv(HERE / "headline_summary.csv", index=False)  # idempotent

    headline_pareto = set(pareto_optimal(headline_sum))

    # Build the sensitivity subset = Pareto(N=50) ∪ named variants
    named_ids = {cid for _, cid in NAMED_VARIANTS_TABLE}
    subset_ids = sorted(headline_pareto | named_ids)
    print(f"Headline Pareto: {sorted(headline_pareto)}")
    print(f"Named variants : {sorted(named_ids)}")
    print(f"Sensitivity subset (n={len(subset_ids)}): {subset_ids}")

    # Load sensitivity CSVs if present
    p30  = HERE / "sensitivity_30.csv"
    p100 = HERE / "sensitivity_100.csv"
    s30  = None
    s100 = None
    if p30.exists():
        s30 = per_config_summary(load_raw(p30))
        s30.to_csv(HERE / "sensitivity_30_summary.csv", index=False)
        print(f"Loaded sensitivity_30.csv with {len(s30)} configs")
    if p100.exists():
        s100 = per_config_summary(load_raw(p100))
        s100.to_csv(HERE / "sensitivity_100_summary.csv", index=False)
        print(f"Loaded sensitivity_100.csv with {len(s100)} configs")

    # Pareto recomputed at each replicate count, restricted to subset_ids
    pareto_30  = set(pareto_optimal(s30))  if s30  is not None else set()
    pareto_100 = set(pareto_optimal(s100)) if s100 is not None else set()

    # Variant table
    named_lookup = {cid: name for name, cid in NAMED_VARIANTS_TABLE}

    unstable, borderline = stability_flags(
        subset_ids, headline_sum, s30, s100,
        headline_pareto, pareto_30, pareto_100,
    )

    # ---- stability_report.md ----
    md = []
    md.append("# Stability Report — Headline Sweep Sensitivity\n\n")
    md.append("**Headline:** 48 configs × 50 replicates × 30 simulated seasons (seeds 1000–1049).\n")
    md.append("**Sensitivity Pass A:** 30 replicates (seeds 1000–1029).\n")
    md.append("**Sensitivity Pass B:** 100 replicates (seeds 1000–1099).\n")
    md.append("**Subset:** Pareto-optimal configs from headline ∪ 5 named variants (deduplicated).\n\n")

    md.append(f"## Headline Pareto-optimal set (3-obj universal, median; n={len(headline_pareto)})\n\n")
    md.append("Config IDs: " + ", ".join(str(c) for c in sorted(headline_pareto)) + "\n\n")

    md.append("## Per-config primary-objective stability across N\n\n")
    md.append("Reports MEDIAN of `max_years_between_conf_finals` and STD across replicates at each N. "
              "A material shift is flagged when |mean(N=100) − mean(N=30)| / |mean(N=30)| > 10%.\n\n")

    # Sections: Pareto then named variants (overlap noted)
    pareto_only = sorted(headline_pareto - named_ids)
    if pareto_only:
        md.append(stability_section("Pareto-optimal configs (headline)", pareto_only,
                                    headline_sum, s30, s100))
        md.append("\n")
    md.append(stability_section("Named variants", [cid for _, cid in NAMED_VARIANTS_TABLE],
                                headline_sum, s30, s100))
    md.append("\n")

    md.append("## Pareto recomputed at each replicate count (restricted to sensitivity subset)\n\n")
    md.append(f"- N=30  Pareto set : {sorted(pareto_30) if pareto_30 else 'n/a'}\n")
    md.append(f"- N=50  Pareto set : {sorted(headline_pareto & set(subset_ids))} (subset slice of headline Pareto)\n")
    md.append(f"- N=100 Pareto set : {sorted(pareto_100) if pareto_100 else 'n/a'}\n\n")
    md.append("NB: Pareto sets at N=30 and N=100 are computed within the SUBSET only "
              "(not against all 48 configs), so direct membership comparison to headline is meaningful only "
              "for configs that are in the subset.\n\n")

    md.append("## Flags\n\n")
    md.append("### Unstable at headline N (>10% mean shift from N=30 → N=100)\n\n")
    if unstable:
        md.append("| config_id | mean(N=30) | mean(N=100) | relative change |\n")
        md.append("|---:|---:|---:|---:|\n")
        for u in unstable:
            md.append(f"| {u['config_id']} | {u['mean_n30']:.2f} | {u['mean_n100']:.2f} | "
                      f"{u['relative_change_pct']:.1f}% |\n")
    else:
        md.append("_None._ All sensitivity-subset configs have ≤10% relative drift in mean(max_yrs_CF) "
                  "between N=30 and N=100.\n")
    md.append("\n")

    md.append("### Pareto-borderline (Pareto-membership flips between N=30 / 50 / 100)\n\n")
    if borderline:
        md.append("| config_id | In Pareto N=30 | In Pareto N=50 (headline) | In Pareto N=100 |\n")
        md.append("|---:|:---:|:---:|:---:|\n")
        for b in borderline:
            md.append(
                f"| {b['config_id']} | {'✓' if b['in_pareto_n30'] else '—'} | "
                f"{'✓' if b['in_pareto_n50'] else '—'} | "
                f"{'✓' if b['in_pareto_n100'] else '—'} |\n"
            )
    else:
        md.append("_None._ Pareto membership is stable across N=30 / 50 / 100 for all subset configs.\n")
    md.append("\n")

    md.append("## Caveat\n\n")
    md.append("- `manipulation_gain_pct` is a closed-form analytical function of `E` and `C` (no Monte Carlo), "
              "so its median is identical across N. Stability flags use the simulated objective only.\n")
    md.append("- Pareto recomputation at N=30 / N=100 uses the SUBSET configs as the candidate pool. "
              "Membership flips reflect within-subset re-ordering, not full-grid re-ordering.\n")

    (HERE / "stability_report.md").write_text("".join(md))
    print(f"Wrote stability_report.md")


if __name__ == "__main__":
    main()
