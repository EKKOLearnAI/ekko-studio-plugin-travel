# 旅行插件数据契约

精确字段、必填项、限制及描述统一定义在 `contracts/plugin.json`，运行时通过同一份契约校验 RPC、工具输入输出与持久化结果。

## RPC 与工具

| RPC | 输入 | 行为 |
| --- | --- | --- |
| `search-hotels` | `{city,address,checkIn,checkOut,maxPrice?}` | 固定脚本选城市、提交地址、核对条件后采集并保存；失败不覆盖最近结果 |
| `list-sources` | `null` | 返回来源目录，不读取用户浏览器 |
| `list-tabs` | `{}` | 列出支持来源的标签页，不采集页面 |
| `open-page` | `{source, url?}` | 校验 HTTPS 来源后新建页面；省略 URL 使用来源首页 |
| `collect-page` | `{tabId}` | 附加 CDP，执行固定 DOM 脚本，校验、清洗并存储最后一次结果；始终尝试释放租约 |
| `last-result` | `null` | 返回 `{present:false}` 或 `{present:true,result}` |

MCP 工具 `search_hotels`、`list_pages`、`open_page`、`collect_page` 复用相应处理器。工具返回 `{ok, content, data?, error?}`；成功及页面状态结果的 content 为 data 的 JSON 文本，确保受管 MCP 优先回传 content 时模型仍收到完整结构。异常时 content 和 error 都包含具体原因。采集状态为 `ok` 或 `partial` 才认为调用成功。异常返回 `ok:false`，不会隐瞒成空结果。`collect_page` 会保存结果，因此不声明只读。

没有任意 JavaScript 输入、外部抓取服务、Shell、MCP 子进程或浏览器令牌配置。只能操作内置浏览器中的支持来源；CDP 权限由宿主控制。取消信号在调用前、执行采集脚本前及持久化前检查；宿主正在执行的 CDP 请求仍受其超时和租约规则约束。

## 酒店查询条件

`search-hotels` / `search_hotels` 必填城市、地址/商圈/地标、入住和离店日期。日期格式 YYYY-MM-DD，按北京时间今天校验，离店须晚于入住且最多 30 晚；非法条件在新建标签页前拒绝。查询使用一个新酒店标签页，保留供用户检查，每次操作最后尝试释放租约；不自动关闭用户标签页。

城市通过可见联想项精确选择，不使用猜测的城市 ID；地点多义时抛出错误。地址能匹配唯一联想项则选择，未匹配则提交为关键词。固定脚本仅观察可见输入和输入框附近的浮层候选，再由 CDP 执行输入和点击；没有模型参与页面操作。等待完整新文档加载并稳定后，同时核对 URL（支持 cityName/destName）、可见城市/地址/日期及 CNY 币种；采集后再次核对，条件变化时丢弃数据并保留旧存储。单阶段等待有上限，等待可取消，登录、验证及拒绝访问立即停止。

成功查询的 collection 增加可选 `search`，保存 requested、实际城市/地址/日期文字、站点当前房间/人数、conditionsVerified 及 locationMode。`poi` 表示站点选择了地点，未独立验证地理坐标；`keyword` 仅按地址文字查询，不保证附近半径或距离排序。不支持输入人数/房型/距离。

maxPrice 为可选人民币元上限，仅在本批已采集记录中筛选明示起价或每晚价格。高于上限的记录排除并计入 budgetExcluded；条件价、总价、缺价和口径未知的记录保留并计入 budgetUnverified，UI 明示预算待核实。不能把筛选后零条记录解释成全站无房或该地点无酒店。

## 采集与状态

快照最多包含 40 个卡片、60 个链接和 20,000 字符正文。携程 DOM 有且仅有一个可见 Current price 标记时，只将其金额作为当前价，并保留可见的优惠条件文字；原价与优惠金额仍保留在记录 text 中供追溯。仅有 Original price 或存在多个当前价时不猜测金额；新客、首单、首住、会员与券类文字标记 conditional。携程 DOM 没有匹配卡片时，尝试固定 `Accessibility.getFullAXTree` 适配器，仅用唯一 `Current price` 作为当前价格，原价不会替代当前价。该适配器依赖站点当前标签和排列，变化时需更新。

| 状态 | 含义 |
| --- | --- |
| `ok` | 已匹配图文正文；只代表该脚本提取成功，不代表攻略已核实 |
| `partial` | 酒店/团购展示数据，或仅有攻略列表摘要 |
| `login_required` | 检测到明确登录提示 |
| `verification_required` | 检测到安全验证或访问频繁提示 |
| `blocked` | 页面显示 403 / Access Denied 等阻断 |
| `loading` | 页面加载中或尚无文本 |
| `empty` | 页面明确显示无匹配结果 |
| `layout_changed` | 页面有文本，但选择器没有匹配；不能认定没有数据 |

每条结果保留来源页面、采集时间、原始展示文字及价格原文。链接的非允许查询参数和 hash 会被删除，避免回传常见会话参数；这不是任意页面文本的脱敏器。诊断只含限长正文摘录和计数，仍可能出现页面可见的个人信息，不应公开上传真实采集结果。

## 价格与内容限制

金额以人民币分存储为 `amountMinor`，缺失或歧义时省略该字段，不使用零替代。`price.basis` 为 `starting`、`conditional`、`per_night`、`total` 或 `unknown`。房型、入住/离店日期、人数、税费和退订条件尚未形成完整模型，因此酒店与团购结果始终为部分数据。

图文正文需至少 80 字符；列表记录为 `guide_link`，不冒充全文。图片独有信息、OCR、视频与实时路线尚未处理。脚本匹配成功也不代表内容时效或事实可靠，AI 整理时应保留来源与时间。

## 存储与兼容

只使用可信运行上下文的 `run.state.profile`，由宿主按真实用户及 Profile 隔离，不接受调用方传入分区身份。键为 `last-collection-v1`，版本为 1，存储已校验的 `collection`。无记录返回 `present:false`；读取到非法记录时抛出错误，不自动覆盖或猜测默认值。

采集结果包含 `schemaVersion:1`；v0.2 为 collection 添加可选 search，不改变已有字段含义；v0.1 记录无该字段仍可读，无需迁移。v0.2.1 完善表单适配、导航等待和当前价识别，不改变字段类型；历史歧义价格不会自动猜测补全，重新采集可获得新结果。v0.2.2 将工具 content 改为 data 的 JSON 文本并扩大文本限制，持久化 collection 不变；MCP 消费方可以直接解析记录，异常文本包含具体原因。后续不兼容变更须升级版本、实现迁移并补充说明与测试。脚手架 greeting/settings 示例未在本插件发布，不做兼容。
