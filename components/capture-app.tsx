"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, CheckCircle2, ChevronRight, ClipboardList, Sparkles } from "lucide-react";
import { schemas, getSchema } from "@/lib/schemas";
import { LocalStorageProvider } from "@/lib/storage";
import type { CaptureSession, SchemaId, Shot } from "@/lib/types";
import { createWaoClient } from "@/lib/wao-client";

const makeId = () => crypto.randomUUID();

export function CaptureApp() {
  const [session, setSession] = useState<CaptureSession | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [caption, setCaption] = useState("");
  const [direction, setDirection] = useState("");
  const [message, setMessage] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const storage = useMemo(() => new LocalStorageProvider(), []);
  const wao = useMemo(() => createWaoClient(), []);
  const schema = session ? getSchema(session.schemaId) : undefined;

  useEffect(() => {
    navigator.serviceWorker?.register("/sw.js").catch(() => undefined);
  }, []);

  async function start(schemaId: SchemaId) {
    const remote = await wao.createSession(schemaId).catch(() => null);
    const local: CaptureSession = remote ?? { id: makeId(), schemaId, createdAt: new Date().toISOString(), shots: [] };
    await storage.create(local);
    setSession(local);
    setShots([]);
    setCaption("");
    setDirection(getSchema(schemaId)?.prompts[0] ?? "");
    setMessage("拍录会话已创建，数据先保存在此设备。");
  }

  async function addShot(file?: File) {
    if (!session || (!caption.trim() && !direction.trim())) {
      setMessage("请至少写下这张照片的说明或拍摄指引。");
      return;
    }
    const imageUrl = file ? URL.createObjectURL(file) : undefined;
    const shot: Shot = {
      id: makeId(), sessionId: session.id, caption: caption.trim(), direction: direction.trim(),
      createdAt: new Date().toISOString(), imageUrl,
    };
    await storage.saveShot(session.id, shot);
    setShots((current) => [...current, shot]);
    setCaption("");
    setDirection(schema?.prompts[Math.min(shots.length + 1, (schema?.prompts.length ?? 1) - 1)] ?? "");
    setMessage(file ? "照片和说明已加入会话。" : "已记录说明；可继续补拍照片。");
    wao.uploadShot(session.id, { caption: shot.caption, direction: shot.direction }).catch(() => undefined);
  }

  async function organize() {
    if (!session) return;
    const result = await wao.organize(session.id).catch(() => ({ status: "stubbed" as const }));
    setMessage(result.status === "queued" ? "已提交给 Wild AgentOS 整理。" : "整理入口已预留；开发模式下不会直接调用 VL。");
  }

  if (!session) {
    return (
      <main className="mx-auto min-h-screen max-w-lg px-5 py-10">
        <div className="mb-10 flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-2xl bg-teal-800 text-white"><Camera size={22} /></div>
          <div><p className="text-lg font-bold">Wild StructCapture</p><p className="text-sm text-[#607272]">结构化拍录 · 离线优先</p></div>
        </div>
        <section className="mb-8">
          <p className="mb-2 text-sm font-semibold text-teal-800">开始一次拍录</p>
          <h1 className="text-3xl font-bold tracking-tight">先拍下来，再慢慢整理。</h1>
          <p className="mt-3 leading-6 text-[#607272]">选择模板后，用照片加一句自然语言说明，完成可交接的现场记录。</p>
        </section>
        <div className="space-y-3">
          {schemas.map((item) => (
            <button key={item.id} onClick={() => start(item.id)} className="flex w-full items-center gap-4 rounded-2xl border border-[#d9e6e3] bg-white p-5 text-left shadow-sm transition hover:border-teal-700">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#d7f1ee] text-teal-800"><ClipboardList size={21} /></span>
              <span className="flex-1"><span className="block font-bold">{item.title}</span><span className="mt-1 block text-sm leading-5 text-[#607272]">{item.summary}</span></span>
              <ChevronRight className="text-teal-800" size={20} />
            </button>
          ))}
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-lg px-5 py-6">
      <header className="mb-6 flex items-center justify-between">
        <div><p className="text-sm text-[#607272]">拍录中</p><h1 className="text-xl font-bold">{schema?.title}</h1></div>
        <span className="rounded-full bg-[#d7f1ee] px-3 py-1 text-sm font-semibold text-teal-800">{shots.length} 张记录</span>
      </header>
      <section className="rounded-2xl bg-teal-800 p-5 text-white">
        <div className="flex items-center gap-2 text-sm text-teal-100"><Sparkles size={16} /> 当前拍摄指引</div>
        <p className="mt-2 text-lg font-semibold">{direction || "写下你想拍什么"}</p>
      </section>
      <section className="mt-5 rounded-2xl border border-[#d9e6e3] bg-white p-5 shadow-sm">
        <label className="text-sm font-semibold">这张照片说明什么？</label>
        <textarea value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="例如：左侧缓冲区已放置警示锥…" className="mt-2 min-h-24 w-full resize-none rounded-xl border border-[#c7d7d3] p-3 outline-none focus:border-teal-700" />
        <label className="mt-4 block text-sm font-semibold">拍摄指引（可修改）</label>
        <input value={direction} onChange={(event) => setDirection(event.target.value)} className="mt-2 w-full rounded-xl border border-[#c7d7d3] p-3 outline-none focus:border-teal-700" />
        <input ref={fileRef} onChange={(event) => addShot(event.target.files?.[0])} accept="image/*" capture="environment" type="file" className="hidden" />
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button onClick={() => fileRef.current?.click()} className="flex items-center justify-center gap-2 rounded-xl bg-teal-800 px-4 py-3 font-semibold text-white"><Camera size={18} />拍照</button>
          <button onClick={() => addShot()} className="rounded-xl border border-teal-800 px-4 py-3 font-semibold text-teal-800">仅记录文字</button>
        </div>
      </section>
      {message && <p role="status" className="mt-4 rounded-xl bg-[#e7f5f2] p-3 text-sm text-teal-900">{message}</p>}
      {shots.length > 0 && <section className="mt-6"><h2 className="mb-3 font-bold">本次照片</h2><div className="space-y-2">{shots.map((shot, index) => <div key={shot.id} className="flex items-center gap-3 rounded-xl border border-[#d9e6e3] bg-white p-3">{shot.imageUrl ? <img src={shot.imageUrl} alt={shot.caption || "已拍摄照片"} className="size-12 rounded-lg object-cover" /> : <div className="grid size-12 place-items-center rounded-lg bg-[#d7f1ee] text-teal-800">{index + 1}</div>}<div className="min-w-0"><p className="truncate font-medium">{shot.caption || "未填写说明"}</p><p className="truncate text-sm text-[#607272]">{shot.direction}</p></div></div>)}</div></section>}
      <button onClick={organize} className="mt-8 flex w-full items-center justify-center gap-2 rounded-xl bg-[#102a2a] px-4 py-3 font-semibold text-white"><CheckCircle2 size={18} />完成并提交整理</button>
    </main>
  );
}
