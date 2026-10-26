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

describe('服务器脚本和模板里的指路不能指向不存在的文件', () => {
  it('不再引用不存在的 server/README.md', async () => {
    for (const name of ['opend.conf.template', 'install-opend.sh', 'install-futu-assistant.sh']) {
      const text = await readFile(`server/${name}`, 'utf8');
      expect(text).not.toContain('server/README.md');
    }
  });
});
