// Anok_05 — Notification 화면들이 공유하는 실시간 Inbox 훅과 표시 텍스트 매핑.
// SSE(NTF-API-05)로 실시간 이벤트를 받고, 최초 진입/재연결 시 GET /api/notifications로 복구한다(§21 SSE Client Flow).
import { useEffect, useRef, useState } from "react";
import * as api from "../api/notification";
import type { NotificationResponse, NotificationType } from "../api/notification";
import { errorText } from "../api/errors";
import { MATERIALIZE_FAILURE_TEXT } from "../meetings/shared";

const PRESENTATION_TEXT: Record<NotificationType, string> = {
  PROJECT_MEMBER_ADDED: "프로젝트에 구성원으로 추가되었습니다.",
  TASK_ASSIGNED: "새 업무가 배정되었습니다.",
  TASK_UNASSIGNED: "업무 담당이 변경되었습니다.",
  TASK_DUE_SOON: "업무 마감이 임박했습니다.",
  TASK_OVERDUE: "업무 마감일이 지났습니다.",
  PROJECT_SCHEDULE_REMINDER: "예정된 프로젝트 일정이 있습니다.",
  MEETING_PARTICIPANT_ADDED: "회의 참가자로 추가되었습니다.",
  MEETING_PARTICIPATION_REMOVED: "회의 참가에서 제외되었습니다.",
  MEETING_REMINDER: "예정된 회의가 있습니다.",
  MEETING_MINUTES_APPROVED: "회의록이 승인되었습니다.",
  MEETING_POSTPROCESS_ATTENTION: "회의 처리에 확인이 필요합니다.",
  CANDIDATE_MATERIALIZATION_FAILED: "AI 후보를 프로젝트에 반영하지 못했습니다.",
  DOCUMENT_OWNERSHIP_TRANSFERRED: "문서 소유권이 이전되었습니다.",
  DOCUMENT_PROCESSING_FAILED: "문서 처리에 확인이 필요합니다.",
  FILE_SECURITY_BLOCKED: "파일이 보안 정책에 의해 차단되었습니다.",
};
// 알림에는 이름·제목·본문이 없고 ID와 코드(safeParameters)뿐이다 — 문구는 type·reasonCode별로 프론트가 만든다(FRONTEND_00 11-2).
const POSTPROCESS_ATTENTION_TEXT: Record<string, string> = {
  RECORDING_FAILED: "녹음이 없어 회의록을 만들 수 없습니다.",
  STT_FAILED: "음성 인식에 실패해 회의록을 만들지 못했습니다.",
  AI_EGRESS_BLOCKED: "AI 처리가 허용되지 않은 회의라 회의록이 만들어지지 않았습니다.",
  MINUTES_GENERATION_FAILED: "회의록 생성에 실패했습니다. 확인이 필요합니다.",
  CANDIDATE_GENERATION_FAILED: "회의록은 만들어졌지만 결정·업무 후보 생성에 실패했습니다.",
  SOURCE_EXPIRED: "원본 보관 기간이 지나 회의 처리를 더 진행할 수 없습니다.",
  ATTACHMENT_POLICY_BLOCKED: "회의 자료가 정책에 막혀 처리할 수 없습니다.",
};
export function presentationText(n: { presentationCode: string; safeParameters?: Record<string, unknown> }): string {
  const base = PRESENTATION_TEXT[n.presentationCode as NotificationType] ?? "새 알림이 있습니다.";
  const reason = typeof n.safeParameters?.reasonCode === "string" ? n.safeParameters.reasonCode : null;
  if (reason && n.presentationCode === "MEETING_POSTPROCESS_ATTENTION") return POSTPROCESS_ATTENTION_TEXT[reason] ?? base;
  if (reason && n.presentationCode === "CANDIDATE_MATERIALIZATION_FAILED") return `${base} ${MATERIALIZE_FAILURE_TEXT[reason] ?? ""}`.trim();
  return base;
}

type Category = "업무" | "프로젝트" | "회의" | "문서";
const CATEGORY_CLS: Record<Category, string> = { 업무: "bg-indigo-50 text-indigo-600", 프로젝트: "bg-emerald-50 text-emerald-600", 회의: "bg-violet-50 text-violet-600", 문서: "bg-amber-50 text-amber-600" };
export function notificationCategory(t: NotificationType): Category {
  if (t.startsWith("TASK_")) return "업무";
  if (t === "PROJECT_MEMBER_ADDED" || t === "PROJECT_SCHEDULE_REMINDER") return "프로젝트";
  if (t.startsWith("MEETING_") || t === "CANDIDATE_MATERIALIZATION_FAILED") return "회의";
  return "문서";
}
export function CategoryBadge({ type }: { type: NotificationType }) {
  const c = notificationCategory(type);
  return <span className={`inline-flex items-center text-[10px] font-semibold tracking-wide px-2.5 py-0.5 rounded-full ${CATEGORY_CLS[c]}`}>{c}</span>;
}

export function fmtRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60000) return "방금 전";
  if (ms < 3600000) return `${Math.floor(ms / 60000)}분 전`;
  if (ms < 86400000) return `${Math.floor(ms / 3600000)}시간 전`;
  return `${Math.floor(ms / 86400000)}일 전`;
}

export interface NotificationTarget { screen: string; ctx: Record<string, unknown> }
// 알림 클릭 시 이동할 화면 — 실제 접근 권한은 항상 대상 화면 자신이 재검증한다(Notification != Authorization, §2 Core invariant).
export function targetForNotification(n: NotificationResponse): NotificationTarget | null {
  switch (n.resourceType) {
    case "PROJECT": return { screen: "project-detail", ctx: { projectId: n.resourceId } };
    case "TASK": return { screen: "tasks", ctx: { taskId: n.resourceId } };
    case "MEETING": return { screen: "meeting-detail", ctx: { meetingId: n.resourceId } };
    case "MEETING_MINUTES": return n.secondaryResourceId ? { screen: "meeting-detail", ctx: { meetingId: n.secondaryResourceId } } : null;
    case "DOCUMENT": return { screen: "document-detail", ctx: { docId: n.resourceId } };
    default: return null;
  }
}

export interface NotificationCenter {
  items: NotificationResponse[]; unreadCount: number; loading: boolean; error: string | null; hasMore: boolean;
  // 실시간(SSE)으로 방금 도착한 알림. 목록 복구(최초·재연결)로 들어온 알림은 담지 않는다 — 팝업용.
  latest: NotificationResponse | null;
  loadMore: () => void; markRead: (id: string) => void; markAllRead: () => void; reload: () => void;
}

export function useNotificationCenter(myUserId?: string): NotificationCenter {
  const [items, setItems] = useState<NotificationResponse[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [latest, setLatest] = useState<NotificationResponse | null>(null);
  const seenIds = useRef(new Set<string>());
  const itemsRef = useRef(items);
  itemsRef.current = items;

  async function fetchPage(cursor: string | null, replace: boolean) {
    setLoading(true); setError(null);
    try {
      const page = await api.listNotifications({ limit: 20, cursor: cursor ?? undefined });
      if (replace) seenIds.current = new Set();
      const fresh = page.items.filter(n => !seenIds.current.has(n.notificationId));
      fresh.forEach(n => seenIds.current.add(n.notificationId));
      setItems(prev => replace ? page.items : [...prev, ...fresh]);
      setNextCursor(page.page.nextCursor);
      setHasMore(page.page.hasNext);
    } catch (e) { setError(errorText(e)); }
    finally { setLoading(false); }
  }
  async function refreshUnread() {
    try { setUnreadCount((await api.getUnreadCount()).unreadCount); } catch { /* 배지 갱신 실패는 치명적이지 않으므로 조용히 무시 */ }
  }

  useEffect(() => {
    if (!myUserId) return;
    seenIds.current = new Set();
    fetchPage(null, true);
    refreshUnread();
    const handle = api.streamNotifications(
      e => {
        if (seenIds.current.has(e.notificationId)) return;
        seenIds.current.add(e.notificationId);
        const fresh: NotificationResponse = { ...e, read: false, readAt: null };
        setItems(prev => [fresh, ...prev]);
        setUnreadCount(c => c + 1);
        setLatest(fresh);
      },
      () => { /* 재연결은 streamNotifications가 백오프로 처리한다. 인증 오류(401/403)일 때만 중단된다. */ },
      // 서버는 끊긴 동안의 알림을 replay하지 않으므로 재연결 직후 목록과 unread-count를 다시 맞춘다.
      () => { fetchPage(null, true); refreshUnread(); },
    );
    return () => handle.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myUserId]);

  async function markRead(id: string) {
    const target = itemsRef.current.find(n => n.notificationId === id);
    if (!target || target.read) return;
    setItems(prev => prev.map(n => n.notificationId === id ? { ...n, read: true, readAt: new Date().toISOString() } : n));
    setUnreadCount(c => Math.max(0, c - 1));
    try { await api.setNotificationReadState(id, true); } catch { /* 낙관적 갱신 유지, 다음 새로고침에서 서버 상태로 정정 */ }
  }
  async function markAllRead() {
    setItems(prev => prev.map(n => ({ ...n, read: true, readAt: n.readAt ?? new Date().toISOString() })));
    setUnreadCount(0);
    try { await api.markAllNotificationsRead(); } catch { /* 위와 동일 */ }
  }
  function loadMore() { if (hasMore && !loading) fetchPage(nextCursor, false); }
  function reload() { fetchPage(null, true); refreshUnread(); }

  return { items, unreadCount, loading, error, hasMore, latest, loadMore, markRead, markAllRead, reload };
}
