interface AnalysisPanelProps {
  onOpenConditionLookup: () => void;
}

export function AnalysisPanel({ onOpenConditionLookup }: AnalysisPanelProps) {
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
      <h3 className="text-sm font-semibold">分析统一使用量化系统数据</h3>
      <p className="text-sm leading-relaxed text-slate-500">
        组合分析不再调用通用 AI。请在「条件查询」中查看生产规则的买入六关、门槛证据和历史事件样本。
      </p>
      <button type="button" onClick={onOpenConditionLookup} className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500">
        打开条件查询
      </button>
    </div>
  );
}
