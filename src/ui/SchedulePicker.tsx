// 일정(날짜 + 시간) 선택: 브라우저 기본 date/time picker를 쓰지 않는 compact 팝오버 두 개.
// 값은 기존 datetime-local과 같은 로컬 시각 문자열("YYYY-MM-DDTHH:mm", 없으면 "")로 주고받는다 — 전송 형식·시간대 처리는 호출하는 쪽 그대로다.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";
import { fieldCls, useEscape } from "./kit";
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon, ClockIcon, XIcon } from "./icons";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const DEFAULT_TIME = "09:00";

const pad = (n: number) => String(n).padStart(2, "0");
const isoDate = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
function todayIso() { const t = new Date(); return isoDate(t.getFullYear(), t.getMonth(), t.getDate()); }
function parseIso(s: string) { const [y, m, d] = s.split("-").map(Number); return { y, m: m - 1, d }; }

function formatDate(iso: string) {
  const { y, m, d } = parseIso(iso);
  const wd = WEEKDAYS[new Date(y, m, d).getDay()];
  return `${y === new Date().getFullYear() ? "" : `${y}년 `}${m + 1}월 ${d}일 (${wd})`;
}

/** "14:10", "1410", "930", "9:5"를 HH:mm으로. 올바른 24시간 시각이 아니면 null. */
export function parseTimeInput(raw: string): string | null {
  const t = raw.trim();
  const m = /^(\d{1,2}):?(\d{2})$/.exec(t) ?? /^(\d{1,2}):(\d{1})$/.exec(t);
  if (!m) return null;
  const h = Number(m[1]); const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${pad(h)}:${pad(min)}`;
}

// ── 팝오버 ────────────────────────────────────────────────────────────────────
// 모달 본문은 스크롤 영역이라 안쪽에 두면 잘리므로 body에 포탈로 띄우고, 트리거 아래(공간이 모자라면 위)에 고정 위치로 놓는다.
function Popover({ anchorRef, onClose, width, label, children }: { anchorRef: RefObject<HTMLElement | null>; onClose: () => void; width: number; label: string; children: ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  useEscape(onClose);

  useLayoutEffect(() => {
    const update = () => {
      const a = anchorRef.current; const p = panelRef.current;
      if (!a) return;
      const r = a.getBoundingClientRect();
      const h = p?.offsetHeight ?? 320;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      const below = window.innerHeight - r.bottom;
      setPos(below < h + 14 && r.top > h + 14 ? { left, bottom: window.innerHeight - r.top + 6 } : { left, top: r.bottom + 6 });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => { window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [anchorRef, width]);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      onClose();
    };
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [anchorRef, onClose]);

  return createPortal(
    <div ref={panelRef} role="dialog" aria-label={label} style={{ width, ...(pos ?? { left: -9999, top: 0 }) }}
      className="fixed z-[300] bg-white border border-slate-200 rounded-lg shadow-[0_4px_16px_rgba(15,23,42,0.08)]">
      {children}
    </div>,
    document.body,
  );
}

// ── 달력 ─────────────────────────────────────────────────────────────────────
function Calendar({ selected, onPick }: { selected: string; onPick: (iso: string) => void }) {
  const today = todayIso();
  const start = parseIso(selected || today);
  const [view, setView] = useState({ y: start.y, m: start.m });
  const [focusIso, setFocusIso] = useState(selected || today);
  const gridRef = useRef<HTMLDivElement>(null);
  const shouldFocus = useRef(true);
  const monthPrefix = `${view.y}-${pad(view.m + 1)}-`;

  const first = new Date(view.y, view.m, 1).getDay();
  const days = new Date(view.y, view.m + 1, 0).getDate();
  const shiftMonth = (delta: number) => { const d = new Date(view.y, view.m + delta, 1); setView({ y: d.getFullYear(), m: d.getMonth() }); };

  // 처음 열릴 때와 키보드로 이동할 때 해당 날짜 버튼에 포커스를 둔다.
  useEffect(() => {
    if (!shouldFocus.current) return;
    shouldFocus.current = false;
    gridRef.current?.querySelector<HTMLElement>(`[data-iso="${focusIso}"]`)?.focus({ preventScroll: true });
  }, [focusIso, view]);

  function onKey(e: ReactKeyboardEvent) {
    const delta = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 } as Record<string, number>)[e.key];
    const month = e.key === "PageUp" ? -1 : e.key === "PageDown" ? 1 : 0;
    if (delta === undefined && !month) return;
    e.preventDefault();
    const { y, m, d } = parseIso(focusIso);
    const next = delta !== undefined ? new Date(y, m, d + delta) : new Date(y, m + month, Math.min(d, new Date(y, m + month + 1, 0).getDate()));
    shouldFocus.current = true;
    setFocusIso(isoDate(next.getFullYear(), next.getMonth(), next.getDate()));
    setView({ y: next.getFullYear(), m: next.getMonth() });
  }

  const navBtn = "w-8 h-8 flex items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-indigo-500";
  return (
    <div className="p-3">
      <div className="flex items-center justify-between mb-2">
        <button type="button" onClick={() => shiftMonth(-1)} aria-label="이전 달" className={navBtn}><ChevronLeftIcon /></button>
        <p className="text-[13px] font-semibold text-slate-900" aria-live="polite">{view.y}년 {view.m + 1}월</p>
        <button type="button" onClick={() => shiftMonth(1)} aria-label="다음 달" className={navBtn}><ChevronRightIcon /></button>
      </div>
      <div className="grid grid-cols-7 mb-1" aria-hidden>
        {WEEKDAYS.map(w => <span key={w} className="h-7 flex items-center justify-center text-[11px] text-slate-400">{w}</span>)}
      </div>
      <div ref={gridRef} role="grid" aria-label={`${view.y}년 ${view.m + 1}월`} onKeyDown={onKey} className="grid grid-cols-7 gap-y-0.5">
        {Array.from({ length: first }, (_, i) => <span key={`b${i}`} />)}
        {Array.from({ length: days }, (_, i) => {
          const iso = isoDate(view.y, view.m, i + 1);
          const isSel = iso === selected; const isToday = iso === today;
          return (
            <button key={iso} type="button" data-iso={iso} role="gridcell" aria-selected={isSel} aria-current={isToday ? "date" : undefined} tabIndex={iso === focusIso || (!focusIso.startsWith(monthPrefix) && i === 0) ? 0 : -1}
              onClick={() => onPick(iso)} onFocus={() => setFocusIso(iso)}
              className={`relative mx-auto w-9 h-9 flex items-center justify-center rounded-md text-[13px] tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-indigo-500 ${isSel ? "bg-indigo-50 text-indigo-700 font-semibold" : isToday ? "text-indigo-600 font-semibold hover:bg-slate-100" : "text-slate-700 hover:bg-slate-100"}`}>
              {i + 1}
              {isToday && <span aria-hidden className={`absolute bottom-1 w-1 h-1 rounded-full ${isSel ? "bg-indigo-600" : "bg-indigo-400"}`} />}
            </button>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-center">
        <button type="button" onClick={() => onPick(today)} className="px-2 py-1 rounded text-[12px] font-medium text-indigo-600 hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-indigo-500">오늘</button>
      </div>
    </div>
  );
}

// ── 시간 목록 ────────────────────────────────────────────────────────────────
const HALF_HOURS = Array.from({ length: 48 }, (_, i) => `${pad(Math.floor(i / 2))}:${i % 2 ? "30" : "00"}`);

function TimeList({ selected, onPick }: { selected: string; onPick: (hhmm: string) => void }) {
  const listRef = useRef<HTMLDivElement>(null);
  const [direct, setDirect] = useState("");
  const [invalid, setInvalid] = useState(false);
  // 30분 단위가 아닌 값(예: 14:10)이 이미 골라져 있으면 목록에 끼워 넣어 선택 상태가 보이게 한다.
  const slots = selected && !HALF_HOURS.includes(selected) ? [...HALF_HOURS, selected].sort() : HALF_HOURS;

  useLayoutEffect(() => {
    const list = listRef.current;
    const target = list?.querySelector<HTMLElement>(`[data-time="${selected || DEFAULT_TIME}"]`);
    if (list && target) list.scrollTop = target.offsetTop - list.clientHeight / 2 + target.clientHeight / 2;
  }, [selected]);

  function onListKey(e: ReactKeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-time]") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[Math.max(0, Math.min(items.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
  }
  function applyDirect() {
    const t = parseTimeInput(direct);
    if (!t) { setInvalid(true); return; }
    onPick(t);
  }

  return (
    <div>
      <p className="px-3 pt-2.5 pb-1 text-[11px] font-semibold text-slate-400">시간 선택</p>
      <div ref={listRef} role="listbox" aria-label="시간" onKeyDown={onListKey} className="max-h-52 overflow-y-auto px-1.5 pb-1">
        {slots.map(t => {
          const on = t === selected;
          return (
            <button key={t} type="button" role="option" aria-selected={on} data-time={t} onClick={() => onPick(t)}
              className={`w-full h-8 px-2.5 flex items-center rounded-md text-[13px] tabular-nums text-left transition-colors focus-visible:outline-2 focus-visible:outline-indigo-500 ${on ? "bg-indigo-50 text-indigo-700 font-semibold" : "text-slate-700 hover:bg-slate-100"}`}>{t}</button>
          );
        })}
      </div>
      <div className="border-t border-slate-100 p-2 flex items-center gap-1.5">
        <input value={direct} onChange={e => { setDirect(e.target.value); setInvalid(false); }} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); applyDirect(); } }}
          inputMode="numeric" maxLength={5} placeholder="직접 입력 (14:10)" aria-label="시간 직접 입력" aria-invalid={invalid}
          className={`min-w-0 flex-1 h-8 px-2 rounded-md border text-[12px] tabular-nums outline-none placeholder-slate-300 focus:ring-2 ${invalid ? "border-rose-300 focus:border-rose-400 focus:ring-rose-100" : "border-slate-200 focus:border-indigo-400 focus:ring-indigo-100"}`} />
        <button type="button" onClick={applyDirect} disabled={!direct.trim()} className="h-8 px-2 rounded-md text-[12px] font-medium text-indigo-600 hover:bg-indigo-50 disabled:text-slate-300 disabled:hover:bg-transparent focus-visible:outline-2 focus-visible:outline-indigo-500">적용</button>
      </div>
    </div>
  );
}

// ── 일정 선택(날짜 + 시간) ───────────────────────────────────────────────────
export default function SchedulePicker({ value, onChange, id }: { value: string; onChange: (v: string) => void; id?: string }) {
  const [open, setOpen] = useState<"date" | "time" | null>(null);
  const dateRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLDivElement>(null);
  const dateBtn = useRef<HTMLButtonElement>(null);
  const timeBtn = useRef<HTMLButtonElement>(null);

  const date = value.slice(0, 10);
  const time = value.slice(11, 16);
  const close = () => setOpen(null);
  const closeTo = (btn: RefObject<HTMLButtonElement | null>) => { setOpen(null); btn.current?.focus(); };

  // 날짜만 고르면 시간은 기본값(09:00), 시간만 먼저 고르면 날짜는 오늘로 채워 하나의 완전한 일시로 만든다.
  const pickDate = (iso: string) => { onChange(`${iso}T${time || DEFAULT_TIME}`); closeTo(dateBtn); };
  const pickTime = (hhmm: string) => { onChange(`${date || todayIso()}T${hhmm}`); closeTo(timeBtn); };

  const trigger = (isOpen: boolean) => `${fieldCls} flex items-center gap-2 text-left cursor-pointer ${isOpen ? "!border-indigo-400 !ring-2 !ring-indigo-100" : ""}`;

  return (
    <div className="flex flex-col sm:flex-row gap-2">
      <div ref={dateRef} className="relative sm:flex-[3]">
        <button ref={dateBtn} id={id} type="button" aria-label={date ? `시작 날짜: ${formatDate(date)}` : "시작 날짜 선택"} aria-haspopup="dialog" aria-expanded={open === "date"} onClick={() => setOpen(o => (o === "date" ? null : "date"))} className={`${trigger(open === "date")} ${date ? "pr-8" : ""}`}>
          <span className="text-slate-400"><CalendarIcon /></span>
          <span className={`truncate ${date ? "" : "text-slate-300"}`}>{date ? formatDate(date) : "날짜 선택"}</span>
        </button>
        {date && (
          <button type="button" onClick={() => { onChange(""); close(); }} aria-label="일정 지우기"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded text-slate-300 hover:text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-indigo-500"><XIcon /></button>
        )}
        {open === "date" && <Popover anchorRef={dateRef} onClose={close} width={308} label="날짜 선택"><Calendar selected={date} onPick={pickDate} /></Popover>}
      </div>
      <div ref={timeRef} className="relative sm:flex-[2]">
        <button ref={timeBtn} type="button" aria-label={time ? `시작 시간: ${time}` : "시작 시간 선택"} aria-haspopup="dialog" aria-expanded={open === "time"} onClick={() => setOpen(o => (o === "time" ? null : "time"))} className={trigger(open === "time")}>
          <span className="text-slate-400"><ClockIcon /></span>
          <span className={`tabular-nums ${time ? "" : "text-slate-300"}`}>{time || "시간 선택"}</span>
        </button>
        {open === "time" && <Popover anchorRef={timeRef} onClose={close} width={Math.max(timeRef.current?.offsetWidth ?? 0, 188)} label="시간 선택"><TimeList selected={time} onPick={pickTime} /></Popover>}
      </div>
    </div>
  );
}
