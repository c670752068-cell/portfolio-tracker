import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('服务器 systemd 单元', () => {
  it('丢弃 OpenD 的控制台输出：它每分钟刷 2 MB 提示符，自己另有日志文件', async () => {
    const unit = await readFile('server/futu-opend.service', 'utf8');
    expect(unit).not.toContain('append:');
    expect(unit).toContain('StandardOutput=null');
    expect(unit).toContain('StandardInput=null');
  });

  it('用 console=1 常驻前台，否则父进程立刻退出、systemd 会反复重启', async () => {
    const unit = await readFile('server/futu-opend.service', 'utf8');
    expect(unit).toContain('-console=1');
    expect(unit).not.toContain('-console=0');
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

describe('OpenD 配置按官方 XML 格式', () => {
  it('配置模板是 XML，只监听本机，不开 websocket', async () => {
    const xml = await readFile('server/opend.xml.template', 'utf8');
    expect(xml).toContain('<futu_opend>');
    expect(xml).toContain('<ip>127.0.0.1</ip>');
    expect(xml).toContain('<api_port>11111</api_port>');
    expect(xml).not.toMatch(/^\s*<websocket_port>/m);
  });

  it('配置模板里没有账号密码（它们是启动参数，不入配置文件）', async () => {
    const xml = await readFile('server/opend.xml.template', 'utf8');
    expect(xml).not.toMatch(/login_account|login_pwd/);
  });

  it('service 启动时不带密码，靠首次登录记住的凭据', async () => {
    const unit = await readFile('server/futu-opend.service', 'utf8');
    expect(unit).toContain('-login_by_remember=1');
    expect(unit).not.toContain('login_pwd');
    expect(unit).toContain('-cfg_file=/opt/futu-opend/OpenD.xml');
  });
});

describe('首次登录脚本', () => {
  it('从 600 权限的凭据文件读密码哈希，不把它写进命令行提示里', async () => {
    const script = await readFile('server/first-login.sh', 'utf8');
    expect(script).toContain('/opt/futu-opend/credentials');
    expect(script).toContain('-login_account=');
    expect(script).toContain('-console=1');
    expect(script).not.toMatch(/echo.*\$MD5|echo.*\$HASH/);
  });
});
