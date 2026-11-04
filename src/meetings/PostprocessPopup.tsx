// 회의 종료 후 AI 처리(음성 인식 → 회의록 생성)가 끝날 때까지 화면 오른쪽 아래에 진행 상황을 띄우는 전역 팝업.
// 서버는 Kafka로 비동기 처리하고 실패 시 자동 재시도하므로, 여기서는 상태만 폴링해 보여 준다(재시도 자체는 서버가 한다).
import { useEffect, useRef, useState } from "react";
import * as api from "../api/meeting";
import type { PostprocessStatus } from "../api/meeting";
import type { Navigate } from "../workspace/nav";
import { PP_BUSY, PP_LABEL } from "./shared";

const FAILED: PostprocessStatus[] = ["FAILED", "AI_EGRESS_BLOCKED", "SOURCE_EXPIRED", "MANUAL_RESOLUTION"];
const DONE: PostprocessStatus[] = ["MINUTES_DRAFT", "REVIEWING", "APPROVED"];

const STEPS = ["녹음 확인", "음성 인식", "회의록 작성"] as const;
function stepOf(s: PostprocessStatus): number {
  if (s === "WAITING_EVIDENCE_SNAPSHOT" || s === "WAITING_RECORDING") return 0;
  if (s === "STT_QUEUED" || s === "STT_PROCESSING" || s === "STT_READY") return 1;
  if (s === "MINUTES_QUEUED" || s === "MINUTES_PROCESSING") return 2;
  return STEPS.length;
}

type Phase = "busy" | "done" | "failed";
interface Item { meetingId: string; title: string; status: PostprocessStatus; phase: Phase; retries: number; failureCode?: string | null }

const POLL_BUSY_MS = 3000;
const POLL_IDLE_MS = 15000;
const DONE_AUTO_CLOSE_MS = 10000;

export default function PostprocessPopup({ navigate }: { navigate: Navigate }) {
  const [items, setItems] = useState<Item[]>([]);
  // 한 번 닫은 카드는 같은 처리 단계가 반복돼도 다시 띄우지 않는다.
  const dismissed = useRef(new Set<string>());
  const seen = useRef(new Map<string, { status: PostprocessStatus; phase: Phase; retries: number }>());
  // 이 세션에서 한 번이라도 "처리 중"이던 회의만 추적한다. 이미 끝났거나 실패한 옛 회의로는 팝업을 띄우지 않는다.
  const watching = useRef(new Set<string>());

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function tick() {
      let anyBusy = false;
      try {
        if (!document.hidden) {
          const page = await api.listMeetings({ status: "ENDED", limit: 20 });
          if (!alive) return;
          const next: Item[] = [];
          for (const m of page.items) {
            const status = m.postprocessStatus;
            const busy = PP_BUSY.includes(status);
            if (busy) watching.current.add(m.meetingId);
            if (!watching.current.has(m.meetingId)) continue;
            const phase: Phase = busy ? "busy" : FAILED.includes(status) ? "failed" : DONE.includes(status) ? "done" : "busy";
            if (!busy && phase === "busy") continue; // NOT_STARTED 등
            const prev = seen.current.get(m.meetingId);
            // 처리 중에 단계가 거꾸로 가면(예: 음성 인식 중 → 대기) 서버가 자동 재시도를 시작한 것이다.
            const wentBack = !!prev && busy && prev.phase === "busy" && PP_BUSY.indexOf(status) < PP_BUSY.indexOf(prev.status);
            // 다음 처리 사이클(수동 재시도 등)에서는 이전에 닫은 카드가 다시 보이도록 닫은 기록을 비운다.
            if (prev && prev.phase !== phase) for (const p of ["busy", "done", "failed"]) dismissed.current.delete(`${m.meetingId}:${p}`);
            const retries = phase === "busy" ? (prev?.phase === "busy" ? prev.retries : 0) + (wentBack ? 1 : 0) : (prev?.retries ?? 0);
            seen.current.set(m.meetingId, { status, phase, retries });
            if (busy) anyBusy = true;
            next.push({ meetingId: m.meetingId, title: m.title, status, phase, retries });
          }
          setItems(prevItems => {
            // 이미 화면에 있던 완료/실패 카드는 서버 목록에서 빠져도(페이지 밖으로 밀려도) 사용자가 닫을 때까지 유지한다.
            const keep = prevItems.filter(p => p.phase !== "busy" && !next.some(n => n.meetingId === p.meetingId));
            return [...next, ...keep].filter(i => !dismissed.current.has(`${i.meetingId}:${i.phase}`));
          });
        }
      } catch { /* 일시적인 조회 실패는 다음 주기에 다시 시도한다 */ }
      if (alive) timer = setTimeout(tick, anyBusy ? POLL_BUSY_MS : POLL_IDLE_MS);
    }
    tick();
    const onVisible = () => { if (!document.hidden && alive) { clearTimeout(timer); tick(); } };
    document.addEventListener("visibilitychange", onVisible);
    return () => { alive = false; clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  function close(i: Item) {
    dismissed.current.add(`${i.meetingId}:${i.phase}`);
    setItems(p => p.filter(x => !(x.meetingId === i.meetingId && x.phase === i.phase)));
  }
  function open(i: Item) { close(i); navigate("meeting-detail", { meetingId: i.meetingId }); }

  // 완료 카드는 잠시 뒤 자동으로 닫는다. 실패 카드는 확인할 때까지 남긴다.
  useEffect(() => {
    const timers = items.filter(i => i.phase === "done").map(i => setTimeout(() => close(i), DONE_AUTO_CLOSE_MS));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.map(i => `${i.meetingId}:${i.phase}`).join(",")]);

  if (items.length === 0) return null;
  return (
    <div className="fixed right-5 bottom-5 z-[60] flex flex-col gap-3 w-[340px] max-w-[calc(100vw-2.5rem)]" role="status" aria-live="polite">
      {items.map(i => <Card key={`${i.meetingId}:${i.phase}`} item={i} onClose={() => close(i)} onOpen={() => open(i)} />)}
    </div>
  );
}

function Card({ item, onClose, onOpen }: { item: Item; onClose: () => void; onOpen: () => void }) {
  const step = stepOf(item.status);
  const failed = item.phase === "failed";
  const done = item.phase === "done";
  const accent = failed ? "border-rose-200" : done ? "border-emerald-200" : "border-indigo-100";
  return (
    <div className={`bg-white rounded-2xl border ${accent} shadow-xl shadow-slate-900/10 p-4`}>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${failed ? "bg-rose-50 text-rose-500" : done ? "bg-emerald-50 text-emerald-500" : "bg-indigo-50 text-indigo-500"}`}>
          {item.phase === "busy" ? <span className="w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin" /> : failed ? "!" : "✓"}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold text-slate-800 truncate">{item.title}</p>
          <p className={`text-[12px] mt-0.5 ${failed ? "text-rose-600" : done ? "text-emerald-600" : "text-slate-500"}`}>
            {failed ? "AI 처리에 실패했어요" : done ? "회의록 초안이 준비됐어요" : `AI가 회의록을 만들고 있어요 · ${PP_LABEL[item.status]}`}
          </p>
        </div>
        <button onClick={onClose} aria-label="닫기" className="text-slate-300 hover:text-slate-500 text-lg leading-none -mt-1">×</button>
      </div>

      {item.phase === "busy" && (
        <>
          <div className="mt-3 flex gap-1.5">
            {STEPS.map((label, idx) => (
              <div key={label} className="flex-1">
                <div className={`h-1.5 rounded-full ${idx < step ? "bg-indigo-500" : idx === step ? "bg-indigo-300 animate-pulse" : "bg-slate-100"}`} />
                <p className={`mt-1 text-[10px] ${idx === step ? "text-indigo-600 font-semibold" : "text-slate-400"}`}>{label}</p>
              </div>
            ))}
          </div>
          {item.retries > 0 && <p className="mt-2 text-[11px] text-amber-600">일시적인 오류로 자동 재시도 중이에요 ({item.retries}회)</p>}
        </>
      )}
      {failed && <p className="mt-2 text-[11px] text-slate-500">자동 재시도 후에도 실패했어요. 회의 상세에서 상태를 확인하고 다시 시도할 수 있어요.</p>}
      {item.phase !== "busy" && (
        <button onClick={onOpen} className={`mt-3 w-full text-[12px] font-semibold rounded-lg py-2 ${failed ? "bg-rose-50 text-rose-600 hover:bg-rose-100" : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"}`}>
          {failed ? "회의 상세에서 확인" : "회의록 보기"}
        </button>
      )}
    </div>
  );
}
