import type { OptionBudgetLine } from '../allocation';
import { formatDisplayMoney } from '../displayCurrency';
import { CNN_UNLOCK, VIX_UNLOCK, type PositionGuard } from '../positionGuard';
import type { DisplayCurrency, ExchangeRates } from '../types';

/** 距前高下面那一条：当前仓位对照上限和三个条件，超了或拿了不该拿的 TQQQ 就标红。 */
export function PositionGuardBar({ guard, displayCurrency, rates }: {
  guard: PositionGuard;
  displayCurrency: DisplayCurrency;
  rates: ExchangeRates;
}) {
  const money = (value: number) => formatDisplayMoney(value, displayCurrency, rates);
  const warn = guard.overPct !== null || guard.tqqqBlocked || guard.options.total.overLimit || guard.options.tqqq.overLimit;
  // 没超写还剩多少美金，超了写超出多少
  const room = (line: OptionBudgetLine) => (line.overLimit ? `超出 ${money(line.overByValue)}` : `还剩 ${money(line.remainingValue)}`);
  // 现值比成本低时写出来：额度按成本占着，不是没看到亏损
  const costNote = (line: OptionBudgetLine) => (line.marketValue < line.costValue - 0.005 ? `（现值 ${money(line.marketValue)}）` : '');
  const { panicOpen, cnn, vix } = guard.signals;
  const gates = [
    { key: 'panic', label: '恐慌性下跌', value: panicOpen === null ? '暂无' : panicOpen ? '有' : '没有', met: panicOpen === true },
    { key: 'cnn', label: `CNN ≤ ${CNN_UNLOCK}`, value: cnn === null ? '暂无' : cnn.toFixed(1), met: cnn !== null && cnn <= CNN_UNLOCK },
    { key: 'vix', label: `VIX ≥ ${VIX_UNLOCK}`, value: vix === null ? '暂无' : vix.toFixed(2), met: vix !== null && vix >= VIX_UNLOCK },
  ];
  return (
    <div
      data-position-guard="true"
      className={`space-y-1 rounded-xl border px-2.5 py-1.5 text-[11px] tabular-nums ${warn ? 'border-loss/40 bg-loss/10' : 'border-neutral/35 bg-surface-overlay'}`}
      title="仓位按 1 倍市值算：现金和现金类 ETF（SGOV 等）算空仓，杠杆 ETF 不折算。仅作提醒，不自动交易。"
    >
      <p className="flex flex-wrap items-baseline justify-between gap-x-2">
        <span>当前仓位 <strong className={`text-sm ${guard.overPct !== null ? 'text-loss' : 'text-ink-primary'}`}>{guard.positionPct.toFixed(1)}%</strong></span>
        <span className="text-ink-secondary">{guard.capPct === null ? '上限 暂无' : `上限 ${guard.capPct}%`}</span>
      </p>
      {guard.overPct !== null && guard.overValue !== null && (
        <p className="text-loss">{`超了 ${guard.overPct.toFixed(1)}%，约 ${money(guard.overValue)}`}</p>
      )}
      {guard.overPct !== null
        ? <p className="font-semibold text-loss">买多了：别再买，反弹先减仓，下次恐慌性下跌再加</p>
        : panicOpen === false && <p className="font-semibold text-ink-secondary">没有恐慌性下跌，不加仓</p>}
      <div className="grid grid-cols-3 gap-1">
        {gates.map((gate) => (
          <p key={gate.key} data-cap-gate={gate.key} data-met={gate.met} className="min-w-0 rounded-lg bg-surface-base/40 px-1.5 py-1">
            <span className="block truncate text-[10px] text-ink-muted">{gate.label}</span>
            <strong className={gate.met ? 'text-gain' : 'text-ink-secondary'}>{gate.value} {gate.met ? '✓' : '✗'}</strong>
          </p>
        ))}
      </div>
      <p className={guard.options.total.overLimit ? 'text-loss' : 'text-ink-secondary'} title="期权按买入时花的钱算（涨了按现值）：跌了不会空出额度。">
        期权已用 {money(guard.options.total.value)}（{(guard.options.total.weight * 100).toFixed(1)}%，按买入成本）· 上限 {guard.options.total.cap * 100}% · {room(guard.options.total)}
      </p>
      <p className={guard.options.tqqq.overLimit ? 'text-loss' : 'text-ink-muted'}>
        {`TQQQ 期权已用 ${money(guard.options.tqqq.value)}${costNote(guard.options.tqqq) || ' '}· 上限 ${guard.options.tqqq.cap * 100}% · ${room(guard.options.tqqq)}`}
      </p>
      {guard.tqqqBlocked && (
        <p className="text-loss">
          未到 SPY -5% 不允许持有 TQQQ：正股 {money(guard.tqqqShares)} · 期权 {money(guard.tqqqOptions)}
        </p>
      )}
    </div>
  );
}
