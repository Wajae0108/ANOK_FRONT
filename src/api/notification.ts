// Anok_05_Notification_API_Event_Spec_v2_3_3_FINAL — Public API 5개.
// 실시간 알림은 명세상 fetch-streaming SSE(NTF-API-05)이며, mock 모드에서도 실제 ReadableStream 기반
// text/event-stream 응답으로 재현한다(§mockNotification.ts의 subscribe/emit + mock.ts의 mockStream 참고).
// TASK_DUE_SOON/TASK_OVERDUE/PROJECT_SCHEDULE_REMINDER/MEETING_REMINDER는 각 도메인 서비스의 스케줄러가 발행해야 하는데
// 이 프론트 mock에는 백그라운드 스케줄러가 없어 재현하지 않는다(명세 §28 Reminder Ownership). CANDIDATE_MATERIALIZATION_FAILED/
// DOCUMENT_PROCESSING_FAILED/FILE_SECURITY_BLOCKED도 대응하는 비동기 실패 파이프라인이 mock에 없어 제외한다.
import { openStream } from "./http";
import { request } from "./http";
import type { CursorPage, Rfc3339, Uuid } from "./types";

export type NotificationType =
  | "PROJECT_MEMBER_ADDED" | "TASK_ASSIGNED" | "TASK_UNASSIGNED" | "TASK_DUE_SOON" | "TASK_OVERDUE" | "PROJECT_SCHEDULE_REMINDER"
  | "MEETING_PARTICIPANT_ADDED" | "MEETING_PARTICIPATION_REMOVED" | "MEETING_REMINDER" | "MEETING_MINUTES_APPROVED"
  | "MEETING_POSTPROCESS_ATTENTION" | "CANDIDATE_MATERIALIZATION_FAILED"
  | "DOCUMENT_OWNERSHIP_TRANSFERRED" | "DOCUMENT_PROCESSING_FAILED" | "FILE_SECURITY_BLOCKED";
export type NotificationResourceType = "PROJECT" | "TASK" | "MEETING" | "MEETING_MINUTES" | "DOCUMENT";
export type MeetingPostprocessAttentionReason =
  "RECORDING_FAILED" | "STT_FAILED" | "AI_EGRESS_BLOCKED" | "MINUTES_GENERATION_FAILED" | "CANDIDATE_GENERATION_FAILED" | "SOURCE_EXPIRED" | "ATTACHMENT_POLICY_BLOCKED";
export type CandidateMaterializationFailureReason =
  "ASSIGNEE_UNAVAILABLE" | "CROSS_TENANT_CANDIDATE_TARGET" | "PROJECT_COMPLETED" | "PROJECT_ARCHIVED" | "SOURCE_CANDIDATE_ALREADY_PROCESSED" | "INVALID_SOURCE" | "CROSS_TENANT_CONTEXT";
export type DocumentProcessingAttentionReason = "PARSER_ERROR" | "EMBEDDING_ERROR" | "AI_PROVIDER_UNAVAILABLE" | "NOT_SUPPORTED" | "PROCESSING_FAILED";

export interface NotificationResponse {
  notificationId: Uuid; notificationType: NotificationType; resourceType: NotificationResourceType; resourceId: Uuid;
  secondaryResourceType?: NotificationResourceType | null; secondaryResourceId?: Uuid | null;
  actorUserId?: Uuid | null; presentationCode: string; safeParameters: Record<string, unknown>;
  occurredAt: Rfc3339; createdAt: Rfc3339; read: boolean; readAt?: Rfc3339 | null;
}
export interface UnreadCountResponse { unreadCount: number }
export interface MarkAllReadResponse { updatedCount: number; readAt: Rfc3339 }

const auth = { auth: "bearer" } as const;

export const listNotifications = (q: { cursor?: string; limit?: number; read?: boolean; type?: NotificationType } = {}) =>
  request<CursorPage<NotificationResponse>>({ method: "GET", path: "/api/notifications", query: q, ...auth });
export const getUnreadCount = () => request<UnreadCountResponse>({ method: "GET", path: "/api/notifications/unread-count", ...auth });
export const setNotificationReadState = (notificationId: Uuid, read: boolean) =>
  request<NotificationResponse>({ method: "PUT", path: `/api/notifications/${notificationId}/read-state`, body: { read }, ...auth });
export const markAllNotificationsRead = () =>
  request<MarkAllReadResponse>({ method: "POST", path: "/api/notifications/read-all", body: {}, ...auth, idempotent: true });

export interface NotificationStreamEvent {
  notificationId: Uuid; notificationType: NotificationType; resourceType: NotificationResourceType; resourceId: Uuid;
  secondaryResourceType?: NotificationResourceType | null; secondaryResourceId?: Uuid | null;
  presentationCode: string; safeParameters: Record<string, unknown>; occurredAt: Rfc3339; createdAt: Rfc3339;
}

// NTF-API-05: GET /api/notifications/stream (fetch-streaming + Bearer, query token 금지).
// 연결이 끊기면 재연결하지 않고 stop()으로 정리하는 것은 호출자 책임 — 화면 쪽 훅이 재연결을 담당한다.
export function streamNotifications(onEvent: (e: NotificationStreamEvent) => void, onError?: (e: unknown) => void): { stop: () => void } {
  const controller = new AbortController();
  (async () => {
    try {
      const res = await openStream("/api/notifications/stream", controller.signal);
      if (!res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const lines = chunk.split("\n");
          const eventLine = lines.find(l => l.startsWith("event:"));
          const dataLine = lines.find(l => l.startsWith("data:"));
          if (eventLine?.slice(6).trim() === "notification" && dataLine) {
            try { onEvent(JSON.parse(dataLine.slice(5).trim())); } catch { /* 손상된 청크는 무시하고 다음 이벤트를 기다린다 */ }
          }
        }
      }
    } catch (e) {
      if (!controller.signal.aborted) onError?.(e);
    }
  })();
  return { stop: () => controller.abort() };
}
