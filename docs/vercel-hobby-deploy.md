# Vercel Hobby 部署与手机安装清单

本项目是一个 Next.js PWA，可部署在 Vercel Hobby，并通过公开 HTTPS 域名完成「整理 → HITL 确认/退回 → 导出」演示。拍录数据首先存于手机浏览器；当前的会话 API 使用内存存储，因此**不能**当作生产数据仓库。

Vercel Hobby 的无状态 Serverless 实例不保证保留 BFF 内存。为使公开演示可端到端完成，HITL 请求会同时携带浏览器当前的整理结果；BFF 内存命中时仍优先使用服务端副本，未命中时才使用该结果并尽力写回内存。这是演示用的客户端辅助 HITL，不是生产归档或防篡改工作流。

## 部署前检查

- [ ] 使用 Node.js 20 或更新版本，在仓库根目录执行 `npm ci` 与 `npm run build`。
- [ ] GitHub 仓库已连接到 Vercel，Framework Preset 选择 Next.js，Root Directory 保持仓库根目录。
- [ ] 生产域名已启用 HTTPS；相机、PWA 安装和 service worker 在非 localhost 环境均需要安全上下文。
- [ ] 不上传 `.env.local`、`.vercel/` 或任何令牌；`.env.example` 仅是变量名/非机密示例。
- [ ] 确认 `.gitignore` 忽略所有层级的 `node_modules/`。

## 设置环境变量

在 Vercel 项目 **Settings → Environment Variables** 中配置。没有 `WAO_BASE_URL` 时，应用会自动使用 DevStub；没有 `STRUCTCAPTURE_LLM_*` 时，Capture BFF 仍会用本地规则和轻量线索整理字段，演示和离线拍录仍可完成。

| 名称 | Production | Preview | Development | 是否公开 |
| --- | --- | --- | --- | --- |
| `WAO_BASE_URL` | `http://198.12.81.152:8088` 或 HTTPS 反代地址 | 使用测试 WAO，或留空 | 本地 `.env.local` 可选 | 否，不能加 `NEXT_PUBLIC_` |
| `STRUCTCAPTURE_WAO_AGENT_ID` | `e483332c-6b41-41cb-b1b5-1370b8438208`（可选） | 测试 Agent UUID，或留空 | 本地 `.env.local` 可选 | 否 |
| `STRUCTCAPTURE_WAO_OIDC_TOKEN_URL` | IdP 的 HTTPS OAuth token endpoint | 对应测试 IdP，或留空 | 本地 `.env.local` 可选 | 否 |
| `STRUCTCAPTURE_WAO_OIDC_CLIENT_ID` | workload OAuth client ID | 测试 client ID，或留空 | 本地 `.env.local` 可选 | 否 |
| `STRUCTCAPTURE_WAO_OIDC_CLIENT_SECRET` | workload OAuth client secret | 测试 secret，或留空 | 本地 `.env.local` 可选 | 否，不能加 `NEXT_PUBLIC_` |
| `STRUCTCAPTURE_WAO_OIDC_ISSUER` | 与 WAO 完全相同的 OIDC issuer | 测试 issuer，或留空 | 本地 `.env.local` 可选 | 否 |
| `STRUCTCAPTURE_WAO_OIDC_AUDIENCE` | 与 WAO 完全相同的 OIDC audience | 测试 audience，或留空 | 本地 `.env.local` 可选 | 否 |
| `STRUCTCAPTURE_WAO_OIDC_SCOPE` | IdP 可选的 client-credentials scope | 测试 scope，或留空 | 本地 `.env.local` 可选 | 否 |
| `STRUCTCAPTURE_WAO_AUTH_MODE` | 可选，设为 `hs256` 选择 HS256 workload JWT | `hs256`，或留空自动检测 secret | 本地 `.env.local` 可选 | 否 |
| `STRUCTCAPTURE_WAO_HS256_SECRET` | WAO HS256 verifier 共用的 JWT secret | 仅在服务端密钥库设置 | 本地 `.env.local` 可选 | 否，不能加 `NEXT_PUBLIC_` |
| `STRUCTCAPTURE_WAO_HS256_SUB` | 可选 workload subject | `structcapture-bff` | 本地 `.env.local` 可选 | 否 |
| `STRUCTCAPTURE_WAO_HS256_TTL_SECONDS` | 可选 token TTL，限制 300–900 秒 | `600` | 本地 `.env.local` 可选 | 否 |
| `STRUCTCAPTURE_WAO_HS256_ISSUER` / `STRUCTCAPTURE_WAO_HS256_AUDIENCE` | WAO verifier 要求时的可选 claims | 留空或与 verifier 一致 | 本地 `.env.local` 可选 | 否 |
| `STRUCTCAPTURE_WAO_INCLUDE_IMAGES` | `true` 仅在 WAO vision model 可访问图片 URL 时 | 通常 `false` | 本地 `.env.local` 可选 | 否 |
| `STRUCTCAPTURE_LLM_BASE_URL` | OpenAI 兼容模型网关地址 | 测试网关，或留空 | 本地 `.env.local` 可选 | 否 |
| `STRUCTCAPTURE_LLM_API_KEY` | 模型网关密钥 | 测试密钥，或留空 | 本地 `.env.local` 可选 | 否，不能加 `NEXT_PUBLIC_` |
| `STRUCTCAPTURE_LLM_MODEL` | 模型名（可选） | 测试模型名（可选） | 本地 `.env.local` 可选 | 否 |
| `STRUCTCAPTURE_LLM_TIMEOUT_MS` | 超时毫秒（可选） | 测试值（可选） | 本地 `.env.local` 可选 | 否 |
| `STRUCTCAPTURE_LLM_INCLUDE_IMAGES` | 仅在网关支持远程图片 URL 时设为 `true` | 通常保持 `false` | 本地 `.env.local` 可选 | 否 |

`STRUCTCAPTURE_LLM_TIMEOUT_MS` 未设置时服务端默认 `25000` 毫秒，限制在 `20000`–`30000` 毫秒；浏览器的整理请求等待窗口更长。该范围兼顾 MiniMax 等远程模型网关的响应时间和 Vercel 函数的可用性。`STRUCTCAPTURE_LLM_INCLUDE_IMAGES` 默认关闭，保持 MiniMax 兼容的文本请求；仅在网关明确支持 `image_url` 内容块且图片地址可访问时开启。

`WAO_BASE_URL` 只由服务端读取；手机浏览器始终请求同源网关，不会看到 VPS 地址。`STRUCTCAPTURE_WAO_AGENT_ID` 留空时按 `structcapture-organizer` 查询 Agent 目录，并校验其 `structcapture/default` 隔离范围。完整配置 OIDC 或 HS256 认证后，Capture BFF 会以短期 workload JWT 为 Agent 目录和 `POST /api/v1/agents/{id}/chat` 发送 Bearer 认证。只要 WAO 被配置，目录、认证、scope、WAO 失败或超时都会直接返回错误，绝不会降级到 `STRUCTCAPTURE_LLM_*` 或本地整理路径。

### WAO Agent chat OIDC 上线清单

1. WAO 使用 `AGENTOS_ENV=production`、`AGENTOS_AUTH_MODE=oidc`，并配置 HTTPS `AGENTOS_OIDC_JWKS_URL`、`AGENTOS_OIDC_ISSUER`、`AGENTOS_OIDC_AUDIENCE`。
2. BFF 的 `STRUCTCAPTURE_WAO_OIDC_ISSUER`、`STRUCTCAPTURE_WAO_OIDC_AUDIENCE` 与 WAO 的 issuer/audience **逐字相同**。
3. IdP 的 client-credentials client 必须签发短期非对称 OIDC JWT，含 `sub`、`tenant_id=structcapture`、`project_id=default`、`exp`、匹配的 `iss` 和 `aud`。tenant/project 是 IdP 绑定的 claims，不是 BFF 可提交的参数。
4. 将 client secret 仅存入 Vercel 的服务端环境变量；不要提交 `.env.local`。默认 OAuth Basic client authentication 不兼容时，应在 IdP/WAO 边界提供兼容 token endpoint，而不是在 BFF 自签 token。

### WAO HS256（137 类测试环境）

若 WAO 以 `AGENTOS_AUTH_MODE=hs256` 运行，在 Capture BFF 的服务端环境变量中设置：

```dotenv
WAO_BASE_URL=https://wao-test.example.internal
STRUCTCAPTURE_WAO_AUTH_MODE=hs256
STRUCTCAPTURE_WAO_HS256_SECRET=<same-secret-configured-in-wao>
# 仅当 WAO verifier 强制检查时才设置：
# STRUCTCAPTURE_WAO_HS256_ISSUER=https://capture.example.internal
# STRUCTCAPTURE_WAO_HS256_AUDIENCE=wild-agentos
```

BFF 以 `sub=structcapture-bff`、`tenant_id=structcapture`、`project_id=default` 与 10 分钟（可调为 5–15 分钟）有效期签发 HS256 JWT。HS256 secret 与 WAO verifier 的 secret 必须一致，只能保存在双方的服务端密钥库中，绝不能使用 `NEXT_PUBLIC_` 前缀、输出日志或提交仓库。若同时存在完整的 `STRUCTCAPTURE_WAO_OIDC_*`，OIDC 优先于 HS256，保持生产演示的 OIDC/JWKS 流程不变。

原版 WAO 的 Agent 目录与 `POST /api/v1/agents/{id}/chat` 均使用 `Authorization: Bearer <JWT>`。JWT 必须由 WAO 信任的认证边界验证；请求体中的 tenant/project 字段和 `X-Identity` 都不能生成 verified isolation claims。

当前演示端点的健康检查：

```bash
curl --fail --show-error http://198.12.81.152:8088/health
```

应得到 HTTP `200`。在部署成功后，也可经应用验证网关转发：

```bash
curl --fail --show-error https://<你的域名>/api/wao/health
```

> Vercel → VPS 的 HTTP 流量不会暴露给浏览器，但生产环境仍应优先将 VPS 放在 HTTPS 反向代理之后，并限制入口来源。不要将访问令牌放进 `WAO_BASE_URL`。

## 部署步骤

1. 在 GitHub 推送分支，Vercel 会生成 Preview；合并到生产分支后生成 Production 部署。
2. 打开 Preview，在手机上完成一次拍照、填写说明、点击「完成并提交整理」。
3. 在结果页分别确认或退回一次；即使请求落到新的 Serverless 实例，HITL 仍应完成，确认后可导出 JSON 或 CSV。
4. WAO 健康检查失败或变量未设置时，确认仍能进入待人工确认的 DevStub 结果；这不是 WAO 已成功写入的证明。
5. 在 Production 域名重复一次拍照和安装检查。

## 可选：Caddy 以 `/wao` 反代 VPS

如需不直接暴露 `:8088`，在 VPS 上让 Caddy 提供 HTTPS。以下假设 WAO 提供 `/health`、`/sessions` 和 `/captures`：

```caddyfile
wao.example.com {
    handle_path /wao/* {
        reverse_proxy 127.0.0.1:8088
    }
}
```

将 Vercel 的 `WAO_BASE_URL` 改为 `https://wao.example.com/wao`。`handle_path` 会去掉 `/wao` 前缀，因此网关请求 `/api/wao/health` 最终到达 WAO 的 `/health`。为 Caddy 配置有效 DNS/TLS，且使用防火墙只开放 80/443；不要向公网开放 `8088`。

## 手机安装与现场检查

### Android Chrome

- [ ] 打开 Production HTTPS 域名，允许相机权限。
- [ ] Chrome 菜单 →「安装应用」或「添加到主屏幕」。
- [ ] 从主屏幕打开，确认显示独立窗口和应用图标。
- [ ] 断网后新增一条「照片 + 说明」，恢复网络后回到应用确认本地记录仍在。

### iPhone / iPad Safari

- [ ] 用 Safari 打开 Production HTTPS 域名并允许相机权限。
- [ ] 点分享 →「加入主屏幕」→「添加」。
- [ ] 从主屏幕打开并完成一条拍录。
- [ ] iOS 可能回收浏览器存储，且对后台同步支持有限；现场结束前应打开应用确认记录，并按流程导出已人工确认的数据。
