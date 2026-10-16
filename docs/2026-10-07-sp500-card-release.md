# 标普500估值卡片 — 2026-10-07

## 范围

- 在共享市场指标栏的纳指100与 VIX 之间加入标普500估值；总览、决策页同步显示。
- 复用 `pe_history.symbols.SPX` 的 TTM PE、近五年历史分位及中位数，与现有决策主表保持同口径。
- 双击或键盘回车打开用户提供的来源：<https://danjuanfunds.com/dj-valuation-table-detail/SP500>。
- 仅修改展示；不添加标普买卖阈值，不套用纳指的 PE 35 警戒线，不修改裁决或推送逻辑。
- 沿用现有主题，应用 Apple Design 的简洁层级与响应式布局原则：宽屏四卡并排，窄屏纳指与标普相邻；日期不截断，缺失数据不补造。

## 数据核对

发布验收时统一快照为 `2026-10-07T02:19:53.916699-04:00`，SPX 数据为：

- PE 25.1434，显示 25.14；历史分位 39.76834%，显示 39.77%。
- 中位数显示 25.81；历史区间 2021-09-29 至 2026-09-29，259 个周度观测值。
- 标明历史数据日期，不把整体快照时间当作估值更新时间。
- 来源网页默认区间/分位口径与网站近五年采样历史分位不同；不将默认网页分位冒充五年分位。
- 当前已存在同步数据，未新增抓取任务；不改现有采集或日期归一逻辑。
- 无 SPX 数据、仅有预测 PE、无分位/日期或 PE 非法时明确显示暂无/未知，不能使用纳指值、0 或统一快照时间填补。

## 验证

- 105 个测试文件，827 项测试通过；lint、build、git diff --check 通过。构建保留原有大 bundle 提示。
- 新增 13 项卡片测试：位置、来源链接、真实口径、分类、缺失/非法值、历史窗口与日期、输入不被修改。
- 只读本地预览：1440、1280、1024、768、390、375px 宽度均无整页横向溢出，纳指与标普始终相邻；深浅主题截图检查。
- 实际浏览器确认双击与键盘回车打开 SP500 页面，而非 NDX 页面。
- 正式域名刷新后总览与决策页均有新卡片，1440px 桌面及 390px 手机布局模拟通过，真实跳转正确，控制台 0 errors / 0 warnings。
- 手机为浏览器视口模拟验证，未声称手机实机验证。

截图：`output/playwright/sp500-card-live-desktop.png`、`sp500-card-live-mobile.png`、`sp500-card-local-dark.png`。

## 发布与回退

- 网站：<https://www.myopenid.top/>。
- 当前 release：`/opt/portfolio-tracker-releases/20261007T063300Z-sp500-card`。
- 上个 release：`/opt/portfolio-tracker-releases/20261006T150300Z-decision-answer`。
- 克隆上一版本，只覆盖 web 构建，保留 runtime-config 与旧哈希静态资源；gateway 逐文件比对无差异。
- 原子切换 current 链接；未重启服务，发布前后 portfolio-tracker PID 均为 964511。
- 内网与正式域名 `/api/health` 均返回 ok。
- 回退可原子切回上个 release 的 current 链接；无服务端代码变更，不需重启。

本地、服务器与正式域名静态资源 SHA-256 一致：

- JS `index-Djd-CD-G.js`：`311d538a9d1ca300fa367d237ab4c8319614f793b5ccf388c67056ae483085f8`。
- CSS `index-DEjPNVPS.css`：`aff1e7dd61df6abd3a0240b9dde5a26b88b63550c65a55bfbfd5fa13a816e8a7`。
- runtime-config 保持：`e05ffdfa923be14201736f4582f658162121d5c71e54f5c95ad0179d1b51b7f1`。

本轮源码文件为 `src/components/ValuationPanel.tsx` 和新增的 `src/components/MarketIndicators.test.tsx`；原工作区已有修改保持不变。
