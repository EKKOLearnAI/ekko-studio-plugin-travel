# Ekko Studio 旅行插件

用 Studio 内置浏览器中的已有登录态运行固定站点脚本，采集、清洗酒店展示报价和图文攻略，再通过 MCP 工具把结构化数据交给 AI。

当前是 **v0.1 采集调试版**。已实现页面打开、标签页选择、数据采集、价格规范化、来源追溯及失败状态展示；位置、附近美食、路线规划和完整酒店比价尚未实现。

```text
Studio 内置浏览器 → 浏览器 SDK / CDP → 站点脚本 → 契约校验与清洗 → MCP 工具 → AI 整理
```

常规采集不调用模型，不依赖 AI 自动点击。登录及站点要求的验证由用户在浏览器中完成。

## 来源与当前边界

| 来源 | 当前能力 | 边界 |
| --- | --- | --- |
| 携程酒店 | DOM 酒店卡片；无匹配时使用固定无障碍树适配器 | 仅展示报价，缺少完整入住条件；页面变更需维护脚本 |
| 小红书 | 图文列表摘要与详情页文字 | 列表不是全文；未处理图片 OCR 和视频 |
| 携程攻略、马蜂窝 | 预置入口与正文选择器 | 尚未完成真实页面验证 |
| 美团 | 预置调试入口、阻断识别 | 调试过的酒店入口返回 403；不能据此判断所有美团网页均不可用 |

真实页面调试曾获得携程酒店展示报价和小红书搜索摘要，但通过临时诊断通道取得，不代表最终 SDK 已完成真机回归。最终实现仅使用公开 `run.host.browser` SDK，仍需在包含本地浏览器接入修复的 Desktop 版本上验证。自动化测试使用合成页面，不访问个人账号。

## 安装与调试

需要 Node.js 22+、支持插件浏览器 SDK 的 Ekko Studio Desktop，以及启用本地浏览器连接的宿主版本。Web UI 与 Desktop 必须同时包含该修复；只更新插件不能修复旧 Desktop 的接入限制。

```bash
git clone https://github.com/EKKOLearnAI/ekko-studio-plugin-travel.git
cd ekko-studio-plugin-travel
npm ci --include=dev --ignore-scripts
npm run check
ekko-studio plugins link .
```

在 Studio 插件中心启用“旅行助手 · 采集调试”，打开插件页面：

1. 选择来源，打开网页并手动登录。
2. 在站点中选定目的地、日期或搜索词，进入列表或详情页。
3. 点击“刷新标签页”，选择页面，再点击“采集并清洗”。
4. 检查状态、价格原文、警告与结构化数据；遇到登录或验证提示时在原页面处理后重试。

`No authorized active Desktop browser` 表示宿主未连接可用的 Desktop 浏览器，应先检查宿主版本及登录状态。插件不会启动另一个浏览器，也不会从磁盘读取 Cookie 或宿主令牌。

## MCP 工具

安装并启用插件后，Studio 按插件命名空间暴露以下工具：

| 工具 | 输入 | 输出 |
| --- | --- | --- |
| `list_pages` | `{}` | 支持站点的已打开标签页 |
| `open_page` | `{ "source": "ctrip", "url": "https://hotels.ctrip.com/" }` | 新标签页；`url` 可省略 |
| `collect_page` | `{ "tabId": "标签页 ID" }` | 清洗后的记录、来源、采集时间、状态和诊断 |

支持的来源 ID：`ctrip`、`xiaohongshu`、`meituan`、`ctrip-guide`、`mafengwo`。任意脚本输入与非支持来源被拒绝。详情见 [数据契约](docs/CONTRACTS.md)。

价格以分表示，只接受明确的单个人民币金额，保留原文及“起价 / 条件价 / 每晚 / 总价 / 未知”含义。缺失、区间和歧义价格不会填成零；酒店结果始终标记为部分数据，不能直接当作同房型最终成交价。

## 开发与验证

```bash
npm run check                         # 契约、SDK 完整性与 Node 行为测试
npx playwright install chromium
npm run test:browser                   # 合成 DOM 页面、UI 安全展示与移动端失败重试
```

没有构建步骤，入口是 `server.mjs` 与 `client.mjs`。选择器位于 `src/sources.mjs`；DOM 采集、无障碍树适配及清洗分别位于 `src/capture.mjs`、`src/accessibility.mjs`、`src/clean.mjs`。修改边界结构时同步更新 `contracts/plugin.json`、文档及测试。

结果仅保留当前用户及 Profile 的最后一次采集。不提交个人网页快照、账号资料、Cookie、存储状态或令牌。公开链接会删除非允许的查询参数，因此部分站点链接可能需要重新在站内打开。

宿主 SDK 指南：[架构](docs/ARCHITECTURE.md)、[上下文](docs/STUDIO_CTX.md)、[返回约定](docs/STUDIO_RETURNS.md)、[字段](docs/FIELD_REFERENCE.md)、[宿主 API](docs/HOST_API.md)、[开发规范](docs/DEVELOPMENT.md)。

## 许可

本仓库新编写的旅行插件代码采用 [MIT](LICENSE)。随脚手架复制的 Studio SDK、harness 和宿主指南保留其原有 BSL-1.1 许可，具体范围见 [NOTICE.md](NOTICE.md)；这些文件没有重新许可为 MIT。
