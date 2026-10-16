# 决策页：简洁模式与信息层级发布记录

发布：2026-10-06 05:26 UTC（洛杉矶 2026-10-05）。用户已明确授权修改并直接上线。

## 范围

- 默认简洁模式：标的 → 当前行动 → 最关键原因 → 下一步关注。股票代码、行动、差额及参考价加粗。
- 绿色买入／加仓，红色卖出／减仓，蓝色持有，灰色等待，琥珀色待核查；同时保留文字与符号，颜色不是唯一依据。
- 指标模式保留原回撤、年化斜率、8 日 SMA、PE 历史位置、Z-Score 和观察分区。
- 右侧首先说明现在怎么做、为什么、下一步关注；买卖依据、回撤、过热统计、PE、露头、口径默认折叠。标的标题在桌面侧栏内保持可见。
- 桌面并排；窄屏点击行定位到该标的依据，可返回列表。默认选中的 NVDA 在首屏列表可见。
- 主表、斜率图、PE 图仍共用选择。保留小型 200DMA 技术提醒，不恢复已移除的大红色警告。

## 决策边界（仅展示，不改策略）

`decisionAction.ts` 只汇总已有服务器裁决，不新增综合分数、交易阈值、PE 买入否决或自动下单。

- 买入：必须同时满足原 `buildCompactBuyDecision` 入场条件和 `final_verdict=BUY`。PE 缺失／技术斜率提醒不擅自否决原 BUY。
- 卖出：使用已有 `sell.decision=SELL` 及其原比例，且明确属于当前正股／ETF 持仓；组合／期权／杠杆持仓范围不明确时提示核查，不将家族比例套用为单股订单。
- 持有：必须实际持有，卖出规则为 WAIT，成本、判断依据和趋势有效，且没有已知严重趋势／组合敞口提示。不能把 NO_BUY 或缺失卖出数据直接翻译为持有。
- 数据过期、时间无效、缺失裁决、BUY/SELL 同时触发、卖出比例异常等显示待核查。
- 与卖出页共用已有 PE 冲突检查（抽至 `sellStatus.ts`），不改变卖出页原算法。
- Z 正负观察分区、露头、过热和 PE 分位不独立产生买卖指令；继续持有不是收益或安全保证。
- 未改后端引擎、行情采集、推送开关／时间或通知阈值；未提交交易。

## 验收

- `npm test`：99 个文件、771 项通过（新增展示逻辑和简洁模式回归覆盖）。
- `npm run build`：通过；保留既有大 bundle 提示，无构建错误。
- `npm run lint`：通过。
- 浏览器使用真实 API 数据：默认简洁模式、指标模式、观察筛选、右侧折叠、键盘 Enter 选行、股票与指数选择以及斜率／PE 联动。
- 检查宽度 375、390、768、1024、1280、1440、1920，无页面水平溢出；深浅主题可读。
- 线上 https://www.myopenid.top/ 加载新版 JS；QQQ、MSFT、DIA 的主表／右侧／图表同步。390px 手机模拟点击 DIA 后详情顶端约 180px，未被页头遮挡，返回列表有效。
- 线上浏览器控制台：0 errors、0 warnings；页面异常 0。
- 物理 iPhone 尚未另行实机验收；上述为 Chromium 响应式模拟，不声称物理机测试。

截图：

- `output/playwright/clarity-live-desktop.png`
- `output/playwright/clarity-live-mobile-dark.png`
- `output/playwright/clarity-check-desktop-dark.png`
- `output/playwright/clarity-check-mobile-detail.png`

## 部署与回滚

- 新版：`/opt/portfolio-tracker-releases/20261006T052546Z-decision-clarity`
- 上一版保留：`/opt/portfolio-tracker-releases/20261006T045217Z-overheat-context`
- 完整复制旧 release，只上传 `dist/`（排除 `runtime-config.js`），校验后原子替换 `/opt/portfolio-tracker-current` 符号链接。
- gateway 目录 `diff -qr` 无差异，运行时配置 `cmp` 相同；没有重启服务，所有原 PM2 PID 保持 online。
- `/api/health` 返回 `ok=true`；公网资源与本地构建 SHA-256 一致。

| 资源 | SHA-256 |
| --- | --- |
| `index-EBFSS_bA.js` | `22f1f5178732f9bff5fcb18735ea21b3923c74c89228fabdb3ef946338cd0d0f` |
| `index-D7kaDlOH.css` | `172d4f5ba8c7909da490577790c35eaf869e10c93409942f9bd18b4ab1b4025d` |
| 原运行时配置（保持不变） | `e05ffdfa923be14201736f4582f658162121d5c71e54f5c95ad0179d1b51b7f1` |

后续仅在用户要求时调整展示优先级或行动口径，不以增强信心为由隐藏风险或擅自修改策略。
