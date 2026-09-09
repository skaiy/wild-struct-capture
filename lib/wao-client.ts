import type { CaptureSession, OrganizedCapture, SchemaId, Shot } from "@/lib/types";

export interface WaoClient {
  createSession(schemaId: SchemaId): Promise<CaptureSession>;
  uploadShot(sessionId: string, payload: Omit<Shot, "id" | "sessionId" | "createdAt">): Promise<Shot>;
  listShots(sessionId: string): Promise<Shot[]>;
  extract(session: CaptureSession, shots: Shot[]): Promise<OrganizedCapture>;
  organize(session: CaptureSession, shots: Shot[]): Promise<OrganizedCapture>;
  approve(captureId: string): Promise<OrganizedCapture>;
  reject(captureId: string, reason: string): Promise<OrganizedCapture>;
}

const newId = () => crypto.randomUUID();

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
    const fields = [
      { key: "schema", label: "记录模板", value: schemaLabel, confidence: "high" as const },
      { key: "shot_count", label: "已记录照片", value: `${shots.length} 张`, confidence: "high" as const },
      { key: "summary", label: "现场摘要", value: shots.map((shot) => shot.caption).filter(Boolean).join("；") || "等待补充照片说明", confidence: "medium" as const },
    ];
    return {
      id: newId(), sessionId: session.id, schemaId: session.schemaId, status: "pending_hitl" as const,
      fields, gallery: shots, createdAt: new Date().toISOString(),
    };
  }

  async organize(session: CaptureSession, shots: Shot[]) {
    const capture = await this.extract(session, shots);
    this.captures.set(capture.id, capture);
    return capture;
  }

  async approve(captureId: string) {
    const capture = this.captures.get(captureId);
    if (!capture) throw new Error("整理结果不存在");
    const approved = { ...capture, status: "approved" as const };
    this.captures.set(captureId, approved);
    return approved;
  }

  async reject(captureId: string, reason: string) {
    const capture = this.captures.get(captureId);
    if (!capture) throw new Error("整理结果不存在");
    const rejected = { ...capture, status: "rejected" as const, rejectionReason: reason };
    this.captures.set(captureId, rejected);
    return rejected;
  }
}

export class HttpWaoClient implements WaoClient {
  constructor(private readonly baseUrl: string) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
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
    return this.request<OrganizedCapture>("/captures/organize", { method: "POST", body: JSON.stringify({ session, shots }) });
  }

  approve(captureId: string) {
    return this.request<OrganizedCapture>(`/captures/${captureId}/approve`, { method: "POST" });
  }

  reject(captureId: string, reason: string) {
    return this.request<OrganizedCapture>(`/captures/${captureId}/reject`, { method: "POST", body: JSON.stringify({ reason }) });
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
  approve(captureId: string) {
    return this.useFallback(() => this.primary.approve(captureId), () => this.fallback.approve(captureId));
  }
  reject(captureId: string, reason: string) {
    return this.useFallback(() => this.primary.reject(captureId, reason), () => this.fallback.reject(captureId, reason));
  }
}

export function createWaoClient(): WaoClient {
  const stub = new DevStubWaoClient();
  // WAO_BASE_URL stays server-only; this same-origin gateway preserves the thin-shell boundary.
  return new FallbackWaoClient(new HttpWaoClient("/api/wao"), stub);
}
