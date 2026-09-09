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
    imageUrl,
  }));
  return [
    "仅根据给出的照片说明、方向和可见证据提出待人工审核的建议；不得把推断写成事实。",
    `知识包：${pack.id}`,
    `字段标签：${JSON.stringify(pack.labels)}`,
    `提取规则：${pack.extractionRules.join("；")}`,
    `允许字段：summary、${pack.schema.fields.map((field) => field.key).join("、")}`,
    "以 JSON 对象返回，不要 Markdown：",
    '{"summary":"string","fields":{"field_key":{"value":"string","confidence":"high|medium"}}}',
    `照片证据（imageUrl 仅作 POC 引用，不要求读取）：${JSON.stringify(evidence)}`,
  ].join("\n");
}

function textFromResponse(payload: unknown): string | null {
  if (typeof payload === "string") return payload;
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if ("summary" in record || "fields" in record) return JSON.stringify(record);
  for (const key of ["content", "message", "response", "output", "text"]) {
    const value = record[key];
    if (typeof value === "string") return value;
    if (value && typeof value === "object") {
      const nested = textFromResponse(value);
      if (nested) return nested;
    }
  }
  const choice = Array.isArray(record.choices) ? record.choices[0] : null;
  return textFromResponse(choice);
}

function parseEnrichment(payload: unknown, pack: KnowledgePack): WaoEnrichment | null {
  const text = textFromResponse(payload);
  if (!text) return null;
  const json = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? text;
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
      if (value) fields[key] = { value, confidence: raw.confidence === "high" ? "high" : "medium" };
    }
  }
  const summary = typeof record.summary === "string" && record.summary.trim() ? record.summary.trim() : undefined;
  return summary || Object.keys(fields).length ? { summary, fields } : null;
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

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.STRUCTCAPTURE_LLM_MODEL?.trim() || "deepseek-v4-flash",
        messages: [
          { role: "system", content: "你是通用的结构化信息提取助手。输出必须是有效 JSON。" },
          { role: "user", content: buildPrompt(pack, shots) },
        ],
        temperature: 0.1,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(requestTimeout()),
    });
    if (!response.ok) {
      console.warn("LLM enrichment request failed", { status: response.status });
      return null;
    }
    return parseEnrichment(await response.json(), pack);
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
