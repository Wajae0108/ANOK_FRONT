// 회의 채팅 실시간 수신 — GET /api/meetings/{id}/chat/stream (FRONTEND_00 8-6-3).
// EventSource는 Authorization 헤더를 붙일 수 없어 fetch 스트림으로 읽는다(openStream: Bearer 헤더, 401이면 refresh 후 1회 재시도).
//
// 서버 이벤트
//   `: connected`                                   연결 완료(주석 줄)
//   `id: N` + `event: message` + `data: {ChatMessage}`   새 메시지(id = streamSequence)
//   `event: replay-truncated` + `{lastSequence}`    접속 때 놓친 메시지가 200개를 넘음 → GET /chat/messages?afterSequence=N 으로 이어 받는다
//   `: heartbeat`                                   15초마다
//   `event: close` + `{reason}`                     서버가 연결을 닫는다 — TOKEN_EXPIRED만 새 토큰으로 재접속하고, 나머지는 다시 접속하지 않는다
// 제약: 같은 사용자·같은 회의에서 동시에 2개까지(3번째는 429 RATE_LIMIT_EXCEEDED).
import { ApiError } from "./errors";
import { openStream } from "./http";
import type { ChatMessageResponse } from "./meeting";
import type { Uuid } from "./types";

// 알 수 없는 사유가 올 수 있으므로 string도 허용한다.
export type ChatCloseReason =
  | "MEETING_END_PREPARING" | "MEETING_ENDED" | "PARTICIPANT_REMOVED" | "RECORD_ACCESS_REVOKED" | "ACCESS_CHANGED" | "TOKEN_EXPIRED" | (string & {});

export interface ChatStreamHandlers {
  /** 새 메시지. 재접속 직후에는 이미 받은 번호가 다시 올 수 있으니 streamSequence로 건너뛴다. */
  onMessage: (m: ChatMessageResponse) => void;
  /** 접속(또는 재접속)에 성공했다. */
  onOpen?: (reconnected: boolean) => void;
  /** 접속 때 놓친 메시지가 너무 많아 일부만 왔다. lastSequence 뒤를 GET /chat/messages로 이어 받는다. */
  onReplayTruncated?: (lastSequence: number) => void;
  /** 서버가 연결을 닫았고 다시 접속하지 않는다(TOKEN_EXPIRED 제외). */
  onClosed?: (reason: ChatCloseReason) => void;
  /** 다시 시도해도 소용없는 오류(권한 없음·채팅 닫힘 등)라 스트림을 멈췄다. */
  onFatal?: (e: ApiError) => void;
  /** 일시적 오류. 곧 재접속한다. */
  onRetry?: (e: unknown) => void;
}

const RETRY_MIN_MS = 3000; // 서버가 `retry: 3000`을 준다
const RETRY_MAX_MS = 30000;

export interface SseEvent { event: string; id?: string; data: string }

// text/event-stream 한 덩어리(빈 줄로 끝남)를 이벤트로 바꾼다. 주석 줄(`:`)과 retry는 이벤트가 아니므로 null.
export function parseSseChunk(chunk: string): SseEvent | null {
  let event = "message";
  let id: string | undefined;
  const data: string[] = [];
  let any = false;
  for (const line of chunk.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    const i = line.indexOf(":");
    const field = i === -1 ? line : line.slice(0, i);
    const value = i === -1 ? "" : line.slice(i + 1).replace(/^ /, "");
    if (field === "event") { event = value; any = true; }
    else if (field === "id") { id = value; any = true; }
    else if (field === "data") { data.push(value); any = true; }
  }
  return any ? { event, id, data: data.join("\n") } : null;
}

export function openMeetingChatStream(
  meetingId: Uuid,
  /** 지금까지 화면에 반영한 마지막 streamSequence. 재접속 때마다 다시 읽어 그 뒤부터 받는다. */
  getLastSequence: () => number,
  h: ChatStreamHandlers,
): { stop: () => void } {
  const controller = new AbortController();
  const { signal } = controller;
  const sleep = (ms: number) => new Promise<void>(resolve => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });

  (async () => {
    let backoff = RETRY_MIN_MS;
    let connectedOnce = false;
    while (!signal.aborted) {
      let closeReason: string | null = null;
      try {
        const after = getLastSequence();
        const res = await openStream(`/api/meetings/${meetingId}/chat/stream?afterSequence=${after}`, signal, false, after > 0 ? { "Last-Event-ID": String(after) } : {});
        if (!res.ok) {
          // 성공이 아니면 본문은 SSE가 아니라 공통 실패 JSON이다.
          let body: { errorCode?: string; message?: string; requestId?: string } | null = null;
          try { body = await res.json(); } catch { /* 게이트웨이·프록시 응답 */ }
          const err = new ApiError(res.status, body?.errorCode ?? "UNKNOWN_ERROR", body?.message ?? "채팅 스트림을 열 수 없습니다.", body?.requestId);
          // 429(동시 스트림 초과)와 5xx는 잠시 뒤 다시, 나머지(401 갱신 실패·403·404·409 MEETING_CHAT_CLOSED·400)는 다시 해도 같다.
          if (res.status === 429 || res.status >= 500) throw err;
          h.onFatal?.(err);
          return;
        }
        if (!res.body) throw new Error("empty stream body");
        h.onOpen?.(connectedOnce);
        connectedOnce = true;
        backoff = RETRY_MIN_MS;

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true }).replace(/\r\n?/g, "\n");
          let idx: number;
          while ((idx = buf.indexOf("\n\n")) !== -1) {
            const ev = parseSseChunk(buf.slice(0, idx));
            buf = buf.slice(idx + 2);
            if (!ev) continue;
            if (ev.event === "message") {
              try { h.onMessage(JSON.parse(ev.data)); } catch { /* 손상된 청크는 무시한다 */ }
            } else if (ev.event === "replay-truncated") {
              try { h.onReplayTruncated?.(Number(JSON.parse(ev.data).lastSequence)); } catch { /* noop */ }
            } else if (ev.event === "close") {
              try { closeReason = String(JSON.parse(ev.data).reason ?? "UNKNOWN"); } catch { closeReason = "UNKNOWN"; }
            }
          }
          if (closeReason) { await reader.cancel().catch(() => {}); break; }
        }
      } catch (e) {
        if (signal.aborted) return;
        h.onRetry?.(e);
        await sleep(backoff);
        backoff = Math.min(backoff * 2, RETRY_MAX_MS);
        continue;
      }
      if (signal.aborted) return;
      if (closeReason === "TOKEN_EXPIRED") continue; // 새 토큰으로 마지막 id 뒤부터 다시 접속(openStream이 401이면 refresh한다)
      if (closeReason) { h.onClosed?.(closeReason); return; }
      // close 이벤트 없이 끊김(게이트웨이·네트워크) — 마지막 번호 뒤부터 다시 접속한다.
      h.onRetry?.(new Error("stream ended"));
      await sleep(backoff);
    }
  })();

  return { stop: () => controller.abort() };
}
