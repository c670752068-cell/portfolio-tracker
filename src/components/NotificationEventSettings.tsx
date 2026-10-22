import { useState } from 'react';
import { defaultExtremeNotification, defaultNotificationWindow, defaultRealtimeNotification, NOTIFICATION_ZONES, WEEKDAY_NAMES,
  type NotificationSettings, type NotificationStatus, type NotificationWindow, type NotificationWindowKey,
  type RealtimeNotificationSettingsValue } from '../notificationSettings';

export function NotificationEventSettings({ settings, eventTypes, disabled, onSave }: {
  settings: NotificationSettings; eventTypes: NotificationStatus['eventTypes']; disabled: boolean;
  onSave: (next: NotificationSettings) => Promise<boolean>;
}) {
  const breakout = settings.breakout ?? { enabled: false, up: false, down: false };
  const extreme = settings.zExtreme ?? defaultExtremeNotification();
  const windowEditor = (key: NotificationWindowKey, name: string, child = false) => <AllowedWindowEditor name={name}
    value={settings.eventWindows?.[key] ?? defaultNotificationWindow()} disabled={disabled} child={child}
    onSave={value => onSave({ ...settings, eventWindows: { ...settings.eventWindows, [key]: value } })} />;
  return <section className="notification-card notification-event-settings"><h3>事件触发推送</h3>
    <p>每项可单独限制允许发送的时间、星期和时区。时段外不发、不排队；总开关和免打扰始终优先。</p>
    {eventTypes.map(item => <div className="notification-event-group" key={item.id}>
      <div className="notification-event"><div><h4>{item.name}</h4><p>{item.description}</p></div>
        <EventSwitch label={item.name} checked={settings.events[item.id]} disabled={disabled} onChange={enabled => void onSave({ ...settings, events: { ...settings.events, [item.id]: enabled } })} /></div>
      {windowEditor(item.id, item.name)}
    </div>)}
    <div className="notification-event-group">
      <div className="notification-event"><div><h4>Z-Score 露头提醒</h4><p>连续至少 15 个同号交易日后首次穿越零轴，仅完整收盘确认。</p></div>
        <EventSwitch label="Z-Score露头提醒" checked={breakout.enabled} disabled={disabled} onChange={enabled => void onSave({ ...settings, breakout: { ...breakout, enabled } })} /></div>
      {windowEditor('breakout', '露头提醒')}
      <div className="notification-breakout-directions">{(['up', 'down'] as const).map(direction => {
        const name = direction === 'up' ? '向上露头提醒' : '向下露头提醒';
        return <div key={direction}><div className="notification-row"><span>{direction === 'up' ? '↑' : '↓'} {name}</span>
          <EventSwitch label={name} checked={breakout[direction]} disabled={disabled || !breakout.enabled} onChange={enabled => void onSave({ ...settings, breakout: { ...breakout, [direction]: enabled } })} /></div>
          {windowEditor(`breakout_${direction}`, name, true)}</div>;
      })}</div>
    </div>
    <div className="notification-event-group" data-testid="z-extreme-settings">
      <div className="notification-event"><div><h4>Z-Score 极值附近提醒</h4><p>新增 · 默认关闭。默认在 +1.4 / −1.4 首次进入提醒区时推送，阈值可改。</p></div>
        <EventSwitch label="Z-Score极值附近提醒" checked={extreme.enabled} disabled={disabled} onChange={enabled => void onSave({ ...settings, zExtreme: { ...extreme, enabled } })} /></div>
      <ExtremeThresholdEditor settings={settings} disabled={disabled} onSave={onSave} />
      {windowEditor('zExtreme', '极值附近提醒')}
      <div className="notification-breakout-directions">{(['positive', 'negative'] as const).map(direction => {
        const name = direction === 'positive' ? '正值阈值提醒' : '负值阈值提醒';
        return <div key={direction}><div className="notification-row"><span>{direction === 'positive' ? '＋' : '−'} {name}</span>
          <EventSwitch label={name} checked={extreme[direction]} disabled={disabled || !extreme.enabled} onChange={enabled => void onSave({ ...settings, zExtreme: { ...extreme, [direction]: enabled } })} /></div>
          {windowEditor(`zExtreme_${direction}`, name, true)}</div>;
      })}</div>
      <p className="notification-info">按完整收盘审查，不是均线斜率。持续在同一区域不重复提醒；回到阈值内后再次进入才产生新提醒。网页 ±1.5 买卖区和回撤规则不变。</p>
    </div>
    <p className="notification-note">露头及极值附近提醒通常在美东 16:20 审查后产生（夏令时北京时间次日 04:20、冬令时 05:20）。允许时段不移动审查时间；如该时刻被时段或免打扰拦截，本次不会补发。同批合并，网页 +N 与手机推送独立。</p>
  </section>;
}

const REALTIME_ITEMS: ReadonlyArray<{ key: keyof RealtimeNotificationSettingsValue; name: string; description: string }> = [
  { key: 'qqqDrawdown', name: 'QQQ 回撤', description: '任何时段跌破 -5% / -10% / -15% / -20% / -25% / -30%，收盘后再确认一条。' },
  { key: 'vix', name: 'VIX', description: '较昨收涨 15% / 25% / 35%，升破 20 / 23 / 30，以及从当日高点回落。' },
  { key: 'cnn', name: '恐慌指数', description: 'CNN 恐惧贪婪跌破 30 / 25 / 20 / 15、恐慌加剧或缓解。' },
  { key: 'intradayZ', name: '盘中 Z-Score', description: '盘中 Z 穿过 ±0.5 / ±1.0 / ±1.5 / ±2.0 / ±2.5。' },
  { key: 'nearBreakout', name: '接近露头', description: 'Z 在 0 以下连续 15 个交易日以上之后回升到 -0.1，盘中先提醒一次，收盘再确认一次。' },
  { key: 'futuresDrop', name: '期货大跌', description: '纳指/标普/道指期货较上一结算价跌到 -1%（仅记录）、-1.5%、-2.5%，回到 -0.5% 以内写一条回稳。' },
  { key: 'portfolioLoss', name: '持仓整体浮亏', description: '用最新价格（含夜盘）估算全部持仓今日盈亏，占总资产达到 -2% / -4% 时提醒。' },
  { key: 'bigMove', name: '个股大幅波动', description: '持仓或观察标的当天涨跌超过 ±5%（QQQ ±2%，2 倍 ETF ±8%，3 倍 ETF ±12%）。' },
  { key: 'sellLine', name: '卖出线', description: '实时价格达到卖出军令的卖出线。' },
  { key: 'holdings', name: '持仓变化', description: '券商同步发现新买、加仓、减仓或清仓。' },
  { key: 'resonance', name: '多指标共振', description: 'QQQ ≤ -5% 且 VIX ≥ +25% 且 CNN ≤ 25 同时成立，附历史参考。' },
];

/** 实时提醒分组。只新增，不改动已有的任何开关和文字。 */
export function RealtimeNotificationSettings({ settings, disabled, onSave }: {
  settings: NotificationSettings; disabled: boolean; onSave: (next: NotificationSettings) => Promise<boolean>;
}) {
  const realtime = settings.realtime ?? defaultRealtimeNotification();
  const update = (patch: Partial<RealtimeNotificationSettingsValue>) =>
    void onSave({ ...settings, realtime: { ...realtime, ...patch } });
  return <section className="notification-card notification-event-settings" data-testid="realtime-notification-settings">
    <h3>实时提醒</h3>
    <p>新增 · 默认关闭。盘前、盘中、盘后、夜盘都监控；重要提醒连发多条，普通提醒 1 条，其余只写进「日志」页不推送。免打扰时段沿用上面的设置，期间只记日志，结束后汇总 1 条。</p>
    <div className="notification-event">
      <div><h4>实时提醒总开关</h4><p>关掉时所有实时提醒只写日志、不推送手机。</p></div>
      <EventSwitch label="实时提醒总开关" checked={realtime.enabled} disabled={disabled}
        onChange={enabled => update({ enabled })} />
    </div>
    {REALTIME_ITEMS.map(item => <div className="notification-row" key={String(item.key)}>
      <span>{item.name}<small>{item.description}</small></span>
      <EventSwitch label={item.name} checked={realtime[item.key] === true} disabled={disabled || !realtime.enabled}
        onChange={value => update({ [item.key]: value } as Partial<RealtimeNotificationSettingsValue>)} />
    </div>)}
    <label className="notification-row">
      <span>重要提醒连发次数</span>
      <select value={realtime.importantRepeat} disabled={disabled || !realtime.enabled}
        onChange={event => update({ importantRepeat: Number(event.target.value) as 1 | 2 | 3 })}>
        {[1, 2, 3].map(value => <option key={value} value={value}>{value} 条</option>)}
      </select>
    </label>
    <p className="notification-info">这些档位只用于提醒，不改变网页上的任何买卖判定。</p>
  </section>;
}

function EventSwitch({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled: boolean; onChange: (value: boolean) => void }) {
  return <button type="button" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} className={`notification-switch ${checked ? 'checked' : ''}`} onClick={() => onChange(!checked)}><span /></button>;
}

export function AllowedWindowEditor({ name, value, disabled, child = false, onSave }: {
  name: string; value: NotificationWindow; disabled: boolean; child?: boolean; onSave: (next: NotificationWindow) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const zone = NOTIFICATION_ZONES.find(([id]) => id === value.timeZone)?.[1] ?? value.timeZone;
  const summary = value.enabled ? `${value.start}–${value.end}${value.start > value.end ? '（跨日）' : ''} · ${zone}` : child ? '跟随本栏目，不额外限制' : '不限时段（仍遵守免打扰）';
  const valid = !draft.enabled || (draft.days.length > 0 && draft.start !== draft.end && Boolean(draft.start && draft.end));
  return <div className="notification-allowed-window">
    <button type="button" className="notification-window-toggle" aria-label={`${name}允许发送时段`} aria-expanded={open}
      onClick={() => { setDraft(value); setOpen(!open); }}><span>允许发送时段 <small>{summary}</small></span><span aria-hidden="true">{open ? '⌃' : '⌄'}</span></button>
    {open && <form className="notification-schedule-editor" aria-label={`${name}时段设置`} onSubmit={async e => {
      e.preventDefault(); if (valid && await onSave(draft.enabled ? draft : { ...defaultNotificationWindow(), enabled: false })) setOpen(false);
    }}>
      <label>时段模式<select aria-label={`${name}时段模式`} value={draft.enabled ? 'limited' : 'any'} disabled={disabled} onChange={e => setDraft({ ...draft, enabled: e.target.value === 'limited' })}>
        <option value="any">{child ? '跟随本栏目，不额外限制' : '不限制时段'}</option><option value="limited">仅允许指定时段</option></select></label>
      {draft.enabled && <>
        <div className="notification-fields"><label>开始时间<input type="time" required aria-label={`${name}开始时间`} disabled={disabled} value={draft.start} onChange={e => setDraft({ ...draft, start: e.target.value })} /></label>
          <label>结束时间<input type="time" required aria-label={`${name}结束时间`} disabled={disabled} value={draft.end} onChange={e => setDraft({ ...draft, end: e.target.value })} /></label></div>
        <label>时区<select aria-label={`${name}时区`} disabled={disabled} value={draft.timeZone} onChange={e => setDraft({ ...draft, timeZone: e.target.value })}>{NOTIFICATION_ZONES.map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label>
        <fieldset disabled={disabled}><legend>允许星期</legend><div className="notification-weekdays">{WEEKDAY_NAMES.map((day, index) => <label key={day}><input type="checkbox" aria-label={`${name}周${day}`} checked={draft.days.includes(index)} onChange={e => setDraft({ ...draft, days: e.target.checked ? [...draft.days, index].sort() : draft.days.filter(d => d !== index) })} /><span>{day}</span></label>)}</div></fieldset>
        {!valid && <p className="notification-field-error" role="alert">请选择至少一天，开始与结束时间不能相同。</p>}
        <p>开始时刻包含、结束时刻不含。跨午夜时，星期以开始那一天为准。{child ? '还须同时满足本栏目时段。' : ''}时段外直接跳过，不在下次补发。</p>
      </>}
      <div className="notification-editor-actions"><button type="submit" disabled={disabled || !valid}>保存允许时段</button><button type="button" disabled={disabled} onClick={() => setOpen(false)}>取消</button></div>
    </form>}
  </div>;
}

function ExtremeThresholdEditor({ settings, disabled, onSave }: { settings: NotificationSettings; disabled: boolean; onSave: (next: NotificationSettings) => Promise<boolean> }) {
  const rule = settings.zExtreme ?? defaultExtremeNotification();
  const [draft, setDraft] = useState({ positive: String(rule.positiveThreshold), negative: String(rule.negativeThreshold) });
  const [editing, setEditing] = useState(false);
  const value = editing ? draft : { positive: String(rule.positiveThreshold), negative: String(rule.negativeThreshold) };
  const valid = [value.positive, value.negative].every(v => v.trim() !== '' && Number(v) >= 0.1 && Number(v) <= 10 && Number.isFinite(Number(v)));
  return <form className="notification-threshold-editor" aria-label="极值提醒阈值" onSubmit={async e => {
    e.preventDefault(); if (valid && await onSave({ ...settings, zExtreme: { ...rule, positiveThreshold: Number(value.positive), negativeThreshold: Number(value.negative) } })) setEditing(false);
  }}><div className="notification-fields">{(['positive', 'negative'] as const).map(direction => <label key={direction}>{direction === 'positive' ? '正值提醒：Z ≥ +' : '负值提醒：Z ≤ −'}
    <input type="number" inputMode="decimal" min="0.1" max="10" step="any" required aria-label={direction === 'positive' ? '正值提醒阈值' : '负值提醒阈值的绝对值'} disabled={disabled} value={value[direction]} onChange={e => { setDraft({ ...value, [direction]: e.target.value }); setEditing(true); }} /></label>)}</div>
    {editing && !valid && <p className="notification-field-error" role="alert">请输入 0.1–10 的数值；负值方向填写绝对值。</p>}
    <div className="notification-editor-actions"><button type="submit" disabled={disabled || !editing || !valid}>保存提醒阈值</button><button type="button" disabled={disabled || !editing} onClick={() => setEditing(false)}>取消修改</button></div>
  </form>;
}
