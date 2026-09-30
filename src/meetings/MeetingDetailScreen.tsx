// Anok_04 — 회의 상세: 개요/참가자/채팅/회의록·후보.
// 실시간 SSE 대신 replay 폴링(2초 간격)으로 채팅을, getMeetingPostprocess 폴링으로 AI 처리 진행을 대체한다.
// LiveKit 실 미디어 연결은 프론트 범위 밖 — "회의 참가"는 issueLiveKitToken()으로 서버 측 권한 검증만 재현한다.
import { useEffect, useRef, useState } from "react";
import * as api from "../api/meeting";
import type { CandidateType, MeetingCandidateResponse, MeetingParticipantResponse, MeetingResponse, MeetingSensitivity } from "../api/meeting";
import * as prj from "../api/project";
import * as doc from "../api/document";
import type { MeetingAttachmentResponse } from "../api/document";
import { errorText, fieldErrorMap } from "../api/errors";
import { useAuth } from "../auth/AuthProvider";
import { Avatar, Card, ErrorBox, Field, ghostBtn, inputCls, Modal, primaryBtn, Section, Spinner, useLoad } from "../ui/kit";
import { useOrgUsers } from "../projects/shared";
import { fmtSize, PermissionBadge } from "../documents/shared";
import {
  CandidateStatusBadge, fmtDateTime, MeetingStatusBadge, MinutesStatusBadge, ParticipationBadge,
  PostprocessBadge, RecordAccessBadge, SENSITIVITY_LEVELS, SENS_RANK, SensitivityBadge,
} from "./shared";

type Tab = "개요" | "참가자" | "채팅" | "자료" | "회의록·후보";
const TABS: Tab[] = ["개요", "참가자", "채팅", "자료", "회의록·후보"];

function Msg({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return <p className={`text-[12px] font-medium ${msg.ok ? "text-emerald-600" : "text-rose-500"}`}>{msg.text}</p>;
}

// ───────────────────────── 화상 회의 (셸 — 실 영상/음성 송수신 없음) ─────────────────────────
// LiveKit 서버 연동 전 UI 레이아웃 선구현. 마이크는 브라우저 getUserMedia로 실제 연결해 로컬에서 음성 크기를 감지하지만,
// 다른 참가자에게 전송하지는 않는다(그러려면 LiveKit 같은 미디어 서버가 필요 — 프론트 범위 밖). 카메라/실제 송출은 미구현.
function MicIcon({ on }: { on: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="11" rx="3" /><path d="M5 10a7 7 0 0 0 14 0" /><line x1="12" y1="19" x2="12" y2="22" />
      {!on && <line x1="3" y1="3" x2="21" y2="21" />}
    </svg>
  );
}
function CamIcon({ on }: { on: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 8l-6 4 6 4V8z" /><rect x="2" y="6" width="14" height="12" rx="2" />
      {!on && <line x1="1" y1="1" x2="23" y2="23" />}
    </svg>
  );
}

// 마이크가 켜져 있는 동안 실제 오디오 트랙을 붙잡아 볼륨(RMS)으로 발화 여부만 로컬 판정한다. 전송/녹음은 하지 않는다.
function useMicLevel(active: boolean, onError: (msg: string) => void) {
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    if (!active) { setSpeaking(false); return; }
    let alive = true;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let raf = 0;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!alive) { stream.getTracks().forEach(t => t.stop()); return; }
        ctx = new AudioContext();
        if (ctx.state === "suspended") await ctx.resume();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser); // destination엔 연결하지 않음 — 스피커로 되먹임되지 않게
        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          if (!alive) return;
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
          setSpeaking(Math.sqrt(sum / data.length) > 0.05);
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch (e) {
        if (!alive) return;
        const name = e instanceof DOMException ? e.name : "";
        onError(name === "NotAllowedError" ? "마이크 권한이 거부되었습니다." : name === "NotFoundError" ? "사용 가능한 마이크 장치가 없습니다." : "마이크에 연결할 수 없습니다.");
      }
    })();
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach(t => t.stop());
      if (ctx && ctx.state !== "closed") ctx.close();
    };
  }, [active]);
  return speaking;
}

// ───────────────────────── 회의방 채팅 (파일 공유) ─────────────────────────
function RoomChatPanel({ m, myUserId, nameOf }: { m: MeetingResponse; myUserId?: string; nameOf: (id?: string | null) => string }) {
  const [messages, setMessages] = useState<api.ChatMessageResponse[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const lastSeq = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const r = await api.listChatMessages(m.meetingId, { afterSequence: lastSeq.current, limit: 100 });
        if (!alive || r.items.length === 0) return;
        lastSeq.current = r.lastSequence;
        setMessages(prev => [...prev, ...r.items]);
      } catch { /* 폴링 실패는 조용히 무시하고 다음 주기에 재시도 */ }
    }
    poll();
    const iv = setInterval(poll, m.status === "IN_PROGRESS" ? 2000 : 6000);
    return () => { alive = false; clearInterval(iv); };
  }, [m.meetingId, m.status]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [messages.length]);

  async function send() {
    if (!text.trim()) return;
    setSending(true);
    try { await api.sendChatMessage(m.meetingId, text.trim()); setText(""); }
    catch { /* 실패 시 사용자가 재전송하도록 입력값 유지 */ }
    finally { setSending(false); }
  }
  async function afterUpload(a: MeetingAttachmentResponse) {
    setShowUpload(false);
    try { await api.sendChatMessage(m.meetingId, `[문서 공유] ${a.title}`); } catch { /* 채팅 알림 실패는 무시 — 자료 탭에서 확인 가능 */ }
  }

  return (
    <div className="w-80 shrink-0 bg-white m-4 ml-0 rounded-2xl flex flex-col overflow-hidden">
      {showUpload && <UploadAttachmentModal meetingId={m.meetingId} onClose={() => setShowUpload(false)} onUploaded={afterUpload} />}
      <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <p className="text-[13px] font-bold text-slate-800">채팅</p>
        {m.status === "IN_PROGRESS" && <button onClick={() => setShowUpload(true)} className="text-[11px] text-indigo-500 font-semibold hover:text-indigo-700">문서 업로드</button>}
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {messages.length === 0 && <p className="text-[12px] text-slate-400 text-center py-8">아직 채팅이 없습니다.</p>}
        {messages.map(msg => {
          const mine = msg.senderUserId === myUserId;
          return (
            <div key={msg.messageId} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-3 py-1.5 ${mine ? "bg-indigo-500 text-white" : "bg-slate-100 text-slate-700"}`}>
                {!mine && <p className="text-[10px] font-bold opacity-60 mb-0.5">{nameOf(msg.senderUserId)}</p>}
                <p className="text-[12.5px] leading-snug whitespace-pre-wrap">{msg.text}</p>
              </div>
            </div>
          );
        })}
      </div>
      {m.status === "IN_PROGRESS" ? (
        <div className="shrink-0 flex gap-2 p-3 border-t border-slate-100">
          <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} placeholder="메시지 입력..." className={inputCls} />
          <button disabled={sending || !text.trim()} onClick={send} className={primaryBtn}>전송</button>
        </div>
      ) : (
        <p className="text-[11px] text-slate-400 text-center p-3 border-t border-slate-100">회의가 진행 중이 아닙니다.</p>
      )}
    </div>
  );
}

function VideoRoomShell({ m, myUserId, participants, nameOf, onLeave }: {
  m: MeetingResponse; myUserId?: string; participants: MeetingParticipantResponse[]; nameOf: (id?: string | null) => string; onLeave: () => void;
}) {
  const [micOn, setMicOn] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [camOn, setCamOn] = useState(false);
  const speaking = useMicLevel(micOn, msgText => { setMicError(msgText); setMicOn(false); });
  const tiles = participants.filter(p => p.participationStatus === "ACTIVE");

  function toggleMic() { setMicError(null); setMicOn(v => !v); }

  return (
    <div className="fixed inset-0 z-[300] bg-slate-900 flex flex-col">
      <div className="shrink-0 flex items-center justify-between px-5 py-3">
        <div>
          <p className="text-[13px] font-bold text-white">{m.title}</p>
          <p className="text-[11px] text-slate-400">마이크는 실제로 연결되어 음성 감지가 동작합니다(다른 참가자에게 전송되진 않음) · 카메라·LiveKit 연결은 미구현</p>
        </div>
        <button onClick={onLeave} className="text-[12px] text-slate-300 hover:text-white font-semibold">닫기</button>
      </div>
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-y-auto px-5 pb-3">
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>
            {tiles.map(p => {
              const isMe = p.userId === myUserId;
              const isSpeaking = isMe && micOn && speaking;
              return (
                <div key={p.participantId} className={`aspect-video bg-slate-800 rounded-2xl flex flex-col items-center justify-center gap-2 relative transition-all ${isSpeaking ? "ring-4 ring-emerald-400" : ""}`}>
                  {isMe && camOn ? (
                    <p className="text-[11px] text-slate-500 px-4 text-center">카메라 미리보기는 실제 연결 후 제공됩니다</p>
                  ) : (
                    <Avatar name={nameOf(p.userId)} seed={p.userId} size={56} />
                  )}
                  <p className="text-[12px] text-slate-200 font-semibold">{nameOf(p.userId)}{isMe && " (나)"}</p>
                  {isMe && !micOn && (
                    <span className="absolute bottom-2 left-2 w-6 h-6 rounded-full bg-rose-500/90 flex items-center justify-center text-white"><MicIcon on={false} /></span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <RoomChatPanel m={m} myUserId={myUserId} nameOf={nameOf} />
      </div>
      <div className="shrink-0 flex flex-col items-center gap-1.5 py-4">
        <div className="flex items-center justify-center gap-3">
          <button onClick={toggleMic} className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${micOn ? "bg-slate-700 text-white hover:bg-slate-600" : "bg-rose-500 text-white hover:bg-rose-600"}`}><MicIcon on={micOn} /></button>
          <button onClick={() => setCamOn(v => !v)} className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${camOn ? "bg-slate-700 text-white hover:bg-slate-600" : "bg-rose-500 text-white hover:bg-rose-600"}`}><CamIcon on={camOn} /></button>
          <button onClick={onLeave} className="px-5 h-11 rounded-full bg-rose-600 hover:bg-rose-700 text-white text-[13px] font-bold">나가기</button>
        </div>
        {micError && <p className="text-[11px] text-rose-400 font-medium">{micError}</p>}
      </div>
      <p className="text-center text-[10px] text-slate-500 pb-3">영상 송출과 참가자 간 실시간 오디오 송수신은 LiveKit 서버 연동 후 동작합니다.</p>
    </div>
  );
}

// ───────────────────────── 개요 ─────────────────────────
function OverviewTab({ m, isOrganizer, isReviewOwner, hasAccess, onChanged, nameOf, myUserId, participants }: {
  m: MeetingResponse; isOrganizer: boolean; isReviewOwner: boolean; hasAccess: boolean;
  onChanged: (m: MeetingResponse) => void; nameOf: (id?: string | null) => string;
  myUserId?: string; participants: MeetingParticipantResponse[];
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(m.title);
  const [description, setDescription] = useState(m.description ?? "");
  const [sensitivity, setSensitivity] = useState<MeetingSensitivity>(m.sensitivityClassification);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [password, setPassword] = useState("");
  const [inRoom, setInRoom] = useState(false);

  async function act(key: string, fn: () => Promise<MeetingResponse>, success: string) {
    setBusy(key); setMsg(null); setFields({});
    try { onChanged(await fn()); setMsg({ ok: true, text: success }); }
    catch (e) { setMsg({ ok: false, text: errorText(e) }); setFields(fieldErrorMap(e)); }
    finally { setBusy(null); }
  }
  async function joinFake() {
    setBusy("join"); setMsg(null);
    try { await api.issueLiveKitToken(m.meetingId); setInRoom(true); }
    catch (e) { setMsg({ ok: false, text: errorText(e) }); }
    finally { setBusy(null); }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <Section>회의 개요</Section>
          {isOrganizer && m.status === "SCHEDULED" && !editing && <button onClick={() => setEditing(true)} className="text-[11px] text-indigo-500 font-semibold hover:text-indigo-700">수정</button>}
        </div>
        {editing ? (
          <div className="space-y-3">
            <Field label="제목"><input value={title} onChange={e => setTitle(e.target.value)} maxLength={200} className={inputCls} /></Field>
            <Field label="설명"><textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} maxLength={2000} className={inputCls} /></Field>
            <Field label="민감도 분류">
              <div className="flex flex-wrap gap-2">
                {SENSITIVITY_LEVELS.map(v => (
                  <button key={v} disabled={SENS_RANK[v] < SENS_RANK[m.sensitivityClassification]} onClick={() => setSensitivity(v)}
                    className={`flex-1 min-w-[70px] py-2 rounded-xl border disabled:opacity-30 ${sensitivity === v ? "border-indigo-400 bg-indigo-50" : "border-slate-200"}`}>
                    <SensitivityBadge level={v} />
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-400 mt-1">민감도는 낮출 수 없습니다.</p>
            </Field>
            <div className="flex gap-2">
              <button onClick={() => setEditing(false)} className={`flex-1 ${ghostBtn}`}>취소</button>
              <button disabled={busy === "meta" || !title.trim()} onClick={() => act("meta", () => api.updateMeeting(m.meetingId, { title: title.trim(), description: description.trim() || null, sensitivityClassification: sensitivity, version: m.version }).then(r => { setEditing(false); return r; }), "저장했습니다.")} className={`flex-1 ${primaryBtn}`}>저장</button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-[14px] text-slate-700 leading-relaxed">{m.description || "설명이 없습니다."}</p>
            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-50">
              {[["주최자", nameOf(m.organizerUserId)], ["회의록 검토자", nameOf(m.reviewOwnerUserId)], ["시작 예정", fmtDateTime(m.scheduledStartAt)], ["실제 시작", fmtDateTime(m.startedAt)], ["종료", fmtDateTime(m.endedAt)], ["비밀번호", m.passwordProtected ? "설정됨" : "없음"]].map(([l, v]) => (
                <div key={l}><p className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">{l}</p><p className="text-[13px] font-bold text-slate-800 mt-0.5">{v}</p></div>
              ))}
            </div>
          </>
        )}
      </Card>

      {hasAccess && m.status === "IN_PROGRESS" && (
        <Card className="p-5 space-y-2">
          <Section>회의 참가</Section>
          <p className="text-[12px] text-slate-400">입장 권한을 확인한 뒤 화상 회의 화면 레이아웃을 미리 보여줍니다. 실제 카메라/마이크·LiveKit 연결은 아직 구현되어 있지 않습니다.</p>
          {m.passwordProtected && !isOrganizer && <input value={password} onChange={e => setPassword(e.target.value)} type="password" placeholder="회의 비밀번호" className={inputCls} />}
          <button disabled={busy === "join"} onClick={joinFake} className={primaryBtn}>{busy === "join" ? "확인 중..." : "회의 참가"}</button>
        </Card>
      )}

      {isOrganizer && (
        <Card className="p-5 space-y-3">
          <Section>회의 진행 관리</Section>
          <div className="flex flex-wrap gap-2">
            {m.status === "SCHEDULED" && <button disabled={!!busy} onClick={() => act("start", () => api.startMeeting(m.meetingId, { version: m.version }), "회의를 시작했습니다.")} className={primaryBtn}>회의 시작</button>}
            {m.status === "SCHEDULED" && <button disabled={!!busy} onClick={() => { if (confirm("회의를 취소하시겠습니까?")) act("cancel", () => api.cancelMeeting(m.meetingId, { version: m.version }), "회의를 취소했습니다."); }} className="px-4 py-2.5 border border-rose-200 text-rose-500 text-[13px] font-semibold rounded-xl hover:bg-rose-50 disabled:opacity-40">회의 취소</button>}
            {m.status === "IN_PROGRESS" && (
              <button disabled={!!busy} onClick={async () => {
                if (!confirm("회의를 종료하시겠습니까? 종료 후 AI가 회의록 초안을 생성합니다.")) return;
                setBusy("end"); setMsg(null);
                try { const r = await api.endMeeting(m.meetingId); onChanged(r.meeting); setMsg({ ok: true, text: "회의를 종료했습니다. 회의록·후보 탭에서 진행 상황을 확인하세요." }); }
                catch (e) { setMsg({ ok: false, text: errorText(e) }); } finally { setBusy(null); }
              }} className="px-4 py-2.5 bg-rose-500 hover:bg-rose-600 text-white text-[13px] font-bold rounded-xl transition-colors disabled:opacity-40">회의 종료</button>
            )}
          </div>
          {m.status === "SCHEDULED" && (
            <div className="pt-3 border-t border-slate-50 flex items-end gap-2">
              <div className="flex-1"><label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block mb-1">비밀번호 {m.passwordProtected ? "변경" : "설정"}</label>
                <input value={password} onChange={e => setPassword(e.target.value)} type="password" placeholder="새 비밀번호" className={inputCls} /></div>
              <button disabled={!password || !!busy} onClick={() => act("pw", () => api.setMeetingPassword(m.meetingId, { password, version: m.version }).then(() => { setPassword(""); return { ...m, passwordProtected: true }; }), "비밀번호를 설정했습니다.")} className={ghostBtn}>적용</button>
              {m.passwordProtected && <button disabled={!!busy} onClick={() => act("pwrm", () => api.removeMeetingPassword(m.meetingId).then(() => ({ ...m, passwordProtected: false })), "비밀번호를 제거했습니다.")} className={ghostBtn}>제거</button>}
            </div>
          )}
        </Card>
      )}
      <Msg msg={msg} />
      {isReviewOwner && !isOrganizer && <p className="text-[11px] text-slate-400">회의록 검토자로 지정되어 있어 회의록·후보 탭에서 승인/확정 권한이 있습니다.</p>}
      {inRoom && <VideoRoomShell m={m} myUserId={myUserId} participants={participants} nameOf={nameOf} onLeave={() => setInRoom(false)} />}
    </div>
  );
}

// ───────────────────────── 참가자 ─────────────────────────
function AddParticipantModal({ meetingId, projectId, existing, onClose, onAdded }: { meetingId: string; projectId: string; existing: Set<string>; onClose: () => void; onAdded: (p: MeetingParticipantResponse) => void }) {
  const { data, loading } = useLoad(() => prj.listProjectMembers(projectId, { status: "ACTIVE", limit: 100 }), [projectId]);
  const { nameOf } = useOrgUsers();
  const candidates = (data?.items ?? []).filter(mem => !existing.has(mem.userId));
  const [userId, setUserId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setError(null);
    try { onAdded(await api.addMeetingParticipant(meetingId, userId)); onClose(); }
    catch (e) { setError(errorText(e)); setBusy(false); }
  }
  return (
    <Modal title="참가자 추가" onClose={onClose}>
      {loading ? <Spinner /> : (
        <>
          <Field label="프로젝트 구성원">
            <select value={userId} onChange={e => setUserId(e.target.value)} className={inputCls}>
              <option value="">선택하세요</option>
              {candidates.map(mem => <option key={mem.membershipId} value={mem.userId}>{nameOf(mem.userId)}</option>)}
            </select>
          </Field>
          {error && <p className="text-[12px] text-rose-500 font-medium">{error}</p>}
          <div className="flex gap-2">
            <button onClick={onClose} className={`flex-1 ${ghostBtn}`}>취소</button>
            <button disabled={busy || !userId} onClick={submit} className={`flex-1 ${primaryBtn}`}>{busy ? "추가 중..." : "추가"}</button>
          </div>
        </>
      )}
    </Modal>
  );
}

function ParticipantsTab({ m, isOrganizer, nameOf }: { m: MeetingResponse; isOrganizer: boolean; nameOf: (id?: string | null) => string }) {
  const { data, setData, loading, error, reload } = useLoad(() => api.listMeetingParticipants(m.meetingId, { limit: 100 }), [m.meetingId]);
  const [showAdd, setShowAdd] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  const items = data?.items ?? [];

  async function remove(userId: string) {
    if (!confirm("이 참가자를 제거하시겠습니까?")) return;
    setBusy(userId); setMsg(null);
    try { await api.removeMeetingParticipant(m.meetingId, userId); reload(); }
    catch (e) { setMsg({ ok: false, text: errorText(e) }); } finally { setBusy(null); }
  }
  async function toggleRecordAccess(p: MeetingParticipantResponse) {
    setBusy(p.userId); setMsg(null);
    try {
      const next = p.recordAccessState === "GRANTED" ? "REVOKED" : "GRANTED";
      const reason = prompt(`기록 접근을 ${next === "REVOKED" ? "회수" : "복원"}하는 사유를 입력하세요.`, next === "REVOKED" ? "보안 검토" : "복원 요청");
      if (!reason) { setBusy(null); return; }
      const updated = await api.updateMeetingRecordAccess(m.meetingId, p.userId, { state: next, reason, version: p.version });
      setData(d => d ? { ...d, items: d.items.map(x => x.participantId === updated.participantId ? updated : x) } : d);
    } catch (e) { setMsg({ ok: false, text: errorText(e) }); } finally { setBusy(null); }
  }

  return (
    <div className="max-w-2xl space-y-4">
      {showAdd && <AddParticipantModal meetingId={m.meetingId} projectId={m.projectId} existing={new Set(items.filter(p => p.participationStatus === "ACTIVE").map(p => p.userId))} onClose={() => setShowAdd(false)} onAdded={() => reload()} />}
      <div className="flex items-center justify-between">
        <Section>참가자 ({items.length})</Section>
        {isOrganizer && m.status === "SCHEDULED" && <button onClick={() => setShowAdd(true)} className="text-[11px] text-indigo-500 font-semibold hover:text-indigo-700">+ 추가</button>}
      </div>
      <Card className="divide-y divide-slate-50">
        {items.map(p => (
          <div key={p.participantId} className="flex items-center gap-3 px-4 py-3">
            <Avatar name={nameOf(p.userId)} seed={p.userId} size={32} />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-slate-800 truncate">{nameOf(p.userId)}{p.userId === m.organizerUserId && " · 주최자"}{p.userId === m.reviewOwnerUserId && " · 검토자"}</p>
              <div className="flex items-center gap-1.5 mt-1"><ParticipationBadge status={p.participationStatus} /><RecordAccessBadge state={p.recordAccessState} /></div>
            </div>
            {isOrganizer && p.participationStatus === "ACTIVE" && (
              <div className="flex gap-1.5 shrink-0">
                <button disabled={busy === p.userId} onClick={() => toggleRecordAccess(p)} className="text-[11px] text-slate-500 font-semibold hover:text-indigo-600 disabled:opacity-40">{p.recordAccessState === "GRANTED" ? "기록 회수" : "기록 복원"}</button>
                {p.userId !== m.organizerUserId && <button disabled={busy === p.userId} onClick={() => remove(p.userId)} className="text-[11px] text-rose-400 font-semibold hover:text-rose-600 disabled:opacity-40">제거</button>}
              </div>
            )}
          </div>
        ))}
      </Card>
      <Msg msg={msg} />
    </div>
  );
}

// ───────────────────────── 채팅 ─────────────────────────
function ChatTab({ m, myUserId, nameOf }: { m: MeetingResponse; myUserId?: string; nameOf: (id?: string | null) => string }) {
  const [messages, setMessages] = useState<api.ChatMessageResponse[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const lastSeq = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const r = await api.listChatMessages(m.meetingId, { afterSequence: lastSeq.current, limit: 100 });
        if (!alive || r.items.length === 0) return;
        lastSeq.current = r.lastSequence;
        setMessages(prev => [...prev, ...r.items]);
      } catch { /* 폴링 실패는 조용히 무시하고 다음 주기에 재시도 */ }
    }
    poll();
    const iv = setInterval(poll, m.status === "IN_PROGRESS" ? 2000 : 6000);
    return () => { alive = false; clearInterval(iv); };
  }, [m.meetingId, m.status]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [messages.length]);

  async function send() {
    if (!text.trim()) return;
    setSending(true);
    try { await api.sendChatMessage(m.meetingId, text.trim()); setText(""); }
    catch { /* 실패 시 사용자가 재전송하도록 입력값 유지 */ }
    finally { setSending(false); }
  }

  return (
    <div className="max-w-2xl flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-2 pb-3" style={{ maxHeight: "60vh" }}>
        {messages.length === 0 && <p className="text-[12px] text-slate-400 text-center py-8">아직 채팅이 없습니다.{m.status !== "IN_PROGRESS" && " (실시간 채팅은 진행 중 상태에서만 가능합니다)"}</p>}
        {messages.map(msg => {
          const mine = msg.senderUserId === myUserId;
          return (
            <div key={msg.messageId} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[75%] rounded-2xl px-3.5 py-2 ${mine ? "bg-indigo-500 text-white" : "bg-white border border-slate-100 text-slate-700"}`}>
                {!mine && <p className="text-[10px] font-bold opacity-60 mb-0.5">{nameOf(msg.senderUserId)}</p>}
                <p className="text-[13px] leading-snug whitespace-pre-wrap">{msg.text}</p>
              </div>
            </div>
          );
        })}
      </div>
      {m.status === "IN_PROGRESS" ? (
        <div className="shrink-0 flex gap-2 pt-2 border-t border-slate-100">
          <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} placeholder="메시지 입력..." className={inputCls} />
          <button disabled={sending || !text.trim()} onClick={send} className={primaryBtn}>전송</button>
        </div>
      ) : (
        <p className="text-[11px] text-slate-400 text-center pt-2 border-t border-slate-100">회의가 진행 중이 아니므로 지난 기록만 조회됩니다.</p>
      )}
    </div>
  );
}

// ───────────────────────── 자료(첨부 문서) ─────────────────────────
function AttachExistingModal({ meetingId, attachedIds, onClose, onAttached }: {
  meetingId: string; attachedIds: Set<string>; onClose: () => void; onAttached: (a: MeetingAttachmentResponse) => void;
}) {
  const { data, loading } = useLoad(() => doc.listDocuments({ limit: 100 }), []);
  const candidates = (data?.items ?? []).filter(d => d.effectivePermission === "OWNER" && !attachedIds.has(d.documentId));
  const [documentId, setDocumentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setError(null);
    try { onAttached(await doc.attachExistingDocumentToMeeting(meetingId, documentId)); onClose(); }
    catch (e) { setError(errorText(e)); setBusy(false); }
  }
  return (
    <Modal title="기존 문서 병합" onClose={onClose}>
      {loading ? <Spinner /> : candidates.length === 0 ? (
        <p className="text-[12px] text-slate-400 py-4 text-center">병합할 수 있는 문서가 없습니다. 내가 소유한 문서만 회의에 병합할 수 있습니다.</p>
      ) : (
        <Field label="내 문서">
          <select value={documentId} onChange={e => setDocumentId(e.target.value)} className={inputCls}>
            <option value="">선택하세요</option>
            {candidates.map(d => <option key={d.documentId} value={d.documentId}>{d.title}</option>)}
          </select>
        </Field>
      )}
      {error && <p className="text-[12px] text-rose-500 font-medium">{error}</p>}
      <div className="flex gap-2">
        <button onClick={onClose} className={`flex-1 ${ghostBtn}`}>취소</button>
        <button disabled={busy || !documentId} onClick={submit} className={`flex-1 ${primaryBtn}`}>{busy ? "병합 중..." : "병합"}</button>
      </div>
    </Modal>
  );
}

function UploadAttachmentModal({ meetingId, onClose, onUploaded }: { meetingId: string; onClose: () => void; onUploaded: (a: MeetingAttachmentResponse) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) { setFile(f); if (!title.trim()) setTitle(f.name.replace(/\.[^.]+$/, "")); }
  }
  async function submit() {
    if (!file) return;
    setBusy(true); setError(null);
    try { onUploaded(await doc.uploadMeetingAttachment(meetingId, file, { title: title.trim() })); onClose(); }
    catch (e) { setError(errorText(e)); setBusy(false); }
  }
  return (
    <Modal title="새 파일을 회의 자료로 업로드" onClose={onClose}>
      <input ref={fileRef} type="file" className="hidden" onChange={pick} />
      <button onClick={() => fileRef.current?.click()} className="w-full py-6 border-2 border-dashed border-slate-200 rounded-xl text-[13px] text-slate-500 hover:border-indigo-300 hover:text-indigo-600 transition-colors">
        {file ? <span className="font-semibold text-slate-700">{file.name} ({fmtSize(file.size)})</span> : "파일을 선택하세요 (최대 50MB)"}
      </button>
      <Field label="제목"><input value={title} onChange={e => setTitle(e.target.value)} maxLength={200} className={inputCls} /></Field>
      {error && <p className="text-[12px] text-rose-500 font-medium">{error}</p>}
      <div className="flex gap-2">
        <button onClick={onClose} disabled={busy} className={`flex-1 ${ghostBtn}`}>취소</button>
        <button disabled={busy || !file || !title.trim()} onClick={submit} className={`flex-1 ${primaryBtn}`}>{busy ? "업로드 중..." : "업로드"}</button>
      </div>
    </Modal>
  );
}

function AttachmentsTab({ m, navigate }: { m: MeetingResponse; navigate: (s: any, ctx?: any) => void }) {
  const { data, setData, loading, error, reload } = useLoad(() => doc.listMeetingAttachments(m.meetingId, { limit: 100 }), [m.meetingId]);
  const [modal, setModal] = useState<"existing" | "upload" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  const items = data?.items ?? [];
  const canManage = m.status === "SCHEDULED" || m.status === "IN_PROGRESS";

  async function detach(documentId: string) {
    if (!confirm("이 문서를 회의에서 분리하시겠습니까?")) return;
    setBusy(documentId); setMsg(null);
    try { await doc.detachMeetingAttachment(m.meetingId, documentId); reload(); }
    catch (e) { setMsg({ ok: false, text: errorText(e) }); } finally { setBusy(null); }
  }

  return (
    <div className="max-w-2xl space-y-4">
      {modal === "existing" && <AttachExistingModal meetingId={m.meetingId} attachedIds={new Set(items.map(a => a.documentId))} onClose={() => setModal(null)} onAttached={a => setData(d => d ? { ...d, items: [a, ...d.items] } : d)} />}
      {modal === "upload" && <UploadAttachmentModal meetingId={m.meetingId} onClose={() => setModal(null)} onUploaded={a => setData(d => d ? { ...d, items: [a, ...d.items] } : d)} />}
      <div className="flex items-center justify-between">
        <Section>회의 자료 ({items.length})</Section>
        {canManage && (
          <div className="flex gap-2">
            <button onClick={() => setModal("existing")} className="text-[11px] text-indigo-500 font-semibold hover:text-indigo-700">+ 기존 문서 병합</button>
            <button onClick={() => setModal("upload")} className="text-[11px] text-indigo-500 font-semibold hover:text-indigo-700">+ 새 파일 업로드</button>
          </div>
        )}
      </div>
      <p className="text-[10px] text-slate-400">이 회의에 병합된 문서는 회의 참가자에게만 보이며, 문서함 전체 목록에는 노출되지 않습니다.</p>
      {items.length === 0 ? (
        <Card className="p-8 text-center text-[12px] text-slate-400">아직 병합된 자료가 없습니다.</Card>
      ) : (
        <Card className="divide-y divide-slate-50">
          {items.map(a => (
            <div key={a.attachmentId} className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1 min-w-0 cursor-pointer" onClick={() => navigate("document-detail", { docId: a.documentId, fromMeetingId: m.meetingId })}>
                <p className="text-[13px] font-semibold text-slate-800 truncate hover:text-indigo-600">{a.title}</p>
                <p className="text-[11px] text-slate-400">{a.originalFilename} · {fmtSize(a.sizeBytes)}</p>
              </div>
              <PermissionBadge permission={a.effectivePermission} />
              {canManage && <button disabled={busy === a.documentId} onClick={() => detach(a.documentId)} className="text-[11px] text-rose-400 font-semibold hover:text-rose-600 disabled:opacity-40">분리</button>}
            </div>
          ))}
        </Card>
      )}
      {!canManage && <p className="text-[11px] text-slate-400">회의가 진행 중이거나 예정 상태일 때만 자료를 추가/분리할 수 있습니다.</p>}
      <Msg msg={msg} />
    </div>
  );
}

// ───────────────────────── 회의록·후보 ─────────────────────────
function CandidateEditModal({ meetingId, c, onClose, onSaved, participants, nameOf }: {
  meetingId: string; c: MeetingCandidateResponse; onClose: () => void; onSaved: (c: MeetingCandidateResponse) => void;
  participants: MeetingParticipantResponse[]; nameOf: (id?: string | null) => string;
}) {
  const [title, setTitle] = useState(c.title);
  const [content, setContent] = useState(c.descriptionOrContent ?? "");
  const [assigneeUserId, setAssigneeUserId] = useState(c.assigneeUserId ?? "");
  const [dueAt, setDueAt] = useState(c.dueAt ? c.dueAt.slice(0, 10) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setError(null);
    try {
      onSaved(await api.updateMeetingCandidate(meetingId, c.candidateId, {
        title: title.trim(), descriptionOrContent: content.trim() || null,
        assigneeUserId: c.type === "TASK" ? (assigneeUserId || null) : undefined,
        dueAt: c.type === "TASK" && dueAt ? new Date(dueAt).toISOString() : (c.type === "TASK" ? null : undefined),
        version: c.version,
      }));
      onClose();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title={`${c.type === "TASK" ? "업무" : "결정"} 후보 수정`} onClose={onClose}>
      <Field label="제목"><input value={title} onChange={e => setTitle(e.target.value)} className={inputCls} /></Field>
      <Field label="내용"><textarea rows={4} value={content} onChange={e => setContent(e.target.value)} className={inputCls} /></Field>
      {c.type === "TASK" && (
        <>
          <Field label="담당자">
            <select value={assigneeUserId} onChange={e => setAssigneeUserId(e.target.value)} className={inputCls}>
              <option value="">미지정</option>
              {participants.filter(p => p.participationStatus === "ACTIVE").map(p => <option key={p.userId} value={p.userId}>{nameOf(p.userId)}</option>)}
            </select>
          </Field>
          <Field label="마감일"><input type="date" value={dueAt} onChange={e => setDueAt(e.target.value)} className={inputCls} /></Field>
        </>
      )}
      {error && <p className="text-[12px] text-rose-500 font-medium">{error}</p>}
      <div className="flex gap-2">
        <button onClick={onClose} className={`flex-1 ${ghostBtn}`}>취소</button>
        <button disabled={busy || !title.trim()} onClick={submit} className={`flex-1 ${primaryBtn}`}>{busy ? "저장 중..." : "저장"}</button>
      </div>
    </Modal>
  );
}

function CandidateRow({ meetingId, c, canReview, minutesApproved, participants, nameOf, onChanged }: {
  meetingId: string; c: MeetingCandidateResponse; canReview: boolean; minutesApproved: boolean;
  participants: MeetingParticipantResponse[]; nameOf: (id?: string | null) => string; onChanged: (c: MeetingCandidateResponse) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const editable = c.status === "PROPOSED" || c.status === "EDITED";

  async function run(key: string, fn: () => Promise<MeetingCandidateResponse>) {
    setBusy(key); setError(null);
    try { onChanged(await fn()); } catch (e) { setError(errorText(e)); } finally { setBusy(null); }
  }
  return (
    <Card className="p-4 space-y-2">
      {editing && <CandidateEditModal meetingId={meetingId} c={c} participants={participants} nameOf={nameOf} onClose={() => setEditing(false)} onSaved={onChanged} />}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{c.type === "TASK" ? "업무 후보" : "결정 후보"}</p>
          <p className="text-[14px] font-bold text-slate-800 mt-0.5">{c.title}</p>
        </div>
        <CandidateStatusBadge status={c.status} />
      </div>
      <p className="text-[13px] text-slate-600 whitespace-pre-wrap">{c.descriptionOrContent}</p>
      {c.type === "TASK" && <p className="text-[11px] text-slate-400">담당자: {c.assigneeUserId ? nameOf(c.assigneeUserId) : "미지정"}{c.dueAt ? ` · 마감 ${fmtDateTime(c.dueAt)}` : ""}</p>}
      {c.materializedResourceId && <p className="text-[11px] text-emerald-600 font-semibold">생성 완료됨 (리소스 ID: {c.materializedResourceId.slice(0, 8)}…)</p>}
      {c.status === "MATERIALIZATION_PENDING" && <p className="text-[11px] text-amber-600 flex items-center gap-1.5"><span className="w-3 h-3 border-2 border-amber-300 border-t-amber-600 rounded-full animate-spin" />프로젝트에 반영하는 중입니다...</p>}
      {c.status === "MATERIALIZATION_FAILED" && c.failureReasonCode && <p className="text-[11px] text-rose-500">생성 실패 사유: {c.failureReasonCode}</p>}
      {canReview && editable && (
        <div className="flex gap-2 pt-2 border-t border-slate-50">
          <button onClick={() => setEditing(true)} className="text-[11px] text-slate-500 font-semibold hover:text-indigo-600">수정</button>
          <button disabled={!!busy || !minutesApproved} title={!minutesApproved ? "회의록 승인 후 확정할 수 있습니다" : undefined}
            onClick={() => run("confirm", () => api.confirmMeetingCandidate(meetingId, c.candidateId, c.version))}
            className="text-[11px] text-indigo-500 font-semibold hover:text-indigo-700 disabled:opacity-30">확정</button>
          <button disabled={!!busy} onClick={() => run("reject", () => api.rejectMeetingCandidate(meetingId, c.candidateId, { version: c.version }))} className="text-[11px] text-rose-400 font-semibold hover:text-rose-600 disabled:opacity-30">반려</button>
        </div>
      )}
      {canReview && (c.status === "CONFIRMED" || c.status === "MATERIALIZATION_FAILED") && (
        <div className="pt-2 border-t border-slate-50">
          <button disabled={!!busy} onClick={() => run("materialize", () => api.materializeMeetingCandidate(meetingId, c.candidateId, c.version))} className={primaryBtn}>
            {busy === "materialize" ? "요청 중..." : c.status === "MATERIALIZATION_FAILED" ? "다시 시도" : c.type === "TASK" ? "실제 업무로 생성" : "실제 결정으로 생성"}
          </button>
        </div>
      )}
      {error && <p className="text-[11px] text-rose-500 font-medium">{error}</p>}
    </Card>
  );
}

function MinutesAndCandidatesTab({ m, isReviewOwner, participants, nameOf }: { m: MeetingResponse; isReviewOwner: boolean; participants: MeetingParticipantResponse[]; nameOf: (id?: string | null) => string }) {
  const [postprocess, setPostprocess] = useState<api.MeetingPostprocessResponse | null>(null);
  const [minutes, setMinutes] = useState<api.MeetingMinutesResponse | null>(null);
  const [candidates, setCandidates] = useState<MeetingCandidateResponse[] | null>(null);
  const [editingContent, setEditingContent] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function loadAll() {
    const [pp, min] = await Promise.all([api.getMeetingPostprocess(m.meetingId), api.getMeetingMinutes(m.meetingId)]);
    setPostprocess(pp); setMinutes(min);
    if (min.status === "DRAFT" || min.status === "APPROVED") setCandidates((await api.listMeetingCandidates(m.meetingId, { limit: 100 })).items);
    setLoaded(true);
  }
  useEffect(() => {
    let alive = true;
    const UNRESOLVED = new Set(["WAITING_EVIDENCE_SNAPSHOT", "WAITING_RECORDING", "STT_QUEUED", "STT_PROCESSING", "STT_READY", "MINUTES_QUEUED", "MINUTES_PROCESSING"]);
    async function tick() { if (!alive) return; await loadAll().catch(() => {}); }
    tick();
    const iv = setInterval(() => { if (postprocess && !UNRESOLVED.has(postprocess.status)) return; tick(); }, 1500);
    return () => { alive = false; clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.meetingId, postprocess?.status]);

  // materialize는 202 PENDING을 먼저 돌려주고 실제 Task/Decision 생성은 비동기로 반영되므로,
  // PENDING인 후보가 하나라도 있는 동안만 후보 목록을 다시 조회한다. 조회 실패는 조용히 다음 주기에 재시도할 뿐
  // (postprocess 폴링과 동일한 패턴), 그 자체를 후보의 실패로 간주하지 않는다.
  const hasPendingCandidate = (candidates ?? []).some(c => c.status === "MATERIALIZATION_PENDING");
  useEffect(() => {
    if (!hasPendingCandidate) return;
    let alive = true; let inFlight = false;
    const iv = setInterval(async () => {
      if (!alive || inFlight) return;
      inFlight = true;
      try { const page = await api.listMeetingCandidates(m.meetingId, { limit: 100 }); if (alive) setCandidates(page.items); }
      catch { /* 폴링 실패는 조용히 무시하고 다음 주기에 재시도 */ }
      finally { inFlight = false; }
    }, 1000);
    return () => { alive = false; clearInterval(iv); };
  }, [m.meetingId, hasPendingCandidate]);

  if (!loaded || !postprocess || !minutes) return <Spinner text="처리 상태를 불러오는 중..." />;
  if (m.status !== "ENDED") return <p className="text-[13px] text-slate-400 py-8 text-center">회의가 종료되면 AI 회의록·후보 처리가 시작됩니다.</p>;

  async function approve() {
    setBusy("approve"); setMsg(null);
    try { setMinutes(await api.approveMeetingMinutes(m.meetingId, minutes!.version)); setMsg({ ok: true, text: "회의록을 승인했습니다." }); }
    catch (e) { setMsg({ ok: false, text: errorText(e) }); } finally { setBusy(null); }
  }
  async function saveContent() {
    if (editingContent == null) return;
    setBusy("save"); setMsg(null);
    try { setMinutes(await api.updateMeetingMinutes(m.meetingId, { content: editingContent, version: minutes!.version })); setEditingContent(null); }
    catch (e) { setMsg({ ok: false, text: errorText(e) }); } finally { setBusy(null); }
  }
  async function regenerate() {
    if (!confirm("회의록을 다시 생성하시겠습니까? 현재 초안 내용은 대체됩니다.")) return;
    setBusy("regen"); setMsg(null);
    try { setPostprocess(await api.regenerateMeetingMinutes(m.meetingId)); await loadAll(); }
    catch (e) { setMsg({ ok: false, text: errorText(e) }); } finally { setBusy(null); }
  }
  async function retry() {
    setBusy("retry"); setMsg(null);
    try { setPostprocess(await api.retryMeetingPostprocess(m.meetingId)); }
    catch (e) { setMsg({ ok: false, text: errorText(e) }); } finally { setBusy(null); }
  }

  const decisionCands = (candidates ?? []).filter(c => c.type === "DECISION");
  const taskCands = (candidates ?? []).filter(c => c.type === "TASK");

  return (
    <div className="max-w-2xl space-y-4">
      <Card className="p-5 flex items-center justify-between">
        <div><Section>AI 처리 상태</Section><PostprocessBadge status={postprocess.status} /></div>
        {(postprocess.status === "FAILED") && <button disabled={!!busy} onClick={retry} className={ghostBtn}>재시도</button>}
      </Card>

      {postprocess.status === "AI_EGRESS_BLOCKED" && (
        <Card className="p-5 text-[13px] text-rose-600 bg-rose-50/50">이 회의는 민감도 정책상 외부 AI로 전송할 수 없어 회의록 자동 생성이 중단되었습니다. 회의록은 수동으로 작성해야 합니다.</Card>
      )}

      {(minutes.status === "DRAFT" || minutes.status === "APPROVED" || minutes.status === "FAILED") && (
        <Card className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <Section>회의록</Section>
            <div className="flex items-center gap-2"><MinutesStatusBadge status={minutes.status} />
              {isReviewOwner && minutes.status === "DRAFT" && editingContent == null && <button onClick={() => setEditingContent(minutes.content ?? "")} className="text-[11px] text-indigo-500 font-semibold hover:text-indigo-700">편집</button>}
            </div>
          </div>
          {editingContent != null ? (
            <div className="space-y-2">
              <textarea rows={12} value={editingContent} onChange={e => setEditingContent(e.target.value)} className={`${inputCls} font-mono`} />
              <div className="flex gap-2">
                <button onClick={() => setEditingContent(null)} className={`flex-1 ${ghostBtn}`}>취소</button>
                <button disabled={busy === "save"} onClick={saveContent} className={`flex-1 ${primaryBtn}`}>저장</button>
              </div>
            </div>
          ) : (
            <p className="text-[13px] text-slate-700 whitespace-pre-wrap leading-relaxed">{minutes.content}</p>
          )}
          {isReviewOwner && minutes.status === "DRAFT" && editingContent == null && (
            <div className="flex gap-2 pt-2 border-t border-slate-50">
              <button disabled={busy === "approve"} onClick={approve} className={primaryBtn}>{busy === "approve" ? "승인 중..." : "회의록 승인"}</button>
              <button disabled={busy === "regen"} onClick={regenerate} className={ghostBtn}>다시 생성</button>
            </div>
          )}
        </Card>
      )}

      {candidates && candidates.length > 0 && (
        <div className="space-y-3">
          <Section>결정 후보</Section>
          {decisionCands.length === 0 && <p className="text-[12px] text-slate-400">결정 후보가 없습니다.</p>}
          {decisionCands.map(c => <CandidateRow key={c.candidateId} meetingId={m.meetingId} c={c} canReview={isReviewOwner} minutesApproved={minutes.status === "APPROVED"} participants={participants} nameOf={nameOf} onChanged={updated => setCandidates(cs => cs!.map(x => x.candidateId === updated.candidateId ? updated : x))} />)}
          <Section>업무 후보</Section>
          {taskCands.length === 0 && <p className="text-[12px] text-slate-400">업무 후보가 없습니다.</p>}
          {taskCands.map(c => <CandidateRow key={c.candidateId} meetingId={m.meetingId} c={c} canReview={isReviewOwner} minutesApproved={minutes.status === "APPROVED"} participants={participants} nameOf={nameOf} onChanged={updated => setCandidates(cs => cs!.map(x => x.candidateId === updated.candidateId ? updated : x))} />)}
        </div>
      )}
      <Msg msg={msg} />
    </div>
  );
}

// ───────────────────────── 메인 ─────────────────────────
export default function MeetingDetailScreen({ meetingId, navigate }: { meetingId: string; navigate: (s: any, ctx?: any) => void }) {
  const { me } = useAuth();
  const [tab, setTab] = useState<Tab>("개요");
  const { data: meeting, setData: setMeeting, loading, error, reload } = useLoad(() => api.getMeeting(meetingId), [meetingId]);
  const { data: partsPage } = useLoad(() => api.listMeetingParticipants(meetingId, { limit: 100 }), [meetingId]);
  const { nameOf } = useOrgUsers();

  if (loading && !meeting) return <Spinner text="회의 정보를 불러오는 중..." />;
  if (error && !meeting) return <ErrorBox message={error} onRetry={reload} />;
  if (!meeting) return null;

  const isOrganizer = meeting.organizerUserId === me?.userId;
  const isReviewOwner = meeting.reviewOwnerUserId === me?.userId;
  const hasAccess = meeting.myParticipationStatus === "ACTIVE";

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="shrink-0 bg-white border-b border-slate-100 px-6 py-4">
        <div className="flex items-center gap-3 mb-3">
          <button onClick={() => navigate("meetings")} className="w-8 h-8 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h2 className="text-[17px] font-extrabold text-slate-900">{meeting.title}</h2>
              <MeetingStatusBadge status={meeting.status} />
              <SensitivityBadge level={meeting.sensitivityClassification} />
            </div>
          </div>
        </div>
        <div className="flex gap-0 overflow-x-auto">
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)} className={`px-4 py-2.5 text-[13px] font-semibold border-b-2 transition-colors shrink-0 ${tab === t ? "border-indigo-500 text-indigo-600" : "border-transparent text-slate-400 hover:text-slate-600"}`}>{t}</button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-6 bg-slate-50/40">
        {tab === "개요" && <OverviewTab m={meeting} isOrganizer={isOrganizer} isReviewOwner={isReviewOwner} hasAccess={hasAccess} onChanged={setMeeting} nameOf={nameOf} myUserId={me?.userId} participants={partsPage?.items ?? []} />}
        {tab === "참가자" && <ParticipantsTab m={meeting} isOrganizer={isOrganizer} nameOf={nameOf} />}
        {tab === "채팅" && <ChatTab m={meeting} myUserId={me?.userId} nameOf={nameOf} />}
        {tab === "자료" && <AttachmentsTab m={meeting} navigate={navigate} />}
        {tab === "회의록·후보" && <MinutesAndCandidatesTab m={meeting} isReviewOwner={isReviewOwner} participants={partsPage?.items ?? []} nameOf={nameOf} />}
      </div>
    </div>
  );
}
