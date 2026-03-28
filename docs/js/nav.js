/**
 * Shared navigation bar — injected at runtime into every page.
 * Styles are inlined to avoid specificity conflicts with page CSS.
 */

(function () {
  var pages = [
    { href: 'index.html', label: 'Explorer' },
    { href: 'trade-simulator.html', label: 'Trade Simulator' },
  ];

  function renderNav() {
    var el = document.getElementById('site-nav');
    if (!el) return;

    var path = window.location.pathname;
    var current = path.split('/').pop() || 'index.html';

    // Inject scoped styles + markup
    el.innerHTML =
      '<style>' +
      '#site-nav { position: sticky; top: 0; z-index: 100; }' +
      '#site-nav nav {' +
      '  display: flex; align-items: center; justify-content: space-between;' +
      '  padding: 0.6rem 1.5rem;' +
      '  background: rgba(22, 33, 62, 0.92);' +
      '  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);' +
      '  border-bottom: 1px solid #2a2a4a;' +
      '}' +
      '#site-nav .nav-brand {' +
      '  font-weight: 800; font-size: 1rem; letter-spacing: 0.08em;' +
      '  color: #e94560; text-decoration: none;' +
      '}' +
      '#site-nav .nav-brand:hover { opacity: 0.85; }' +
      '#site-nav .nav-links {' +
      '  display: flex; gap: 0.25rem;' +
      '}' +
      '#site-nav .nav-links a {' +
      '  color: #a0a0b0; text-decoration: none;' +
      '  padding: 0.35rem 0.75rem; font-size: 0.85rem; font-weight: 500;' +
      '  border-radius: 6px;' +
      '  transition: background 0.2s ease, color 0.2s ease;' +
      '}' +
      '#site-nav .nav-links a:visited { color: #a0a0b0; }' +
      '#site-nav .nav-links a:hover {' +
      '  background: rgba(15, 52, 96, 0.7); color: #e0e0e0;' +
      '}' +
      '#site-nav .nav-links a.nav-active {' +
      '  color: #e94560; background: rgba(233, 69, 96, 0.1);' +
      '}' +
      '#site-nav .nav-links a.nav-active:visited { color: #e94560; }' +
      '@media (max-width: 600px) {' +
      '  #site-nav nav { padding: 0.5rem 1rem; }' +
      '  #site-nav .nav-links a { font-size: 0.8rem; padding: 0.3rem 0.5rem; }' +
      '}' +
      '</style>' +
      '<nav>' +
      '<a href="index.html" class="nav-brand">COLA</a>' +
      '<div class="nav-links">' +
      pages.map(function (p) {
        var cls = current === p.href ? ' class="nav-active"' : '';
        return '<a href="' + p.href + '"' + cls + '>' + p.label + '</a>';
      }).join('') +
      '</div>' +
      '</nav>';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderNav);
  } else {
    renderNav();
  }
})();
