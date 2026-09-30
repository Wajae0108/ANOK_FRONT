// Anok_05_Notification_API_Event_Spec_v2_3_3_FINAL 기준 인메모리 mock.
// 실제로는 각 도메인 서비스가 Kafka(NotificationRequested)로 발행하지만, 이 mock에서는 mockProject/mockMeeting/mockDocument가
// 관련 이벤트 발생 시 emit()을 직접 호출해 동일한 효과를 낸다(§10 Kafka Topic/ACL의 producer-per-topic 경계를 함수 호출 경계로 대체).
import { check, fail, invalid } from "./mockCore";
import type { RequestOptions } from "./http";
import type { NotificationResourceType, NotificationType } from "./notification";
import type { FieldError } from "./types";

interface StoredNotification {
  notificationId: string; recipientUserId: string; notificationType: NotificationType; resourceType: NotificationResourceType; resourceId: string;
  secondaryResourceType: NotificationResourceType | null; secondaryResourceId: string | null; actorUserId: string | null;
  presentationCode: string; safeParameters: Record<string, unknown>; dedupKey: string | null;
  occurredAt: string; createdAtMs: number; seq: number; readAt: string | null;
}

let seq = 0;
const store: StoredNotification[] = [];
const dedupSeen = new Set<string>();
type Listener = (n: StoredNotification) => void;
const listeners = new Map<string, Set<Listener>>();

export function subscribe(userId: string, cb: Listener): () => void {
  if (!listeners.has(userId)) listeners.set(userId, new Set());
  listeners.get(userId)!.add(cb);
  return () => listeners.get(userId)?.delete(cb);
}

// Project/Meeting/Document mock 모듈이 이벤트 발생 시 호출하는 "발행" 지점 (실제로는 Kafka topic별 producer).
export function emit(recipientUserId: string, notificationType: NotificationType, resourceType: NotificationResourceType, resourceId: string, opts: {
  secondaryResourceType?: NotificationResourceType | null; secondaryResourceId?: string | null;
  actorUserId?: string | null; safeParameters?: Record<string, unknown>; dedupKey?: string | null;
} = {}) {
  if (opts.actorUserId && recipientUserId === opts.actorUserId) return; // 본인 행위로 인한 자기 알림은 만들지 않는다(명세에 명시 규정 없는 상식적 UX 판단)
  const dedupKey = opts.dedupKey ?? null;
  if (dedupKey) {
    const k = `${recipientUserId}|${notificationType}|${dedupKey}`;
    if (dedupSeen.has(k)) return;
    dedupSeen.add(k);
  }
  const n: StoredNotification = {
    notificationId: crypto.randomUUID(), recipientUserId, notificationType, resourceType, resourceId,
    secondaryResourceType: opts.secondaryResourceType ?? null, secondaryResourceId: opts.secondaryResourceId ?? null,
    actorUserId: opts.actorUserId ?? null, presentationCode: notificationType, safeParameters: opts.safeParameters ?? {},
    dedupKey, occurredAt: new Date().toISOString(), createdAtMs: Date.now(), seq: ++seq, readAt: null,
  };
  store.push(n);
  listeners.get(recipientUserId)?.forEach(cb => cb(n));
}

function toResponse(n: StoredNotification) {
  return {
    notificationId: n.notificationId, notificationType: n.notificationType, resourceType: n.resourceType, resourceId: n.resourceId,
    secondaryResourceType: n.secondaryResourceType, secondaryResourceId: n.secondaryResourceId, actorUserId: n.actorUserId,
    presentationCode: n.presentationCode, safeParameters: n.safeParameters, occurredAt: n.occurredAt,
    createdAt: new Date(n.createdAtMs).toISOString(), read: n.readAt != null, readAt: n.readAt,
  };
}

// cursor = (createdAtMs, seq) — opaque, client가 해석/변조하지 않는다.
function encodeCursor(createdAtMs: number, s: number): string { return btoa(JSON.stringify([createdAtMs, s])); }
function decodeCursor(cursor: string): [number, number] {
  try {
    const v = JSON.parse(atob(cursor));
    if (!Array.isArray(v) || v.length !== 2 || typeof v[0] !== "number" || typeof v[1] !== "number") throw new Error("malformed");
    return v as [number, number];
  } catch { return fail(400, "INVALID_CURSOR"); }
}

function myRows(userId: string) { return store.filter(n => n.recipientUserId === userId).sort((a, b) => b.createdAtMs - a.createdAtMs || b.seq - a.seq); }

export function routeNotification(o: RequestOptions, meUserId: string): unknown {
  const b: any = o.body ?? {};
  const q = o.query ?? {};
  const path = o.path;

  if (path === "/api/notifications" && o.method === "GET") {
    const limit = Number(q.limit ?? 20);
    if (!(Number.isFinite(limit) && limit >= 1 && limit <= 100)) invalid({ field: "limit", reason: "OUT_OF_RANGE" });
    let rows = myRows(meUserId);
    if (q.read !== undefined) { const wantRead = q.read === "true" || q.read === true; rows = rows.filter(n => (n.readAt != null) === wantRead); }
    if (q.type) rows = rows.filter(n => n.notificationType === q.type);
    if (q.cursor) {
      const [t, s] = decodeCursor(String(q.cursor));
      rows = rows.filter(n => n.createdAtMs < t || (n.createdAtMs === t && n.seq < s));
    }
    const page = rows.slice(0, limit);
    const hasNext = rows.length > limit;
    const last = page[page.length - 1];
    return { items: page.map(toResponse), page: { limit, nextCursor: hasNext && last ? encodeCursor(last.createdAtMs, last.seq) : null, hasNext } };
  }
  if (path === "/api/notifications/unread-count" && o.method === "GET") {
    return { unreadCount: myRows(meUserId).filter(n => n.readAt == null).length };
  }
  if (path === "/api/notifications/read-all" && o.method === "POST") {
    const readAt = new Date().toISOString();
    let updatedCount = 0;
    for (const n of store) if (n.recipientUserId === meUserId && n.readAt == null) { n.readAt = readAt; updatedCount++; }
    return { updatedCount, readAt };
  }
  const m = /^\/api\/notifications\/([^/]+)\/read-state$/.exec(path);
  if (m && o.method === "PUT") {
    const e: FieldError[] = [];
    if (typeof b.read !== "boolean") e.push({ field: "read", reason: "REQUIRED" });
    check(e);
    const n = store.find(x => x.notificationId === m[1] && x.recipientUserId === meUserId);
    if (!n) return fail(404, "NOTIFICATION_NOT_FOUND");
    n.readAt = b.read ? new Date().toISOString() : null;
    return toResponse(n);
  }
  return fail(404, "NOT_FOUND");
}
