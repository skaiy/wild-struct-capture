import { NextResponse } from "next/server";
import type { CaptureSession, SchemaId } from "@/lib/types";

const sessions = new Map<string, CaptureSession>();

export async function POST(request: Request) {
  const body = await request.json() as { schemaId?: SchemaId };
  if (body.schemaId !== "crash-prep" && body.schemaId !== "home-inventory") {
    return NextResponse.json({ error: "未知模板" }, { status: 400 });
  }
  const session: CaptureSession = {
    id: crypto.randomUUID(), schemaId: body.schemaId, createdAt: new Date().toISOString(), shots: [],
  };
  sessions.set(session.id, session);
  return NextResponse.json(session, { status: 201 });
}

export function getSession(id: string) {
  return sessions.get(id);
}
