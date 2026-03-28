/**
 * Shared navigation bar — injected at runtime into every page.
 * No build step required. Each page includes <div id="site-nav"></div>
 * and loads this script.
 */

(function () {
  const pages = [
    { href: 'index.html', label: 'COLA Explorer' },
    { href: 'trade-simulator.html', label: 'Trade Simulator' },
  ];

  function renderNav() {
    const el = document.getElementById('site-nav');
    if (!el) return;

    // Determine current page from pathname
    const path = window.location.pathname;
    const current = path.split('/').pop() || 'index.html';

    const links = pages
      .map(function (p) {
        const active = current === p.href ? ' class="nav-active"' : '';
        return '<a href="' + p.href + '"' + active + '>' + p.label + '</a>';
      })
      .join('');

    el.innerHTML =
      '<nav class="site-nav">' +
      '<a href="index.html" class="nav-brand">COLA</a>' +
      '<div class="nav-links">' + links + '</div>' +
      '</nav>';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderNav);
  } else {
    renderNav();
  }
})();
