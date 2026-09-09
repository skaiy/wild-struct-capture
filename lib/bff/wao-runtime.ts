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
  const parsed = Number(process.env.WAO_REQUEST_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 15_000) : 5_000;
}

function waoBaseUrl() {
  const value = process.env.WAO_BASE_URL?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString().replace(/\/$/, "") : null;
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
    "你是 StructCapture 的结构化整理助手。仅根据给出的照片说明、方向和可见证据提出待审核建议；不得把推断写成事实。",
    `知识包：${pack.id}`,
    `规则：${pack.extractionRules.join("；")}`,
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
      const raw = typeof rawField === "object" && rawField ? rawField as Record<string, unknown> : { value: rawField };
      const value = typeof raw.value === "string" ? raw.value.trim() : "";
      if (value) fields[key] = { value, confidence: raw.confidence === "high" ? "high" : "medium" };
    }
  }
  const summary = typeof record.summary === "string" && record.summary.trim() ? record.summary.trim() : undefined;
  return summary || Object.keys(fields).length ? { summary, fields } : null;
}

/**
 * WAO is optional infrastructure. This only uses its generic Agent chat API;
 * capture business data and HITL state remain in this BFF.
 */
export async function enrichWithWao(pack: KnowledgePack, shots: Shot[]): Promise<WaoEnrichment | null> {
  const baseUrl = waoBaseUrl();
  if (!baseUrl) return null;

  try {
    const signal = AbortSignal.timeout(requestTimeout());
    const health = await fetch(`${baseUrl}/health`, { cache: "no-store", signal });
    if (!health.ok) return null;

    const agentId = process.env.WAO_STRUCTCAPTURE_AGENT_ID?.trim() || "structcapture-organizer";
    const response = await fetch(`${baseUrl}/api/v1/agents/${encodeURIComponent(agentId)}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: buildPrompt(pack, shots) }),
      cache: "no-store",
      signal: AbortSignal.timeout(requestTimeout()),
    });
    if (!response.ok) return null;
    return parseEnrichment(await response.json(), pack);
  } catch {
    return null;
  }
}
