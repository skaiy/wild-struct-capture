import { NextResponse } from "next/server";

const ALLOWED_METHODS = new Set(["GET", "POST"]);

async function forward(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  if (!ALLOWED_METHODS.has(request.method)) return NextResponse.json({ error: "不支持的方法" }, { status: 405 });
  const baseUrl = process.env.WAO_BASE_URL;
  if (!baseUrl) return NextResponse.json({ error: "WAO 未配置，客户端将使用 DevStub" }, { status: 503 });

  const target = new URL((await params).path.join("/"), `${baseUrl.replace(/\/$/, "")}/`);
  try {
    const response = await fetch(target, {
      method: request.method,
      headers: request.method === "POST" ? { "content-type": "application/json" } : undefined,
      body: request.method === "POST" ? await request.text() : undefined,
      cache: "no-store",
    });
    return new NextResponse(response.body, { status: response.status, headers: { "content-type": response.headers.get("content-type") ?? "application/json" } });
  } catch {
    return NextResponse.json({ error: "WAO 暂不可用，客户端将使用 DevStub" }, { status: 503 });
  }
}

export const GET = forward;
export const POST = forward;
