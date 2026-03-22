/**
 * COLA Explorer — Main application.
 * Fetches NBA data, computes COLA variants, wires UI controls.
 */

let nbaData = null;
let colaResults = null;
let currentYear = 2025;
let currentVariant = 'classic';
let currentTeam = 'SAC';

async function init() {
  // Load NBA data
  const resp = await fetch('data/nba-data.json');
  nbaData = await resp.json();

  // Compute COLA variants
  colaResults = computeAllVariants(nbaData.seasons);

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
      render();
    });
  });

  teamSelect.addEventListener('change', () => {
    currentTeam = teamSelect.value;
    renderTimeline();
  });

  // Initial render
  render();
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
    if (currentVariant === 'classic' || currentVariant === 'simpleLottery' || currentVariant === 'countdown') {
      const tdProb = document.createElement('td');
      if (team.probability != null && team.probability > 0) {
        tdProb.textContent = (team.probability * 100).toFixed(0) + '%';
      } else if ((currentVariant === 'simpleLottery' || currentVariant === 'countdown') && !team.inLottery) {
        tdProb.textContent = '—';
        tdProb.title = currentVariant === 'countdown'
          ? 'Not in #1 pick pool (only top 5 by McCarty number)'
          : 'Not in lottery (ranked 15-22 by drought)';
      } else {
        tdProb.textContent = (team.probability * 100).toFixed(1) + '%';
      }
      tr.appendChild(tdProb);
    }
    tr.appendChild(tdActual);
    tr.appendChild(tdWins);
    tbody.appendChild(tr);
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
    probHeader.title = 'Survivor-style lottery: top 5 by McCarty number get 30%/25%/20%/15%/10%';
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
  if (!simple || !simpleLottery || !countdown || !classic) return;

  const tbody = document.getElementById('comparison-tbody');
  tbody.innerHTML = '';

  // Simple/Simple Lottery use 22-team pool (seriesWon === 0), Classic uses 14 (non-playoff).
  // Show the union so all variants are represented.
  const season = nbaData.seasons.find((s) => s.year === currentYear);
  const lotteryTeams = season.teams.filter((t) => !t.madePlayoffs || t.seriesWon === 0);

  // Build lookup maps
  const simpleMap = {};
  simple.draftOrder.forEach((t) => { simpleMap[t.id] = t; });
  const slMap = {};
  simpleLottery.draftOrder.forEach((t) => { slMap[t.id] = t; });
  const cdMap = {};
  countdown.draftOrder.forEach((t) => { cdMap[t.id] = t; });
  const classicMap = {};
  classic.draftOrder.forEach((t) => { classicMap[t.id] = t; });

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
      classicPos: classicMap[t.id] ? classicMap[t.id].colaPosition : '—',
      classicProb: classicMap[t.id] ? (classicMap[t.id].probability * 100).toFixed(1) + '%' : '—',
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
      '<td>' + t.classicPos + '</td>' +
      '<td>' + t.classicProb + '</td>' +
      '<td>' + t.actualPick + '</td>' +
      '<td>' + t.wins + '</td>';
    tbody.appendChild(tr);
  }
}

// Boot
document.addEventListener('DOMContentLoaded', init);
