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
          title: { display: true, text: 'Odds of #1 Pick', color: CHART_COLORS.text },
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
    lotteryChart.options.scales.x.title.text = 'Years without playoff series win or top-3 pick';
    lotteryChart.options.scales.x.ticks.callback = (v) => v;
  } else if (variant === 'countdown') {
    // Countdown COLA: McCarty number bars, top 5 highlighted
    const labels = draftOrder.map((t) => '#' + t.colaPosition + ' ' + t.id);
    const data = draftOrder.map((t) => t.mccarty);
    const tooltips = draftOrder.map((t) => {
      const prob = t.inLottery ? ' | #1 pick: ' + (t.probability * 100).toFixed(0) + '%' : '';
      return 'McCarty: ' + t.mccarty + ' (drought ' + t.drought + ' × ' + t.wins + ' wins)' + prob;
    });
    const colors = draftOrder.map((t) =>
      t.inLottery ? CHART_COLORS.highlight : CHART_COLORS.simple
    );

    lotteryChart.data.labels = labels;
    lotteryChart.data.datasets[0].data = data;
    lotteryChart.data.datasets[0].backgroundColor = colors;
    lotteryChart.data.datasets[0].tooltipData = tooltips;
    lotteryChart.options.scales.x.title.text = 'McCarty number (drought × wins)';
    lotteryChart.options.scales.x.ticks.callback = (v) => v;
  } else if (variant === 'simpleLottery') {
    // Simple Lottery COLA: pre-2019 odds for top 14, 0% for bottom 8
    const labels = draftOrder.map((t) => '#' + t.colaPosition + ' ' + t.id);
    const data = draftOrder.map((t) => (t.probability || 0) * 100);
    const tooltips = draftOrder.map((t) => {
      if (t.inLottery) {
        return ((t.probability || 0) * 100).toFixed(1) + '% chance (Drought: ' + t.drought + ' yrs)';
      }
      return 'Not in lottery (Drought: ' + t.drought + ' yrs)';
    });
    const colors = draftOrder.map((t) =>
      t.inLottery ? CHART_COLORS.simple : CHART_COLORS.grid
    );

    lotteryChart.data.labels = labels;
    lotteryChart.data.datasets[0].data = data;
    lotteryChart.data.datasets[0].backgroundColor = colors;
    lotteryChart.data.datasets[0].tooltipData = tooltips;
    lotteryChart.options.scales.x.title.text = 'Odds of getting the #1 pick (pre-2019 lottery)';
    lotteryChart.options.scales.x.ticks.callback = (v) => v.toFixed(0) + '%';
  } else {
    // Classic COLA: show probabilities
    const labels = draftOrder.map((t) => '#' + t.colaPosition + ' ' + t.id);
    const data = draftOrder.map((t) => (t.probability * 100));
    const tooltips = draftOrder.map(
      (t) => (t.probability * 100).toFixed(1) + '% chance (Tickets: ' + Math.round(t.index).toLocaleString() + ')'
    );

    lotteryChart.data.labels = labels;
    lotteryChart.data.datasets[0].data = data;
    lotteryChart.data.datasets[0].backgroundColor = labels.map(() => CHART_COLORS.classic);
    lotteryChart.data.datasets[0].tooltipData = tooltips;
    lotteryChart.options.scales.x.title.text = 'Odds of getting the #1 pick';
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

    const value = (variant === 'simple' || variant === 'simpleLottery')
      ? teamState.drought
      : variant === 'countdown'
        ? (teamState.mccarty || 0)
        : teamState.index;
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
    if (variant === 'simple' || variant === 'simpleLottery') {
      parts.push('Drought: ' + teamState.drought + ' yrs');
    } else if (variant === 'countdown') {
      parts.push('McCarty: ' + (teamState.mccarty || 0) + ' (drought ' + teamState.drought + ' × ' + teamState.wins + ' wins)');
    } else {
      parts.push('Tickets: ' + Math.round(teamState.index).toLocaleString());
    }
    if (teamState.madePlayoffs) {
      const result = teamState.playoffResult.replace('_', ' ');
      parts.push(result === 'champion' ? 'Won championship' : 'Playoffs (' + result + ')');
    } else {
      parts.push('Missed playoffs');
    }
    if (teamState.draftPick) {
      parts.push('Got pick #' + teamState.draftPick);
    }
    tooltips.push(parts.join(' | '));
  }

  const color = variant === 'classic' ? CHART_COLORS.classic
    : variant === 'countdown' ? CHART_COLORS.highlight
    : CHART_COLORS.simple;

  timelineChart.data.labels = labels;
  timelineChart.data.datasets[0].data = data;
  timelineChart.data.datasets[0].borderColor = color;
  timelineChart.data.datasets[0].backgroundColor = color + '33';
  timelineChart.data.datasets[0].pointBackgroundColor = pointColors;
  timelineChart.data.datasets[0].tooltipData = tooltips;
  timelineChart.options.scales.y.title = {
    display: true,
    text: (variant === 'simple' || variant === 'simpleLottery')
      ? 'Years without playoff series win or top-3 pick'
      : variant === 'countdown'
        ? 'McCarty number (drought × wins)'
        : 'Lottery tickets (accumulated over years)',
    color: CHART_COLORS.text,
  };

  timelineChart.update();
}
