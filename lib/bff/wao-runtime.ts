import type { Shot } from "@/lib/types";
import { prepareVisionImages, type PreparedVisionImages } from "@/lib/bff/vision";

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

export type EnrichmentFailureCode =
  | "vision_timeout"
  | "vision_payload_too_large"
  | "vision_unavailable"
  | "wao_timeout"
  | "wao_unavailable"
  | "wao_invalid_response"
  | "llm_timeout"
  | "llm_unavailable"
  | "llm_invalid_response";

export class EnrichmentError extends Error {
  constructor(
    public readonly code: EnrichmentFailureCode,
    message: string,
  ) {
    super(message);
    this.name = "EnrichmentError";
  }
}

export class VisionEnrichmentError extends EnrichmentError {
  constructor(code: Extract<EnrichmentFailureCode, `vision_${string}`>, message: string) {
    super(code, message);
    this.name = "VisionEnrichmentError";
  }
}

function visionFailureFromResponse(response: Response): VisionEnrichmentError {
  if (response.status === 413) {
    return new VisionEnrichmentError("vision_payload_too_large", "图片请求过大，请减少照片或降低图片大小后重试。");
  }
  return new VisionEnrichmentError("vision_unavailable", "图片识别服务暂不可用，请稍后重试或关闭图片识别后重试。");
}

function visionFailureFromError(error: unknown): VisionEnrichmentError {
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return new VisionEnrichmentError("vision_timeout", "图片识别超时，请稍后重试或关闭图片识别后重试。");
  }
  return new VisionEnrichmentError("vision_unavailable", "图片识别服务暂不可用，请稍后重试或关闭图片识别后重试。");
}

function hasImageInput(shots: Shot[]) {
  return shots.some((shot) => Boolean(shot.imageUrl));
}

export function isWaoVisionEnabled() {
  return process.env.STRUCTCAPTURE_WAO_INCLUDE_IMAGES === "true";
}

export function isModelVisionEnabled() {
  return process.env.STRUCTCAPTURE_LLM_INCLUDE_IMAGES === "true";
}

function requestTimeout(includeImages = false) {
  const parsed = Number(process.env.STRUCTCAPTURE_LLM_TIMEOUT_MS);
  // Vision models need a larger budget than text-only extraction. An explicit
  // env value still wins so deployments can tune their gateway SLA.
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(Math.max(parsed, 20_000), 120_000)
    : includeImages ? 60_000 : 25_000;
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

export function isWaoConfigured() {
  return Boolean(waoBaseUrl() && oidcConfig());
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
  const imagesEnabled = isWaoVisionEnabled();
  const visionRequested = imagesEnabled && hasImageInput(shots);
  if (!baseUrl || !configuredAgent || !pack.id || !shots.length) {
    if (visionRequested) throw new VisionEnrichmentError("vision_unavailable", "图片识别服务未配置，请关闭图片识别后重试。");
    return null;
  }

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
    if (!token) {
      if (visionRequested) throw new VisionEnrichmentError("vision_unavailable", "图片识别服务暂不可用，请稍后重试或关闭图片识别后重试。");
      return null;
    }
    const images = imagesEnabled ? await prepareVisionImages(shots.map((shot) => shot.imageUrl)) : null;
    if (imagesEnabled && hasImageInput(shots) && !images?.urls.length) {
      throw new VisionEnrichmentError("vision_unavailable", "图片无法处理，未发起图片识别；请更换图片或关闭图片识别后重试。");
    }
    const chatResponse = await sendWaoChat(baseUrl, agent.id, token, pack, shots, images);
    if (chatResponse instanceof VisionEnrichmentError) throw chatResponse;
    if (!chatResponse?.ok) {
      if (images?.urls.length) {
        throw chatResponse
          ? visionFailureFromResponse(chatResponse)
          : new VisionEnrichmentError("vision_unavailable", "图片识别服务暂不可用，请稍后重试或关闭图片识别后重试。");
      }
      console.warn("WAO Agent chat request failed", {
        status: chatResponse?.status,
        includeImages: Boolean(images?.urls.length),
      });
      return null;
    }
    const enrichment = parseEnrichment(await chatResponse.json(), pack, shots);
    if (images?.urls.length && !enrichment) {
      throw new VisionEnrichmentError("vision_unavailable", "图片识别服务未返回有效结果，请稍后重试或关闭图片识别后重试。");
    }
    return enrichment;
  } catch (error) {
    if (error instanceof VisionEnrichmentError) throw error;
    if (visionRequested) throw visionFailureFromError(error);
    console.warn("WAO Agent path is unavailable");
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

export function isModelGatewayConfigured() {
  return Boolean(chatCompletionsUrl() && process.env.STRUCTCAPTURE_LLM_API_KEY?.trim());
}

function buildPrompt(pack: KnowledgePack, shots: Shot[], imageShotNumbers: number[] = []) {
  const evidence = shots.map(({ caption, direction, imageUrl }, index) => ({
    shot: index + 1,
    caption,
    direction,
    hasImage: Boolean(imageUrl),
  }));
  const fieldGuidance = pack.schema.fields.map(({ key, enum: enumValues, options, synonyms }) => ({
    key,
    ...(enumValues?.length || options?.length ? { options: enumValues ?? options } : {}),
    ...(synonyms && Object.keys(synonyms).length ? { synonyms } : {}),
  }));
  return [
    "从证据提取知识包字段，输出可供人工确认的 JSON；不得推断。",
    `知识包=${pack.id}；字段标签=${JSON.stringify(pack.labels)}；规则=${pack.extractionRules.join("；")}`,
    `字段选项与同义词=${JSON.stringify(fieldGuidance)}。有明确匹配时使用选项中的规范标签；没有匹配时保留证据原文并将 confidence 设为 medium，不得用“待确认”覆盖已有证据。`,
    ...(imageShotNumbers.length
      ? [`本请求含 ${imageShotNumbers.length} 张图像，对应 shot 编号：${imageShotNumbers.join("、")}。请先观察图中标签、包装和场景的可见证据，再结合文字说明；图文冲突时保留已有证据并降低 confidence，不得用“待确认”擦除证据。`]
      : []),
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
    ? record.items.flatMap((rawItem) => parseEnrichmentItem(rawItem, allowedKeys, shots))
    : undefined;
  const summary = typeof record.summary === "string" && record.summary.trim() ? record.summary.trim() : undefined;
  return summary || Object.keys(fields).length || items?.length ? { summary, fields, items } : null;
}

function parseEnrichmentItem(
  rawItem: unknown,
  allowedKeys: Set<string>,
  shots: Shot[],
): NonNullable<WaoEnrichment["items"]> {
  if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) return [];
  const item = rawItem as Record<string, unknown>;
  // Support both the documented items[].fields shape and agents that put
  // schema keys directly on each item object.
  const rawFields = item.fields && typeof item.fields === "object" && !Array.isArray(item.fields)
    ? item.fields as Record<string, unknown>
    : item;
  const itemFields: WaoEnrichment["fields"] = {};
  for (const [key, rawField] of Object.entries(rawFields)) {
    if (!allowedKeys.has(key)) continue;
    const field = parseEnrichmentField(rawField, shots);
    if (field) itemFields[key] = field;
  }
  if (!Object.keys(itemFields).length) return [];
  const galleryShotIds = Array.isArray(item.galleryShotIds)
    ? item.galleryShotIds.map(String).filter((id) => /^\d+$/.test(id) && Number(id) <= shots.length)
    : undefined;
  return [{ fields: itemFields, galleryShotIds }];
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
 * The model gateway is used only in explicit deployments without a configured
 * WAO Agent. Capture business data and HITL state remain in this BFF.
 */
export async function enrichWithModelGateway(pack: KnowledgePack, shots: Shot[]): Promise<WaoEnrichment | null> {
  const endpoint = chatCompletionsUrl();
  const apiKey = process.env.STRUCTCAPTURE_LLM_API_KEY?.trim();
  const imagesEnabled = isModelVisionEnabled();
  const visionRequested = imagesEnabled && hasImageInput(shots);
  if (!endpoint || !apiKey) {
    if (visionRequested) throw new VisionEnrichmentError("vision_unavailable", "图片识别服务未配置，请关闭图片识别后重试。");
    return null;
  }

  const images = imagesEnabled ? await prepareVisionImages(shots.map((shot) => shot.imageUrl)) : null;

  try {
    if (imagesEnabled && hasImageInput(shots) && !images?.urls.length) {
      throw new VisionEnrichmentError("vision_unavailable", "图片无法处理，未发起图片识别；请更换图片或关闭图片识别后重试。");
    }
    const response = await sendModelGatewayRequest(endpoint, apiKey, pack, shots, images);
    if (response instanceof VisionEnrichmentError) throw response;
    if (!response?.ok) {
      if (images?.urls.length) {
        throw response
          ? visionFailureFromResponse(response)
          : new VisionEnrichmentError("vision_unavailable", "图片识别服务暂不可用，请稍后重试或关闭图片识别后重试。");
      }
      console.warn("LLM enrichment request failed", {
        status: response?.status,
        includeImages: Boolean(images?.urls.length),
      });
      return null;
    }
    const enrichment = parseEnrichment(await response.json(), pack, shots);
    if (images?.urls.length && !enrichment) {
      throw new VisionEnrichmentError("vision_unavailable", "图片识别服务未返回有效结果，请稍后重试或关闭图片识别后重试。");
    }
    return enrichment;
  } catch (error) {
    if (error instanceof VisionEnrichmentError) throw error;
    console.warn("LLM enrichment request failed", { includeImages: Boolean(images?.urls.length) });
    return null;
  }
}

async function sendWaoChat(
  baseUrl: string,
  agentId: string,
  token: string,
  pack: KnowledgePack,
  shots: Shot[],
  images: PreparedVisionImages | null,
) {
  try {
    return await fetch(`${baseUrl}/api/v1/agents/${encodeURIComponent(agentId)}/chat`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        message: buildPrompt(pack, shots, images?.shotNumbers),
        ...(images?.urls.length ? { images: images.urls } : {}),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(requestTimeout(Boolean(images?.urls.length))),
    });
  } catch (error) {
    return images?.urls.length ? visionFailureFromError(error) : null;
  }
}

async function sendModelGatewayRequest(
  endpoint: string,
  apiKey: string,
  pack: KnowledgePack,
  shots: Shot[],
  images: PreparedVisionImages | null,
) {
  const prompt = buildPrompt(pack, shots, images?.shotNumbers);
  const imageParts = images?.urls.map((url) => ({ type: "image_url", image_url: { url } })) ?? [];
  try {
    return await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.STRUCTCAPTURE_LLM_MODEL?.trim() || "deepseek-v4-flash",
        messages: [
          { role: "system", content: "你是通用的结构化信息提取助手。输出必须是有效 JSON，且严格遵守用户给出的知识包 schema。" },
          { role: "user", content: imageParts.length ? [{ type: "text", text: prompt }, ...imageParts] : prompt },
        ],
        temperature: 0.1,
        max_tokens: 1_200,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(requestTimeout(imageParts.length > 0)),
    });
  } catch (error) {
    return imageParts.length ? visionFailureFromError(error) : null;
  }
}
