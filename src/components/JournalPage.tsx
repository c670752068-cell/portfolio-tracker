import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  ALERT_CATEGORY_LABELS, ALERT_FILTER_ORDER, beijingText, easternText, fetchAlertLog,
  loadHiddenAlertIds, loadLastOpenedAt, loadReadAlertIds, saveHiddenAlertIds, saveLastOpenedAt,
  saveReadAlertIds, type AlertCategory, type AlertLogEntry,
} from '../alertLog';
import { alertAccent, alertHeadline, isLogOnly, partitionAlerts, pushStateIcon } from '../alertRowView';
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
  importantOnly?: boolean;
  onImportantOnlyChange?: (value: boolean) => void;
  liveStatus?: 'live' | 'disconnected' | 'paused';
  secondsSinceUpdate?: number | null;
  highlightedIds?: string[];
  showAllLevels?: boolean;
  onShowAllLevelsChange?: (value: boolean) => void;
  readAlertIds?: readonly string[];
  onMarkAlertRead?: (id: string) => void;
  lastOpenedAt?: string | null;
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
    importantOnly = false, onImportantOnlyChange, liveStatus = 'live', secondsSinceUpdate = null,
    highlightedIds = [], showAllLevels = false, onShowAllLevelsChange, readAlertIds = [],
    onMarkAlertRead, lastOpenedAt = null,
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
          importantOnly={importantOnly}
          onImportantOnlyChange={onImportantOnlyChange}
          liveStatus={liveStatus}
          secondsSinceUpdate={secondsSinceUpdate}
          highlightedIds={highlightedIds}
          showAllLevels={showAllLevels}
          onShowAllLevelsChange={onShowAllLevelsChange}
          readAlertIds={readAlertIds}
          onMarkAlertRead={onMarkAlertRead}
          lastOpenedAt={lastOpenedAt}
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
  importantOnly = false, onImportantOnlyChange, liveStatus = 'live', secondsSinceUpdate = null,
  highlightedIds = [], showAllLevels = false, onShowAllLevelsChange, readAlertIds = [],
  onMarkAlertRead, lastOpenedAt = null,
}: {
  alerts: AlertLogEntry[];
  hiddenAlertIds: string[];
  showHidden: boolean;
  categoryFilter: AlertCategory | 'all';
  onCategoryFilterChange: (filter: AlertCategory | 'all') => void;
  onHideAlert?: (id: string) => void;
  loading?: boolean;
  importantOnly?: boolean;
  onImportantOnlyChange?: (value: boolean) => void;
  liveStatus?: 'live' | 'disconnected' | 'paused';
  secondsSinceUpdate?: number | null;
  highlightedIds?: string[];
  showAllLevels?: boolean;
  onShowAllLevelsChange?: (value: boolean) => void;
  readAlertIds?: readonly string[];
  onMarkAlertRead?: (id: string) => void;
  lastOpenedAt?: string | null;
}) {
  const hidden = useMemo(() => new Set(hiddenAlertIds), [hiddenAlertIds]);
  const highlighted = useMemo(() => new Set(highlightedIds), [highlightedIds]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const rows = useMemo(() => [...alerts]
    .filter((item) => categoryFilter === 'all' || item.category === categoryFilter)
    .filter((item) => !importantOnly || item.indicators?.level === 1)
    .filter((item) => showHidden || !hidden.has(item.id))
    // 「仅记录」级别默认折叠，打开「显示全部」才出现
    .filter((item) => showAllLevels || !isLogOnly(item)), [alerts, categoryFilter, hidden, importantOnly, showAllLevels, showHidden]);
  const view = useMemo(
    () => partitionAlerts(rows, { readIds: readAlertIds, lastOpenedAt }),
    [rows, readAlertIds, lastOpenedAt],
  );
  const logOnlyCount = useMemo(() => alerts.filter(isLogOnly).length, [alerts]);

  const open = (entry: AlertLogEntry) => {
    setExpandedId((current) => (current === entry.id ? null : entry.id));
    onMarkAlertRead?.(entry.id);
  };
  const row = (entry: AlertLogEntry) => (
    <AlertRow
      key={entry.id}
      entry={entry}
      expanded={expandedId === entry.id}
      highlighted={highlighted.has(entry.id)}
      onToggle={() => open(entry)}
      onHide={onHideAlert && !hidden.has(entry.id) ? () => onHideAlert(entry.id) : undefined}
    />
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            aria-pressed={importantOnly}
            onClick={() => onImportantOnlyChange?.(!importantOnly)}
            className={`min-h-8 rounded-full px-2.5 text-[11px] font-medium ${importantOnly ? 'bg-loss text-white' : 'bg-neutral/25 text-ink-secondary'}`}
          >
            只看重要
          </button>
          <button
            type="button"
            aria-pressed={showAllLevels}
            onClick={() => onShowAllLevelsChange?.(!showAllLevels)}
            className={`min-h-8 rounded-full px-2.5 text-[11px] font-medium ${showAllLevels ? 'bg-buy text-white' : 'bg-neutral/25 text-ink-secondary'}`}
          >
            显示全部{logOnlyCount > 0 && !showAllLevels ? `（仅记录 ${logOnlyCount}）` : ''}
          </button>
          {view.unread > 0 && (
            <span data-alert-unread={view.unread} className="min-h-8 rounded-full bg-loss/15 px-2.5 py-1.5 text-[11px] font-semibold text-loss">
              未读 {view.unread}
            </span>
          )}
        </div>
        <span className="text-[10px] tabular-nums text-ink-muted" role="status">
          {liveStatus === 'disconnected'
            ? '● 已断开 · 正在重连'
            : liveStatus === 'paused'
              ? '● 已暂停 · 回到页面后继续'
              : `● 实时 · 上次更新 ${secondsSinceUpdate === null ? '刚刚' : `${secondsSinceUpdate} 秒前`}`}
        </span>
      </div>
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
        className="overflow-hidden rounded-2xl border border-white/25 bg-black p-3 font-mono text-[11px] leading-relaxed text-white/90 sm:p-4 sm:text-xs"
      >
        {rows.length === 0 ? (
          <p className="py-6 text-center text-white/50">{loading ? '读取中…' : '还没有记录。提醒触发时会自动写一行。'}</p>
        ) : (
          <>
            {view.pinned.length > 0 && (
              <ul className="mb-2 space-y-1 border-b border-white/15 pb-2" aria-label="置顶的重要提醒">
                {view.pinned.map(row)}
              </ul>
            )}
            <ul className="space-y-1">
              {view.newCount > 0 && (
                <li data-alert-divider="true" className="py-1 text-center text-[10px] text-white/45">—— 以下是新提醒 ——</li>
              )}
              {view.timeline.map((entry) => <Fragment key={entry.id}>{row(entry)}</Fragment>)}
            </ul>
          </>
        )}
      </div>
      <p className="text-[10px] text-ink-muted">
        点一条看完整说明。时间是北京时间，鼠标放上去（手机上长按）显示美东时间。「隐藏已读」只藏在这台设备上，服务器记录不会删。
      </p>
    </div>
  );
}

const ACCENT_CLASS = {
  buy: 'border-l-2 border-emerald-500 pl-1.5',
  sell: 'border-l-2 border-red-500 pl-1.5',
  risk: 'border-l-2 border-amber-500 pl-1.5',
} as const;

function AlertRow({
  entry, expanded, highlighted, onToggle, onHide,
}: {
  entry: AlertLogEntry;
  expanded: boolean;
  highlighted: boolean;
  onToggle: () => void;
  onHide?: () => void;
}) {
  const accent = alertAccent(entry);
  const push = pushStateIcon(entry);
  const clock = beijingText(entry.occurred_at);
  const voidedMark = `[已作废${entry.voided_reason ? ` · ${entry.voided_reason}` : ''}]`;
  return (
    <li
      data-alert-row={entry.id}
      data-alert-accent={accent ?? 'none'}
      className={`rounded ${accent ? ACCENT_CLASS[accent] : ''} ${highlighted ? 'alert-row-new bg-white/10' : ''}`}
    >
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex min-h-8 min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <time
            dateTime={entry.occurred_at}
            title={`北京 ${clock} · 美东 ${easternText(entry.occurred_at)}`}
            className="shrink-0 tabular-nums text-white/45"
          >
            {clock.slice(6, 11)}
          </time>
          <span aria-hidden="true" className="shrink-0">{entry.icon}</span>
          <span className={`min-w-0 flex-1 truncate ${entry.voided ? 'text-white/40 line-through' : ''}`}>
            {alertHeadline(entry)}
          </span>
          {entry.voided && <span className="shrink-0 text-white/45">{voidedMark}</span>}
          {entry.backfilled && <span className="shrink-0 text-white/45">[回填]</span>}
          <span className="shrink-0" title={push.label} aria-label={`推送状态：${push.label}`}>{push.icon}</span>
        </button>
        {onHide && (
          <button
            type="button"
            onClick={onHide}
            className="shrink-0 rounded bg-white/10 px-1.5 text-[10px] text-white/60"
            aria-label={`隐藏这条提醒：${alertHeadline(entry)}`}
          >
            ×
          </button>
        )}
      </div>
      {expanded && (
        <div className="mt-1 space-y-1 rounded bg-white/5 p-2 text-white/70">
          <p className="whitespace-pre-wrap break-words">{entry.text}</p>
          {entry.summary_items && entry.summary_items.length > 0 && (
            <ul className="space-y-0.5">
              {entry.summary_items.map((item, index) => (
                <li key={`${item.symbol ?? 'item'}-${index}`} className="break-words">· {item.text}</li>
              ))}
            </ul>
          )}
          <p className="text-white/45">
            北京 {clock} · 美东 {easternText(entry.occurred_at)} · {ALERT_CATEGORY_LABELS[entry.category]}
            {entry.symbol ? ` · ${entry.symbol}` : ''} · 推送 {push.label}
          </p>
          {entry.voided && <p className="text-white/45">{voidedMark}</p>}
        </div>
      )}
    </li>
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
  const [showAllLevels, setShowAllLevels] = useState(false);
  const [readAlertIds, setReadAlertIds] = useState<string[]>(() => loadReadAlertIds());
  // 进页面那一刻先把上次打开时间读出来，再写上这一次：比它新的就是「新提醒」。
  const [lastOpenedAt] = useState<string | null>(() => loadLastOpenedAt());
  const [categoryFilter, setCategoryFilter] = useState<AlertCategory | 'all'>('all');
  const [importantOnly, setImportantOnly] = useState(false);
  const [liveStatus, setLiveStatus] = useState<'live' | 'disconnected' | 'paused'>('live');
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [secondsSinceUpdate, setSecondsSinceUpdate] = useState<number | null>(null);
  const [highlightedIds, setHighlightedIds] = useState<string[]>([]);
  const knownAlertIds = useRef<Set<string>>(new Set());
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
        .then((next) => {
          knownAlertIds.current = new Set(next.alerts.map((item) => item.id));
          setAlerts(next.alerts);
          setUpdatedAt(Date.now());
        })
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

  // 日志页自动刷新：每 30 秒拉一次；标签页切到后台就暂停，切回来立刻补拉。
  useEffect(() => {
    let timer = 0;
    let stopped = false;
    const controller = new AbortController();

    const pull = async () => {
      if (stopped || document.visibilityState === 'hidden') return;
      try {
        const next = await fetchAlertLog(alertEndpoint, controller.signal);
        if (stopped) return;
        const fresh = next.alerts.filter((item) => !knownAlertIds.current.has(item.id)).map((item) => item.id);
        const firstLoad = knownAlertIds.current.size === 0;
        knownAlertIds.current = new Set(next.alerts.map((item) => item.id));
        setAlerts(next.alerts);
        setLiveStatus('live');
        setUpdatedAt(Date.now());
        if (!firstLoad && fresh.length) {
          setHighlightedIds(fresh);
          window.setTimeout(() => setHighlightedIds([]), 3000);
        }
      } catch (reason) {
        if (!stopped && !controller.signal.aborted) {
          setLiveStatus('disconnected');
          void reason;
        }
      }
    };

    const onVisible = () => {
      if (document.visibilityState === 'hidden') {
        setLiveStatus('paused');
        return;
      }
      void pull();
    };

    timer = window.setInterval(() => void pull(), 30_000);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [alertEndpoint]);

  // 「上次更新 xx 秒前」每 5 秒走一次字
  useEffect(() => {
    if (updatedAt === null) return undefined;
    const tick = () => setSecondsSinceUpdate(Math.max(0, Math.round((Date.now() - updatedAt) / 1000)));
    tick();
    const timer = window.setInterval(tick, 5_000);
    return () => window.clearInterval(timer);
  }, [updatedAt]);

  function apply(action: Promise<DecisionLog>) {
    action
      .then((next) => { revision.current = next.revision; setLog(next); setError(''); })
      .catch((reason: unknown) => {
        const conflict = reason as { log?: DecisionLog; message?: string };
        if (conflict?.log) { revision.current = conflict.log.revision; setLog(conflict.log); }
        setError(conflict?.message || '保存失败，请重试');
      });
  }

  useEffect(() => { saveLastOpenedAt(new Date().toISOString()); }, []);

  function markAlertRead(id: string) {
    setReadAlertIds((current) => {
      if (current.includes(id)) return current;
      const next = [...current, id];
      saveReadAlertIds(next);
      return next;
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
      importantOnly={importantOnly}
      onImportantOnlyChange={setImportantOnly}
      liveStatus={liveStatus}
      secondsSinceUpdate={secondsSinceUpdate}
      highlightedIds={highlightedIds}
      showAllLevels={showAllLevels}
      onShowAllLevelsChange={setShowAllLevels}
      readAlertIds={readAlertIds}
      onMarkAlertRead={markAlertRead}
      lastOpenedAt={lastOpenedAt}
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
