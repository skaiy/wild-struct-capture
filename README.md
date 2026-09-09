# Wild StructCapture

中文优先的结构化拍录 PWA：选择模板、用「照片 + 自然语言说明」记录现场，并由本应用的 Capture BFF 整理和人工确认。

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
- `/api/wao` 下的 Capture BFF 拥有会话、照片、整理结果和 HITL 状态；内存存储只适用于 POC，生产环境须替换为数据库。
- 「完成并提交整理」只通过同源 `WaoClient` 调用 BFF。客户端**不会直接调用 VL/WildPool/WAO**；整理结果必须由人工确认后才能导出 JSON 或 CSV。

## 架构 / Architecture

```text
PWA shell → WaoClient → /api/wao Capture BFF → WAO generic runtime (optional) → model pool
       └→ DevStub fallback (BFF unavailable)
       └→ LocalStorageProvider (device-side capture resilience)
```

`WAO_BASE_URL` 是仅服务端可见的原版 WAO 运行时端点。浏览器只调用同源 `/api/wao` BFF；BFF 保有拍录业务 I/O，WAO 只可选地提供通用运行时能力。未配置或不可用时，`WaoClient` 自动回退到 `DevStub`，所以无需云数据库即可试用拍录流程。完整边界和运行时资产规则见[业务层与运行时架构](docs/architecture-business-runtime.md)；完整的 Vercel 变量设置和可选 Caddy `/wao` 反代见 [部署指南](docs/vercel-hobby-deploy.md)。

部署采用免费的 **Vercel Hobby** 托管该 Next.js PWA；WAO 服务可部署在 VPS 的 `:8088`。跨域部署时，VPS 必须只允许预期的 Vercel 来源并启用 HTTPS；不要把密钥或生产地址提交进仓库。仓库只提供 `.env.example`。

## PWA 安装

- Android Chrome：菜单 →「安装应用」或「添加到主屏幕」。
- iOS Safari：分享 →「加入主屏幕」。iOS 对后台同步、推送和存储回收的支持与 Chromium 不同；离线记录应在恢复网络后确认同步状态。
- 本项目提供 standalone manifest、应用图标和基础缓存 service worker。生产安装与相机访问需要 HTTPS（localhost 除外）。

## 交付与演示资料

- [Vercel Hobby 部署、环境变量与手机安装清单](docs/vercel-hobby-deploy.md)
- [客户演示脚本（中文，碰撞实验与家庭盘点）](docs/customer-demo-zh.md)

## License

应用许可证待定。Wild AgentOS 核心使用 AGPL；部署、链接或分发前请核对其许可证义务。
