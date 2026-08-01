const MISSING_MARKERS = ['缺失', '暂无', '不可用', '未生成', '数据不足'];

/** A gate that passed only because its inputs are missing is not a pass. */
export function isHonestPass(passed: boolean | undefined, reason: string | null | undefined): boolean {
  return passed === true && !MISSING_MARKERS.some((marker) => (reason ?? '').includes(marker));
}
