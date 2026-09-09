import { NextResponse } from "next/server";
import { getSession, organize } from "@/lib/bff/capture-service";
import type { CaptureSession, Shot } from "@/lib/types";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { session?: CaptureSession; shots?: Shot[] } | null;
  if (!body?.session || !Array.isArray(body.shots)) {
    return NextResponse.json({ error: "缺少会话或照片" }, { status: 400 });
  }
  const session = getSession(body.session.id);
  if (!session) return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  return NextResponse.json(organize(session, body.shots), { status: 201 });
}
