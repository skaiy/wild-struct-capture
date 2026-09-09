import type { CaptureSchema } from "@/lib/types";

export const schemas: CaptureSchema[] = [
  {
    id: "crash-prep",
    title: "碰撞实验准备",
    summary: "按步骤记录实验对象、场地和安全条件。",
    prompts: ["拍摄实验对象全景", "拍摄关键部件与编号", "拍摄场地和安全隔离区域"],
  },
  {
    id: "home-inventory",
    title: "家庭物品盘点",
    summary: "快速建立空间、物品和存放位置的清单。",
    prompts: ["拍摄房间整体", "拍摄物品标签或型号", "拍摄物品的存放位置"],
  },
];

export function getSchema(id: string) {
  return schemas.find((schema) => schema.id === id);
}
