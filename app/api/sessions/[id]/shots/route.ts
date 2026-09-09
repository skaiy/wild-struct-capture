import { NextResponse } from "next/server";
import { getSession } from "@/app/api/sessions/route";
import type { Shot } from "@/lib/types";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const session = getSession((await params).id);
  if (!session) return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  return NextResponse.json(session.shots);
}

export async function POST(request: Request, { params }: Context) {
  const session = getSession((await params).id);
  if (!session) return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  const body = await request.json() as Pick<Shot, "caption" | "direction" | "imageUrl">;
  if (!body.caption && !body.direction) return NextResponse.json({ error: "说明或指引不能为空" }, { status: 400 });
  const shot: Shot = {
    id: crypto.randomUUID(), sessionId: session.id, caption: body.caption ?? "", direction: body.direction ?? "",
    imageUrl: body.imageUrl, createdAt: new Date().toISOString(),
  };
  session.shots.push(shot);
  return NextResponse.json(shot, { status: 201 });
}
