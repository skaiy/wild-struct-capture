import crashPrepPack from "@/docs/runtime-assets/crash-prep.knowledge-pack.json";
import homeInventoryPack from "@/docs/runtime-assets/home-inventory.knowledge-pack.json";
import type { CaptureSession, OrganizedCapture, OrganizedItem, SchemaId, Shot, StructuredField } from "@/lib/types";
import { captureStore } from "@/lib/bff/capture-store";
import {
  EnrichmentError,
  enrichWithModelGateway,
  enrichWithWaoAgent,
  isModelVisionEnabled,
  isModelGatewayConfigured,
  isWaoVisionEnabled,
  isWaoConfigured,
  type WaoEnrichment,
} from "@/lib/bff/wao-runtime";

export type KnowledgePack = {
  id: string;
  labels: Record<string, string>;
  extractionRules: string[];
  schema: { fields: Array<{ key: string; enum?: string[]; options?: string[]; synonyms?: Record<string, string[]> }> };
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
  const quantities: Array<{ item: string; quantity: string; location?: string }> = [];
  const seenItems = new Set<string>();
  const numberMap: Record<string, string> = { 一: "1", 二: "2", 两: "2", 三: "3", 四: "4", 五: "5", 六: "6", 七: "7", 八: "8", 九: "9", 十: "10" };
  const addItem = (item: string, quantity: string, segment: string) => {
    const cleanItem = item
      .replace(/^.*?(?:有|放着|包括|存有|买来|购买|是)\s*/, "")
      .replace(/^(?:共|各)\s*/, "")
      .trim();
    const location = segment.match(/(?:放在|放于|存放在|存放于|位于)\s*([^，；;。…]{1,30})/)?.[1]?.trim();
    if (cleanItem && !seenItems.has(cleanItem)) {
      seenItems.add(cleanItem);
      quantities.push({ item: cleanItem, quantity, location });
    }
  };

  for (const segment of text.split(/(?:还有|；|;|。|[+＋])/)) {
    const multiplier = segment.match(/(.+?)\s*(?:×|x|X|\*)\s*(\d+)\b/);
    if (multiplier) addItem(multiplier[1], multiplier[2], segment);
    const chineseCount = segment.match(/([一二三四五六七八九十两\d]+)(?:个|瓶|盒|支|包|片|罐)?([\u4e00-\u9fffA-Za-z0-9-]{2,30}?)(?=(?:…|放在|放于|存放在|存放于|位于|，|$))/);
    if (chineseCount) {
      addItem(chineseCount[2], numberMap[chineseCount[1]] ?? chineseCount[1], segment);
    }
  }
  const location = text.match(/(?:放在|放于|存放在|存放于|位于|在)\s*([^，；;。]{1,30}(?:柜|箱|架|抽屉|桌|台|间|室|区|层|内|里|上|下|旁|边))/)?.[1]?.trim()
    ?? text.match(/([\u4e00-\u9fffA-Za-z0-9]{2,20}(?:柜|箱|架|抽屉|桌|台|间|室|区|层)(?:内|里|上|下|旁|边)?)/)?.[1];
  const condition = text.match(/(全新|未开封|已开封|完好|破损|过期|临期|潮湿|污损)/)?.[1];
  return {
    item_name: quantities.map(({ item }) => item).join("；"),
    quantity: quantities.map(({ item, quantity }) => `${item} × ${quantity}`).join("；"),
    location: quantities.some(({ location: itemLocation }) => itemLocation)
      ? quantities.map(({ item, location: itemLocation }) => `${item}：${itemLocation ?? UNCONFIRMED}`).join("；")
      : location,
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

function normalizeEnum(schemaId: SchemaId, key: string, value: string, confidence: StructuredField["confidence"]): StructuredField {
  const definition = knowledgePacks[schemaId].schema.fields.find((field) => field.key === key);
  const options = definition?.enum ?? definition?.options;
  if (!options?.length) return { key, label: knowledgePacks[schemaId].labels[key] ?? key, value, confidence };
  const candidate = value.trim().toLocaleLowerCase("zh-CN");
  const normalizedOptions = options.map((option) => ({
    option,
    aliases: [option, ...(definition?.synonyms?.[option] ?? [])],
  }));
  const matched = normalizedOptions.find(({ aliases }) =>
    aliases.some((alias) => alias.toLocaleLowerCase("zh-CN") === candidate),
  )?.option ?? normalizedOptions
    .flatMap(({ option, aliases }) => aliases.map((alias) => ({ option, alias })))
    .sort((left, right) => right.alias.length - left.alias.length)
    .find(({ alias }) => {
      const normalizedAlias = alias.toLocaleLowerCase("zh-CN");
      // A label embedded in a more specific place/category description is a
      // safe canonicalization (for example, 厨房台面 -> 厨房). Do not use fuzzy
      // matching: evidence that cannot be mapped remains visible to the reviewer.
      return normalizedAlias.length >= 2 && candidate.includes(normalizedAlias);
    })?.option;
  const normalizedValue = matched ?? value.trim();
  return {
    key,
    label: knowledgePacks[schemaId].labels[key] ?? key,
    value: normalizedValue,
    confidence: matched ? confidence : normalizedValue === UNCONFIRMED ? "low" : "low",
    // Preserve unrecognized evidence as a selectable value so the HITL control
    // remains usable while retaining the canonical choices.
    options: matched || normalizedValue === UNCONFIRMED ? options : [normalizedValue, ...options],
  };
}

function completeItemFields(
  schemaId: SchemaId,
  values: Record<string, { value: string; confidence: "high" | "medium" | "low" } | undefined>,
) {
  return knowledgePacks[schemaId].schema.fields.map(({ key }) => {
    const source = values[key];
    return normalizeEnum(schemaId, key, source?.value?.trim() || UNCONFIRMED, source?.confidence ?? "low");
  });
}

function buildItems(schemaId: SchemaId, shots: Shot[], enrichment: WaoEnrichment | null): OrganizedItem[] {
  if (enrichment?.items?.length) {
    return enrichment.items.map((item) => ({
      id: crypto.randomUUID(),
      fields: completeItemFields(schemaId, item.fields),
      galleryShotIds: (item.galleryShotIds ?? []).map((index) => shots[Number(index) - 1]?.id).filter((id): id is string => Boolean(id)),
    }));
  }

  // Compatibility path for PR #28's flat WAO response. Convert aligned legacy
  // values into independent cards rather than preserving semicolon-packed fields.
  const merged = mergeEnrichment(schemaId, buildFields(schemaId, shots), enrichment);
  const domainFields = merged.filter((field) => knowledgePacks[schemaId].schema.fields.some(({ key }) => key === field.key));
  const count = Math.max(1, ...domainFields.map((field) => field.value.split("；").length));
  return Array.from({ length: count }, (_, index) => ({
    id: crypto.randomUUID(),
    fields: completeItemFields(schemaId, Object.fromEntries(domainFields.map((field) => [
      field.key,
      { value: field.value.split("；")[index]?.trim() || UNCONFIRMED, confidence: field.confidence },
    ]))),
    galleryShotIds: count === 1 ? shots.map((shot) => shot.id) : shots[index] ? [shots[index].id] : [],
  }));
}

function normalizeHitlItems(schemaId: SchemaId, items: OrganizedItem[], gallery: Shot[]) {
  const galleryIds = new Set(gallery.map((shot) => shot.id));
  return items.map((item) => ({
    id: item.id,
    fields: completeItemFields(schemaId, Object.fromEntries(item.fields.map((field) => [
      field.key,
      { value: field.value, confidence: field.confidence },
    ]))),
    galleryShotIds: item.galleryShotIds.filter((id) => galleryIds.has(id)),
  }));
}

/**
 * A configured WAO Agent is the ideal pipeline and fails closed. The optional
 * model gateway is used only when WAO is not configured; local heuristics are
 * reserved for a fully offline development setup.
 */
export async function extract(session: CaptureSession, shots: Shot[]): Promise<OrganizedCapture> {
  // Request data is authoritative because a serverless instance may not retain
  // the in-memory session created by an earlier request.
  saveSession(session, shots);
  const pack = knowledgePacks[session.schemaId];
  const waoConfigured = isWaoConfigured();
  const modelConfigured = isModelGatewayConfigured();
  const hasImageInput = shots.some((shot) => Boolean(shot.imageUrl));
  if (hasImageInput && isWaoVisionEnabled() && !waoConfigured) {
    throw new EnrichmentError("vision_unavailable", "WAO 图片识别服务未配置，请关闭图片识别后重试。");
  }
  if (hasImageInput && !waoConfigured && isModelVisionEnabled() && !modelConfigured) {
    throw new EnrichmentError("vision_unavailable", "图片识别服务未配置，请关闭图片识别后重试。");
  }
  let enrichment: WaoEnrichment | null;
  if (waoConfigured) {
    enrichment = await enrichWithWaoAgent(pack, shots);
    if (!enrichment) {
      throw new EnrichmentError("wao_invalid_response", "WAO Agent 未返回有效整理结果，请稍后重试。");
    }
  } else if (modelConfigured) {
    enrichment = await enrichWithModelGateway(pack, shots);
    if (!enrichment) {
      throw new EnrichmentError("llm_invalid_response", "模型服务未返回有效整理结果，请稍后重试。");
    }
  } else {
    enrichment = session.schemaId === "home-inventory" ? homeInventoryHeuristics(shots) : null;
  }
  return captureStore.saveCapture({
    id: crypto.randomUUID(),
    sessionId: session.id,
    schemaId: session.schemaId,
    status: "pending_hitl",
    metaFields: [
      { key: "schema", label: "记录模板", value: pack.labels.template, confidence: "high" },
      { key: "shot_count", label: pack.labels.shotCount, value: `${shots.length} 张`, confidence: "high" },
      {
        key: "summary",
        label: pack.labels.summary,
        value: enrichment?.summary ?? valueFromShots(shots),
        confidence: enrichment?.summary ? "medium" : shots.length ? "medium" : "low",
      },
    ],
    items: buildItems(session.schemaId, shots, enrichment),
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
    ...(fallbackCapture?.id === captureId
      ? {
        metaFields: fallbackCapture.metaFields,
        items: normalizeHitlItems(capture.schemaId, fallbackCapture.items, capture.gallery),
      }
      : {}),
    status,
    ...(status === "rejected" ? { rejectionReason: reason } : {}),
  });
}
