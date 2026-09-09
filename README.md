# Wild StructCapture

中文 | [English](#english)

面向 Wild 产品线的 PWA：通过多轮自然语言引导拍照，将照片整理为可人工复核的结构化记录，并导出 JSON。内置两个可切换模板：

- **碰撞试验准备**：车辆、传感器、假人和场地安全。
- **家庭资产盘点**：物品、品牌型号、数量和保存位置。

## 功能

- 移动端相机/相册连续拍录，附带每轮文字说明
- 两步流程：拍录 → HITL（人工在环）复核 → JSON 导出
- 可安装 PWA：manifest、Service Worker、应用图标
- 所有整理请求经 `WaoClient`，不会由 organize 路由直接调用视觉模型
- `WAO_BASE_URL` 未设置或 WAO 不可达时，自动切换为同契约的 `WaoDevStub`（Mock VL）
- 不存储服务端照片；浏览器仅在当前会话中持有照片预览

## 架构

```text
Browser PWA (capture + display)
          │ POST /api/organize (photo metadata)
          ▼
      WaoClient
       ├─ WaoHttpClient → WAO_BASE_URL/v1/structcapture/organize
       └─ WaoDevStub    → Mock VL fallback
          ▼
  HITL review + local JSON export
```

`app/api/organize/route.ts` is deliberately limited to choosing `WaoClient`.
It has no direct visual-language provider integration.

## 本地运行

要求：Node.js 20.9+。

```bash
npm install
cp .env.example .env.local
npm run dev
```

访问 `http://localhost:3000`。不设置 `WAO_BASE_URL` 即可完整体验 stub 流程。

### WAO 服务

将 `.env.local` 配置为：

```bash
WAO_BASE_URL=http://198.12.81.152:8088
```

期望端点为 `POST /v1/structcapture/organize`，请求/响应类型定义在
`lib/schemas.ts`。WAO 返回非 2xx、超时或未配置地址时，会安全降级到 `WaoDevStub`；
页面会显示“本地 Mock VL（WAO 不可用）”。

## 部署到 Vercel

1. 将仓库导入 Vercel。
2. 可选：在 Project Settings → Environment Variables 设置 `WAO_BASE_URL`。
3. 使用默认构建命令 `npm run build` 部署。

不需要 Neon、AWS 或任何密钥。当前版本使用浏览器本地状态；后续如需要持久化，
可在不改变 `WaoClient` 接口的前提下增加 StorageProvider。

## 验证

```bash
npm run build
npm run lint
```

---

## English

Wild StructCapture is a PWA for multi-turn, natural-language-guided photo
capture. It organizes capture metadata into a reviewable structured record and
exports JSON. Switch between crash-test preparation and home-inventory schemas.

### Quick start

```bash
npm install
cp .env.example .env.local
npm run dev
```

Set `WAO_BASE_URL` to a Wild AgentOS endpoint (the demo address is shown in
`.env.example`) to use WAO. The app posts only to its Next.js organize route,
which delegates exclusively through `WaoClient`. If WAO is absent, errors, or
times out, the contract-compatible `WaoDevStub` supplies deterministic Mock VL
results for demos and local development.

For Vercel, import the repository, optionally set `WAO_BASE_URL`, and deploy
with `npm run build`. No secrets are committed and no paid infrastructure is
required.
