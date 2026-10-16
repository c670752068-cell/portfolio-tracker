import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ALERT_CATEGORY_LABELS, ALERT_FILTER_ORDER, beijingText, easternText, fetchAlertLog,
  loadHiddenAlertIds, saveHiddenAlertIds, type AlertCategory, type AlertLogEntry,
} from '../alertLog';
import {
  addCashFlow, addManualTrade, fetchDecisionLog, removeCashFlow, saveTradeNote,
  type DecisionLog, type DecisionPrediction, type DecisionTrade, type DecisionTrigger,
} from '../decisionLog';
import { DecisionLogSection, ReturnsSection } from './DecisionJournal';
import { fetchMaSlopeDashboard } from '../maSlopeQuery';
import { getServerAlertLogUrl, getServerDecisionLogUrl, getServerMaSlopeUrl } from '../runtimeConfig';
import type { ClosePoint } from '../twr';
import type { DisplayCurrency, ExchangeRates } from '../types';

export type JournalTab = 'alerts' | 'decisions' | 'returns';

const TABS: ReadonlyArray<{ key: JournalTab; label: string; icon: string }> = [
  { key: 'alerts', label: '提醒日志', icon: '📋' },
  { key: 'decisions', label: '决策日志', icon: '🔍' },
  { key: 'returns', label: '收益对比', icon: '📈' },
];

interface ViewProps {
  tab: JournalTab;
  onTabChange: (tab: JournalTab) => void;
  alerts: AlertLogEntry[];
  hiddenAlertIds: string[];
  onToggleHidden: () => void;
  showHidden: boolean;
  categoryFilter: AlertCategory | 'all';
  onCategoryFilterChange: (filter: AlertCategory | 'all') => void;
  log: DecisionLog | null;
  qqqSeries: ClosePoint[];
  sgovSeries: ClosePoint[];
  displayCurrency: DisplayCurrency;
  rates: ExchangeRates;
  error?: string;
  loading?: boolean;
  onHideAlert?: (id: string) => void;
  onSaveNote?: (trade: DecisionTrade, note: { trigger: DecisionTrigger[]; prediction: DecisionPrediction | null; note: string; price?: number }) => void;
  onAddTrade?: (draft: { trade_time: string; symbol: string; side: 'BUY' | 'SELL'; qty: number; price?: number }) => void;
  onAddFlow?: (draft: { date: string; amount: number; note: string }) => void;
  onRemoveFlow?: (id: string) => void;
}

export function JournalPageView(props: ViewProps) {
  const {
    tab, onTabChange, alerts, hiddenAlertIds, onToggleHidden, showHidden, categoryFilter,
    onCategoryFilterChange, log, qqqSeries, sgovSeries, displayCurrency, rates, error, loading,
    onHideAlert, onSaveNote, onAddTrade, onAddFlow, onRemoveFlow,
  } = props;

  return (
    <section className="space-y-3 md:space-y-5" aria-label="日志">
      <div className="rounded-2xl border border-neutral/40 bg-surface-raised p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-bold sm:text-lg">
            日志 <span className="text-ink-muted">— 提醒、决策与收益</span>
          </h2>
          <button
            type="button"
            onClick={onToggleHidden}
            aria-pressed={!showHidden}
            className="shrink-0 rounded-lg bg-neutral/30 px-3 py-2 text-xs font-semibold text-ink-secondary"
          >
            {showHidden ? '隐藏已读' : `显示全部（已隐藏 ${hiddenAlertIds.length} 条）`}
          </button>
        </div>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              data-journal-tab={item.key}
              aria-pressed={tab === item.key}
              onClick={() => onTabChange(item.key)}
              className={`min-h-9 rounded-lg px-3 text-xs font-semibold transition-colors sm:text-sm ${
                tab === item.key ? 'bg-gain text-white shadow-sm' : 'bg-neutral/25 text-ink-secondary'
              }`}
            >
              <span aria-hidden="true">{item.icon}</span> {item.label}
            </button>
          ))}
        </div>
        {error && <p className="mt-2 text-center text-xs text-loss">{error}</p>}
      </div>

      {tab === 'alerts' && (
        <AlertLogPanel
          alerts={alerts}
          hiddenAlertIds={hiddenAlertIds}
          showHidden={showHidden}
          categoryFilter={categoryFilter}
          onCategoryFilterChange={onCategoryFilterChange}
          onHideAlert={onHideAlert}
          loading={loading}
        />
      )}
      {tab === 'decisions' && (
        <DecisionLogSection
          log={log}
          displayCurrency={displayCurrency}
          rates={rates}
          loading={loading}
          onSaveNote={onSaveNote}
          onAddTrade={onAddTrade}
        />
      )}
      {tab === 'returns' && (
        <ReturnsSection
          log={log}
          qqqSeries={qqqSeries}
          sgovSeries={sgovSeries}
          displayCurrency={displayCurrency}
          rates={rates}
          onAddFlow={onAddFlow}
          onRemoveFlow={onRemoveFlow}
        />
      )}
    </section>
  );
}

function AlertLogPanel({
  alerts, hiddenAlertIds, showHidden, categoryFilter, onCategoryFilterChange, onHideAlert, loading,
}: {
  alerts: AlertLogEntry[];
  hiddenAlertIds: string[];
  showHidden: boolean;
  categoryFilter: AlertCategory | 'all';
  onCategoryFilterChange: (filter: AlertCategory | 'all') => void;
  onHideAlert?: (id: string) => void;
  loading?: boolean;
}) {
  const hidden = useMemo(() => new Set(hiddenAlertIds), [hiddenAlertIds]);
  const rows = useMemo(() => [...alerts]
    .filter((item) => categoryFilter === 'all' || item.category === categoryFilter)
    .filter((item) => showHidden || !hidden.has(item.id))
    // 最新的在最上面
    .sort((left, right) => right.occurred_at.localeCompare(left.occurred_at)), [alerts, categoryFilter, hidden, showHidden]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {ALERT_FILTER_ORDER.map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={categoryFilter === key}
            onClick={() => onCategoryFilterChange(key)}
            className={`min-h-8 rounded-full px-2.5 text-[11px] font-medium ${
              categoryFilter === key ? 'bg-buy text-white' : 'bg-neutral/25 text-ink-secondary'
            }`}
          >
            {ALERT_CATEGORY_LABELS[key]}
          </button>
        ))}
      </div>
      {/* 这个面板不跟随浅色主题，始终深色，和参考截图一致 */}
      <div
        data-alert-log-panel="true"
        className="overflow-x-auto rounded-2xl border border-white/25 bg-black p-3 font-mono text-[11px] leading-relaxed text-white/90 sm:p-4 sm:text-xs"
      >
        {rows.length === 0 ? (
          <p className="py-6 text-center text-white/50">{loading ? '读取中…' : '还没有记录。提醒触发时会自动写一行。'}</p>
        ) : (
          <ul className="space-y-1">
            {rows.map((item) => (
              <li key={item.id} className="flex items-start gap-2 whitespace-pre-wrap break-words">
                <time
                  dateTime={item.occurred_at}
                  title={`美东 ${easternText(item.occurred_at)}`}
                  className="shrink-0 text-white/45"
                >
                  {beijingText(item.occurred_at)}
                </time>
                <span aria-hidden="true" className="shrink-0">{item.icon}</span>
                <span className="min-w-0 flex-1">
                  {item.text}
                  {item.backfilled && <span className="ml-1 text-white/45">[回填]</span>}
                  {!item.backfilled && item.pushed && <span className="ml-1 text-white/45">[已推送]</span>}
                  {!item.backfilled && !item.pushed && <span className="ml-1 text-white/45">[未推送]</span>}
                  {item.session === 'intraday' && <span className="ml-1 text-white/45">[盘中]</span>}
                </span>
                {onHideAlert && !hidden.has(item.id) && (
                  <button
                    type="button"
                    onClick={() => onHideAlert(item.id)}
                    className="shrink-0 rounded bg-white/10 px-1.5 text-[10px] text-white/60"
                    aria-label={`隐藏这条提醒：${item.text}`}
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-[10px] text-ink-muted">
        时间是北京时间，鼠标放上去（手机上长按）显示美东时间。「隐藏已读」只藏在这台设备上，服务器记录不会删。
      </p>
    </div>
  );
}

export function JournalPage({ displayCurrency, rates }: { displayCurrency: DisplayCurrency; rates: ExchangeRates }) {
  const decisionEndpoint = getServerDecisionLogUrl() || '/api/portfolio/decision-log';
  const alertEndpoint = getServerAlertLogUrl() || '/api/portfolio/alert-log';
  const [tab, setTab] = useState<JournalTab>('alerts');
  const [log, setLog] = useState<DecisionLog | null>(null);
  const [alerts, setAlerts] = useState<AlertLogEntry[]>([]);
  const [hiddenAlertIds, setHiddenAlertIds] = useState<string[]>(() => loadHiddenAlertIds());
  const [showHidden, setShowHidden] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState<AlertCategory | 'all'>('all');
  const [series, setSeries] = useState<{ qqq: ClosePoint[]; sgov: ClosePoint[] }>({ qqq: [], sgov: [] });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const revision = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      fetchDecisionLog(decisionEndpoint, controller.signal)
        .then((next) => { revision.current = next.revision; setLog(next); })
        .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '决策日志读取失败'); }),
      fetchAlertLog(alertEndpoint, controller.signal)
        .then((next) => setAlerts(next.alerts))
        .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '提醒日志读取失败'); }),
    ]).finally(() => { if (!controller.signal.aborted) setLoading(false); });

    const slope = getServerMaSlopeUrl() || '/api/portfolio/ma-slope';
    void Promise.all([
      fetchMaSlopeDashboard(slope, 'QQQ', { range: '5y', slopeWindow: 8, signal: controller.signal }).catch(() => null),
      fetchMaSlopeDashboard(slope, 'SGOV', { range: '5y', slopeWindow: 8, signal: controller.signal }).catch(() => null),
    ]).then(([qqq, sgov]) => {
      if (controller.signal.aborted) return;
      const closes = (result: typeof qqq) => (result?.dashboard.series ?? [])
        .filter((point) => !point.is_partial && typeof point.close === 'number')
        .map((point) => ({ date: point.date, close: point.close }));
      setSeries({ qqq: closes(qqq), sgov: closes(sgov) });
    });
    return () => controller.abort();
  }, [decisionEndpoint, alertEndpoint]);

  function apply(action: Promise<DecisionLog>) {
    action
      .then((next) => { revision.current = next.revision; setLog(next); setError(''); })
      .catch((reason: unknown) => {
        const conflict = reason as { log?: DecisionLog; message?: string };
        if (conflict?.log) { revision.current = conflict.log.revision; setLog(conflict.log); }
        setError(conflict?.message || '保存失败，请重试');
      });
  }

  function hideAlert(id: string) {
    setHiddenAlertIds((current) => {
      const next = current.includes(id) ? current : [...current, id];
      saveHiddenAlertIds(next);
      return next;
    });
  }

  return (
    <JournalPageView
      tab={tab}
      onTabChange={setTab}
      alerts={alerts}
      hiddenAlertIds={hiddenAlertIds}
      onToggleHidden={() => setShowHidden((value) => !value)}
      showHidden={showHidden}
      categoryFilter={categoryFilter}
      onCategoryFilterChange={setCategoryFilter}
      log={log}
      qqqSeries={series.qqq}
      sgovSeries={series.sgov}
      displayCurrency={displayCurrency}
      rates={rates}
      error={error}
      loading={loading}
      onHideAlert={hideAlert}
      onSaveNote={(trade, note) => apply(saveTradeNote(decisionEndpoint, trade.id, note, revision.current))}
      onAddTrade={(draft) => apply(addManualTrade(decisionEndpoint, draft, revision.current))}
      onAddFlow={(draft) => apply(addCashFlow(decisionEndpoint, draft, revision.current))}
      onRemoveFlow={(id) => apply(removeCashFlow(decisionEndpoint, id, revision.current))}
    />
  );
}
