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
