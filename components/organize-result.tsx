"use client";

import { useState } from "react";
import { Check, Download, RotateCcw, Send, X } from "lucide-react";
import type { OrganizedCapture, Shot, StructuredField } from "@/lib/types";
import type { WaoClient } from "@/lib/wao-client";

const LONG_FIELD_KEYS = new Set([
  "summary",
  "owner_note",
  "evidence_notes",
  "safety_equipment",
  "vehicle_condition",
]);

const MEDIUM_FIELD_KEYS = new Set([
  "item_name",
  "brand",
  "location",
  "category",
  "specification",
  "expiry_date",
]);

function fieldLayout(field: StructuredField) {
  if (isLongField(field)) return "col-span-full";
  if (MEDIUM_FIELD_KEYS.has(field.key) || field.value.length > 28) return "col-span-full sm:col-span-2";
  return "col-span-1";
}

function isLongField(field: StructuredField) {
  return LONG_FIELD_KEYS.has(field.key) || field.value.length > 80 || (field.key === "scene_location" && field.value.length > 28);
}

function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function OrganizeResult({ initial, wao, onBack, onHome }: { initial: OrganizedCapture; wao: WaoClient; onBack: () => void; onHome: () => void }) {
  const [capture, setCapture] = useState(initial);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const isApproved = capture.status === "approved";

  async function approve() {
    try {
      setCapture(await wao.approve(capture));
      setMessage("已确认。该整理结果现在可以导出。");
    } catch {
      setMessage("确认失败，请稍后重试。");
    }
  }

  async function reject() {
    if (!reason.trim()) return setMessage("请填写退回原因，方便重新整理。");
    try {
      setCapture(await wao.reject(capture, reason.trim()));
      setMessage("已退回；结果不会提交或导出。");
    } catch {
      setMessage("退回失败，请稍后重试。");
    }
  }

  function setItemFieldValue(itemId: string, key: string, value: string) {
    setCapture((current) => ({
      ...current,
      items: current.items.map((item) => item.id !== itemId ? item : {
        ...item,
        fields: item.fields.map((field) => field.key === key ? { ...field, value, confidence: "high" } : field),
      }),
    }));
  }

  function setMetaFieldValue(key: string, value: string) {
    setCapture((current) => ({
      ...current,
      metaFields: current.metaFields.map((field) => field.key === key ? { ...field, value, confidence: "high" } : field),
    }));
  }

  function renderFieldControl(field: StructuredField, label: string, setValue: (value: string) => void) {
    const disabled = capture.status !== "pending_hitl";
    const controlClassName = "w-full rounded-lg border border-[#c7d7d3] bg-white p-2 text-base outline-none focus:border-teal-700 disabled:cursor-not-allowed disabled:bg-[#f4f8f7]";

    if (field.options) {
      return <select aria-label={label} value={field.value} onChange={(event) => setValue(event.target.value)} disabled={disabled} className={controlClassName}>
        <option value="待确认">待确认</option>
        {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>;
    }

    return isLongField(field)
      ? <textarea aria-label={label} value={field.value} onChange={(event) => setValue(event.target.value)} disabled={disabled} rows={3} className={`${controlClassName} resize-y`} />
      : <input aria-label={label} value={field.value} onChange={(event) => setValue(event.target.value)} disabled={disabled} className={controlClassName} />;
  }

  function exportJson() {
    if (!isApproved) return;
    download(`structcapture-${capture.id}.json`, JSON.stringify(capture, null, 2), "application/json");
  }

  function exportCsv() {
    if (!isApproved) return;
    const quote = (value: string) => `"${value.replaceAll("\"", "\"\"")}"`;
    const rows = [
      "项目,字段,值,置信度",
      ...capture.metaFields.map((field) => ["会话", field.label, field.value, field.confidence].map(quote).join(",")),
      ...capture.items.flatMap((item, index) => item.fields.map((field) => [`项目 ${index + 1}`, field.label, field.value, field.confidence].map(quote).join(","))),
    ];
    download(`structcapture-${capture.id}.csv`, `\uFEFF${rows.join("\n")}`, "text/csv;charset=utf-8");
  }

  return (
    <main className="mx-auto min-h-screen max-w-lg px-5 py-6">
      <header className="mb-6 flex items-center justify-between">
        <div><p className="text-sm text-[#607272]">Capture BFF 整理结果</p><h1 className="text-xl font-bold">等待人工确认</h1></div>
        <span className={`rounded-full px-3 py-1 text-sm font-semibold ${isApproved ? "bg-[#d7f1ee] text-teal-800" : "bg-amber-100 text-amber-800"}`}>{isApproved ? "已确认" : capture.status === "rejected" ? "已退回" : "待 HITL"}</span>
      </header>
      <section className="rounded-2xl border border-[#d9e6e3] bg-white p-5 shadow-sm">
        <h2 className="font-bold">本次整理</h2>
        <p className="mt-1 text-sm text-[#607272]">会话信息与摘要</p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">{capture.metaFields.map((field) => <label key={field.key} className={fieldLayout(field)}><span className="mb-1 block text-sm text-[#607272]">{field.label}</span>{renderFieldControl(field, field.label, (value) => setMetaFieldValue(field.key, value))}</label>)}</div>
      </section>
      <section className="mt-6">
        <div className="mb-3 flex items-baseline justify-between"><h2 className="font-bold">整理项目</h2><span className="text-sm text-[#607272]">{capture.items.length} 项</span></div>
        <p className="mb-3 text-sm text-[#607272]">每件可辨识物品或实验对象独立成卡；确认前可逐项修正全部字段。</p>
        <div className="space-y-4">{capture.items.map((item, itemIndex) => {
          const linkedShots = item.galleryShotIds.map((id) => capture.gallery.find((shot) => shot.id === id)).filter((shot): shot is Shot => Boolean(shot));
          return <article key={item.id} className="overflow-hidden rounded-2xl border border-[#d9e6e3] bg-white shadow-sm">
            <div className="flex items-center justify-between bg-[#e7f5f2] px-5 py-3"><h3 className="font-bold text-teal-950">项目 {itemIndex + 1}</h3><span className="text-xs text-teal-800">{linkedShots.length ? `关联 ${linkedShots.length} 张照片` : "无关联照片"}</span></div>
            <div className="grid grid-cols-2 gap-3 px-5 py-4 sm:grid-cols-3">{item.fields.map((field) => <label key={field.key} className={fieldLayout(field)}><span className="mb-1 block text-sm text-[#607272]">{field.label} <span className="ml-1 text-xs">{field.confidence === "high" ? "高置信" : field.confidence === "medium" ? "待确认" : "低置信"}</span></span>{renderFieldControl(field, `${itemIndex + 1} ${field.label}`, (value) => setItemFieldValue(item.id, field.key, value))}</label>)}</div>
            {linkedShots.length > 0 && <div className="grid grid-cols-3 gap-2 border-t border-[#e6efed] p-3">{linkedShots.map((shot, index) => <div key={shot.id} className="overflow-hidden rounded-lg bg-[#d7f1ee]">{shot.imageUrl ? <img src={shot.imageUrl} alt={shot.caption || `项目 ${itemIndex + 1} 的关联照片 ${index + 1}`} className="aspect-square w-full object-cover" /> : <p className="aspect-square p-2 text-xs text-teal-900">{shot.caption || `照片 ${index + 1}`}</p>}</div>)}</div>}
          </article>;
        })}</div>
      </section>
      <section className="mt-6">
        <div className="mb-3 flex items-baseline justify-between"><h2 className="font-bold">定向照片</h2><span className="text-sm text-[#607272]">{capture.gallery.length} 条记录</span></div>
        {capture.gallery.length === 0 ? <p className="rounded-xl bg-white p-4 text-sm text-[#607272]">本次没有拍摄照片，确认前请返回补充。</p> : <div className="grid grid-cols-2 gap-3">{capture.gallery.map((shot, index) => <article key={shot.id} className="overflow-hidden rounded-xl border border-[#d9e6e3] bg-white"><div className="relative grid aspect-square place-items-center bg-[#d7f1ee] text-teal-800">{shot.imageUrl ? <img src={shot.imageUrl} alt={shot.caption || `第 ${index + 1} 张照片`} className="size-full object-cover" /> : <span className="text-2xl font-bold">{index + 1}</span>}<span className="absolute left-2 top-2 grid size-6 place-items-center rounded-full bg-[#102a2a] text-xs font-bold text-white">{index + 1}</span></div><div className="space-y-1 p-3"><p className="text-sm font-medium">{shot.caption || "未填写说明"}</p>{shot.direction && <p className="text-xs text-[#607272]">{shot.direction}</p>}</div></article>)}</div>}
      </section>
      {capture.status === "pending_hitl" && <section className="mt-6 rounded-2xl bg-[#fff7e8] p-5"><h2 className="font-bold text-amber-950">人工确认（HITL）</h2><p className="mt-1 text-sm text-amber-900">未确认的整理结果不会提交，也不能导出。</p><div className="mt-4 grid grid-cols-2 gap-3"><button onClick={approve} className="flex items-center justify-center gap-2 rounded-xl bg-teal-800 px-4 py-3 font-semibold text-white"><Check size={18} />确认并提交</button><button onClick={reject} className="flex items-center justify-center gap-2 rounded-xl border border-amber-800 px-4 py-3 font-semibold text-amber-900"><X size={18} />退回</button></div><input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="退回原因（退回时必填）" className="mt-3 w-full rounded-xl border border-amber-200 bg-white p-3 text-sm outline-none focus:border-amber-700" /></section>}
      {isApproved && <section className="mt-6 rounded-2xl bg-[#e7f5f2] p-5"><h2 className="font-bold text-teal-950">导出已确认记录</h2><div className="mt-3 grid grid-cols-2 gap-3"><button onClick={exportJson} className="flex items-center justify-center gap-2 rounded-xl bg-teal-800 px-4 py-3 font-semibold text-white"><Download size={18} />JSON</button><button onClick={exportCsv} className="flex items-center justify-center gap-2 rounded-xl border border-teal-800 px-4 py-3 font-semibold text-teal-900"><Download size={18} />CSV</button></div></section>}
      {message && <p role="status" className="mt-4 rounded-xl bg-[#e7f5f2] p-3 text-sm text-teal-900">{message}</p>}
      <button onClick={onBack} className="mt-7 flex w-full items-center justify-center gap-2 rounded-xl border border-[#102a2a] px-4 py-3 font-semibold text-[#102a2a]"><RotateCcw size={18} />返回继续拍录</button>
      <button onClick={onHome} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-teal-800 px-4 py-3 font-semibold text-teal-800"><RotateCcw size={18} />回首页 / 换模板</button>
      {capture.status === "pending_hitl" && <p className="mt-3 flex items-center justify-center gap-1 text-xs text-[#607272]"><Send size={13} />由 Capture BFF 本地整理，可选使用模型网关补充字段</p>}
    </main>
  );
}
