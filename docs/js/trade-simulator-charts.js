/**
 * Trade Simulator Charts — Chart.js wrappers for multi-rule comparison.
 */

var trajectoryChart = null;

var RULE_COLORS = {
  original_owner: getComputedStyle(document.documentElement).getPropertyValue('--chart-simple').trim() || '#53a8b6',
  receiving_team: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#e94560',
  split: getComputedStyle(document.documentElement).getPropertyValue('--chart-highlight').trim() || '#ffd166',
  exclude: getComputedStyle(document.documentElement).getPropertyValue('--chart-option4').trim() || '#a78bfa',
};

var RULE_LABELS = {
  original_owner: 'Opt 1: Original Team',
  receiving_team: 'Opt 2: Receiving Team',
  split: 'Opt 3: Shared',
  exclude: 'Opt 4: Capped',
};

function createTrajectoryChart(canvasId) {
  var ctx = document.getElementById(canvasId).getContext('2d');
  var gridColor = getComputedStyle(document.documentElement).getPropertyValue('--chart-grid').trim() || '#2a2a4a';
  var textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() || '#a0a0b0';

  trajectoryChart = new Chart(ctx, {
    type: 'line',
    data: { labels: [], datasets: [] },
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
        },
      },
    },
  });
}

function updateTrajectoryChart(tradeRuleResults, teamId, activeRules, years) {
  if (!trajectoryChart) return;

  trajectoryChart.data.labels = years.map(function (y) { return y + ''; });

  trajectoryChart.data.datasets = activeRules.map(function (rule) {
    var ruleData = tradeRuleResults[rule];
    var values = years.map(function (y) {
      if (!ruleData[y] || !ruleData[y].teams[teamId]) return null;
      return ruleData[y].teams[teamId].index;
    });

    return {
      label: RULE_LABELS[rule],
      data: values,
      borderColor: RULE_COLORS[rule],
      backgroundColor: RULE_COLORS[rule] + '33',
      borderWidth: rule === 'receiving_team' ? 2.5 : 1.8,
      pointRadius: 2,
      pointHoverRadius: 5,
      tension: 0.1,
    };
  });

  trajectoryChart.update();
}
