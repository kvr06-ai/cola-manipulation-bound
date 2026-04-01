/**
 * The Process Counterfactual — Page controller.
 * Shows how Philadelphia's 2013-2017 tanking strategy would have
 * self-destructed under COLA's diminishment rules.
 */

var PROCESS_PICKS = [
  { year: 2014, pick: 3, label: '#3 pick (−50%)', offsetY: -22 },
  { year: 2015, pick: 3, label: '#3 pick (−50%)', offsetY: -40 },
  { year: 2016, pick: 1, label: '#1 pick (reset)', offsetY: -22 },
  { year: 2017, pick: 3, label: '#3 pick (−50%)', offsetY: -40 },
];

// Real NBA lottery odds for worst-record team by era
// Pre-2019: 25.0%, Post-2019: 14.0%
var REAL_NBA_WORST_ODDS = { pre2019: 25.0, post2019: 14.0 };

var PROCESS_YEARS = [2013, 2014, 2015, 2016, 2017, 2018];
var CHART_YEARS_START = 2010;
var CHART_YEARS_END = 2025;

var processChart = null;

// ── Chart ──

function createProcessChart(canvasId, colaResults, nbaData) {
  var ctx = document.getElementById(canvasId).getContext('2d');
  var gridColor = '#2a2a4a';
  var textColor = '#a0a0b0';

  var years = [];
  for (var y = CHART_YEARS_START; y <= CHART_YEARS_END; y++) years.push(y);

  // PHI COLA index
  var phiColaValues = years.map(function (y) {
    var r = colaResults[y];
    if (!r || !r.teams['PHI']) return null;
    return r.teams['PHI'].index;
  });

  // PHI real NBA draft position (inverted to show "higher = better position")
  // We show the actual pick number on a secondary axis
  var phiRealPicks = years.map(function (y) {
    var season = null;
    for (var i = 0; i < nbaData.seasons.length; i++) {
      if (nbaData.seasons[i].year === y) { season = nbaData.seasons[i]; break; }
    }
    if (!season) return null;
    for (var i = 0; i < season.teams.length; i++) {
      if (season.teams[i].id === 'PHI') {
        var pick = season.teams[i].draftPick;
        return (pick && pick <= 14) ? pick : null;
      }
    }
    return null;
  });

  // Top lottery team index (context line)
  var topValues = years.map(function (y) {
    var r = colaResults[y];
    if (!r || !r.draftOrder || r.draftOrder.length === 0) return null;
    return r.draftOrder[0].index;
  });

  // BOS COLA index (shows Fultz/Tatum trade impact landing on BOS, not PHI)
  var bosValues = years.map(function (y) {
    var r = colaResults[y];
    if (!r || !r.teams['BOS']) return null;
    return r.teams['BOS'].index;
  });

  // Build point radii and colors — larger markers at pick years
  var pickYearSet = {};
  for (var i = 0; i < PROCESS_PICKS.length; i++) {
    pickYearSet[PROCESS_PICKS[i].year] = PROCESS_PICKS[i];
  }

  var pointRadii = years.map(function (y) { return pickYearSet[y] ? 7 : 2; });
  var pointColors = years.map(function (y) { return pickYearSet[y] ? '#ffd166' : '#e94560'; });

  // Real pick markers — show for all lottery picks
  var realPointRadii = years.map(function (y, i) { return phiRealPicks[i] ? 6 : 0; });

  processChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: years.map(String),
      datasets: [
        {
          label: 'PHI Under COLA',
          data: phiColaValues,
          borderColor: '#e94560',
          backgroundColor: 'rgba(233, 69, 96, 0.12)',
          borderWidth: 2.5,
          pointRadius: pointRadii,
          pointBackgroundColor: pointColors,
          pointBorderColor: pointColors,
          pointHoverRadius: 8,
          tension: 0.1,
          fill: true,
          yAxisID: 'y',
        },
        {
          label: 'Top Lottery Team',
          data: topValues,
          borderColor: '#a0a0b0',
          borderDash: [6, 4],
          borderWidth: 1.5,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.1,
          fill: false,
          yAxisID: 'y',
        },
        {
          label: 'BOS (held #1 on lottery day)',
          data: bosValues,
          borderColor: '#4ade80',
          borderDash: [4, 3],
          borderWidth: 1.8,
          pointRadius: 1,
          pointHoverRadius: 5,
          pointBackgroundColor: '#4ade80',
          tension: 0.1,
          fill: false,
          yAxisID: 'y',
        },
        {
          label: 'PHI Real Pick #',
          data: phiRealPicks,
          borderColor: '#53a8b6',
          backgroundColor: '#53a8b6',
          borderWidth: 0,
          pointRadius: realPointRadii,
          pointBackgroundColor: '#53a8b6',
          pointBorderColor: '#53a8b6',
          pointHoverRadius: 8,
          pointStyle: 'rectRot',
          showLine: false,
          yAxisID: 'y2',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          labels: { color: textColor, font: { size: 11 }, usePointStyle: true },
        },
        tooltip: {
          backgroundColor: 'rgba(22, 33, 62, 0.95)',
          titleColor: '#e0e0e0',
          bodyColor: '#a0a0b0',
          borderColor: '#2a2a4a',
          borderWidth: 1,
          callbacks: {
            label: function (ctx) {
              if (ctx.datasetIndex === 3) {
                return ctx.raw ? 'Real NBA: Pick #' + ctx.raw : '';
              }
              if (ctx.datasetIndex === 0) {
                var year = parseInt(ctx.label);
                var pick = pickYearSet[year];
                var base = 'PHI Tickets: ' + Math.round(ctx.raw).toLocaleString();
                if (pick) base += '  →  ' + pick.label;
                return base;
              }
              if (ctx.datasetIndex === 1) {
                return 'Top Team: ' + Math.round(ctx.raw).toLocaleString();
              }
              if (ctx.datasetIndex === 2) {
                return 'BOS Tickets: ' + Math.round(ctx.raw).toLocaleString();
              }
              return '';
            },
          },
        },
      },
      scales: {
        x: {
          ticks: { color: textColor, font: { size: 10 } },
          grid: { color: gridColor },
        },
        y: {
          type: 'linear',
          position: 'left',
          ticks: { color: textColor, font: { size: 10 } },
          grid: { color: gridColor },
          title: { display: true, text: 'Lottery Tickets', color: textColor, font: { size: 11 } },
          beginAtZero: true,
        },
        y2: {
          type: 'linear',
          position: 'right',
          reverse: true,
          min: 1,
          max: 30,
          ticks: {
            color: '#53a8b6',
            font: { size: 10 },
            stepSize: 5,
            callback: function (val) { return '#' + val; },
          },
          grid: { display: false },
          title: { display: true, text: 'Real NBA Pick', color: '#53a8b6', font: { size: 11 } },
        },
      },
    },
    plugins: [{
      id: 'pickAnnotations',
      afterDraw: function (chart) {
        var ctx = chart.ctx;
        var meta = chart.getDatasetMeta(0);

        for (var i = 0; i < PROCESS_PICKS.length; i++) {
          var pick = PROCESS_PICKS[i];
          var yearIndex = pick.year - CHART_YEARS_START;
          var point = meta.data[yearIndex];
          if (!point) continue;

          var x = point.x;
          var y = point.y + pick.offsetY;

          // Draw connecting line from label to point
          ctx.save();
          ctx.strokeStyle = 'rgba(255, 209, 102, 0.4)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, point.y - 8);
          ctx.lineTo(x, y + 10);
          ctx.stroke();

          // Draw label
          ctx.font = 'bold 10px -apple-system, BlinkMacSystemFont, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = '#ffd166';
          ctx.fillText(pick.label, x, y);
          ctx.restore();
        }
      },
    }],
  });
}

// ── Table ──

function renderProcessTable(colaResults, nbaData) {
  var tbody = document.getElementById('process-tbody');
  if (!tbody) return;

  var rows = '';

  for (var i = 0; i < PROCESS_YEARS.length; i++) {
    var y = PROCESS_YEARS[i];
    var r = colaResults[y];
    if (!r || !r.teams['PHI']) continue;

    var phi = r.teams['PHI'];

    var season = null;
    for (var si = 0; si < nbaData.seasons.length; si++) {
      if (nbaData.seasons[si].year === y) { season = nbaData.seasons[si]; break; }
    }
    var phiSeason = null;
    if (season) {
      for (var ti = 0; ti < season.teams.length; ti++) {
        if (season.teams[ti].id === 'PHI') { phiSeason = season.teams[ti]; break; }
      }
    }

    var wl = phiSeason ? (phiSeason.wins + '–' + phiSeason.losses) : '—';
    var realPick = phi.draftPick ? '#' + phi.draftPick : '—';
    var tickets = Math.round(phi.index).toLocaleString();
    var rank = phi.colaPosition ? phi.colaPosition + '/' + r.draftOrder.length : '—';
    var prob = phi.probability ? (phi.probability * 100).toFixed(1) + '%' : '—';

    var topTeam = '—';
    if (r.draftOrder && r.draftOrder.length > 0) {
      var top = r.draftOrder[0];
      topTeam = top.id + ' (' + Math.round(top.index).toLocaleString() + ')';
    }

    var isProcess = (y >= 2014 && y <= 2017);

    rows += '<tr' + (isProcess ? ' class="process-year"' : '') + '>';
    rows += '<td class="season-col">' + (y - 1) + '–' + String(y).slice(2) + '</td>';
    rows += '<td>' + wl + '</td>';
    rows += '<td class="pick-col">' + realPick + '</td>';
    rows += '<td class="tickets-col">' + tickets + '</td>';
    rows += '<td class="rank-col">' + rank + '</td>';
    rows += '<td class="prob-col">' + prob + '</td>';
    rows += '<td class="top-col">' + topTeam + '</td>';
    rows += '</tr>';
  }

  tbody.innerHTML = rows;
}

// ── Init ──

async function init() {
  var resp = await fetch('data/nba-data.json');
  var nbaData = await resp.json();

  var colaResults = computeClassicCOLA(nbaData.seasons);

  createProcessChart('process-chart', colaResults, nbaData);
  renderProcessTable(colaResults, nbaData);
}

init();
