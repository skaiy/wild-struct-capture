import crashPrepPack from "@/docs/runtime-assets/crash-prep.knowledge-pack.json";
import homeInventoryPack from "@/docs/runtime-assets/home-inventory.knowledge-pack.json";
import type { CaptureSession, OrganizedCapture, SchemaId, Shot, StructuredField } from "@/lib/types";
import { captureStore } from "@/lib/bff/capture-store";
import { enrichWithModelGateway, enrichWithWaoAgent, type WaoEnrichment } from "@/lib/bff/wao-runtime";

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

function buildFields(schemaId: SchemaId, shots: Shot[]): StructuredField[] {
  const pack = knowledgePacks[schemaId];
  const evidence = valueFromShots(shots);
  const hasEvidence = shots.some((shot) => shot.caption.trim() || shot.direction.trim());
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
    fields.push({
      key,
      label: pack.labels[key] ?? key,
      value: "待确认",
      confidence: "low",
    });
  }
  return fields;
}

function joinKnown(values: Array<string | undefined>) {
  const known = values.filter((value): value is string => Boolean(value));
  return known.length ? known.join("；") : undefined;
}

function joinAligned(values: Array<string | undefined>) {
  const known = joinKnown(values);
  return known ? values.map((value) => value ?? "待确认").join("；") : undefined;
}

function homeInventoryHeuristics(shots: Shot[]): WaoEnrichment | null {
  const entries = shots
    .flatMap((shot) => (shot.caption || shot.direction).split(/[；;\n]+/))
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!entries.length) return null;

  const brands: Array<[RegExp, string]> = [
    [/凡士林|vaseline/i, "凡士林"],
    [/美林/i, "美林"],
  ];
  const locations: Array<[RegExp, string]> = [
    [/药箱|医药箱/, "药箱"],
    [/浴室柜|卫生间柜/, "浴室柜"],
    [/厨房柜|橱柜/, "厨房柜"],
    [/冰箱/, "冰箱"],
    [/抽屉/, "抽屉"],
  ];
  const categories: Array<[RegExp, string]> = [
    [/布洛芬|退烧|感冒|药/, "药品"],
    [/凡士林|润肤|乳液|护肤|护理/, "护理"],
  ];
  const values = {
    item_name: entries.map((entry) => {
      if (/凡士林|vaseline/i.test(entry)) return "凡士林护理品";
      if (/布洛芬|退烧|感冒药/.test(entry)) return "退烧药";
      return undefined;
    }),
    location: entries.map((entry) => joinKnown(locations.map(([pattern, value]) => pattern.test(entry) ? value : undefined))),
    quantity: entries.map((entry) => entry.match(/(\d+|一|两)\s*(?:瓶|盒|支|包|罐|袋|片装)/)?.[0]?.trim()),
    brand: entries.map((entry) => joinKnown(brands.map(([pattern, value]) => pattern.test(entry) ? value : undefined))),
    specification: entries.map((entry) => entry.match(/\b\d+(?:\.\d+)?\s*(?:ml|mL|ML|g|kg|毫升|克|片|粒)\b/)?.[0]),
    expiry_date: entries.map((entry) =>
      entry.match(/(?:有效期|保质期|到期(?:日)?)[：:\s]*((?:20\d{2}年\d{1,2}月(?:\d{1,2}日?)?)|(?:20\d{2}[./-]\d{1,2}[./-]\d{1,2})|(?:20\d{2}-\d{1,2}-\d{1,2}))/)?.[1],
    ),
    category: entries.map((entry) => joinKnown(categories.map(([pattern, value]) => pattern.test(entry) ? value : undefined))),
    owner_note: entries.map((entry) => entry.match(/(?:澳洲带回|国内购买|代购|网购|赠品)/)?.[0]),
    unit_price: entries.map((entry) => entry.match(/(?:单价|¥|￥)\s*(\d+(?:\.\d{1,2})?\s*元?)/)?.[1]),
  };
  const fields: WaoEnrichment["fields"] = {};
  for (const [key, matches] of Object.entries(values)) {
    const value = joinAligned(matches);
    if (value) fields[key] = { value, confidence: "medium" };
  }
  if (values.item_name.filter(Boolean).length > 1) {
    for (const key of ["condition", "owner_note", "unit_price"]) {
      if (!fields[key]) {
        fields[key] = { value: entries.map(() => "待确认").join("；"), confidence: "medium" };
      }
    }
  }
  const identified = fields.item_name?.value;
  return identified || Object.keys(fields).length
    ? { summary: identified ? `已识别：${identified}；其余字段待人工确认。` : "已提取部分盘点线索，待人工确认。", fields }
    : null;
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
  const pack = knowledgePacks[session.schemaId];
  const waoEnrichment = await enrichWithWaoAgent(pack, shots);
  const enrichment = waoEnrichment ?? await enrichWithModelGateway(pack, shots) ??
    (session.schemaId === "home-inventory" ? homeInventoryHeuristics(shots) : null);
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
