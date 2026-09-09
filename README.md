# Wild StructCapture

中文优先的结构化拍录 PWA：选择模板、用「照片 + 自然语言说明」记录现场，并将会话交给 Wild AgentOS（WAO）后续整理。

## 快速开始 / Quick start

```bash
npm install
cp .env.example .env.local # 可选；不配置则使用 DevStub
npm run dev
```

打开 `http://localhost:3000`。手机浏览器中可直接使用「拍照」按钮；支持相机的浏览器会请求后置摄像头。

## 当前范围

- 两个模板：**碰撞实验准备**、**家庭物品盘点**。
- 会话、照片说明和拍摄指引先保存在浏览器本地存储，离线仍可继续记录。
- `POST /api/sessions`、`POST /api/sessions/:id/shots`、`GET /api/sessions/:id/shots` 供本地开发使用；内存存储不应视为生产数据库。
- 「完成并提交整理」只通过 `WaoClient` 对接 WAO。客户端**不会直接调用 VL**；整理结果必须由人工确认后才能导出 JSON 或 CSV。

## 架构 / Architecture

```text
PWA shell → WaoClient → /api/wao gateway → HTTP WAO (optional) → Wild AgentOS / HITL
       └→ DevStub fallback (WAO absent/unavailable)
       └→ LocalStorageProvider (device-side capture resilience)
```

`WAO_BASE_URL` 配置仅服务端可见的 WAO HTTP 端点。演示目标为 `http://198.12.81.152:8088`；浏览器只调用同源 `/api/wao` 网关，端点不可用或未配置时，`WaoClient` 自动回退到 `DevStub`，所以无需云数据库即可试用拍录流程。

部署采用免费的 **Vercel Hobby** 托管该 Next.js PWA；WAO 服务可部署在 VPS 的 `:8088`。跨域部署时，VPS 必须只允许预期的 Vercel 来源并启用 HTTPS；不要把密钥或生产地址提交进仓库。仓库只提供 `.env.example`。

## PWA 安装

- Android Chrome：菜单 →「安装应用」或「添加到主屏幕」。
- iOS Safari：分享 →「加入主屏幕」。iOS 对后台同步、推送和存储回收的支持与 Chromium 不同；离线记录应在恢复网络后确认同步状态。
- 本项目提供 standalone manifest、应用图标和基础缓存 service worker。生产安装与相机访问需要 HTTPS（localhost 除外）。

## License

应用许可证待定。Wild AgentOS 核心使用 AGPL；部署、链接或分发前请核对其许可证义务。
