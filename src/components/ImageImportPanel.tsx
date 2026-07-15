import { useEffect, useRef, useState } from 'react';
import { KimiError, activeAiApiKey, activeAiProviderLabel, parseOptionDetailImages, parsePortfolioImages } from '../kimi';
import { formatMoney } from '../format';
import type { AppSettings, ImportedPortfolio, ParsedOptionDetails } from '../types';
import { hasServerGateway } from '../runtimeConfig';

const MAX_FILES = 8;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_SIDE = 1600;
const JPEG_QUALITY = 0.82;

interface ImageImportPanelProps {
  settings: AppSettings;
  onConfirm: (result: ImportedPortfolio) => void;
  onOptionDetails: (result: ParsedOptionDetails) => void;
  onOpenSettings: () => void;
}

export function ImageImportPanel({ settings, onConfirm, onOptionDetails, onOpenSettings }: ImageImportPanelProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [loadingMode, setLoadingMode] = useState<'full' | 'option' | null>(null);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [result, setResult] = useState<ImportedPortfolio | null>(null);
  const [optionResult, setOptionResult] = useState<ParsedOptionDetails | null>(null);
  const [prepareSummary, setPrepareSummary] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const retryCountdownRef = useRef<number | null>(null);
  const aiLabel = activeAiProviderLabel(settings);
  const usesServerGateway = hasServerGateway();

  function clearRetryCountdown() {
    if (retryCountdownRef.current != null) {
      window.clearInterval(retryCountdownRef.current);
      retryCountdownRef.current = null;
    }
  }

  useEffect(() => () => clearRetryCountdown(), []);

  function showRetryCountdown(info: { attempt: number; total: number; delayMs: number }) {
    clearRetryCountdown();
    let seconds = Math.ceil(info.delayMs / 1000);
    const render = () => setPrepareSummary(`智谱繁忙，${seconds} 秒后自动重试（第 ${info.attempt}/${info.total} 次）…`);
    render();
    retryCountdownRef.current = window.setInterval(() => {
      seconds = Math.max(0, seconds - 1);
      render();
      if (seconds === 0) clearRetryCountdown();
    }, 1000);
  }

  function addFiles(nextList: FileList | null) {
    if (!nextList) return;
    setError(null);
    setResult(null);
    setOptionResult(null);
    setPrepareSummary('');
    const valid = Array.from(nextList).filter((file) => {
      if (!file.type.startsWith('image/')) return false;
      if (file.size > MAX_FILE_BYTES) return false;
      return true;
    });
    const combined = [...files, ...valid].filter(
      (file, index, all) => all.findIndex((item) => item.name === file.name && item.size === file.size) === index,
    );
    if (valid.length !== nextList.length) {
      setError({ message: '已忽略非图片或大于 10MB 的文件。' });
    }
    if (combined.length > MAX_FILES) {
      setError({ message: `一次最多解析 ${MAX_FILES} 张图片；请分批导入。` });
    }
    setFiles(combined.slice(0, MAX_FILES));
    if (inputRef.current) inputRef.current.value = '';
  }

  async function parse(mode: 'full' | 'option') {
    if (!activeAiApiKey(settings).trim()) {
      setError({ message: `请先保存 ${aiLabel} API Key。`, hint: `当前图片解析服务是 ${aiLabel}；Key 只保存在当前浏览器。` });
      return;
    }
    if (files.length === 0) {
      setError({ message: '请先选择持仓、期权详情或现金/购买力截图。' });
      return;
    }
    setLoadingMode(mode);
    clearRetryCountdown();
    setError(null);
    setResult(null);
    setOptionResult(null);
    setPrepareSummary('正在压缩截图，减少移动端网络失败…');
    try {
      const images = await Promise.all(files.map(prepareImageForVision));
      const originalBytes = files.reduce((sum, file) => sum + file.size, 0);
      const preparedBytes = images.reduce((sum, image) => sum + image.bytes, 0);
      setPrepareSummary(`已将截图从 ${formatBytes(originalBytes)} 压缩到 ${formatBytes(preparedBytes)} 后发送给 ${aiLabel}。`);
      const callbacks = {
        onRetryWait: showRetryCountdown,
        onNotice: (text: string) => {
          clearRetryCountdown();
          setPrepareSummary(text);
        },
      };
      if (mode === 'full') {
        const parsed = await parsePortfolioImages(settings, images, callbacks);
        setResult(parsed);
        onConfirm(parsed);
      } else {
        const parsed = await parseOptionDetailImages(settings, images, callbacks);
        setOptionResult(parsed);
        onOptionDetails(parsed);
      }
      setFiles([]);
    } catch (caught: unknown) {
      if (caught instanceof KimiError) setError({ message: caught.message, hint: caught.hint });
      else setError({ message: caught instanceof Error ? caught.message : String(caught) });
    } finally {
      clearRetryCountdown();
      setLoadingMode(null);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/40 p-3 dark:border-indigo-900/70 dark:bg-indigo-950/20">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-indigo-950 dark:text-indigo-100">截图导入持仓</h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
            完整持仓页请选择“全量持仓”；单独上传期权详情页请选择“补充期权详情”，该模式绝不会删除正股、ETF 或现金。
          </p>
        </div>
        <button onClick={onOpenSettings} className="text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-300">
          配置 AI Key
        </button>
      </div>

      <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-indigo-300 bg-white px-3 py-5 text-center text-sm text-indigo-800 hover:bg-indigo-50 dark:border-indigo-700 dark:bg-slate-900 dark:text-indigo-200">
        <span className="font-medium">选择持仓截图（最多 {MAX_FILES} 张，每张 ≤ 10MB）</span>
        <span className="mt-1 text-xs text-slate-500">支持 JPG、PNG、WEBP、GIF；发送前会自动压缩到最长边 {MAX_IMAGE_SIDE}px</span>
        <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple className="hidden" onChange={(event) => addFiles(event.target.files)} />
      </label>

      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map((file, index) => (
            <span key={`${file.name}-${file.size}`} className="inline-flex max-w-full items-center gap-1 rounded-full bg-white px-2 py-1 text-xs text-slate-700 shadow-sm dark:bg-slate-800 dark:text-slate-200">
              <span className="truncate">{file.name}</span>
              <button aria-label={`移除 ${file.name}`} onClick={() => { setFiles(files.filter((_, itemIndex) => itemIndex !== index)); setResult(null); setOptionResult(null); setPrepareSummary(''); }} className="font-bold text-slate-400 hover:text-rose-600">×</button>
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => parse('full')} disabled={loadingMode !== null || files.length === 0} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-400">
          {loadingMode === 'full' ? '正在识别全量持仓…' : '解析并导入（全量持仓）'}
        </button>
        <button onClick={() => parse('option')} disabled={loadingMode !== null || files.length === 0} className="rounded-md border border-indigo-500 bg-white px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:border-slate-400 disabled:text-slate-400 dark:bg-slate-900 dark:text-indigo-200">
          {loadingMode === 'option' ? '正在补充期权详情…' : '补充期权详情（不改动其他持仓）'}
        </button>
        <span className="text-xs text-slate-500">
          {usesServerGateway
            ? `截图经你的私人服务器转发给 ${aiLabel}；服务器会保留最近 30 天的截图与识别结果供复查，不会发给任何第三方。`
            : `截图只会随本次请求发送到 ${aiLabel}，不会保存到本地或导出 JSON。`}
        </span>
      </div>
      {prepareSummary && <p className="text-xs text-slate-500 dark:text-slate-400">{prepareSummary}</p>}

      {error && (
        <div role="alert" className="rounded border border-rose-300 bg-rose-50 p-2 text-xs text-rose-800 dark:border-rose-800 dark:bg-rose-900/30 dark:text-rose-100">
          <div className="font-semibold">解析失败：{error.message}</div>
          {error.hint && <div className="mt-1">{error.hint}</div>}
        </div>
      )}

      {result && (
        <div className="space-y-3 rounded-lg border border-indigo-200 bg-white p-3 dark:border-indigo-800 dark:bg-slate-900">
          <div>
            <h3 className="text-sm font-semibold">识别预览</h3>
            <p className="mt-1 text-xs text-slate-500">{result.sourceSummary}。已自动导入；如需修正，可在持仓表中编辑或删除。</p>
          </div>
          {result.holdings.length > 0 && (
            <div className="overflow-x-auto rounded border border-slate-200 dark:border-slate-700">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                  <tr><th className="px-2 py-1.5">代码/类型</th><th className="px-2 py-1.5">数量</th><th className="px-2 py-1.5">识别市值</th><th className="px-2 py-1.5">期权信息</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {result.holdings.map((holding, index) => (
                    <tr key={`${holding.symbol}-${index}`}>
                      <td className="px-2 py-2"><div className="font-medium">{holding.symbol}</div><div className="text-slate-500">{assetLabel(holding.assetType)} · {holding.confidence === 'low' ? '低置信度' : holding.confidence === 'high' ? '高置信度' : '待核对'}</div></td>
                      <td className="px-2 py-2 tabular-nums">{holding.shares || '—'}</td>
                      <td className="px-2 py-2 tabular-nums">{holding.marketValueOverride != null ? formatMoney(holding.marketValueOverride, holding.currency) : '待补充'}</td>
                      <td className="px-2 py-2 text-slate-600 dark:text-slate-300">{holding.option ? `${holding.option.underlying} ${holding.option.optionType.toUpperCase()} · ${holding.option.expiration ?? '到期日待补'} · Δ ${holding.option.delta ?? '待补'}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {result.cash.length > 0 && <p className="text-xs text-slate-600 dark:text-slate-300">识别现金：{result.cash.map((cash) => formatMoney(cash.amount, cash.currency)).join('、')}</p>}
          {result.issues.length > 0 && (
            <div className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-100">
              <div className="font-semibold">仍建议补充</div>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                {result.issues.map((issue, index) => <li key={`${issue.field}-${index}`}><span className="font-medium">{issue.priority === 'required' ? '需补充：' : '建议补充：'}{issue.field}</span> — {issue.reason}</li>)}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setResult(null)} className="rounded-md bg-slate-100 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-100">关闭预览</button>
          </div>
        </div>
      )}

      {optionResult && (
        <div className="space-y-2 rounded-lg border border-emerald-200 bg-white p-3 text-xs dark:border-emerald-800 dark:bg-slate-900">
          <h3 className="text-sm font-semibold">期权详情识别结果</h3>
          <p className="text-slate-500">{optionResult.sourceSummary}。已安全补充；正股、ETF 与现金均未改动。</p>
          {optionResult.options.map((option, index) => (
            <div key={`${option.underlying}-${option.strike}-${index}`} className="rounded border border-slate-200 p-2 dark:border-slate-700">
              <span className="font-medium">{option.underlying} {option.optionType.toUpperCase()} {option.strike ?? '行权价待补'}</span>
              <span className="ml-2 text-slate-500">{option.expiration ?? '到期日待补'} · Δ {option.delta ?? '待补'} · {option.contracts ?? '—'} 张</span>
            </div>
          ))}
          <button onClick={() => setOptionResult(null)} className="rounded-md bg-slate-100 px-3 py-1.5 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-100">关闭预览</button>
        </div>
      )}
    </div>
  );
}

interface PreparedImage {
  name: string;
  dataUrl: string;
  bytes: number;
}

async function prepareImageForVision(file: File): Promise<PreparedImage> {
  try {
    const dataUrl = await compressImage(file);
    return { name: file.name, dataUrl, bytes: estimateDataUrlBytes(dataUrl) };
  } catch {
    const dataUrl = await readAsDataUrl(file);
    return { name: file.name, dataUrl, bytes: estimateDataUrlBytes(dataUrl) };
  }
}

async function compressImage(file: File): Promise<string> {
  const image = await loadImage(file);
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建图片压缩画布');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`无法载入图片：${file.name}`));
    };
    image.src = url;
  });
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`无法读取图片：${file.name}`));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

function estimateDataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.split(',')[1] ?? '';
  return Math.round(base64.length * 0.75);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function assetLabel(type: string | undefined): string {
  const labels: Record<string, string> = { stock: '股票', etf: 'ETF', leveraged_etf: '杠杆 ETF', option: '期权', fund: '基金', other: '其他' };
  return labels[type ?? 'stock'] ?? '股票';
}
