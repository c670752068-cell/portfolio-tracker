// The US VPS hosts both the website and API gateway on one private port.
// Relative routing lets a future domain/HTTPS migration keep the same bundle.
window.__PORTFOLIO_TRACKER_RUNTIME__ = {
  apiBaseUrl: window.location.origin,
  deploymentLabel: '美国 VPS 中转',
};
