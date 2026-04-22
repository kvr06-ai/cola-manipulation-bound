/**
 * COLA Explorer — Main application.
 * Fetches NBA data, computes COLA variants, wires UI controls.
 */

let nbaData = null;
let colaResults = null;
let currentYear = 2025;
let currentVariant = 'classic';
let currentTeam = 'SAC';
let cappedMax = 150;

async function init() {
  // Load NBA data
  const resp = await fetch('data/nba-data.json');
  nbaData = await resp.json();

  // Compute COLA variants (capped uses current cappedMax)
  colaResults = computeAllVariants(nbaData.seasons, cappedMax);

  // Populate year slider
  const slider = document.getElementById('year-slider');
  const years = nbaData.seasons.map((s) => s.year);
  slider.min = Math.min(...years);
  slider.max = Math.max(...years);
  slider.value = currentYear;
  updateYearDisplay();

  // Populate team dropdown
  const teamSelect = document.getElementById('team-select');
  const teamIds = Object.keys(nbaData.teams).sort();
  teamIds.forEach((id) => {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = id + ' — ' + nbaData.teams[id].name;
    if (id === currentTeam) opt.selected = true;
    teamSelect.appendChild(opt);
  });

  // Create charts
  createLotteryChart('lottery-chart');
  createTimelineChart('timeline-chart');

  // Wire controls
  slider.addEventListener('input', () => {
    currentYear = Number(slider.value);
    updateYearDisplay();
    render();
  });

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      currentVariant = tab.dataset.variant;
      updateCappedControlsVisibility();
      render();
    });
  });

  teamSelect.addEventListener('change', () => {
    currentTeam = teamSelect.value;
    renderTimeline();
  });

  // Capped MAX slider
  const capSlider = document.getElementById('capped-max-slider');
  const capDisplay = document.getElementById('capped-max-display');
  const capDisplay1 = document.getElementById('cap-display-1');
  const capMaxSeries = document.getElementById('cap-max-series');
  const capTypicalSeries = document.getElementById('cap-typical-series');
  if (capSlider) {
    capSlider.addEventListener('input', () => {
      cappedMax = Number(capSlider.value);
      if (capDisplay) capDisplay.textContent = cappedMax;
      if (capDisplay1) capDisplay1.textContent = cappedMax;
      if (capMaxSeries) capMaxSeries.textContent = Math.round(0.3 * cappedMax);
      if (capTypicalSeries) capTypicalSeries.textContent = Math.round(0.2 * cappedMax);
      // Recompute capped variant with new MAX
      colaResults.capped = computeCappedCOLA(nbaData.seasons, cappedMax);
      render();
    });
  }

  updateCappedControlsVisibility();

  // Initial render
  render();
}

function updateCappedControlsVisibility() {
  const cappedControls = document.getElementById('capped-controls');
  const cappedSidePanel = document.getElementById('capped-side-panel');
  const display = currentVariant === 'capped' ? '' : 'none';
  if (cappedControls) cappedControls.style.display = display;
  if (cappedSidePanel) cappedSidePanel.style.display = display;
}

function updateYearDisplay() {
  const season = nbaData.seasons.find((s) => s.year === currentYear);
  document.getElementById('year-display').textContent = season
    ? season.season
    : currentYear;
}

function render() {
  renderDraftTable();
  renderLotteryChart();
  renderTimeline();
  renderComparison();
}

function renderDraftTable() {
  const variantData = colaResults[currentVariant][currentYear];
  if (!variantData) return;

  const tbody = document.getElementById('draft-tbody');
  tbody.innerHTML = '';

  const draftOrder = variantData.draftOrder;

  for (const team of draftOrder) {
    const tr = document.createElement('tr');

    const tdRank = document.createElement('td');
    tdRank.textContent = team.colaPosition;

    const tdTeam = document.createElement('td');
    tdTeam.textContent = team.name || team.id;

    const tdValue = document.createElement('td');
    if (currentVariant === 'simple' || currentVariant === 'simpleLottery') {
      tdValue.textContent = team.drought + ' yrs';
    } else if (currentVariant === 'countdown') {
      tdValue.textContent = team.mccarty.toLocaleString();
    } else if (currentVariant === 'capped') {
      tdValue.textContent = Math.round(team.index).toLocaleString();
    } else {
      tdValue.textContent = Math.round(team.index).toLocaleString();
    }

    const tdActual = document.createElement('td');
    tdActual.textContent = team.draftPick ? '#' + team.draftPick : '—';
    if (!team.draftPick) {
      tdActual.title = 'No first-round pick (traded or forfeited)';
    }
    if (team.draftPick && team.draftPick <= 3) {
      tdActual.classList.add('highlight');
    }

    const tdWins = document.createElement('td');
    tdWins.textContent = team.wins + '-' + team.losses;

    tr.appendChild(tdRank);
    tr.appendChild(tdTeam);
    tr.appendChild(tdValue);
    if (currentVariant === 'classic' || currentVariant === 'simpleLottery' || currentVariant === 'countdown' || currentVariant === 'capped') {
      const tdProb = document.createElement('td');
      if (currentVariant === 'countdown') {
        // Monte Carlo probabilities: show 1 decimal, <1% for tiny values
        const pct = (team.probability || 0) * 100;
        if (pct >= 0.5) {
          tdProb.textContent = pct.toFixed(1) + '%';
        } else if (pct > 0) {
          tdProb.textContent = '<1%';
        } else {
          tdProb.textContent = '—';
        }
        if (team.expectedPick) {
          tdProb.title = 'E[pick] = ' + team.expectedPick.toFixed(1) + ' (Monte Carlo, 10k trials)';
        }
      } else if (currentVariant === 'simpleLottery' && !team.inLottery) {
        tdProb.textContent = '—';
        tdProb.title = 'Not in lottery (ranked 15-22 by drought)';
      } else if (currentVariant === 'capped') {
        tdProb.textContent = (team.probability * 100).toFixed(1) + '%';
        tdProb.title = 'Top-5 raffle odds: stockpile / pool. Drought: ' + team.drought + ' yrs.';
      } else {
        tdProb.textContent = (team.probability * 100).toFixed(1) + '%';
      }
      tr.appendChild(tdProb);
    }
    tr.appendChild(tdActual);
    tr.appendChild(tdWins);
    tbody.appendChild(tr);
  }

  // Capped COLA side panel: update eligible count for current season
  if (currentVariant === 'capped') {
    const eligEl = document.getElementById('cap-eligible-count');
    if (eligEl) eligEl.textContent = draftOrder.length;
  }

  // Update column headers based on variant
  const valueHeader = document.getElementById('value-header');
  const probHeader = document.getElementById('prob-header');
  if (currentVariant === 'simple') {
    valueHeader.textContent = 'Drought (yrs)';
    valueHeader.title = 'Years without a playoff series win or top-3 draft pick';
    probHeader.style.display = 'none';
  } else if (currentVariant === 'simpleLottery') {
    valueHeader.textContent = 'Drought (yrs)';
    valueHeader.title = 'Years without a playoff series win or top-3 draft pick';
    probHeader.style.display = '';
    probHeader.textContent = 'Odds of #1 Pick';
    probHeader.title = 'Pre-2019 NBA lottery odds based on drought ranking (top 14 only)';
  } else if (currentVariant === 'countdown') {
    valueHeader.textContent = 'McCarty #';
    valueHeader.title = 'Drought × regular-season wins (higher = better draft position)';
    probHeader.style.display = '';
    probHeader.textContent = 'Odds of #1 Pick';
    probHeader.title = 'Monte Carlo simulation (10,000 trials) of survivor-style bottom-up elimination lottery';
  } else if (currentVariant === 'capped') {
    valueHeader.textContent = 'Stockpile';
    valueHeader.title = 'Capped stockpile at lottery time (max = ' + cappedMax + '). Wins increment for play-in-or-below teams at season end; playoff diminishment applied before draw.';
    probHeader.style.display = '';
    probHeader.textContent = 'Odds of #1 Pick';
    probHeader.title = 'Capped COLA top-5 raffle odds: stockpile / total pool';
  } else {
    valueHeader.textContent = 'Tickets';
    valueHeader.title = 'Accumulated lottery tickets (more = better odds of a high pick)';
    probHeader.style.display = '';
    probHeader.textContent = 'Odds of #1 Pick';
    probHeader.title = 'Probability of receiving the #1 overall draft pick';
  }
}

function renderLotteryChart() {
  const variantData = colaResults[currentVariant][currentYear];
  if (!variantData) return;

  const canvas = document.getElementById('lottery-chart');
  const overlay = document.getElementById('cold-start-overlay');

  if (currentYear === 2000) {
    canvas.style.display = 'none';
    overlay.style.display = 'flex';
  } else {
    canvas.style.display = '';
    overlay.style.display = 'none';
    updateLotteryChart(variantData.draftOrder, currentVariant);
  }
}

function renderTimeline() {
  const variantData = colaResults[currentVariant];
  updateTimelineChart(currentTeam, variantData, currentVariant, nbaData.seasons);
}

function renderComparison() {
  const simple = colaResults.simple[currentYear];
  const simpleLottery = colaResults.simpleLottery[currentYear];
  const countdown = colaResults.countdown[currentYear];
  const classic = colaResults.classic[currentYear];
  const capped = colaResults.capped[currentYear];
  if (!simple || !simpleLottery || !countdown || !classic || !capped) return;

  const tbody = document.getElementById('comparison-tbody');
  tbody.innerHTML = '';

  // Union of all variant pools: Simple/Simple Lottery/Countdown use 22-team pool
  // (seriesWon === 0), Classic uses 14 (non-playoff), Capped uses drought-≥2
  // eligibility (may include some first-round losers, may exclude some non-playoff
  // teams that won a top-5 pick last year or a playoff series). We union all
  // teams that appear in any variant's draft order so nothing is hidden.
  const season = nbaData.seasons.find((s) => s.year === currentYear);
  const unionIds = new Set();
  [simple, simpleLottery, countdown, classic, capped].forEach((v) => {
    v.draftOrder.forEach((t) => unionIds.add(t.id));
  });
  // Also include any non-playoff or series-losing teams not already in the union
  season.teams.forEach((t) => {
    if (!t.madePlayoffs || t.seriesWon === 0) unionIds.add(t.id);
  });
  const lotteryTeams = season.teams.filter((t) => unionIds.has(t.id));

  // Build lookup maps
  const simpleMap = {};
  simple.draftOrder.forEach((t) => { simpleMap[t.id] = t; });
  const slMap = {};
  simpleLottery.draftOrder.forEach((t) => { slMap[t.id] = t; });
  const cdMap = {};
  countdown.draftOrder.forEach((t) => { cdMap[t.id] = t; });
  const classicMap = {};
  classic.draftOrder.forEach((t) => { classicMap[t.id] = t; });
  const cappedMap = {};
  capped.draftOrder.forEach((t) => { cappedMap[t.id] = t; });

  // Sort by Simple COLA position
  const sorted = lotteryTeams
    .map((t) => ({
      id: t.id,
      name: t.name,
      simplePos: simpleMap[t.id] ? simpleMap[t.id].colaPosition : '—',
      simpleDrought: simpleMap[t.id] ? simpleMap[t.id].drought : '—',
      slOdds: slMap[t.id] && slMap[t.id].probability > 0 ? (slMap[t.id].probability * 100).toFixed(1) + '%' : '—',
      cdPos: cdMap[t.id] ? cdMap[t.id].colaPosition : '—',
      cdMccarty: cdMap[t.id] ? cdMap[t.id].mccarty : '—',
      cdOdds: cdMap[t.id] && cdMap[t.id].probability >= 0.005 ? (cdMap[t.id].probability * 100).toFixed(1) + '%' : cdMap[t.id] && cdMap[t.id].probability > 0 ? '<1%' : '—',
      classicPos: classicMap[t.id] ? classicMap[t.id].colaPosition : '—',
      classicProb: classicMap[t.id] ? (classicMap[t.id].probability * 100).toFixed(1) + '%' : '—',
      cappedPos: cappedMap[t.id] ? cappedMap[t.id].colaPosition : '—',
      cappedStockpile: cappedMap[t.id] ? Math.round(cappedMap[t.id].index) : '—',
      cappedOdds: cappedMap[t.id] && cappedMap[t.id].probability > 0 ? (cappedMap[t.id].probability * 100).toFixed(1) + '%' : '—',
      actualPick: t.draftPick ? '#' + t.draftPick : '—',
      wins: t.wins,
    }))
    .sort((a, b) => {
      const aPos = typeof a.simplePos === 'number' ? a.simplePos : 99;
      const bPos = typeof b.simplePos === 'number' ? b.simplePos : 99;
      return aPos - bPos;
    });

  for (const t of sorted) {
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td>' + t.name + '</td>' +
      '<td>' + t.simplePos + '</td>' +
      '<td>' + t.simpleDrought + '</td>' +
      '<td>' + t.slOdds + '</td>' +
      '<td>' + t.cdPos + '</td>' +
      '<td>' + t.cdMccarty + '</td>' +
      '<td>' + t.cdOdds + '</td>' +
      '<td>' + t.classicPos + '</td>' +
      '<td>' + t.classicProb + '</td>' +
      '<td>' + t.cappedPos + '</td>' +
      '<td>' + t.cappedStockpile + '</td>' +
      '<td>' + t.cappedOdds + '</td>' +
      '<td>' + t.actualPick + '</td>' +
      '<td>' + t.wins + '</td>';
    tbody.appendChild(tr);
  }
}

// Boot
document.addEventListener('DOMContentLoaded', init);
