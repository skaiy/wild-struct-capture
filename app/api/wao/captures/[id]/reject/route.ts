import { NextResponse } from "next/server";
import { updateHitl } from "@/lib/bff/capture-service";
import type { OrganizedCapture } from "@/lib/types";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  const body = await request.json().catch(() => null) as { reason?: unknown; capture?: OrganizedCapture } | null;
  if (!body || typeof body.reason !== "string" || !body.reason.trim()) {
    return NextResponse.json({ error: "退回原因不能为空" }, { status: 400 });
  }
  const capture = updateHitl((await params).id, "rejected", body.reason.trim(), body.capture);
  return capture
    ? NextResponse.json(capture)
    : NextResponse.json({ error: "整理结果不存在" }, { status: 404 });
}
