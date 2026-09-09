import crashPrepPack from "@/docs/runtime-assets/crash-prep.knowledge-pack.json";
import homeInventoryPack from "@/docs/runtime-assets/home-inventory.knowledge-pack.json";
import type { CaptureSession, OrganizedCapture, SchemaId, Shot, StructuredField } from "@/lib/types";
import { captureStore } from "@/lib/bff/capture-store";
import { enrichWithModelGateway, type WaoEnrichment } from "@/lib/bff/wao-runtime";

export type KnowledgePack = {
  id: string;
  labels: Record<string, string>;
  extractionRules: string[];
  schema: { fields: Array<{ key: string }> };
};

const knowledgePacks: Record<SchemaId, KnowledgePack> = {
  "crash-prep": crashPrepPack,
  "home-inventory": homeInventoryPack,
};

export function isSchemaId(value: unknown): value is SchemaId {
  return value === "crash-prep" || value === "home-inventory";
}

export function createSession(schemaId: SchemaId) {
  return captureStore.createSession(schemaId);
}

export function getSession(sessionId: string) {
  return captureStore.getSession(sessionId);
}

export function saveSession(session: CaptureSession, shots: Shot[]) {
  return captureStore.saveSession({ ...session, shots });
}

export function addShot(sessionId: string, payload: Pick<Shot, "caption" | "direction" | "imageUrl">) {
  const shot: Shot = {
    id: crypto.randomUUID(),
    sessionId,
    caption: payload.caption ?? "",
    direction: payload.direction ?? "",
    imageUrl: payload.imageUrl,
    createdAt: new Date().toISOString(),
  };
  return captureStore.addShot(sessionId, shot);
}

export function listShots(sessionId: string) {
  return captureStore.listShots(sessionId);
}

function valueFromShots(shots: Shot[]) {
  return shots.map((shot) => shot.caption || shot.direction).filter(Boolean).join("；") || "等待补充照片说明";
}

const UNCONFIRMED = "待确认";

function shotText(shots: Shot[]) {
  return shots.flatMap((shot) => [shot.caption, shot.direction]).filter(Boolean).join("；");
}

function homeInventorySuggestions(shots: Shot[]) {
  const text = shotText(shots);
  const quantities: Array<{ item: string; quantity: string }> = [];
  const seenItems = new Set<string>();
  for (const segment of text.split(/[；;，,、+＋]/)) {
    const match = segment.match(/(.+?)\s*(?:×|x|X|\*)\s*(\d+)\b/);
    if (!match) continue;
    const item = match[1]
      .replace(/^.*?(?:有|放着|包括|存有|是)\s*/, "")
      .replace(/^(?:共|各)\s*/, "")
      .trim();
    if (item && !seenItems.has(item)) {
      seenItems.add(item);
      quantities.push({ item, quantity: match[2] });
    }
  }
  const location = text.match(/(?:放在|放于|存放在|存放于|位于|在)\s*([^，；;。]{1,30}(?:柜|箱|架|抽屉|桌|台|间|室|区|层|内|里|上|下|旁|边))/)?.[1]?.trim()
    ?? text.match(/([\u4e00-\u9fffA-Za-z0-9]{2,20}(?:柜|箱|架|抽屉|桌|台|间|室|区|层)(?:内|里|上|下|旁|边)?)/)?.[1];
  const condition = text.match(/(全新|未开封|已开封|完好|破损|过期|临期|潮湿|污损)/)?.[1];
  return {
    item_name: quantities.map(({ item }) => item).join("；"),
    quantity: quantities.map(({ item, quantity }) => `${item} × ${quantity}`).join("；"),
    location,
    condition,
  };
}

function buildFields(schemaId: SchemaId, shots: Shot[]): StructuredField[] {
  const pack = knowledgePacks[schemaId];
  const evidence = valueFromShots(shots);
  const hasEvidence = shots.some((shot) => shot.caption.trim() || shot.direction.trim());
  const suggestions = schemaId === "home-inventory" ? homeInventorySuggestions(shots) : {};
  const fields: StructuredField[] = [
    { key: "schema", label: "记录模板", value: pack.labels.template, confidence: "high" },
    { key: "shot_count", label: pack.labels.shotCount, value: `${shots.length} 张`, confidence: "high" },
    {
      key: "summary",
      label: pack.labels.summary,
      value: evidence,
      confidence: hasEvidence ? "medium" : "low",
    },
  ];
  for (const { key } of pack.schema.fields) {
    const suggested = suggestions[key as keyof typeof suggestions];
    fields.push({
      key,
      label: pack.labels[key] ?? key,
      value: suggested || UNCONFIRMED,
      confidence: suggested ? "medium" : "low",
    });
  }
  return fields;
}

function mergeEnrichment(schemaId: SchemaId, fields: StructuredField[], enrichment: WaoEnrichment | null) {
  if (!enrichment) return fields;
  const pack = knowledgePacks[schemaId];
  const output = fields.map((field) =>
    field.key === "summary" && enrichment.summary
      ? { ...field, value: enrichment.summary, confidence: "medium" as const }
      : field,
  );
  for (const key of pack.schema.fields.map((field) => field.key)) {
    const enriched = enrichment.fields[key];
    if (!enriched) continue;
    const field: StructuredField = {
      key,
      label: pack.labels[key] ?? key,
      value: enriched.value,
      confidence: enriched.confidence,
    };
    const existingIndex = output.findIndex((item) => item.key === key);
    if (existingIndex >= 0) output[existingIndex] = field;
    else output.push(field);
  }
  return output;
}

/**
 * The local path deliberately derives structured output from versioned runtime
 * asset data. Generic WAO enrichment is best-effort and never uses
 * capture-specific WAO APIs.
 */
export async function extract(session: CaptureSession, shots: Shot[]): Promise<OrganizedCapture> {
  // Request data is authoritative because a serverless instance may not retain
  // the in-memory session created by an earlier request.
  saveSession(session, shots);
  const enrichment = await enrichWithModelGateway(knowledgePacks[session.schemaId], shots);
  return captureStore.saveCapture({
    id: crypto.randomUUID(),
    sessionId: session.id,
    schemaId: session.schemaId,
    status: "pending_hitl",
    fields: mergeEnrichment(session.schemaId, buildFields(session.schemaId, shots), enrichment),
    gallery: shots,
    createdAt: new Date().toISOString(),
  });
}

export async function organize(session: CaptureSession, shots: Shot[]) {
  return extract(session, shots);
}

export function updateHitl(
  captureId: string,
  status: "approved" | "rejected",
  reason?: string,
  fallbackCapture?: OrganizedCapture,
) {
  const capture = captureStore.getCapture(captureId) ??
    (fallbackCapture?.id === captureId ? fallbackCapture : undefined);
  if (!capture) return undefined;
  return captureStore.saveCapture({
    ...capture,
    status,
    ...(status === "rejected" ? { rejectionReason: reason } : {}),
  });
}
