# 我的投资组合 · Portfolio Tracker

一个纯前端的个人投资组合可视化工具：

- 上传券商截图：优先由 **智谱 GLM 视觉模型**识别股票、ETF、现金与期权；Kimi / Moonshot 保留为备用
- 手动录入股票（代码 / 名称 / 行业 / 股数 / 买入价 / 当前价）+ 现金条目，用于补充或修正截图结果
- 自动按 USD 汇总总资产、盈亏、占比，支持 CNY、HKD 的实时汇率折算，渲染**饼图**
- 可选接入行情源，在北京时间每天 7 点后刷新一次股票 / ETF 价格、今日涨跌、组合占比；期权可用标的价格做 Delta 估算
- 期权显示市值、合约张数、Delta 等效正股数量与 Delta 调整后暴露；重点提示短到期、较大期权浮亏和杠杆 ETF
- 内置**本地规则风险扫描**（集中度、行业、现金比、单股浮亏、期权期限与 Delta 暴露）
- 可选接入 **智谱 GLM 或 Kimi（Moonshot）API** 做组合风险解读
- 组合数据、Key 和汇率缓存保存在浏览器 `localStorage`；截图只会在你点击解析时发送给当前选择的 AI API（或你自己的代理）
- 可一键导出 / 导入 JSON 备份
- 响应式布局，手机浏览器直接访问 GitHub Pages 即可使用

技术栈：Vite + React 19 + TypeScript + TailwindCSS + Recharts。

---

## 本地开发

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # 产物输出到 dist/
npm run preview  # 本地预览生产构建
```

---

## 部署到 GitHub Pages

1. 在 GitHub 网页创建一个**新的空仓库**（例如 `my-portfolio`），不要初始化 README。
2. 在本项目根目录执行：
   ```bash
   git init
   git branch -M main
   git add .
   git commit -m "feat: initial portfolio tracker"
   git remote add origin https://github.com/<你的用户名>/<仓库名>.git
   git push -u origin main
   ```
3. 在仓库 **Settings → Pages**：
   - **Source** 选择 `GitHub Actions`
4. 推送后 Actions 会自动跑 `.github/workflows/deploy.yml`，几分钟内完成部署。
5. 访问 `https://<你的用户名>.github.io/<仓库名>/` 即可。在手机上把链接加到主屏幕，等效一个 App。

> Workflow 会自动把 Vite `base` 设为 `/<仓库名>/`，无需手改 `vite.config.ts`。

---

## AI 接入与截图识别

默认推荐使用 **智谱 GLM**，因为手机浏览器直连 Kimi 视觉请求在部分网络下可能长时间无响应。

1. 在 [open.bigmodel.cn](https://open.bigmodel.cn/) 创建智谱 API Key。
2. 打开应用 → 「设置」标签 → 「AI 识别服务」选择 **智谱 GLM** → 填入智谱 API Key → 保存。
3. 智谱模型默认选择 **`glm-4.6v-flash`**；如果你想换更强模型，可改为 `glm-5v-turbo` 或 `glm-4.6v`。
4. 切到「持仓」标签：上传完整持仓截图；如有期权，请追加期权详情页；如有现金或购买力，请追加现金页。
5. 点击「解析并导入」。识别成功后会自动写入持仓并跳到「总览」，总览会显示识别摘要和仍建议补充的数据。
6. 如需改回 Kimi，可在「设置 → AI 识别服务」选择 Kimi / Moonshot，并填入 Kimi API Key。

API Key 只存在你**本机浏览器的 localStorage**，绝不会进入 Git 提交、绝不会上传 GitHub。解析时，浏览器会把 Key 和图片发送给当前选择的 AI API（或你配置的代理）；图片不会保存到本应用的 localStorage 或 JSON 备份中。

### 自用 VPS 部署（手机不直连 AI）

项目包含一套不保存 API Key 的 VPS 网关。网页、网关放在同一台服务器后，手机请求会先到服务器，再由服务器访问智谱/Kimi；网关会按 Key 串行处理，避免误触“测试连接”与“解析截图”造成并发限流。

部署完成后，部署版本会自动使用同源 `/api/zhipu/chat/completions` 与 `/api/quotes`，无需在设置中手填代理 URL。具体故障结论、IP/域名/HTTPS 取舍见 [AI_IMPORT_DEPLOYMENT_ANALYSIS.md](docs/AI_IMPORT_DEPLOYMENT_ANALYSIS.md)。

服务器文件：

- `deploy/aliyun-gateway.mjs`：AI 与免费行情网关；不存储 API Key。
- `deploy/portfolio-tracker.nginx.conf`：静态网页 + 同源 API 反向代理。
- `deploy/runtime-config.us-vps.js`：让美国 VPS 的自托管网页自动使用同源网关。
- `deploy/deploy-us-vps.sh`：不触碰既有 Nginx/StockPulse 的独立 8788 端口部署脚本。

「设置」里有 **测试 AI 连接**按钮。它只发送一条短文本，不发送截图；如果这里都失败，说明当前手机网络、Key 或代理配置还没通。

> `kimi-k2.6` / `kimi-k2.5` 请求会使用模型要求的 `temperature: 1`。智谱默认使用 OpenAI 兼容的 `/api/paas/v4/chat/completions` 接口。

### 截图准备建议

- **完整持仓页**：代码、数量、市值/现价、成本和币种尽量同时可见。
- **期权详情页**：标的、Call/Put、行权价、到期日、合约乘数、Delta、Theta、IV、标的价格尽量可见。页面会把 `Delta × 合约张数 × 合约乘数` 显示为等效正股数量。
- **现金/购买力页**：用于计算现金占比；缺少它时，应用仍会展示已识别的持仓，但会明确提示结果不完整。
- 单次最多 8 张，单张不超过 10MB。支持 JPG、PNG、WEBP、GIF；应用会在发送给 AI 前自动压缩到最长边 1600px，降低手机端 `Load failed` 概率。

### AI 代理（如直连失败）

如果点击「解析并导入」报 `Load failed`、超时或网络错误，说明请求大概率没能稳定完成。应用会先压缩截图；如果仍失败，按以下步骤部署一个 Cloudflare Worker 代理（5 分钟，免费）：

1. 登录 [dash.cloudflare.com](https://dash.cloudflare.com/) → **Workers & Pages → Create → Create Worker**。
2. 把仓库根目录的 [`cloudflare-worker-proxy.js`](./cloudflare-worker-proxy.js) 全部内容粘贴进去。
3. 修改 `ALLOWED_ORIGINS` 数组，把你的 GitHub Pages 地址加进去（如 `'https://your-name.github.io'`）。
4. **Save and Deploy**，会得到一个形如 `https://portfolio-ai-proxy.your-name.workers.dev` 的地址。
5. 智谱代理：在应用「设置」里把「智谱代理 URL」填为：
   ```
   https://portfolio-ai-proxy.your-name.workers.dev/zhipu/chat/completions
   ```
6. Kimi 代理：如果你使用 Kimi，把「Kimi 代理 URL」填为：
   ```
   https://portfolio-ai-proxy.your-name.workers.dev/v1/chat/completions
   ```
7. 再次点击「测试 AI 连接」和「解析并导入」。

代理只做请求中转，**不会保存或读取你的 Key**。

---

## 每日行情同步

静态 GitHub Pages 没有后端，不能自己绕过行情接口的跨域和鉴权限制。因此应用提供两种方式：

应用不是实时盯盘。开启自动同步后，它会在你打开页面时检查：如果已经过了**北京时间每天早上 7 点**，且当天同一批持仓还没同步过，就自动刷新一次。你也可以在「总览」手动刷新。

1. **行情 API Key**：在「设置 → 每日行情同步」选择 Finnhub、Financial Modeling Prep 或 Alpha Vantage，填入对应 API Key 并保存。
2. **自建免费行情代理**：部署同一个 [`cloudflare-worker-proxy.js`](./cloudflare-worker-proxy.js)，然后在「设置 → 每日行情同步」选择「自建免费行情代理」，URL 填：
   ```
   https://portfolio-ai-proxy.your-name.workers.dev/quotes
   ```
   Worker 会优先请求 Yahoo chart 免费行情；Yahoo 失败时回退 NASDAQ。它只是代理公开行情，不保存你的持仓或 Key。

普通股票、ETF、杠杆 ETF 会直接用最新价重算市值、今日涨跌和占比。期权如果没有真实期权盘口，会使用最新标的价格按 Delta 做粗略估算，并在持仓表中标注「Delta 估算」；这不等同于真实期权报价，因为没有包含 Gamma、Vega、Theta 和买卖价差。

---

## Mac 量化系统持仓同步

美国 VPS 入口可以接收 Mac 上 `futu-assistant positions-status` 的三券商聚合快照。推送脚本只调用 CLI，不会读取或修改量化系统内部文件。

先创建本机认证文件（内容由部署时的 `PORTFOLIO_SYNC_TOKEN` 提供）：

```bash
umask 177
printf '%s' "$PORTFOLIO_SYNC_TOKEN" > ~/.portfolio-sync-token
chmod 600 ~/.portfolio-sync-token
```

手动验证一次：

```bash
node sync/push-positions.mjs
tail -n 5 ~/Library/Logs/portfolio-sync.log
```

安装每 45 分钟运行一次的 launchd 任务：

```bash
cp sync/com.portfolio.sync.plist ~/Library/LaunchAgents/com.portfolio.sync.plist
launchctl unload ~/Library/LaunchAgents/com.portfolio.sync.plist 2>/dev/null || true
launchctl load ~/Library/LaunchAgents/com.portfolio.sync.plist
launchctl start com.portfolio.sync
```

另装一个常驻轮询任务，让网页发出的「一键刷新」请求在 60 秒内触发量化重算；上面的 45 分钟任务继续保留作兜底：

```bash
cp sync/com.portfolio.refresh-watch.plist ~/Library/LaunchAgents/com.portfolio.refresh-watch.plist
launchctl unload ~/Library/LaunchAgents/com.portfolio.refresh-watch.plist 2>/dev/null || true
launchctl load ~/Library/LaunchAgents/com.portfolio.refresh-watch.plist
launchctl start com.portfolio.refresh-watch
```

模板不包含认证值；脚本默认从权限为 `600` 的 `~/.portfolio-sync-token` 读取。可用 `FUTU_ASSISTANT_CLI`、`PORTFOLIO_GATEWAY_ORIGIN` 覆盖默认 CLI 和网关地址。

---

## 数据备份

「设置」里有：

- **导出 JSON**：把所有持仓和现金导出到 `portfolio-YYYY-MM-DD.json`
- **导入 JSON**：从备份恢复
- **清空数据**：一键重置

> 建议每次大幅调仓后导出一次 JSON，避免清除浏览器数据时丢失。

---

## 风险扫描规则（本地，可离线）

| 维度 | 提示阈值 | 严重阈值 |
|---|---|---|
| 单股权重 | ≥ 25% | ≥ 40% |
| 行业权重 | ≥ 45% | ≥ 60% |
| 现金比例（过高） | ≥ 40% | ≥ 60% |
| 现金比例（过低） | < 5% | — |
| 单股浮亏 | ≤ −20% | — |
| 期权权利金占比 | ≥ 25% | ≥ 40% |
| 期权距到期日 | ≤ 45 天 | ≤ 21 天 |
| 期权浮亏 | — | ≤ −50% |
| Delta 调整后单一标的暴露 | ≥ 40% | ≥ 65% |

阈值定义在 [`src/analyzer.ts`](./src/analyzer.ts)，可按你的风格自定义。

长到期期权不会因为“是期权”就被判为高风险；短到期、较大亏损、杠杆 ETF 与集中度才是重点检查对象。所有结果都是信息与教育用途，不构成买卖、投资或税务建议。

## 汇率

页面加载时会从 Frankfurter 汇率服务取得 USD/CNY、USD/HKD 最新可用汇率，并在页面顶部显示日期。网络不可用时会使用浏览器缓存或近似兜底值，并明确标注。`OTHER` 币种不会混入 USD 总资产，避免错误相加；请手动改成 USD、CNY 或 HKD 后再分析。

---

## 项目结构

```
src/
├── App.tsx                       # 主路由 + 状态
├── analyzer.ts                   # 本地风险规则
├── format.ts                     # 数字 / 货币 / 百分比格式化
├── kimi.ts                       # 智谱 / Kimi 调用与截图 JSON 规范化
├── marketData.ts                 # 行情同步与期权 Delta 估算
├── metrics.ts                    # 组合计算
├── storage.ts                    # localStorage 读写
├── types.ts                      # 共享类型
└── components/
    ├── AllocationChart.tsx       # Recharts 饼图
    ├── AnalysisPanel.tsx         # AI 分析面板
    ├── CashEditor.tsx            # 现金编辑
    ├── HoldingsTable.tsx         # 持仓 CRUD
    ├── ImageImportPanel.tsx      # 截图识别导入
    ├── RiskList.tsx              # 风险列表
    ├── SettingsPanel.tsx         # API Key / 模型 / 代理
    └── Summary.tsx               # 总资产卡片
```

---

## 许可

MIT
