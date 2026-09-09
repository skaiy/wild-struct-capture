# StructCapture 业务层与运行时架构

## 目标与边界

StructCapture 是拍录业务应用；业务输入、输出和人工确认（HITL）状态由本仓库的 Next.js 业务层拥有。原版 Wild AgentOS（WAO）只作为可替换的运行时中间件，承载可热更新资产与通用推理能力，不能成为拍录业务数据库或路由宿主。

```text
PWA shell → 同源 Capture BFF → 原版 WAO（可选通用运行时）→ 模型池
     │              │                     │                    │
LocalStorage   会话/HITL/结果          资产版本/任务          模型与凭据
```

## 各层职责和存储

### PWA shell

- 展示模板、相机与离线体验；用 LocalStorage 暂存设备侧拍录韧性数据。
- 只调用同源 `/api/wao`；不直接调用 VL、WildPool、模型服务或 WAO。
- 不保存服务端权威的审批状态，也不持有模型密钥。

### Capture BFF（本应用服务端）

- 公开拍录业务契约：会话、照片、`extract`、`organize`、`approve`、`reject`。
- 业务权威存储：sessions、shots、organized captures、HITL 状态和退回原因。当前为可替换的内存 Store，生产环境替换为数据库适配器。
- 按知识包/Agent 配置所定义的 schema、规则、标签组织结果；负责校验、审计、授权和最终导出前的 HITL 门禁。
- 可在 WAO 健康且配置完成时调用其**通用** Agent chat/task API 做最佳努力的推理增强；失败或不可用时仍使用本地资产驱动的整理路径。

### 原版 WAO 运行时中间件

- 只托管热更新的 ontology/knowledge packs、Agents、应用技能、prompts 及其激活版本，并可执行通用任务。
- 不保存 StructCapture 会话、照片、业务输出或 HITL 中间状态。
- 不增加 `/sessions`、`/captures/*` 或任何拍录专用 Rust 路由；本里程碑不要求修改 WAO core。

### 模型池

- 提供文本、视觉等模型推理及模型凭据管理。
- 示例角色：文本默认 `deepseek-v4-flash`，视觉默认 `Qwen/Qwen3-VL-8B-Instruct`。
- 模型名是运行时资产数据；API key 只留在模型池/WAO 的受控运行环境，绝不提交到仓库或下发给浏览器。

## 调用链

1. PWA 通过 `WaoClient` 调用同源 `POST /api/wao/sessions` 与 session shots。
2. BFF 写入业务 Store；浏览器可同时保留本地离线副本。
3. PWA 发送 `POST /api/wao/captures/extract` 或 `organize`。
4. BFF 读取版本化知识包的规则和标签，生成结构化建议；可选调用 WAO 通用任务作增强，但不依赖 WAO 的拍录路由。
5. BFF 保存整理结果，返回 `pending_hitl`。
6. PWA 调用 BFF 的 approve/reject；BFF 更新权威 HITL 状态。仅 `approved` 可导出。

## M5：可选模型网关增强

`extract` 与 `organize` 先同步构建本地知识包字段。原版 WAO 0.6 的 `POST /api/v1/agents/:id/chat` 和 OpenAI 兼容 Agent 路径会在 `build_chat_context` 注入面向“新能源汽车故障诊断/维修 RAG”的系统提示词，故它们不是 StructCapture 可用的领域无关整理接口。BFF 不调用这些路径，也不以 WAO 健康状态决定业务可用性。

当服务端同时配置 `STRUCTCAPTURE_LLM_BASE_URL` 与 `STRUCTCAPTURE_LLM_API_KEY` 时，BFF 会最佳努力向该 OpenAI 兼容网关的 `/v1/chat/completions` 发送 pack 的规则、标签、schema 和照片 caption/direction。该共享模型网关与 WAO 的 WildPool/new-api 使用方式同类，但不经过 WAO 的车修 RAG Agent；`STRUCTCAPTURE_LLM_MODEL` 默认 `deepseek-v4-flash`。POC 的 `imageUrl` 仅是引用，不能假定网关已下载或读取图片。

模型的结构化回答只能替换摘要并补充当前 pack 中定义的键，不能改变 `schema`、`shot_count`、`pending_hitl` 或任何业务状态。未配置变量、网关拒绝、超时、非成功响应或无法解析的回答都返回 `null` 增强，BFF 继续保存本地结果。因此该调用既不要求 WAO 可用，也不引入 WAO `/sessions` 或 `/captures/*` 路由。知识包和 Agent 仍可作为可安装的版本化 WAO runtime 资产保留。

## 禁止实践

- 不给 WAO core 添加拍录业务 API、会话表或 HITL 工作流。
- 不让浏览器绕过 BFF 直连 VL/WildPool/WAO/模型服务。
- 不把业务状态伪装为知识包、提示词或 Agent 状态上传到 WAO。
- 不将 API key、令牌、生产 URL 写入运行时资产、客户端代码或 Git。
- 不把“WAO 可用”作为拍录业务可用的前提。

## DevStub 与故障回退

客户端继续使用同源 `HttpWaoClient("/api/wao")`，请求失败时回退为 DevStub，保证本地 POC 可演示。BFF 的本地整理也不依赖 WAO：未配置 `WAO_BASE_URL`、健康检查/通用调用失败，或运行时未安装相关资产时，都应返回可审核的本地结果。DevStub 仅是浏览器级兜底；它不是业务层的持久化替代方案。

## 运行时资产版本化

`docs/runtime-assets/` 是可审阅的资产源：每个知识包具有稳定 `id` 与递增 `version`，包含 schema fields、extraction rules、labels；Agent 配置通过 pack id 和 model roles 引用它们。提示词和应用技能同样作为数据版本化并热加载到在线 WAO，不需要修改 WAO Rust 或重新部署 PWA。BFF 可内置/加载同一已审阅资产版本，以保证 WAO 不可用时输出仍遵循相同业务定义。
