import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { extract } from "@/lib/bff/capture-service";
import { chatCompletionsUrl, EnrichmentError, isWaoConfigured, mintHs256WorkloadToken } from "@/lib/bff/wao-runtime";
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

test("HS256 workload JWT contains the required scoped claims and valid signature", () => {
  const now = 1_700_000_000;
  const minted = mintHs256WorkloadToken({
    secret: "test-hs256-secret",
    sub: "structcapture-bff",
    issuer: "https://capture.example.test",
    audience: "wild-agentos",
    ttlSeconds: 600,
  }, { tenant_id: "structcapture", project_id: "default" }, now);
  const [header, payload, signature] = minted.token.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url").toString("utf8")), { alg: "HS256", typ: "JWT" });
  assert.deepEqual(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")), {
    sub: "structcapture-bff",
    tenant_id: "structcapture",
    project_id: "default",
    iat: now,
    exp: now + 600,
    iss: "https://capture.example.test",
    aud: "wild-agentos",
  });
  assert.equal(signature, createHmac("sha256", "test-hs256-secret").update(`${header}.${payload}`).digest("base64url"));
});

test("HS256 config authenticates the Agent directory and chat without a model fallback", async () => {
  await withEnvironment({
    WAO_BASE_URL: "https://wao.example.test",
    STRUCTCAPTURE_WAO_AUTH_MODE: "hs256",
    STRUCTCAPTURE_WAO_HS256_SECRET: "test-hs256-secret",
    STRUCTCAPTURE_WAO_OIDC_TOKEN_URL: undefined,
    STRUCTCAPTURE_WAO_OIDC_CLIENT_ID: undefined,
    STRUCTCAPTURE_WAO_OIDC_CLIENT_SECRET: undefined,
    STRUCTCAPTURE_WAO_OIDC_ISSUER: undefined,
    STRUCTCAPTURE_WAO_OIDC_AUDIENCE: undefined,
    STRUCTCAPTURE_LLM_BASE_URL: "https://llm.example.test",
    STRUCTCAPTURE_LLM_API_KEY: "test-key",
    STRUCTCAPTURE_WAO_INCLUDE_IMAGES: "false",
  }, async () => {
    assert.equal(isWaoConfigured(), true);
    const authorizationHeaders: string[] = [];
    global.fetch = async (input, init) => {
      const url = String(input);
      authorizationHeaders.push(String(new Headers(init?.headers).get("authorization")));
      if (url.endsWith("/api/v1/agents")) {
        return Response.json({ agents: [{
          id: "00000000-0000-0000-0000-000000000001",
          name: "structcapture-organizer",
          business_domain: "structcapture",
          tenant_id: "structcapture",
          project_id: "default",
        }] });
      }
      if (url.includes("/chat")) {
        return Response.json({ answer: '{"summary":"WAO HS256 整理成功","items":[]}' });
      }
      throw new Error(`unexpected request: ${url}`);
    };

    const result = await extract(session, [textShot]);
    assert.equal(result.metaFields.find((field) => field.key === "summary")?.value, "WAO HS256 整理成功");
    assert.equal(authorizationHeaders.length, 2);
    assert.ok(authorizationHeaders.every((value) => value.startsWith("Bearer ")));
  });
});

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

test("model gateway uses enough completion tokens and accepts JSON from DeepSeek reasoning_content", async () => {
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
    global.fetch = async (_input, init) => {
      const request = JSON.parse(String(init?.body));
      assert.equal(request.max_tokens, 4_096);
      assert.deepEqual(request.thinking, { type: "disabled" });
      assert.deepEqual(request.response_format, { type: "json_object" });
      return Response.json({
        choices: [{
          finish_reason: "stop",
          message: {
            content: "",
            reasoning_content: '{"summary":"来自推理字段的整理结果","items":[]}',
          },
        }],
      });
    };

    for (const schemaId of ["home-inventory", "crash-prep"] as const) {
      const result = await extract({ ...session, schemaId }, [textShot]);
      assert.equal(result.metaFields.find((field) => field.key === "summary")?.value, "来自推理字段的整理结果");
    }
  });
});

test("model gateway accepts crash-prep labels while home-inventory keys remain valid", async () => {
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
    global.fetch = async (_input, init) => {
      const request = JSON.parse(String(init?.body));
      const prompt = request.messages[1].content;
      if (prompt.includes("知识包=crash-prep")) {
        assert.match(prompt, /scene_location（试验地点）/);
        assert.doesNotMatch(prompt, /"field_key"/);
        return Response.json({
          choices: [{
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                summary: "车辆已在碰撞试验场完成安全布置。",
                fields: {
                  "试验地点": { value: "碰撞试验场", confidence: "high" },
                  "车辆方向": { value: "左前45°", confidence: "high" },
                  "安全设备": { value: "警戒锥和灭火器", confidence: "medium" },
                  "车辆状态": { value: "车身完整", confidence: "medium" },
                  "证据说明": { value: "正面及左前方照片已记录", confidence: "medium" },
                },
              }),
            },
          }],
        });
      }
      assert.match(prompt, /item_name（物品名称）/);
      return Response.json({
        choices: [{
          finish_reason: "stop",
          message: {
            content: '{"items":[{"fields":{"item_name":{"value":"洗发水","confidence":"high"}},"galleryShotIds":["1"]}]}',
          },
        }],
      });
    };

    const crashPrep = await extract({ ...session, schemaId: "crash-prep" }, [textShot]);
    assert.equal(crashPrep.status, "pending_hitl");
    assert.equal(crashPrep.items[0].fields.find((field) => field.key === "scene_location")?.value, "碰撞试验场");
    assert.equal(crashPrep.items[0].fields.find((field) => field.key === "vehicle_direction")?.value, "前左45°");
    assert.equal(crashPrep.items[0].fields.find((field) => field.key === "safety_equipment")?.value, "警戒锥和灭火器");

    const homeInventory = await extract(session, [textShot]);
    assert.equal(homeInventory.status, "pending_hitl");
    assert.equal(homeInventory.items[0].fields.find((field) => field.key === "item_name")?.value, "洗发水");
  });
});

test("model gateway uses the final JSON object embedded in reasoning_content", async () => {
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
      choices: [{
        finish_reason: "stop",
        message: {
          content: "",
          reasoning_content: "提取完毕。最终结果：{\"summary\":\"推理末尾的 JSON\",\"items\":[]}",
        },
      }],
    });

    const result = await extract(session, [textShot]);
    assert.equal(result.metaFields.find((field) => field.key === "summary")?.value, "推理末尾的 JSON");
  });
});

test("model gateway timeout returns llm_timeout", async () => {
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
    global.fetch = async () => {
      throw new DOMException("request timed out", "TimeoutError");
    };

    await assert.rejects(
      () => extract(session, [textShot]),
      (error: unknown) => error instanceof EnrichmentError && error.code === "llm_timeout",
    );
  });
});

test("chat completions URL accepts an origin, v1 base, or full endpoint", async () => {
  for (const [baseUrl, expected] of [
    ["https://api.deepseek.com", "https://api.deepseek.com/v1/chat/completions"],
    ["https://api.deepseek.com/v1", "https://api.deepseek.com/v1/chat/completions"],
    ["https://api.deepseek.com/v1/chat/completions", "https://api.deepseek.com/v1/chat/completions"],
  ]) {
    await withEnvironment({
      STRUCTCAPTURE_LLM_BASE_URL: baseUrl,
      STRUCTCAPTURE_LLM_API_KEY: "test-key",
    }, async () => {
      assert.equal(chatCompletionsUrl(), expected);
    });
  }
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
      (error: unknown) => error instanceof EnrichmentError && error.code === "llm_upstream_error",
    );
  });
});
