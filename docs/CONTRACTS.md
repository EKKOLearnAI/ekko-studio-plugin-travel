# 旅行插件数据契约

精确字段、必填项、限制及描述统一定义在 `contracts/plugin.json`，运行时通过同一份契约校验 RPC、工具输入输出与持久化结果。

## RPC 与工具

| RPC | 输入 | 行为 |
| --- | --- | --- |
| `list-sources` | `null` | 返回来源目录，不读取用户浏览器 |
| `list-tabs` | `{}` | 列出支持来源的标签页，不采集页面 |
| `open-page` | `{source, url?}` | 校验 HTTPS 来源后新建页面；省略 URL 使用来源首页 |
| `collect-page` | `{tabId}` | 附加 CDP，执行固定 DOM 脚本，校验、清洗并存储最后一次结果；始终尝试释放租约 |
| `last-result` | `null` | 返回 `{present:false}` 或 `{present:true,result}` |

MCP 工具 `list_pages`、`open_page`、`collect_page` 复用相应处理器。工具返回 `{ok, content, data?, error?}`，采集状态为 `ok` 或 `partial` 才认为调用成功。异常返回 `ok:false`，不会隐瞒成空结果。`collect_page` 会保存结果，因此不声明只读。

没有任意 JavaScript 输入、外部抓取服务、Shell、MCP 子进程或浏览器令牌配置。只能操作内置浏览器中的支持来源；CDP 权限由宿主控制。取消信号在调用前、执行采集脚本前及持久化前检查；宿主正在执行的 CDP 请求仍受其超时和租约规则约束。

## 采集与状态

快照最多包含 40 个卡片、60 个链接和 20,000 字符正文。携程 DOM 没有匹配卡片时，尝试固定 `Accessibility.getFullAXTree` 适配器，仅用唯一 `Current price` 作为当前价格，原价不会替代当前价。该适配器依赖站点当前标签和排列，变化时需更新。

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

采集结果包含 `schemaVersion:1`；首次发布无历史数据迁移。后续不兼容变更须升级版本、实现迁移并补充说明与测试。脚手架 greeting/settings 示例未在本插件发布，不做兼容。
