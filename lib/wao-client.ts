import type { OrganizeRequest, OrganizeResult } from "./schemas";

export interface WaoClient {
  organize(request: OrganizeRequest): Promise<OrganizeResult>;
}

export class WaoHttpClient implements WaoClient {
  constructor(private readonly baseUrl: string) {}

  async organize(request: OrganizeRequest): Promise<OrganizeResult> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/v1/structcapture/organize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`WAO returned ${response.status}`);
    return (await response.json()) as OrganizeResult;
  }
}

export class WaoDevStub implements WaoClient {
  async organize(request: OrganizeRequest): Promise<OrganizeResult> {
    const crashItems = [
      ["车辆识别", "待确认 VIN / 车辆型号"],
      ["传感器安装", "已拍摄，需核对固定点"],
      ["假人位置", "待补充正侧面照片"],
      ["场地安全", "请确认隔离区域和急停装置"],
    ];
    const homeItems = [
      ["物品类别", "待确认"],
      ["品牌 / 型号", "请补拍铭牌"],
      ["数量", "待人工复核"],
      ["存放位置", "已记录当前房间"],
    ];
    const definitions = request.mode === "crash-test" ? crashItems : homeItems;
    return {
      summary: `已按 ${request.mode === "crash-test" ? "碰撞试验" : "家庭盘点"} 模板整理 ${request.photos.length} 张照片。请在人工复核后导出。`,
      followUp: request.photos.length < 2 ? "建议再补充一张特写照片，以提高识别完整度。" : undefined,
      items: definitions.map(([label, value], index) => ({
        id: `stub-${index}`,
        label,
        value,
        confidence: index < 2 ? "medium" : "low",
        sourcePhoto: request.photos[index]?.name,
      })),
      provider: "stub",
    };
  }
}

export function getWaoClient(): WaoClient {
  return process.env.WAO_BASE_URL ? new WaoHttpClient(process.env.WAO_BASE_URL) : new WaoDevStub();
}
