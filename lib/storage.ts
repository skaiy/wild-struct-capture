import type { CaptureSession, Shot } from "@/lib/types";

const KEY = "wild-struct-capture/sessions";

export interface StorageProvider {
  create(session: CaptureSession): Promise<CaptureSession>;
  saveShot(sessionId: string, shot: Shot): Promise<void>;
  remove(sessionId: string): Promise<void>;
  list(sessionId: string): Promise<Shot[]>;
}

export class LocalStorageProvider implements StorageProvider {
  private read(): CaptureSession[] {
    if (typeof window === "undefined") return [];
    try {
      return JSON.parse(window.localStorage.getItem(KEY) ?? "[]") as CaptureSession[];
    } catch {
      return [];
    }
  }

  private write(sessions: CaptureSession[]) {
    window.localStorage.setItem(KEY, JSON.stringify(sessions));
  }

  async create(session: CaptureSession) {
    this.write([...this.read(), session]);
    return session;
  }

  async saveShot(sessionId: string, shot: Shot) {
    this.write(this.read().map((session) =>
      session.id === sessionId ? { ...session, shots: [...session.shots, shot] } : session,
    ));
  }

  async remove(sessionId: string) {
    this.write(this.read().filter((session) => session.id !== sessionId));
  }

  async list(sessionId: string) {
    return this.read().find((session) => session.id === sessionId)?.shots ?? [];
  }
}
