import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ALERT_CATEGORY_LABELS, ALERT_FILTER_ORDER, beijingText, easternText, fetchAlertLog,
  loadHiddenAlertIds, loadLastOpenedAt, loadReadAlertIds, saveHiddenAlertIds, saveLastOpenedAt,
  saveReadAlertIds, type AlertCategory, type AlertLogEntry,
} from '../alertLog';
import {
  alertAccent, alertHeadline, dayLabel, groupTimeline, isLogOnly, partitionAlerts, pushStateIcon,
  suggestedSide, type TimelineItem,
} from '../alertRowView';
import { MaSlopeExplorer } from './MaSlopeExplorer';
import {
  fetchAlertOutcomes, horizonText, outcomeSummaryRows, winRateText,
  type AlertOutcome, type AlertOutcomesPayload,
} from '../alertOutcomes';
import {
  addCashFlow, addManualTrade, fetchDecisionLog, removeCashFlow, saveTradeNote,
  type DecisionLog, type DecisionPrediction, type DecisionTrade, type DecisionTradeNote,
  type DecisionTrigger,
} from '../decisionLog';
import { DecisionLogSection, ReturnsSection } from './DecisionJournal';
import { fetchMaSlopeDashboard } from '../maSlopeQuery';
import {
  getServerAlertLogUrl, getServerAlertOutcomesUrl, getServerDecisionLogUrl, getServerMaSlopeUrl,
  getServerQuoteProxyUrl,
} from '../runtimeConfig';
import { MarketStatusBar } from './MarketStatusBar';
import {
  cnnFromAlerts, cnnScoreFrom, importantTodayCount, parseStatusQuotes, statusCards,
  type StatusCard, type StatusQuotes,
} from '../marketStatusBar';
import type { ClosePoint } from '../twr';
import type { DisplayCurrency, ExchangeRates, QuantAnalysisSnapshot } from '../types';

// 状态条每 60 秒更新一次；超过这么久没拿到新数据就标「数据延迟」。
const STATUS_REFRESH_MS = 60_000;
const STATUS_STALE_MS = 3 * 60_000;

export type JournalTab = 'alerts' | 'decisions' | 'returns' | 'outcomes';

const TABS: ReadonlyArray<{ key: JournalTab; label: string; icon: string }> = [
  { key: 'alerts', label: '提醒日志', icon: '📋' },
  { key: 'decisions', label: '决策日志', icon: '🔍' },
  { key: 'returns', label: '收益对比', icon: '📈' },
  { key: 'outcomes', label: '提醒效果', icon: '📊' },
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
  statusCards?: readonly StatusCard[];
  statusDataTime?: string | null;
  statusStale?: boolean;
  snapshot?: QuantAnalysisSnapshot | null;
  outcomes?: AlertOutcomesPayload | null;
  detailSymbol?: string | null;
  onOpenDetail?: (symbol: string) => void;
  onCloseDetail?: () => void;
  onOrderDraft?: (entry: AlertLogEntry) => void;
  draftNotice?: string;
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
    onMarkAlertRead, lastOpenedAt = null, statusCards: cards = [], statusDataTime = null,
    statusStale = false, snapshot = null, outcomes = null, detailSymbol = null, onOpenDetail,
    onCloseDetail, onOrderDraft, draftNotice = '',
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
        <div data-journal-tabs="true" className="mt-3 flex gap-2 overflow-x-auto pb-0.5 sm:justify-center">
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              data-journal-tab={item.key}
              aria-pressed={tab === item.key}
              onClick={() => onTabChange(item.key)}
              className={`min-h-9 shrink-0 whitespace-nowrap rounded-lg px-3 text-xs font-semibold transition-colors sm:text-sm ${
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
          outcomes={outcomes?.outcomes ?? null}
          onOpenDetail={onOpenDetail}
          onOrderDraft={onOrderDraft}
          draftNotice={draftNotice}
          cards={cards}
          statusDataTime={statusDataTime}
          statusStale={statusStale}
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
      {detailSymbol && (
        <AlertDetailPanel symbol={detailSymbol} snapshot={snapshot} onClose={() => onCloseDetail?.()} />
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
      {tab === 'outcomes' && <AlertOutcomesSection outcomes={outcomes} />}
    </section>
  );
}

function AlertLogPanel({
  outcomes = null, onOpenDetail, onOrderDraft, draftNotice = '',
  cards = [], statusDataTime = null, statusStale = false,
  alerts, hiddenAlertIds, showHidden, categoryFilter, onCategoryFilterChange, onHideAlert, loading,
  importantOnly = false, onImportantOnlyChange, liveStatus = 'live', secondsSinceUpdate = null,
  highlightedIds = [], showAllLevels = false, onShowAllLevelsChange, readAlertIds = [],
  onMarkAlertRead, lastOpenedAt = null,
}: {
  outcomes?: Record<string, AlertOutcome> | null;
  onOpenDetail?: (symbol: string) => void;
  onOrderDraft?: (entry: AlertLogEntry) => void;
  draftNotice?: string;
  cards?: readonly StatusCard[];
  statusDataTime?: string | null;
  statusStale?: boolean;
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
    // 「仅记录」级别和已作废的默认都收起来，打开「显示全部」才出现
    .filter((item) => showAllLevels || (!isLogOnly(item) && item.voided !== true)), [alerts, categoryFilter, hidden, importantOnly, showAllLevels, showHidden]);
  const view = useMemo(
    () => partitionAlerts(rows, { readIds: readAlertIds, lastOpenedAt }),
    [rows, readAlertIds, lastOpenedAt],
  );
  const timeline = useMemo(() => groupTimeline(view.timeline), [view.timeline]);
  const logOnlyCount = useMemo(() => alerts.filter(isLogOnly).length, [alerts]);
  const voidedCount = useMemo(() => alerts.filter((item) => item.voided === true).length, [alerts]);

  const open = (entry: AlertLogEntry) => {
    setExpandedId((current) => (current === entry.id ? null : entry.id));
    onMarkAlertRead?.(entry.id);
  };
  const row = (entry: AlertLogEntry, showDate = false) => (
    <AlertRow
      key={entry.id}
      showDate={showDate}
      entry={entry}
      expanded={expandedId === entry.id}
      highlighted={highlighted.has(entry.id)}
      onToggle={() => open(entry)}
      onHide={onHideAlert && !hidden.has(entry.id) ? () => onHideAlert(entry.id) : undefined}
      onOpenDetail={onOpenDetail}
      onOrderDraft={onOrderDraft}
      outcome={outcomes?.[entry.id] ?? null}
    />
  );

  return (
    <div className="space-y-2">
      {cards.length > 0 && (
        <MarketStatusBar cards={cards} dataTime={statusDataTime} stale={statusStale} />
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pb-0.5">
          <button
            type="button"
            aria-pressed={importantOnly}
            onClick={() => onImportantOnlyChange?.(!importantOnly)}
            className={`min-h-8 shrink-0 whitespace-nowrap rounded-full px-2.5 text-[11px] font-medium ${importantOnly ? 'bg-loss text-white' : 'bg-neutral/25 text-ink-secondary'}`}
          >
            只看重要
          </button>
          <button
            type="button"
            aria-pressed={showAllLevels}
            onClick={() => onShowAllLevelsChange?.(!showAllLevels)}
            className={`min-h-8 shrink-0 whitespace-nowrap rounded-full px-2.5 text-[11px] font-medium ${showAllLevels ? 'bg-buy text-white' : 'bg-neutral/25 text-ink-secondary'}`}
          >
            显示全部{!showAllLevels && (logOnlyCount > 0 || voidedCount > 0)
              ? `（仅记录 ${logOnlyCount} · 已作废 ${voidedCount}）`
              : ''}
          </button>
          {view.unread > 0 && (
            <span data-alert-unread={view.unread} className="min-h-8 shrink-0 whitespace-nowrap rounded-full bg-loss/15 px-2.5 py-1.5 text-[11px] font-semibold text-loss">
              未读 {view.unread}
            </span>
          )}
        </div>
        <span className="shrink-0 text-[10px] tabular-nums text-ink-muted" role="status">
          {liveStatus === 'disconnected'
            ? '● 已断开 · 正在重连'
            : liveStatus === 'paused'
              ? '● 已暂停 · 回到页面后继续'
              : `● 实时 · 上次更新 ${secondsSinceUpdate === null ? '刚刚' : `${secondsSinceUpdate} 秒前`}`}
        </span>
      </div>
      <div data-alert-filters="true" className="flex gap-1.5 overflow-x-auto pb-0.5">
        {ALERT_FILTER_ORDER.map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={categoryFilter === key}
            onClick={() => onCategoryFilterChange(key)}
            className={`min-h-8 shrink-0 whitespace-nowrap rounded-full px-2.5 text-[11px] font-medium ${
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
                {view.pinned.map((entry) => row(entry, true))}
              </ul>
            )}
            <ul className="space-y-1">
              {view.newCount > 0 && (
                <li data-alert-divider="true" className="py-1 text-center text-[10px] text-white/45">—— 以下是新提醒 ——</li>
              )}
              {timeline.map((item, index) => (
                <Fragment key={item.key}>
                  {(index === 0 || dayLabel(timeline[index - 1].occurredAt) !== dayLabel(item.occurredAt)) && (
                    <li data-alert-day={dayLabel(item.occurredAt)} className="pt-2 text-center text-[10px] text-white/40">
                      —— {dayLabel(item.occurredAt)} ——
                    </li>
                  )}
                  {item.kind === 'group'
                    ? <GroupRow item={item} renderRow={row} />
                    : row(item.entries[0])}
                </Fragment>
              ))}
            </ul>
          </>
        )}
      </div>
      {draftNotice && <p role="status" className="text-[10px] font-semibold text-gain">{draftNotice}</p>}
      <p className="text-[10px] text-ink-muted">
        点一条看完整说明。时间是北京时间，鼠标放上去（手机上长按）显示美东时间。「隐藏已读」只藏在这台设备上，服务器记录不会删。
      </p>
    </div>
  );
}

/** 第四个分页：按提醒类型看这类提醒之后发生了什么。 */
function AlertOutcomesSection({ outcomes }: { outcomes: AlertOutcomesPayload | null }) {
  const rows = outcomeSummaryRows(outcomes?.summary ?? []);
  return (
    <section className="rounded-2xl border border-neutral/40 bg-surface-raised p-4 sm:p-5" aria-label="提醒效果">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold sm:text-base">提醒效果 · 按类型统计</h3>
        <span className="text-[10px] tabular-nums text-ink-muted">
          {outcomes?.updated_at ? `服务器 ${beijingText(outcomes.updated_at)} 算过一次` : '还没算过'}
        </span>
      </div>
      <p className="mt-1 text-[10px] leading-relaxed text-ink-muted">
        每条提醒按当天完整收盘价起算，看之后第 1 / 5 / 20 个交易日该标的的涨跌，以及同期 QQQ。
        CNN、VIX、共振这类看 QQQ。只统计发生过的事实，不预测、也不改任何买卖规则。
      </p>
      {rows.length === 0 ? (
        <p className="mt-3 rounded-xl bg-surface-overlay p-4 text-center text-xs text-ink-muted">
          还没有可统计的提醒。服务器每天收盘审查之后会算一次。
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((row) => (
            <li key={row.kind} data-outcome-kind={row.kind} className="rounded-xl border border-neutral/30 bg-surface-overlay/40 p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <strong className="text-xs font-bold sm:text-sm">{row.label || row.kind}</strong>
                <span className="text-[10px] tabular-nums text-ink-muted">
                  {row.samples} 次{row.pending > 0 ? ` · ${row.pending} 条待定` : ''}
                  {row.backfilledNote ? ` · ${row.backfilledNote}` : ''}
                </span>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] tabular-nums text-ink-secondary sm:grid-cols-4">
                <div><dt className="text-ink-muted">5 日均涨跌</dt><dd>{horizonText(row.avg.d5)}</dd></div>
                <div><dt className="text-ink-muted">20 日均涨跌</dt><dd>{horizonText(row.avg.d20)}</dd></div>
                <div><dt className="text-ink-muted">20 日胜率</dt><dd>{winRateText(row.winRate)}</dd></div>
                <div>
                  <dt className="text-ink-muted">20 日超额（对 QQQ）</dt>
                  <dd>{row.selfBenchmark ? '—' : horizonText(row.excess.d20)}</dd>
                </div>
              </dl>
              {row.note && <p className="mt-1 text-[10px] font-semibold text-trim">{row.note}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** 只读的侧边详情：复用决策页用的那套图表组件，不改决策页本身。 */
function AlertDetailPanel({ symbol, snapshot, onClose }: {
  symbol: string;
  snapshot: QuantAnalysisSnapshot | null;
  onClose: () => void;
}) {
  const [displayMode, setDisplayMode] = useState<'closed' | 'preview'>('closed');
  const valuation = snapshot?.stock_forward_valuation?.symbols?.[symbol];
  return (
    <div
      data-alert-detail-panel={symbol}
      className="fixed inset-0 z-40 flex justify-end bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-label={`${symbol} 只读详情`}
    >
      <button type="button" aria-label="关闭详情" onClick={onClose} className="flex-1 cursor-default" />
      <div className="h-full w-full max-w-md overflow-y-auto bg-surface-base p-3 shadow-xl sm:p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold">{symbol} · 只读详情</h3>
          <button type="button" onClick={onClose} className="min-h-9 rounded-lg bg-neutral/30 px-3 text-xs font-semibold">
            关闭
          </button>
        </div>
        <p className="mt-1 text-[10px] text-ink-muted">只看不改：这里不下单，也不会改决策页的任何设置。</p>
        {valuation && (
          <p className="mt-2 text-[11px] tabular-nums text-ink-secondary">
            远期 PE {valuation.current === null ? '暂无' : valuation.current.toFixed(2)}
            {valuation.label ? ` · ${valuation.label}` : ''}
            {valuation.as_of ? ` · ${valuation.as_of}` : ''}
          </p>
        )}
        <div className="mt-2">
          {snapshot ? (
            <MaSlopeExplorer
              snapshot={snapshot}
              compact
              selectedSymbol={symbol}
              displayMode={displayMode}
              onDisplayModeChange={setDisplayMode}
            />
          ) : (
            <p className="text-xs text-ink-muted">量化快照还没读到，暂时看不了这个标的的图表。</p>
          )}
        </div>
      </div>
    </div>
  );
}

/** 同一分钟、同一类合并成的一行：点开看明细。 */
function GroupRow({ item, renderRow }: {
  item: TimelineItem;
  renderRow: (entry: AlertLogEntry, showDate?: boolean) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li data-alert-group={item.key} className="rounded">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex min-h-8 w-full items-center gap-1.5 text-left"
      >
        <time dateTime={item.occurredAt} className="shrink-0 tabular-nums text-white/45">
          {beijingText(item.occurredAt).slice(6, 11)}
        </time>
        <span aria-hidden="true" className="shrink-0">📦</span>
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        <span aria-hidden="true" className="shrink-0 text-white/45">{open ? '▾' : '▸'}</span>
      </button>
      {open && <ul className="mt-1 space-y-1 border-l border-white/15 pl-2">{item.entries.map((entry) => renderRow(entry))}</ul>}
    </li>
  );
}

const ACCENT_CLASS = {
  buy: 'border-l-2 border-emerald-500 pl-1.5',
  sell: 'border-l-2 border-red-500 pl-1.5',
  risk: 'border-l-2 border-amber-500 pl-1.5',
} as const;

function AlertRow({
  entry, expanded, highlighted, onToggle, onHide, onOpenDetail, onOrderDraft, outcome = null,
  showDate = false,
}: {
  outcome?: AlertOutcome | null;
  showDate?: boolean;
  entry: AlertLogEntry;
  expanded: boolean;
  highlighted: boolean;
  onToggle: () => void;
  onHide?: () => void;
  onOpenDetail?: (symbol: string) => void;
  onOrderDraft?: (entry: AlertLogEntry) => void;
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
            {showDate ? clock.slice(0, 11) : clock.slice(6, 11)}
          </time>
          <span aria-hidden="true" className="shrink-0">{entry.icon}</span>
          <span className={`min-w-0 flex-1 truncate ${entry.voided ? 'text-white/40 line-through' : ''}`}>
            {alertHeadline(entry)}
          </span>
          {entry.voided && (
            <span
              title={`已作废${entry.voided_reason ? ` · ${entry.voided_reason}` : ''}`}
              className="min-w-0 max-w-[45%] truncate text-white/45"
            >
              {voidedMark}
            </span>
          )}
          {entry.corrected && (
            <span title={`已更正 · ${entry.corrected_reason || ''}`} className="shrink-0 text-white/45">[已更正]</span>
          )}
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
          {entry.corrected && (
            <p className="text-white/45">
              已更正{entry.corrected_reason ? ` · ${entry.corrected_reason}` : ''}
              {entry.corrected_from ? ` · 原文：${entry.corrected_from}` : ''}
            </p>
          )}
          {outcome && (
            <p data-alert-outcome={entry.id} className="text-white/60">
              提醒之后（{outcome.symbol} · 基准收盘 {outcome.base_date}）：
              1 天 {horizonText(outcome.changes.d1)} · 5 天 {horizonText(outcome.changes.d5)} · 20 天 {horizonText(outcome.changes.d20)}
              {' '}· 相对 QQQ 20 天 {outcome.symbol === 'QQQ' ? '—' : horizonText(outcome.excess.d20)}
            </p>
          )}
          {entry.symbol && (onOpenDetail || onOrderDraft) && (
            <div className="flex flex-wrap gap-2 pt-1">
              {onOpenDetail && (
                <button
                  type="button"
                  onClick={() => onOpenDetail(entry.symbol as string)}
                  className="min-h-8 rounded-lg bg-white/15 px-2.5 text-[11px] font-semibold text-white"
                >
                  查看详情
                </button>
              )}
              {onOrderDraft && !entry.voided && (
                <button
                  type="button"
                  onClick={() => onOrderDraft(entry)}
                  className="min-h-8 rounded-lg bg-emerald-600 px-2.5 text-[11px] font-semibold text-white"
                >
                  我据此下单了
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function JournalPage({ displayCurrency, rates, snapshot = null }: {
  displayCurrency: DisplayCurrency;
  rates: ExchangeRates;
  snapshot?: QuantAnalysisSnapshot | null;
}) {
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
  const [outcomes, setOutcomes] = useState<AlertOutcomesPayload | null>(null);
  const [detailSymbol, setDetailSymbol] = useState<string | null>(null);
  const [draftNotice, setDraftNotice] = useState('');
  const [quotes, setQuotes] = useState<StatusQuotes | null>(null);
  const [quotesAt, setQuotesAt] = useState<number | null>(null);
  const [statusNow, setStatusNow] = useState(() => Date.now());
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

  // 提醒效果是服务器每天收盘后算好的，进页面读一次就够，不在网页上重算。
  useEffect(() => {
    const controller = new AbortController();
    void fetchAlertOutcomes(getServerAlertOutcomesUrl() || '/api/portfolio/alert-outcomes', controller.signal)
      .then((next) => setOutcomes(next))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  // 顶部状态条：每 60 秒拉一次 QQQ / VIX 和服务器判定的时段。
  useEffect(() => {
    const endpoint = getServerQuoteProxyUrl() || '/api/quotes';
    const controller = new AbortController();
    let stopped = false;
    const pull = async () => {
      if (stopped || document.visibilityState === 'hidden') return;
      try {
        const response = await fetch(`${endpoint}?symbols=QQQ,%5EVIX`, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const next = parseStatusQuotes(await response.json());
        if (stopped) return;
        setQuotes(next);
        setQuotesAt(Date.now());
      } catch {
        // 取数失败保留上一份数字，只把时间标旧，界面上显示「数据延迟」
      } finally {
        if (!stopped) setStatusNow(Date.now());
      }
    };
    void pull();
    const timer = window.setInterval(() => void pull(), STATUS_REFRESH_MS);
    return () => {
      stopped = true;
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);

  // 「上次更新 xx 秒前」每 5 秒走一次字
  useEffect(() => {
    if (updatedAt === null) return undefined;
    const tick = () => setSecondsSinceUpdate(Math.max(0, Math.round((Date.now() - updatedAt) / 1000)));
    tick();
    const timer = window.setInterval(tick, 5_000);
    return () => window.clearInterval(timer);
  }, [updatedAt]);

  const cnnSnapshot = cnnScoreFrom(snapshot);
  const cards = useMemo(() => statusCards({
    qqq: quotes?.qqq ?? null,
    qqqSeries: series.qqq,
    vix: quotes?.vix ?? null,
    cnn: cnnFromAlerts(alerts, cnnSnapshot.score, cnnSnapshot.at),
    importantToday: importantTodayCount(alerts, new Date(statusNow)),
    session: quotes?.session ?? null,
  }), [alerts, cnnSnapshot.at, cnnSnapshot.score, quotes, series.qqq, statusNow]);
  const statusStale = quotesAt === null || statusNow - quotesAt > STATUS_STALE_MS;

  // 「我据此下单了」：在决策日志里占一行草稿，关联这条提醒，数量价格留给用户补。
  function orderDraft(entry: AlertLogEntry) {
    if (!entry.symbol) return;
    addManualTrade(decisionEndpoint, {
      trade_time: new Date().toISOString(),
      symbol: entry.symbol,
      side: suggestedSide(entry),
      draft: true,
      alert_id: entry.id,
      alert_text: entry.text.split('\n')[0].slice(0, 500),
    }, revision.current)
      .then((next) => {
        revision.current = next.revision;
        setLog(next);
        setError('');
        setDraftNotice(`已在决策日志里生成 ${entry.symbol} 的草稿，去补数量、价格和预判。`);
        setTab('decisions');
      })
      .catch((reason: unknown) => {
        const conflict = reason as { log?: DecisionLog; message?: string };
        if (conflict?.log) { revision.current = conflict.log.revision; setLog(conflict.log); }
        setError(conflict?.message || '草稿生成失败，请重试');
      });
  }

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
      statusCards={cards}
      statusDataTime={quotes?.time ?? null}
      statusStale={statusStale}
      snapshot={snapshot}
      outcomes={outcomes}
      detailSymbol={detailSymbol}
      onOpenDetail={setDetailSymbol}
      onCloseDetail={() => setDetailSymbol(null)}
      onOrderDraft={orderDraft}
      draftNotice={draftNotice}
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
      onSaveNote={(trade, note) => apply(saveTradeNote(decisionEndpoint, trade.id, note as DecisionTradeNote, revision.current))}
      onAddTrade={(draft) => apply(addManualTrade(decisionEndpoint, draft, revision.current))}
      onAddFlow={(draft) => apply(addCashFlow(decisionEndpoint, draft, revision.current))}
      onRemoveFlow={(id) => apply(removeCashFlow(decisionEndpoint, id, revision.current))}
    />
  );
}
