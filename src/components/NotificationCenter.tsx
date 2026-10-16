import { useCallback, useEffect, useRef, useState } from 'react';
import type { QuantAnalysisSnapshot } from '../types';
import { fetchNotificationSettings, NOTIFICATION_ZONES, scheduleRepeatText, WEEKDAY_NAMES,
  type NotificationSchedule, type NotificationSettings, type NotificationStatus } from '../notificationSettings';
import { DataFreshnessPanel } from './DataFreshnessPanel';
import { NotificationEventSettings } from './NotificationEventSettings';
import './NotificationCenter.css';

const dateTime = (value: string | null) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '未提供';
export function NotificationCenter({ snapshot }: { snapshot: QuantAnalysisSnapshot | null }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const busy = useRef(false);
  const requestId = useRef(0);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'push' | 'data'>('push');
  const [status, setStatus] = useState<NotificationStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [adding, setAdding] = useState(false);
  const [allSchedules, setAllSchedules] = useState(false);
  const [newKind, setNewKind] = useState('decision');
  const reload = useCallback(async () => {
    if (busy.current) return;
    const id = ++requestId.current;
    try { const data = await fetchNotificationSettings(); if (id === requestId.current) { setStatus(data); setError(''); } }
    catch (e) { if (id === requestId.current) setError(e instanceof Error ? e.message : '读取失败'); }
    finally { if (id === requestId.current) setLoading(false); }
  }, []);
  const cancelReload = useCallback(() => { requestId.current++; }, []);
  useEffect(() => {
    // Network synchronization: state is updated only after the request settles.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void reload(); }, 30000);
    const foreground = () => { if (document.visibilityState === 'visible') void reload(); };
    document.addEventListener('visibilitychange', foreground);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', foreground); cancelReload(); };
  }, [reload, cancelReload]);
  useEffect(() => {
    const el = dialog.current;
    if (!open || !el) return;
    const overflow = document.body.style.overflow;
    const triggerElement = trigger.current;
    document.body.style.overflow = 'hidden';
    el.showModal(); void reload();
    return () => { el.close(); document.body.style.overflow = overflow; triggerElement?.focus(); };
  }, [open, reload]);
  async function save(next: NotificationSettings) {
    if (busy.current) return false;
    busy.current = true; requestId.current++; setLoading(false); setSaving(true); setError(''); setMessage('');
    try { const data = await fetchNotificationSettings(next); setStatus(data); setMessage('已保存到服务器'); return true; }
    catch (e) { setError(e instanceof Error ? e.message : '保存失败，请重试'); return false; }
    finally { busy.current = false; setSaving(false); }
  }
  const settings = status?.settings;
  const label = error ? '状态待确认' : !status ? '正在连接' : status.state === 'off' ? '推送已关闭' : status.state === 'quiet' ? '免打扰中' : '推送已开启';
  const state = error || !status ? 'unknown' : status.state;
  const workerRecent = status?.workerSeenAt && Date.parse(status.serverTime) - Date.parse(status.workerSeenAt) < 180000;
  const updateSchedule = (row: NotificationSchedule) => settings && save({ ...settings, schedules: settings.schedules.map(s => s.id === row.id ? row : s) });
  return <>
    <button ref={trigger} type="button" className="notification-trigger" aria-label={`通知与数据：${label}`} title={`通知与数据 · ${label}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
      <span className={`notification-dot ${state}`} aria-hidden="true" />
    </button>
    <dialog ref={dialog} className="notification-dialog" aria-labelledby="notification-title" onCancel={e => { e.preventDefault(); setOpen(false); }} onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="notification-sheet">
        <header className="notification-heading">
          <div className="notification-handle" aria-hidden="true" />
          <div className="notification-title-row"><div><h2 id="notification-title">通知与数据</h2><p><span className={`notification-dot ${state}`} />{label}</p></div><button className="notification-close" type="button" aria-label="关闭通知与数据" onClick={() => setOpen(false)}>×</button></div>
          <div className="notification-tabs" role="tablist" aria-label="通知与数据分类">
            {(['push', 'data'] as const).map((key, i) => <button key={key} id={`notification-tab-${key}`} type="button" role="tab" aria-selected={tab === key} aria-controls={`notification-panel-${key}`} tabIndex={tab === key ? 0 : -1} className={tab === key ? 'selected' : ''} onClick={() => setTab(key)} onKeyDown={e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const next = e.key === 'Home' ? 'push' : e.key === 'End' ? 'data' : key === 'push' ? 'data' : 'push'; setTab(next); document.getElementById(`notification-tab-${next}`)?.focus(); } }}>{i === 0 ? '推送管理' : '数据状态'}</button>)}
          </div>
        </header>
        <div className="notification-scroll">
          {error && <div className="notification-error" role="alert">{error}。未确认的修改不会显示为保存成功。<button type="button" onClick={() => void reload()} disabled={saving || loading}>刷新状态</button></div>}
          {tab === 'push' ? <div id="notification-panel-push" role="tabpanel" aria-labelledby="notification-tab-push">
            {!settings ? <p className="notification-note">{loading ? '正在读取服务器设置…' : '连接成功后可管理推送。'}</p> : <>
              <section className="notification-card">
                <div className="notification-row"><h3>全部推送 <span className={`notification-badge ${settings.enabled ? 'enabled' : ''}`}>{settings.enabled ? '已开启' : '已关闭'}</span></h3><Switch label="全部推送" checked={settings.enabled} disabled={saving} onChange={enabled => void save({ ...settings, enabled })} /></div>
                <p>关闭后停止本机和服务器的所有手机推送；行情更新、决策计算和图表颜色继续运行。</p>
                <div className="notification-save-state" role="status" aria-live="polite">{saving ? '正在保存…' : message || '设置保存在服务器，电脑与手机共用。'}</div>
              </section>
              <section className="notification-card">
                <div className="notification-row"><h3>固定时间推送</h3><span className="notification-count">{settings.schedules.filter(s => s.enabled).length} / {settings.schedules.length} 项</span></div>
                <p>点击任务查看内容、修改时间和重复日期。时间均按该任务的时区执行。</p>
                {(allSchedules ? settings.schedules : settings.schedules.slice(0, 3)).map(row => <ScheduleRow key={row.id} row={row} disabled={saving} onSave={updateSchedule} onDelete={() => void save({ ...settings, schedules: settings.schedules.filter(s => s.id !== row.id) })} />)}
                <button className="notification-add-button" type="button" aria-expanded={allSchedules} onClick={() => setAllSchedules(!allSchedules)}>{allSchedules ? '收起完整任务清单' : `查看全部 ${settings.schedules.length} 项任务（含日报、周报和月报）`}</button>
                {adding ? <div className="notification-add"><label>任务内容<select value={newKind} onChange={e => setNewKind(e.target.value)}>{[...new Map(settings.schedules.map(s => [s.kind, s])).values()].map(s => <option key={s.kind} value={s.kind}>{s.name}</option>)}</select></label><button type="button" disabled={saving} onClick={async () => { const base = settings.schedules.find(s => s.kind === newKind); if (!base) return; const row = { ...base, id: `custom-${crypto.randomUUID()}`, enabled: false, custom: true }; if (await save({ ...settings, schedules: [...settings.schedules, row] })) { setAdding(false); setAllSchedules(true); } }}>添加任务（默认关闭）</button><button type="button" onClick={() => setAdding(false)}>取消</button></div> : <button className="notification-add-button" type="button" disabled={saving || settings.schedules.length >= 40} onClick={() => setAdding(true)}>＋ 添加推送任务</button>}
                <p className="notification-note">网站任务由 VPS 执行。本机任务需量化服务在线；错过时间不会补发。</p>
              </section>
              <NotificationEventSettings settings={settings} eventTypes={status.eventTypes} disabled={saving} onSave={save} />
              <QuietHoursEditor settings={settings} disabled={saving} onSave={save} />
              <div className="notification-info">重新开启后，不会集中补发关闭或免打扰期间的提醒。已送达手机的通知无法撤回。</div>
              <p className="notification-note">按你的设置，此处无需密码；任何可访问网站的人均可修改通知偏好。</p>
            </>}
          </div> : <div id="notification-panel-data" role="tabpanel" aria-labelledby="notification-tab-data">
            {snapshot ? <DataFreshnessPanel snapshot={snapshot} compact /> : <div className="notification-card">尚未读取到量化快照，无法确认数据日期。</div>}
            <section className="notification-card"><h3>通知服务状态</h3><dl className="notification-dates"><dt>网站服务器</dt><dd>{status ? '已连接' : '待确认'}</dd><dt>本机量化服务</dt><dd>{workerRecent ? '在线' : '未收到近期连接'}</dd><dt>本机最近连接</dt><dd>{dateTime(status?.workerSeenAt || null)}</dd><dt>通知设置保存</dt><dd>{dateTime(settings?.updatedAt || null)}</dd></dl><p>本机断网或休眠不影响网页开关；本机报告暂停，恢复后不补发错过的任务。</p></section>
          </div>}
        </div>
        <footer className="notification-footer"><span>{saving ? '正在保存…' : settings?.updatedAt ? `设置已同步 · ${dateTime(settings.updatedAt)}` : '设置保存在服务器'}</span><button type="button" onClick={() => void reload()} disabled={saving || loading}>{loading ? '读取中…' : '↻ 刷新状态'}</button></footer>
      </div>
    </dialog>
  </>;
}
function Switch({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled: boolean; onChange: (value: boolean) => void }) {
  return <button type="button" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} className={`notification-switch ${checked ? 'checked' : ''}`} onClick={() => onChange(!checked)}><span /></button>;
}
function ZoneSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <label>时区<select value={value} onChange={e => onChange(e.target.value)}>{NOTIFICATION_ZONES.map(([zone, label]) => <option key={zone} value={zone}>{label}</option>)}</select></label>;
}
function ScheduleRow({ row, disabled, onSave, onDelete }: { row: NotificationSchedule; disabled: boolean; onSave: (row: NotificationSchedule) => unknown; onDelete: () => void }) {
  const [draft, setDraft] = useState(row);
  const [expanded, setExpanded] = useState(false);
  const zone = NOTIFICATION_ZONES.find(([id]) => id === row.timeZone)?.[1] || row.timeZone;
  return <div className="notification-schedule">
    <div className="notification-row"><button type="button" className="notification-schedule-title" aria-label={`编辑${row.name} ${row.id}`} aria-expanded={expanded} onClick={() => { setDraft(row); setExpanded(!expanded); }}><span className="notification-task-icon" aria-hidden="true">{row.source === 'server' ? '◷' : '▤'}</span><span><strong>{row.name}</strong><small>{row.time} · {scheduleRepeatText(row)}<br />{zone}</small></span><span aria-hidden="true">{expanded ? '⌃' : '⌄'}</span></button><Switch label={`${row.name} ${row.id}`} checked={row.enabled} disabled={disabled} onChange={enabled => void onSave({ ...row, enabled })} /></div>
    {expanded && <form className="notification-schedule-editor" onSubmit={e => { e.preventDefault(); void onSave({ ...draft, enabled: row.enabled }); }}><p>{row.description}</p><div className="notification-fields"><label>推送时间<input type="time" required value={draft.time} onChange={e => setDraft({ ...draft, time: e.target.value })} /></label><ZoneSelect value={draft.timeZone} onChange={timeZone => setDraft({ ...draft, timeZone })} /></div><fieldset><legend>重复星期</legend><div className="notification-weekdays">{WEEKDAY_NAMES.map((day, index) => <label key={day}><input type="checkbox" checked={draft.days.includes(index)} onChange={e => setDraft({ ...draft, days: e.target.checked ? [...draft.days, index].sort() : draft.days.filter(d => d !== index) })} /><span>{day}</span></label>)}</div></fieldset><label>每月日期<select value={draft.dayOfMonth ?? ''} onChange={e => setDraft({ ...draft, dayOfMonth: e.target.value ? +e.target.value : null })}><option value="">不限日期，按星期执行</option>{Array.from({ length: 28 }, (_, i) => <option key={i} value={i + 1}>{i + 1} 日</option>)}</select></label><div className="notification-editor-actions"><button type="submit" disabled={disabled || !draft.days.length}>保存任务时间</button>{row.custom && <button type="button" disabled={disabled} onClick={onDelete}>删除此任务</button>}</div></form>}
  </div>;
}
function QuietHoursEditor({ settings, disabled, onSave }: { settings: NotificationSettings; disabled: boolean; onSave: (next: NotificationSettings) => Promise<boolean> }) {
  const q = settings.quietHours;
  const [draft, setDraft] = useState(q);
  const [editing, setEditing] = useState(false);
  const value = editing ? draft : q;
  const change = (patch: Partial<typeof q>) => { setDraft({ ...value, ...patch }); setEditing(true); };
  return <section className="notification-card"><div className="notification-row"><h3>☾ 免打扰</h3><Switch label="开启免打扰" checked={q.enabled} disabled={disabled} onChange={enabled => void onSave({ ...settings, quietHours: { ...q, enabled } })} /></div><p>指定时间内不发送任何推送，包括定时任务、风险和数据异常。跨午夜也有效，结束时刻起恢复。</p><form onSubmit={async e => { e.preventDefault(); if (await onSave({ ...settings, quietHours: { ...value, enabled: q.enabled } })) setEditing(false); }}><div className="notification-fields"><label>开始时间<input type="time" required value={value.start} onChange={e => change({ start: e.target.value })} /></label><label>结束时间<input type="time" required value={value.end} onChange={e => change({ end: e.target.value })} /></label></div><ZoneSelect value={value.timeZone} onChange={timeZone => change({ timeZone })} /><button type="submit" className="notification-add-button" disabled={disabled || !editing || value.start === value.end}>保存免打扰时间</button></form></section>;
}
