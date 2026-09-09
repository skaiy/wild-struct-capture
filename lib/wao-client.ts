import type { CaptureSession, OrganizedCapture, SchemaId, Shot } from "@/lib/types";

export interface WaoClient {
  createSession(schemaId: SchemaId): Promise<CaptureSession>;
  uploadShot(sessionId: string, payload: Omit<Shot, "id" | "sessionId" | "createdAt">): Promise<Shot>;
  listShots(sessionId: string): Promise<Shot[]>;
  extract(session: CaptureSession, shots: Shot[]): Promise<OrganizedCapture>;
  organize(session: CaptureSession, shots: Shot[]): Promise<OrganizedCapture>;
  approve(capture: OrganizedCapture): Promise<OrganizedCapture>;
  reject(capture: OrganizedCapture, reason: string): Promise<OrganizedCapture>;
}

const newId = () => crypto.randomUUID();
const REQUEST_TIMEOUT_MS = 15_000;
const ORGANIZE_REQUEST_TIMEOUT_MS = 35_000;

export class DevStubWaoClient implements WaoClient {
  private sessions = new Map<string, CaptureSession>();
  private captures = new Map<string, OrganizedCapture>();

  async createSession(schemaId: SchemaId) {
    const session: CaptureSession = { id: newId(), schemaId, createdAt: new Date().toISOString(), shots: [] };
    this.sessions.set(session.id, session);
    return session;
  }

  async uploadShot(sessionId: string, payload: Omit<Shot, "id" | "sessionId" | "createdAt">) {
    const shot: Shot = { ...payload, id: newId(), sessionId, createdAt: new Date().toISOString() };
    const session = this.sessions.get(sessionId);
    if (session) session.shots.push(shot);
    return shot;
  }

  async listShots(sessionId: string) {
    return this.sessions.get(sessionId)?.shots ?? [];
  }

  async extract(session: CaptureSession, shots: Shot[]) {
    const schemaLabel = session.schemaId === "crash-prep" ? "碰撞实验准备" : "家庭物品盘点";
    const metaFields = [
      { key: "schema", label: "记录模板", value: schemaLabel, confidence: "high" as const },
      { key: "shot_count", label: "已记录照片", value: `${shots.length} 张`, confidence: "high" as const },
      { key: "summary", label: "现场摘要", value: shots.map((shot) => shot.caption).filter(Boolean).join("；") || "等待补充照片说明", confidence: "medium" as const },
    ];
    return {
      id: newId(), sessionId: session.id, schemaId: session.schemaId, status: "pending_hitl" as const,
      metaFields,
      items: [{
        id: newId(),
        fields: session.schemaId === "crash-prep"
          ? [
            { key: "scene_location", label: "试验地点", value: "待确认", confidence: "low" as const },
            { key: "vehicle_direction", label: "车辆方向", value: "待确认", confidence: "low" as const, options: ["正前", "正后", "左侧", "右侧", "前左45°", "前右45°", "后左45°", "后右45°"] },
            { key: "safety_equipment", label: "安全设备", value: "待确认", confidence: "low" as const },
            { key: "vehicle_condition", label: "车辆状态", value: "待确认", confidence: "low" as const },
            { key: "evidence_notes", label: "证据说明", value: "待确认", confidence: "low" as const },
          ]
          : [
            { key: "item_name", label: "物品名称", value: "待确认", confidence: "low" as const },
            { key: "location", label: "存放位置", value: "待确认", confidence: "low" as const, options: ["客厅", "卧室", "厨房", "卫生间", "阳台", "储物间", "玄关", "车库", "药箱", "冰箱", "厨房柜", "浴室柜", "衣柜", "抽屉", "书架"] },
            { key: "condition", label: "物品状态", value: "待确认", confidence: "low" as const, options: ["全新", "未开封", "已开封", "完好", "临期", "过期", "破损", "潮湿", "污损"] },
            { key: "quantity", label: "数量", value: "待确认", confidence: "low" as const },
            { key: "brand", label: "品牌", value: "待确认", confidence: "low" as const },
            { key: "specification", label: "规格", value: "待确认", confidence: "low" as const },
            { key: "expiry_date", label: "保质期/有效期", value: "待确认", confidence: "low" as const },
            { key: "category", label: "品类", value: "待确认", confidence: "low" as const, options: ["食品", "药品", "护理", "清洁用品", "衣物", "数码", "工具", "文具", "其他"] },
            { key: "owner_note", label: "来源/备注", value: "待确认", confidence: "low" as const },
            { key: "unit_price", label: "单价", value: "待确认", confidence: "low" as const },
          ],
        galleryShotIds: shots.map((shot) => shot.id),
      }],
      gallery: shots, createdAt: new Date().toISOString(),
    };
  }

  async organize(session: CaptureSession, shots: Shot[]) {
    const capture = await this.extract(session, shots);
    this.captures.set(capture.id, capture);
    return capture;
  }

  async approve(fallbackCapture: OrganizedCapture) {
    const approved = { ...fallbackCapture, status: "approved" as const };
    this.captures.set(fallbackCapture.id, approved);
    return approved;
  }

  async reject(fallbackCapture: OrganizedCapture, reason: string) {
    const rejected = { ...fallbackCapture, status: "rejected" as const, rejectionReason: reason };
    this.captures.set(fallbackCapture.id, rejected);
    return rejected;
  }
}

export class HttpWaoClient implements WaoClient {
  constructor(private readonly baseUrl: string) {}

  private async request<T>(path: string, init?: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
      signal: init?.signal ?? AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`WAO 请求失败 (${response.status})`);
    return response.json() as Promise<T>;
  }

  createSession(schemaId: SchemaId) {
    return this.request<CaptureSession>("/sessions", { method: "POST", body: JSON.stringify({ schemaId }) });
  }

  uploadShot(sessionId: string, payload: Omit<Shot, "id" | "sessionId" | "createdAt">) {
    return this.request<Shot>(`/sessions/${sessionId}/shots`, { method: "POST", body: JSON.stringify(payload) });
  }

  listShots(sessionId: string) {
    return this.request<Shot[]>(`/sessions/${sessionId}/shots`);
  }

  extract(session: CaptureSession, shots: Shot[]) {
    return this.request<OrganizedCapture>("/captures/extract", { method: "POST", body: JSON.stringify({ session, shots }) });
  }

  organize(session: CaptureSession, shots: Shot[]) {
    return this.request<OrganizedCapture>(
      "/captures/organize",
      { method: "POST", body: JSON.stringify({ session, shots }) },
      ORGANIZE_REQUEST_TIMEOUT_MS,
    );
  }

  approve(capture: OrganizedCapture) {
    return this.request<OrganizedCapture>(`/captures/${capture.id}/approve`, { method: "POST", body: JSON.stringify({ capture }) });
  }

  reject(capture: OrganizedCapture, reason: string) {
    return this.request<OrganizedCapture>(`/captures/${capture.id}/reject`, { method: "POST", body: JSON.stringify({ reason, capture }) });
  }
}

class FallbackWaoClient implements WaoClient {
  constructor(private readonly primary: WaoClient, private readonly fallback: WaoClient) {}

  private async useFallback<T>(primary: () => Promise<T>, fallback: () => Promise<T>) {
    try {
      return await primary();
    } catch {
      return fallback();
    }
  }

  createSession(schemaId: SchemaId) {
    return this.useFallback(() => this.primary.createSession(schemaId), () => this.fallback.createSession(schemaId));
  }
  uploadShot(sessionId: string, payload: Omit<Shot, "id" | "sessionId" | "createdAt">) {
    return this.useFallback(() => this.primary.uploadShot(sessionId, payload), () => this.fallback.uploadShot(sessionId, payload));
  }
  listShots(sessionId: string) {
    return this.useFallback(() => this.primary.listShots(sessionId), () => this.fallback.listShots(sessionId));
  }
  extract(session: CaptureSession, shots: Shot[]) {
    return this.useFallback(() => this.primary.extract(session, shots), () => this.fallback.extract(session, shots));
  }
  organize(session: CaptureSession, shots: Shot[]) {
    return this.useFallback(() => this.primary.organize(session, shots), () => this.fallback.organize(session, shots));
  }
  approve(capture: OrganizedCapture) {
    return this.useFallback(() => this.primary.approve(capture), () => this.fallback.approve(capture));
  }
  reject(capture: OrganizedCapture, reason: string) {
    return this.useFallback(() => this.primary.reject(capture, reason), () => this.fallback.reject(capture, reason));
  }
}

export function createWaoClient(): WaoClient {
  const stub = new DevStubWaoClient();
  // WAO_BASE_URL stays server-only; this same-origin gateway preserves the thin-shell boundary.
  return new FallbackWaoClient(new HttpWaoClient("/api/wao"), stub);
}
