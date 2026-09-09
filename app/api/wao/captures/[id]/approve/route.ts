import { NextResponse } from "next/server";
import { updateHitl } from "@/lib/bff/capture-service";
import type { OrganizedCapture } from "@/lib/types";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  const body = await request.json().catch(() => null) as { capture?: OrganizedCapture } | null;
  const capture = updateHitl((await params).id, "approved", undefined, body?.capture);
  return capture
    ? NextResponse.json(capture)
    : NextResponse.json({ error: "整理结果不存在" }, { status: 404 });
}
