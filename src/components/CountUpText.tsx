import { useEffect, useRef } from 'react';

// 已经格式化好的金额文字（"$1,234,567.89"、"-¥3,450"、"12.5%"）里那段数字。
const NUMBER = /\d[\d,]*(?:\.\d+)?/;

interface Parsed { value: number; decimals: number; grouped: boolean; before: string; after: string }

function parse(text: string): Parsed | null {
  const match = NUMBER.exec(text);
  if (!match) return null;
  const raw = match[0];
  const value = Number(raw.replace(/,/g, ''));
  if (!Number.isFinite(value)) return null;
  return {
    value,
    decimals: raw.includes('.') ? raw.split('.')[1].length : 0,
    grouped: raw.includes(','),
    before: text.slice(0, match.index),
    after: text.slice(match.index + raw.length),
  };
}

function render(value: number, shape: Parsed): string {
  const number = value.toLocaleString('en-US', {
    minimumFractionDigits: shape.decimals,
    maximumFractionDigits: shape.decimals,
    useGrouping: shape.grouped,
  });
  return `${shape.before}${number}${shape.after}`;
}

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/**
 * 显示一段格式化好的数字文字：第一次出现时从 0 滚到目标值，之后数值变了就从旧值滚到新值，
 * 同时按涨跌闪一下绿 / 红。只改屏幕上的文字，最终显示的永远是传进来的原文，不改任何计算。
 * 服务器渲染和测试里直接就是最终文字。
 */
export function CountUpText({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef<string | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const write = (value: string) => {
      // 改 React 自己的那个文字节点，不替换节点，React 之后更新还能对上
      if (node.firstChild && node.firstChild.nodeType === Node.TEXT_NODE) node.firstChild.nodeValue = value;
      else node.textContent = value;
    };
    const from = shown.current;
    shown.current = text;
    const target = parse(text);
    const start = from === null ? (target ? { ...target, value: 0 } : null) : parse(from);
    if (reducedMotion() || !target || !start || start.before !== target.before || start.after !== target.after || start.value === target.value) {
      write(text);
      return undefined;
    }
    if (from !== null) {
      node.classList.remove('number-flash-up', 'number-flash-down');
      void node.offsetWidth; // 让同一个 class 能再触发一次动画
      node.classList.add(target.value > start.value ? 'number-flash-up' : 'number-flash-down');
    }
    const duration = from === null ? 900 : 500;
    const began = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - began) / duration);
      const eased = 1 - (1 - progress) ** 3;
      write(progress < 1 ? render(start.value + (target.value - start.value) * eased, target) : text);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    write(render(start.value, target));
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      write(text);
      // 第一次的滚动被打断（比如开发模式下 React 故意挂载两次），下次重新从 0 滚
      if (from === null) shown.current = null;
    };
  }, [text]);

  return <span ref={ref} className={className}>{text}</span>;
}
