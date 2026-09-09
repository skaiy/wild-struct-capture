import { NextResponse } from "next/server";
import { updateHitl } from "@/lib/bff/capture-service";

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Context) {
  const capture = updateHitl((await params).id, "approved");
  return capture
    ? NextResponse.json(capture)
    : NextResponse.json({ error: "整理结果不存在" }, { status: 404 });
}
