/**
 * Chart.js wrapper functions for COLA Explorer.
 * Creates and updates lottery probability bar chart and team timeline.
 */

const CHART_COLORS = {
  simple: '#53a8b6',
  classic: '#e94560',
  actual: '#a0a0b0',
  grid: '#2a2a4a',
  text: '#a0a0b0',
  highlight: '#ffd166',
};

let lotteryChart = null;
let timelineChart = null;

function createLotteryChart(canvasId) {
  const ctx = document.getElementById(canvasId).getContext('2d');
  lotteryChart = new Chart(ctx, {
    type: 'bar',
    data: { labels: [], datasets: [{ data: [], backgroundColor: [], borderWidth: 0 }] },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const val = ctx.parsed.x;
              return ctx.dataset.tooltipData
                ? ctx.dataset.tooltipData[ctx.dataIndex]
                : val.toFixed(1) + '%';
            },
          },
        },
      },
      scales: {
        x: {
          grid: { color: CHART_COLORS.grid },
          ticks: { color: CHART_COLORS.text, callback: (v) => v + '%' },
          title: { display: true, text: 'P(#1 Pick)', color: CHART_COLORS.text },
        },
        y: {
          grid: { display: false },
          ticks: { color: CHART_COLORS.text, font: { size: 11 } },
        },
      },
    },
  });
  return lotteryChart;
}

function updateLotteryChart(draftOrder, variant) {
  if (!lotteryChart) return;

  if (variant === 'simple') {
    // Simple COLA: deterministic — show drought values as bars
    const labels = draftOrder.map((t) => '#' + t.colaPosition + ' ' + t.id);
    const data = draftOrder.map((t) => t.drought);
    const tooltips = draftOrder.map((t) => 'Drought: ' + t.drought + ' yrs, Wins: ' + t.wins);

    lotteryChart.data.labels = labels;
    lotteryChart.data.datasets[0].data = data;
    lotteryChart.data.datasets[0].backgroundColor = labels.map(() => CHART_COLORS.simple);
    lotteryChart.data.datasets[0].tooltipData = tooltips;
    lotteryChart.options.scales.x.title.text = 'Drought (years)';
    lotteryChart.options.scales.x.ticks.callback = (v) => v;
  } else {
    // Classic COLA: show probabilities
    const labels = draftOrder.map((t) => '#' + t.colaPosition + ' ' + t.id);
    const data = draftOrder.map((t) => (t.probability * 100));
    const tooltips = draftOrder.map(
      (t) => (t.probability * 100).toFixed(1) + '% (Index: ' + Math.round(t.index).toLocaleString() + ')'
    );

    lotteryChart.data.labels = labels;
    lotteryChart.data.datasets[0].data = data;
    lotteryChart.data.datasets[0].backgroundColor = labels.map(() => CHART_COLORS.classic);
    lotteryChart.data.datasets[0].tooltipData = tooltips;
    lotteryChart.options.scales.x.title.text = 'P(#1 Pick)';
    lotteryChart.options.scales.x.ticks.callback = (v) => v.toFixed(0) + '%';
  }

  lotteryChart.update();
}

function createTimelineChart(canvasId) {
  const ctx = document.getElementById(canvasId).getContext('2d');
  timelineChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Value',
          data: [],
          borderColor: CHART_COLORS.simple,
          backgroundColor: CHART_COLORS.simple + '33',
          tension: 0.2,
          fill: true,
          pointRadius: 4,
          pointBackgroundColor: [],
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              return ctx.dataset.tooltipData
                ? ctx.dataset.tooltipData[ctx.dataIndex]
                : String(ctx.parsed.y);
            },
          },
        },
      },
      scales: {
        x: {
          grid: { color: CHART_COLORS.grid },
          ticks: { color: CHART_COLORS.text, maxRotation: 45 },
        },
        y: {
          grid: { color: CHART_COLORS.grid },
          ticks: { color: CHART_COLORS.text },
          beginAtZero: true,
        },
      },
    },
  });
  return timelineChart;
}

function updateTimelineChart(teamId, variantData, variant, seasonsData) {
  if (!timelineChart) return;

  const years = Object.keys(variantData).map(Number).sort();
  const labels = years.map((y) => {
    const s = seasonsData.find((s) => s.year === y);
    return s ? s.season : String(y);
  });

  const data = [];
  const pointColors = [];
  const tooltips = [];

  for (const y of years) {
    const teamState = variantData[y].teams[teamId];
    if (!teamState) {
      data.push(null);
      pointColors.push(CHART_COLORS.text);
      tooltips.push('N/A');
      continue;
    }

    const value = variant === 'simple' ? teamState.drought : teamState.index;
    data.push(value);

    // Color by playoff status
    if (teamState.playoffResult === 'champion') {
      pointColors.push(CHART_COLORS.highlight);
    } else if (teamState.madePlayoffs) {
      pointColors.push('#69db7c');
    } else {
      pointColors.push(CHART_COLORS.classic);
    }

    // Tooltip
    const parts = [];
    if (variant === 'simple') {
      parts.push('Drought: ' + teamState.drought);
    } else {
      parts.push('Index: ' + Math.round(teamState.index).toLocaleString());
    }
    if (teamState.madePlayoffs) {
      parts.push(teamState.playoffResult.replace('_', ' '));
    } else {
      parts.push('Lottery');
    }
    if (teamState.draftPick) {
      parts.push('Pick #' + teamState.draftPick);
    }
    tooltips.push(parts.join(' | '));
  }

  const color = variant === 'simple' ? CHART_COLORS.simple : CHART_COLORS.classic;

  timelineChart.data.labels = labels;
  timelineChart.data.datasets[0].data = data;
  timelineChart.data.datasets[0].borderColor = color;
  timelineChart.data.datasets[0].backgroundColor = color + '33';
  timelineChart.data.datasets[0].pointBackgroundColor = pointColors;
  timelineChart.data.datasets[0].tooltipData = tooltips;
  timelineChart.options.scales.y.title = {
    display: true,
    text: variant === 'simple' ? 'Drought (years)' : 'Lottery Index',
    color: CHART_COLORS.text,
  };

  timelineChart.update();
}
