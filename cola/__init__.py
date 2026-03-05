"""cola-manipulation-bound: Analytic bound on COLA pool manipulation gain."""

from .bound import manipulation_bound, manipulation_gain, manipulation_gain_approx
from .simulate import compute_empirical_gains, run_simulation

__all__ = [
    "manipulation_gain",
    "manipulation_gain_approx",
    "manipulation_bound",
    "run_simulation",
    "compute_empirical_gains",
]
