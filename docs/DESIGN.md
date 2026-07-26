# Portfolio Tracker 设计规范

本文件是投资组合网站的永久设计真源。所有后续视觉与交互改动都必须遵守这里的语义、层级和动效约束。

## 1. 整体气质：分区混搭

页面包含两类完全不同的信息，必须使用两种视觉语言：

| 区域 | 内容 | 视觉语言 | 理由 |
| --- | --- | --- | --- |
| 上部 · 决策区 | 今日结论、总资产、关键提醒、机会卡 | 苹果克制风：大留白、大字号、极简、一屏一个焦点 | 用户在这里做决定，需要冷静和聚焦 |
| 下部 · 数据区 | 持仓明细表、配置图、条件查询 | 专业高密度：紧凑行高、等宽数字、表格化 | 用户在这里查数据，需要一屏看更多 |

禁止把苹果式大留白套到持仓表格上。决策区负责聚焦，数据区负责效率。

## 2. 配色系统

深色主题为主。颜色只从 `tailwind.config.js` 的语义 token 获取：

```js
colors: {
  surface: {
    base: '#0B0F14',
    raised: '#141A22',
    overlay: '#1C242E',
  },
  ink: {
    primary: '#E8EDF3',
    secondary: '#9BA8B8',
    muted: '#5F6C7C',
  },
  gain: '#2ECC71',
  loss: '#FF5A5F',
  buy: '#C77DFF',
  trim: '#FFB84D',
  cash: '#7C8B9A',
  neutral: '#3A4553',
}
```

使用规则：

- 涨跌只用 `gain` / `loss`，不再使用 emerald、green、red、rose 等原生色。
- 买点使用 `buy` 紫，故意与上涨绿色区分；买点往往发生在下跌时。
- 止盈与温和警示使用 `trim`，提醒而不恐吓。
- 现金与 SGOV 等现金类资产使用 `cash`，视觉沉底，不与风险资产争夺注意力。
- 危机日横幅使用 `buy`，不用红色制造焦虑。
- 背景用 `surface.base`、`surface.raised`、`surface.overlay` 三层制造深度；分隔线只用 `neutral`。

## 3. 字体与数字

```js
fontFamily: {
  sans: ['-apple-system', 'BlinkMacSystemFont', '"SF Pro Text"', '"PingFang SC"', 'system-ui', 'sans-serif'],
  mono: ['"SF Mono"', 'ui-monospace', 'Menlo', 'monospace'],
}
```

所有金额、百分比、股数、价格、日期与计数都使用 `font-mono tabular-nums`。这是金融数据对齐的硬约束。

字号层级：

- 决断卡标题：`text-2xl` 至 `text-3xl`、`font-semibold`，大标题略收紧字距。
- 总资产数字：`text-4xl font-mono font-semibold tabular-nums`。
- 卡片标题：`text-sm text-ink-secondary font-medium tracking-wide`。
- 表格正文：`text-sm`，数字右对齐并使用等宽数字。
- 辅助说明：`text-xs text-ink-muted`。

## 4. 间距与圆角节奏

- 决策区：`p-6`、`gap-4`、`rounded-2xl`。
- 数据区：表格行 `py-2.5`、卡片 `p-4`、`rounded-xl`。
- 页面左右边距：移动端 `px-4`，桌面 `px-6`。
- 禁止全站统一一个 padding 值；空间差异用于表达信息层级。

## 5. 卡片层级

```text
决断卡（最高）：bg-surface-raised + border border-neutral/60 + 左侧 4px 语义色条
普通卡片：      bg-surface-raised + border border-neutral/40
表格行：        无背景，hover 时 bg-surface-overlay/50
```

深色主题以边框亮度和背景层差制造层级，不堆砌大阴影。浮动导航可使用克制的半透明材质，但不得牺牲文字对比度。

## 6. 动效

- 微交互 150–200ms，卡片进场 250–300ms。
- 进场使用强 `ease-out`，在场移动使用 `ease-in-out`；不使用迟钝的 `ease-in`，不使用无目的的 linear。
- 按钮按下立即反馈，推荐 `scale(0.97)`，只过渡 `transform`、`opacity`、`color` 等必要属性，禁止 `transition: all`。
- 高频 tab 切换保持快速克制；卡片进场只用于防止内容突然跳变，不做弹跳和循环动画。
- 交互动效必须可打断，从当前视觉状态继续；预设动效优先使用 CSS transition。
- 尊重 `prefers-reduced-motion`：移除位移动效，保留必要的短淡入和颜色反馈。
- 若数字更新动画成本过高，可暂不实现；禁止为装饰引入复杂运行时。

## 7. 移动端优先

- 默认样式即移动端，`md:` 以上做桌面增强。
- 决策区在手机上必须快速完整扫读，不以超大空白换取“高级感”。
- 持仓表在手机上转换为紧凑卡片列表，每张卡聚合代码、数量、市值和盈亏，不做横向滚动。
- 所有触控目标至少 44×44px。
- 375px 宽度不得横向溢出；1440px 桌面保持高密度、清晰列对齐。

## 8. 设计判断原则

- **目的**：每个元素都服务“看清状况并冷静决策”。
- **简单而非空洞**：常用信息先出现，高级信息保持可达。
- **反馈**：按下、加载、成功、警告和错误都有明确但克制的反馈。
- **一致性**：相同视觉必须代表相同语义；同一操作在所有 tab 中使用相同反馈。
- **可访问性**：保持对比度、键盘焦点和触控面积，支持减少动效与减少透明度偏好。
- **禁止焦虑式设计**：不闪烁、不放大红色告警、不使用恐吓文案；风险信息清楚呈现即可。
