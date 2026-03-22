#!/usr/bin/env python3
"""
Compile NBA historical data (1999-00 through 2024-25) into a JSON file
for the COLA backtester.

No external dependencies — all data hardcoded from Basketball Reference.

Usage:
    python scripts/collect_data.py
    # Outputs: web/data/nba-data.json
"""
import json
import os
from pathlib import Path

# =============================================================================
# Franchise definitions (canonical IDs that persist across relocations)
# =============================================================================
FRANCHISES = {
    "ATL": "Atlanta Hawks",
    "BOS": "Boston Celtics",
    "BKN": "Brooklyn Nets",
    "CHA": "Charlotte Hornets",  # Bobcats 2004-14, Hornets 2014+
    "CHI": "Chicago Bulls",
    "CLE": "Cleveland Cavaliers",
    "DAL": "Dallas Mavericks",
    "DEN": "Denver Nuggets",
    "DET": "Detroit Pistons",
    "GSW": "Golden State Warriors",
    "HOU": "Houston Rockets",
    "IND": "Indiana Pacers",
    "LAC": "Los Angeles Clippers",
    "LAL": "Los Angeles Lakers",
    "MEM": "Memphis Grizzlies",
    "MIA": "Miami Heat",
    "MIL": "Milwaukee Bucks",
    "MIN": "Minnesota Timberwolves",
    "NOP": "New Orleans Pelicans",  # Hornets 1988-2013, Pelicans 2013+
    "NYK": "New York Knicks",
    "OKC": "Oklahoma City Thunder",
    "ORL": "Orlando Magic",
    "PHI": "Philadelphia 76ers",
    "PHX": "Phoenix Suns",
    "POR": "Portland Trail Blazers",
    "SAC": "Sacramento Kings",
    "SAS": "San Antonio Spurs",
    "TOR": "Toronto Raptors",
    "UTA": "Utah Jazz",
    "WAS": "Washington Wizards",
}

RELOCATIONS = [
    {"from_id": "MEM", "old_name": "Vancouver Grizzlies", "new_name": "Memphis Grizzlies", "year": 2002},
    {"from_id": "NOP", "old_name": "Charlotte Hornets", "new_name": "New Orleans Hornets", "year": 2003},
    {"from_id": "OKC", "old_name": "Seattle SuperSonics", "new_name": "Oklahoma City Thunder", "year": 2009},
    {"from_id": "BKN", "old_name": "New Jersey Nets", "new_name": "Brooklyn Nets", "year": 2013},
    {"from_id": "NOP", "old_name": "New Orleans Hornets", "new_name": "New Orleans Pelicans", "year": 2014},
    {"from_id": "CHA", "old_name": "Charlotte Bobcats", "new_name": "Charlotte Hornets", "year": 2015},
]

# CHA (Charlotte Bobcats/Hornets) didn't exist before 2004-05
CHA_FIRST_YEAR = 2005  # draft year for the 2004-05 season

# =============================================================================
# Season data: compact format
# Each key = draft year (year the season ends and draft occurs)
# =============================================================================
# Format per season:
#   games: regular season games
#   champion: franchise ID
#   finals_loser: franchise ID
#   cf_losers: [2 franchise IDs that lost in conference finals]
#   r2_losers: [4 franchise IDs that lost in 2nd round / conf semis]
#   r1_losers: [8 franchise IDs that lost in 1st round]
#   draft: [franchise IDs for picks 1-N (full first round)]
#          N = 29 for 2000-2003 (29 teams), 28 for 2001-2002 (MIN forfeited),
#          30 for 2004+ (30 teams). Picks 1-14 manually verified for
#          draft-night trades (receiving team, not original holder).
#          Picks 15+ sourced from Basketball Reference draft pages and
#          reflect the original pick holder — draft-night trades in this
#          range are not corrected. This affects only the "Real Pick"
#          display column; COLA mechanism calculations are unaffected
#          (Simple COLA drought resets only on top-3 picks).
#   records: {franchise_id: wins} for ALL teams that season
#
# Playoff teams = champion + finals_loser + cf_losers + r2_losers + r1_losers (16 teams)
# Non-playoff teams = everyone else in records

SEASONS = {
    # =========================================================================
    # 1999-00 season (29 teams, no Charlotte Bobcats)
    # =========================================================================
    2000: {
        "games": 82,
        "champion": "LAL",
        "finals_loser": "IND",
        "cf_losers": ["POR", "NYK"],
        "r2_losers": ["PHX", "UTA", "PHI", "MIA"],
        "r1_losers": ["SAC", "MIN", "OKC", "SAS", "TOR", "MIL", "NOP", "DET"],
        "draft": ["BKN", "MEM", "LAC", "CHI", "ORL", "ATL", "CHI", "CLE", "HOU", "ORL", "BOS", "DAL", "ORL", "DET", "MIL", "SAC", "OKC", "LAC", "NOP", "PHI", "TOR", "NYK", "UTA", "CHI", "PHX", "DEN", "IND", "POR", "LAL"],
        "records": {
            "LAL": 67, "POR": 59, "UTA": 55, "SAS": 53, "OKC": 45, "PHX": 53,
            "SAC": 44, "MIN": 50, "DAL": 40, "HOU": 34, "DEN": 35, "MEM": 22, "LAC": 15, "GSW": 19,
            "IND": 56, "MIA": 52, "NYK": 50, "PHI": 49, "NOP": 49, "TOR": 45,
            "MIL": 42, "DET": 42, "ATL": 28, "CLE": 32, "ORL": 41, "BOS": 35,
            "WAS": 29, "BKN": 31, "CHI": 17,
        },
    },
    # =========================================================================
    # 2000-01 season (29 teams)
    # =========================================================================
    2001: {
        "games": 82,
        "champion": "LAL",
        "finals_loser": "PHI",
        "cf_losers": ["MIL", "SAS"],
        "r2_losers": ["TOR", "NOP", "DAL", "SAC"],
        "r1_losers": ["IND", "NYK", "MIA", "ORL", "UTA", "POR", "MIN", "PHX"],
        "draft": ["WAS", "LAC", "ATL", "CHI", "GSW", "MEM", "BKN", "CLE", "DET", "BOS", "BOS", "OKC", "HOU", "GSW", "ORL", "NOP", "TOR", "HOU", "POR", "CLE", "BOS", "ORL", "HOU", "UTA", "SAC", "PHI", "MEM", "SAS"],
        "records": {
            "LAL": 56, "SAS": 58, "SAC": 55, "DAL": 53, "POR": 50, "UTA": 53,
            "MIN": 47, "OKC": 44, "HOU": 45, "PHX": 51, "DEN": 40, "MEM": 23, "LAC": 31, "GSW": 17,
            "PHI": 56, "MIL": 52, "TOR": 47, "NOP": 46, "IND": 41, "MIA": 50,
            "NYK": 48, "ORL": 43, "DET": 32, "ATL": 25, "CLE": 30, "BOS": 36,
            "WAS": 19, "BKN": 26, "CHI": 15,
        },
    },
    # =========================================================================
    # 2001-02 season (29 teams, Grizzlies now in Memphis)
    # =========================================================================
    2002: {
        "games": 82,
        "champion": "LAL",
        "finals_loser": "BKN",
        "cf_losers": ["SAC", "BOS"],
        "r2_losers": ["SAS", "DAL", "DET", "NOP"],
        "r1_losers": ["OKC", "POR", "UTA", "MIN", "IND", "TOR", "PHI", "ORL"],
        "draft": ["HOU", "CHI", "GSW", "MEM", "DEN", "CLE", "NYK", "LAC", "PHX", "MIA", "WAS", "LAC", "MIL", "IND", "HOU", "PHI", "WAS", "ORL", "UTA", "TOR", "POR", "PHX", "DET", "BKN", "DEN", "SAS", "LAL", "SAC"],
        "records": {
            "LAL": 58, "SAC": 61, "SAS": 58, "DAL": 57, "OKC": 45, "POR": 49,
            "MIN": 50, "UTA": 44, "HOU": 28, "PHX": 36, "DEN": 27, "MEM": 23, "LAC": 39, "GSW": 21,
            "BKN": 52, "BOS": 49, "DET": 50, "NOP": 44, "IND": 42, "ORL": 44,
            "PHI": 43, "TOR": 42, "MIL": 41, "MIA": 36, "NYK": 30, "ATL": 33,
            "WAS": 37, "CLE": 29, "CHI": 21,
        },
    },
    # =========================================================================
    # 2002-03 season (29 teams, Charlotte Hornets now New Orleans Hornets)
    # =========================================================================
    2003: {
        "games": 82,
        "champion": "SAS",
        "finals_loser": "BKN",
        "cf_losers": ["DAL", "DET"],
        "r2_losers": ["SAC", "LAL", "PHI", "BOS"],
        "r1_losers": ["POR", "MIN", "PHX", "OKC", "IND", "ORL", "MIL", "NOP"],
        "draft": ["CLE", "DET", "DEN", "TOR", "MIA", "LAC", "CHI", "MIL", "NYK", "WAS", "GSW", "OKC", "MEM", "OKC", "ORL", "BOS", "PHX", "NOP", "UTA", "BOS", "ATL", "BKN", "POR", "LAL", "DET", "MIN", "MEM", "SAS", "DAL"],
        "records": {
            "SAS": 60, "DAL": 60, "SAC": 59, "LAL": 50, "POR": 50, "MIN": 51,
            "OKC": 40, "PHX": 44, "HOU": 43, "UTA": 47, "DEN": 17, "MEM": 28, "LAC": 27, "GSW": 38,
            "BKN": 49, "DET": 50, "PHI": 48, "IND": 48, "BOS": 44, "NOP": 47,
            "ORL": 42, "MIL": 42, "ATL": 35, "MIA": 25, "NYK": 37, "TOR": 24,
            "WAS": 37, "CLE": 17, "CHI": 30,
        },
    },
    # =========================================================================
    # 2003-04 season (29 teams, last year before CHA expansion)
    # =========================================================================
    2004: {
        "games": 82,
        "champion": "DET",
        "finals_loser": "LAL",
        "cf_losers": ["IND", "MIN"],
        "r2_losers": ["BKN", "MIA", "SAS", "SAC"],
        "r1_losers": ["MIL", "NYK", "BOS", "NOP", "HOU", "MEM", "DAL", "DEN"],
        "draft": ["ORL", "CHA", "CHI", "LAC", "WAS", "ATL", "PHX", "TOR", "PHI", "CLE", "GSW", "OKC", "POR", "UTA", "BOS", "UTA", "ATL", "NOP", "MIA", "DEN", "UTA", "BKN", "POR", "BOS", "BOS", "SAC", "LAL", "SAS", "IND", "ORL"],
        "records": {
            "DET": 54, "IND": 61, "BKN": 47, "MIL": 41, "MIA": 42, "NYK": 39,
            "BOS": 36, "NOP": 41, "PHI": 33, "CLE": 35, "TOR": 33, "WAS": 25,
            "ATL": 28, "CHI": 23, "ORL": 21,
            "LAL": 56, "MIN": 58, "SAS": 57, "SAC": 55, "DAL": 52, "MEM": 50,
            "HOU": 45, "DEN": 43, "UTA": 42, "POR": 41, "OKC": 37, "PHX": 29,
            "GSW": 37, "LAC": 28,
        },
    },
    # =========================================================================
    # 2004-05 season (30 teams! Charlotte Bobcats expansion)
    # =========================================================================
    2005: {
        "games": 82,
        "champion": "SAS",
        "finals_loser": "DET",
        "cf_losers": ["MIA", "PHX"],
        "r2_losers": ["WAS", "IND", "OKC", "DAL"],
        "r1_losers": ["BKN", "CHI", "BOS", "PHI", "HOU", "MEM", "DEN", "SAC"],
        "draft": ["MIL", "ATL", "UTA", "NOP", "CHA", "POR", "TOR", "NYK", "GSW", "LAL", "ORL", "LAC", "CHA", "MIN", "BKN", "TOR", "IND", "BOS", "MEM", "DEN", "PHX", "DEN", "SAC", "HOU", "OKC", "DET", "POR", "SAS", "MIA", "NYK"],
        "records": {
            "SAS": 59, "PHX": 62, "DAL": 58, "OKC": 52, "HOU": 51, "DEN": 49,
            "MEM": 45, "SAC": 50, "MIN": 44, "POR": 27, "UTA": 26, "LAL": 34,
            "LAC": 37, "GSW": 34, "NOP": 18,
            "DET": 54, "MIA": 59, "IND": 44, "WAS": 45, "CHI": 47, "CLE": 42,
            "BOS": 45, "PHI": 43, "BKN": 42, "MIL": 30, "TOR": 33, "NYK": 33,
            "ORL": 36, "ATL": 13, "CHA": 18,
        },
    },
    # =========================================================================
    # 2005-06 season
    # =========================================================================
    2006: {
        "games": 82,
        "champion": "MIA",
        "finals_loser": "DAL",
        "cf_losers": ["DET", "PHX"],
        "r2_losers": ["CLE", "BKN", "SAS", "LAC"],
        "r1_losers": ["CHI", "MIL", "IND", "WAS", "MEM", "SAC", "DEN", "LAL"],
        "draft": ["TOR", "CHI", "CHA", "POR", "ATL", "MIN", "BOS", "HOU", "GSW", "OKC", "ORL", "NOP", "PHI", "UTA", "NOP", "CHI", "IND", "WAS", "SAC", "NYK", "PHX", "BKN", "BKN", "MEM", "CLE", "LAL", "PHX", "DAL", "NYK", "POR"],
        "records": {
            "MIA": 52, "DET": 64, "CLE": 50, "WAS": 42, "IND": 41, "CHI": 41,
            "MIL": 40, "BKN": 49, "PHI": 38, "BOS": 33, "TOR": 27, "NYK": 23,
            "ATL": 26, "ORL": 36, "CHA": 26,
            "DAL": 60, "SAS": 63, "PHX": 54, "DEN": 44, "LAC": 47, "MEM": 49,
            "SAC": 44, "LAL": 45, "OKC": 35, "GSW": 34, "MIN": 33, "HOU": 34,
            "NOP": 38, "POR": 21, "UTA": 41,
        },
    },
    # =========================================================================
    # 2006-07 season
    # =========================================================================
    2007: {
        "games": 82,
        "champion": "SAS",
        "finals_loser": "CLE",
        "cf_losers": ["DET", "UTA"],
        "r2_losers": ["BKN", "CHI", "PHX", "GSW"],
        "r1_losers": ["WAS", "TOR", "ORL", "MIA", "DEN", "LAL", "HOU", "DAL"],
        "draft": ["POR", "OKC", "ATL", "MEM", "BOS", "MIL", "MIN", "CHA", "CHI", "SAC", "ATL", "PHI", "NOP", "LAC", "DET", "WAS", "BKN", "GSW", "LAL", "MIA", "PHI", "CHA", "NYK", "PHX", "UTA", "HOU", "DET", "SAS", "PHX", "PHI"],
        "records": {
            "SAS": 58, "DAL": 67, "PHX": 61, "UTA": 51, "HOU": 52, "DEN": 45,
            "GSW": 42, "LAL": 42, "LAC": 40, "POR": 32, "OKC": 31, "MIN": 32,
            "SAC": 33, "MEM": 22, "NOP": 39,
            "CLE": 50, "DET": 53, "CHI": 49, "TOR": 47, "WAS": 41, "MIA": 44,
            "BKN": 41, "ORL": 40, "IND": 35, "MIL": 28, "PHI": 35, "NYK": 33,
            "BOS": 24, "ATL": 30, "CHA": 33,
        },
    },
    # =========================================================================
    # 2007-08 season
    # =========================================================================
    2008: {
        "games": 82,
        "champion": "BOS",
        "finals_loser": "LAL",
        "cf_losers": ["DET", "SAS"],
        "r2_losers": ["CLE", "ORL", "NOP", "UTA"],
        "r1_losers": ["ATL", "PHI", "WAS", "TOR", "DAL", "PHX", "DEN", "HOU"],
        "draft": ["CHI", "MIA", "MIN", "OKC", "MEM", "NYK", "LAC", "MIL", "CHA", "BKN", "IND", "SAC", "POR", "GSW", "PHX", "PHI", "TOR", "WAS", "CLE", "CHA", "BKN", "ORL", "UTA", "OKC", "HOU", "SAS", "NOP", "MEM", "DET", "BOS"],
        "records": {
            "BOS": 66, "DET": 59, "ORL": 52, "CLE": 45, "WAS": 43, "TOR": 41,
            "PHI": 40, "ATL": 37, "MIA": 15, "IND": 36, "CHI": 33, "MIL": 26,
            "NYK": 23, "CHA": 32, "BKN": 34,
            "LAL": 57, "SAS": 56, "NOP": 56, "HOU": 55, "PHX": 55, "UTA": 54,
            "DEN": 50, "DAL": 51, "GSW": 48, "POR": 41, "SAC": 38, "MIN": 22,
            "MEM": 22, "OKC": 20, "LAC": 23,
        },
    },
    # =========================================================================
    # 2008-09 season (Seattle -> OKC)
    # =========================================================================
    2009: {
        "games": 82,
        "champion": "LAL",
        "finals_loser": "ORL",
        "cf_losers": ["CLE", "DEN"],
        "r2_losers": ["BOS", "ATL", "DAL", "HOU"],
        "r1_losers": ["DET", "CHI", "PHI", "MIA", "UTA", "NOP", "POR", "SAS"],
        "draft": ["LAC", "MEM", "OKC", "SAC", "MIN", "MIN", "GSW", "NYK", "TOR", "MIL", "BKN", "CHA", "IND", "PHX", "DET", "CHI", "PHI", "MIN", "ATL", "UTA", "NOP", "POR", "SAC", "DAL", "OKC", "CHI", "MEM", "MIN", "LAL", "CLE"],
        "records": {
            "LAL": 65, "DEN": 54, "SAS": 54, "HOU": 53, "DAL": 50, "POR": 54,
            "NOP": 49, "UTA": 48, "PHX": 46, "OKC": 23, "GSW": 29, "MIN": 24,
            "MEM": 24, "SAC": 17, "LAC": 19,
            "CLE": 66, "BOS": 62, "ORL": 59, "ATL": 47, "MIA": 43, "DET": 39,
            "CHI": 41, "PHI": 41, "IND": 36, "MIL": 34, "CHA": 35, "TOR": 33,
            "NYK": 32, "BKN": 34, "WAS": 19,
        },
    },
    # =========================================================================
    # 2009-10 season
    # =========================================================================
    2010: {
        "games": 82,
        "champion": "LAL",
        "finals_loser": "BOS",
        "cf_losers": ["ORL", "PHX"],
        "r2_losers": ["CLE", "ATL", "SAS", "UTA"],
        "r1_losers": ["CHI", "MIA", "MIL", "CHA", "OKC", "POR", "DAL", "DEN"],
        "draft": ["WAS", "PHI", "BKN", "MIN", "SAC", "GSW", "DET", "LAC", "UTA", "IND", "NOP", "MEM", "TOR", "HOU", "MIL", "MIN", "CHI", "OKC", "BOS", "SAS", "OKC", "POR", "MIN", "ATL", "MEM", "OKC", "BKN", "MEM", "ORL", "WAS"],
        "records": {
            "LAL": 57, "PHX": 54, "DAL": 55, "DEN": 53, "UTA": 53, "SAS": 50,
            "POR": 50, "OKC": 50, "HOU": 42, "MEM": 40, "MIN": 15, "SAC": 25,
            "GSW": 26, "LAC": 29, "NOP": 37,
            "CLE": 61, "ORL": 59, "BOS": 50, "ATL": 53, "MIL": 46, "MIA": 47,
            "CHI": 41, "CHA": 44, "DET": 27, "IND": 32, "TOR": 40, "PHI": 27,
            "NYK": 29, "BKN": 12, "WAS": 26,
        },
    },
    # =========================================================================
    # 2010-11 season
    # =========================================================================
    2011: {
        "games": 82,
        "champion": "DAL",
        "finals_loser": "MIA",
        "cf_losers": ["CHI", "OKC"],
        "r2_losers": ["ATL", "BOS", "MEM", "LAL"],
        "r1_losers": ["IND", "PHI", "NYK", "ORL", "POR", "DEN", "NOP", "SAS"],
        "draft": ["CLE", "MIN", "UTA", "CLE", "TOR", "WAS", "SAC", "DET", "CHA", "MIL", "GSW", "UTA", "PHX", "HOU", "IND", "PHI", "NYK", "WAS", "CHA", "MIN", "POR", "DEN", "HOU", "OKC", "BOS", "DAL", "BKN", "CHI", "SAS", "CHI"],
        "records": {
            "DAL": 57, "SAS": 61, "OKC": 55, "LAL": 57, "DEN": 50, "POR": 48,
            "MEM": 46, "NOP": 46, "HOU": 43, "PHX": 40, "UTA": 39, "GSW": 36,
            "MIN": 17, "SAC": 24, "LAC": 32,
            "CHI": 62, "MIA": 58, "BOS": 56, "ORL": 52, "ATL": 44, "NYK": 42,
            "PHI": 41, "IND": 37, "MIL": 35, "CHA": 34, "DET": 30, "TOR": 22,
            "WAS": 23, "BKN": 24, "CLE": 19,
        },
    },
    # =========================================================================
    # 2011-12 season (lockout-shortened: 66 games)
    # =========================================================================
    2012: {
        "games": 66,
        "champion": "MIA",
        "finals_loser": "OKC",
        "cf_losers": ["BOS", "SAS"],
        "r2_losers": ["IND", "PHI", "LAC", "LAL"],
        "r1_losers": ["NYK", "ATL", "ORL", "CHI", "DAL", "UTA", "MEM", "DEN"],
        "draft": ["NOP", "CHA", "WAS", "CLE", "SAC", "POR", "GSW", "TOR", "DET", "NOP", "POR", "HOU", "PHX", "MIL", "PHI", "HOU", "DAL", "HOU", "ORL", "DEN", "BOS", "BOS", "ATL", "CLE", "MEM", "IND", "MIA", "OKC", "CHI", "GSW"],
        "records": {
            "OKC": 47, "SAS": 50, "LAL": 41, "MEM": 41, "LAC": 40, "DEN": 38,
            "DAL": 36, "UTA": 36, "HOU": 34, "POR": 28, "PHX": 33, "MIN": 26,
            "GSW": 23, "SAC": 22, "NOP": 21,
            "MIA": 46, "CHI": 50, "IND": 42, "BOS": 39, "ATL": 40, "ORL": 37,
            "PHI": 35, "NYK": 36, "MIL": 31, "BKN": 22, "DET": 25, "TOR": 23,
            "CLE": 21, "WAS": 20, "CHA": 7,
        },
    },
    # =========================================================================
    # 2012-13 season (Nets move to Brooklyn)
    # =========================================================================
    2013: {
        "games": 82,
        "champion": "MIA",
        "finals_loser": "SAS",
        "cf_losers": ["IND", "MEM"],
        "r2_losers": ["CHI", "NYK", "GSW", "OKC"],
        "r1_losers": ["MIL", "BOS", "ATL", "BKN", "LAC", "DEN", "HOU", "LAL"],
        "draft": ["CLE", "ORL", "WAS", "CHA", "PHX", "NOP", "SAC", "DET", "MIN", "POR", "PHI", "OKC", "DAL", "UTA", "MIL", "BOS", "ATL", "ATL", "CLE", "CHI", "UTA", "BKN", "IND", "NYK", "LAC", "MIN", "DEN", "SAS", "OKC", "PHX"],
        "records": {
            "MIA": 66, "IND": 49, "NYK": 54, "BKN": 49, "CHI": 45, "ATL": 44,
            "BOS": 41, "MIL": 38, "DET": 29, "CLE": 24, "TOR": 34, "PHI": 34,
            "WAS": 29, "ORL": 20, "CHA": 21,
            "SAS": 58, "OKC": 60, "DEN": 57, "LAC": 56, "MEM": 56, "GSW": 47,
            "HOU": 45, "LAL": 45, "DAL": 41, "POR": 33, "MIN": 31, "UTA": 43,
            "SAC": 28, "PHX": 25, "NOP": 27,
        },
    },
    # =========================================================================
    # 2013-14 season (New Orleans Hornets -> Pelicans)
    # =========================================================================
    2014: {
        "games": 82,
        "champion": "SAS",
        "finals_loser": "MIA",
        "cf_losers": ["IND", "OKC"],
        "r2_losers": ["BKN", "WAS", "POR", "LAC"],
        "r1_losers": ["ATL", "TOR", "CHI", "CHA", "HOU", "DAL", "GSW", "MEM"],
        "draft": ["CLE", "MIL", "PHI", "ORL", "UTA", "BOS", "LAL", "SAC", "CHA", "PHI", "DEN", "ORL", "MIN", "PHX", "ATL", "CHI", "BOS", "PHX", "CHI", "TOR", "OKC", "MEM", "UTA", "CHA", "HOU", "MIA", "PHX", "LAC", "OKC", "SAS"],
        "records": {
            "SAS": 62, "OKC": 59, "LAC": 57, "HOU": 54, "POR": 54, "GSW": 51,
            "DAL": 49, "MEM": 50, "PHX": 48, "MIN": 40, "DEN": 36, "NOP": 34,
            "SAC": 28, "UTA": 25, "LAL": 27,
            "IND": 56, "MIA": 54, "TOR": 48, "CHI": 48, "BKN": 44, "WAS": 44,
            "CHA": 43, "ATL": 38, "NYK": 37, "DET": 29, "CLE": 33, "BOS": 25,
            "MIL": 15, "PHI": 19, "ORL": 23,
        },
    },
    # =========================================================================
    # 2014-15 season (Charlotte Bobcats -> Hornets)
    # =========================================================================
    2015: {
        "games": 82,
        "champion": "GSW",
        "finals_loser": "CLE",
        "cf_losers": ["ATL", "HOU"],
        "r2_losers": ["CHI", "WAS", "LAC", "MEM"],
        "r1_losers": ["MIL", "BOS", "BKN", "TOR", "POR", "SAS", "DAL", "NOP"],
        "draft": ["MIN", "LAL", "PHI", "NYK", "ORL", "SAC", "DEN", "DET", "CHA", "MIA", "IND", "UTA", "PHX", "OKC", "ATL", "BOS", "MIL", "HOU", "WAS", "TOR", "DAL", "CHI", "POR", "CLE", "MEM", "SAS", "LAL", "BOS", "BKN", "GSW"],
        "records": {
            "GSW": 67, "HOU": 56, "LAC": 56, "POR": 51, "MEM": 55, "SAS": 55,
            "DAL": 50, "NOP": 45, "OKC": 45, "PHX": 39, "DEN": 30, "UTA": 38,
            "SAC": 29, "LAL": 21, "MIN": 16,
            "ATL": 60, "CLE": 53, "CHI": 50, "TOR": 49, "WAS": 46, "MIL": 41,
            "BOS": 40, "BKN": 38, "MIA": 37, "CHA": 33, "DET": 32, "IND": 38,
            "ORL": 25, "PHI": 18, "NYK": 17,
        },
    },
    # =========================================================================
    # 2015-16 season (Warriors 73-9, Cavs win Finals)
    # =========================================================================
    2016: {
        "games": 82,
        "champion": "CLE",
        "finals_loser": "GSW",
        "cf_losers": ["TOR", "OKC"],
        "r2_losers": ["MIA", "ATL", "SAS", "POR"],
        "r1_losers": ["CHA", "BOS", "DET", "IND", "HOU", "DAL", "MEM", "LAC"],
        "draft": ["PHI", "LAL", "BOS", "PHX", "MIN", "NOP", "DEN", "SAC", "TOR", "MIL", "ORL", "UTA", "PHX", "CHI", "DEN", "BOS", "MEM", "DET", "DEN", "IND", "ATL", "CHA", "BOS", "PHI", "LAC", "PHI", "TOR", "PHX", "SAS", "GSW"],
        "records": {
            "GSW": 73, "SAS": 67, "OKC": 55, "LAC": 53, "POR": 44, "DAL": 42,
            "MEM": 42, "HOU": 41, "UTA": 40, "DEN": 33, "SAC": 33, "NOP": 30,
            "MIN": 29, "PHX": 23, "LAL": 17,
            "CLE": 57, "TOR": 56, "MIA": 48, "ATL": 48, "BOS": 48, "CHA": 48,
            "IND": 45, "DET": 44, "CHI": 42, "WAS": 41, "MIL": 33, "ORL": 35,
            "NYK": 32, "BKN": 21, "PHI": 10,
        },
    },
    # =========================================================================
    # 2016-17 season
    # =========================================================================
    2017: {
        "games": 82,
        "champion": "GSW",
        "finals_loser": "CLE",
        "cf_losers": ["BOS", "SAS"],
        "r2_losers": ["WAS", "TOR", "HOU", "UTA"],
        "r1_losers": ["MIL", "ATL", "CHI", "IND", "OKC", "POR", "LAC", "MEM"],
        "draft": ["PHI", "LAL", "BOS", "PHX", "SAC", "ORL", "CHI", "NYK", "DAL", "POR", "CHA", "DET", "UTA", "MIA", "POR", "CHI", "MIL", "IND", "ATL", "POR", "OKC", "BKN", "TOR", "UTA", "ORL", "POR", "BKN", "LAL", "SAS", "UTA"],
        "records": {
            "GSW": 67, "SAS": 61, "HOU": 55, "OKC": 47, "LAC": 51, "UTA": 51,
            "MEM": 43, "POR": 41, "DEN": 40, "NOP": 34, "DAL": 33, "SAC": 32,
            "MIN": 31, "PHX": 24, "LAL": 26,
            "CLE": 51, "BOS": 53, "TOR": 51, "WAS": 49, "ATL": 43, "MIL": 42,
            "IND": 42, "CHI": 41, "MIA": 41, "DET": 37, "CHA": 36, "NYK": 31,
            "PHI": 28, "BKN": 20, "ORL": 29,
        },
    },
    # =========================================================================
    # 2017-18 season
    # =========================================================================
    2018: {
        "games": 82,
        "champion": "GSW",
        "finals_loser": "CLE",
        "cf_losers": ["BOS", "HOU"],
        "r2_losers": ["PHI", "TOR", "NOP", "UTA"],
        "r1_losers": ["MIA", "MIL", "IND", "WAS", "MIN", "POR", "SAS", "OKC"],
        "draft": ["PHX", "SAC", "ATL", "MEM", "DAL", "ORL", "CHI", "CLE", "NYK", "PHI", "CHA", "LAC", "LAC", "DEN", "WAS", "PHX", "MIL", "SAS", "ATL", "MIN", "UTA", "CHI", "IND", "POR", "LAL", "PHI", "BOS", "GSW", "BKN", "ATL"],
        "records": {
            "GSW": 58, "HOU": 65, "POR": 49, "OKC": 48, "UTA": 48, "NOP": 48,
            "SAS": 47, "MIN": 47, "DEN": 46, "LAC": 42, "LAL": 35, "SAC": 27,
            "DAL": 24, "MEM": 22, "PHX": 21,
            "TOR": 59, "BOS": 55, "PHI": 52, "CLE": 50, "IND": 48, "MIA": 44,
            "MIL": 44, "WAS": 43, "DET": 39, "CHA": 36, "NYK": 29, "BKN": 28,
            "CHI": 27, "ORL": 25, "ATL": 24,
        },
    },
    # =========================================================================
    # 2018-19 season
    # =========================================================================
    2019: {
        "games": 82,
        "champion": "TOR",
        "finals_loser": "GSW",
        "cf_losers": ["MIL", "POR"],
        "r2_losers": ["PHI", "BOS", "HOU", "DEN"],
        "r1_losers": ["ORL", "BKN", "DET", "IND", "LAC", "SAS", "OKC", "UTA"],
        "draft": ["NOP", "MEM", "NYK", "ATL", "CLE", "PHX", "CHI", "ATL", "WAS", "ATL", "MIN", "CHA", "MIA", "BOS", "DET", "ORL", "BKN", "IND", "SAS", "BOS", "OKC", "BOS", "UTA", "PHI", "POR", "CLE", "BKN", "GSW", "SAS", "MIL"],
        "records": {
            "GSW": 57, "DEN": 54, "POR": 53, "HOU": 53, "OKC": 49, "UTA": 50,
            "SAS": 48, "LAC": 48, "SAC": 39, "LAL": 37, "MIN": 36, "DAL": 33,
            "NOP": 33, "MEM": 33, "PHX": 19,
            "MIL": 60, "TOR": 58, "PHI": 51, "BOS": 49, "IND": 48, "BKN": 42,
            "ORL": 42, "DET": 41, "CHA": 39, "MIA": 39, "WAS": 32, "ATL": 29,
            "CHI": 22, "CLE": 19, "NYK": 17,
        },
    },
    # =========================================================================
    # 2019-20 season (COVID bubble, ~72 regular season games equivalent)
    # =========================================================================
    2020: {
        "games": 72,  # approximate — teams played 63-75 before bubble
        "champion": "LAL",
        "finals_loser": "MIA",
        "cf_losers": ["BOS", "DEN"],
        "r2_losers": ["MIL", "TOR", "LAC", "HOU"],
        "r1_losers": ["IND", "BKN", "PHI", "ORL", "OKC", "UTA", "DAL", "POR"],
        "draft": ["MIN", "GSW", "CHA", "CHI", "CLE", "ATL", "DET", "NYK", "WAS", "PHX", "SAS", "SAC", "NOP", "BOS", "ORL", "POR", "MIN", "DAL", "BKN", "MIA", "PHI", "DEN", "NYK", "MIL", "OKC", "BOS", "UTA", "LAL", "TOR", "BOS"],
        "records": {
            "LAL": 52, "LAC": 49, "DEN": 46, "HOU": 44, "OKC": 44, "UTA": 44,
            "DAL": 43, "POR": 35, "MEM": 34, "SAS": 32, "NOP": 30, "SAC": 31,
            "PHX": 34, "MIN": 19, "GSW": 15,
            "MIL": 56, "TOR": 53, "BOS": 48, "MIA": 44, "IND": 45, "PHI": 43,
            "BKN": 35, "ORL": 33, "WAS": 25, "CHA": 23, "CHI": 22, "NYK": 21,
            "DET": 20, "ATL": 20, "CLE": 19,
        },
    },
    # =========================================================================
    # 2020-21 season (72 games, COVID)
    # =========================================================================
    2021: {
        "games": 72,
        "champion": "MIL",
        "finals_loser": "PHX",
        "cf_losers": ["ATL", "LAC"],
        "r2_losers": ["PHI", "BKN", "UTA", "DEN"],
        "r1_losers": ["NYK", "BOS", "WAS", "MIA", "POR", "DAL", "MEM", "LAL"],
        "draft": ["DET", "HOU", "CLE", "TOR", "ORL", "OKC", "GSW", "ORL", "SAC", "NOP", "CHA", "SAS", "IND", "GSW", "WAS", "OKC", "MEM", "OKC", "NYK", "ATL", "NYK", "LAL", "HOU", "HOU", "LAC", "DEN", "BKN", "PHI", "PHX", "UTA"],
        "records": {
            "PHX": 51, "UTA": 52, "LAC": 47, "DEN": 47, "DAL": 42, "POR": 42,
            "LAL": 42, "MEM": 38, "GSW": 39, "SAS": 33, "NOP": 31, "SAC": 31,
            "MIN": 23, "OKC": 22, "HOU": 17,
            "PHI": 49, "BKN": 48, "MIL": 46, "NYK": 41, "ATL": 41, "MIA": 40,
            "BOS": 36, "WAS": 34, "IND": 34, "CHA": 33, "CHI": 31, "TOR": 27,
            "CLE": 22, "ORL": 21, "DET": 20,
        },
    },
    # =========================================================================
    # 2021-22 season
    # =========================================================================
    2022: {
        "games": 82,
        "champion": "GSW",
        "finals_loser": "BOS",
        "cf_losers": ["DAL", "MIA"],
        "r2_losers": ["PHX", "MEM", "MIL", "PHI"],
        "r1_losers": ["NOP", "UTA", "MIN", "DEN", "CHI", "ATL", "TOR", "BKN"],
        "draft": ["ORL", "OKC", "HOU", "SAC", "DET", "IND", "POR", "NOP", "SAS", "WAS", "NYK", "OKC", "CHA", "CLE", "CHA", "ATL", "HOU", "CHI", "MIN", "SAS", "DEN", "MEM", "PHI", "MIL", "SAS", "DAL", "MIA", "GSW", "MEM", "OKC"],
        "records": {
            "PHX": 64, "MEM": 56, "GSW": 53, "DAL": 52, "UTA": 49, "DEN": 48,
            "MIN": 46, "NOP": 36, "LAC": 42, "SAS": 34, "LAL": 33, "SAC": 30,
            "POR": 27, "OKC": 24, "HOU": 20,
            "MIA": 53, "BOS": 51, "MIL": 51, "PHI": 51, "TOR": 48, "CHI": 46,
            "BKN": 44, "ATL": 43, "CLE": 44, "CHA": 43, "NYK": 37, "WAS": 35,
            "IND": 25, "DET": 23, "ORL": 22,
        },
    },
    # =========================================================================
    # 2022-23 season
    # =========================================================================
    2023: {
        "games": 82,
        "champion": "DEN",
        "finals_loser": "MIA",
        "cf_losers": ["LAL", "BOS"],
        "r2_losers": ["PHX", "GSW", "NYK", "PHI"],
        "r1_losers": ["MIN", "LAC", "MEM", "SAC", "MIL", "ATL", "CLE", "BKN"],
        "draft": ["SAS", "CHA", "POR", "HOU", "DET", "ORL", "IND", "WAS", "UTA", "DAL", "ORL", "OKC", "TOR", "NOP", "ATL", "UTA", "LAL", "MIA", "GSW", "HOU", "BKN", "BKN", "POR", "SAC", "MEM", "IND", "CHA", "UTA", "IND", "LAC"],
        "records": {
            "DEN": 53, "MEM": 51, "SAC": 48, "PHX": 45, "LAC": 44, "GSW": 44,
            "LAL": 43, "MIN": 42, "NOP": 42, "OKC": 40, "DAL": 38, "UTA": 37,
            "POR": 33, "SAS": 22, "HOU": 22,
            "MIL": 58, "BOS": 57, "PHI": 54, "CLE": 51, "NYK": 47, "BKN": 45,
            "MIA": 44, "ATL": 41, "TOR": 41, "CHI": 40, "IND": 35, "WAS": 35,
            "ORL": 34, "CHA": 27, "DET": 17,
        },
    },
    # =========================================================================
    # 2023-24 season [VERIFIED via Basketball Reference WebFetch]
    # =========================================================================
    2024: {
        "games": 82,
        "champion": "BOS",
        "finals_loser": "DAL",
        "cf_losers": ["IND", "MIN"],
        "r2_losers": ["CLE", "NYK", "OKC", "DEN"],
        "r1_losers": ["MIA", "ORL", "PHI", "MIL", "NOP", "PHX", "LAC", "LAL"],
        "draft": ["ATL", "WAS", "HOU", "SAS", "DET", "CHA", "POR", "SAS", "MEM", "UTA", "CHI", "OKC", "SAC", "POR", "MIA", "PHI", "LAL", "ORL", "TOR", "CLE", "NOP", "PHX", "MIL", "NYK", "NYK", "WAS", "MIN", "DEN", "UTA", "BOS"],
        "records": {
            "BOS": 64, "NYK": 50, "MIL": 49, "CLE": 48, "ORL": 47, "IND": 47,
            "PHI": 47, "MIA": 46, "CHI": 39, "ATL": 36, "BKN": 32, "TOR": 25,
            "CHA": 21, "WAS": 15, "DET": 14,
            "OKC": 57, "DEN": 57, "MIN": 56, "LAC": 51, "DAL": 50, "PHX": 49,
            "NOP": 49, "LAL": 47, "SAC": 46, "GSW": 46, "HOU": 41, "UTA": 31,
            "MEM": 27, "SAS": 22, "POR": 21,
        },
    },
    # =========================================================================
    # 2024-25 season [VERIFIED via Basketball Reference WebFetch]
    # =========================================================================
    2025: {
        "games": 82,
        "champion": "OKC",
        "finals_loser": "IND",
        "cf_losers": ["MIN", "NYK"],
        "r2_losers": ["DEN", "GSW", "BOS", "CLE"],
        "r1_losers": ["HOU", "MEM", "LAC", "LAL", "MIL", "ORL", "DET", "MIA"],
        "draft": ["DAL", "SAS", "PHI", "CHA", "UTA", "WAS", "NOP", "BKN", "TOR", "HOU", "POR", "CHI", "ATL", "SAS", "OKC", "MEM", "MIN", "WAS", "BKN", "MIA", "UTA", "ATL", "IND", "OKC", "ORL", "BKN", "BKN", "BOS", "PHX", "LAC"],
        "records": {
            "OKC": 68, "HOU": 52, "LAL": 50, "DEN": 50, "LAC": 50, "MIN": 49,
            "GSW": 48, "MEM": 48, "SAC": 40, "DAL": 39, "PHX": 36, "POR": 36,
            "SAS": 34, "NOP": 21, "UTA": 17,
            "CLE": 64, "BOS": 61, "NYK": 51, "IND": 50, "MIL": 48, "DET": 44,
            "ORL": 41, "MIA": 37, "ATL": 40, "CHI": 39, "TOR": 30, "BKN": 26,
            "PHI": 24, "CHA": 19, "WAS": 18,
        },
    },
}


def get_display_name(franchise_id, year):
    """Get the correct display name for a franchise in a given year."""
    # Check relocations in reverse chronological order
    name = FRANCHISES[franchise_id]
    for r in sorted(RELOCATIONS, key=lambda x: x["year"]):
        if r["from_id"] == franchise_id:
            if year < r["year"]:
                name = r["old_name"]
            else:
                name = r["new_name"]
    return name


def build_season(year, data):
    """Expand compact season data into full team records."""
    games = data["games"]

    # Build set of playoff teams and their results
    playoff_results = {}
    playoff_results[data["champion"]] = ("champion", 4)
    playoff_results[data["finals_loser"]] = ("finals", 3)
    for t in data["cf_losers"]:
        playoff_results[t] = ("conf_finals", 2)
    for t in data["r2_losers"]:
        playoff_results[t] = ("second_round", 1)
    for t in data["r1_losers"]:
        playoff_results[t] = ("first_round", 0)

    # Build draft pick mapping: team -> best pick received
    draft_picks = {}
    for pick_num, team_id in enumerate(data["draft"], start=1):
        if team_id not in draft_picks:
            draft_picks[team_id] = pick_num
        # If team already has a pick, keep the better (lower) one

    # Build team records
    teams = []
    for team_id, wins in data["records"].items():
        # Skip CHA before expansion
        if team_id == "CHA" and year < CHA_FIRST_YEAR:
            continue

        pr = playoff_results.get(team_id)
        team_record = {
            "id": team_id,
            "name": get_display_name(team_id, year),
            "wins": wins,
            "losses": games - wins,
            "madePlayoffs": team_id in playoff_results,
            "playoffResult": pr[0] if pr else None,
            "seriesWon": pr[1] if pr else 0,
            "draftPick": draft_picks.get(team_id),
        }
        teams.append(team_record)

    # Sort by wins descending
    teams.sort(key=lambda t: t["wins"], reverse=True)

    season_label = f"{year - 1}-{str(year)[2:]}"
    return {
        "season": season_label,
        "year": year,
        "teams": teams,
    }


def build_json():
    """Build the complete JSON structure."""
    seasons = []
    for year in sorted(SEASONS.keys()):
        seasons.append(build_season(year, SEASONS[year]))

    # Build teams metadata
    teams_meta = {}
    for fid, name in FRANCHISES.items():
        teams_meta[fid] = {"name": name}

    # Build relocations for display
    relocations = []
    for r in RELOCATIONS:
        relocations.append({
            "id": r["from_id"],
            "oldName": r["old_name"],
            "newName": r["new_name"],
            "year": r["year"],
        })

    return {
        "seasons": seasons,
        "teams": teams_meta,
        "relocations": relocations,
    }


def validate(data):
    """Run validation checks against known anchor points."""
    errors = []

    # Check team counts per season
    for s in data["seasons"]:
        n = len(s["teams"])
        year = s["year"]
        expected = 29 if year <= 2004 else 30
        if n != expected:
            errors.append(f"{s['season']}: expected {expected} teams, got {n}")

    # Check 2024-25 champion
    s2025 = next(s for s in data["seasons"] if s["year"] == 2025)
    champ = next((t for t in s2025["teams"] if t["playoffResult"] == "champion"), None)
    if not champ or champ["id"] != "OKC":
        errors.append(f"2024-25: champion should be OKC, got {champ}")

    # Check Kings drought: no playoff series win since 2003-04
    for s in data["seasons"]:
        if s["year"] > 2004:
            sac = next((t for t in s["teams"] if t["id"] == "SAC"), None)
            if sac and sac["seriesWon"] > 0:
                errors.append(f"{s['season']}: SAC has seriesWon={sac['seriesWon']} (should be 0 after 2004)")

    if errors:
        print("VALIDATION ERRORS:")
        for e in errors:
            print(f"  - {e}")
    else:
        print("All validation checks passed.")

    return len(errors) == 0


if __name__ == "__main__":
    data = build_json()
    validate(data)

    # Write output
    out_dir = Path(__file__).parent.parent / "docs" / "data"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "nba-data.json"

    with open(out_path, "w") as f:
        json.dump(data, f, indent=2)

    print(f"\nWrote {out_path}")
    n_seasons = len(data["seasons"])
    n_teams = sum(len(s["teams"]) for s in data["seasons"])
    print(f"  {n_seasons} seasons, {n_teams} team-season records")
