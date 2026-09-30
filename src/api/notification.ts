// Anok_05_Notification_API_Event_Spec_v2_3_3_FINAL — Public API 5개.
// 실시간 알림은 명세상 fetch-streaming SSE(NTF-API-05)이며, mock 모드에서도 실제 ReadableStream 기반
// text/event-stream 응답으로 재현한다(§mockNotification.ts의 subscribe/emit + mock.ts의 mockStream 참고).
// TASK_DUE_SOON/TASK_OVERDUE/PROJECT_SCHEDULE_REMINDER/MEETING_REMINDER는 각 도메인 서비스의 스케줄러가 발행해야 하는데
// 이 프론트 mock에는 백그라운드 스케줄러가 없어 재현하지 않는다(명세 §28 Reminder Ownership). CANDIDATE_MATERIALIZATION_FAILED/
// DOCUMENT_PROCESSING_FAILED/FILE_SECURITY_BLOCKED도 대응하는 비동기 실패 파이프라인이 mock에 없어 제외한다.
import { ApiError } from "./errors";
import { openStream, request } from "./http";
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
// Gateway 라우트가 CT_NONE/IDEMPOTENCY_NONE이라 본문(빈 `{}` 포함)과 Idempotency-Key를 보내면 안 된다(415).
export const markAllNotificationsRead = () =>
  request<MarkAllReadResponse>({ method: "POST", path: "/api/notifications/read-all", ...auth });

// NotificationSsePayload — actorUserId/read/readAt은 스트림 페이로드에 없다.
export interface NotificationStreamEvent {
  notificationId: Uuid; notificationType: NotificationType; resourceType: NotificationResourceType; resourceId: Uuid;
  secondaryResourceType?: NotificationResourceType | null; secondaryResourceId?: Uuid | null;
  presentationCode: string; safeParameters: Record<string, unknown>; occurredAt: Rfc3339; createdAt: Rfc3339;
}

const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 30000;

// NTF-API-05: GET /api/notifications/stream (fetch-streaming + Bearer, query token 금지).
// 서버는 `event: notification`(id = notificationId, 본문 = NotificationSsePayload)과 15초 주기의 `event: heartbeat`(본문 "ping")를 보낸다.
// 서버는 access token 만료/최대 연결 시간에 맞춰 연결을 정상 종료하므로, 끊기면 지수 백오프로 재연결한다.
// 재연결 사이에 놓친 알림은 서버가 replay하지 않으므로 호출자가 onReconnect에서 목록을 다시 불러와야 한다.
// 401(갱신 실패)·403 같은 인증/권한 오류는 재시도하지 않고 onError로 알린 뒤 종료한다.
export function streamNotifications(
  onEvent: (e: NotificationStreamEvent) => void,
  onError?: (e: unknown) => void,
  onReconnect?: () => void,
): { stop: () => void } {
  const controller = new AbortController();
  const { signal } = controller;
  const sleep = (ms: number) => new Promise<void>(resolve => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });

  (async () => {
    let backoff = RECONNECT_MIN_MS;
    let connectedOnce = false;
    while (!signal.aborted) {
      try {
        const res = await openStream("/api/notifications/stream", signal);
        if (!res.ok) {
          // 성공이 아니면 본문은 SSE가 아니라 공통 실패 JSON이다.
          let body: { errorCode?: string; message?: string; requestId?: string } | null = null;
          try { body = await res.json(); } catch { /* Gateway/Proxy 응답 */ }
          const err = new ApiError(res.status, body?.errorCode ?? "UNKNOWN_ERROR", body?.message ?? "알림 스트림을 열 수 없습니다.", body?.requestId);
          if (res.status === 401 || res.status === 403) { onError?.(err); return; }
          throw err;
        }
        if (!res.body) throw new Error("empty stream body");
        if (connectedOnce) onReconnect?.();
        connectedOnce = true;
        backoff = RECONNECT_MIN_MS;

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true }).replace(/\r\n?/g, "\n");
          let idx: number;
          while ((idx = buf.indexOf("\n\n")) !== -1) {
            const chunk = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            let event = "message";
            const data: string[] = [];
            for (const line of chunk.split("\n")) {
              if (line.startsWith("event:")) event = line.slice(6).trim();
              else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
            }
            if (event === "notification" && data.length) {
              try { onEvent(JSON.parse(data.join("\n"))); } catch { /* 손상된 청크는 무시하고 다음 이벤트를 기다린다 */ }
            }
            // heartbeat 등 그 외 이벤트는 연결 유지용이므로 무시한다.
          }
        }
        // 서버가 연결을 정상 종료(deadline 도달) — 바로 재연결한다.
        await sleep(RECONNECT_MIN_MS);
      } catch (e) {
        if (signal.aborted) return;
        onError?.(e);
        await sleep(backoff);
        backoff = Math.min(backoff * 2, RECONNECT_MAX_MS);
      }
    }
  })();
  return { stop: () => controller.abort() };
}
