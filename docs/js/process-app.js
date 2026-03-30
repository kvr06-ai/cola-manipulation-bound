/**
 * The Process Counterfactual — Page controller.
 * Shows how Philadelphia's 2013-2017 tanking strategy would have
 * self-destructed under COLA's diminishment rules.
 */

var PROCESS_PICKS = [
  { year: 2014, pick: 3, player: 'Joel Embiid', note: 'Tickets cut 50%' },
  { year: 2015, pick: 3, player: 'Jahlil Okafor', note: 'Cut 50% again' },
  { year: 2016, pick: 1, player: 'Ben Simmons', note: 'Reset to 0' },
  { year: 2017, pick: 1, player: 'Markelle Fultz', note: 'Reset to 0 again' },
];

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

  // PHI index values
  var phiValues = years.map(function (y) {
    var r = colaResults[y];
    if (!r || !r.teams['PHI']) return null;
    return r.teams['PHI'].index;
  });

  // Top lottery team index (context line)
  var topValues = years.map(function (y) {
    var r = colaResults[y];
    if (!r || !r.draftOrder || r.draftOrder.length === 0) return null;
    return r.draftOrder[0].index;
  });

  // Build point radii and colors — larger markers at pick years
  var pickYearSet = {};
  for (var i = 0; i < PROCESS_PICKS.length; i++) {
    pickYearSet[PROCESS_PICKS[i].year] = PROCESS_PICKS[i];
  }

  var pointRadii = years.map(function (y) { return pickYearSet[y] ? 7 : 2; });
  var pointColors = years.map(function (y) { return pickYearSet[y] ? '#ffd166' : '#e94560'; });

  processChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: years.map(String),
      datasets: [
        {
          label: 'Philadelphia 76ers',
          data: phiValues,
          borderColor: '#e94560',
          backgroundColor: 'rgba(233, 69, 96, 0.15)',
          borderWidth: 2.5,
          pointRadius: pointRadii,
          pointBackgroundColor: pointColors,
          pointBorderColor: pointColors,
          pointHoverRadius: 8,
          tension: 0.1,
          fill: true,
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
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          labels: { color: textColor, font: { size: 11 }, usePointStyle: true, pointStyle: 'circle' },
        },
        tooltip: {
          backgroundColor: 'rgba(22, 33, 62, 0.95)',
          titleColor: '#e0e0e0',
          bodyColor: '#a0a0b0',
          borderColor: '#2a2a4a',
          borderWidth: 1,
          callbacks: {
            afterLabel: function (ctx) {
              if (ctx.datasetIndex !== 0) return '';
              var year = parseInt(ctx.label);
              var pick = pickYearSet[year];
              if (!pick) return '';
              return '#' + pick.pick + ' ' + pick.player + ' — ' + pick.note;
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
          ticks: { color: textColor, font: { size: 10 } },
          grid: { color: gridColor },
          title: { display: true, text: 'Lottery Tickets', color: textColor, font: { size: 11 } },
          beginAtZero: true,
        },
      },
    },
    plugins: [{
      // Custom plugin: draw pick annotations above the chart points
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
          var y = point.y;

          ctx.save();
          ctx.font = 'bold 10px -apple-system, BlinkMacSystemFont, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = '#ffd166';
          ctx.fillText('#' + pick.pick + ' ' + pick.player, x, y - 14);
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

    // Find PHI in the season data for W-L
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

    var wl = phiSeason ? (phiSeason.wins + '-' + phiSeason.losses) : '—';
    var realPick = phi.draftPick ? '#' + phi.draftPick : '—';
    var tickets = Math.round(phi.index).toLocaleString();
    var rank = phi.colaPosition ? phi.colaPosition + ' of ' + r.draftOrder.length : '— (playoffs)';
    var prob = phi.probability ? (phi.probability * 100).toFixed(1) + '%' : '—';

    // Top team
    var topTeam = '—';
    if (r.draftOrder && r.draftOrder.length > 0) {
      var top = r.draftOrder[0];
      topTeam = top.id + ' (' + Math.round(top.index).toLocaleString() + ')';
    }

    // Highlight Process years
    var isProcess = (y >= 2014 && y <= 2017);
    var cls = isProcess ? ' class="traded-pick"' : '';

    rows += '<tr' + cls + '>';
    rows += '<td>' + (y - 1) + '-' + String(y).slice(2) + '</td>';
    rows += '<td>' + wl + '</td>';
    rows += '<td>' + realPick + '</td>';
    rows += '<td>' + tickets + '</td>';
    rows += '<td>' + rank + '</td>';
    rows += '<td>' + prob + '</td>';
    rows += '<td>' + topTeam + '</td>';
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
