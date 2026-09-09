import { NextResponse } from "next/server";
import { extract, isSchemaId } from "@/lib/bff/capture-service";
import type { CaptureSession, Shot } from "@/lib/types";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { session?: CaptureSession; shots?: Shot[] } | null;
  if (!body?.session || !isSchemaId(body.session.schemaId) || !Array.isArray(body.shots)) {
    return NextResponse.json({ error: "缺少会话或照片" }, { status: 400 });
  }
  return NextResponse.json(await extract(body.session, body.shots));
}
