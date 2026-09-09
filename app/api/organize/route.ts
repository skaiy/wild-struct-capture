import { NextResponse } from "next/server";
import { getWaoClient, WaoDevStub } from "@/lib/wao-client";
import type { OrganizeRequest } from "@/lib/schemas";

export async function POST(request: Request) {
  const body = (await request.json()) as OrganizeRequest;
  if (!body?.mode || !Array.isArray(body.photos)) {
    return NextResponse.json({ error: "无效的拍录数据" }, { status: 400 });
  }

  try {
    return NextResponse.json(await getWaoClient().organize(body));
  } catch (error) {
    console.warn("WAO unavailable; using development stub.", error);
    const result = await new WaoDevStub().organize(body);
    return NextResponse.json(result, { headers: { "x-wao-fallback": "stub" } });
  }
}
