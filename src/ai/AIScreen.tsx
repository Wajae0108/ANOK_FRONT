// Anok_06 — AI 질문(Interactive RAG). MVP는 PROJECT 스코프만 지원한다(§5 AI-API-02, COMPANY_WIDE 없음).
// 문서/회의 상세 화면에서의 스코프 대화는 추후 각 화면에 진입점을 추가할 수 있으나, 이 화면은 전역 진입점이므로
// 프로젝트 스코프만 제공한다.
import { useEffect, useRef, useState } from "react";
import * as ai from "../api/ai";
import type { ConversationSummaryResponse, SourceRef } from "../api/ai";
import * as prj from "../api/project";
import { errorText } from "../api/errors";
import { Spinner, useLoad } from "../ui/kit";
import { createAiStreamController } from "./streamController";

const ERROR_TEXT: Record<string, string> = {
  AI_DISABLED: "회사 관리자가 AI 기능을 비활성화했습니다.",
  AI_SCOPE_ACCESS_DENIED: "이 프로젝트에 대한 접근 권한이 없어 AI에게 물어볼 수 없습니다.",
  AI_PROCESSING_BLOCKED_BY_POLICY: "민감한 정보(API 키, 개인정보 등)가 감지되어 요청이 차단되었습니다.",
  AI_GENERATION_ALREADY_IN_PROGRESS: "이미 답변을 생성하는 중입니다. 완료 후 다시 시도해 주세요.",
  AI_QUOTA_EXCEEDED: "AI 사용량 한도를 초과했습니다.",
  AI_CONCURRENCY_LIMIT: "동시 요청이 많아 잠시 후 다시 시도해 주세요.",
  AI_PROVIDER_UNAVAILABLE: "AI 응답 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.",
  AI_CONVERSATION_CLOSED: "종료된 대화입니다. 새 대화를 시작해 주세요.",
};
function friendly(code: string) { return ERROR_TEXT[code] ?? "요청을 처리할 수 없습니다."; }

type ChatMsg = { id: string; role: "USER" | "ASSISTANT"; text: string; sources: SourceRef[]; pending?: boolean; error?: string; placeholder?: string };

const AiIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>;
const SourceIcon = () => <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>;
const SendIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>;

export default function AIScreen({ initialQuestion }: { initialQuestion?: string }) {
  const { data: projectPage, loading: loadingProjects } = useLoad(() => prj.listProjects({ status: "ACTIVE", limit: 100 }), []);
  const [projectId, setProjectId] = useState("");
  const [conv, setConv] = useState<ConversationSummaryResponse | null>(null);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState(initialQuestion ?? "");
  const [busy, setBusy] = useState(false);
  const [loadingConv, setLoadingConv] = useState(false);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  // 대화/스코프가 바뀔 때마다 이전 스트림을 취소하고, 취소 이후 도착하는 콜백은 컨트롤러가 세대 비교로 무시한다.
  const [stream] = useState(() => createAiStreamController());

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);
  useEffect(() => () => stream.cancel(), [stream]); // 언마운트 시 진행 중이던 스트림 정리

  // 프로젝트 전환/새 대화 시작처럼 지금 보이는 대화를 통째로 바꾸는 지점에서 호출한다.
  // 진행 중이던 스트림을 취소하고, 그 스트림이 다시 꺼주지 못하게 된 busy 상태를 직접 되돌린다.
  function abandonActiveStream() {
    stream.cancel();
    setBusy(false);
  }

  async function openScope(pid: string) {
    abandonActiveStream();
    setProjectId(pid); setConv(null); setMsgs([]); setScopeError(null);
    if (!pid) return;
    setLoadingConv(true);
    try {
      const existing = await ai.listConversations({ scopeType: "PROJECT", status: "ACTIVE", limit: 20 });
      const found = existing.items.find(c => c.scopeResourceId === pid);
      if (found) {
        setConv(found);
        const detail = await ai.getConversation(found.conversationId);
        setMsgs(detail.messages.map(m => ({ id: m.messageId, role: m.role, text: m.content ?? "", sources: m.sources, placeholder: m.placeholder })));
      } else {
        setConv(await ai.createConversation({ scopeType: "PROJECT", scopeResourceId: pid }));
      }
    } catch (e) { setScopeError(errorText(e)); }
    finally { setLoadingConv(false); }
  }

  async function startNewConversation() {
    if (!projectId) return;
    abandonActiveStream();
    if (conv?.status === "ACTIVE") { try { await ai.closeConversation(conv.conversationId); } catch { /* 이미 종료됐거나 실패해도 새 대화 생성은 계속 진행 */ } }
    setMsgs([]); setScopeError(null); setLoadingConv(true);
    try { setConv(await ai.createConversation({ scopeType: "PROJECT", scopeResourceId: projectId })); }
    catch (e) { setScopeError(errorText(e)); }
    finally { setLoadingConv(false); }
  }

  function send() {
    if (!input.trim() || !conv || busy) return;
    const question = input.trim();
    setInput(""); setBusy(true);
    const userMsgId = crypto.randomUUID();
    const assistantId = crypto.randomUUID();
    setMsgs(p => [...p, { id: userMsgId, role: "USER", text: question, sources: [] }, { id: assistantId, role: "ASSISTANT", text: "", sources: [], pending: true }]);
    stream.start(conv.conversationId, { content: question }, {
      onDelta: t => setMsgs(p => p.map(m => m.id === assistantId ? { ...m, text: m.text + t } : m)),
      onSource: s => setMsgs(p => p.map(m => m.id === assistantId ? { ...m, sources: [...m.sources, s] } : m)),
      onCompleted: () => { setMsgs(p => p.map(m => m.id === assistantId ? { ...m, pending: false } : m)); setBusy(false); },
      onError: e => { setMsgs(p => p.map(m => m.id === assistantId ? { ...m, pending: false, error: friendly(e.errorCode) } : m)); setBusy(false); },
    });
  }

  const projects = projectPage?.items ?? [];
  const EXAMPLE_QUESTIONS = ["이 프로젝트 진행 상황을 요약해줘", "최근 결정된 내용이 뭐야?", "업무 현황이 어떻게 돼?"];

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="shrink-0 px-6 py-3 bg-white border-b border-slate-100 flex items-center gap-3">
        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">질문 맥락</span>
        {loadingProjects ? <span className="text-[12px] text-slate-400">프로젝트 불러오는 중...</span> : (
          <select value={projectId} onChange={e => openScope(e.target.value)}
            className="text-[12px] border border-slate-200 rounded-xl px-3 py-1.5 text-slate-600 outline-none focus:border-indigo-300 transition-colors bg-white">
            <option value="">프로젝트를 선택하세요</option>
            {projects.map(p => <option key={p.projectId} value={p.projectId}>{p.name}</option>)}
          </select>
        )}
        {conv && <button onClick={startNewConversation} className="ml-auto text-[11px] text-indigo-500 font-semibold hover:text-indigo-700">새 대화 시작</button>}
      </div>

      {!projectId && (
        <div className="flex-1 flex items-center justify-center text-center px-6">
          <div>
            <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center mx-auto mb-4 text-indigo-400"><AiIcon /></div>
            <p className="text-[14px] font-bold text-slate-700">질문할 프로젝트를 선택하세요</p>
            <p className="text-[12px] text-slate-400 mt-1">접근 권한이 있는 프로젝트의 결정·업무 현황을 기반으로 답변합니다.</p>
          </div>
        </div>
      )}

      {projectId && loadingConv && <Spinner text="대화를 준비하는 중..." />}
      {projectId && !loadingConv && scopeError && (
        <div className="flex-1 flex items-center justify-center text-center px-6">
          <div>
            <p className="text-[14px] font-bold text-rose-500">AI에게 물어볼 수 없습니다</p>
            <p className="text-[12px] text-slate-400 mt-1">{scopeError}</p>
          </div>
        </div>
      )}

      {projectId && !loadingConv && !scopeError && conv && (
        <>
          <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-50/40">
            {msgs.length === 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-wide mb-2">예시 질문</p>
                {EXAMPLE_QUESTIONS.map(q => (
                  <button key={q} onClick={() => setInput(q)} className="text-left text-[13px] text-slate-600 px-4 py-3 bg-white border border-slate-100 rounded-xl hover:border-indigo-200 hover:text-indigo-600 transition-all">{q}</button>
                ))}
              </div>
            )}
            {msgs.map(m => (
              <div key={m.id} className={`flex gap-3 ${m.role === "USER" ? "flex-row-reverse" : ""}`}>
                {m.role === "ASSISTANT" && <div className="w-8 h-8 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0 text-indigo-400 mt-0.5"><AiIcon /></div>}
                <div className={`max-w-[70%] ${m.role === "USER" ? "items-end" : "items-start"} flex flex-col gap-1`}>
                  <div className={`px-4 py-3 rounded-2xl text-[13px] leading-relaxed whitespace-pre-wrap ${m.role === "USER" ? "bg-indigo-500 text-white rounded-tr-sm" : m.error ? "bg-rose-50 border border-rose-100 text-rose-700 rounded-tl-sm" : "bg-white border border-slate-100 text-slate-700 rounded-tl-sm"}`}>
                    {m.error ? m.error
                      : m.placeholder ? m.placeholder
                      : m.pending && !m.text ? <span className="flex items-center gap-2 text-slate-400"><span className="w-4 h-4 border-2 border-slate-300 border-t-indigo-400 rounded-full animate-spin" />생각 중...</span>
                      : m.text}
                  </div>
                  {m.sources.length > 0 && (
                    <div className="flex flex-col gap-1 mt-1">
                      {m.sources.map(s => (
                        <div key={s.sourceId} className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 rounded-xl text-[11px] text-slate-500 font-medium"><SourceIcon />{s.label}</div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>

          <div className="shrink-0 p-4 bg-white border-t border-slate-100">
            <div className="flex items-end gap-3 bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 focus-within:border-indigo-300 transition-colors">
              <textarea value={input} onChange={e => setInput(e.target.value)} placeholder="질문을 입력하세요..." rows={1}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                className="flex-1 bg-transparent text-[13px] text-slate-700 placeholder-slate-400 outline-none resize-none" />
              <button onClick={send} disabled={!input.trim() || busy} className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all shrink-0 ${input.trim() && !busy ? "bg-indigo-500 hover:bg-indigo-600" : "bg-slate-200"}`}><SendIcon /></button>
            </div>
            <p className="text-[10px] text-slate-300 mt-2 text-center">접근 권한이 있는 자료만 인용합니다 · 일반 사용자는 모델을 변경할 수 없습니다</p>
          </div>
        </>
      )}
    </div>
  );
}
