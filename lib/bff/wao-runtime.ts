import type { Shot } from "@/lib/types";

type KnowledgePack = {
  id: string;
  labels: Record<string, string>;
  extractionRules: string[];
  schema: { fields: Array<{ key: string }> };
};

export type WaoEnrichment = {
  summary?: string;
  fields: Record<string, { value: string; confidence: "high" | "medium" }>;
};

function requestTimeout() {
  const parsed = Number(process.env.STRUCTCAPTURE_LLM_TIMEOUT_MS);
  // Enrichment is optional: preserve a responsive pending-HITL response even when
  // a remote model is slow or unavailable.
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 10_000) : 8_000;
}

function chatCompletionsUrl() {
  const value = process.env.STRUCTCAPTURE_LLM_BASE_URL?.trim();
  if (!value || !process.env.STRUCTCAPTURE_LLM_API_KEY?.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.pathname = `${url.pathname.replace(/\/$/, "").replace(/\/v1$/, "")}/v1/chat/completions`;
    return url.toString();
  } catch {
    return null;
  }
}

function buildPrompt(pack: KnowledgePack, shots: Shot[]) {
  const evidence = shots.map(({ caption, direction, imageUrl }, index) => ({
    shot: index + 1,
    caption,
    direction,
    hasImage: Boolean(imageUrl),
  }));
  return [
    "你是知识包驱动的结构化信息提取器。仅根据给出的照片、说明、方向和可见证据提出待人工审核的建议；不得把推断写成事实。",
    `知识包：${pack.id}`,
    `字段标签：${JSON.stringify(pack.labels)}`,
    `提取规则：${pack.extractionRules.join("；")}`,
    `允许字段：summary、${pack.schema.fields.map((field) => field.key).join("、")}`,
    "必须为每个允许字段返回一个 fields 条目。证据不足时 value 写“待确认”、confidence 写“medium”，不要省略字段。",
    "每个字段只填写该字段的值：绝不可把原始整句说明、完整照片转录或 summary 复制到多个字段。",
    "若存在多个可辨识物品/物品组，保持相同顺序并用“；”分隔。例如物品名称“凡士林；Panadol”，数量“凡士林 × 3；Panadol × 4”。不要把多个物品合并成一个名称。",
    "quantity 仅填写明确数量；location 和 condition 仅填写有证据的值。未知字段写“待确认”。",
    "只返回 JSON 对象，不要 Markdown、代码围栏或说明文字：",
    '{"summary":"string","fields":{"field_key":{"value":"string","confidence":"high|medium"}}}',
    `文字证据：${JSON.stringify(evidence)}`,
  ].join("\n");
}

function textFromResponse(payload: unknown): string | null {
  if (typeof payload === "string") return payload;
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if ("summary" in record || "fields" in record) return JSON.stringify(record);
  // Some reasoning-model gateways leave content blank and place their final JSON
  // in reasoning_content. Prefer normal content, using reasoning only as a fallback.
  for (const key of ["content", "message", "response", "output", "text", "reasoning_content"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
    if (value && typeof value === "object") {
      const nested = textFromResponse(value);
      if (nested) return nested;
    }
  }
  const choice = Array.isArray(record.choices) ? record.choices[0] : null;
  return textFromResponse(choice);
}

function parseEnrichment(payload: unknown, pack: KnowledgePack, shots: Shot[]): WaoEnrichment | null {
  const text = textFromResponse(payload);
  if (!text) return null;
  const json = text.match(/```(?:json|python|javascript|js|typescript|ts)?\s*([\s\S]*?)```/i)?.[1]?.trim() ?? text.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  const fields: WaoEnrichment["fields"] = {};
  const allowedKeys = new Set(pack.schema.fields.map((field) => field.key));
  const inputFields = record.fields;
  if (inputFields && typeof inputFields === "object" && !Array.isArray(inputFields)) {
    for (const [key, rawField] of Object.entries(inputFields)) {
      if (!allowedKeys.has(key)) continue;
      const raw: Record<string, unknown> =
        typeof rawField === "object" && rawField ? rawField as Record<string, unknown> : { value: rawField };
      const value = typeof raw.value === "string" ? raw.value.trim() : "";
      if (value && !isTranscriptDump(value, shots)) {
        fields[key] = { value, confidence: raw.confidence === "high" ? "high" : "medium" };
      }
    }
  }
  const summary = typeof record.summary === "string" && record.summary.trim() ? record.summary.trim() : undefined;
  return summary || Object.keys(fields).length ? { summary, fields } : null;
}

function isTranscriptDump(value: string, shots: Shot[]) {
  const normalizedValue = value.replace(/\s+/g, "");
  const sourceTexts = shots
    .flatMap((shot) => [shot.caption, shot.direction])
    .filter(Boolean)
    .map((text) => text.replace(/\s+/g, ""));
  // Reject a model response that copies one entire long observation into a
  // structured field. The original observation remains available in summary.
  return normalizedValue.length > 40 && sourceTexts.includes(normalizedValue);
}

/**
 * The model gateway is optional. This BFF does not call WAO's domain-specific
 * Agent chat; it only sends a prompt to a separately configured OpenAI-compatible
 * endpoint. Capture business data and HITL state remain in this BFF.
 */
export async function enrichWithModelGateway(pack: KnowledgePack, shots: Shot[]): Promise<WaoEnrichment | null> {
  const endpoint = chatCompletionsUrl();
  const apiKey = process.env.STRUCTCAPTURE_LLM_API_KEY?.trim();
  if (!endpoint || !apiKey) return null;

  const imageParts = process.env.STRUCTCAPTURE_LLM_INCLUDE_IMAGES === "false"
    ? []
    : shots.flatMap((shot) => shot.imageUrl
      ? [{ type: "image_url", image_url: { url: shot.imageUrl } }]
      : []);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.STRUCTCAPTURE_LLM_MODEL?.trim() || "deepseek-v4-flash",
        messages: [
          { role: "system", content: "你是通用的结构化信息提取助手。输出必须是有效 JSON，且严格遵守用户给出的知识包 schema。" },
          { role: "user", content: [{ type: "text", text: buildPrompt(pack, shots) }, ...imageParts] },
        ],
        temperature: 0.1,
        max_tokens: 1_200,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(requestTimeout()),
    });
    if (!response.ok) {
      console.warn("LLM enrichment request failed", { status: response.status });
      return null;
    }
    return parseEnrichment(await response.json(), pack, shots);
  } catch (error) {
    const reason = error instanceof DOMException && error.name === "TimeoutError"
      ? "timeout"
      : error instanceof Error
        ? error.name
        : "unknown";
    console.warn("LLM enrichment request failed", { reason });
    return null;
  }
}
