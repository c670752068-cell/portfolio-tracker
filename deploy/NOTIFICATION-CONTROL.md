# 通知与数据抽屉

2026-09-15 发布；用户明确要求通知管理不设置密码。网页访客可读写通知偏好，不能调用内部消息转发端点。

## 运行路径

- 网页入口：总览左侧圆点；绿色表示开启、灰色表示关闭、琥珀色表示免打扰或状态待确认。
- 公共 `GET/PUT /api/notifications/settings`，PUT 使用 JSON 和 `X-Notification-Settings: 1`，限制同源请求、字段与体积，revision 防止多设备覆盖。
- 设置原子写入 VPS 的 `PORTFOLIO_ALERTS_ROOT/notification-settings.json`，不写浏览器作为权威状态。
- 内部 `POST /api/notifications/worker` 与 `/relay` 继续使用现有机器同步认证；从不把认证值、设备密钥放进网页。
- VPS 决策提醒和本机所有 Bark 调用都在投递边界检查总开关、免打扰、类别、定时任务及消息时效。关闭/免打扰消息不进入补发队列。
- 本机 `/Users/wuhuazhou/Projects/futu-assistant/push/notification_control.py` 读取机器私有 `config/notification-transport.json`，引用原有机器同步认证文件。launchd 的 `FUTU_NOTIFICATION_MANAGED=1` 确保即使配置文件丢失也不回退到直接 Bark 发送。
- 本机每 30 秒读取偏好。原计算任务保留；它们的旧定时推送被替代为受网页配置控制的通知任务。新任务只从未来时间开始，不补跑。报告仍受交易日/有效行情条件限制。
- 本机休眠或断网时，本机报告不会运行。VPS 通知设置和网页数据读取仍可使用。连接失败时停止推送，不绕过控制。
- `dryRun: true` 仅供内部验证投递门控，不发送、不记录投递、不消费消息。不要用真实手机通知做自动测试。

## 界面

`NotificationCenter` 使用原生模态对话框：桌面右侧抽屉、手机底部抽屉、焦点恢复、Esc 关闭、独立滚动。`DataFreshnessPanel` 移入数据页签，保持行情评估和交易时间的区别。`MarketIndicators` 由总览和决策复用同一快照，不更改买卖规则。

14 项原有定时任务全部列出，可逐项启停、改时间/时区/星期/每月日期；可基于已有报告类型新增任务（默认关闭），不允许任意代码任务。市场数据更新与推送关闭相互独立。

## 2026-09-17：独立发送时段与 Z-Score 阈值提醒

- 每个事件栏目均有折叠的“允许发送时段”，可设置时间、星期、时区。五个普通类别、露头栏目及其两个方向、极值附近栏目及其两个方向，共 11 个独立编辑入口。
- `eventWindows` 对应键：`trade`、`valuation`、`risk`、`data`、`system`、`breakout`、`breakout_up`、`breakout_down`、`zExtreme`、`zExtreme_positive`、`zExtreme_negative`。
- 默认不限制时段，不改变已有发送行为；全局关闭及免打扰始终优先。方向时段和所属栏目时段取交集。开始时刻包含、结束时刻不含；跨午夜的星期按开始日计算，命名时区自动处理夏令时。
- 时段外事件直接跳过，写入既有去重记录，不排队、不在时段开始后补发。固定报告继续按各自的精确时间运行，也须满足类别门控。
- 新增 `zExtreme` 通知参数：总开关、正值方向、负值方向均默认关闭；正负阈值绝对值均默认 1.4，可分别设置 0.1–10。阈值只用于通知，不改变图表 ±1.5、回撤优先买入或其他交易判断。
- 使用相邻两个完整收盘交易日：正值从低于阈值进入 `Z >= 正阈值`，负值从高于负阈值进入 `Z <= -负阈值`。持续处于区间不重复提醒，退出再进入才形成新事件。缺失数据、盘中预览不能确认。
- 露头及阈值提醒沿用美东 16:20 收盘审查；允许时段不移动审查时间。北京时间夏令时次日 04:20、冬令时次日 05:20；被时段或免打扰拦截的事件不会稍后补发。
- 首次上线建立 `extreme_version: 1` 基线，不发历史事件；同日重试和重启不重播。修改阈值或开关后，旧事件亦不能通过启用时间屏障。
- 旧配置读取时补足默认字段，不重写原设置文件或修改 revision；兼容旧客户端省略新字段的保存请求。

## 发布与验证

- 所有未来 VPS 发布必须携带 `notification-control.mjs`、`channel-review.mjs`、`z-breakout.mjs`、`z-extreme.mjs`；已纳入 `deploy-us-vps.sh`。
- 当前发布目录：`/opt/portfolio-tracker-releases/20260917T044746Z-extreme-windows`。上一版本仍保留，不删除持仓、行情、提醒规则和统计文件。
- 初始线上总开关为关闭。不要在未来部署中重置用户的通知偏好。
- 回滚网页可切回旧网页资产；若回滚旧网关，旧网关不理解新总开关，须同时停用其手机发送能力。不能直接回滚到旧发送路径后声称推送仍受新开关控制。
- 前端：`npm test`、`npm run build`、`npm run lint`。
- 本机兼容测试使用 `FUTU_NOTIFICATION_MANAGED=0 FUTU_NOTIFICATION_TRANSPORT_FILE=/tmp/notification-test-disabled.json .venv/bin/pytest ...`（保证该测试配置不存在），新通知测试使用独立临时配置，不连真实手机。
