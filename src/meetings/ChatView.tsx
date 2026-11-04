// 채팅 표시·입력 — 채팅 탭과 회의방 오버레이가 같이 쓴다(둘이 각자 스트림을 열면 동시 2개 제한에 걸리기 쉽다).
// 메시지 본문은 사용자 입력이므로 일반 텍스트로만 출력한다(XSS).
import { useEffect, useRef, useState } from "react";
import { CHAT_CLOSE_TEXT } from "./useMeetingChat";
import { parseDocShare } from "./docShare";
import type { MeetingChat } from "./useMeetingChat";
import type { MeetingResponse } from "../api/meeting";
import { inputCls, primaryBtn } from "../ui/kit";

const CONN_TEXT: Record<string, string> = { connecting: "연결 중...", reconnecting: "연결이 끊겨 다시 연결하는 중...", live: "", idle: "", closed: "", failed: "" };

export default function ChatView({ m, chat, myUserId, nameOf, variant, header, onOpenDoc }: {
  m: MeetingResponse; chat: MeetingChat; myUserId?: string; nameOf: (id?: string | null) => string;
  /** panel: 회의방 오른쪽 패널(좁음), tab: 채팅 탭 */
  variant: "panel" | "tab"; header?: React.ReactNode;
  /** 채팅에 공유된 문서의 "열기"를 눌렀을 때. 없으면 문서 공유 메시지도 일반 글자로 보인다. */
  onOpenDoc?: (documentId: string) => void;
}) {
  const [text, setText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inProgress = m.status === "IN_PROGRESS";
  const canWrite = inProgress && chat.connection !== "failed" && chat.connection !== "closed";
  const panel = variant === "panel";

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [chat.messages.length]);

  async function submit() {
    if (chat.sending) return;
    if (await chat.send(text)) setText("");
    // 실패하면 입력을 그대로 둔다 — 다시 누르면 같은 clientMessageId로 재전송되어 중복 메시지가 생기지 않는다.
  }

  const trimmed = text.trim();
  const tooLong = trimmed.length > 4000;
  const notice = chat.connection === "closed" && chat.closeReason ? (CHAT_CLOSE_TEXT[chat.closeReason] ?? "서버가 채팅을 닫았습니다.")
    : chat.connection === "failed" ? chat.failure
    : !inProgress ? (m.status === "SCHEDULED" ? "회의가 시작되면 채팅을 쓸 수 있습니다." : "채팅은 진행 중인 회의에서만 쓸 수 있고, 끝난 뒤에는 다시 읽을 수 없습니다.")
    : CONN_TEXT[chat.connection];

  return (
    <div className={panel ? "w-80 shrink-0 bg-white m-4 ml-0 rounded-2xl flex flex-col overflow-hidden" : "max-w-2xl flex flex-col h-full"}>
      {header}
      <div ref={scrollRef} className={panel ? "flex-1 overflow-y-auto px-4 py-3 space-y-2" : "flex-1 overflow-y-auto space-y-2 pb-3"} style={panel ? undefined : { maxHeight: "60vh" }}>
        {chat.messages.length === 0 && <p className="text-[12px] text-slate-400 text-center py-8">아직 채팅이 없습니다.</p>}
        {chat.messages.map(msg => {
          const mine = msg.senderUserId === myUserId;
          return (
            <div key={msg.messageId} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`${panel ? "max-w-[85%]" : "max-w-[75%]"} rounded-2xl px-3 ${panel ? "py-1.5" : "py-2"} ${mine ? "bg-indigo-500 text-white" : panel ? "bg-slate-100 text-slate-700" : "bg-white border border-slate-100 text-slate-700"}`}>
                {!mine && <p className="text-[10px] font-bold opacity-60 mb-0.5">{nameOf(msg.senderUserId)}</p>}
                {(() => {
                  const share = onOpenDoc ? parseDocShare(msg.text) : null;
                  if (!share) return <p className={`${panel ? "text-[12.5px]" : "text-[13px]"} leading-snug whitespace-pre-wrap break-words`}>{msg.text}</p>;
                  // 문서 공유 메시지: 제목과 "열기" 버튼. 제목은 보낸 사람이 쓴 글자이므로 일반 텍스트로만 그린다.
                  return (
                    <button type="button" onClick={() => onOpenDoc!(share.documentId)} aria-label={`공유된 문서 열기: ${share.title}`}
                      className={`flex items-center gap-2 text-left rounded-xl px-2.5 py-2 -mx-1 border transition-colors ${mine ? "border-white/30 bg-white/10 hover:bg-white/20" : "border-slate-200 bg-white hover:bg-indigo-50"}`}>
                      <span aria-hidden className="text-[16px]">📎</span>
                      <span className="min-w-0">
                        <span className={`block text-[10px] font-bold ${mine ? "text-white/70" : "text-slate-400"}`}>문서 공유</span>
                        <span className={`block ${panel ? "text-[12.5px]" : "text-[13px]"} font-semibold leading-snug break-words`}>{share.title}</span>
                        <span className={`block text-[10px] font-semibold mt-0.5 ${mine ? "text-white/80" : "text-indigo-500"}`}>눌러서 열기</span>
                      </span>
                    </button>
                  );
                })()}
              </div>
            </div>
          );
        })}
      </div>
      {notice && <p className={`text-[11px] text-center ${panel ? "px-3 pb-1" : "pb-1"} ${chat.connection === "failed" || chat.connection === "closed" ? "text-amber-600" : "text-slate-400"}`}>{notice}</p>}
      {canWrite && (
        <div className={`shrink-0 ${panel ? "p-3 border-t border-slate-100" : "pt-2 border-t border-slate-100"}`}>
          <div className="flex gap-2">
            <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) void submit(); }}
              placeholder="메시지 입력..." aria-label="메시지 입력" className={inputCls} />
            <button disabled={chat.sending || !trimmed || tooLong} onClick={submit} className={primaryBtn}>전송</button>
          </div>
          {(chat.sendError || tooLong) && <p className="text-[11px] text-rose-500 mt-1">{tooLong ? "메시지는 4000자까지 보낼 수 있습니다." : chat.sendError}</p>}
        </div>
      )}
    </div>
  );
}
