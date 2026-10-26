import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('服务器 systemd 单元', () => {
  it('OpenD 的输出不写进没有上限的文件，交给 journal 限流', async () => {
    const unit = await readFile('server/futu-opend.service', 'utf8');
    expect(unit).not.toContain('append:');
    expect(unit).toContain('StandardOutput=journal');
    expect(unit).toContain('StandardError=journal');
  });

  it('OpenD 只读行情：不开机自启、不含交易解锁密码、有内存上限', async () => {
    const unit = await readFile('server/futu-opend.service', 'utf8');
    expect(unit).toContain('MemoryMax=');
    expect(unit).not.toMatch(/trade_pwd|unlock/i);
  });
});
