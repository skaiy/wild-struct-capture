# StructCapture 业务层详细设计：图文 + 语音说明联合结构化抽取

| 项 | 内容 |
|---|---|
| 文档版本 | 0.1.0（草案，供评审，**未实施**） |
| 范围 | `skaiy/wild-struct-capture` Capture BFF / PWA / 知识包 |
| 非范围 | WAO Core / Gateway / Agent runtime 实现（见姊妹文档《底座侧》） |
| 关联现网 | https://capture.kaiy.ai/（Basic Auth）；organize 优先 WAO Agent OIDC，降级 LLM/启发式 |
| 作者视角 | 栈野 · 业务层 |

---

## 1. 背景与问题

### 1.1 产品目标

用户期望的闭环是：

1. 拍照（包装、货架、现场、车辆方位等可见证据）
2. 可选：语音转写 / 手输说明（语境、看不见的信息、纠正）
3. 系统用**多模态能力**同时看图、读字（标签/效期/品牌），并与文字说明合并推理
4. 输出按模板的结构化字段（一物一卡）+ HITL 可改

### 1.2 现状差距（2026-09-09 现网）

| 能力 | 现状 |
|---|---|
| 照片 | 主要用于预览、结果页对照、HITL；默认**不进**模型 |
| 开关 | `STRUCTCAPTURE_WAO_INCLUDE_IMAGES` / `STRUCTCAPTURE_LLM_INCLUDE_IMAGES` 仅当 `=true` 才带图；现网未开 |
| 文本证据 | caption + Web Speech ASR 转写进入 `buildPrompt` |
| 主路径模型 | WAO gateway 临时 `MiniMax-Text-01`（文本）；号池曾规划 VL（如 Qwen3-VL）但未接到 organize |
| 结构化 | Agent/LLM JSON → `items[]` + 枚举归一 + HITL |

**结论**：理想链路产品正确，业务层已留开关钩子，但**未启用图模态**，且当前 gateway 模型不具备 VL。

---

## 2. 目标与非目标

### 2.1 目标

- **G1** 在业务层可控地开启「图 + 文」联合抽取，字段召回优于纯文本（品牌/规格/效期/位置线索等）。
- **G2** 语音/手输与图像证据冲突时，可解释地标注置信度并留给 HITL。
- **G3** 演示可用：限张、限分辨率、超时与降级路径清晰。
- **G4** 不修改 WAO 源码；仅消费底座契约。底座缺口单独提给开源线。

### 2.2 非目标

- 不做通用 OCR 产品；OCR 作为 VL/模型内能力或可选前置，不自建重引擎。
- 不做音频直喂多模态（ASR 仍落成文字再融合）。
- 不在本期做跨会话长期记忆训练。

---

## 3. 术语

| 术语 | 含义 |
|---|---|
| Shot | 一次拍照记录：`imageUrl` + `caption` + `direction` 等 |
| 说明文字 | caption ∪ ASR 追加文本 |
| VL | Vision-Language 多模态对话/补全模型 |
| 主路径 | Capture → WAO Agent chat（OIDC Bearer） |
| 旁路 | Capture → OpenAI 兼容 `chat/completions`（`STRUCTCAPTURE_LLM_*`） |
| HITL | 整理结果确认页人工改字段后 approve/reject |

---

## 4. 目标架构（业务层）

```
[PWA]
  拍照 → imageUrl(可压缩)
  语音 ASR → 追加 caption
  提交 organize(session, shots[])
        │
        ▼
[Capture BFF]
  1. 证据规范化：压缩图、限张、剥离过大 data URL
  2. 组装多模态请求：
       - 文本：pack 规则 + enum/synonyms + 每 shot 的 caption/direction
       - 图像：每 shot 的图（若开关开）
  3. 主路径：OIDC token → WAO Agent chat(+images?)
  4. 失败/超时 → 旁路 VL/文本 LLM
  5. 再失败 → 启发式
  6. parse → items 一物一卡 → enum 软归一 → HITL
        │
        ▼
[HITL 确认页] 图挂卡片；字段全可改
```

职责边界：

- **业务层**：何时带图、带几张、如何压缩、prompt 话术、降级、HITL、知识包枚举。
- **底座**：Agent chat 是否稳定接受 `images`、gateway 是否路由到 VL、超时与错误语义（见底座文档）。

---

## 5. 证据融合策略

### 5.1 证据优先级（写入 prompt，供模型与评测共用）

1. **图上可读印刷信息**（品牌、规格、效期、条码旁文字）— 高置信候选  
2. **用户说明/ASR** — 补全图上看不见的（柜内位置、数量意图、归属）  
3. **拍摄指引 direction** — 碰撞模板的车辆方向等强约束  
4. **冲突**：图与文字矛盾 → 字段 `confidence=low` 或值保留文字但摘要中注明「图文不一致」，HITL 必显  

### 5.2 输出契约（保持现有 items 模型）

```json
{
  "summary": "string",
  "items": [
    {
      "fields": {
        "item_name": { "value": "string", "confidence": "high|medium|low" },
        "location": { "value": "string", "confidence": "medium" }
      },
      "galleryShotIds": ["shot-uuid-or-1-based-compat"]
    }
  ]
}
```

多模态**不改变**对外 JSON 形状；只改变证据来源。继续兼容扁平 item（PR#28/#32）。

### 5.3 Prompt 增补（业务层）

在现有 `buildPrompt` 上增加一节（示意）：

- 本请求含 N 张图像，顺序与 shots 一致。  
- 请先观察图像中的标签/包装/场景，再结合 caption。  
- 枚举字段优先规范标签；无法对齐则保留证据原文，禁止用「待确认」覆盖已有图文证据。  
- 每件物品独立 `items[]`，并关联对应 shot。

---

## 6. 配置与开关设计

| 环境变量 | 含义 | 建议默认（演示） |
|---|---|---|
| `STRUCTCAPTURE_WAO_INCLUDE_IMAGES` | 主路径是否带图 | 演示开：`true`（需底座+VL 就绪） |
| `STRUCTCAPTURE_LLM_INCLUDE_IMAGES` | 旁路是否带图 | 与上同步或仅旁路先开做 A/B |
| `STRUCTCAPTURE_VISION_MAX_SHOTS` | 单次 organize 最多送几张图 | `4` |
| `STRUCTCAPTURE_VISION_MAX_EDGE_PX` | 长边压缩上限 | `1280` |
| `STRUCTCAPTURE_VISION_MAX_BYTES` | 单图编码后上限 | `700000`（约） |
| `STRUCTCAPTURE_LLM_MODEL` | 旁路模型 | VL 型号（如号池 Qwen3-VL） |
| 现有 `STRUCTCAPTURE_LLM_*` / OIDC | 不变 | — |

**推荐分期**：

- **M0（旁路先行）**：仅开 `STRUCTCAPTURE_LLM_INCLUDE_IMAGES`，旁路打到 VL；主路径仍文本。验证字段增益与超时。  
- **M1（主路径）**：底座确认 Agent+gateway VL 后，开 `STRUCTCAPTURE_WAO_INCLUDE_IMAGES`。  
- **M2**：按模板差异化（home-inventory 强依赖包装字；crash-prep 强依赖车辆方向枚举+外观）。

---

## 7. 图像处理（BFF）

### 7.1 输入形态

- 现网多为前端 `imageUrl`（可能 data URL 或后续对象存储 URL）。  
- data URL：BFF 侧解码 → 压缩 → 再编码或改传 URL。  
- 远程 URL：需保证 WAO/LLM 出口可达；内网 URL 不可给公网模型。

### 7.2 压缩流水线（建议）

1. 解码失败 → 该 shot 仅文本，日志 warn。  
2. 等比缩放至长边 ≤ `MAX_EDGE_PX`。  
3. JPEG quality 起步 0.72，循环直至 ≤ `MAX_BYTES`。  
4. 超过 `MAX_SHOTS`：按时间顺序保留前 N 张，其余仅文本并在 summary 提示。  

### 7.3 隐私

- 演示 Basic Auth 已有；图可能含人脸/住址 — 文档声明「客户试用勿拍敏感信息」。  
- 日志禁止落完整 data URL；只记 shotId、字节数、是否含图。

---

## 8. 调用路径设计

### 8.1 主路径（WAO Agent）

伪请求：

```http
POST {WAO_BASE}/api/v1/agents/{id}/chat
Authorization: Bearer <OIDC>
Content-Type: application/json

{
  "message": "<buildPrompt 文本>",
  "images": ["data:image/jpeg;base64,...", "..."]   // 仅开关开时
}
```

业务层依赖底座：

- 接受并转发 `images` 到 VL gateway  
- 超时、413、不支持多模态时返回可区分错误码，便于降级旁路  

若返回「不支持 images」→ **不改底座代码**，业务层降级旁路并记 metric；开单给如野。

### 8.2 旁路（OpenAI 兼容）

```json
{
  "model": "<VL>",
  "messages": [
    { "role": "system", "content": "结构化抽取助手..." },
    { "role": "user", "content": [
      { "type": "text", "text": "<prompt>" },
      { "type": "image_url", "image_url": { "url": "<data-or-https>" } }
    ]}
  ],
  "temperature": 0.1
}
```

超时：现有 `STRUCTCAPTURE_LLM_TIMEOUT_MS` 建议 VL ≥ 45s–60s。

### 8.3 降级矩阵

| 失败 | 动作 |
|---|---|
| VL 超时/5xx | 去图重试文本一次 → 启发式 |
| 413 / payload too large | 减张/再压缩 → 仍失败则文本 |
| OIDC/Agent 401 | 保持现逻辑；不关涉多模态 |
| 解析失败 | 保持现 parse 兼容；HITL 展示待确认 |

---

## 9. 模板差异

### 9.1 home-inventory

- 图：包装正面/标签特写收益最大。  
- 字段：brand、specification、expiry_date、category 强依赖识字。  
- location：图场景 + 说明；枚举软归一（已有「厨房台面→厨房」）。

### 9.2 crash-prep

- 图：车身方位与安全布置；`vehicle_direction` 以枚举为准，可用图辅助校验 direction。  
- 说明文字仍重要（试验地点、设备编号）。

---

## 10. HITL 与前端

- 卡片继续挂关联照片（已有）。  
- 多模态开启后，低置信字段在 UI 可用已有置信文案提示「建议对照照片」。  
- 不强制新页面；本期无额外「识图中」步骤，organize 请求内完成（可加 loading 文案「正在结合照片分析…」——属小改动，实施阶段再开）。

---

## 11. 验收标准（业务层）

| ID | 标准 |
|---|---|
| A1 | 仅包装特写、caption 为空或极简时，brand/规格类字段召回明显高于纯文本基线（人工集 20 例） |
| A2 | caption 与图冲突时，不出现「静默采用错误枚举覆盖」；HITL 可见原文或 low 置信 |
| A3 | 单次 ≤4 张压缩图，P95 organize 完成时间可接受（演示目标 &lt; 45s） |
| A4 | 关开关后行为与今日一致（回归） |
| A5 | 日志无完整图片 base64 |

---

## 12. 实施任务拆分（仍属业务仓，未开工）

1. 图像压缩工具模块 + 环境变量  
2. `buildPrompt` 多模态段落 + 旁路 message parts  
3. 主路径 `images` 组装（开关控制）  
4. 超时/413 降级  
5. 演示环境：旁路 VL 号池配置  
6. 小流量评测集与记录表  
7. （可选）前端 loading 文案  

**明确不做**：改 `wild_agentos` 仓库。

---

## 13. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 费用与配额 | 限张、压缩；先旁路可控模型 |
| 超时 | 独立 timeout；先文本保底 |
| 隐私 | Auth + 告知；日志脱敏 |
| 底座不支持 images | 旁路 VL；开源线跟进 |
| 手机 data URL 过大 | 前端也可预压缩（后续） |

---

## 14. 开放问题（需产品拍板）

1. 演示是否允许先走 **旁路 VL**，主路径仍文本？  
2. 单次 organize 默认几张图（建议 4）？  
3. 图存对象存储还是继续 data URL（影响底座可达性）？  
4. 客户试用是否必须关闭落盘图？

---

## 15. 修订记录

| 日期 | 版本 | 说明 |
|---|---|---|
| 2026-09-09 | 0.1.0 | 初稿：基于现网钩子与讨论，供评审，不实施 |
