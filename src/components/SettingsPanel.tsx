import { useState } from 'react';
import type { AppSettings } from '../types';

interface SettingsPanelProps {
  settings: AppSettings;
  onSave: (s: AppSettings) => void;
}

export function SettingsPanel({ settings, onSave }: SettingsPanelProps) {
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [saved, setSaved] = useState(false);

  function save() {
    onSave(draft);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
      <h3 className="text-sm font-semibold">设置</h3>
      <Field label="Kimi API Key（Moonshot）">
        <input
          type="password"
          value={draft.kimiApiKey}
          onChange={(e) => setDraft({ ...draft, kimiApiKey: e.target.value })}
          placeholder="sk-..."
          className={inputCls}
        />
        <p className="mt-1 text-xs text-slate-500">
          仅保存在本机浏览器（localStorage）。代码托管在 GitHub，但 Key 永远不会上传。
        </p>
      </Field>
      <Field label="模型">
        <select
          value={draft.kimiModel}
          onChange={(e) => setDraft({ ...draft, kimiModel: e.target.value })}
          className={inputCls}
        >
          <option value="moonshot-v1-8k">moonshot-v1-8k</option>
          <option value="moonshot-v1-32k">moonshot-v1-32k</option>
          <option value="moonshot-v1-128k">moonshot-v1-128k</option>
        </select>
      </Field>
      <Field label="代理 URL（可选，处理 CORS）">
        <input
          value={draft.proxyUrl}
          onChange={(e) => setDraft({ ...draft, proxyUrl: e.target.value })}
          placeholder="https://your-worker.workers.dev/v1/chat/completions"
          className={inputCls}
        />
        <p className="mt-1 text-xs text-slate-500">
          浏览器直连 Moonshot 可能被 CORS 拦截。如失败，部署 README 中的 Cloudflare Worker 代理并填入此处。
        </p>
      </Field>
      <button
        onClick={save}
        className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
      >
        {saved ? '已保存 ✓' : '保存设置'}
      </button>
    </div>
  );
}

const inputCls =
  'w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <div className="mb-1 font-medium">{label}</div>
      {children}
    </label>
  );
}
