// 실시간(SSE)으로 알림이 도착하면 화면 오른쪽 위에 "알림이 도착했습니다 / 업무 할당 / 제목" 팝업을 잠시 띄운다.
// 알림 자체에는 제목이 없다(ID와 코드뿐, FRONTEND_00 11-2) — 대상 리소스를 조회해 제목을 채우고, 조회가 안 되면 기본 문구만 보여 준다.
import { useEffect, useRef, useState } from "react";
import * as docApi from "../api/document";
import * as meetingApi from "../api/meeting";
import * as projectApi from "../api/project";
import type { NotificationResponse, NotificationType } from "../api/notification";
import { goToNotification } from "../workspace/chrome";
import type { Navigate } from "../workspace/nav";
import { presentationText } from "./shared";

const HEADING: Record<NotificationType, string> = {
  PROJECT_MEMBER_ADDED: "프로젝트 추가",
  TASK_ASSIGNED: "업무 할당",
  TASK_UNASSIGNED: "업무 담당 변경",
  TASK_DUE_SOON: "업무 마감 임박",
  TASK_OVERDUE: "업무 마감 지남",
  PROJECT_SCHEDULE_REMINDER: "프로젝트 일정",
  MEETING_PARTICIPANT_ADDED: "회의 참여",
  MEETING_PARTICIPATION_REMOVED: "회의 참여 제외",
  MEETING_REMINDER: "회의 알림",
  MEETING_MINUTES_APPROVED: "회의록 승인",
  MEETING_POSTPROCESS_ATTENTION: "회의 처리 확인 필요",
  CANDIDATE_MATERIALIZATION_FAILED: "후보 반영 실패",
  DOCUMENT_OWNERSHIP_TRANSFERRED: "문서 소유권 이전",
  DOCUMENT_PROCESSING_FAILED: "문서 처리 확인 필요",
  FILE_SECURITY_BLOCKED: "파일 차단",
};

const MAX_TOASTS = 3;
const AUTO_CLOSE_MS = 7000;

interface Toast { key: string; n: NotificationResponse; title?: string }

// 알림이 가리키는 리소스의 제목. 권한이 없거나 이미 사라졌으면 조회가 실패하므로 null을 돌려준다.
async function resolveTitle(n: NotificationResponse): Promise<string | null> {
  try {
    switch (n.resourceType) {
      case "TASK": return n.secondaryResourceType === "PROJECT" && n.secondaryResourceId ? (await projectApi.getTask(n.secondaryResourceId, n.resourceId)).title : null;
      case "PROJECT": return (await projectApi.getProject(n.resourceId)).name;
      case "MEETING": return (await meetingApi.getMeeting(n.resourceId)).title;
      case "MEETING_MINUTES": return n.secondaryResourceType === "MEETING" && n.secondaryResourceId ? (await meetingApi.getMeeting(n.secondaryResourceId)).title : null;
      case "DOCUMENT": return (await docApi.getDocument(n.resourceId)).title;
      default: return null;
    }
  } catch { return null; }
}

export default function NotificationToasts({ latest, navigate, onRead }: { latest: NotificationResponse | null; navigate: Navigate; onRead: (id: string) => void }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  function close(key: string) {
    clearTimeout(timers.current.get(key));
    timers.current.delete(key);
    setToasts(p => p.filter(t => t.key !== key));
  }

  useEffect(() => {
    if (!latest) return;
    const key = latest.notificationId;
    setToasts(p => [{ key, n: latest }, ...p.filter(t => t.key !== key)].slice(0, MAX_TOASTS));
    timers.current.set(key, setTimeout(() => close(key), AUTO_CLOSE_MS));
    // 이미 닫힌 토스트면 map이 아무것도 바꾸지 않으므로 취소 처리는 필요 없다.
    resolveTitle(latest).then(title => { if (title) setToasts(p => p.map(t => t.key === key ? { ...t, title } : t)); });
  }, [latest]);

  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);

  if (toasts.length === 0) return null;
  return (
    <div className="fixed right-5 top-5 z-[70] flex flex-col gap-3 w-[340px] max-w-[calc(100vw-2.5rem)]" role="status" aria-live="polite">
      {toasts.map(t => (
        <div key={t.key} className="flex items-start gap-1 bg-white rounded-2xl border border-indigo-100 shadow-xl shadow-slate-900/10 pr-2">
          <button className="min-w-0 flex-1 text-left p-4 focus-visible:outline-2 focus-visible:outline-indigo-500 rounded-2xl"
            onClick={() => { onRead(t.n.notificationId); goToNotification(t.n, navigate); close(t.key); }}>
            <p className="text-[11px] font-semibold text-indigo-600">알림이 도착했습니다</p>
            <p className="mt-1 text-[13px] font-bold text-slate-800">{HEADING[t.n.notificationType] ?? "새 알림"}</p>
            <p className="mt-0.5 text-[12px] text-slate-500 break-words">{t.title ?? presentationText(t.n)}</p>
          </button>
          <button onClick={() => close(t.key)} aria-label="닫기" className="mt-3 text-slate-300 hover:text-slate-500 text-lg leading-none">×</button>
        </div>
      ))}
    </div>
  );
}
