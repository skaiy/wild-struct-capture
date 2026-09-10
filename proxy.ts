import { NextRequest, NextResponse } from "next/server";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function unauthorized() {
  return new NextResponse("StructCapture demo is locked.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="StructCapture demo"',
      "Cache-Control": "no-store",
      "Clear-Site-Data": '"cache", "storage"',
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

async function matchesCredentials(authorization: string, user: string, password: string) {
  if (!authorization.startsWith("Basic ")) return false;

  let supplied: string;
  try {
    const bytes = Uint8Array.from(atob(authorization.slice(6).trim()), (character) => character.charCodeAt(0));
    supplied = decoder.decode(bytes);
  } catch {
    return false;
  }

  const separator = supplied.indexOf(":");
  if (separator < 0) return false;

  const digest = async (value: string) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  const [providedDigest, expectedDigest] = await Promise.all([
    digest(supplied),
    digest(`${user}:${password}`),
  ]);

  let difference = 0;
  for (let index = 0; index < providedDigest.length; index += 1) {
    difference |= providedDigest[index] ^ expectedDigest[index];
  }
  return difference === 0;
}

export async function proxy(request: NextRequest) {
  const user = process.env.STRUCTCAPTURE_DEMO_BASIC_USER ?? "";
  const password = process.env.STRUCTCAPTURE_DEMO_BASIC_PASSWORD ?? "";

  // Local development remains open unless both values configure the demo lock.
  if (!user && !password) return NextResponse.next();

  const authorization = request.headers.get("authorization");
  if (!authorization || !(await matchesCredentials(authorization, user, password))) {
    return unauthorized();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
