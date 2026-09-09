import { NextResponse } from "next/server";
import { createSession, isSchemaId } from "@/lib/bff/capture-service";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { schemaId?: unknown } | null;
  if (!body || !isSchemaId(body.schemaId)) {
    return NextResponse.json({ error: "未知模板" }, { status: 400 });
  }
  return NextResponse.json(createSession(body.schemaId), { status: 201 });
}
