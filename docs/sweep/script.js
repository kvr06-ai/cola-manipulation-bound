/* COLA Pareto Frontier Viewer: interactive logic (simplified).
 * Loads pre-computed sweep CSV; renders Chart.js scatter + 9-row key-results table.
 * No filters, no search, no sort, no toggle. */

(function () {
  'use strict';

  // -- Headline run constants ------------------------------------------------
  const PARETO_IDS = [11, 19, 26, 31, 45];
  const NAMED_VARIANTS = {
    0:  { name: 'Status quo NBA lottery', short: 'Status quo' },
    1:  { name: 'Classic COLA',           short: 'Classic' },
    17: { name: 'Simple COLA',            short: 'Simple' },
    26: { name: 'Capped COLA @ MAX=150',  short: 'Capped@150' },
    32: { name: 'NBA 3-2-1 proposal',     short: '3-2-1' }
  };

  // Display order for the 9-row key table: Pareto+named first, then Pareto-only
  // (asc by max_yrs_CF), then named-only (asc by config_id).
  const KEY_ROW_IDS = [26, 19, 11, 31, 45, 0, 1, 17, 32];

  // Cached palette pulled from the project's design tokens (read once at
  // boot from getComputedStyle on :root so we never inline hex literals).
  const palette = (function readPalette() {
    const root = getComputedStyle(document.documentElement);
    const g = (name) => root.getPropertyValue(name).trim();
    return {
      bg:          g('--bg'),
      surface:     g('--surface'),
      surfaceAlt:  g('--surface-alt'),
      text:        g('--text'),
      textDim:     g('--text-secondary'),
      accent:      g('--accent'),
      link:        g('--link'),
      border:      g('--border'),
      grid:        g('--chart-grid'),
      pareto:      g('--sweep-pareto'),
      paretoNamed: g('--sweep-pareto-named'),
      named:       g('--sweep-named'),
      other:       g('--sweep-other')
    };
  })();

  // ---- CSV parser (small, hand-rolled) ------------------------------------
  function parseCSV(text) {
    const lines = text.replace(/\r/g, '').split('\n').filter(Boolean);
    const header = lines[0].split(',');
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      const obj = {};
      for (let j = 0; j < header.length; j++) {
        const raw = cols[j];
        if (raw === '' || raw === undefined) {
          obj[header[j]] = null;
        } else if (raw === 'True') {
          obj[header[j]] = true;
        } else if (raw === 'False') {
          obj[header[j]] = false;
        } else if (raw === 'null') {
          obj[header[j]] = null;
        } else if (!isNaN(parseFloat(raw)) && /^[-0-9eE.+]+$/.test(raw)) {
          obj[header[j]] = parseFloat(raw);
        } else {
          obj[header[j]] = raw;
        }
      }
      rows.push(obj);
    }
    return rows;
  }

  // ---- Categorize each row ------------------------------------------------
  function categorize(row) {
    const id = row.config_id;
    const isPareto = PARETO_IDS.indexOf(id) >= 0;
    const isNamed = NAMED_VARIANTS.hasOwnProperty(id);
    if (isPareto && isNamed) return 'pareto-named';
    if (isPareto) return 'pareto';
    if (isNamed) return 'named';
    return 'other';
  }

  function badgeForCategory(cat, id) {
    if (cat === 'pareto-named') {
      return '<span class="badge badge-pareto-named">PARETO &middot; ' + NAMED_VARIANTS[id].short.toUpperCase() + '</span>';
    }
    if (cat === 'pareto') {
      return '<span class="badge badge-pareto">PARETO</span>';
    }
    if (cat === 'named') {
      return '<span class="badge badge-named">' + NAMED_VARIANTS[id].short.toUpperCase() + '</span>';
    }
    return '';
  }

  function fmt(n, decimals) {
    if (n === null || n === undefined || (typeof n === 'number' && isNaN(n))) return 'n/a';
    if (typeof n !== 'number') return String(n);
    return n.toFixed(decimals === undefined ? 2 : decimals);
  }

  function fmtCap(c) { return c === null ? '∞' : String(c); }

  // ---- Chart construction --------------------------------------------------
  function buildDatasets(rows) {
    function pointFor(row, cat) {
      return {
        x: row.manipulation_gain_pct_median,
        y: row.max_years_between_conf_finals_median,
        row: row,
        cat: cat
      };
    }

    const groups = {
      'pareto-named': { label: 'Pareto + named (Capped@150)', color: palette.paretoNamed, pointStyle: 'rectRot', radius: 9, borderWidth: 2, borderColor: palette.paretoNamed },
      'pareto':       { label: 'Pareto only',                 color: palette.pareto,      pointStyle: 'circle',  radius: 7, borderWidth: 2, borderColor: palette.pareto },
      'named':        { label: 'Named only',                  color: 'transparent',       pointStyle: 'rectRot', radius: 8, borderWidth: 2, borderColor: palette.named },
      'other':        { label: 'Neither',                     color: palette.other,       pointStyle: 'circle',  radius: 3, borderWidth: 0, borderColor: palette.other }
    };

    const bins = { 'pareto-named': [], 'pareto': [], 'named': [], 'other': [] };
    rows.forEach(function (r) {
      const cat = categorize(r);
      bins[cat].push(pointFor(r, cat));
    });

    const datasets = [];
    // Draw order: other first (so they sit under highlighted points), then
    // named, then pareto, then pareto-named on top.
    ['other', 'named', 'pareto', 'pareto-named'].forEach(function (cat) {
      if (bins[cat].length === 0) return;
      const g = groups[cat];
      datasets.push({
        label: g.label,
        data: bins[cat],
        backgroundColor: g.color,
        borderColor: g.borderColor,
        borderWidth: g.borderWidth,
        pointStyle: g.pointStyle,
        radius: g.radius,
        hoverRadius: g.radius + 3,
        showLine: false
      });
    });
    return datasets;
  }

  function renderScatter(rows) {
    const ctx = document.getElementById('pareto-scatter').getContext('2d');

    new Chart(ctx, {
      type: 'scatter',
      data: { datasets: buildDatasets(rows) },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 0 },
        plugins: {
          legend: {
            position: 'top',
            align: 'start',
            labels: { color: palette.text, usePointStyle: true, padding: 12, boxWidth: 10 }
          },
          tooltip: {
            backgroundColor: palette.surfaceAlt,
            titleColor: palette.text,
            bodyColor: palette.text,
            borderColor: palette.border,
            borderWidth: 1,
            padding: 10,
            callbacks: {
              title: function (items) {
                if (!items.length) return '';
                const r = items[0].raw.row;
                const cat = items[0].raw.cat;
                const named = NAMED_VARIANTS[r.config_id];
                let title = 'cfg ' + r.config_id;
                if (named) title += ' · ' + named.short;
                if (cat === 'pareto-named' || cat === 'pareto') title += ' · Pareto';
                return title;
              },
              label: function (item) {
                const r = item.raw.row;
                const lines = [];
                lines.push('Eligibility = ' + r.E + ' · Cap = ' + fmtCap(r.C) + ' · Carry-over = ' + r.S);
                lines.push('Years between conf. finals (med ± std): ' + fmt(r.max_years_between_conf_finals_median, 2) + ' ± ' + fmt(r.max_years_between_conf_finals_std, 2));
                lines.push('Manipulation gain: ' + fmt(r.manipulation_gain_pct_median, 4) + '%');
                lines.push('Rank 1-to-5 spread (median): ' + fmt(r.rank_one_to_five_spread_median, 3));
                return lines;
              }
            }
          }
        },
        scales: {
          x: {
            type: 'logarithmic',
            min: 1,
            max: 35,
            title: { display: true, text: 'Manipulation gain (%, lower is better, log scale)', color: palette.text },
            ticks: {
              color: palette.textDim,
              callback: function (v) {
                if (v === 1 || v === 2 || v === 5 || v === 10 || v === 20 || v === 30) return v + '%';
                return null;
              }
            },
            grid: { color: palette.grid }
          },
          y: {
            title: { display: true, text: 'Years between conference finals (median, lower is better)', color: palette.text },
            ticks: { color: palette.textDim },
            grid: { color: palette.grid }
          }
        }
      }
    });
  }

  // ---- Key-results table (9 rows) -----------------------------------------
  function renderKeyTable(allRows) {
    const byId = {};
    allRows.forEach(function (r) { byId[r.config_id] = r; });

    const tbody = document.getElementById('key-tbody');
    tbody.innerHTML = '';

    KEY_ROW_IDS.forEach(function (cid) {
      const r = byId[cid];
      if (!r) return;
      const cat = categorize(r);
      const tr = document.createElement('tr');
      if (cat === 'pareto-named') tr.classList.add('pareto-named-row');
      else if (cat === 'pareto')  tr.classList.add('pareto-row');

      const maxYrsCell = fmt(r.max_years_between_conf_finals_median, 2) +
        ' ± ' + fmt(r.max_years_between_conf_finals_std, 2);

      const cells = [
        { html: String(r.config_id), text: true },
        { html: badgeForCategory(cat, r.config_id), text: true },
        { html: String(r.E), text: true },
        { html: fmtCap(r.C), text: false },
        { html: String(r.S), text: true },
        { html: maxYrsCell, text: false },
        { html: fmt(r.manipulation_gain_pct_median, 4), text: false },
        { html: fmt(r.rank_one_to_five_spread_median, 3), text: false }
      ];

      cells.forEach(function (c) {
        const td = document.createElement('td');
        if (c.text) td.classList.add('text');
        td.innerHTML = c.html;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }

  // ---- Boot ----------------------------------------------------------------
  async function boot() {
    try {
      const csvText = await fetch('data/headline_summary.csv').then(function (r) { return r.text(); });
      const rows = parseCSV(csvText);
      renderScatter(rows);
      renderKeyTable(rows);
    } catch (err) {
      const main = document.getElementById('boot-error');
      if (main) {
        main.style.display = 'block';
        main.textContent = 'Failed to load sweep data: ' + (err && err.message ? err.message : String(err)) + '. Open the page via a local web server (python3 -m http.server); fetch() blocks file:// URLs in most browsers.';
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
