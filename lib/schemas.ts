export type CaptureMode = "crash-test" | "home-inventory";

export type CapturePhoto = {
  id: string;
  name: string;
  dataUrl: string;
  note?: string;
};

export type StructuredItem = {
  id: string;
  label: string;
  value: string;
  confidence: "high" | "medium" | "low";
  sourcePhoto?: string;
};

export type OrganizeRequest = {
  mode: CaptureMode;
  prompt?: string;
  photos: Array<Pick<CapturePhoto, "id" | "name" | "note">>;
};

export type OrganizeResult = {
  summary: string;
  followUp?: string;
  items: StructuredItem[];
  provider: "wao" | "stub";
};

export const modeCopy: Record<CaptureMode, { name: string; subtitle: string; prompt: string }> = {
  "crash-test": {
    name: "碰撞试验准备",
    subtitle: "依序记录车辆、传感器、假人及安全检查。",
    prompt: "请拍摄车辆正面、侧面、传感器安装、假人位置及场地安全状态。",
  },
  "home-inventory": {
    name: "家庭资产盘点",
    subtitle: "逐间记录物品、品牌、型号、数量和保存位置。",
    prompt: "请拍摄物品整体、铭牌/型号及收纳位置；可补充购买或保修信息。",
  },
};
