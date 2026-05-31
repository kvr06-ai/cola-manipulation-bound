/* COLA Pareto Frontier Viewer — interactive logic.
 * Loads pre-computed sweep CSV; renders Chart.js scatter + sortable/filterable table.
 * No build step, no framework. */

(function () {
  'use strict';

  // -- Constants from the headline run (pareto_summary.txt) ------------------
  const PARETO_IDS = [11, 19, 26, 31, 45];
  const NAMED_VARIANTS = {
    0:  { name: 'Status quo NBA lottery', short: 'Status quo' },
    1:  { name: 'Classic COLA',            short: 'Classic' },
    17: { name: 'Simple COLA',             short: 'Simple' },
    26: { name: 'Capped COLA @ MAX=150',   short: 'Capped@150' },
    32: { name: 'NBA 3-2-1 proposal',      short: '3-2-1' }
  };

  // Cached palette pulled from the project's design tokens — read once at
  // boot from getComputedStyle on :root so we never inline hex literals here.
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
      pareto:      g('--sweep-pareto')      || '#53a8b6',
      paretoNamed: g('--sweep-pareto-named') || g('--link'),
      named:       g('--sweep-named')       || g('--accent'),
      other:       g('--sweep-other')       || g('--text-secondary')
    };
  })();

  // ---- CSV parser (small, hand-rolled — no quoted-comma edge cases in our data)
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

  function categoryLabel(cat) {
    return {
      'pareto-named': 'Pareto + named',
      'pareto':       'Pareto only',
      'named':        'Named only',
      'other':        'Neither'
    }[cat];
  }

  function badgeForCategory(cat, id) {
    if (cat === 'pareto-named') {
      return '<span class="badge badge-pareto-named">PARETO · ' + NAMED_VARIANTS[id].short.toUpperCase() + '</span>';
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
    if (n === null || n === undefined || (typeof n === 'number' && isNaN(n))) return '—';
    if (typeof n !== 'number') return String(n);
    return n.toFixed(decimals === undefined ? 2 : decimals);
  }

  function fmtCap(c) { return c === null ? '∞' : String(c); }

  // ---- Chart construction --------------------------------------------------
  let chart = null;

  function buildDatasets(rows, view) {
    // view: 'all' | 'pareto' | 'named'
    function pointFor(row, cat) {
      return {
        x: row.manipulation_gain_pct_median,
        y: row.max_years_between_conf_finals_median,
        row: row,
        cat: cat
      };
    }

    const groups = {
      'pareto-named': { label: 'Pareto + named (Capped@150)',           color: palette.paretoNamed, pointStyle: 'rectRot', radius: 9, borderWidth: 2, borderColor: palette.paretoNamed },
      'pareto':       { label: 'Pareto only',                          color: palette.pareto,      pointStyle: 'circle',  radius: 7, borderWidth: 2, borderColor: palette.pareto      },
      'named':        { label: 'Named only (Status quo / Classic / Simple / 3-2-1)', color: 'transparent',  pointStyle: 'rectRot', radius: 8, borderWidth: 2, borderColor: palette.named },
      'other':        { label: 'Neither',                              color: palette.other,       pointStyle: 'circle',  radius: 3, borderWidth: 0, borderColor: palette.other       }
    };

    const bins = { 'pareto-named': [], 'pareto': [], 'named': [], 'other': [] };
    rows.forEach(function (r) {
      const cat = categorize(r);
      bins[cat].push(pointFor(r, cat));
    });

    const visible = {
      'pareto-named': true,
      'pareto':       view !== 'named',
      'named':        view !== 'pareto',
      'other':        view === 'all'
    };

    const datasets = [];
    ['other', 'named', 'pareto', 'pareto-named'].forEach(function (cat) {
      if (!visible[cat] || bins[cat].length === 0) return;
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

  function renderScatter(rows, view) {
    const ctx = document.getElementById('pareto-scatter').getContext('2d');
    const datasets = buildDatasets(rows, view);

    if (chart) chart.destroy();

    chart = new Chart(ctx, {
      type: 'scatter',
      data: { datasets: datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 250 },
        plugins: {
          legend: {
            position: 'top',
            align: 'start',
            labels: { color: palette.text, usePointStyle: true, padding: 14, boxWidth: 10 }
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
                lines.push('E = ' + r.E + '   C = ' + fmtCap(r.C) + '   S = ' + r.S);
                lines.push('max yrs between CF (med ± std): ' + fmt(r.max_years_between_conf_finals_median, 2) + ' ± ' + fmt(r.max_years_between_conf_finals_std, 2));
                lines.push('manipulation gain: ' + fmt(r.manipulation_gain_pct_median, 4) + '%');
                lines.push('rank-1-to-5 spread (med): ' + fmt(r.rank_one_to_five_spread_median, 3));
                if (r.capped === true) {
                  lines.push('per-series cost typical: ' + fmt(r.per_series_cost_typical_median, 1));
                } else {
                  lines.push('per-series cost typical: n/a (uncapped)');
                }
                lines.push('replicates: ' + r.n_replicates);
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
            title: { display: true, text: 'Manipulation gain Δp (%) — log scale · lower is better', color: palette.text },
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
            title: { display: true, text: 'max years between conference finals (median) · lower is better', color: palette.text },
            ticks: { color: palette.textDim },
            grid: { color: palette.grid }
          }
        }
      }
    });
  }

  // ---- Table rendering -----------------------------------------------------
  const COLS = [
    { key: 'config_id', label: 'cfg', type: 'num',  decimals: 0 },
    { key: 'E',         label: 'E',   type: 'text' },
    { key: 'C',         label: 'C',   type: 'num',  decimals: 0, fmt: fmtCap },
    { key: 'S',         label: 'S',   type: 'text' },
    { key: 'max_years_between_conf_finals_median', label: 'maxYrs CF (med)',  type: 'num', decimals: 2 },
    { key: 'max_years_between_conf_finals_std',    label: 'maxYrs CF (std)',  type: 'num', decimals: 2 },
    { key: 'manipulation_gain_pct_median',         label: 'manip %',          type: 'num', decimals: 4 },
    { key: 'per_series_cost_typical_median',       label: 'per-series cost',  type: 'num', decimals: 1 },
    { key: 'rank_one_to_five_spread_median',       label: 'rank-1-to-5 spread', type: 'num', decimals: 3 },
    { key: '_cat',                                 label: 'tag',              type: 'badge' }
  ];

  // Default sort: Pareto-first then ascending max_yrs_CF
  let sortKey = '_paretoFirst';
  let sortDir = 'asc';

  // Filter state
  const filterState = {
    E: { '14': true, '22': true, '16-tiered': true },
    C: { 'null': true, '100': true, '150': true, '200': true },
    S: { 'single-season': true, 'unbounded': true, 'bounded-30yr': true, 'reset-on-championship': true },
    cat: { 'pareto-named': true, 'pareto': true, 'named': true, 'other': true },
    q: ''
  };

  function appliedRows(allRows) {
    const q = filterState.q.trim().toLowerCase();
    return allRows.filter(function (r) {
      if (!filterState.E[String(r.E)]) return false;
      const cKey = r.C === null ? 'null' : String(r.C);
      if (!filterState.C[cKey]) return false;
      if (!filterState.S[r.S]) return false;
      if (!filterState.cat[categorize(r)]) return false;
      if (q) {
        const named = NAMED_VARIANTS[r.config_id];
        const hay = (named ? (named.name + ' ' + named.short) : '') + ' cfg' + r.config_id + ' ' + r.config_id;
        if (hay.toLowerCase().indexOf(q) < 0) return false;
      }
      return true;
    });
  }

  function sortRows(rows) {
    const dirMul = sortDir === 'asc' ? 1 : -1;
    const rs = rows.slice();
    if (sortKey === '_paretoFirst') {
      // Pareto rows first, then by max_yrs_CF ascending
      rs.sort(function (a, b) {
        const ap = PARETO_IDS.indexOf(a.config_id) >= 0 ? 0 : 1;
        const bp = PARETO_IDS.indexOf(b.config_id) >= 0 ? 0 : 1;
        if (ap !== bp) return ap - bp;
        return a.max_years_between_conf_finals_median - b.max_years_between_conf_finals_median;
      });
      return rs;
    }
    rs.sort(function (a, b) {
      let av = a[sortKey];
      let bv = b[sortKey];
      if (sortKey === '_cat') {
        const order = { 'pareto-named': 0, 'pareto': 1, 'named': 2, 'other': 3 };
        av = order[categorize(a)];
        bv = order[categorize(b)];
      }
      if (av === null || av === undefined) av = sortDir === 'asc' ? Infinity : -Infinity;
      if (bv === null || bv === undefined) bv = sortDir === 'asc' ? Infinity : -Infinity;
      if (typeof av === 'string' || typeof bv === 'string') {
        return String(av).localeCompare(String(bv)) * dirMul;
      }
      return (av - bv) * dirMul;
    });
    return rs;
  }

  function renderTable(allRows) {
    const filtered = appliedRows(allRows);
    const sorted = sortRows(filtered);

    const head = document.getElementById('sweep-thead');
    const body = document.getElementById('sweep-tbody');

    // Header (rebuild every render so we can attach sort arrows)
    head.innerHTML = '';
    const tr = document.createElement('tr');
    COLS.forEach(function (c) {
      const th = document.createElement('th');
      th.textContent = c.label;
      if (c.type === 'text' || c.type === 'badge') th.classList.add('text');
      let arrow = '';
      if (sortKey === c.key) {
        arrow = sortDir === 'asc' ? ' ▲' : ' ▼';
      }
      if (arrow) {
        const span = document.createElement('span');
        span.className = 'sort-arrow';
        span.textContent = arrow;
        th.appendChild(span);
      }
      th.addEventListener('click', function () {
        if (sortKey === c.key) {
          sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          sortKey = c.key;
          sortDir = (c.type === 'num') ? 'asc' : 'asc';
        }
        renderTable(allRows);
      });
      tr.appendChild(th);
    });
    head.appendChild(tr);

    // Body
    body.innerHTML = '';
    sorted.forEach(function (r) {
      const cat = categorize(r);
      const row = document.createElement('tr');
      if (cat === 'pareto-named') row.classList.add('pareto-named-row');
      else if (cat === 'pareto')   row.classList.add('pareto-row');

      COLS.forEach(function (c) {
        const td = document.createElement('td');
        if (c.type === 'text') td.classList.add('text');
        let val;
        if (c.key === '_cat') {
          td.classList.add('text');
          td.innerHTML = badgeForCategory(cat, r.config_id);
        } else if (c.key === 'C') {
          td.textContent = fmtCap(r.C);
        } else {
          val = r[c.key];
          if (c.type === 'num') {
            td.textContent = fmt(val, c.decimals);
          } else {
            td.textContent = val === null ? '—' : String(val);
          }
        }
        row.appendChild(td);
      });
      body.appendChild(row);
    });

    // Row count
    document.getElementById('row-count').textContent =
      'Showing ' + sorted.length + ' of ' + allRows.length + ' configurations.';
  }

  // ---- Filter wiring -------------------------------------------------------
  function wireFilters(allRows) {
    function wireGroup(name) {
      const inputs = document.querySelectorAll('input[data-filter="' + name + '"]');
      inputs.forEach(function (inp) {
        inp.checked = true;
        inp.addEventListener('change', function () {
          filterState[name][inp.value] = inp.checked;
          renderTable(allRows);
        });
      });
    }
    wireGroup('E');
    wireGroup('C');
    wireGroup('S');
    wireGroup('cat');

    const search = document.getElementById('search-box');
    search.addEventListener('input', function () {
      filterState.q = search.value;
      renderTable(allRows);
    });

    document.getElementById('filter-reset').addEventListener('click', function () {
      ['E', 'C', 'S', 'cat'].forEach(function (g) {
        Object.keys(filterState[g]).forEach(function (k) { filterState[g][k] = true; });
      });
      filterState.q = '';
      document.querySelectorAll('input[type="checkbox"][data-filter]').forEach(function (i) { i.checked = true; });
      search.value = '';
      renderTable(allRows);
    });
  }

  function wireViewToggle(allRows) {
    const buttons = document.querySelectorAll('#view-toggle button');
    buttons.forEach(function (b) {
      b.addEventListener('click', function () {
        buttons.forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        renderScatter(allRows, b.dataset.view);
      });
    });
  }

  // ---- Stability panel render ---------------------------------------------
  function renderStabilityPanel(stab) {
    const el = document.getElementById('stability-body');
    if (!el || !stab) return;

    const headlinePareto = stab._meta.headline_pareto_set.join(', ');
    const flagSummary = stab._meta.flag_summary;

    let html = '';
    html += '<p>Sensitivity pass at N=30 and N=100 on a ' + stab._meta.subset_size + '-config subset ';
    html += '(headline Pareto set [' + headlinePareto + '] ∪ named variants).</p>';
    html += '<p><span class="ok">No flags:</span> ' + flagSummary + '</p>';
    html += '<details style="margin-top:0.5rem;"><summary style="cursor:pointer; color: var(--text-secondary); font-size: 0.85rem;">Per-config median ± std across N ∈ {30, 50, 100}</summary>';
    html += '<table class="cap-table" style="margin-top:0.5rem; font-size:0.8rem;">';
    html += '<thead><tr><th>cfg</th><th>E</th><th>C</th><th>S</th><th>N=30 med±std</th><th>N=50 med±std</th><th>N=100 med±std</th></tr></thead><tbody>';
    stab.configs.forEach(function (c) {
      html += '<tr>';
      html += '<td>' + c.config_id + '</td>';
      html += '<td>' + c.E + '</td>';
      html += '<td>' + (c.C === null ? '∞' : c.C) + '</td>';
      html += '<td>' + c.S + '</td>';
      html += '<td>' + c.n30.med.toFixed(2)  + ' ± ' + c.n30.std.toFixed(2)  + '</td>';
      html += '<td>' + c.n50.med.toFixed(2)  + ' ± ' + c.n50.std.toFixed(2)  + '</td>';
      html += '<td>' + c.n100.med.toFixed(2) + ' ± ' + c.n100.std.toFixed(2) + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table></details>';

    el.innerHTML = html;
  }

  // ---- Boot ----------------------------------------------------------------
  async function boot() {
    try {
      const [csvText, stabText] = await Promise.all([
        fetch('data/headline_summary.csv').then(function (r) { return r.text(); }),
        fetch('data/stability.json').then(function (r) { return r.json(); })
      ]);

      const rows = parseCSV(csvText);

      // Render
      renderScatter(rows, 'all');
      renderTable(rows);
      wireFilters(rows);
      wireViewToggle(rows);
      renderStabilityPanel(stabText);
    } catch (err) {
      const main = document.getElementById('boot-error');
      if (main) {
        main.style.display = 'block';
        main.textContent = 'Failed to load sweep data: ' + (err && err.message ? err.message : String(err)) + '. Open the page via a local web server (python3 -m http.server) — fetch() blocks file:// URLs in most browsers.';
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
