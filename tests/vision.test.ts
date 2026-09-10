import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { prepareVisionImages } from "@/lib/bff/vision";

test("prepareVisionImages recompresses data URLs and caps retained shots", async () => {
  process.env.STRUCTCAPTURE_VISION_MAX_SHOTS = "1";
  process.env.STRUCTCAPTURE_VISION_MAX_EDGE_PX = "128";
  process.env.STRUCTCAPTURE_VISION_MAX_BYTES = "20000";
  const source = await sharp({
    create: { width: 800, height: 400, channels: 3, background: { r: 210, g: 20, b: 20 } },
  }).png().toBuffer();
  const dataUrl = `data:image/png;base64,${source.toString("base64")}`;

  const result = await prepareVisionImages([dataUrl, "https://example.test/second.jpg"]);

  assert.equal(result.urls.length, 1);
  assert.equal(result.shotNumbers[0], 1);
  assert.match(result.urls[0], /^data:image\/jpeg;base64,/);
  assert.ok(result.bytes <= 20_000);
});

test("prepareVisionImages preserves bounded HTTPS URLs without fetching them", async () => {
  process.env.STRUCTCAPTURE_VISION_MAX_SHOTS = "2";
  const result = await prepareVisionImages([
    "https://cdn.example.test/first.jpg",
    "https://cdn.example.test/second.jpg",
    "https://cdn.example.test/third.jpg",
  ]);

  assert.deepEqual(result.urls, [
    "https://cdn.example.test/first.jpg",
    "https://cdn.example.test/second.jpg",
  ]);
  assert.deepEqual(result.shotNumbers, [1, 2]);
  assert.equal(result.bytes, 0);
});
