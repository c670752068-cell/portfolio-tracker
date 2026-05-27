# 我的投资组合 · Portfolio Tracker

一个纯前端的个人投资组合可视化工具：

- 手动录入股票（代码 / 名称 / 行业 / 股数 / 买入价 / 当前价）+ 现金条目
- 自动计算总资产、盈亏、占比，渲染**饼图**
- 内置**本地规则风险扫描**（集中度、行业、现金比、单股浮亏）
- 可选接入 **Kimi（Moonshot）API** 做深度分析
- 数据保存在浏览器 `localStorage`，**不上传任何服务器**
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

## Kimi（Moonshot）API 接入

1. 在 [platform.moonshot.cn](https://platform.moonshot.cn/) 创建 API Key。
2. 打开应用 → 「设置」标签 → 填入 API Key → 保存。
3. 切到「分析」标签 → 点「调用 Kimi 分析」。

API Key 只存在你**本机浏览器的 localStorage**，绝不会进入 Git 提交、绝不会上传 GitHub。

### Kimi CORS 代理（如直连失败）

Moonshot API 默认对浏览器跨域请求不友好。如果点击「调用 Kimi 分析」报网络错误，按以下步骤部署一个 Cloudflare Worker 代理（5 分钟，免费）：

1. 登录 [dash.cloudflare.com](https://dash.cloudflare.com/) → **Workers & Pages → Create → Create Worker**。
2. 把仓库根目录的 [`cloudflare-worker-proxy.js`](./cloudflare-worker-proxy.js) 全部内容粘贴进去。
3. 修改 `ALLOWED_ORIGINS` 数组，把你的 GitHub Pages 地址加进去（如 `'https://your-name.github.io'`）。
4. **Save and Deploy**，会得到一个形如 `https://kimi-proxy.your-name.workers.dev` 的地址。
5. 在应用「设置」里把「代理 URL」填为：
   ```
   https://kimi-proxy.your-name.workers.dev/v1/chat/completions
   ```
6. 再次点击「调用 Kimi 分析」。

代理只做请求中转，**不会保存或读取你的 Key**。

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

阈值定义在 [`src/analyzer.ts`](./src/analyzer.ts)，可按你的风格自定义。

---

## 项目结构

```
src/
├── App.tsx                       # 主路由 + 状态
├── analyzer.ts                   # 本地风险规则
├── format.ts                     # 数字 / 货币 / 百分比格式化
├── kimi.ts                       # Moonshot Kimi 调用
├── metrics.ts                    # 组合计算
├── storage.ts                    # localStorage 读写
├── types.ts                      # 共享类型
└── components/
    ├── AllocationChart.tsx       # Recharts 饼图
    ├── AnalysisPanel.tsx         # Kimi 分析面板
    ├── CashEditor.tsx            # 现金编辑
    ├── HoldingsTable.tsx         # 持仓 CRUD
    ├── RiskList.tsx              # 风险列表
    ├── SettingsPanel.tsx         # API Key / 模型 / 代理
    └── Summary.tsx               # 总资产卡片
```

---

## 许可

MIT
