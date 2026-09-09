"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Check, ChevronRight, Download, FileText, ImagePlus, LoaderCircle, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { modeCopy, type CaptureMode, type CapturePhoto, type OrganizeResult } from "@/lib/schemas";

type Step = "capture" | "review";

export default function Home() {
  const [mode, setMode] = useState<CaptureMode>("crash-test");
  const [step, setStep] = useState<Step>("capture");
  const [photos, setPhotos] = useState<CapturePhoto[]>([]);
  const [note, setNote] = useState("");
  const [result, setResult] = useState<OrganizeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const camera = useRef<HTMLInputElement>(null);
  const copy = modeCopy[mode];

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);

  const photoCount = useMemo(() => `${photos.length} 张已记录`, [photos.length]);

  async function addPhotos(files: FileList | null) {
    if (!files) return;
    const additions = await Promise.all([...files].map(async (file) => ({
      id: crypto.randomUUID(),
      name: file.name || `photo-${Date.now()}.jpg`,
      dataUrl: await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      }),
      note: note || undefined,
    })));
    setPhotos((current) => [...current, ...additions]);
    setNote("");
  }

  async function organize() {
    if (!photos.length) return;
    setLoading(true);
    try {
      const response = await fetch("/api/organize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, prompt: note, photos: photos.map(({ id, name, note: itemNote }) => ({ id, name, note: itemNote })) }),
      });
      if (!response.ok) throw new Error("organize failed");
      setResult(await response.json());
      setStep("review");
    } finally {
      setLoading(false);
    }
  }

  function exportJson() {
    if (!result) return;
    const blob = new Blob([JSON.stringify({ mode, photos: photos.map(({ dataUrl, ...photo }) => photo), result, exportedAt: new Date().toISOString() }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `wild-structcapture-${mode}-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function reset() {
    setPhotos([]);
    setResult(null);
    setStep("capture");
  }

  return (
    <main className="mx-auto min-h-dvh max-w-5xl px-4 py-5 sm:px-8 sm:py-10">
      <header className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-[#142019] text-[#d8ff5e]"><Sparkles size={20} /></div>
          <div><p className="text-xs font-bold tracking-[0.18em] text-[#66806d]">WILD / STRUCTCAPTURE</p><h1 className="text-xl font-black tracking-tight">结构化拍录</h1></div>
        </div>
        <span className="rounded-full border border-[#dbe2d8] bg-white px-3 py-1 text-xs font-semibold text-[#47604e]">PWA · 本地优先</span>
      </header>

      <div className="mb-7 grid grid-cols-2 gap-2 rounded-2xl border border-[#dbe2d8] bg-white p-1.5 sm:max-w-md">
        {(["crash-test", "home-inventory"] as CaptureMode[]).map((value) => (
          <button key={value} onClick={() => { setMode(value); reset(); }} className={`rounded-xl px-3 py-2.5 text-sm font-bold transition ${mode === value ? "bg-[#142019] text-[#d8ff5e]" : "text-[#5a7060] hover:bg-[#f2f5f0]"}`}>
            {value === "crash-test" ? "碰撞试验" : "家庭盘点"}
          </button>
        ))}
      </div>

      <div className="mb-8 flex items-center gap-2 text-sm font-semibold">
        <span className={`grid size-7 place-items-center rounded-full ${step === "capture" ? "bg-[#142019] text-[#d8ff5e]" : "bg-[#d8ff5e]"}`}>{step === "review" ? <Check size={15} /> : "1"}</span>
        <span>拍录</span><ChevronRight size={15} className="text-[#9aaca0]" />
        <span className={`grid size-7 place-items-center rounded-full ${step === "review" ? "bg-[#142019] text-[#d8ff5e]" : "bg-[#e5ebe3] text-[#66806d]"}`}>2</span><span>人工复核</span>
      </div>

      {step === "capture" ? (
        <section className="grid gap-5 lg:grid-cols-[1.2fr_.8fr]">
          <div className="rounded-3xl bg-[#142019] p-6 text-white sm:p-8">
            <p className="mb-2 text-sm font-bold text-[#d8ff5e]">当前模板</p>
            <h2 className="text-3xl font-black tracking-tight">{copy.name}</h2>
            <p className="mt-3 max-w-xl leading-7 text-[#c4d0c6]">{copy.subtitle}</p>
            <div className="mt-8 rounded-2xl border border-[#38503e] bg-[#1d2b22] p-4">
              <p className="text-xs font-bold tracking-wider text-[#a6bea9]">CAPTURE PROMPT</p>
              <p className="mt-2 text-sm leading-6">{copy.prompt}</p>
            </div>
            <label className="mt-5 block text-sm font-bold text-[#d8ff5e]" htmlFor="capture-note">本轮补充说明（可选）</label>
            <textarea id="capture-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="例如：车辆左前传感器固定螺栓已锁紧" className="mt-2 min-h-24 w-full resize-none rounded-xl border border-[#47604e] bg-[#142019] p-3 text-sm outline-none placeholder:text-[#829487] focus:border-[#d8ff5e]" />
            <input ref={camera} className="hidden" type="file" accept="image/*" capture="environment" multiple onChange={(event) => addPhotos(event.target.files)} />
            <button onClick={() => camera.current?.click()} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#d8ff5e] px-4 py-3.5 font-black text-[#142019] hover:bg-[#e5ff91]"><Camera size={19} /> 拍照或添加照片</button>
          </div>

          <div className="rounded-3xl border border-[#dbe2d8] bg-white p-6">
            <div className="flex items-center justify-between"><h2 className="font-black">本轮照片</h2><span className="text-sm text-[#66806d]">{photoCount}</span></div>
            {photos.length ? <div className="mt-5 grid grid-cols-2 gap-3">{photos.map((photo) => <div key={photo.id} className="group relative overflow-hidden rounded-xl bg-[#e8ece7]"><img src={photo.dataUrl} alt={photo.name} className="aspect-square w-full object-cover" /><button aria-label={`删除 ${photo.name}`} onClick={() => setPhotos((all) => all.filter((item) => item.id !== photo.id))} className="absolute right-2 top-2 grid size-8 place-items-center rounded-full bg-black/60 text-white opacity-100 sm:opacity-0 sm:group-hover:opacity-100"><Trash2 size={15} /></button><p className="truncate p-2 text-xs text-[#526459]">{photo.name}</p></div>)}</div> : <div className="mt-5 grid min-h-56 place-items-center rounded-2xl border-2 border-dashed border-[#dbe2d8] p-6 text-center text-[#78907d]"><div><ImagePlus className="mx-auto mb-3" size={28} /><p className="text-sm font-semibold">从第一张照片开始</p><p className="mt-1 text-xs">可连续添加，AI 会按轮次组织</p></div></div>}
            <button disabled={!photos.length || loading} onClick={organize} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-[#142019] px-4 py-3.5 font-black text-white disabled:cursor-not-allowed disabled:opacity-40">{loading ? <LoaderCircle className="animate-spin" size={18} /> : <Sparkles size={18} />}{loading ? "正在组织…" : "组织并进入复核"}</button>
          </div>
        </section>
      ) : result && (
        <section className="grid gap-5 lg:grid-cols-[.75fr_1.25fr]">
          <aside className="rounded-3xl bg-[#142019] p-6 text-white"><p className="text-sm font-bold text-[#d8ff5e]">组织摘要</p><p className="mt-3 leading-7 text-[#d7e1d8]">{result.summary}</p>{result.followUp && <div className="mt-5 rounded-xl border border-[#405541] p-4 text-sm leading-6 text-[#d8ff5e]">建议：{result.followUp}</div>}<p className="mt-6 text-xs text-[#91a394]">来源：{result.provider === "wao" ? "Wild AgentOS" : "本地 Mock VL（WAO 不可用）"}</p><button onClick={() => setStep("capture")} className="mt-7 flex items-center gap-2 text-sm font-bold text-[#d8ff5e]"><Camera size={16} /> 继续补拍</button></aside>
          <div className="rounded-3xl border border-[#dbe2d8] bg-white p-6"><div className="flex items-center justify-between"><div><p className="text-sm font-bold text-[#66806d]">HITL REVIEW</p><h2 className="text-2xl font-black">人工复核清单</h2></div><FileText className="text-[#66806d]" /></div><div className="mt-5 divide-y divide-[#e6ebe4]">{result.items.map((item) => <div key={item.id} className="py-4 first:pt-0"><div className="flex items-start justify-between gap-3"><div><p className="font-bold">{item.label}</p><input aria-label={item.label} defaultValue={item.value} className="mt-1 w-full border-b border-[#dbe2d8] bg-transparent py-1 text-sm text-[#526459] outline-none focus:border-[#142019]" /></div><span className={`rounded-full px-2 py-1 text-xs font-bold ${item.confidence === "high" ? "bg-[#dcfce7] text-[#18733b]" : item.confidence === "medium" ? "bg-[#fff3ce] text-[#8a5c00]" : "bg-[#fee2e2] text-[#a52d2d]"}`}>{item.confidence === "high" ? "高" : item.confidence === "medium" ? "中" : "低"} 置信</span></div>{item.sourcePhoto && <p className="mt-2 text-xs text-[#79907e]">关联：{item.sourcePhoto}</p>}</div>)}</div><div className="mt-6 flex flex-col gap-3 sm:flex-row"><button onClick={exportJson} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#d8ff5e] px-4 py-3.5 font-black text-[#142019]"><Download size={18} /> 导出 JSON</button><button onClick={reset} className="flex items-center justify-center gap-2 rounded-xl border border-[#dbe2d8] px-4 py-3.5 font-bold"><RotateCcw size={18} /> 新建拍录</button></div></div>
        </section>
      )}
    </main>
  );
}
