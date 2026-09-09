import type { CaptureSession, SchemaId, Shot } from "@/lib/types";

export interface WaoClient {
  createSession(schemaId: SchemaId): Promise<CaptureSession>;
  uploadShot(sessionId: string, payload: Omit<Shot, "id" | "sessionId" | "createdAt">): Promise<Shot>;
  listShots(sessionId: string): Promise<Shot[]>;
  organize(sessionId: string): Promise<{ status: "queued" | "stubbed" }>;
}

const newId = () => crypto.randomUUID();

export class DevStubWaoClient implements WaoClient {
  private sessions = new Map<string, CaptureSession>();

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

  async organize(_sessionId: string) {
    return { status: "stubbed" as const };
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

  organize(sessionId: string) {
    return this.request<{ status: "queued" | "stubbed" }>(`/sessions/${sessionId}/organize`, { method: "POST" });
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
  organize(sessionId: string) {
    return this.useFallback(() => this.primary.organize(sessionId), () => this.fallback.organize(sessionId));
  }
}

export function createWaoClient(): WaoClient {
  const baseUrl = process.env.NEXT_PUBLIC_WAO_BASE_URL;
  const stub = new DevStubWaoClient();
  return baseUrl ? new FallbackWaoClient(new HttpWaoClient(baseUrl), stub) : stub;
}
