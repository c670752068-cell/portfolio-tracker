export function extractFirstJsonObject(stdout) {
  const input = String(stdout);
  const start = input.indexOf('{');
  if (start < 0) throw new Error('positions-status 输出中没有 JSON 对象');
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < input.length; index += 1) {
    const character = input[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) return JSON.parse(input.slice(start, index + 1));
    }
  }
  throw new Error('positions-status 输出中的 JSON 对象不完整');
}
