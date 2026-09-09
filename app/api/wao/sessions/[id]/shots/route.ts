import { NextResponse } from "next/server";
import { addShot, listShots } from "@/lib/bff/capture-service";
import type { Shot } from "@/lib/types";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const shots = listShots((await params).id);
  return shots
    ? NextResponse.json(shots)
    : NextResponse.json({ error: "会话不存在" }, { status: 404 });
}

export async function POST(request: Request, { params }: Context) {
  const body = await request.json().catch(() => null) as Pick<Shot, "caption" | "direction" | "imageUrl"> | null;
  if (!body || (!body.caption && !body.direction)) {
    return NextResponse.json({ error: "说明或指引不能为空" }, { status: 400 });
  }
  const shot = addShot((await params).id, body);
  return shot
    ? NextResponse.json(shot, { status: 201 })
    : NextResponse.json({ error: "会话不存在" }, { status: 404 });
}
