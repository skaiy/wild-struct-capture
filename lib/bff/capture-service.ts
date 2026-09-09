import crashPrepPack from "@/docs/runtime-assets/crash-prep.knowledge-pack.json";
import homeInventoryPack from "@/docs/runtime-assets/home-inventory.knowledge-pack.json";
import type { CaptureSession, OrganizedCapture, SchemaId, Shot, StructuredField } from "@/lib/types";
import { captureStore } from "@/lib/bff/capture-store";

type KnowledgePack = {
  id: string;
  labels: Record<string, string>;
  extractionRules: string[];
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
  return [
    { key: "schema", label: "记录模板", value: pack.labels.template, confidence: "high" },
    { key: "shot_count", label: pack.labels.shotCount, value: `${shots.length} 张`, confidence: "high" },
    {
      key: "summary",
      label: pack.labels.summary,
      value: valueFromShots(shots),
      confidence: shots.some((shot) => shot.caption.trim()) ? "medium" : "high",
    },
  ];
}

/**
 * The local path deliberately derives structured output from versioned runtime
 * asset data. A future generic WAO task/chat enrichment may be inserted here,
 * but this BFF never depends on WAO capture-specific APIs.
 */
export function extract(session: CaptureSession, shots: Shot[]): OrganizedCapture {
  return captureStore.saveCapture({
    id: crypto.randomUUID(),
    sessionId: session.id,
    schemaId: session.schemaId,
    status: "pending_hitl",
    fields: buildFields(session.schemaId, shots),
    gallery: shots,
    createdAt: new Date().toISOString(),
  });
}

export function organize(session: CaptureSession, shots: Shot[]) {
  return extract(session, shots);
}

export function updateHitl(captureId: string, status: "approved" | "rejected", reason?: string) {
  const capture = captureStore.getCapture(captureId);
  if (!capture) return undefined;
  return captureStore.saveCapture({
    ...capture,
    status,
    ...(status === "rejected" ? { rejectionReason: reason } : {}),
  });
}
