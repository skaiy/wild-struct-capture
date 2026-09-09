# Vercel Hobby 部署与手机安装清单

本项目是一个 Next.js PWA，可部署在 Vercel Hobby。拍录数据首先存于手机浏览器；当前的会话 API 使用内存存储，因此**不能**当作生产数据仓库。

## 部署前检查

- [ ] 使用 Node.js 20 或更新版本，在仓库根目录执行 `npm ci` 与 `npm run build`。
- [ ] GitHub 仓库已连接到 Vercel，Framework Preset 选择 Next.js，Root Directory 保持仓库根目录。
- [ ] 生产域名已启用 HTTPS；相机、PWA 安装和 service worker 在非 localhost 环境均需要安全上下文。
- [ ] 不上传 `.env.local`、`.vercel/` 或任何令牌；`.env.example` 仅是变量名/非机密示例。
- [ ] 确认 `.gitignore` 忽略所有层级的 `node_modules/`。

## 设置环境变量

在 Vercel 项目 **Settings → Environment Variables** 中配置。仅在需要连接 WAO 时设置下列变量；没有它时，应用会自动使用 DevStub，演示和离线拍录仍可完成。

| 名称 | Production | Preview | Development | 是否公开 |
| --- | --- | --- | --- | --- |
| `WAO_BASE_URL` | `http://198.12.81.152:8088` 或 HTTPS 反代地址 | 使用测试 WAO，或留空 | 本地 `.env.local` 可选 | 否，不能加 `NEXT_PUBLIC_` |

`WAO_BASE_URL` 只由 `/api/wao` 服务端网关读取；手机浏览器始终请求同源网关，不会看到 VPS 地址。当前演示端点的健康检查：

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
3. WAO 健康检查失败或变量未设置时，确认仍能进入待人工确认的 DevStub 结果；这不是 WAO 已成功写入的证明。
4. 在 Production 域名重复一次拍照和安装检查。

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
