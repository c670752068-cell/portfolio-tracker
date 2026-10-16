// Run with Node >= 22 (native TS stripping). Public technical data only; no account data.
import fs from 'node:fs/promises';
import path from 'node:path';
import { smaOverheat, smaDownside } from '../src/smaOverheat.ts';

const [directory, ...symbols] = process.argv.slice(2);
if (!directory || !symbols.length) throw new Error('Usage: node scripts/report-sma-overheat.mjs OUTPUT_DIR SYMBOL ...');
await fs.mkdir(directory, { recursive: true });
const results = {};
let index = 0;
async function worker() {
  while (index < symbols.length) {
    const symbol = symbols[index++];
    try {
      const filename = path.join(directory, `${symbol}.json`);
      let data;
      try { data = JSON.parse(await fs.readFile(filename, 'utf8')); } catch {
        const url = new URL('https://www.myopenid.top/api/portfolio/ma-slope');
        url.search = new URLSearchParams({ symbol, view: 'dashboard', range: '5y', slope_window: '8' });
        const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        data = await response.json();
        await fs.writeFile(filename, JSON.stringify(data));
      }
      if (data.symbol !== symbol || !data.dashboard) throw new Error('Mismatched symbol or missing dashboard');
      const result = smaOverheat(data.dashboard);
      const downside = smaDownside(data.dashboard);
      results[symbol] = { source: data.data_source, currentSlope20: data.dashboard.series.findLast(point => !point.is_partial)?.slope20, ...result, downside };
      console.log(`${symbol}: up mean=${result.meanPeak?.toFixed(3) ?? '—'} median=${result.medianPeak?.toFixed(3) ?? '—'} events=${result.pullbackCount}/${result.peakCount}; down mean=${downside.meanTrough?.toFixed(3) ?? '—'} median=${downside.medianTrough?.toFixed(3) ?? '—'} events=${downside.reboundCount}/${downside.troughCount}; bars=${result.barCount}`);
    } catch (error) { results[symbol] = { error: error.message }; console.log(`${symbol}: ${error.message}`); }
  }
}
await Promise.all([worker(), worker()]);
await fs.writeFile(path.join(directory, 'overheat-report.json'), JSON.stringify(results, null, 2));
