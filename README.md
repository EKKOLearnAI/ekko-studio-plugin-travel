# 去哪玩

![去哪玩 Logo](assets/icon.png)

作者：**ekko**。Ekko Studio 对话式旅行插件。

通过 MCP 工具提供旅游查询：使用 Studio 内置浏览器采集酒店、动车、机票展示报价及图文攻略，使用高德 Web 服务解析地址并规划出行路线，再由 AI 在对话中整理结果。

当前是 **v0.5.1 旅游查询工具版**，直接在 Studio 对话中使用，不提供独立插件页面或侧栏入口。支持酒店、动车/火车票、国内单程机票、地址/逆地址解析及公交、驾车、步行路线规划。高德功能需用户自己的 Web 服务 Key。插件不主动获取手机定位；附近美食和完整比价尚未实现。

```text
Studio 内置浏览器 → 浏览器 SDK / CDP → 站点脚本 → 契约校验与清洗 → MCP 工具 → AI 整理
高德 Web 服务 → 地址解析 / 坐标转换 / 路线规划 → 契约校验 → MCP 工具 → AI 整理
```

正文和搜索采集不调用模型；图片识别通过宿主模型服务按需调用。页面变化或无链接卡片由当前 Agent 使用 Studio 浏览器接管。登录及站点要求的验证由用户在浏览器中完成。

## 来源与当前边界

| 来源 | 当前能力 | 边界 |
| --- | --- | --- |
| 携程酒店 | 固定脚本按城市/地址查询；核对日期后采集卡片；无 DOM 匹配时使用固定无障碍树适配器 | 地点与关键词模式分开；预算仅筛本批展示价；缺少完整房型/费用条件 |
| 携程列车 | 单程查询；默认 G/D/C 动车高铁；席别价格、余票、车站与时间 | 抢票不视为有票；预售以站点为准；结果仅覆盖已加载卡片 |
| 携程机票 | 国内单程 1 成人；城市全部机场；经济舱/不限舱等、直飞/包含中转 | 有界滚动加载航班号；展示价不保证包含税费/行李；不保证全量或最低价 |
| 小红书 | 关键词搜索、图文正文、日期证据、单张正文图片识别 | 编辑时间不当作发布时间；缺少年份不推测；轮播需逐张切换，视频不支持 |
| 携程攻略 | 新搜索入口的目的地/景点卡片、景点介绍、存量游记正文 | 无 href 卡片按可见标题交给当前 Agent 点击；旧游记业务已停止运维，不代表新鲜攻略 |
| 马蜂窝 | 关键词搜索、自由行/行程/游记链接、正文和日期证据 | 部分游记跳转登录；只读当前公开可见内容，不绕过验证 |
| 美团 | 预置调试入口、阻断识别 | 调试过的酒店入口返回 403；不能据此判断所有美团网页均不可用 |
| 高德地图 | 地址/逆地址解析；WGS84 转 GCJ-02；公交、驾车、步行路线与分段指引 | 需 Web 服务 Key 及对应接口权限；路线耗时和费用为估计，不保证实时公交到站或票务库存 |

已通过公开 `run.host.browser` SDK，在本地 Desktop 现有登录态完成携程杭州东站、苏州站的真实查询，以及小红书图文详情文字采集。也完成上海→杭州列车、上海→北京机票的真实条件查询。查询条件核对和页面当前价比对已实测；价格仍为展示报价，房型/费用等条件尚未完整建模。自动化 CI 使用合成页面与真实 Chromium CDP，不访问个人账号；攻略线上验证范围见下文；美团仍按上表标记边界。

## 安装与调试

需要 Node.js 22+。站点采集还需要支持插件浏览器 SDK 的 Ekko Studio Desktop，以及启用本地浏览器连接的宿主版本（[Studio 修复 PR #3843](https://github.com/EKKOLearnAI/ekko-studio/pull/3843)）。Web UI 与 Desktop 必须同时包含该修复；只更新插件不能修复旧 Desktop 的接入限制。高德工具直接从插件服务端访问官方 HTTPS API，不依赖 Desktop 浏览器。

```bash
git clone https://github.com/EKKOLearnAI/ekko-studio-plugin-travel.git
cd ekko-studio-plugin-travel
npm ci --include=dev --ignore-scripts
npm run check
ekko-studio plugins link .
```

在 Studio 插件中心启用“去哪玩”后，直接在对话中描述需求，例如：

- “帮我查杭州东站附近的酒店，明天入住、后天离店，展示价不超过 300 元。”
- “查明天上海到杭州的高铁，列出票价、车站、时间和余票。”
- “查后天上海到北京的经济舱直飞机票。”
- “采集内置浏览器里已打开的小红书攻略，整理出游建议。”
- “从杭州东站到西湖怎么坐公交？再比较一下开车和步行。”
- “把这组 WGS84 经纬度解析成具体地址。”

AI 调用 MCP 工具取得查询结果，再在对话中整理酒店、班次或攻略。工具保留来源、采集时间、地点匹配方式与价格限制，便于核对结果。

酒店、火车票、机票及攻略查询仍使用 Studio 内置浏览器中的真实站点页面。需要登录、验证或人工确认地点时，插件会返回具体原因；在浏览器处理后继续对话即可。插件不再提供查询表单、原始 JSON 或诊断数据展示页。

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
| `search_guides` | `{ "source": "mafengwo", "query": "杭州三日游", "limit": 10 }` | 独立查询 `ctrip-guide` / `mafengwo` / `xiaohongshu`；`tabId` 可选，复用该来源指定页面 |
| `read_guide` | `{ "tabId": "页面 ID", "url": "选中结果链接（可省略）" }` | 正文/摘要、发布时间和修改时间证据、图片索引；小红书原链接令牌留在浏览器内 |
| `recognize_guide_image` | `{ "tabId": "页面 ID", "imageIndex": 0, "model": "宿主完整视觉模型 ID" }` | 单张完整可见图片的文字转录；不传 model 则返回候选，要求当前 Agent 澄清选择 |
| `collect_page` | `{ "tabId": "标签页 ID" }` | 清洗后的记录、来源、采集时间、状态和诊断 |
| `configure_amap` | `{ "action": "status" }`；保存用 `action: "save", key`；删除用 `action: "clear"` | 当前用户/Profile 的配置状态；不返回 Key |
| `geocode_address` | `{ "address": "杭州东站", "city": "杭州" }` | 地址候选及 GCJ-02 坐标；同名或粗粒度结果要求澄清 |
| `reverse_geocode` | `{ "location": "120.21201,30.29039", "coordinateSystem": "wgs84" }` | 转换为高德坐标后返回结构化地址；坐标已为高德坐标时传 `gcj02` |
| `plan_route` | `{ "mode": "transit", "origin": { "address": "杭州东站", "city": "杭州" }, "destination": { "address": "西湖断桥", "city": "杭州" } }` | 公交/地铁换乘及步行段；mode 也可为 `driving`、`walking`；limit 默认 3，范围 1–3 |

## 高德 Key 与对话澄清

首次查询没有 Key 时，工具返回 `needs_configuration` 和 `clarification`。当前 Agent 应使用宿主的澄清功能请求用户提供高德 **Web 服务**类型 Key，然后调用 `configure_amap` 保存，并重试原查询。Studio Coding Agent 使用 `ekko_studio_clarify` 及本轮 `context_id`；其它引擎使用其宿主澄清接口。普通插件 `RunContext` 不提供交互方法，所以由调用工具的 Agent 执行澄清，插件不会创建新会话或伪造用户回答。取消、超时或后台环境没有交互能力时，停止在待配置状态。

保存前以一个固定公开地标验证逆地址解析权限，不使用用户位置；失败保留原配置。Key 按真实账号及 Profile 隔离，以 AES-256-GCM 加密后放在宿主插件存储，解密密钥保存在插件私有数据目录的 `amap-key-encryption-v1`，文件权限为 `0600`。升级后复用，用户可以在对话中要求更新或清除。插件不回显 Key、不打印带 Key 的请求 URL；聊天及工具输入的记录由宿主管理，因此不能承诺用户输入不进入宿主会话历史。备份恢复时需同时保留插件数据目录与宿主插件存储。

高德工具的坐标始终为“经度,纬度”。输入坐标必须声明 `wgs84` 或 `gcj02`，前者经官方转换后使用。路线端点可各自使用地址或坐标；公交所需城市编码由地址解析取得，不猜测编码。结果按查询时刻规划，暂不提供指定出发日期、车牌限行或自选策略。地点多义时要求澄清，不自动任选第一条。距离用米、耗时用秒、地图费用用人民币元，缺失值省略，不填零。

接口依据：[地理与逆地理编码](https://lbs.amap.com/api/webservice/guide/api/georegeo)、[坐标转换](https://lbs.amap.com/api/webservice/guide/api/convert)、[路径规划 2.0](https://lbs.amap.com/api/webservice/guide/api/newroute)、[公交分段字段](https://lbs.amap.com/api/webservice/guide/api/direction/)、[错误码](https://lbs.amap.com/api/webservice/guide/tools/info)。网络请求只允许固定高德 HTTPS 接口，不跟随重定向。尚未使用真实 Key 做线上验收；测试使用模拟高德响应验证请求参数、澄清、存储隔离、路线清洗与失败路径。

## 站点查询边界

酒店查询日期需为有效未来/当日日期，最多 30 晚；不接受人数、房型和距离半径筛选。城市必须精确匹配站点联想项；同名候选不会自动任选。地址不能匹配地点时作为关键词提交，明确不保证附近距离。展示价筛选仅针对当前已采集的最多 40 条记录，条件价/总价/缺价保留待核实。

支持的来源 ID：`ctrip`、`xiaohongshu`、`meituan`、`ctrip-guide`、`mafengwo`、`ctrip-trains`、`ctrip-flights`。交通页面使用专用查询工具，`collect_page` 不会按酒店卡片解析交通页面。任意脚本输入与非支持来源被拒绝。详情见 [数据契约](docs/CONTRACTS.md)。

携程 DOM 优先采用唯一 `Current price` 标记，划线原价不当作当前价；新客、首单、会员与券类文字保留为条件价。价格以分表示，只接受明确的单个人民币金额，保留原文及“起价 / 条件价 / 每晚 / 总价 / 未知”含义。缺失、区间和歧义价格不会填成零；酒店结果始终标记为部分数据，不能直接当作同房型最终成交价。

交通日期不早于北京时间今天，本版输入上限为未来一年，并不代表车票已开售；站点尚未开售时明确返回 `not_on_sale`。`limit` 为 1–50（默认 20），不执行无限滚动。机票先从城市联想项取得全部机场代码，再构造明确的单程/日期/舱等查询；不会猜测机场代码。查询前后均核对条件。返回 `loadedCount`、`matchedCount`、`truncated` 及采集时间，不把部分结果当作全量最低价。

## 攻略采集与页面变化

三站采用同一套结果契约，每个来源独立查询和失败。优先使用站点正文定位；未命中时尝试 `article`、`main`、`articleBody` 等语义区域，最后只对有标题关联的无障碍 `article` 节点兜底。不会把整个网页、推荐列表或导航栏冒充正文。结构化元数据只补充文章日期，不提取隐藏的正文或应用内部状态。

改颜色、字体通常不影响；只改类名时语义结构仍可能可用。整体改版仍可能需要修复适配器，无法保证永不失效。返回 `layout_changed` 时，当前 Agent 应查看该标签页的新快照/截图，确认区域后读取或更新适配，也可查询其他来源。`empty` 必须同时满足搜索条件核对成功且页面明确显示无结果。登录、验证码、阻断、删除、超时另有状态，不反复自动重试。

携程现有搜索卡片有些只有点击事件，没有公开 href。工具返回 `selectionTitle` 和明确接管指引；当前 Agent 用浏览器定位、点击、核对打开的页面，再调用 `read_guide`。工具不会猜测目的地或景点 ID。公开链接搜索可直接传给 `read_guide`；马蜂窝移动页的数字内容 ID 会保留，小红书导航签名仅在浏览器 DOM 中使用。搜索默认前 10 条，最多 20 条，不无限滚动。正文最多 20000 字符，图片列表最多 20 张；图片迟加载时短暂等待，仍未加载则明确提醒，不当作没有图片。已加载/当前可见不等于全量。

日期分别返回 `published` 和 `modified`，包括 `raw`、证据来源和可确定时的 `YYYY-MM-DD`。例如“编辑于 08-30”只进入修改时间，年份未知；采集时间不能用来判断文章新旧。网页资料及图片中的指令不能当作用户授权执行。

图片识别只截取当前完整可见且未遮挡的正文图片，提交给用户选择的宿主视觉模型；不传 Cookie，不抓整张网页，不保存截图。不传 `model` 时列出宿主接口可用的模型，由当前 Agent 通过本轮宿主澄清选择有视觉能力的模型，取消/超时即停止。接口可用不代表模型一定支持视觉，失败有明确状态。模型可能收费；文字单独标为 `image_ocr`，不混入作者正文。轮播图先切换，再重新读取图片索引；未识别的图片不能当成已读，价格/班次等还需官方来源核实。

2026-11-17 线上核对了携程新搜索卡片、景点介绍和存量游记正文，马蜂窝搜索、自由行攻略与三日行程正文，以及小红书搜索→原文导航、正文、编辑日期和图片区域。马蜂窝部分游记实际跳转登录，已核对 `login_required`。自动化测试使用合成页面，覆盖三站类名改动、语义兜底、隐藏/评论隔离、条件不符、登录阻断、取消和单图截图；视觉模型调用使用模拟响应，未做付费模型线上验收。不能据此承诺每个站点的全部页面类型都已验证。

## 开发与验证

```bash
npm run check                         # 契约、SDK 完整性与 Node 行为测试
npx playwright install chromium
npm run test:browser                   # MCP 工具、合成站点真实 CDP 查询流程与失败路径
```

没有构建步骤，唯一插件入口是 `server.mjs`，声明 `tools`、`browser.cdp`，以及图片识别所需的 `api.read`（模型目录）、`api.write`（模型请求）权限。选择器位于 `src/sources.mjs`；DOM 采集、无障碍树适配及清洗分别位于 `src/capture.mjs`、`src/accessibility.mjs`、`src/clean.mjs`。酒店查询编排与可见表单脚本位于 `src/hotel-search.mjs`、`src/hotel-page.mjs`。交通查询与页面脚本位于 `src/transport.mjs`、`src/transport-page.mjs`。高德工具、HTTP 客户端和加密配置分别位于 `src/amap.mjs`、`src/amap-client.mjs`、`src/amap-key.mjs`。修改边界结构时同步更新 `contracts/plugin.json`、文档及测试。

酒店/旧采集、攻略和交通分别保留当前用户及 Profile 的最后一次有效查询；失败不会覆盖成功结果。不提交个人网页快照、账号资料、Cookie、存储状态或令牌。公开链接会删除非允许的查询参数，因此部分站点链接可能需要重新在站内打开。

宿主 SDK 指南：[架构](docs/ARCHITECTURE.md)、[上下文](docs/STUDIO_CTX.md)、[返回约定](docs/STUDIO_RETURNS.md)、[字段](docs/FIELD_REFERENCE.md)、[宿主 API](docs/HOST_API.md)、[开发规范](docs/DEVELOPMENT.md)。

## 许可

本仓库新编写的旅行插件代码采用 [MIT](LICENSE)。随脚手架复制的 Studio SDK、harness 和宿主指南保留其原有 BSL-1.1 许可，具体范围见 [NOTICE.md](NOTICE.md)；这些文件没有重新许可为 MIT。
