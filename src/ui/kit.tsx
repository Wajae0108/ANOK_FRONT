// 여러 화면(CompanyAdmin, Projects 등)이 공유하는 데이터 로딩 훅과 기본 UI 프리미티브.
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { errorText } from "../api/errors";

export const COLORS = ["#4f6ef7", "#0891b2", "#059669", "#dc2626", "#d97706", "#7c3aed", "#be185d", "#0d9488", "#ea580c", "#6366f1"];
export const colorFor = (seed: string) => { let h = 0; for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; };

export const inputCls = "w-full border border-slate-200 rounded-xl px-3 py-2.5 text-[13px] text-slate-700 outline-none focus:border-indigo-300 transition-colors bg-white placeholder-slate-300";
export const primaryBtn = "px-4 py-2.5 bg-indigo-500 hover:bg-indigo-600 text-white text-[13px] font-bold rounded-xl transition-colors disabled:opacity-40";
export const ghostBtn = "px-4 py-2.5 border border-slate-200 text-slate-500 text-[13px] font-semibold rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-40";
export const labelCls = "text-[10px] font-bold text-slate-400 uppercase tracking-wide block mb-1";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`bg-white border border-slate-100 rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.05)] ${className}`}>{children}</div>;
}
export function Section({ children }: { children: ReactNode }) {
  return <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.12em] mb-2">{children}</p>;
}
export function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return <div><label className={labelCls}>{label}</label>{children}{error && <p className="text-[11px] text-rose-500 mt-1">{error}</p>}</div>;
}
export function Spinner({ text = "불러오는 중..." }: { text?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-[13px] text-slate-500">
      <span className="w-5 h-5 border-2 border-slate-200 border-t-indigo-500 rounded-full animate-spin" />{text}
    </div>
  );
}
export function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      <p className="text-[13px] font-semibold text-slate-700">불러오지 못했습니다</p>
      <p className="text-[12px] text-slate-400">{message}</p>
      <button onClick={onRetry} className={ghostBtn}>다시 시도</button>
    </div>
  );
}
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[200] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <p className="text-[15px] font-bold text-slate-900">{title}</p>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="p-5 space-y-4">{children}</div>
      </div>
    </div>
  );
}
export function Avatar({ name, seed, imageUrl, size = 32 }: { name: string; seed: string; imageUrl?: string | null; size?: number }) {
  const style = { width: size, height: size };
  if (imageUrl) return <img src={imageUrl} alt={name} style={style} className="rounded-full object-cover shrink-0 ring-2 ring-white" />;
  return <div style={{ ...style, backgroundColor: colorFor(seed), fontSize: size * 0.38 }} className="rounded-full flex items-center justify-center font-bold text-white shrink-0 ring-2 ring-white">{name.charAt(0)}</div>;
}

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    fn().then(d => { if (alive) { setData(d); setLoading(false); } }).catch(e => { if (alive) { setError(errorText(e)); setLoading(false); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, setData, loading, error, reload: () => setTick(t => t + 1) };
}
