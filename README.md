# Ekko Studio 旅行插件

用 Studio 内置浏览器中的已有登录态运行固定站点脚本，查询、清洗酒店、动车、机票展示报价和图文攻略，再通过 MCP 工具把结构化数据交给 AI。

当前是 **v0.3.0 旅游查询调试版**。支持按地址找酒店，以及按出发地、目的地、日期搜索动车/火车票和国内单程机票。交通返回当前已加载记录中的票价、时刻、具体车站/机场、列车席别与余票状态。手机定位、附近美食、路线规划和完整比价尚未实现。

```text
Studio 内置浏览器 → 浏览器 SDK / CDP → 站点脚本 → 契约校验与清洗 → MCP 工具 → AI 整理
```

常规采集不调用模型，不依赖 AI 自动点击。登录及站点要求的验证由用户在浏览器中完成。

## 来源与当前边界

| 来源 | 当前能力 | 边界 |
| --- | --- | --- |
| 携程酒店 | 固定脚本按城市/地址查询；核对日期后采集卡片；无 DOM 匹配时使用固定无障碍树适配器 | 地点与关键词模式分开；预算仅筛本批展示价；缺少完整房型/费用条件 |
| 携程列车 | 单程查询；默认 G/D/C 动车高铁；席别价格、余票、车站与时间 | 抢票不视为有票；预售以站点为准；结果仅覆盖已加载卡片 |
| 携程机票 | 国内单程 1 成人；城市全部机场；经济舱/不限舱等、直飞/包含中转 | 有界滚动加载航班号；展示价不保证包含税费/行李；不保证全量或最低价 |
| 小红书 | 图文列表摘要与详情页文字 | 列表不是全文；未处理图片 OCR 和视频 |
| 携程攻略、马蜂窝 | 预置入口与正文选择器 | 尚未完成真实页面验证 |
| 美团 | 预置调试入口、阻断识别 | 调试过的酒店入口返回 403；不能据此判断所有美团网页均不可用 |

已通过公开 `run.host.browser` SDK，在本地 Desktop 现有登录态完成携程杭州东站、苏州站的真实查询，以及小红书图文详情文字采集。也完成上海→杭州列车、上海→北京机票的真实条件查询。查询条件核对和页面当前价比对已实测；价格仍为展示报价，房型/费用等条件尚未完整建模。自动化 CI 使用合成页面与真实 Chromium CDP，不访问个人账号；携程攻略、马蜂窝、美团仍按上表标记验证范围。

## 安装与调试

需要 Node.js 22+、支持插件浏览器 SDK 的 Ekko Studio Desktop，以及启用本地浏览器连接的宿主版本（[Studio 修复 PR #3843](https://github.com/EKKOLearnAI/ekko-studio/pull/3843)）。Web UI 与 Desktop 必须同时包含该修复；只更新插件不能修复旧 Desktop 的接入限制。

```bash
git clone https://github.com/EKKOLearnAI/ekko-studio-plugin-travel.git
cd ekko-studio-plugin-travel
npm ci --include=dev --ignore-scripts
npm run check
ekko-studio plugins link .
```

在 Studio 插件中心启用“旅行助手 · 采集调试”，打开插件页面：

1. 通过“查询类型”切换酒店、动车/火车票、国内机票。交通填写出发地、目的地、日期，按需切换 G/D/C、直飞和舱等。
2. 在“按地址找酒店”填写城市、地址/地标及入住和离店日期，按需设置展示价上限。
3. 点击“查找酒店”；插件新建查询页，选择城市联想项并提交地址，核对结果条件后返回酒店。
4. 检查“已选择站点地点”或“仅关键词匹配”、站点当前入住人数、预算待核实标记及价格原文。
5. 登录、验证或同名地点不明确时停止自动查询；在页面处理后重试。也可手动搜索后通过“采集已有页面”采集，或打开图文来源。

`No authorized active Desktop browser` 表示宿主未连接可用的 Desktop 浏览器，应先检查宿主版本及登录状态。插件不会启动另一个浏览器，也不会从磁盘读取 Cookie 或宿主令牌。

## MCP 工具

安装并启用插件后，Studio 按插件命名空间暴露以下工具。MCP 文本内容为可解析 JSON，包含实际记录和查询条件；失败时直接返回具体原因：

| 工具 | 输入 | 输出 |
| --- | --- | --- |
| `search_hotels` | `{ "city": "杭州", "address": "杭州东站", "checkIn": "YYYY-MM-DD", "checkOut": "YYYY-MM-DD", "maxPrice": 300 }` | 条件已核对的酒店记录及查询元数据；`maxPrice` 可省略 |
| `search_trains` | `{ "from": "上海", "to": "杭州", "departureDate": "YYYY-MM-DD", "highSpeedOnly": true, "limit": 20 }` | 列车时刻、车站、列表起价与各席别余票/报价；后两项可省略 |
| `search_flights` | `{ "from": "上海", "to": "北京", "departureDate": "YYYY-MM-DD", "directOnly": true, "cabin": "economy", "limit": 20 }` | 单程 1 成人，航班号、机场、时刻和展示价；后三项可省略，cabin 可选 `all` |
| `list_pages` | `{}` | 支持站点的已打开标签页 |
| `open_page` | `{ "source": "ctrip", "url": "https://hotels.ctrip.com/" }` | 新标签页；`url` 可省略 |
| `collect_page` | `{ "tabId": "标签页 ID" }` | 清洗后的记录、来源、采集时间、状态和诊断 |

酒店查询日期需为有效未来/当日日期，最多 30 晚；不接受人数、房型和距离半径筛选。城市必须精确匹配站点联想项；同名候选不会自动任选。地址不能匹配地点时作为关键词提交，明确不保证附近距离。展示价筛选仅针对当前已采集的最多 40 条记录，条件价/总价/缺价保留待核实。

支持的来源 ID：`ctrip`、`xiaohongshu`、`meituan`、`ctrip-guide`、`mafengwo`、`ctrip-trains`、`ctrip-flights`。交通页面使用专用查询工具，`collect_page` 不会按酒店卡片解析交通页面。任意脚本输入与非支持来源被拒绝。详情见 [数据契约](docs/CONTRACTS.md)。

携程 DOM 优先采用唯一 `Current price` 标记，划线原价不当作当前价；新客、首单、会员与券类文字保留为条件价。价格以分表示，只接受明确的单个人民币金额，保留原文及“起价 / 条件价 / 每晚 / 总价 / 未知”含义。缺失、区间和歧义价格不会填成零；酒店结果始终标记为部分数据，不能直接当作同房型最终成交价。

交通日期不早于北京时间今天，本版输入上限为未来一年，并不代表车票已开售；站点尚未开售时明确返回 `not_on_sale`。`limit` 为 1–50（默认 20），不执行无限滚动。机票先从城市联想项取得全部机场代码，再构造明确的单程/日期/舱等查询；不会猜测机场代码。查询前后均核对条件。返回 `loadedCount`、`matchedCount`、`truncated` 及采集时间，不把部分结果当作全量最低价。

## 开发与验证

```bash
npm run check                         # 契约、SDK 完整性与 Node 行为测试
npx playwright install chromium
npm run test:browser                   # 合成站点真实 CDP 查询流程、UI、安全与失败路径
```

没有构建步骤，入口是 `server.mjs` 与 `client.mjs`。选择器位于 `src/sources.mjs`；DOM 采集、无障碍树适配及清洗分别位于 `src/capture.mjs`、`src/accessibility.mjs`、`src/clean.mjs`。酒店查询编排与可见表单脚本位于 `src/hotel-search.mjs`、`src/hotel-page.mjs`。交通查询与页面脚本位于 `src/transport.mjs`、`src/transport-page.mjs`。修改边界结构时同步更新 `contracts/plugin.json`、文档及测试。

酒店/攻略与交通分别保留当前用户及 Profile 的最后一次有效查询；交通登录、验证、预售失败不会覆盖成功结果。不提交个人网页快照、账号资料、Cookie、存储状态或令牌。公开链接会删除非允许的查询参数，因此部分站点链接可能需要重新在站内打开。

宿主 SDK 指南：[架构](docs/ARCHITECTURE.md)、[上下文](docs/STUDIO_CTX.md)、[返回约定](docs/STUDIO_RETURNS.md)、[字段](docs/FIELD_REFERENCE.md)、[宿主 API](docs/HOST_API.md)、[开发规范](docs/DEVELOPMENT.md)。

## 许可

本仓库新编写的旅行插件代码采用 [MIT](LICENSE)。随脚手架复制的 Studio SDK、harness 和宿主指南保留其原有 BSL-1.1 许可，具体范围见 [NOTICE.md](NOTICE.md)；这些文件没有重新许可为 MIT。
