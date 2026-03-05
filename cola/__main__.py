"""Entry point: python -m cola"""

import argparse
import sys
from pathlib import Path

from .bound import compare_to_paper, manipulation_bound
from .plots import generate_all
from .simulate import run_simulation


def main():
    parser = argparse.ArgumentParser(
        description="COLA pool manipulation bound analysis"
    )
    parser.add_argument(
        "--seasons", type=int, default=200,
        help="Number of seasons to simulate (default: 200)",
    )
    parser.add_argument(
        "--no-sim", action="store_true",
        help="Skip simulation, produce analytic plots only",
    )
    parser.add_argument(
        "--output-dir", type=str, default="figures",
        help="Output directory for plots (default: figures/)",
    )
    parser.add_argument(
        "--seed", type=int, default=42,
        help="Random seed for simulation (default: 42)",
    )
    args = parser.parse_args()
    out_dir = Path(args.output_dir)

    # Analytic bound
    bound = manipulation_bound()
    comparison = compare_to_paper()

    print("COLA Pool Manipulation Bound Analysis")
    print("=" * 42)
    print(f"Analytic bound (T_max=10, T_boundary=4): {bound*100:.2f}%")
    print()
    print("Comparison with Highley et al. (2026) simulation:")
    print(f"  Paper avg gain:        {comparison['paper_avg']*100:.1f}%")
    print(f"  Paper 90th percentile: <{comparison['paper_p90']*100:.1f}%")
    print(f"  Paper max gain:        {comparison['paper_max']*100:.1f}%")
    print(f"  Our bound:             {bound*100:.1f}%")
    print(f"  Bound / sim max:       {comparison['ratio_to_max']:.2f}x")

    # Simulation
    sim_results = None
    if not args.no_sim:
        print()
        print(f"Running simulation ({args.seasons} seasons, seed={args.seed})...")
        sim_results = run_simulation(args.seasons, seed=args.seed)
        bound_holds = bound >= sim_results["max"]
        print(f"  Sim avg gain:          {sim_results['mean']*100:.2f}%")
        print(f"  Sim 90th percentile:   {sim_results['p90']*100:.2f}%")
        print(f"  Sim max gain:          {sim_results['max']*100:.2f}%")
        print(f"  Bound holds:           {'YES' if bound_holds else 'NO'}"
              f" ({bound*100:.2f}% {'>' if bound_holds else '<'}"
              f" {sim_results['max']*100:.2f}%)")

    # Plots
    print()
    print(f"Generating figures in {out_dir}/...")
    generate_all(sim_results, out_dir)
    print("Done.")


if __name__ == "__main__":
    main()
