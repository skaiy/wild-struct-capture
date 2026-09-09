"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, CheckCircle2, ChevronRight, ClipboardList, House, Mic, Sparkles } from "lucide-react";
import { schemas, getSchema } from "@/lib/schemas";
import { LocalStorageProvider } from "@/lib/storage";
import type { CaptureSession, OrganizedCapture, SchemaId, Shot } from "@/lib/types";
import { createWaoClient } from "@/lib/wao-client";
import { OrganizeResult } from "@/components/organize-result";

const makeId = () => crypto.randomUUID();
const MAX_IMAGE_DATA_URL_LENGTH = 900_000;
const MAX_SESSION_IMAGE_DATA_URL_LENGTH = 3_000_000;

type SpeechRecognitionResultEvent = Event & {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
};

type SpeechRecognitionErrorEvent = Event & { error: string };

interface BrowserSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

async function compressImage(file: File): Promise<string> {
  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("图片无法读取"));
      element.src = sourceUrl;
    });
    const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.78));
    if (!blob) throw new Error("图片压缩失败");
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("图片读取失败"));
      reader.readAsDataURL(blob);
    });
    if (dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) throw new Error("图片压缩后仍过大，请选择更小的照片");
    return dataUrl;
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

export function CaptureApp() {
  const [session, setSession] = useState<CaptureSession | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [caption, setCaption] = useState("");
  const [direction, setDirection] = useState("");
  const [message, setMessage] = useState("");
  const [organized, setOrganized] = useState<OrganizedCapture | null>(null);
  const [isOrganizing, setIsOrganizing] = useState(false);
  const [organizeError, setOrganizeError] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [transcriptionMessage, setTranscriptionMessage] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const storage = useMemo(() => new LocalStorageProvider(), []);
  const wao = useMemo(() => createWaoClient(), []);
  const schema = session ? getSchema(session.schemaId) : undefined;

  useEffect(() => {
    navigator.serviceWorker?.register("/sw.js").catch(() => undefined);
  }, []);

  useEffect(() => () => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    recognition.onend = null;
    recognition.abort();
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
    setOrganizeError("");
    setTranscriptionMessage("");
  }

  async function goHome() {
    if (session) await storage.remove(session.id);
    setSession(null);
    setShots([]);
    setCaption("");
    setDirection("");
    setOrganized(null);
    setMessage("");
    setOrganizeError("");
    setTranscriptionMessage("");
  }

  async function addShot(file?: File) {
    if (!session || (!caption.trim() && !direction.trim())) {
      setMessage("请至少写下这张照片的说明或拍摄指引。");
      return;
    }
    let imageUrl: string | undefined;
    try {
      imageUrl = file ? await compressImage(file) : undefined;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "图片处理失败，请重试。");
      return;
    }
    // Keep request JSON below Vercel Hobby's body limit; photos use data URLs
    // only for this POC until object storage is introduced.
    if (imageUrl && shots.reduce((total, shot) => total + (shot.imageUrl?.length ?? 0), 0) + imageUrl.length > MAX_SESSION_IMAGE_DATA_URL_LENGTH) {
      setMessage("本次拍录的照片已接近上传上限，请先整理或减少照片。");
      return;
    }
    const shot: Shot = {
      id: makeId(), sessionId: session.id, caption: caption.trim(), direction: direction.trim(),
      createdAt: new Date().toISOString(), imageUrl,
    };
    await storage.saveShot(session.id, shot);
    setShots((current) => [...current, shot]);
    setCaption("");
    const nextPrompt = schema?.prompts[shots.length + 1];
    setDirection(nextPrompt ?? "");
    setMessage(nextPrompt
      ? `${file ? "照片和说明" : "说明"}已加入会话。下一步：${nextPrompt}`
      : `${file ? "照片和说明" : "说明"}已加入会话。已完成拍摄指引；如有需要，可继续补充照片或说明。`);
    wao.uploadShot(session.id, { caption: shot.caption, direction: shot.direction, imageUrl: shot.imageUrl }).catch(() => undefined);
  }

  async function organize() {
    if (!session || isOrganizing) return;
    setOrganizeError("");
    setIsOrganizing(true);
    try {
      const result = await wao.organize(session, shots);
      setOrganized(result);
    } catch {
      setOrganizeError("整理请求没有完成，请检查网络后重试。已拍录的内容仍保存在此设备。");
    } finally {
      setIsOrganizing(false);
    }
  }

  function toggleTranscription() {
    if (isRecording) {
      recognitionRef.current?.stop();
      return;
    }
    const speechWindow = window as typeof window & {
      SpeechRecognition?: BrowserSpeechRecognitionConstructor;
      webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
    };
    const SpeechRecognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setTranscriptionMessage("当前浏览器不支持录音转文字；你可以使用系统键盘的语音输入。");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "zh-CN";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .flatMap((result) => Array.from(result))
        .map((alternative) => alternative.transcript)
        .join("")
        .trim();
      if (transcript) setCaption((current) => `${current}${transcript}`);
    };
    recognition.onerror = (event) => {
      setTranscriptionMessage(
        event.error === "not-allowed" || event.error === "service-not-allowed"
          ? "未获得麦克风权限。请在浏览器设置中允许麦克风后重试。"
          : event.error === "no-speech"
            ? "没有识别到语音，请再试一次。"
            : "录音转文字暂时不可用，请改用键盘输入。",
      );
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setIsRecording(false);
    };
    recognitionRef.current = recognition;
    setTranscriptionMessage("");
    setIsRecording(true);
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setIsRecording(false);
      setTranscriptionMessage("无法启动录音，请检查麦克风权限后重试。");
    }
  }

  if (organized) return <OrganizeResult initial={organized} wao={wao} onBack={() => setOrganized(null)} onHome={goHome} />;

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
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-[#d7f1ee] px-3 py-1 text-sm font-semibold text-teal-800">{shots.length} 张记录</span>
          <button onClick={goHome} className="flex items-center gap-1 rounded-lg border border-[#c7d7d3] px-2 py-1 text-sm font-semibold text-teal-800"><House size={15} />回首页 / 换模板</button>
        </div>
      </header>
      <section className="rounded-2xl bg-teal-800 p-5 text-white">
        <div className="flex items-center gap-2 text-sm text-teal-100"><Sparkles size={16} /> 当前拍摄指引</div>
        <p className="mt-2 text-lg font-semibold">{direction || "写下你想拍什么"}</p>
      </section>
      <section className="mt-5 rounded-2xl border border-[#d9e6e3] bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <label className="text-sm font-semibold" htmlFor="shot-caption">这张照片说明什么？</label>
          <button type="button" onClick={toggleTranscription} aria-pressed={isRecording} className="flex shrink-0 items-center gap-1 rounded-lg border border-teal-800 px-2 py-1 text-xs font-semibold text-teal-800 disabled:cursor-not-allowed disabled:opacity-60"><Mic size={15} />{isRecording ? "停止录音" : "录音转文字"}</button>
        </div>
        <textarea id="shot-caption" value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="例如：左侧缓冲区已放置警示锥…" className="mt-2 min-h-24 w-full resize-none rounded-xl border border-[#c7d7d3] p-3 outline-none focus:border-teal-700" />
        {transcriptionMessage && <p role="status" className="mt-2 text-sm text-[#607272]">{transcriptionMessage}</p>}
        <label className="mt-4 block text-sm font-semibold">拍摄指引（可修改）</label>
        <input value={direction} onChange={(event) => setDirection(event.target.value)} className="mt-2 w-full rounded-xl border border-[#c7d7d3] p-3 outline-none focus:border-teal-700" />
        <input ref={fileRef} onChange={async (event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; await addShot(file); }} accept="image/*" capture="environment" type="file" className="hidden" />
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button onClick={() => fileRef.current?.click()} className="flex items-center justify-center gap-2 rounded-xl bg-teal-800 px-4 py-3 font-semibold text-white"><Camera size={18} />拍照</button>
          <button onClick={() => addShot()} className="rounded-xl border border-teal-800 px-4 py-3 font-semibold text-teal-800">仅记录文字</button>
        </div>
      </section>
      {message && <p role="status" className="mt-4 rounded-xl bg-[#e7f5f2] p-3 text-sm text-teal-900">{message}</p>}
      {shots.length > 0 && <section className="mt-6"><h2 className="mb-3 font-bold">本次照片</h2><div className="space-y-2">{shots.map((shot, index) => <div key={shot.id} className="flex items-center gap-3 rounded-xl border border-[#d9e6e3] bg-white p-3">{shot.imageUrl ? <img src={shot.imageUrl} alt={shot.caption || "已拍摄照片"} className="size-12 rounded-lg object-cover" /> : <div className="grid size-12 place-items-center rounded-lg bg-[#d7f1ee] text-teal-800">{index + 1}</div>}<div className="min-w-0"><p className="truncate font-medium">{shot.caption || "未填写说明"}</p><p className="truncate text-sm text-[#607272]">{shot.direction}</p></div></div>)}</div></section>}
      <div className="mt-8">
        <button onClick={organize} disabled={isOrganizing} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#102a2a] px-4 py-3 font-semibold text-white disabled:cursor-wait disabled:opacity-70"><CheckCircle2 size={18} />{isOrganizing ? "正在整理…" : "完成并提交整理"}</button>
        {isOrganizing && <p role="status" aria-live="polite" className="mt-2 text-center text-sm text-[#607272]">正在整理…请勿关闭此页面。</p>}
        {organizeError && <p role="alert" className="mt-2 rounded-xl bg-[#fff1f1] p-3 text-sm text-[#9b1c1c]">{organizeError}</p>}
      </div>
    </main>
  );
}
