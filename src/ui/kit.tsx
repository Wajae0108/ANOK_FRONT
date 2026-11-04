// 여러 화면(CompanyAdmin, Projects 등)이 공유하는 데이터 로딩 훅과 기본 UI 프리미티브.
import { useEffect, useRef, useState } from "react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, KeyboardEvent as ReactKeyboardEvent, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
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
// Escape로 닫기: Modal·Drawer가 공유한다. 열려 있는 동안만 리스너를 건다.
// 중첩(Drawer 위의 Modal 등)이면 가장 나중에 열린 것만 닫는다.
const escapeStack: Array<() => void> = [];
function onDocKeyDown(e: KeyboardEvent) {
  if (e.key === "Escape" && !e.defaultPrevented) escapeStack[escapeStack.length - 1]?.();
}
export function useEscape(onEscape: () => void, active = true) {
  const ref = useRef(onEscape);
  ref.current = onEscape;
  useEffect(() => {
    if (!active) return;
    const entry = () => ref.current();
    if (escapeStack.length === 0) document.addEventListener("keydown", onDocKeyDown);
    escapeStack.push(entry);
    return () => {
      escapeStack.splice(escapeStack.indexOf(entry), 1);
      if (escapeStack.length === 0) document.removeEventListener("keydown", onDocKeyDown);
    };
  }, [active]);
}

const CLOSE_ICON = <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;

// compact: 사용자 업무용 모달 레이아웃 — 보조 설명(description)이 있는 헤더, 스크롤되는 본문, 하단 고정 footer(우측 정렬 버튼).
// 지정하지 않으면 기존 모달 모양 그대로다.
export function Modal({ title, onClose, children, compact = false, description, footer, width = "max-w-md" }: {
  title: string; onClose: () => void; children: ReactNode; compact?: boolean; description?: string; footer?: ReactNode; width?: string;
}) {
  useEscape(onClose);
  const closeBtn = (
    <button onClick={onClose} aria-label="닫기" className={`w-7 h-7 shrink-0 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-indigo-400 ${compact ? "rounded-md" : "rounded-xl"}`}>
      {CLOSE_ICON}
    </button>
  );
  if (compact) {
    return (
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[200] p-4">
        <div role="dialog" aria-modal="true" aria-label={title} className={`bg-white rounded-xl shadow-xl w-full ${width} max-h-[90vh] flex flex-col overflow-hidden`}>
          <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-slate-100">
            <div className="min-w-0">
              <p className="text-[16px] font-bold text-slate-900 leading-snug">{title}</p>
              {description && <p className="text-[12px] text-slate-500 mt-0.5">{description}</p>}
            </div>
            {closeBtn}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-4">{children}</div>
          {footer && <div className="flex items-center justify-end gap-2 px-6 py-3.5 border-t border-slate-100 bg-slate-50/60">{footer}</div>}
        </div>
      </div>
    );
  }
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[200] p-4">
      <div role="dialog" aria-modal="true" aria-label={title} className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <p className="text-[15px] font-bold text-slate-900">{title}</p>
          {closeBtn}
        </div>
        <div className="p-5 space-y-4">{children}</div>
      </div>
    </div>
  );
}

// ─── 공통 Button / Badge / Tabs / Input / Drawer (User Workspace 기준 스타일, Admin에서도 사용 가능) ───
type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-indigo-600 text-white hover:bg-indigo-700 border border-transparent",
  secondary: "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50",
  ghost: "bg-transparent text-slate-500 border border-transparent hover:bg-slate-100 hover:text-slate-800",
  danger: "bg-white text-rose-600 border border-rose-200 hover:bg-rose-50",
};
export function Button({ variant = "primary", size = "md", className = "", type = "button", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md" }) {
  const sz = size === "sm" ? "px-2.5 py-1.5 text-[12px]" : "px-4 py-2 text-[13px]";
  return <button type={type} {...rest} className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 ${sz} ${BUTTON_VARIANT[variant]} ${className}`} />;
}

export type BadgeTone = "neutral" | "indigo" | "emerald" | "amber" | "rose" | "violet";
const BADGE_TONE: Record<BadgeTone, string> = {
  neutral: "bg-slate-100 text-slate-600", indigo: "bg-indigo-50 text-indigo-700", emerald: "bg-emerald-50 text-emerald-700",
  amber: "bg-amber-50 text-amber-700", rose: "bg-rose-50 text-rose-600", violet: "bg-violet-50 text-violet-700",
};
export function Badge({ tone = "neutral", children, className = "" }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md whitespace-nowrap ${BADGE_TONE[tone]} ${className}`}>{children}</span>;
}

export function Tabs<T extends string>({ items, value, onChange, variant = "underline", label, className = "" }: {
  items: Array<{ value: T; label: string; count?: number }>; value: T; onChange: (v: T) => void;
  variant?: "underline" | "pill"; label?: string; className?: string;
}) {
  function onKey(e: ReactKeyboardEvent<HTMLButtonElement>, i: number) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const nextIndex = (i + (e.key === "ArrowRight" ? 1 : items.length - 1)) % items.length;
    onChange(items[nextIndex].value);
    e.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]')[nextIndex]?.focus();
  }
  return (
    <div role="tablist" aria-label={label} className={`flex ${variant === "underline" ? "gap-5 border-b border-slate-200 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" : "gap-1"} ${className}`}>
      {items.map((it, i) => {
        const active = it.value === value;
        const cls = variant === "underline"
          ? `-mb-px px-0.5 py-2.5 text-[13px] font-semibold border-b-2 ${active ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-400 hover:text-slate-700"}`
          : `px-3 py-1.5 rounded-lg text-[12px] font-semibold ${active ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100"}`;
        return (
          <button key={it.value} role="tab" aria-selected={active} tabIndex={active ? 0 : -1} onClick={() => onChange(it.value)} onKeyDown={e => onKey(e, i)}
            className={`shrink-0 transition-colors focus-visible:outline-2 focus-visible:outline-indigo-500 ${cls}`}>
            {it.label}{it.count != null && <span className={`ml-1.5 text-[11px] font-medium ${active ? "opacity-80" : "text-slate-400"}`}>{it.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export const fieldCls = "w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] text-slate-700 outline-none bg-white placeholder-slate-300 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-colors disabled:bg-slate-50 disabled:text-slate-400";
export function Input({ className = "", ...rest }: InputHTMLAttributes<HTMLInputElement>) { return <input {...rest} className={`${fieldCls} ${className}`} />; }
export function Textarea({ className = "", ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea {...rest} className={`${fieldCls} resize-none ${className}`} />; }
export function Select({ className = "", ...rest }: SelectHTMLAttributes<HTMLSelectElement>) { return <select {...rest} className={`${fieldCls} ${className}`} />; }

// 오른쪽 상세 패널. 부모 레이아웃(flex 행)에 도킹되어 목록과 함께 보이며, 닫기 버튼/Escape로 닫는다.
// 열릴 때 패널로 포커스를 옮기고 닫히면 이전에 포커스된 요소로 되돌린다.
export function Drawer({ title, onClose, children, width = 440 }: { title: string; onClose: () => void; children: ReactNode; width?: number }) {
  const ref = useRef<HTMLElement>(null);
  useEscape(onClose);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => { if (prev && document.contains(prev)) prev.focus(); };
  }, []);
  return (
    <aside ref={ref} tabIndex={-1} role="dialog" aria-modal="false" aria-label={title} style={{ width }}
      className="shrink-0 h-full flex flex-col bg-white border-l border-slate-200 outline-none shadow-[-8px_0_24px_-12px_rgba(15,23,42,0.12)]">
      <div className="shrink-0 flex items-center justify-between px-5 h-12 border-b border-slate-100">
        <p className="text-[12px] font-semibold text-slate-400">{title}</p>
        <button onClick={onClose} aria-label="패널 닫기" title="닫기 (Esc)" className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-indigo-500">{CLOSE_ICON}</button>
      </div>
      <div className="flex-1 overflow-y-auto">{children}</div>
    </aside>
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
