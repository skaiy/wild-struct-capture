# StructCapture 运行时资产

本目录保存可热更新的 WAO 运行时数据草案，而不是 Rust 路由或浏览器配置。包括知识包、Agent 配置、应用技能与提示词。

## 无代码加载流程

1. 在业务仓库审阅并版本化 JSON 资产；`id` 保持稳定，使用 `version` 标识变更。
2. 通过原版 WAO 已有的资产管理、Agent/技能/提示词导入能力上传资产（具体命令由部署的 WAO 版本决定）。
3. 在 WAO 中激活所需版本；无需重新编译、部署或修改 WAO Rust。
4. 由 StructCapture BFF 将业务请求提交给 WAO 的**通用** Agent chat/task 能力（若部署启用），并始终保留本地资产驱动的整理回退。

`structcapture.agent.json` 只声明模型角色和模型标识，不含 API key、端点密码或其他密钥。密钥只由 WAO/模型池的运行时环境配置管理。

## 当前草案

- `crash-prep.knowledge-pack.json`：碰撞实验准备。
- `home-inventory.knowledge-pack.json`：家庭物品盘点。
- `structcapture.agent.json`：引用上述知识包，并声明文本与视觉模型角色。

资产可以独立于 PWA/BFF 发布；业务会话、照片、整理结果与 HITL 状态不能作为运行时资产上传到 WAO。
