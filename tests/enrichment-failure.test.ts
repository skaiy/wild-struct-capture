import assert from "node:assert/strict";
import test from "node:test";
import { extract } from "@/lib/bff/capture-service";
import { EnrichmentError } from "@/lib/bff/wao-runtime";
import type { CaptureSession, Shot } from "@/lib/types";

const session: CaptureSession = {
  id: "failure-test-session",
  schemaId: "home-inventory",
  createdAt: "2026-01-01T00:00:00.000Z",
  shots: [],
};

const textShot: Shot = {
  id: "shot-1",
  sessionId: session.id,
  createdAt: session.createdAt,
  caption: "洗发水",
  direction: "包装正面",
};

function unsignedWorkloadToken() {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode({
    sub: "structcapture-bff",
    tenant_id: "structcapture",
    project_id: "default",
    exp: Math.floor(Date.now() / 1_000) + 3_600,
    iss: "https://issuer.example.test/",
    aud: "wild-agentos",
  })}.`;
}

async function withEnvironment(
  values: Record<string, string | undefined>,
  run: () => Promise<void>,
) {
  const previous = new Map(Object.keys(values).map((key) => [key, process.env[key]]));
  const originalFetch = global.fetch;
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    global.fetch = originalFetch;
  }
}

test("configured WAO failure is fail-closed and never calls the model gateway", async () => {
  await withEnvironment({
    WAO_BASE_URL: "https://wao.example.test",
    STRUCTCAPTURE_WAO_OIDC_TOKEN_URL: "https://issuer.example.test/token",
    STRUCTCAPTURE_WAO_OIDC_CLIENT_ID: "client",
    STRUCTCAPTURE_WAO_OIDC_CLIENT_SECRET: "secret",
    STRUCTCAPTURE_WAO_OIDC_ISSUER: "https://issuer.example.test/",
    STRUCTCAPTURE_WAO_OIDC_AUDIENCE: "wild-agentos",
    STRUCTCAPTURE_LLM_BASE_URL: "https://llm.example.test",
    STRUCTCAPTURE_LLM_API_KEY: "test-key",
    STRUCTCAPTURE_WAO_INCLUDE_IMAGES: "false",
    STRUCTCAPTURE_LLM_INCLUDE_IMAGES: "false",
  }, async () => {
    let calls = 0;
    global.fetch = async () => {
      calls += 1;
      return new Response("unavailable", { status: 503 });
    };

    await assert.rejects(
      () => extract(session, [textShot]),
      (error: unknown) => error instanceof EnrichmentError && error.code === "wao_invalid_response",
    );
    assert.equal(calls, 1);
  });
});

test("an image gateway 413 is a vision hard failure, not a heuristic result", async () => {
  await withEnvironment({
    WAO_BASE_URL: undefined,
    STRUCTCAPTURE_WAO_OIDC_TOKEN_URL: undefined,
    STRUCTCAPTURE_WAO_OIDC_CLIENT_ID: undefined,
    STRUCTCAPTURE_WAO_OIDC_CLIENT_SECRET: undefined,
    STRUCTCAPTURE_WAO_OIDC_ISSUER: undefined,
    STRUCTCAPTURE_WAO_OIDC_AUDIENCE: undefined,
    STRUCTCAPTURE_LLM_BASE_URL: "https://llm.example.test",
    STRUCTCAPTURE_LLM_API_KEY: "test-key",
    STRUCTCAPTURE_LLM_INCLUDE_IMAGES: "true",
  }, async () => {
    global.fetch = async () => new Response("too large", { status: 413 });
    const imageShot = { ...textShot, imageUrl: "https://cdn.example.test/product.jpg" };

    await assert.rejects(
      () => extract(session, [imageShot]),
      (error: unknown) => error instanceof EnrichmentError && error.code === "vision_payload_too_large",
    );
  });
});

test("WAO vision mount failures preserve the upstream error and never call the LLM", async () => {
  await withEnvironment({
    WAO_BASE_URL: "https://wao.example.test",
    STRUCTCAPTURE_WAO_OIDC_TOKEN_URL: "https://issuer.example.test/token",
    STRUCTCAPTURE_WAO_OIDC_CLIENT_ID: "client",
    STRUCTCAPTURE_WAO_OIDC_CLIENT_SECRET: "secret",
    STRUCTCAPTURE_WAO_OIDC_ISSUER: "https://issuer.example.test/",
    STRUCTCAPTURE_WAO_OIDC_AUDIENCE: "wild-agentos",
    STRUCTCAPTURE_WAO_INCLUDE_IMAGES: "true",
    STRUCTCAPTURE_LLM_BASE_URL: "https://llm.example.test",
    STRUCTCAPTURE_LLM_API_KEY: "test-key",
  }, async () => {
    const requestedUrls: string[] = [];
    global.fetch = async (input, init) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.endsWith("/api/v1/agents")) {
        return Response.json({ agents: [{
          id: "00000000-0000-0000-0000-000000000001",
          name: "structcapture-organizer",
          business_domain: "structcapture",
          tenant_id: "structcapture",
          project_id: "default",
        }] });
      }
      if (url.endsWith("/token")) return Response.json({ access_token: unsignedWorkloadToken() });
      if (url.includes("/chat")) {
        const payload = JSON.parse(String(init?.body));
        assert.deepEqual(payload.images, ["https://cdn.example.test/product.jpg"]);
        return Response.json({ detail: { code: "vision_mount_unavailable" } }, { status: 422 });
      }
      throw new Error(`unexpected request: ${url}`);
    };

    await assert.rejects(
      () => extract(session, [{ ...textShot, imageUrl: "https://cdn.example.test/product.jpg" }]),
      (error: unknown) => error instanceof EnrichmentError && error.code === "vision_mount_unavailable",
    );
    assert.equal(requestedUrls.some((url) => url.includes("llm.example.test")), false);
  });
});

test("an unconfigured WAO permits the explicitly configured model gateway", async () => {
  await withEnvironment({
    WAO_BASE_URL: undefined,
    STRUCTCAPTURE_WAO_OIDC_TOKEN_URL: undefined,
    STRUCTCAPTURE_WAO_OIDC_CLIENT_ID: undefined,
    STRUCTCAPTURE_WAO_OIDC_CLIENT_SECRET: undefined,
    STRUCTCAPTURE_WAO_OIDC_ISSUER: undefined,
    STRUCTCAPTURE_WAO_OIDC_AUDIENCE: undefined,
    STRUCTCAPTURE_LLM_BASE_URL: "https://llm.example.test",
    STRUCTCAPTURE_LLM_API_KEY: "test-key",
    STRUCTCAPTURE_LLM_INCLUDE_IMAGES: "false",
  }, async () => {
    global.fetch = async () => Response.json({
      choices: [{ message: { content: '{"summary":"模型整理成功","items":[]}' } }],
    });

    const result = await extract(session, [textShot]);
    assert.equal(result.metaFields.find((field) => field.key === "summary")?.value, "模型整理成功");
  });
});

test("a configured text-only model gateway failure is fail-closed", async () => {
  await withEnvironment({
    WAO_BASE_URL: undefined,
    STRUCTCAPTURE_WAO_OIDC_TOKEN_URL: undefined,
    STRUCTCAPTURE_WAO_OIDC_CLIENT_ID: undefined,
    STRUCTCAPTURE_WAO_OIDC_CLIENT_SECRET: undefined,
    STRUCTCAPTURE_WAO_OIDC_ISSUER: undefined,
    STRUCTCAPTURE_WAO_OIDC_AUDIENCE: undefined,
    STRUCTCAPTURE_LLM_BASE_URL: "https://llm.example.test",
    STRUCTCAPTURE_LLM_API_KEY: "test-key",
    STRUCTCAPTURE_LLM_INCLUDE_IMAGES: "false",
  }, async () => {
    global.fetch = async () => new Response("unavailable", { status: 503 });

    await assert.rejects(
      () => extract(session, [textShot]),
      (error: unknown) => error instanceof EnrichmentError && error.code === "llm_invalid_response",
    );
  });
});
