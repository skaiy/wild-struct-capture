import type { CaptureSession, OrganizedCapture, SchemaId, Shot } from "@/lib/types";

export type CaptureStore = {
  createSession(schemaId: SchemaId): CaptureSession;
  getSession(sessionId: string): CaptureSession | undefined;
  addShot(sessionId: string, shot: Shot): Shot | undefined;
  listShots(sessionId: string): Shot[] | undefined;
  saveCapture(capture: OrganizedCapture): OrganizedCapture;
  getCapture(captureId: string): OrganizedCapture | undefined;
};

/**
 * POC implementation: business state belongs to this BFF process.
 * Replace this adapter with a database-backed implementation before production.
 */
class InMemoryCaptureStore implements CaptureStore {
  private readonly sessions = new Map<string, CaptureSession>();
  private readonly captures = new Map<string, OrganizedCapture>();

  createSession(schemaId: SchemaId) {
    const session: CaptureSession = {
      id: crypto.randomUUID(),
      schemaId,
      createdAt: new Date().toISOString(),
      shots: [],
    };
    this.sessions.set(session.id, session);
    return session;
  }

  getSession(sessionId: string) {
    return this.sessions.get(sessionId);
  }

  addShot(sessionId: string, shot: Shot) {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    session.shots.push(shot);
    return shot;
  }

  listShots(sessionId: string) {
    return this.sessions.get(sessionId)?.shots;
  }

  saveCapture(capture: OrganizedCapture) {
    this.captures.set(capture.id, capture);
    return capture;
  }

  getCapture(captureId: string) {
    return this.captures.get(captureId);
  }
}

export const captureStore: CaptureStore = new InMemoryCaptureStore();
