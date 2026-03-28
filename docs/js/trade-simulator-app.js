/**
 * Trade Simulator — Main application controller.
 * Loads NBA data + trade metadata, computes all four trade rules,
 * and wires UI controls.
 */

var nbaData = null;
var tradeMetadata = null;
var tradeRuleResults = null;
var tradeLookup = null;

var currentTeam = 'BKN';
var currentYear = 2017;

function getActiveRules() {
  var boxes = document.querySelectorAll('input[name="trade-rule"]');
  var active = [];
  for (var i = 0; i < boxes.length; i++) {
    if (boxes[i].checked) active.push(boxes[i].value);
  }
  return active.length > 0 ? active : ['receiving_team'];
}

function getYears() {
  return nbaData.seasons.map(function (s) { return s.year; });
}

// ── Render functions ──

function renderTrajectory() {
  updateTrajectoryChart(tradeRuleResults, currentTeam, getActiveRules(), getYears());
}

function renderSnapshotTable() {
  var tbody = document.querySelector('#snapshot-table tbody');
  if (!tbody) return;

  var rules = ['original_owner', 'receiving_team', 'split', 'exclude'];
  var rows = [];

  // Get all teams for this year, sorted by receiving_team index DESC
  var refResult = tradeRuleResults.receiving_team[currentYear];
  if (!refResult) { tbody.innerHTML = ''; return; }

  var lotteryTeams = refResult.draftOrder || [];

  // Build trade lookup for this year
  var yearTrades = {};
  if (tradeMetadata && tradeMetadata.trades) {
    for (var i = 0; i < tradeMetadata.trades.length; i++) {
      var tr = tradeMetadata.trades[i];
      if (tr.year === currentYear) {
        yearTrades[tr.receivedBy] = tr;
        // Also check by pick number for cases where receivedBy doesn't match
        yearTrades['pick-' + tr.pick] = tr;
      }
    }
  }

  for (var i = 0; i < lotteryTeams.length; i++) {
    var team = lotteryTeams[i];
    var tradeInfo = yearTrades[team.id] || null;

    // Also check by pick number
    if (!tradeInfo && team.draftPick) {
      tradeInfo = yearTrades['pick-' + team.draftPick] || null;
    }

    var isTraded = !!tradeInfo;

    var row = '<tr' + (isTraded ? ' class="traded-pick"' : '') + '>';
    row += '<td>' + team.id + '</td>';
    row += '<td>' + (team.draftPick || '—') + '</td>';
    row += '<td>' + (isTraded ? tradeInfo.originalOwner + '→' + (tradeInfo.receivedBy || team.id) : '') + '</td>';

    for (var ri = 0; ri < rules.length; ri++) {
      var ruleResult = tradeRuleResults[rules[ri]][currentYear];
      var teamState = ruleResult ? ruleResult.teams[team.id] : null;
      if (teamState) {
        row += '<td>' + Math.round(teamState.index) + '</td>';
        row += '<td>' + (teamState.colaPosition || '—') + '</td>';
      } else {
        row += '<td>—</td><td>—</td>';
      }
    }

    row += '</tr>';
    rows.push(row);
  }

  tbody.innerHTML = rows.join('');
}

function renderCaseStudies() {
  var container = document.getElementById('case-studies');
  if (!container || !tradeMetadata.caseStudies) return;

  var html = '';
  for (var i = 0; i < tradeMetadata.caseStudies.length; i++) {
    var cs = tradeMetadata.caseStudies[i];
    html += '<div class="case-study-card">';
    html += '<h3>' + cs.title + '</h3>';
    html += '<p>' + cs.description + '</p>';
    html += '<button class="jump-btn" data-year="' + cs.year + '" data-team="' + (cs.receivedBy || cs.originalOwner) + '">';
    html += 'Jump to ' + cs.year + ' →';
    html += '</button>';
    html += '</div>';
  }
  container.innerHTML = html;

  // Wire jump buttons
  var btns = container.querySelectorAll('.jump-btn');
  for (var i = 0; i < btns.length; i++) {
    btns[i].addEventListener('click', function () {
      var year = parseInt(this.dataset.year);
      var team = this.dataset.team;

      // Update year slider
      var slider = document.getElementById('year-slider');
      slider.value = year;
      currentYear = year;
      document.getElementById('year-display').textContent = year;

      // Update team select
      var select = document.getElementById('team-select');
      if (select) {
        select.value = team;
        currentTeam = team;
      }

      render();

      // Scroll to trajectory chart
      document.getElementById('trajectory-chart').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }
}

function render() {
  renderTrajectory();
  renderSnapshotTable();
}

// ── Initialization ──

async function init() {
  // Load both data files in parallel
  var responses = await Promise.all([
    fetch('data/nba-data.json'),
    fetch('data/trade-metadata.json'),
  ]);

  nbaData = await responses[0].json();
  tradeMetadata = await responses[1].json();
  tradeLookup = buildTradeLookup(tradeMetadata);

  // Update stats in intro
  var countEl = document.getElementById('trade-count');
  var colaCountEl = document.getElementById('cola-trade-count');
  if (countEl) countEl.textContent = tradeMetadata.trades.length;
  if (colaCountEl) {
    var colaCount = tradeMetadata.trades.filter(function (t) { return t.pick <= 4; }).length;
    colaCountEl.textContent = colaCount;
  }

  // Compute all four trade rules
  tradeRuleResults = computeAllTradeRules(nbaData.seasons, tradeMetadata);

  // Populate team dropdown
  var teamSelect = document.getElementById('team-select');
  var teamIds = Object.keys(nbaData.teams).sort();
  for (var i = 0; i < teamIds.length; i++) {
    var opt = document.createElement('option');
    opt.value = teamIds[i];
    opt.textContent = teamIds[i] + ' — ' + nbaData.teams[teamIds[i]].name;
    if (teamIds[i] === currentTeam) opt.selected = true;
    teamSelect.appendChild(opt);
  }

  // Year slider
  var slider = document.getElementById('year-slider');
  var years = getYears();
  slider.min = Math.min.apply(null, years);
  slider.max = Math.max.apply(null, years);
  slider.value = currentYear;
  document.getElementById('year-display').textContent = currentYear;

  // Create chart
  createTrajectoryChart('trajectory-chart');

  // Wire controls
  teamSelect.addEventListener('change', function () {
    currentTeam = teamSelect.value;
    render();
  });

  slider.addEventListener('input', function () {
    currentYear = Number(slider.value);
    document.getElementById('year-display').textContent = currentYear;
    render();
  });

  // Wire option card checkboxes
  var checkboxes = document.querySelectorAll('input[name="trade-rule"]');
  for (var i = 0; i < checkboxes.length; i++) {
    checkboxes[i].addEventListener('change', function () {
      render();
    });
  }

  // Render case studies
  renderCaseStudies();

  // Initial render
  render();
}

init();
