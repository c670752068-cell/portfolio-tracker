/** 打开就取一次，之后定时取；页面在后台不取，回到前台马上补一次。返回停止函数。 */
export function pollWhileVisible(pull: () => void, intervalMs: number): () => void {
  const tick = () => {
    if (document.visibilityState !== 'hidden') pull();
  };
  tick();
  const timer = window.setInterval(tick, intervalMs);
  document.addEventListener('visibilitychange', tick);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', tick);
  };
}
