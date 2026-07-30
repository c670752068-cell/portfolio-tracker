# 修复方案 V15：PE 估值双基准（个股 5 年均值 / 指数关税锚点）+ 零成本数据源

日期：2026-07-22
适用仓库：`portfolio-tracker`（网站侧 Codex 执行）
前置：V14 已下发（含定时刷新与价格推算）。本轮落地用户的**估值判断规则**，数据源全部零成本。

> 配套：`需求单-量化侧-价格字段与估值序列.md`（已更新加强版）。历史 PE 序列由量化侧提供，本方案在其缺席时有降级路径，**不阻塞上线**。

---

## 0. 给执行者（Codex）的硬性规则

1. 只做本文件列出的任务；不新增 Tab、不重构组件结构、不新增付费数据源。
2. 每个 Phase 先写**会失败的测试并确认它真的失败**（贴失败输出），再改实现变绿。
3. 每个 Phase：`npm run build` + `npm test` 全绿 → 单独 `git commit` → **留验证报告** → 才进下一 Phase。
4. **最重要的边界（承接 V13 铁律）**：网站是只读展示层。本方案产出的是**估值位置展示**，**不是买入信号**。
   - 允许的文案：「当前 PE 距 2025-04 锚点 +8.2%」「已进入锚点区」；
   - **禁止的文案**：「建议买入」「可买」「触发买入」——买入开窗判定永远归量化系统。
   - 若用户希望它成为正式买入信号，须由量化侧实现，网站不得自造。
5. 契约禁区：不改 `~/Projects/futu-assistant` 任何文件；完工验证 `git -C ~/Projects/futu-assistant status` 干净。
6. 完工必须贴出**三个 hash**（本地 dist / 线上 VPS / 线上 Pages）。

---

## 1. 用户规则（本轮要实现的核心）

用户原话要点：

> 「像大科技这种，可能是要近 5 年的平均的某一个值就可以去采纳……但你像 TQQQ 它是根据指数的估值，它对比于 2025 年 4 月份的指数的估值就可以了。2025 年 4 月份川普加关税导致估值非常的低，那估值就按照这个最低标准去执行……我们有个记录，记录好川普加关税那时候的估值是多少，按照那个标准作为一个（基准），我们最低只要碰到或者接近了，接近了百分位不用很高，只要有接近的就可以了。」

翻译成规则：**两类标的，两套基准**

| 类别 | 代表标的 | 估值基准 | 判断方式 |
|---|---|---|---|
| **个股 / 个股杠杆** | GOOG、MSFT、NVDA、TSLL(→TSLA)、MSFU(→MSFT)、NVDL(→NVDA) | **近 5 年 forward PE 均值** | 当前 PE 相对 5 年均值偏离多少 |
| **指数杠杆 ETF** | TQQQ(→NDX)、SOXL(→SOX)、SPXL(→SPX)、UDOW(→DJI)、FNGU(→FANG+) | **2025 年 4 月关税低点的指数 PE** | 当前 PE 距该锚点还差多少，**接近即提示** |

关键点：
- 指数杠杆 ETF **自己没有 PE**，必须映射到底层指数；
- 锚点是「历史极低估值」，**越接近越有参考价值**，用户明确说"百分位不用很高，接近就可以"→ 用**相对距离**判断，不用百分位。

## 2. 数据源方案（零成本，已实测）

### 实测结果

**Alpha Vantage OVERVIEW 端点免费返回 ForwardPE**（本机实测，demo key）：
```
{'Symbol':'IBM', 'PERatio':'18.83', 'TrailingPE':'18.83',
 'ForwardPE':'17.42', 'PEGRatio':'2.05', 'PriceToBookRatio':'6.07'}
```
`ForwardPE` 正是彭博 BEst P/E 的口径。**免费层约 25 请求/日**，用户十几个标的够用。

对比排除的方案：
- Yahoo `quoteSummary`（PE 所在端点）已需 crumb 认证，实测返回 `Invalid Crumb`，**不可靠**；
- Koyfin 无公开 API（Enterprise $59/月才有）；
- StockAnalysis Pro（$5.27/月）**无 API**，接不进系统；
- FMP / EODHD（$19–20/月）有 API，但属于为已有数据付费。

### 三层数据来源与优先级

| 数据 | 首选来源 | 备选 | 缺失时 |
|---|---|---|---|
| 个股当前 forward PE | Alpha Vantage OVERVIEW | 量化快照 | 显示"暂无" |
| 个股 5 年均值 | **量化侧历史序列** | 用户手动录入 | 显示"等待历史数据" |
| 指数当前 PE | **量化快照**（已有 `ndx_percentile`、`soxx_percentile` 等） | Alpha Vantage（若该指数 ETF 可查） | 显示"暂无" |
| 2025-04 锚点 | **量化侧历史序列自动计算** | **用户手动录入**（过渡） | 显示"待设定锚点" |

> **重要**：5 年均值与 2025-04 锚点都需要历史序列，Alpha Vantage 只给当下值。历史序列由量化侧提供（见配套需求单）。**在量化侧交付前，Phase 4 的手动录入让功能立刻可用**，不阻塞上线。

---

## 3. 任务

### Phase 1：标的 → 估值基准的映射（`src/valuationBasis.ts` 新建）

复用已有的 `src/leverageMap.ts`（其中 `underlying` 非 null 表示个股型、null 表示指数型）：

```ts
export type BasisKind = 'stock_5y_mean' | 'index_anchor';
export interface ValuationBasis {
  kind: BasisKind;
  peSymbol: string;      // 实际查 PE 用的代码（个股用底层股票、指数用指数代码）
  indexKey?: string;     // 指数型才有：NDX / SOX / SPX / DJI / FANGPLUS
}
export function resolveValuationBasis(symbol: string): ValuationBasis | null
```

映射规则：
- `leverageMap` 中 `underlying` 非 null（TSLL→TSLA、MSFU→MSFT、NVDL→NVDA、AAPU→AAPL、NVDU→NVDA）→ `stock_5y_mean`，`peSymbol` 取该 underlying；
- `leverageMap` 中 `underlying` 为 null 的指数型 → `index_anchor`，新增指数映射表：
  ```
  TQQQ→NDX, QLD→NDX, SPXL→SPX, UPRO→SPX, SSO→SPX,
  UDOW→DJI, SOXL→SOX, TECL→NDX(近似,须标注), TNA→RUT, FNGU→FANGPLUS
  ```
  近似映射（如 TECL→NDX）**必须在 UI 标注"近似基准"**。
- 不在 leverageMap 中的普通个股/ETF → `stock_5y_mean`，`peSymbol` 为自身；
- 现金等价物（`isCashEquivalent`）→ 返回 `null`（不做估值判断）。

**测试**：TQQQ → `index_anchor` + NDX；TSLL → `stock_5y_mean` + TSLA；GOOG → `stock_5y_mean` + GOOG；SGOV → null；TECL 标注近似。

提交：`feat: map symbols to valuation basis kinds`

### Phase 2：Alpha Vantage forward PE 接入（复用现有行情设置）

1. `src/peData.ts` 新建：
   ```ts
   export interface PeSnapshot { symbol: string; forwardPe: number | null; trailingPe: number | null; fetchedAt: string; }
   export async function fetchForwardPe(symbol: string, apiKey: string): Promise<PeSnapshot>
   ```
   - 端点：`https://www.alphavantage.co/query?function=OVERVIEW&symbol={S}&apikey={K}`；
   - 解析 `ForwardPE` / `TrailingPE`（**字符串转数字**，注意 API 返回的是字符串；`"None"`、`"-"`、空串一律转 `null`）；
   - 命中免费层限流（返回体含 `Note` 或 `Information` 字段）→ 抛出可识别错误，UI 显示"今日免费额度已用完，明日恢复"，**不得静默失败**。
2. 复用设置页已有的 Alpha Vantage API Key 字段（`settings.quoteApiKey`，当 `quoteProvider === 'alphavantage'` 时）；若用户行情源不是 Alpha Vantage，设置页「估值数据」分组新增独立的 `peApiKey` 输入（password 类型，仅存 localStorage）。
3. **限流保护**：每个标的的 PE 每天最多请求 1 次，结果连同日期存入 localStorage（key `portfolio-tracker:pe-cache-v1`）；同日重复打开页面直接用缓存。
4. **测试**：字符串 `"17.42"` → 数字 17.42；`"None"` → null；限流响应 → 抛出限流错误；同日二次调用走缓存不发请求。

提交：`feat: fetch forward pe from alpha vantage with daily cache`

### Phase 3：PE 历史序列与基准计算（纯函数，`src/peBasis.ts`）

```ts
export interface PePoint { date: string; value: number }
export interface StockBasisResult { mean5y: number | null; current: number | null; deviationPct: number | null; sampleMonths: number; }
export interface AnchorBasisResult { anchorPe: number | null; anchorDate: string | null; current: number | null; gapPct: number | null; zone: 'at_anchor'|'near_anchor'|'far'|'unknown'; }

export function computeStock5yMean(series: PePoint[], current: number | null): StockBasisResult
export function computeIndexAnchor(series: PePoint[], current: number | null, window: {start: string; end: string}, manualAnchor?: number): AnchorBasisResult
```

**个股 5 年均值**：
- 取 series 中最近 5 年（1825 天）的点求算术平均；
- `deviationPct = (current - mean5y) / mean5y * 100`（负数=低于均值）；
- 样本不足 24 个月 → 仍计算但 `sampleMonths` 如实返回，UI 标注"样本仅 N 个月，参考价值有限"。

**指数锚点**：
- 默认窗口 `2025-04-01 ~ 2025-04-30`（**可配置**，见 Phase 4）；
- 锚点 = 该窗口内 series 的**最低值**，同时返回该值对应日期；
- `manualAnchor` 传入时优先使用（用户手动录入，用于量化序列缺席的过渡期）；
- `gapPct = (current - anchorPe) / anchorPe * 100`（正数=当前比锚点贵多少）；
- 分档（阈值可配置，默认值如下）：
  - `gapPct <= 5` → `at_anchor`（已进入锚点区）
  - `gapPct <= 15` → `near_anchor`（接近锚点）
  - 否则 → `far`
  - 数据缺失 → `unknown`
- **除零/异常保护**：锚点 ≤ 0 或 current ≤ 0 → 返回 `unknown`，不得产生 Infinity/NaN。

**测试（数值必须逐个对上）**：
- 5 年序列均值 25.0、当前 20.0 → `deviationPct = -20.00`；
- 锚点窗口内最低 21.6、当前 22.5 → `gapPct = 4.17` → `at_anchor`；
- 当前 24.5 → `gapPct = 13.43` → `near_anchor`；当前 30 → `far`；
- `manualAnchor` 优先于序列计算值；
- 空序列 / 锚点为 0 → `unknown` 且无 NaN。

提交：`feat: compute 5y mean and tariff-anchor valuation basis`

### Phase 4：设置项（锚点窗口、手动锚点、阈值）

设置页新增「估值基准」分组：
1. **锚点窗口**：两个日期输入，默认 `2025-04-01` / `2025-04-30`，说明文字：「用于取该区间内指数估值的最低点作为参考锚点（2025 年 4 月关税冲击期间估值处于历史低位）」；
2. **手动锚点录入**：按指数（NDX / SOX / SPX / DJI / FANGPLUS）各一个可选数字输入，说明：「量化系统历史序列接入前，可手动填入该指数在锚点期的最低 forward PE；填了以手动值为准」；
3. **接近阈值**：两个数字输入，默认 5 / 15（%），说明：「距锚点 ≤5% 视为已进入锚点区，≤15% 视为接近」；
4. 全部持久化到 `AppSettings`，`loadSettings` 兼容缺省。

**测试**：缺省值正确；手动锚点写入后 `computeIndexAnchor` 使用它；阈值改为 3/10 后分档随之变化。

提交：`feat: configurable valuation anchor window and thresholds`

### Phase 5：估值卡片展示（合并进 V14 Phase 3 的分位条区域）

在「估值位置」卡片中，按 `resolveValuationBasis` 的类型分别渲染：

**个股型**：
```
GOOG · 远期 PE 22.65
5 年均值 24.80 · 当前低于均值 8.7%
[────●──────]  ← 位置条：均值居中，当前值标点
数据：Alpha Vantage（远期）· 序列：量化系统
```

**指数型**：
```
TQQQ · 基准指数 NDX · 远期 PE 22.4
2025-04 锚点 21.6（2025-04-08）· 距锚点 +3.7%
🟢 已进入锚点区
[▓▓▓▓▓▓▓▓░░]  ← 距离条：锚点为 0 点，当前位置
数据：量化系统 · 锚点：序列自动计算
```

要求：
- 每个数字**必须标注来源**（Alpha Vantage / 量化系统 / 手动录入），且标注**口径**（远期 PE / TTM PE）；
- **两种口径的数字禁止画在同一条上、禁止相减**（远期 PE 与 TTM PE 不可混用）；
- 近似基准（如 TECL→NDX）显示「近似基准」标记；
- `at_anchor` 用绿色、`near_anchor` 用琥珀、`far` 用灰色；
- **文案红线**：只描述估值位置，禁止出现"建议买入""可买""触发"等动作词（见规则 4）。缺数据时显示"暂无"，不得显示 0。

**测试**：个股型渲染均值与偏离；指数型渲染锚点、日期与分档色；口径标注存在；`at_anchor` 文案中不含"买入"二字（用 grep 断言）。

提交：`feat: render dual-basis valuation cards`

---

## 4. 部署与验收

1. `npm run build` && `npm test`
2. `bash deploy/deploy-us-vps.sh`
3. `git push origin main`，等 Pages Actions

**总验收清单**：
- [ ] 五个 Phase 各自的失败测试输出 + 通过输出，均贴进报告
- [ ] `npm test` 全绿（新增 ≥ 20 用例）；`npm run build` 通过
- [ ] **本地 dist / 线上 VPS / 线上 Pages 三个 hash 一致**（贴出三个）
- [ ] `/api/health` 正常
- [ ] **外部参照校验**：用 2025-04 窗口的公开参考值做 sanity check —— 有报道称纳指100 forward PE 在 2025-04-08 跌至约 **21.6**（2022 年 11 月以来最低）。若量化序列算出的 NDX 锚点与此偏离超过 15%，**在报告中标注并说明原因**（可能是口径不同：远期 vs TTM、或指数成分口径差异），不得直接采信
- [ ] 个股型与指数型各构造一个用例，卡片数值与来源标注正确
- [ ] 全仓 grep：估值卡片相关文案中**不含**"建议买入""可买""触发买入"
- [ ] 无数据时显示"暂无"，无 NaN / Infinity / 0 冒充
- [ ] Alpha Vantage 限流时有明确提示，不静默失败
- [ ] `git -C ~/Projects/futu-assistant status` 干净
- [ ] 每 Phase 独立 commit；无未提交改动

---

## 5. 明确不做

- **不自造买入信号**（网站只展示估值位置；买入开窗归量化系统）。
- 不接入任何付费数据源（Koyfin / FMP / EODHD / StockAnalysis 均排除）。
- 不混用远期 PE 与 TTM PE（不同口径不得相减、不得同图）。
- 不硬编码任何锚点数值到代码里（锚点由序列计算或用户录入；21.6 仅作验收参照）。
- 不改买入/卖出判定逻辑、不改持仓与成本逻辑。

---

## 6. 后续（待量化侧交付后）

量化侧交付历史 PE 序列后：
1. Phase 3 的 `series` 参数从"空数组降级"切换为真实序列，5 年均值与锚点自动计算，手动录入项变为可选覆盖；
2. 若用户希望「接近锚点」成为**正式买入提醒**（推送到 Bark），须提给量化侧作为新信号实现 —— 网站侧不得自造。
