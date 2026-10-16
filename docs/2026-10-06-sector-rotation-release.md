# 板块轮动与决策视觉整理 — 2026-10-06

## 已发布

- 网站：https://www.myopenid.top/
- 版本：`/opt/portfolio-tracker-releases/20261006T125508Z-sector-rotation`
- 上一版本（保留可回退）：`/opt/portfolio-tracker-releases/20261006T055333Z-sma-downside`
- 仅替换本站前端、给现有网关增加只读行情模块，重启 `portfolio-tracker` 一个进程；不改 Nginx、防火墙、其他应用、持仓、买卖裁决和通知设置。
- 线上网关与本地既有文件比对：发布前仅有本次新增 import、路由实例和 GET 路由入口三处差异。保留线上 runtime-config，SHA-256 发布前后相同。

## 设计图的落地与修正

三张图无需重新生成。采用第二张图的负斜率强调方式，结合第一张图的 PE 历史位置颜色条。主表左侧、判断详情独立右侧卡片；观察信号提前；重点数值加粗；初始六行可展开。右侧收起重复依据，保留详细统计、日期与口径入口。

保留原有规则：Z 正负观察分区不等于正式买卖；负回撤只改变展示符号；SMA 20 日线 8 日回看与 200DMA 20 日回看年化不能混用；上涨峰值后 10 日回落至少 3%、下降谷底后 10 日反弹至少 3% 的历史统计不变。没有恢复简洁模式或大幅红色 200DMA 警告横幅。

## 板块轮动

- 独立 tab：总览 / 板块轮动 / 决策 / 卖出 / 设置。
- SPY 为比较基准；XLK、XLC、XLE、XLY、XLF、XLI、XLP、XLV、XLB、XLU、XLRE 表示 11 个板块。
- 1月 / 3月 / 6月 / 1年分别为 21 / 63 / 126 / 252 个交易日，统一基准日期；缺点、短历史不换日期或补值。
- 数据：Yahoo Finance 美元拆股及分红调整收盘价；拒绝原始价格回退。不是全部标普成分股重新编制的板块指数。
- “较标普”是标的区间收益减 SPY 区间收益，单位**百分点**。右侧是两条起点 100 的复权表现线；表内短走势才是归一化的相对比值。
- 周度模型：RS = 标的复权价 / SPY 复权价；横轴 = 100 × RS / 10 周 RS 均值；纵轴 = 100 × 横轴 / 4 周横轴均值。只取已结束周的最后交易日，最近 12 周轨迹；四象限与表现区间独立。此为透明自定义模型，**不是专有 JdK RRG 或 RSI**。
- 图点（鼠标/键盘）、下拉框、排名选择与右侧详情联动；排名可升降序；关注股票分别比较 SPY 与板块，可跳回对应股票决策，并联动下方斜率/PE 图。
- 当前关注股票采用明确维护的行业映射，允许非标普成分股及 ADR；多行业指数、商品、杠杆产品和未知分类不强行归入单一板块，完整清单可在说明里查看。
- 只读新接口 `/api/portfolio/sector-rotation`：3 个并发上游、每批最多12代码、15分钟缓存、失败重试限频、持久化最后成功结果、过期/缺失提示。不会触发通知或交易。
- 当日正常收盘后20分钟才纳入；支持现有2026假期与半日市日历。其他年份明确显示日历需核验，需后续年度维护。

方法参考：

- [StockCharts Price Relative](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/price-relative-relative-strength)
- [StockCharts RRG Relative Strength](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/rrg-relative-strength)
- [Select Sector SPDR 官方板块资料](https://www.sectorspdrs.com/api/documents/by-fullname/General%20Documents/2025%20Investing%20With%20Sector%20SPDRs)

## 验证记录

- `npm test`：103 文件、810 项通过；`npm run lint`、`npm run build`、`git diff --check` 通过。
- 构建仍提示现有主 JS 大于500KB，为体积提示，不是编译错误；本次没有扩展为全站拆包重构。
- 单元覆盖收益差与相对比值区别、涨跌同向但相对强弱不同、完整周期/缺失值、四象限、中轴、周轨迹缺口、调整价、币种/代码校验、节假日/半日市、缓存/失败恢复/限频/并发/只读接口。
- 独立计算复核：11板块 × 4周期 = 44 组收益差，误差 < 1e-9；全部具备12个周度轨迹点。
- 上线 12:56 UTC 后实际域名接口返回 SPY + 11板块全部 available=true、stale=false，各500个日线点；日线截至2026-10-05、周度截至2026-10-02，符合当时美东盘前时段。
- 在实际域名重跑浏览器验收：四周期、排序、板块/股票分类、键盘选点、个股跳转、深浅主题；375/390/768/1024/1280/1440/1920 px 均无页面横向溢出。手机排名局部横滑有说明。
- 实际点击 NVDA、DIA、TSLA，右侧详情与下方技术、PE选择器保持相同代码；六行 SMA 双向中位值均加载完成。
- 浏览器控制台 0 errors / 0 warnings。服务器健康正常，发布后仅预期的1次重启，没有观察到新异常重启。
- 手机为浏览器尺寸模拟，**未声称已做 iPhone/Android 实机测试**。不验证或操作真实交易、推送发送。

线上静态资产 SHA-256 与本地构建一致：

- JS `index-B5TITEbn.js`: `b2998f7d52ebc576f55c34bb8bdf5e2a158111f9979818dc49187258936ed751`
- CSS `index-DLJ-t_Z0.css`: `1e47aace63b7ff90cfc2e90f5000f40f6bee336ca8dec2056b72bb4fd53981ab`

截图（本地，未加入版本库）：`output/playwright/decision-live-ready.png`、`rotation-1440.png`、`rotation-watch-live-mobile.png`、`rotation-dark.png`。

## 后续维护与回退

行业映射及美股交易日历需要随分类/年份变动维护。相对强弱可以帮助观察，不保证上涨或未来轮动，不将其新增为买卖否决条件。

回退时将 `/opt/portfolio-tracker-current` 原子切回上述上一版本，再仅重启 `portfolio-tracker`。旧发布目录及静态资产保留；无需改持仓或通知数据。
