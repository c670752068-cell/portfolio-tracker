// GitHub Pages is now only a stable bookmark. The VPS is the canonical app so
// every device reads the same server-side portfolio snapshot.
if (window.location.hostname === 'c670752068-cell.github.io') {
  window.location.replace('http://67.215.255.196:8788/');
} else {
  window.__PORTFOLIO_TRACKER_RUNTIME__ = window.__PORTFOLIO_TRACKER_RUNTIME__ || {};
}
