import { NextResponse } from "next/server";
import { extract, isSchemaId } from "@/lib/bff/capture-service";
import { EnrichmentError } from "@/lib/bff/wao-runtime";
import type { CaptureSession, Shot } from "@/lib/types";

function enrichmentErrorResponse(error: EnrichmentError) {
  const status = error.code === "vision_payload_too_large"
    ? 413
    : error.code.endsWith("_timeout")
      ? 504
      : 503;
  return NextResponse.json({ error: error.message, code: error.code }, { status });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { session?: CaptureSession; shots?: Shot[] } | null;
  if (!body?.session || !isSchemaId(body.session.schemaId) || !Array.isArray(body.shots)) {
    return NextResponse.json({ error: "缺少会话或照片" }, { status: 400 });
  }
  try {
    return NextResponse.json(await extract(body.session, body.shots));
  } catch (error) {
    if (error instanceof EnrichmentError) return enrichmentErrorResponse(error);
    throw error;
  }
}
