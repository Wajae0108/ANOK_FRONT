// 회의 채팅 상태 — 지난 메시지(REST) + 실시간 수신(SSE)을 하나로 합친다.
// 같은 사용자가 같은 회의에서 열 수 있는 스트림은 동시에 2개뿐이라(3번째는 429), 화면 전체에서 이 훅을 한 번만 쓰고 결과를 내려 준다.
import { useCallback, useEffect, useRef, useState } from "react";
import { openMeetingChatStream } from "../api/chatStream";
import type { ChatCloseReason } from "../api/chatStream";
import { ApiError, errorText } from "../api/errors";
import * as api from "../api/meeting";
import type { ChatMessageResponse, MeetingResponse } from "../api/meeting";

export type ChatConnection = "idle" | "connecting" | "live" | "reconnecting" | "closed" | "failed";

// 서버가 연결을 닫은 이유 → 화면 안내. TOKEN_EXPIRED는 훅이 알아서 재접속하므로 여기 오지 않는다.
export const CHAT_CLOSE_TEXT: Record<string, string> = {
  MEETING_END_PREPARING: "회의 종료 처리가 시작되어 채팅이 닫혔습니다.",
  MEETING_ENDED: "회의가 종료되어 채팅이 닫혔습니다.",
  PARTICIPANT_REMOVED: "이 회의의 참가자에서 제외되어 채팅이 닫혔습니다.",
  RECORD_ACCESS_REVOKED: "기록 접근 권한이 회수되어 채팅이 닫혔습니다.",
  ACCESS_CHANGED: "접근 권한이 바뀌어 채팅이 닫혔습니다. 화면을 새로고침해 주세요.",
};

export interface MeetingChat {
  messages: ChatMessageResponse[];
  connection: ChatConnection;
  /** 서버가 닫은 이유(closed일 때). */
  closeReason: ChatCloseReason | null;
  /** 채팅을 쓸 수 없는 사유(권한·채팅 닫힘 등 — failed일 때). */
  failure: string | null;
  sending: boolean;
  /** 마지막 전송 실패 사유. 입력을 지우지 않고 다시 보내게 한다. */
  sendError: string | null;
  send: (text: string) => Promise<boolean>;
}

const MAX_TEXT = 4000;
// 줄바꿈·탭 외의 제어문자는 서버가 400 INVALID_CHARACTERS로 거절한다.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
export function validateChatText(text: string): string | null {
  const t = text.trim();
  if (!t) return "메시지를 입력해 주세요.";
  if (t.length > MAX_TEXT) return `메시지는 ${MAX_TEXT}자까지 보낼 수 있습니다.`;
  if (CONTROL_CHARS.test(t)) return "사용할 수 없는 문자가 있습니다.";
  return null;
}

/**
 * @param m 회의. status가 IN_PROGRESS이고 내가 참여 중(ACTIVE)·기록 접근권(GRANTED)일 때만 연결한다.
 * @param onServerClosed 서버가 스트림을 닫았을 때(종료·제외·권한 회수). 화면은 회의 상세를 다시 읽는다.
 */
export function useMeetingChat(m: MeetingResponse, onServerClosed?: (reason: ChatCloseReason) => void): MeetingChat {
  const enabled = m.status === "IN_PROGRESS" && m.myParticipationStatus === "ACTIVE" && m.myRecordAccessState === "GRANTED";
  const [messages, setMessages] = useState<ChatMessageResponse[]>([]);
  const [connection, setConnection] = useState<ChatConnection>("idle");
  const [closeReason, setCloseReason] = useState<ChatCloseReason | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const lastSeq = useRef(0);
  const closedCb = useRef(onServerClosed);
  closedCb.current = onServerClosed;
  // 재전송 중복 방지: 같은 문장을 다시 보낼 때만 같은 clientMessageId를 쓴다(응답을 못 받은 경우).
  const pending = useRef<{ text: string; id: string } | null>(null);

  // 번호(streamSequence) 기준으로 합친다. 재접속·replay 때 같은 번호가 다시 올 수 있다.
  const merge = useCallback((incoming: ChatMessageResponse[]) => {
    if (!incoming.length) return;
    setMessages(prev => {
      const seen = new Set(prev.map(x => x.streamSequence));
      const add = incoming.filter(x => !seen.has(x.streamSequence));
      if (!add.length) return prev;
      return [...prev, ...add].sort((a, b) => a.streamSequence - b.streamSequence);
    });
    for (const x of incoming) if (x.streamSequence > lastSeq.current) lastSeq.current = x.streamSequence;
  }, []);

  const catchUp = useCallback(async () => {
    // hasMore면 마지막 번호부터 이어서 받는다(replay-truncated일 때도 같다).
    for (let i = 0; i < 50; i++) {
      const page = await api.listChatMessages(m.meetingId, { afterSequence: lastSeq.current, limit: 100 });
      merge(page.items);
      if (!page.hasMore || page.items.length === 0) break;
    }
  }, [m.meetingId, merge]);

  useEffect(() => {
    if (!enabled) { setConnection(c => (c === "closed" || c === "failed" ? c : "idle")); return; }
    let alive = true;
    setConnection("connecting"); setCloseReason(null); setFailure(null);
    let stream: { stop: () => void } | null = null;
    (async () => {
      try {
        await catchUp();
      } catch (e) {
        if (!alive) return;
        if (e instanceof ApiError && (e.status === 403 || e.status === 409 || e.status === 404)) { setConnection("failed"); setFailure(errorText(e)); return; }
        // 일시 오류는 스트림이 replay로 메워 주므로 계속 진행한다.
      }
      if (!alive) return;
      stream = openMeetingChatStream(m.meetingId, () => lastSeq.current, {
        onMessage: x => merge([x]),
        onOpen: reconnected => { if (alive) setConnection("live"); if (reconnected && alive) void catchUp().catch(() => {}); },
        onReplayTruncated: () => { void catchUp().catch(() => {}); },
        onRetry: () => { if (alive) setConnection("reconnecting"); },
        onClosed: reason => { if (!alive) return; setConnection("closed"); setCloseReason(reason); closedCb.current?.(reason); },
        onFatal: err => { if (!alive) return; setConnection("failed"); setFailure(errorText(err)); },
      });
    })();
    return () => { alive = false; stream?.stop(); };
  }, [enabled, m.meetingId, catchUp, merge]);

  const send = useCallback(async (raw: string) => {
    const bad = validateChatText(raw);
    if (bad) { setSendError(bad); return false; }
    const text = raw.trim();
    const clientMessageId = pending.current && pending.current.text === text ? pending.current.id : crypto.randomUUID();
    pending.current = { text, id: clientMessageId };
    setSending(true); setSendError(null);
    try {
      const msg = await api.sendChatMessage(m.meetingId, text, clientMessageId);
      pending.current = null;
      merge([msg]); // SSE로도 오지만 번호로 합치므로 중복되지 않는다
      return true;
    } catch (e) {
      // 429: 사용자·회의당 한 번에 10개, 이후 초당 1개. 같은 문장을 다시 보내도 중복되지 않는다.
      setSendError(e instanceof ApiError && e.errorCode === "RATE_LIMIT_EXCEEDED" ? "메시지를 너무 빠르게 보내고 있습니다. 잠시 후 다시 보내 주세요." : errorText(e));
      return false;
    } finally { setSending(false); }
  }, [m.meetingId, merge]);

  return { messages, connection, closeReason, failure, sending, sendError, send };
}
