import type { Shot } from "@/lib/types";

type KnowledgePack = {
  id: string;
  labels: Record<string, string>;
  extractionRules: string[];
  schema: { fields: Array<{ key: string; enum?: string[]; options?: string[]; synonyms?: Record<string, string[]> }> };
};

export type WaoEnrichmentField = { value: string; confidence: "high" | "medium" };

export type WaoEnrichment = {
  summary?: string;
  fields: Record<string, WaoEnrichmentField>;
  items?: Array<{ fields: Record<string, WaoEnrichmentField>; galleryShotIds?: string[] }>;
};

function requestTimeout() {
  const parsed = Number(process.env.STRUCTCAPTURE_LLM_TIMEOUT_MS);
  // Long Chinese multi-item transcripts need more than the old 8–10 second
  // window. Keep this bounded for the BFF while allowing the env to tune the
  // budget within a range proven practical for the shared model gateways.
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(Math.max(parsed, 20_000), 30_000)
    : 25_000;
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

function isAgentId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

type WaoAgent = {
  id?: string;
  name?: string;
  business_domain?: string;
  tenant_id?: string;
  project_id?: string;
};

type WorkloadClaims = {
  sub?: unknown;
  tenant_id?: unknown;
  project_id?: unknown;
  exp?: unknown;
  iss?: unknown;
  aud?: unknown;
};

let cachedWorkloadToken: { token: string; expiresAt: number } | null = null;

function oidcConfig() {
  const tokenUrl = process.env.STRUCTCAPTURE_WAO_OIDC_TOKEN_URL?.trim();
  const clientId = process.env.STRUCTCAPTURE_WAO_OIDC_CLIENT_ID?.trim();
  const clientSecret = process.env.STRUCTCAPTURE_WAO_OIDC_CLIENT_SECRET?.trim();
  const issuer = process.env.STRUCTCAPTURE_WAO_OIDC_ISSUER?.trim();
  const audience = process.env.STRUCTCAPTURE_WAO_OIDC_AUDIENCE?.trim();
  if (!tokenUrl || !clientId || !clientSecret || !issuer || !audience) return null;
  try {
    const url = new URL(tokenUrl);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost")) return null;
    return { tokenUrl: url.toString(), clientId, clientSecret, issuer, audience };
  } catch {
    return null;
  }
}

function decodeJwtClaims(token: string): WorkloadClaims | null {
  const encodedClaims = token.split(".")[1];
  if (!encodedClaims) return null;
  try {
    const padded = encodedClaims.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(encodedClaims.length / 4) * 4, "=");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as WorkloadClaims;
  } catch {
    return null;
  }
}

function verifiedWorkloadToken(
  token: string,
  expected: Pick<Required<WaoAgent>, "tenant_id" | "project_id">,
  config: NonNullable<ReturnType<typeof oidcConfig>>,
) {
  // This is an early configuration/scope guard only. WAO remains the authority
  // that verifies the OIDC signature against its configured JWKS.
  const claims = decodeJwtClaims(token);
  const now = Math.floor(Date.now() / 1_000);
  const audience = Array.isArray(claims?.aud) ? claims.aud : [claims?.aud];
  if (
    !claims ||
    typeof claims.sub !== "string" || !claims.sub ||
    claims.tenant_id !== expected.tenant_id ||
    claims.project_id !== expected.project_id ||
    typeof claims.exp !== "number" || claims.exp <= now + 15 ||
    claims.iss !== config.issuer ||
    !audience.includes(config.audience)
  ) return null;
  return { token, expiresAt: claims.exp * 1_000 };
}

async function obtainWorkloadToken(
  agent: Pick<Required<WaoAgent>, "tenant_id" | "project_id">,
  signal: AbortSignal,
) {
  const config = oidcConfig();
  if (!config) return null;
  if (cachedWorkloadToken && cachedWorkloadToken.expiresAt > Date.now() + 60_000) {
    return cachedWorkloadToken.token;
  }
  const body = new URLSearchParams({ grant_type: "client_credentials", audience: config.audience });
  const scope = process.env.STRUCTCAPTURE_WAO_OIDC_SCOPE?.trim();
  if (scope) body.set("scope", scope);
  try {
    const response = await fetch(config.tokenUrl, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
      cache: "no-store",
      signal,
    });
    if (!response.ok) throw new Error(`status ${response.status}`);
    const payload = await response.json() as { access_token?: unknown };
    if (typeof payload.access_token !== "string") throw new Error("missing access token");
    const workloadToken = verifiedWorkloadToken(payload.access_token, agent, config);
    if (!workloadToken) throw new Error("unexpected workload token claims");
    cachedWorkloadToken = workloadToken;
    return workloadToken.token;
  } catch (error) {
    const reason = error instanceof DOMException && error.name === "TimeoutError" ? "timeout" : "unavailable";
    console.warn("WAO workload OIDC token is unavailable or has incompatible claims", { reason });
    return null;
  }
}

/**
 * Resolve the claims-scoped generic WAO Agent, then send a pack-aware
 * single-turn request. The BFF still owns all Capture business state and HITL.
 */
export async function enrichWithWaoAgent(
  pack: KnowledgePack,
  shots: Shot[],
): Promise<WaoEnrichment | null> {
  const baseUrl = waoBaseUrl();
  const configuredAgent = process.env.STRUCTCAPTURE_WAO_AGENT_ID?.trim() || "structcapture-organizer";
  if (!baseUrl || !configuredAgent || !pack.id || !shots.length) return null;

  const signal = AbortSignal.timeout(requestTimeout());
  try {
    const response = await fetch(`${baseUrl}/api/v1/agents`, {
      cache: "no-store",
      signal,
    });
    if (!response.ok) throw new Error(`status ${response.status}`);
    const payload = await response.json() as { agents?: WaoAgent[] };
    const agent = payload.agents?.find(({ id, name }) =>
      isAgentId(configuredAgent) ? id === configuredAgent : name === configuredAgent,
    );
    if (!agent?.id || agent.business_domain !== "structcapture" ||
      agent.tenant_id !== "structcapture" || agent.project_id !== "default") {
      console.warn("WAO StructCapture Agent is missing or has an unexpected scope", { configuredAgent });
      return null;
    }
    const token = await obtainWorkloadToken(
      { tenant_id: agent.tenant_id, project_id: agent.project_id },
      signal,
    );
    if (!token) return null;
    const includeImages = process.env.STRUCTCAPTURE_WAO_INCLUDE_IMAGES === "true";
    const chatResponse = await fetch(`${baseUrl}/api/v1/agents/${encodeURIComponent(agent.id)}/chat`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        message: buildPrompt(pack, shots),
        ...(includeImages ? { images: shots.flatMap((shot) => shot.imageUrl ? [shot.imageUrl] : []) } : {}),
      }),
      cache: "no-store",
      signal,
    });
    if (!chatResponse.ok) {
      console.warn("WAO Agent chat request failed", { status: chatResponse.status });
      return null;
    }
    return parseEnrichment(await chatResponse.json(), pack, shots);
  } catch {
    console.warn("WAO Agent path is unavailable; using model gateway fallback");
    return null;
  }
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
    "从证据提取知识包字段，输出可供人工确认的 JSON；不得推断。",
    `知识包=${pack.id}；字段标签=${JSON.stringify(pack.labels)}；规则=${pack.extractionRules.join("；")}`,
    `仅允许 summary、items 和 ${pack.schema.fields.map((field) => field.key).join("、")}。每个 tangible item 必须是一条独立 items 记录，未知写“待确认”。`,
    "绝不可把多件物品合并为使用“；”分隔的字段值。每个 item 的 fields 只描述该物品；galleryShotIds 填关联的拍摄记录编号（从 1 开始）。",
    "只返回 JSON，不要 Markdown：",
    '{"summary":"string","items":[{"fields":{"field_key":{"value":"string","confidence":"high|medium"}},"galleryShotIds":["1"]}]}',
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
  for (const key of ["answer", "content", "message", "response", "output", "text", "reasoning_content"]) {
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
      const field = parseEnrichmentField(rawField, shots);
      if (field) fields[key] = field;
    }
  }
  // WAO Agents can return the schema fields directly at the top level rather
  // than under `fields`. Preserve nested fields when both forms are present.
  for (const [key, rawField] of Object.entries(record)) {
    if (!allowedKeys.has(key) || fields[key]) continue;
    const field = parseEnrichmentField(rawField, shots);
    if (field) fields[key] = field;
  }
  const items = Array.isArray(record.items)
    ? record.items.flatMap((rawItem) => {
      if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) return [];
      const rawFields = (rawItem as Record<string, unknown>).fields;
      if (!rawFields || typeof rawFields !== "object" || Array.isArray(rawFields)) return [];
      const itemFields: WaoEnrichment["fields"] = {};
      for (const [key, rawField] of Object.entries(rawFields)) {
        if (!allowedKeys.has(key)) continue;
        const field = parseEnrichmentField(rawField, shots);
        if (field) itemFields[key] = field;
      }
      if (!Object.keys(itemFields).length) return [];
      const rawShotIds = (rawItem as Record<string, unknown>).galleryShotIds;
      const galleryShotIds = Array.isArray(rawShotIds)
        ? rawShotIds.map(String).filter((id) => /^\d+$/.test(id) && Number(id) <= shots.length)
        : undefined;
      return [{ fields: itemFields, galleryShotIds }];
    })
    : undefined;
  const summary = typeof record.summary === "string" && record.summary.trim() ? record.summary.trim() : undefined;
  return summary || Object.keys(fields).length || items?.length ? { summary, fields, items } : null;
}

function parseEnrichmentField(rawField: unknown, shots: Shot[]): WaoEnrichment["fields"][string] | null {
  const raw =
    rawField && typeof rawField === "object" && !Array.isArray(rawField)
      ? rawField as Record<string, unknown>
      : { value: rawField };
  const rawValue = raw.value;
  if (typeof rawValue !== "string" && typeof rawValue !== "number" && typeof rawValue !== "boolean") {
    return null;
  }
  const value = String(rawValue).trim();
  if (!value || isTranscriptDump(value, shots)) {
    return null;
  }
  return { value, confidence: raw.confidence === "high" ? "high" : "medium" };
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
 * The model gateway is optional fallback. Capture business data and HITL state
 * remain in this BFF.
 */
export async function enrichWithModelGateway(pack: KnowledgePack, shots: Shot[]): Promise<WaoEnrichment | null> {
  const endpoint = chatCompletionsUrl();
  const apiKey = process.env.STRUCTCAPTURE_LLM_API_KEY?.trim();
  if (!endpoint || !apiKey) return null;

  const includeImages = process.env.STRUCTCAPTURE_LLM_INCLUDE_IMAGES === "true";
  const imageParts = includeImages
    ? shots.flatMap((shot) => shot.imageUrl
      ? [{ type: "image_url", image_url: { url: shot.imageUrl } }]
      : [])
    : [];
  const prompt = buildPrompt(pack, shots);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.STRUCTCAPTURE_LLM_MODEL?.trim() || "deepseek-v4-flash",
        messages: [
          { role: "system", content: "你是通用的结构化信息提取助手。输出必须是有效 JSON，且严格遵守用户给出的知识包 schema。" },
          { role: "user", content: includeImages ? [{ type: "text", text: prompt }, ...imageParts] : prompt },
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
