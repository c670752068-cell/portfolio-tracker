# 当前任务（网站侧）：未持仓标的价格补齐 + PE 估值双基准

日期：2026-07-22
适用仓库：`portfolio-tracker`
执行方：网站侧 Codex

> **本文件自包含，是本轮唯一任务书。** 它取代并合并了 `修复方案-V14.1-未持仓标的价格补齐.md` 与 `修复方案-V15-PE估值双基准与免费数据源.md`；仓库里其他 `修复方案-V*.md` 均为已完成的历史记录，**本轮不需要再读**。
>
> 共 8 个 Phase：Part A（价格补齐，Phase 1–3）→ Part B（PE 估值，Phase 4–8）。按顺序做完。

---

## 0. 硬性规则（全程适用）

1. 只做本文件列出的任务；不新增 Tab、不重构组件结构、不新增付费数据源、不新增运行时依赖。
2. 每个 Phase：**先写会失败的测试并确认它真的失败（把失败输出贴进报告）** → 改实现变绿 → `npm run build` + `npm test` 全绿 → **单独 `git commit`** → **留验证报告** → 才进下一 Phase。
3. **网站是只读展示层**（最重要的边界）：
   - 不自造买入/卖出信号、不自造阈值、不自造成本、不自造价格；
   - 允许的文案：「距锚点 +3.7%」「已进入锚点区」「现价 $384.98」；
   - **禁止的文案**：「建议买入」「可买」「触发买入」——买入开窗判定永远归量化系统；
   - 无数据时如实显示「暂无」，**绝不显示 0 / NaN / Infinity 冒充**。
4. **不得修改 `src/depthPrice.ts` 的推算公式**（已验证正确，见第 1 节）。
5. 契约禁区：不改 `~/Projects/futu-assistant` 任何文件、不读 `config/channels.yaml`、不写 `store.sqlite`；完工验证 `git -C ~/Projects/futu-assistant status` 干净。
6. 中途不要停下来问方向；唯一允许暂停：部署时需要输入 SSH 密码。
7. **完工必须贴出三个 hash**（本地 `dist/assets/index-*.js` / 线上 VPS / 线上 Pages），三者一致才算部署生效。

---

## 1. 当前状态（已验收，无需返工）

上一轮（V13 + V14）已完成并部署：248 测试全绿，本地 = VPS = Pages = `index-fMVJS00k.js`。

其中价格推算部分**实现正确**，已逐项核实：

| 项 | 状态 | 证据 |
|---|---|---|
| 推算公式 | ✅ | `current_pct=-21.8, threshold_pct=-16.24, price=384.98` → 高点 492.30、阈值价 412.35，与手算一致 |
| 正负号稳健 | ✅ | 用 `Math.abs()`，量化给 `-21.8` 或 `21.8` 都正确 |
| 除零保护 | ✅ | `ZERO_EPSILON` 判断，无 NaN |
| 量化真值优先 | ✅ | 已预留读取 `depth.current_price / high_price / threshold_price` |
| `~` 与偏差说明 | ✅ | `derived` 时显示 |
| 25 分钟定时刷新 | ✅ | `QUANT_ANALYSIS_REFRESH_MS` + `visibilitychange` |

**所以 Part A 不是返工，只补一个方案措辞造成的盲区。**

---

# Part A：未持仓标的的价格补齐（Phase 1–3）

## A0. 问题

`ConditionLookup.tsx` 的 `depthQuotePrice(holdings, symbol)` **只遍历 `holdings`（用户持仓）**：

```ts
function depthQuotePrice(holdings: readonly Holding[], rawSymbol: string): number | null {
  for (const holding of holdings) {
    if (!holding.quote) continue;
    // ...只在持仓里匹配
  }
  return null;   // 未持有 → null → source='unavailable' → 价格整块不显示
}
```

结果：
- 用户**持有**的标的（NVDA / MSFT / TQQQ）→ 有价格 ✅
- 用户**未持有**但在量化监控池里的（**AVGO、MU、AAPL**）→ 无价格 ❌

**而「深度买入窗口」最有价值的场景，恰恰是发现还没买的标的的买入机会。**

补救路径已实测可行（用现有网关，零新增成本）：
```
GET http://67.215.255.196:8788/api/quotes?symbols=AVGO,MU,AAPL
→ AVGO $396.81 · MU $959.48 · AAPL $325.89   全部正常返回
```

## Phase 1：为量化监控池标的批量拉取报价

1. 新建 `src/monitoredQuotes.ts`（纯逻辑）+ `App.tsx` 调用：
   - 量化快照就绪时，取 `Object.keys(snapshot.symbols)` 作为监控池清单；
   - **排除**已在持仓中且已有 `quote` 的标的、以及现金等价物（`isCashEquivalent`）；
   - 用已有行情代理（`settings.quoteProxyUrl` / `getServerQuoteProxyUrl()`）**批量请求** `/api/quotes?symbols=A,B,C`；
   - 网关单次上限 50 个（网关代码 `.slice(0, 50)`），超出**分批**请求；
   - 结果存 state：`Map<symbol, price>`，命名 `monitoredQuotes`。
2. **节流（重要）**：
   - 每 25 分钟最多一次，与量化快照刷新对齐；
   - 结果 + 时间戳缓存到 localStorage（key `portfolio-tracker:monitored-quotes-v1`），未过期（< 25 分钟）直接复用，不发请求；
   - 行情源未配置（`quoteProvider === 'none'` 且无同源网关）→ 跳过，不报错。
3. 请求失败 → 保留上次缓存，UI 照常显示，**不新增红色报错**。

**测试**：60 个标的 → 分 2 批（50+10）；已持有且有 quote 的不进清单；缓存 24 分钟不发请求、26 分钟发请求；失败时返回旧缓存不抛异常。

提交：`feat: fetch quotes for monitored symbols outside holdings`

## Phase 2：`depthQuotePrice` 支持持仓外报价

1. 改签名 `depthQuotePrice(holdings, monitoredQuotes, rawSymbol)`：
   - **优先级 1**：持仓报价；**优先级 2**：`monitoredQuotes`；都无 → `null`（维持 `unavailable`）。
2. `ConditionLookup` 增加 prop `monitoredQuotes`，`App.tsx` 传入。
3. **不改** `buildDepthPriceView` 与推算公式。

**测试**：持有 NVDA → 用持仓报价；未持有 AVGO 但 monitoredQuotes 有 → 算出高点/阈值价；都无 → `unavailable`。

提交：`feat: use monitored quotes for non-held depth windows`

## Phase 3：说明「反推高点会漂移」

真实的 250 日高点是**固定值**，但用现价反推出的高点**会随现价变化**：

| 时刻 | 现价 | 反推高点 |
|---|---|---|
| 12:44 ET | $384.98 | ~$492.30 |
| 20:00 ET | $396.81 | ~$507.43 |

**修法（纯文案，不改计算）**：`source === 'derived'` 时，在现有偏差说明后追加：

> 高点为反推值，会随现价与量化回撤的更新时差而小幅变动；量化系统提供真实高点后此处将改为固定值。

`source === 'quant'` 时不显示该句。

**测试**：`derived` 含"会随…变动"；`quant` 不含。

提交：`docs: explain derived high price drift`

---

# Part B：PE 估值双基准（Phase 4–8）

## B0. 用户规则

**两类标的，两套基准**：

| 类别 | 代表标的 | 基准 | 判断方式 |
|---|---|---|---|
| **个股 / 个股杠杆** | GOOG、MSFT、NVDA、TSLL(→TSLA)、MSFU(→MSFT)、NVDL(→NVDA) | **近 5 年 forward PE 均值** | 当前相对均值偏离多少 |
| **指数杠杆 ETF** | TQQQ(→NDX)、SOXL(→SOX)、SPXL(→SPX)、UDOW(→DJI)、FNGU(→FANG+) | **2025 年 4 月关税低点的指数 PE 锚点** | 距锚点还差多少，**接近即提示** |

要点：
- 指数杠杆 ETF **自身没有 PE**，必须映射到底层指数；
- 锚点是「历史极低估值」，用户明确说"接近就可以，百分位不用很高" → 用**相对距离**判断，不用百分位。

## B0.1 数据源（零成本，已实测）

**Alpha Vantage OVERVIEW 端点免费返回 ForwardPE**（本机实测 demo key）：
```
{'Symbol':'IBM', 'PERatio':'18.83', 'TrailingPE':'18.83',
 'ForwardPE':'17.42', 'PEGRatio':'2.05', 'PriceToBookRatio':'6.07'}
```
`ForwardPE` 正是彭博 BEst P/E 口径。免费层约 **25 请求/日**，用户十几个标的够用。

**已调研排除**：Yahoo `quoteSummary` 需 crumb 认证（实测返回 `Invalid Crumb`）；Koyfin 无公开 API（Enterprise $59/月才有）；StockAnalysis Pro（$5.27/月）**无 API**；FMP / EODHD（$19–20/月）属于为已有数据付费。

**三层来源与优先级**：

| 数据 | 首选 | 备选 | 缺失时 |
|---|---|---|---|
| 个股当前 forward PE | Alpha Vantage OVERVIEW | 量化快照 | 显示"暂无" |
| 个股 5 年均值 | 量化侧历史序列 | 用户手动录入 | 显示"等待历史数据" |
| 指数当前 PE | 量化快照（已有 `ndx_percentile` 等） | Alpha Vantage（若可查） | 显示"暂无" |
| 2025-04 锚点 | 量化侧序列自动计算 | **用户手动录入（过渡）** | 显示"待设定锚点" |

> **5 年均值与 2025-04 锚点都需要历史序列，Alpha Vantage 只给当下值。** 历史序列由量化侧另行提供；**在其交付前，Phase 7 的手动录入让功能立刻可用，不阻塞上线。**

## Phase 4：标的 → 估值基准映射（`src/valuationBasis.ts`）

复用已有 `src/leverageMap.ts`（`underlying` 非 null = 个股型，null = 指数型）：

```ts
export type BasisKind = 'stock_5y_mean' | 'index_anchor';
export interface ValuationBasis {
  kind: BasisKind;
  peSymbol: string;      // 实际查 PE 的代码
  indexKey?: string;     // 指数型才有
  approximate?: boolean; // 近似映射标记
}
export function resolveValuationBasis(symbol: string): ValuationBasis | null
```

规则：
- `leverageMap.underlying` 非 null（TSLL→TSLA、MSFU→MSFT、NVDL→NVDA、AAPU→AAPL、NVDU→NVDA）→ `stock_5y_mean`，`peSymbol` = underlying；
- `leverageMap.underlying` 为 null 的指数型 → `index_anchor`，新增映射：
  ```
  TQQQ→NDX, QLD→NDX, SPXL→SPX, UPRO→SPX, SSO→SPX,
  UDOW→DJI, SOXL→SOX, TECL→NDX(approximate), TNA→RUT, FNGU→FANGPLUS
  ```
  `approximate: true` 的必须在 UI 标注「近似基准」；
- 不在 leverageMap 的普通个股/ETF → `stock_5y_mean`，`peSymbol` 为自身；
- 现金等价物 → 返回 `null`。

**测试**：TQQQ→`index_anchor`+NDX；TSLL→`stock_5y_mean`+TSLA；GOOG→`stock_5y_mean`+GOOG；SGOV→null；TECL 标 approximate。

提交：`feat: map symbols to valuation basis kinds`

## Phase 5：Alpha Vantage forward PE 接入（`src/peData.ts`）

```ts
export interface PeSnapshot { symbol: string; forwardPe: number | null; trailingPe: number | null; fetchedAt: string; }
export async function fetchForwardPe(symbol: string, apiKey: string): Promise<PeSnapshot>
```

1. 端点：`https://www.alphavantage.co/query?function=OVERVIEW&symbol={S}&apikey={K}`；
2. 解析 `ForwardPE` / `TrailingPE`：**API 返回的是字符串**，需转数字；`"None"` / `"-"` / 空串 → `null`；
3. **限流处理**：响应含 `Note` 或 `Information` 字段 = 免费层额度用尽 → 抛可识别错误，UI 显示「今日免费额度已用完，明日恢复」，**不得静默失败**；
4. **Key 来源**：复用设置页已有的 Alpha Vantage Key（`settings.quoteApiKey`，当 `quoteProvider === 'alphavantage'`）；否则在设置页「估值数据」分组新增独立 `peApiKey`（password 类型，仅存 localStorage）；
5. **每日缓存**：每标的每天最多请求 1 次，结果 + 日期存 localStorage（key `portfolio-tracker:pe-cache-v1`），同日复用。

**测试**：`"17.42"`→17.42；`"None"`→null；限流响应→抛限流错误；同日二次调用走缓存不发请求。

提交：`feat: fetch forward pe from alpha vantage with daily cache`

## Phase 6：基准计算（纯函数 `src/peBasis.ts`）

```ts
export interface PePoint { date: string; value: number }
export interface StockBasisResult { mean5y: number|null; current: number|null; deviationPct: number|null; sampleMonths: number; }
export interface AnchorBasisResult { anchorPe: number|null; anchorDate: string|null; current: number|null; gapPct: number|null; zone: 'at_anchor'|'near_anchor'|'far'|'unknown'; }

export function computeStock5yMean(series: PePoint[], current: number|null): StockBasisResult
export function computeIndexAnchor(series: PePoint[], current: number|null, window: {start:string; end:string}, manualAnchor?: number): AnchorBasisResult
```

**个股 5 年均值**：
- 取最近 5 年（1825 天）的点求算术平均；
- `deviationPct = (current - mean5y) / mean5y * 100`（负数 = 低于均值）；
- 样本不足 24 个月 → 仍计算，`sampleMonths` 如实返回，UI 标注「样本仅 N 个月，参考价值有限」。

**指数锚点**：
- 默认窗口 `2025-04-01 ~ 2025-04-30`（可配置，见 Phase 7）；
- 锚点 = 窗口内序列**最低值** + 对应日期；
- `manualAnchor` 传入时**优先使用**（过渡期用）；
- `gapPct = (current - anchorPe) / anchorPe * 100`（正数 = 当前比锚点贵）；
- 分档（阈值可配置，默认）：`gapPct ≤ 5` → `at_anchor`；`≤ 15` → `near_anchor`；否则 `far`；数据缺失 → `unknown`；
- **除零保护**：锚点 ≤ 0 或 current ≤ 0 → `unknown`，不得产生 NaN / Infinity。

**测试（数值逐个对上）**：
- 5 年均值 25.0、当前 20.0 → `deviationPct = -20.00`；
- 锚点 21.6、当前 22.5 → `gapPct = 4.17` → `at_anchor`；
- 当前 24.5 → `gapPct = 13.43` → `near_anchor`；当前 30 → `far`；
- `manualAnchor` 优先于序列计算值；
- 空序列 / 锚点为 0 → `unknown` 且无 NaN。

提交：`feat: compute 5y mean and tariff-anchor valuation basis`

## Phase 7：设置项（锚点窗口 / 手动锚点 / 阈值）

设置页新增「估值基准」分组：
1. **锚点窗口**：两个日期输入，默认 `2025-04-01` / `2025-04-30`，说明：「用于取该区间内指数估值的最低点作为参考锚点（2025 年 4 月关税冲击期间估值处于历史低位）」；
2. **手动锚点**：按指数（NDX / SOX / SPX / DJI / FANGPLUS）各一个可选数字输入，说明：「量化系统历史序列接入前，可手动填入该指数在锚点期的最低 forward PE；填了以手动值为准」；
3. **接近阈值**：两个数字输入，默认 `5` / `15`（%），说明：「距锚点 ≤5% 视为已进入锚点区，≤15% 视为接近」；
4. 全部持久化到 `AppSettings`，`loadSettings` 兼容缺省。

**测试**：缺省值正确；手动锚点写入后 `computeIndexAnchor` 使用它；阈值改 3/10 后分档随之变化。

提交：`feat: configurable valuation anchor window and thresholds`

## Phase 8：估值卡片展示

在「估值位置」卡片中，按 `resolveValuationBasis` 类型分别渲染：

**个股型**：
```
GOOG · 远期 PE 22.65
5 年均值 24.80 · 当前低于均值 8.7%
[────●──────]   ← 位置条：均值居中，当前值标点
数据：Alpha Vantage（远期）· 序列：量化系统
```

**指数型**：
```
TQQQ · 基准指数 NDX · 远期 PE 22.4
2025-04 锚点 21.6（2025-04-08）· 距锚点 +3.7%
🟢 已进入锚点区
[▓▓▓▓▓▓▓▓░░]   ← 距离条：锚点为 0 点
数据：量化系统 · 锚点：序列自动计算
```

要求：
- 每个数字**必须标注来源**（Alpha Vantage / 量化系统 / 手动录入）**和口径**（远期 PE / TTM PE）；
- **两种口径的数字禁止画在同一条上、禁止相减**；
- `approximate` 的显示「近似基准」标记；
- `at_anchor` 绿、`near_anchor` 琥珀、`far` 灰；
- 分位条用纯 CSS/SVG，**不引依赖**；
- **文案红线**：只描述估值位置，禁止「建议买入」「可买」「触发」等动作词。

**测试**：个股型渲染均值与偏离；指数型渲染锚点、日期、分档色；口径标注存在；用 grep 断言文案中**不含**「建议买入」。

提交：`feat: render dual-basis valuation cards`

---

## 2. 部署与总验收

1. `npm run build` && `npm test`
2. `bash deploy/deploy-us-vps.sh`
3. `git push origin main`，等 Pages Actions 完成

**总验收清单**：
- [ ] 8 个 Phase 各自的失败测试输出 + 通过输出，均贴进报告
- [ ] `npm test` 全绿（新增 ≥ 28 用例）；`npm run build` 通过
- [ ] **本地 dist / 线上 VPS / 线上 Pages 三个 hash 一致**（贴出三个）
- [ ] `/api/health` 正常
- [ ] **线上实测**：打开一个未持仓的监控池标的（AVGO 或 MU），深度买入窗口**显示现价 / 高点 / 阈值价**（带 `~` 与两条说明）
- [ ] 持仓标的（NVDA）价格仍正常，且优先用持仓报价
- [ ] 25 分钟内重复打开页面不重复发报价请求
- [ ] 个股型与指数型估值卡各构造一个用例，数值与来源标注正确
- [ ] **外部参照校验**：公开报道称纳指100 forward PE 在 2025-04-08 跌至约 **21.6**（2022 年 11 月以来最低）。若量化序列算出的 NDX 锚点与此偏离超过 15%，**在报告中标注并说明原因**（可能是远期 vs TTM 口径差异、或指数成分口径差异），不得直接采信
- [ ] 全仓 grep：估值与价格相关文案**不含**「建议买入」「可买」「触发买入」
- [ ] 无数据处显示「暂无」，无 NaN / Infinity / 0 冒充
- [ ] Alpha Vantage 限流时有明确提示，不静默失败
- [ ] 行情源未配置时不报错、不白屏
- [ ] `git -C ~/Projects/futu-assistant status` 干净
- [ ] 每 Phase 独立 commit；无未提交改动

---

## 3. 明确不做

- 不自造买入信号（网站只展示位置；买入开窗归量化系统）。
- 不改 `depthPrice.ts` 推算公式。
- 不接入任何付费数据源（Koyfin / FMP / EODHD / StockAnalysis 均已调研排除）。
- 不混用远期 PE 与 TTM PE（不同口径不得相减、不得同图）。
- 不硬编码任何锚点数值到代码（21.6 仅作验收参照；锚点由序列计算或用户录入）。
- 不为监控池标的做高频轮询（严格 25 分钟节流）。
- 不改买入/卖出判定逻辑、不改持仓与成本逻辑、不重构组件结构。

---

## 4. 与量化系统的分工（本轮网站侧不执行，仅说明降级路径）

量化侧另有一份需求单，交付后本轮功能会自动增强，**但本轮不依赖它即可上线**：

| 量化侧交付项 | 交付前（本轮） | 交付后（自动切换） |
|---|---|---|
| `depth_window` 价格真值字段 | 用行情代理现价反推，带 `~` 与漂移说明 | `source='quant'`，`~` 与说明自动消失 |
| 历史 PE 序列 | 5 年均值显示「等待历史数据」；锚点用手动录入 | 自动计算均值与锚点，手动录入变为可选覆盖 |

若用户希望「接近锚点」成为**正式买入推送**（Bark 通知），须由量化侧作为新信号实现，**网站侧不得自造**。
