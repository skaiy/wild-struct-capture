import sharp from "sharp";

type VisionLimits = {
  maxShots: number;
  maxEdgePx: number;
  maxBytes: number;
};

export type PreparedVisionImages = {
  urls: string[];
  shotNumbers: number[];
  bytes: number;
};

const DEFAULT_LIMITS: VisionLimits = {
  maxShots: 4,
  maxEdgePx: 1280,
  maxBytes: 700_000,
};

function positiveEnvNumber(name: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= min && value <= max ? Math.floor(value) : fallback;
}

export function visionLimits(): VisionLimits {
  return {
    maxShots: positiveEnvNumber("STRUCTCAPTURE_VISION_MAX_SHOTS", DEFAULT_LIMITS.maxShots, 1, 20),
    maxEdgePx: positiveEnvNumber("STRUCTCAPTURE_VISION_MAX_EDGE_PX", DEFAULT_LIMITS.maxEdgePx, 128, 4096),
    maxBytes: positiveEnvNumber("STRUCTCAPTURE_VISION_MAX_BYTES", DEFAULT_LIMITS.maxBytes, 10_000, 5_000_000),
  };
}

function decodeImageDataUrl(url: string) {
  const match = /^data:image\/(?:jpeg|jpg|png|webp|gif|avif);base64,([a-z0-9+/=\s]+)$/i.exec(url);
  if (!match) throw new Error("unsupported-data-url");
  const base64 = match[1].replace(/\s/g, "");
  if (base64.length % 4 !== 0 || !/^[a-z0-9+/]*={0,2}$/i.test(base64)) {
    throw new Error("invalid-base64");
  }
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length || buffer.toString("base64") !== base64) {
    throw new Error("invalid-base64");
  }
  return buffer;
}

async function compressDataUrl(url: string, limits: VisionLimits) {
  const input = decodeImageDataUrl(url);
  let edge = limits.maxEdgePx;

  while (edge >= 320) {
    for (let quality = 72; quality >= 32; quality -= 8) {
      const output = await sharp(input, { limitInputPixels: 40_000_000 })
        .rotate()
        .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();
      if (output.length <= limits.maxBytes) {
        return { url: `data:image/jpeg;base64,${output.toString("base64")}`, bytes: output.length };
      }
    }
    edge = Math.floor(edge * 0.8);
  }
  throw new Error("compressed-image-too-large");
}

function isRemoteHttpsUrl(url: string) {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Creates a bounded set of model-ready images without fetching remote URLs.
 * Keeping remote URLs opaque avoids turning this BFF into an SSRF proxy.
 */
export async function prepareVisionImages(imageUrls: Array<string | undefined>): Promise<PreparedVisionImages> {
  const limits = visionLimits();
  const prepared: PreparedVisionImages = { urls: [], shotNumbers: [], bytes: 0 };

  for (const [index, imageUrl] of imageUrls.entries()) {
    if (prepared.urls.length >= limits.maxShots) break;
    if (!imageUrl) continue;

    if (imageUrl.startsWith("data:")) {
      try {
        const image = await compressDataUrl(imageUrl, limits);
        prepared.urls.push(image.url);
        prepared.shotNumbers.push(index + 1);
        prepared.bytes += image.bytes;
      } catch {
        console.warn("Vision image preparation skipped image", {
          shotCount: 1,
          bytes: 0,
          includeImages: true,
        });
      }
      continue;
    }

    if (isRemoteHttpsUrl(imageUrl)) {
      prepared.urls.push(imageUrl);
      prepared.shotNumbers.push(index + 1);
    } else {
      console.warn("Vision image preparation skipped image", {
        shotCount: 1,
        bytes: 0,
        includeImages: true,
      });
    }
  }

  console.info("Vision images prepared", {
    shotCount: prepared.urls.length,
    bytes: prepared.bytes,
    includeImages: true,
  });
  return prepared;
}
