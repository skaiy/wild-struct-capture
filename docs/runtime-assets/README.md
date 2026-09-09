# StructCapture 运行时资产

本目录保存可热更新的 WAO 运行时数据草案，而不是 Rust 路由或浏览器配置。包括知识包、Agent 配置、应用技能与提示词。

## 无代码加载流程

1. 在业务仓库审阅并版本化 JSON 资产；`id` 保持稳定，使用 `version` 标识变更。
2. 通过原版 WAO 已有的资产管理、Agent/技能/提示词导入能力上传资产（具体命令由部署的 WAO 版本决定）。
3. 在 WAO 中激活所需版本；无需重新编译、部署或修改 WAO Rust。
4. 由 StructCapture BFF 按需使用 WAO 的**通用**运行时 task 能力（若部署启用），并始终保留本地资产驱动的整理回退。

`structcapture.agent.json` 只声明模型角色和模型标识，不含 API key、端点密码或其他密钥。密钥只由 WAO/模型池的运行时环境配置管理。

StructCapture 的领域 Chat 提示词、对话体验和 HITL 位于业务客户端 / Capture BFF 的 enrichment 路径，不属于 WAO core。
WAO 上的 packs、agents 与 skills 是可按 tenant、project 或 claims 隔离的运行时资产，可由不同业务分别安装和激活。
原版 WAO 的新能源车维修 RAG Agent 是另一项业务资产，不是 StructCapture 的 Chat 实现。

## 可选的模型网关增强

M5 的 BFF 默认先使用这里版本化的知识包生成本地字段。当前原版 WAO 0.6 的 Agent chat 与 OpenAI 兼容 Agent 路径会注入面向“新能源汽车故障诊断/维修 RAG”的系统提示词，不能作为领域无关的 StructCapture 整理器。因此 BFF 不调用该 Agent chat。

如配置 `STRUCTCAPTURE_LLM_BASE_URL`、`STRUCTCAPTURE_LLM_API_KEY` 与可选的 `STRUCTCAPTURE_LLM_MODEL`，BFF 会从服务器端调用共享的 OpenAI 兼容模型网关（WAO 使用的 WildPool/new-api 属于同类网关），提交规则、标签、schema 与照片说明。模型返回的 JSON 仅可补充 `summary` 和当前知识包定义的字段；业务会话、HITL 与照片仍留在 BFF，图片 URL 在 POC 中只作为引用传递。

缺少配置、网关失败、超时或响应格式不正确时，BFF 忽略增强结果，保留本地字段并照常返回 `pending_hitl`。知识包和 Agent 资产仍可在 WAO registry 中版本化和安装；这不要求 WAO core 新增 `/sessions`、`/captures` 或领域通用 chat 路由。

## 当前草案

- `crash-prep.knowledge-pack.json`：碰撞实验准备。
- `home-inventory.knowledge-pack.json`：家庭物品盘点。
- `structcapture.agent.json`：引用上述知识包，并声明文本与视觉模型角色。

资产可以独立于 PWA/BFF 发布；业务会话、照片、整理结果与 HITL 状态不能作为运行时资产上传到 WAO。
