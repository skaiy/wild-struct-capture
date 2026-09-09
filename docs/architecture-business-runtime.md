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
- 优先检查原版 WAO 中已配置的 StructCapture Agent，并以短期工作负载 OIDC Bearer token 调用其通用 Agent chat。WAO 不可用、令牌不合约或 chat 失败时，改用独立模型网关或本地资产驱动的整理路径。

### 原版 WAO 运行时中间件

- 只托管热更新的 ontology/knowledge packs、Agents、应用技能、prompts 及其激活版本，并可执行通用任务。
- 不保存 StructCapture 会话、照片、业务输出或 HITL 中间状态。
- 不增加 `/sessions`、`/captures/*` 或任何拍录专用 Rust 路由；本里程碑不要求修改 WAO core。

### 模型池

- 提供文本、视觉等模型推理及模型凭据管理。
- 示例角色：文本默认 `deepseek-v4-flash`，视觉默认 `Qwen/Qwen3-VL-8B-Instruct`。
- 模型名是运行时资产数据；API key 只留在模型池/WAO 的受控运行环境，绝不提交到仓库或下发给浏览器。

## 业务隔离与 Chat 归属

原版 WAO Agent chat 内置的“新能源汽车维修 RAG”属于另一项业务，不是 StructCapture 的领域能力；不能将其提示词、会话语义或交互流程视为本应用的实现基础。每个业务域必须可按 tenant、project 或 claims 等边界隔离，并使用独立的运行时资产（知识包、Agent、技能、提示词）及其激活版本。

领域 Chat 应归业务客户端一侧所有：StructCapture 由 Capture BFF / PWA 定义 prompts、对话 UX 和 HITL，并继续持有业务 I/O、会话与审批状态。原版 WAO 仅作为运行时中间件，托管可热更新且可隔离的 packs、agents、skills 与隔离边界；它不拥有任何行业专属 Chat 语义。StructCapture 向 WAO 通用 Agent chat 发送 BFF 生成的 pack-aware prompt；`STRUCTCAPTURE_LLM_*` OpenAI 兼容网关是失败时的服务端回退。

## 调用链

1. PWA 通过 `WaoClient` 调用同源 `POST /api/wao/sessions` 与 session shots。
2. BFF 写入业务 Store；浏览器可同时保留本地离线副本。
3. PWA 发送 `POST /api/wao/captures/extract` 或 `organize`。
4. BFF 读取版本化知识包的规则和标签，生成结构化建议；可选调用 WAO 通用任务作增强，但不依赖 WAO 的拍录路由。
5. BFF 保存整理结果，返回 `pending_hitl`。
6. PWA 调用 BFF 的 approve/reject；BFF 更新权威 HITL 状态。仅 `approved` 可导出。

## M5：WAO Agent chat、OIDC 与模型网关回退

`extract` 与 `organize` 先同步构建本地知识包字段。完整配置 `WAO_BASE_URL` 及 `STRUCTCAPTURE_WAO_OIDC_*` 后，BFF 读取原版 WAO Agent 目录，并以 `STRUCTCAPTURE_WAO_AGENT_ID`（默认名称为 `structcapture-organizer`）定位已安装的 StructCapture Agent。其 `business_domain` 必须为 `structcapture`，且目录的 tenant/project 必须为 `structcapture/default`。

当前 WAO `main`（含 #212、#213）的调用面是 `POST /api/v1/agents/{id}/chat`，请求体为 `{"message":"…","images":["https://…"]}`（`images` 可选），成功响应为 `{"status":"ok","answer":"…","model":"…"}`。通用 HTTP chat 会原样转发 BFF 的单轮 message，不注入 EV-repair prompt 或 RAG；BFF 的 message 明确携带知识包 schema、labels、rules 和 shots 的 caption/direction 证据，并要求只返回已定义字段的 JSON。

在生产模式，WAO 必须设为 `AGENTOS_ENV=production`、`AGENTOS_AUTH_MODE=oidc`，并配置 `AGENTOS_OIDC_JWKS_URL`、`AGENTOS_OIDC_ISSUER` 与 `AGENTOS_OIDC_AUDIENCE`。Capture BFF 以 `STRUCTCAPTURE_WAO_OIDC_TOKEN_URL` 的 OAuth client-credentials 流程取得短期 access token；token 的 `iss`、`aud`、`sub`、`tenant_id=structcapture`、`project_id=default` 与未过期 `exp` 会先被 BFF 作配置/范围检查，再由 WAO 以 JWKS 验签作为最终权威。BFF 不把 tenant/project 写入 chat body 作为身份来源。

Agent 目录读取、token、scope 检查、chat、超时或回答解析失败都会无害地回退。服务端同时配置 `STRUCTCAPTURE_LLM_BASE_URL` 与 `STRUCTCAPTURE_LLM_API_KEY` 时，BFF 会最佳努力向该 OpenAI 兼容网关的 `/v1/chat/completions` 发送相同的 pack 证据。`STRUCTCAPTURE_LLM_MODEL` 默认 `deepseek-v4-flash`。两个远程增强都不能使用时，home-inventory 仅填充可从 caption/direction 直接识别的品牌、规格、有效期、位置、数量和品类，其余字段为“待确认”，不转储整段说明。

模型的结构化回答只能替换摘要并补充当前 pack 中定义的键，不能改变 `schema`、`shot_count`、`pending_hitl` 或任何业务状态。未配置变量、网关拒绝、超时、非成功响应或无法解析的回答都返回 `null` 增强，BFF 继续保存本地结果。因此该调用既不要求 WAO 可用，也不引入 WAO `/sessions` 或 `/captures/*` 路由。知识包和 Agent 仍可作为可安装的版本化 WAO runtime 资产保留。

## 禁止实践

- 不给 WAO core 添加拍录业务 API、会话表或 HITL 工作流。
- 不让浏览器绕过 BFF 直连 VL/WildPool/WAO/模型服务。
- 不把业务状态伪装为知识包、提示词或 Agent 状态上传到 WAO。
- 不将 API key、令牌、生产 URL 写入运行时资产、客户端代码或 Git。
- 不把“WAO 可用”作为拍录业务可用的前提。
- 不给 Capture BFF 配置、读取、共享 `AGENTOS_JWT_SECRET`，也不在此处铸造或自签 HS256 AgentOS token。
- 不用 `X-Identity`、chat body 或其他客户端字段伪造 tenant/project 的 verified isolation claims。

## DevStub 与故障回退

客户端继续使用同源 `HttpWaoClient("/api/wao")`，请求失败时回退为 DevStub，保证本地 POC 可演示。BFF 的本地整理也不依赖 WAO：未配置 `WAO_BASE_URL`、健康检查/通用调用失败，或运行时未安装相关资产时，都应返回可审核的本地结果。DevStub 仅是浏览器级兜底；它不是业务层的持久化替代方案。

## 运行时资产版本化

`docs/runtime-assets/` 是可审阅的资产源：每个知识包具有稳定 `id` 与递增 `version`，包含 schema fields、extraction rules、labels；Agent 配置通过 pack id 和 model roles 引用它们。提示词和应用技能同样作为数据版本化并热加载到在线 WAO，不需要修改 WAO Rust 或重新部署 PWA。BFF 可内置/加载同一已审阅资产版本，以保证 WAO 不可用时输出仍遵循相同业务定义。
