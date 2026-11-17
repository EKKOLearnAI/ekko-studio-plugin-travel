# 旅行插件数据契约

精确字段、必填项、限制及描述统一定义在 `contracts/plugin.json`，运行时通过同一份契约校验 RPC、工具输入输出与持久化结果。

插件以 MCP 工具供 Studio 对话调用，不注册客户端、插件页面或导航入口。下列 RPC 与持久化结构保留兼容，工具直接复用后端处理器，不依赖页面挂载。

## RPC 与工具

| RPC | 输入 | 行为 |
| --- | --- | --- |
| `search-hotels` | `{city,address,checkIn,checkOut,maxPrice?}` | 固定脚本选城市、提交地址、核对条件后采集并保存；失败不覆盖最近结果 |
| `search-trains` | `{from,to,departureDate,highSpeedOnly?,limit?}` | 按单程和日期查询，默认 G/D/C，核对实际站点条件并分别清洗席别价格/余票 |
| `search-flights` | `{from,to,departureDate,directOnly?,cabin?,limit?}` | 国内单程 1 成人，默认经济舱直飞；站点选择城市全部机场 |
| `last-transport` | `null` | 当前用户/Profile 最近成功交通结果，结构与酒店攻略独立 |
| `list-sources` | `null` | 返回来源目录，不读取用户浏览器 |
| `list-tabs` | `{}` | 列出支持来源的标签页，不采集页面 |
| `open-page` | `{source, url?}` | 校验 HTTPS 来源后新建页面；省略 URL 使用来源首页 |
| `collect-page` | `{tabId}` | 附加 CDP，执行固定 DOM 脚本，校验、清洗并存储最后一次结果；始终尝试释放租约 |
| `last-result` | `null` | 返回 `{present:false}` 或 `{present:true,result}` |

MCP 工具 `search_trains`、`search_flights`、`search_hotels`、`list_pages`、`open_page`、`collect_page` 复用相应处理器。工具返回 `{ok, content, data?, error?}`；成功及页面状态结果的 content 为 data 的 JSON 文本，确保受管 MCP 优先回传 content 时模型仍收到完整结构。异常时 content 和 error 都包含具体原因。采集状态为 `ok` 或 `partial` 认为调用成功；交通查询已核实条件且筛选无匹配时 `empty` 也为成功。异常返回 `ok:false`，不会隐瞒成空结果。`collect_page` 会保存结果，因此不声明只读。

站点工具没有任意 JavaScript 输入、外部抓取服务、Shell、MCP 子进程或浏览器令牌配置，只能操作内置浏览器中的支持来源；CDP 权限由宿主控制。取消信号在调用前、执行采集脚本前及持久化前检查；宿主正在执行的 CDP 请求仍受其超时和租约规则约束。高德工具直接使用独立的固定官方 HTTPS API，见下文。

## 高德地图工具

四个新增工具直接注册 MCP，不增加 RPC、客户端或页面。输入、输出及存储模型均在 `contracts/plugin.json`；所有返回同时放入 `content` JSON 与 `data`。

| 工具 | 输入与默认值 | 行为 |
| --- | --- | --- |
| `configure_amap` | action 必填 status/save/clear；key 仅 save 必填 | status 返回当前用户/Profile 是否已配置；save 验证后加密保存；clear 仅在用户要求时清除当前分区 |
| `geocode_address` | address 必填，city 可选 | 返回至多 10 个 GCJ-02 地址候选；多义或粗粒度匹配返回 `needs_clarification` |
| `reverse_geocode` | location、coordinateSystem 必填 | WGS84 先转换；GCJ-02 直接逆地址解析；不请求设备位置 |
| `plan_route` | mode 必填 transit/driving/walking；origin/destination 必填；limit 默认 3，范围 1–3 | 地址或显式坐标端点，返回分段路线与换乘信息；公交城市代码来自实际解析 |

坐标必须为经度在前、纬度在后，范围 ±180/±90，请求时最多六位小数。起终点各自只能提供 address 或 location；地址允许 city，坐标必须提供 coordinateSystem=gcj02/wgs84。不接受调用者的 userId/Profile，不自动获取当前位置或补造城市代码。路线只接收唯一且足够具体的地址，歧义、粗粒度和无匹配端点要求澄清。公交按查询时刻、推荐策略规划并包含夜班车候选；驾车为高德推荐策略，未传车牌，不能据此保证个人车辆不限行。

`amap-result` 的共同字段为 schemaVersion=1/source=amap/status/message/queriedAt（Unix 毫秒）；按操作提供 configured/scope/updatedAt、clarification、address、candidates，或 mode/origin/destination/routes/warnings。路线 distanceMeters 为米、durationSeconds 为秒、fareYuan/tollsYuan 为人民币元；未知数值省略。公交 steps 保持步行、公交/地铁、铁路、出租车的顺序；lines 是同一段备选线路，不作为连续乘车。保留上下车站、途经站和地铁出入口；transfers 为公交/铁路乘坐段数减一。出现无法解释的路段时失败，不静默漏段。路线最多 3 条，完整导航步骤超过契约或大小上限时明确失败，不无提示截短路线。

`ok`/`empty` 为工具成功；`needs_configuration`/`needs_clarification` 为待用户输入；`invalid_input`、`authentication_error`、`permission_denied`、`rate_limited`、`upstream_error`、`invalid_response`、`cancelled`、`timeout`、`storage_error` 为明确失败。错误不解释为空路线；缺失时间或费用不解释为零。每次请求超时 15 秒，整次操作最多 60 秒，响应体最多 2 MB，返回数据最多 750 KB（MCP content/data 重复包装后仍在宿主限制内）。不自动重试，不跟随 HTTP 重定向，不转发上游原始错误或带凭证 URL。

缺 Key 时 clarification 包含 question/nextTool/instructions；由当前 Agent 使用宿主澄清 UI 提问，收到实际答案后调用 `configure_amap` 的 save，再重试。认证失效同样要求配置；配额/权限失败不反复索取 Key。普通 RunContext 没有 interactions，不从插件内部创建会话或调用另一个 Agent。取消、超时、无交互环境均不能被当作用户回答。

`amap-key-v1` 存在 `run.state.profile`，内容为 version/iv/tag/ciphertext/updatedAt；AES-256-GCM 的 AAD 绑定真实 userId/Profile。加密用 32 字节随机密钥位于 `ctx.paths.dataDir/amap-key-encryption-v1`，以完整文件原子创建，权限 0600。无原密钥文件时不自动为已有记录生成新密钥；损坏、篡改或跨分区密文不能读取。save 先用公开固定地标验证逆解析结果，失败或取消保留旧记录。status 只返回配置状态和更新时间，不返回明文或密文；clear 只删除当前 Profile 的记录。加密保护插件存储中的静态记录，不替代宿主会话/工具输入的保密机制。

## 酒店查询条件

`search-hotels` / `search_hotels` 必填城市、地址/商圈/地标、入住和离店日期。日期格式 YYYY-MM-DD，按北京时间今天校验，离店须晚于入住且最多 30 晚；非法条件在新建标签页前拒绝。查询使用一个新酒店标签页，保留供用户检查，每次操作最后尝试释放租约；不自动关闭用户标签页。

城市通过可见联想项精确选择，不使用猜测的城市 ID；地点多义时抛出错误。地址能匹配唯一联想项则选择，未匹配则提交为关键词。固定脚本仅观察可见输入和输入框附近的浮层候选，再由 CDP 执行输入和点击；没有模型参与页面操作。等待完整新文档加载并稳定后，同时核对 URL（支持 cityName/destName）、可见城市/地址/日期及 CNY 币种；采集后再次核对，条件变化时丢弃数据并保留旧存储。单阶段等待有上限，等待可取消，登录、验证及拒绝访问立即停止。

成功查询的 collection 增加可选 `search`，保存 requested、实际城市/地址/日期文字、站点当前房间/人数、conditionsVerified 及 locationMode。`poi` 表示站点选择了地点，未独立验证地理坐标；`keyword` 仅按地址文字查询，不保证附近半径或距离排序。不支持输入人数/房型/距离。

maxPrice 为可选人民币元上限，仅在本批已采集记录中筛选明示起价或每晚价格。高于上限的记录排除并计入 budgetExcluded；条件价、总价、缺价和口径未知的记录保留并计入 budgetUnverified，调用方整理结果时应说明预算待核实。不能把筛选后零条记录解释成全站无房或该地点无酒店。

## 交通查询与字段

`train-query` 必填 `from/to/departureDate`，可选 `highSpeedOnly`（默认 true，仅 G/D/C）和 `limit`（默认 20，1–50）。`flight-query` 共享必填字段，另有 `directOnly`（默认 true）、`cabin`（默认 economy，或 all）和 limit。日期有效且不早于北京时间今天，本版最多未来一年；实际预售范围由站点决定，不推断有售。

列车使用实际网页接受的中文城市/站名查询参数，核对 URL、页面输入及结果日期标题。机票先通过可见城市联想项选择完整城市（所有机场），从已选输入取得三字代码，避免把机场子项当城市；明确单程 1 成人、0 儿童、0 婴儿及日期/舱等，随后核对结果页。以最多 50 个现有卡片的有界滚动触发航班号懒加载，不点击订票/展开运价；未明确航班号的卡片不冒充有效记录。等待及滚动有界，响应取消并始终尝试释放租约，保留查询标签页供检查。

`transport-result` 字段：

| 字段 | 含义 |
| --- | --- |
| mode/source/requested/observed | train 或 flight、携程来源、补齐默认值的输入、实际页面地点/日期/舱等 |
| conditionsVerified | URL 与页面条件吻合，采集后再次核对；不符时丢弃数据或返回失败状态 |
| loadedCount/matchedCount/truncated | 当前 DOM 卡片数、符合 G/D/C 或直飞筛选的数目、是否被 limit 截断；不代表全站总量 |
| records[].serviceCodes/provider | 车次/航段航班号和提供方，代码共享不单凭代码个数当中转 |
| departurePlace/arrivalPlace/departureTime/arrivalTime | 实际车站/机场航站楼和 HH:mm；不把城市内所有车站视为同一位置 |
| arrivalDayText/durationText/connectionType/connectionText | 明确跨日和总耗时，直达/直飞、经停、中转及原文；中转等待不冒充全程时间 |
| price | 列表展示价；amountMinor 为人民币分；basis 为 starting、conditional、per_seat、unknown |
| seats[] | 具体列车席别、独立报价、余票原文；remaining 仅明确 N 张时提供 |
| seats[].availability | available、unavailable（含抢票）、not_on_sale、unknown；没有库存不标可预订 |
| feeInclusion/conditionsText/cabinText | 明确包含/不含税费或 unknown，以及优惠标签和舱等原文；不自动叠加机建燃油 |
| url/collectedAt/rawText/warnings/diagnostics | 来源、查询时间、有限卡片原文、边界说明和缺字段丢弃计数 |

交通成功记录保持 `partial`。已加载候选经筛选为零或页面明确无班次为 `empty`；预售提示且无记录为 `not_on_sale`。缺班次、时刻、站点的行丢弃并计数，不能把结构变化当作无票。票价只用指定报价节点，优惠“已减 ¥103”不替代“¥427 起”；会员等条件保留，景点赠券不直接视为机票券后价。未核实税费、行李和退改不补造。所有字段、嵌套对象及内部快照在契约中描述并校验，不开放任意脚本输入。

## 采集与状态

快照最多包含 40 个卡片、60 个链接和 20,000 字符正文。携程 DOM 有且仅有一个可见 Current price 标记时，只将其金额作为当前价，并保留可见的优惠条件文字；原价与优惠金额仍保留在记录 text 中供追溯。仅有 Original price 或存在多个当前价时不猜测金额；新客、首单、首住、会员与券类文字标记 conditional。携程 DOM 没有匹配卡片时，尝试固定 `Accessibility.getFullAXTree` 适配器，仅用唯一 `Current price` 作为当前价格，原价不会替代当前价。该适配器依赖站点当前标签和排列，变化时需更新。

| 状态 | 含义 |
| --- | --- |
| `ok` | 已匹配图文正文；只代表该脚本提取成功，不代表攻略已核实 |
| `partial` | 酒店/团购展示数据，或仅有攻略列表摘要 |
| `login_required` | 检测到明确登录提示 |
| `verification_required` | 检测到安全验证或访问频繁提示 |
| `blocked` | 页面显示 403 / Access Denied 等阻断 |
| `not_on_sale` | 交通页面明确提示未开售或超出预售期，无交通记录 |
| `loading` | 页面加载中或尚无文本 |
| `empty` | 页面明确显示无匹配结果 |
| `layout_changed` | 页面有文本，但选择器没有匹配；不能认定没有数据 |

每条结果保留来源页面、采集时间、原始展示文字及价格原文。链接的非允许查询参数和 hash 会被删除，避免回传常见会话参数；这不是任意页面文本的脱敏器。诊断只含限长正文摘录和计数，仍可能出现页面可见的个人信息，不应公开上传真实采集结果。

## 价格与内容限制

金额以人民币分存储为 `amountMinor`，缺失或歧义时省略该字段，不使用零替代。`price.basis` 为 `starting`、`conditional`、`per_night`、`total` 或 `unknown`。房型、入住/离店日期、人数、税费和退订条件尚未形成完整模型，因此酒店与团购结果始终为部分数据。

v0.5 专用攻略正文区域至少 40 字符，通用语义区域至少 160 字符，并校验标题与链接密度；纯图片笔记可以返回图片列表。旧 `collect_page` 复用新采集器后转为兼容的 `guide` / `guide_link`；精确日期和图片索引使用 `read_guide`。OCR 作为独立工具结果，视频尚未处理；图文采集本身不解析路线，路线请使用高德 `plan_route`。脚本匹配成功也不代表内容时效或事实可靠，AI 整理时应保留来源与时间。

## 存储与兼容

只使用可信运行上下文的 `run.state.profile`，由宿主按真实用户及 Profile 隔离，不接受调用方传入分区身份。键为 `last-collection-v1`，版本为 1，存储已校验的 `collection`。无记录返回 `present:false`；读取到非法记录时抛出错误，不自动覆盖或猜测默认值。

采集结果包含 `schemaVersion:1`；v0.2 为 collection 添加可选 search，不改变已有字段含义；v0.1 记录无该字段仍可读，无需迁移。v0.2.1 完善表单适配、导航等待和当前价识别，不改变字段类型；历史歧义价格不会自动猜测补全，重新采集可获得新结果。v0.2.2 将工具 content 改为 data 的 JSON 文本并扩大文本限制，持久化 collection 不变；MCP 消费方可以直接解析记录，异常文本包含具体原因。后续不兼容变更须升级版本、实现迁移并补充说明与测试。脚手架 greeting/settings 示例未在本插件发布，不做兼容。


v0.3.0 新增独立 `last-transport-v1`（transport-result / schemaVersion:1），仅保存核对成功的 partial 或 empty 交通结果；失败不覆盖。酒店/攻略 `last-collection-v1` 不变，旧记录无需迁移。交通来源使用专用模型，不扩大酒店/攻略记录类型。

v0.3.1 移除客户端、插件页面、导航入口和 `ui` 权限，名称简化为“旅行助手”。六个 MCP 工具及既有 RPC、持久化结构保持兼容，无需数据迁移。升级后在对话中调用工具获取结果，登录和验证仍在 Studio 内置浏览器中的来源站点完成。

v0.4.0 新增四个高德工具和独立的加密 Key 记录；原六个工具、RPC 和采集存储不变。升级无需迁移旧查询数据，用户首次调用地图功能时经澄清配置 Key。地图查询结果不额外持久化，不复用酒店/交通结果存储。

v0.5.1 将插件显示名称改为“去哪玩”、作者设为 `ekko`，并以 `assets/icon.png` 提供插件图标。原始 Logo 与生成提示词保存在 `assets/`。技术 ID、MCP 命名空间和存储键保持 `travel` 体系，无需迁移既有配置或查询记录。


## v0.5 攻略契约与容错

`search_guides`、`read_guide` 使用独立 `guide-result`，不扩大旧 collection 字段。`guide-snapshot` 是固定浏览器脚本的有界返回，实际经过校验，不保存原始 DOM。`guide-ocr-result` 单独承载图片模型转录。三个输入模型拒绝未知字段和任意 JS/选择器。

| 字段 | 含义与边界 |
| --- | --- |
| source / tabId / url | 当前来源、标签页和清理过的来源链接；执行前无法定位时可省略 |
| query / conditionsVerified | 仅搜索存在；URL 路径/关键词与可见搜索框核对，失败不使用推荐内容 |
| records[].kind | guide、travelogue、attraction、destination；不表示全文已读 |
| extraction / truncated | site_dom、semantic_dom、accessibility、link_semantics；最后一种只有摘要，必须读原文 |
| selectionTitle | 无 href 的携程卡片可见标题，url 为空；当前 Agent 用浏览器点击，不猜链接 |
| published / modified | raw 原文、visible/metadata/unknown 证据来源；date 仅在年份/日历有效时存在，保留未知和相对日期 |
| snapshot.article.imagesPending | 固定脚本发现图片尚未加载/加载失败；短轮询后保留明确提醒，不能当作没有图片 |
| images[].index / visible | 本次正文图片索引及是否完整在视口且无遮挡；翻图/滚动后重新采集 |
| diagnostics | 提取通道、匹配计数、最多 800 字符摘录；详情页摘录限制在正文/标题，避免带入背景推荐流 |
| nextAction | 插件编写的失败接管提示，不能执行网页或 OCR 内容里的命令 |

已核对条件并有明确空结果才返回 `empty`。门禁和不可用页优先于正文，包括跳转登录；`layout_changed`、`query_mismatch`、`browser_error`、`cancelled`、`timeout` 不写成功存储。固定 DOM → 语义区域 → 有标题关联的无障碍 article；无可信区域即失败，不把 body 当正文。JSON-LD 只允许与标题匹配的日期元数据，不能用于绕过登录读取隐藏文章。

搜索/正文读取总时限 20 秒，最多 12 次短轮询；不自动重试验证码或登录。OCR 总时限 45 秒，单次只处理一张图片；截图前后核对页面、图片 URL 和区域，变化即丢弃。OCR 模型目录只接受宿主返回的完整 ID；省略/不可用模型时返回 `needs_model`，由当前 Agent 使用本轮宿主澄清选择，插件不新建会话。图片二进制仅用于该次模型请求，`store:false`；是否由模型供应商保留请求依其服务约定，插件不承诺上游零保留。

新增 `last-guide-v1`（schemaVersion 1），仅保存有效 ok/partial/empty 结果到真实 `run.state.profile`；失败保留之前记录。现有 last-collection-v1、last-transport-v1 和高德密钥记录不迁移，旧读取仍可用。旧 collect_page 也使用新攻略提取逻辑，兼容字段会省略日期等新增能力，并提示调用专用工具。
