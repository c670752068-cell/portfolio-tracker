# 去掉 Mac 依赖 · 交付报告

日期：2026-10-25
分支：claude/zen-wozniak-b62bda → main
线上：https://myopenid.top（已部署并验证）

**一句话结论**：服务器已经具备接管的条件（软件装好、代码写好、测试全过、页面没动），但**还没有接管**。网站现在的数据来源仍然是 Mac，一个字都没改。要真正切换，必须等你回来做登录这一步。

---

## 一、我回来后要做的事

按顺序做，每一步做完再做下一步。涉及账号、密码、验证码、token 的地方**全部由你自己输入**，我没有读取、保存或询问过任何一项。

### 第 1 步：~~下载安装包~~ 已经做完了

原本这一步要你自己下载再传上去。后来在文档页里点出了直链，服务器自己下完装好了，你不用做任何事。

- 来源：`https://softwaredownload.futunn.com/Futu_OpenD_10.11.7108_Ubuntu18.04.tar.gz`（富途官方，腾讯云 COS）
- 大小 467,914,895 字节，MD5 `c79d54658b9f9408007e5dc902e781ff`，与官方 etag 一致
- 版本 10.11.7108，和服务器上已装的 `futu-api 10.11.7108` 对得上
- 压缩包留在 `/opt/futu-opend-download/`（446 MB），万一要重装不用再下
- 已解压到 `/opt/futu-opend/`，配置模板已生成在 `/opt/futu-opend/OpenD.ini`

兼容性也验过了（官方只提供 Ubuntu 18.04 的包，我们是 24.04）：

```
ldd FutuOpenD | grep "not found"   → 没有缺库
objdump -T 需要的最高 glibc        → GLIBC_2.14（系统是 2.39）
实跑一次                            → Futu OpenD版本信息: 10.11.7108(20260916134500)
                                      Futu OpenD运行中
```

**18.04 的包在 24.04 上能跑。**

### 第 2 步：填 OpenD 的配置并首次登录（要手机验证码）

安装脚本已经把配置模板放好了（`/opt/futu-opend/OpenD.ini`，权限 600），直接编辑它：

```bash
ssh root@67.215.255.196
nano /opt/futu-opend/OpenD.ini
```

把三个 `<<<...>>>` 占位符换成你自己的：`login_account`（富途账号）、`login_pwd_md5`（登录密码的 MD5）、`api_port` 保持 11111。
**配置里没有、也不要加交易解锁密码**（`trade_pwd` / `trd_env` 这类字段一律不填）——服务器上的 OpenD 只用来看行情和查持仓。

第一次要在前台跑，因为会要手机验证码：

```bash
cd /opt/futu-opend && ./FutuOpenD -cfg_file=/opt/futu-opend/OpenD.ini
```

屏幕上出现 `input_phone_verify_code` 这类提示时，在同一个窗口里敲：

```
input_phone_verify_code -code=你收到的6位验证码
```

看到登录成功、行情连接正常后，`Ctrl+C` 退出，然后交给 systemd 托管：

```bash
systemctl enable --now futu-opend
systemctl status futu-opend --no-pager
```

验证只监听本机、外面连不上：

```bash
bash /opt/portfolio-server-setup/check-firewall.sh 11111
```

应该打印「检查通过：OpenD 端口只在本机可用。」如果不是，**先不要继续**。

### 第 3 步：填 IBKR Flex 的 token

IBKR 这边是只读的 Flex Web Service，不需要 TWS、不需要网关程序。

1. 在 IBKR 账户管理里：Performance & Reports → Flex Queries，拿到 **Flex Web Service token** 和**持仓查询的 Query ID**。
2. 在服务器上：

```bash
ssh root@67.215.255.196
cp /opt/portfolio-tracker-gateway/ibkr-flex.config.template.json /opt/portfolio-tracker-data/ibkr-flex.config.json
chmod 600 /opt/portfolio-tracker-data/ibkr-flex.config.json
nano /opt/portfolio-tracker-data/ibkr-flex.config.json
```

把 `token` 和 `positionsQueryId` 两个占位符填上。

3. 试一次（只打印，不写任何文件）：

```bash
cd /opt/portfolio-tracker-gateway && node fetch-ibkr-flex.mjs
```

能打印出账户号和持仓条数就算通了。

### 第 4 步：填 futu-assistant 的配置

```bash
ssh root@67.215.255.196
cp /opt/futu-assistant/config/channels.yaml.template /opt/futu-assistant/config/channels.yaml
chmod 600 /opt/futu-assistant/config/channels.yaml
nano /opt/futu-assistant/config/channels.yaml
```

里面 `bark` 默认是关的（`enabled: false`）——**先别打开**，等并行对比看下来没问题再说，免得同一条提醒你手机上收到两遍。
`trade_env` 固定写 `SIMULATE`，`ibkr_flex` 的 token 指向第 3 步那个文件。

自检一次（只读，不下单）：

```bash
cd /opt/futu-assistant && .venv/bin/futu-assistant opend-selfcheck
.venv/bin/futu-assistant positions-status
```

### 第 5 步：开并行对比，看几天

这是**最关键的一步**：让服务器自己算一份，跟 Mac 推上来的那份逐项比，**但网站还是只用 Mac 那份**。

手动跑一次看看：

```bash
ssh root@67.215.255.196 'cd /opt/portfolio-tracker-gateway && node compare-sources.mjs'
```

要看什么：

| 项目 | 容差 | 超了说明什么 |
|---|---|---|
| 每只股票的股数 | 必须完全一样 | 两边券商接口对不上，先别切 |
| 每只股票的市值 | 1% 以内 | 多半是取价时间差，可以接受 |
| 总净值 NAV | 0.5% 以内 | 超了说明有持仓漏了或多了 |
| QQQ 回撤 | 0.5 个百分点以内 | 超了说明历史数据源不一致 |
| CNN 恐慌贪婪 | 2 分以内 | 超了说明抓取时间差太大 |
| 纳指 PE | 1 以内 | 超了说明估值源不一样 |

还有 `missing_on_server` / `missing_on_mac` 两类——**任何一条出现都不能切**，说明有持仓两边对不上。

想让它每小时自动比一次、差异写进日志页（只写系统提醒，不推手机）：

```bash
ssh root@67.215.255.196 'crontab -l 2>/dev/null; echo "0 * * * * cd /opt/portfolio-tracker-gateway && /usr/bin/node compare-sources.mjs --write-alert >> /var/log/source-compare.log 2>&1" | crontab -'
```

**建议至少看满 3 个完整交易日**（含一个夜盘），全程没有红项，再考虑第 6 步。

### 第 6 步：切换数据来源（**只有你确认了才做**）

我没有写任何自动切换的逻辑。切换是改一个配置文件，两条命令：

```bash
ssh root@67.215.255.196
nano /opt/portfolio-tracker-gateway/server-worker.config.json
# enabled 改成 true；push 先保持 false，观察一天再改 true
pm2 restart portfolio-tracker
```

`enabled: true` 之后，服务器上的 worker 只有在**检测到 Mac 已经 90 分钟没推东西**时才会接手（`takeoverAfterMinutes: 90`）。Mac 还活着的时候它什么都不做，所以不会出现两边抢着干的情况。

### 第 7 步：怎么回退

| 想回退什么 | 怎么做 |
|---|---|
| 服务器 worker 接管 | `server-worker.config.json` 改回 `{"enabled": false, "push": false}` → `pm2 restart portfolio-tracker` |
| 服务器 OpenD | `systemctl disable --now futu-opend` |
| futu-assistant | `systemctl disable --now futu-assistant` |
| 整个这次改动 | `tar xzf /root/backups/pre-nomac-20261025-170423.tar.gz -C /` → `pm2 restart portfolio-tracker` |
| 本地代码 | `git revert` 本次合并提交，重新 `npm run build && bash deploy/deploy-us-vps.sh` |
| 多出来的 2 GB 交换分区 | `swapoff /swapfile-portfolio && rm /swapfile-portfolio`，再从 `/etc/fstab` 删掉那一行 |

Mac 上的东西我一个都没动，所以 Mac 这边不需要回退。

---

## 二、现在 Mac 上到底跑着什么

| 名字 | 做什么 | 停了会怎样 |
|---|---|---|
| `com.portfolio.sync`（launchd） | 每 10 分钟把持仓和量化快照推到服务器 | 持仓、回撤、PE、均线、Z 全部停在最后一次 |
| `com.portfolio.overnight-quotes`（launchd） | 每 60 秒把 OpenD 的夜盘报价推到服务器 | 夜盘变成「无报价」，退回 Nasdaq |
| `com.portfolio.refresh-watch`（launchd） | 盯着网站的刷新请求，收到就重算 | 页面上的「立即刷新」按钮失效 |
| `com.wuhuazhou.futu-assistant`（launchd） | 定时推送（晨间汇总、收盘检查等 14 项任务） | 手机收不到按点推送 |
| Futu OpenD GUI（桌面程序） | 上面两个的行情来源 | 持仓和夜盘报价都断 |

**服务器自己已经在做的**（Mac 关机也照常）：实时报价、三大指数/期货、板块轮动、所有提醒的触发和日志、整个网站。

所以 Mac 实际上只卡着三件事：**券商持仓、量化快照（回撤/PE/均线/Z/卖出线）、夜盘报价**。

---

## 三、服务器扛不扛得住

| 项目 | 实测 | 结论 |
|---|---|---|
| CPU | 1 核 | 够，这些活都是 IO 等待为主 |
| 内存 | 961 MiB 总量，原先只剩约 292 MiB 可用 | **原本是瓶颈** |
| 磁盘 | 剩 12 GB | 够 |
| 系统 | Ubuntu 24.04，glibc 2.39，Python 3.12.3，Node 20，PM2 6 | OpenD 和 futu-assistant 都支持 |

内存是唯一真问题：OpenD 大概要 200–400 MB，futu-assistant 跑起来 150–300 MB，加一起会把这台机器挤爆（上面还有 stockpulse 占着约 250 MB）。

**处理办法**：加了一个 2 GB 的交换文件 `/swapfile-portfolio`，已写进 `/etc/fstab`，现在总交换 3.0 GiB。这个改动可逆（见上面回退表）。两个 service 文件里也都加了内存上限（OpenD 450M、futu-assistant 400M），单个进程失控不会拖垮整机。

**老实说**：这台机器同时跑 OpenD + futu-assistant + 现有服务，会比较紧，靠交换分区顶着。如果以后觉得慢，最省事的办法是把内存加到 2 GB。

---

## 四、这次做了什么

### 服务器上（已装好，**没启动、没登录**）

- `/opt/futu-opend/` —— 已安装（10.11.7108，MD5 校验过），配置模板 `OpenD.ini` 已就位，**没有启动、没有登录**
- `/opt/futu-assistant/` —— 代码已从 Mac 同步过去，Python 虚拟环境和全部依赖已装好，`futu-assistant --help` 跑得通
- `/etc/systemd/system/futu-opend.service`、`futu-assistant.service` —— 已注册，状态都是 `disabled` + `inactive`
- `/opt/portfolio-server-setup/` —— 安装脚本、配置模板、防火墙检查脚本
- 同步代码时**排除了** `.venv`、`.git`、`__pycache__`、`config/channels.yaml` 和 sqlite 数据——已确认 `channels.yaml` 没有被带上去

### 安全这块

- 配置模板里所有敏感字段都是 `<<<...>>>` 占位符，**没有任何真实账号、密码、token 进入代码或仓库**
- `opend.conf.template` 里**没有交易解锁密码字段**，代码里也没有任何下单调用
- `OpenD.ini` 写死 `ip=127.0.0.1`，只监听本机
- `check-firewall.sh` 做四项检查（监听地址、ufw 规则、公网自连、进程归属），现在的结果是「11111 没有监听」——符合预期，因为 OpenD 还没启动

### 新代码（全部先写测试再写实现）

| 文件 | 做什么 | 测试 |
|---|---|---|
| `deploy/ibkr-flex.mjs` | 服务器直接拉 IBKR Flex 持仓（两步式：SendRequest → GetStatement） | 11 项，全用假 XML |
| `deploy/source-compare.mjs` | 两边数据逐项对比 + 差异写成系统提醒 | 8 项 |
| `deploy/data-sources.mjs` | 每样数据是谁在供、最后什么时候更新、OpenD 掉线提醒 | 10 项 |
| `deploy/server-worker.mjs` | 服务器端推送 worker，默认关，Mac 活着时不动手 | 10 项 |
| `src/dataSources.ts` | 前端取数据状态、把时间说成人话 | 6 项 |
| `src/components/DataSourceStatusPanel.tsx` | 设置页「数据状态」卡片 | 4 项 |
| `deploy/fetch-ibkr-flex.mjs` | 手动验 IBKR token 的小工具 | — |
| `deploy/compare-sources.mjs` | 手动/定时跑并行对比的小工具 | — |

### 改动的老文件

- `deploy/aliyun-gateway.mjs` —— 加了 `GET /api/portfolio/data-sources` 这个只读接口；把服务器 OpenD 的状态接进提醒循环（还没配置时不报警）
- `deploy/deploy-us-vps.sh` —— 上传并 `node --check` 三个新模块
- `src/components/SettingsPanel.tsx` —— 设置页加一张「数据状态」卡片
- `src/runtimeConfig.ts` —— 加了新接口的地址

**总览、板块轮动、决策、卖出、日志这五个页面一行都没改。**

---

## 五、测试结果

```
npx vitest run     →  Test Files  147 passed (147)
                      Tests      1450 passed (1450)
npx eslint .       →  退出码 0，零告警
npm run build      →  built in 651ms
```

部署前备份：`/root/backups/pre-nomac-20261025-170423.tar.gz`（4.3 MB，含全部数据和网关代码）

### 线上验证（部署后实测）

接口：

```
/api/health                    200
/api/portfolio/positions       200   净值 184,255 → 185,002（两次调用在变，说明 Mac 数据照常进）
/api/portfolio/quant-analysis  200
/api/portfolio/decision-log    200   revision 69
/api/portfolio/data-sources    200   新接口
/api/quotes?symbols=QQQ        200   704.88
```

页面（桌面 + 375 px 手机两档都测了）：

| 页面 | 渲染 | 横向滚动 | JS 报错 |
|---|---|---|---|
| 总览 | 正常 | 无 | 无 |
| 板块轮动 | 正常 | 无 | 无 |
| 决策 | 正常 | 无 | 无 |
| 卖出 | 正常 | 无 | 无 |
| 日志 | 正常 | 无 | 无 |
| 设置 → 数据状态 | 正常 | 无 | 无 |

「数据状态」卡片线上实际显示：

```
持仓与现金      · 本机（Mac）  30 分钟前
量化快照        · 本机（Mac）  29 分钟前
夜盘报价        · 本机（Mac）  现在不用
定时推送        · 本机（Mac）  0 分钟前
实时报价        · 服务器      服务器实时取数
三大指数 / 期货 · 服务器      服务器实时取数
板块轮动        · 服务器      服务器实时取数
服务器 OpenD    · 服务器      未配置
```

Mac 侧确认一切照旧：

```
launchctl list → com.portfolio.sync / com.portfolio.overnight-quotes /
                 com.portfolio.refresh-watch / com.wuhuazhou.futu-assistant   都在
Futu OpenD GUI 进程   在
```

服务器侧确认没擅自启动：

```
systemctl is-enabled futu-opend futu-assistant  → disabled  disabled
systemctl is-active  futu-opend futu-assistant  → inactive  inactive
ss -ltnp | grep 11111                           → 没有监听
```

---

## 六、不确定的地方，和我替你做的默认决定

| 情况 | 我怎么处理的 | 为什么 |
|---|---|---|
| OpenD 的 Linux 安装包一开始拿不到（直接猜路径返回 404） | 后来在文档页里点出了官方直链，服务器自己下载安装，校验 MD5 与官方 etag 一致 | 不猜链接；下完先核对校验和再解压 |
| OpenD 在没有终端时会一直刷 `>` 提示符（15 秒 91 KB） | service 的输出从「无上限 append 到文件」改成写 journal（自带限流和容量上限） | 真配置下会不会也这样我没法先验，先把最坏情况挡住 |
| 内存不够 | 加 2 GB 交换文件，service 里设内存上限 | 比加内存便宜，而且随时能撤 |
| 服务器 worker 什么时候该接手 | 默认 `enabled: false`；就算开了也要等 Mac 静默 90 分钟 | 宁可漏推，也不能两边重复推 |
| futu-assistant 的推送通道 | 模板里 `bark.enabled: false` | 并行对比阶段不该让你手机收两份 |
| `trade_env` | 模板里写死 `SIMULATE` | 这台机器永远不该真下单 |
| 夜盘报价白天显示「已过期」 | 改成非夜盘时段显示「现在不用」，且不参与「Mac 是否还活着」的判断 | 原来会在白天误报一个红字 |
| IBKR 的查询编号 | 没猜，留成占位符 | 不同账户编号不同 |

### 还没验证的部分（必须等你登录之后才能验）

- 服务器上的 OpenD 填了真配置之后会不会仍然刷提示符（现在是占位符，它读不动就直接「加载本地配置失败」退出了）
- 服务器上的 OpenD 能不能连上富途、行情权限够不够（Mac 上的 OpenD 查过：美股指数「暂不支持」，美股期货要付费，这些在服务器上大概率一样）
- IBKR Flex 的 token 和查询编号对不对——取数逻辑只用假 XML 测过，没碰过真实接口
- 服务器自己算出来的量化快照和 Mac 那份差多少——这正是第 5 步并行对比要回答的问题
- 同时跑 OpenD + futu-assistant 时这台机器的真实内存表现

---

## 七、顺带发现的两个小问题（都没动，留给你决定）

PM2 的错误日志里有两条历史记录：

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
'/opt/portfolio-tracker-gateway/refresh-request-route.mjs'
```

是**以前某次部署**留下的——那次新增了 `refresh-request-route.mjs` 但部署脚本还没把它加进上传列表。文件现在是在的（17:09 上传），进程也是 online，整个日志里只有这两条，不是这次引入的。真要根治，是在 `deploy-us-vps.sh` 里把「先传完所有文件、再重启 PM2」的顺序卡死。跟这次任务无关，我没动。

### 2. 周末的「三大指数 · 期货」卡片会显示很大的延迟数字

今天（周六）线上实际显示「延迟 2663 分钟」，约等于 44 小时，正好是周五收盘到现在。数字本身没算错，但周末看着像出故障了。这是上一轮做指数卡片时就有的行为，不是这次引入的。要改的话，思路是休市且跨周末时把延迟换成「周五收盘价」之类的说法。跟这次任务无关，我没动。
