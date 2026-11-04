// 회의 개요 — 정보 보기·수정, 음성 참가, 시작·취소·종료, 비밀번호, 강제 종료, 보고서 양식 올리기.
// 버튼은 상태·역할로 미리 켜고 끈다(FRONTEND_00 6절). 변경 요청이 성공하면 항상 응답의 새 version으로 화면을 갱신한다(4-3).
import { useState } from "react";
import * as api from "../api/meeting";
import type { MeetingExternalAiPolicy, MeetingResponse, MeetingSensitivity } from "../api/meeting";
import { ApiError, errorText, fieldErrorMap } from "../api/errors";
import { Card, Field, ghostBtn, inputCls, primaryBtn, Section } from "../ui/kit";
import SchedulePicker from "../ui/SchedulePicker";
import { TemplateUploader } from "./ReportPanel";
import RecordingDownload from "./RecordingDownload";
import { ReasonModal } from "./dialogs";
import {
  AI_BLOCKED_TEXT, AI_POLICY_LABEL, fmtDateTime, isAiBlocked, isoToLocalInput, localInputToIso, POSTPROCESS_FAILURE_TEXT,
  SENSITIVITY_LEVELS, SENS_LABEL, SENS_RANK, SensitivityBadge,
} from "./shared";
import type { MeetingCtx } from "./meetingContext";

function Msg({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return <p className={`text-[12px] font-medium ${msg.ok ? "text-emerald-600" : "text-rose-500"}`}>{msg.text}</p>;
}

const AI_POLICIES: MeetingExternalAiPolicy[] = ["INHERIT", "ALLOWED", "BLOCKED"];
// 종료 처리 중(PREPARING)인 회의도 status는 IN_PROGRESS로 보인다(14-1 #14). 이 코드들을 받으면 "종료 처리 중"으로 안내한다.
const END_IN_PROGRESS_CODES = new Set(["MEETING_END_PREPARING", "END_OPERATION_CONFLICT", "DOCUMENT_EVIDENCE_FREEZE_UNAVAILABLE", "EVIDENCE_FREEZE_CONFLICT"]);

export default function OverviewTab({ ctx, joinRoom, joining, joinError, roomOpen }: {
  ctx: MeetingCtx;
  /** 음성 회의방에 참가한다(접속 토큰 발급 → LiveKit). 비밀번호는 방 안에서만 쥐고 있고 저장하지 않는다. */
  joinRoom: (password?: string) => Promise<void>; joining: boolean; joinError: string | null; roomOpen: boolean;
}) {
  const { m, isOrganizer, isReviewOwner, hasAccess, projectRole, isViewer, isOutsideViewer, nameOf, setMeeting, refreshMeeting } = ctx;
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(m.title);
  const [description, setDescription] = useState(m.description ?? "");
  const [startLocal, setStartLocal] = useState(isoToLocalInput(m.scheduledStartAt));
  const [endLocal, setEndLocal] = useState(isoToLocalInput(m.scheduledEndAt));
  const [sensitivity, setSensitivity] = useState<MeetingSensitivity>(m.sensitivityClassification);
  const [aiPolicy, setAiPolicy] = useState<MeetingExternalAiPolicy>(m.externalAiPolicy);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [password, setPassword] = useState("");
  const [joinPassword, setJoinPassword] = useState("");
  const [dialog, setDialog] = useState<"cancel" | "forceEnd" | null>(null);

  const inProgress = m.status === "IN_PROGRESS";
  const scheduled = m.status === "SCHEDULED";
  const aiBlocked = isAiBlocked(m.sensitivityClassification, m.externalAiPolicy);
  const isManager = projectRole === "MANAGER";

  async function act(key: string, fn: () => Promise<MeetingResponse>, success: string) {
    setBusy(key); setMsg(null); setFields({});
    try { setMeeting(await fn()); setMsg({ ok: true, text: success }); return true; }
    catch (e) {
      setMsg({ ok: false, text: errorText(e) }); setFields(fieldErrorMap(e));
      // 다른 사람이 먼저 바꿨거나 상태가 달라졌다 — 같은 본문을 다시 보내지 않고 최신을 읽어 사용자가 다시 확인하게 한다.
      if (e instanceof ApiError && (e.errorCode === "VERSION_CONFLICT" || e.errorCode === "MEETING_NOT_SCHEDULED" || e.errorCode === "MEETING_NOT_IN_PROGRESS")) void refreshMeeting();
      return false;
    } finally { setBusy(null); }
  }

  function startEdit() {
    setTitle(m.title); setDescription(m.description ?? ""); setStartLocal(isoToLocalInput(m.scheduledStartAt)); setEndLocal(isoToLocalInput(m.scheduledEndAt));
    setSensitivity(m.sensitivityClassification); setAiPolicy(m.externalAiPolicy); setMsg(null); setFields({}); setEditing(true);
  }

  async function saveEdit() {
    // 보낸 필드만 바뀐다. 바뀐 것만 담고, 하나도 없으면 요청하지 않는다. 진행 중에는 민감도(올리기)만 보낼 수 있다.
    const body: Parameters<typeof api.updateMeeting>[1] = { version: m.version };
    if (scheduled) {
      if (title.trim() !== m.title) body.title = title.trim();
      if ((description.trim() || null) !== (m.description || null)) body.description = description.trim() || null;
      const s = startLocal ? localInputToIso(startLocal) : null, e = endLocal ? localInputToIso(endLocal) : null;
      if (startLocal !== isoToLocalInput(m.scheduledStartAt)) body.scheduledStartAt = s;
      if (endLocal !== isoToLocalInput(m.scheduledEndAt)) body.scheduledEndAt = e;
      if (aiPolicy !== m.externalAiPolicy) body.externalAiPolicy = aiPolicy;
    }
    if (sensitivity !== m.sensitivityClassification) body.sensitivityClassification = sensitivity;
    const effStart = body.scheduledStartAt !== undefined ? body.scheduledStartAt : m.scheduledStartAt;
    const effEnd = body.scheduledEndAt !== undefined ? body.scheduledEndAt : m.scheduledEndAt;
    if (effStart && effEnd && new Date(effEnd) < new Date(effStart)) { setFields({ scheduledEndAt: "종료 시각이 시작 시각보다 빠릅니다" }); return; }
    if (Object.keys(body).length === 1) { setEditing(false); return; }
    // 민감도를 INTERNAL 밖으로 올리면 이후 AI 처리가 막히고 되돌릴 수 없다 — 확인을 받는다.
    if (body.sensitivityClassification && m.sensitivityClassification === "INTERNAL" && body.sensitivityClassification !== "INTERNAL"
      && !confirm(`민감도를 '${SENS_LABEL[body.sensitivityClassification]}'(으)로 올리면 이 회의는 AI 처리(회의록·후보·보고서)가 되지 않고, 되돌릴 수 없습니다. 계속하시겠습니까?`)) return;
    if (await act("meta", () => api.updateMeeting(m.meetingId, body), "저장했습니다.")) setEditing(false);
  }

  async function end() {
    if (!confirm("회의를 종료하시겠습니까?\n종료하면 음성·채팅이 닫히고, 서버가 녹음을 정리해 회의록 초안을 만듭니다. 이 회의의 자료 목록도 고정됩니다.")) return;
    setBusy("end"); setMsg(null);
    try {
      const r = await api.endMeeting(m.meetingId);
      setMeeting(r.meeting);
      const pp = r.postprocess;
      if (pp?.status === "FAILED" && pp.failureCode === "RECORDING_FAILED") setMsg({ ok: false, text: POSTPROCESS_FAILURE_TEXT.RECORDING_FAILED });
      else setMsg({ ok: true, text: "회의를 종료했습니다. 회의록·후보 탭에서 진행 상황을 확인하세요." });
    } catch (e) {
      if (e instanceof ApiError && END_IN_PROGRESS_CODES.has(e.errorCode)) setMsg({ ok: false, text: `${errorText(e)} 종료 처리가 끝나면 화면이 자동으로 바뀝니다.` });
      else setMsg({ ok: false, text: errorText(e) });
      void refreshMeeting();
    } finally { setBusy(null); }
  }

  async function setPw() {
    if (password.length < 4 || password.length > 128) { setMsg({ ok: false, text: "비밀번호는 4~128자여야 합니다." }); return; }
    setBusy("pw"); setMsg(null);
    try {
      await api.setMeetingPassword(m.meetingId, { password, version: m.version });
      setPassword("");
      await refreshMeeting(); // 204라 응답에 새 version이 없다 — 다시 읽어야 이후 요청이 VERSION_CONFLICT가 되지 않는다
      setMsg({ ok: true, text: "비밀번호를 설정했습니다." });
    } catch (e) { setMsg({ ok: false, text: errorText(e) }); void refreshMeeting(); } finally { setBusy(null); }
  }
  async function removePw() {
    setBusy("pwrm"); setMsg(null);
    try { await api.removeMeetingPassword(m.meetingId); await refreshMeeting(); setMsg({ ok: true, text: "비밀번호를 제거했습니다." }); }
    catch (e) { setMsg({ ok: false, text: errorText(e) }); void refreshMeeting(); } finally { setBusy(null); }
  }

  const needsPassword = m.passwordProtected && !isOrganizer;

  return (
    <div className="max-w-2xl space-y-4">
      {dialog === "cancel" && (
        <ReasonModal title="회의 취소" description="취소하면 시작·수정·참가자 추가가 모두 막힙니다. 취소된 회의는 목록에 계속 남습니다." confirmLabel="회의 취소" danger
          onClose={() => setDialog(null)}
          onSubmit={async reason => { setMeeting(await api.cancelMeeting(m.meetingId, { reason: reason || undefined, version: m.version })); }} />
      )}
      {dialog === "forceEnd" && (
        <ReasonModal title="회의 강제 종료" required confirmLabel="강제 종료" danger
          description="주최자가 자리를 비워 아무도 회의를 끝낼 수 없을 때만 쓸 수 있습니다. 주최자가 아직 부재 상태가 아니면 거절됩니다."
          onClose={() => setDialog(null)}
          onSubmit={async reason => { setMeeting((await api.forceEndMeeting(m.meetingId, reason)).meeting); }} />
      )}

      {aiBlocked && m.status !== "CANCELED" && (
        <div className="bg-amber-50 border border-amber-100 rounded-2xl px-4 py-3 text-[12px] text-amber-700 leading-relaxed">
          <b>AI 처리가 되지 않는 회의입니다.</b> 민감도 {SENS_LABEL[m.sensitivityClassification]} · 외부 AI 정책 {AI_POLICY_LABEL[m.externalAiPolicy]}. 종료 후 회의록·후보·보고서가 만들어지지 않습니다.
          {m.status === "ENDED" && " 종료 후에는 민감도를 바꿀 수 없습니다."}
        </div>
      )}

      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <Section>회의 개요</Section>
          {isOrganizer && (scheduled || inProgress) && !editing && <button onClick={startEdit} className="text-[11px] text-indigo-500 font-semibold hover:text-indigo-700">수정</button>}
        </div>
        {editing ? (
          <div className="space-y-3">
            {inProgress && <p className="text-[11px] text-slate-400">진행 중인 회의에서는 민감도(올리기)만 바꿀 수 있습니다.</p>}
            {scheduled && (
              <>
                <Field label="제목" error={fields.title}><input value={title} onChange={e => setTitle(e.target.value)} maxLength={160} className={inputCls} /></Field>
                <Field label="설명" error={fields.description}><textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} maxLength={4000} className={inputCls} /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="시작 예정" error={fields.scheduledStartAt}><SchedulePicker value={startLocal} onChange={setStartLocal} /></Field>
                  <Field label="종료 예정" error={fields.scheduledEndAt}><SchedulePicker value={endLocal} onChange={setEndLocal} /></Field>
                </div>
                <Field label="외부 AI 정책" error={fields.externalAiPolicy}>
                  <select value={aiPolicy} onChange={e => setAiPolicy(e.target.value as MeetingExternalAiPolicy)} className={inputCls}>
                    {AI_POLICIES.map(p => <option key={p} value={p}>{AI_POLICY_LABEL[p]}</option>)}
                  </select>
                </Field>
              </>
            )}
            <Field label="민감도 분류" error={fields.sensitivityClassification}>
              <div className="flex flex-wrap gap-2">
                {SENSITIVITY_LEVELS.map(v => (
                  <button key={v} type="button" disabled={SENS_RANK[v] < SENS_RANK[m.sensitivityClassification]} onClick={() => setSensitivity(v)}
                    className={`flex-1 min-w-[70px] py-2 rounded-xl border disabled:opacity-30 ${sensitivity === v ? "border-indigo-400 bg-indigo-50" : "border-slate-200"}`}>
                    <SensitivityBadge level={v} />
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-400 mt-1">민감도는 낮출 수 없습니다. 일반이 아니면 AI 처리가 되지 않습니다.</p>
            </Field>
            {isAiBlocked(sensitivity, aiPolicy) && <p className="text-[12px] text-amber-600 bg-amber-50 rounded-xl px-3 py-2">{AI_BLOCKED_TEXT}</p>}
            <div className="flex gap-2">
              <button onClick={() => setEditing(false)} className={`flex-1 ${ghostBtn}`}>취소</button>
              <button disabled={busy === "meta" || (scheduled && !title.trim())} onClick={saveEdit} className={`flex-1 ${primaryBtn}`}>{busy === "meta" ? "저장 중..." : "저장"}</button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-[14px] text-slate-700 leading-relaxed whitespace-pre-wrap break-words">{m.description || "설명이 없습니다."}</p>
            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-50">
              {[["주최자", nameOf(m.organizerUserId)], ["회의록 검토자", nameOf(m.reviewOwnerUserId)], ["시작 예정", fmtDateTime(m.scheduledStartAt)], ["종료 예정", fmtDateTime(m.scheduledEndAt)],
                ["실제 시작", fmtDateTime(m.startedAt)], ["종료", fmtDateTime(m.endedAt)], ["외부 AI 정책", AI_POLICY_LABEL[m.externalAiPolicy]], ["비밀번호", m.passwordProtected ? "설정됨" : "없음"]].map(([l, v]) => (
                <div key={l}><p className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">{l}</p><p className="text-[13px] font-bold text-slate-800 mt-0.5">{v}</p></div>
              ))}
            </div>
          </>
        )}
      </Card>

      {hasAccess && inProgress && !isViewer && (
        <Card className="p-5 space-y-2">
          <Section>회의 참가</Section>
          <p className="text-[12px] text-slate-400">음성 회의에 참가합니다. 마이크 권한이 필요하며 카메라는 지원하지 않습니다. 녹음이 하나도 없으면 회의록이 만들어지지 않으니 발언할 때 마이크를 켜 주세요.</p>
          {needsPassword && <input value={joinPassword} onChange={e => setJoinPassword(e.target.value)} type="password" autoComplete="off" placeholder="회의 비밀번호" aria-label="회의 비밀번호" className={inputCls} />}
          <button disabled={joining || roomOpen || (needsPassword && !joinPassword)} onClick={() => joinRoom(needsPassword ? joinPassword : undefined)} className={primaryBtn}>{joining ? "확인 중..." : roomOpen ? "참가 중" : "회의 참가"}</button>
          {joinError && <p className="text-[12px] text-rose-500 font-medium">{joinError}</p>}
        </Card>
      )}

      {isOrganizer && (scheduled || inProgress) && (
        <Card className="p-5 space-y-3">
          <Section>회의 진행 관리</Section>
          <div className="flex flex-wrap gap-2">
            {scheduled && <button disabled={!!busy} onClick={() => act("start", () => api.startMeeting(m.meetingId, { version: m.version }), "회의를 시작했습니다.")} className={primaryBtn}>회의 시작</button>}
            {scheduled && <button disabled={!!busy} onClick={() => setDialog("cancel")} className="px-4 py-2.5 border border-rose-200 text-rose-500 text-[13px] font-semibold rounded-xl hover:bg-rose-50 disabled:opacity-40">회의 취소</button>}
            {inProgress && <button disabled={!!busy} onClick={end} className="px-4 py-2.5 bg-rose-500 hover:bg-rose-600 text-white text-[13px] font-bold rounded-xl transition-colors disabled:opacity-40">{busy === "end" ? "종료 중..." : "회의 종료"}</button>}
          </div>
          {scheduled && <p className="text-[11px] text-slate-400">예정 시각과 관계없이 언제든 시작할 수 있습니다.</p>}
          {scheduled && (
            <div className="pt-3 border-t border-slate-50 flex items-end gap-2">
              <div className="flex-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block mb-1">비밀번호 {m.passwordProtected ? "변경" : "설정"} (4~128자 · 음성 입장에만 적용)</label>
                <input value={password} onChange={e => setPassword(e.target.value)} type="password" autoComplete="new-password" placeholder="새 비밀번호" className={inputCls} />
              </div>
              <button disabled={!password || !!busy} onClick={setPw} className={ghostBtn}>적용</button>
              {m.passwordProtected && <button disabled={!!busy} onClick={removePw} className={ghostBtn}>제거</button>}
            </div>
          )}
        </Card>
      )}

      {/* 주최자가 자리를 비웠을 때 프로젝트 담당자(MANAGER, 참가자)가 대신 끝낸다. 서버가 "주최자 부재"를 판단하므로 아닐 때는 409로 거절된다. */}
      {isManager && inProgress && !isOrganizer && hasAccess && (
        <Card className="p-5 space-y-2">
          <Section>프로젝트 담당자 기능</Section>
          <p className="text-[12px] text-slate-400">주최자({nameOf(m.organizerUserId)})가 자리를 비워 아무도 회의를 끝낼 수 없을 때 대신 종료합니다.</p>
          <button disabled={!!busy} onClick={() => setDialog("forceEnd")} className="px-4 py-2.5 border border-rose-200 text-rose-500 text-[13px] font-semibold rounded-xl hover:bg-rose-50 disabled:opacity-40">강제 종료</button>
        </Card>
      )}

      {/* 양식은 회의를 만든 직후(예정)부터 올릴 수 있다. 올리기만으로는 분석이 시작되지 않고, 종료 후 보고서를 요청할 때 시작된다. */}
      {isReviewOwner && m.status !== "CANCELED" && (
        <Card className="p-5 space-y-2">
          <Section>회사 보고서 양식</Section>
          <p className="text-[12px] text-slate-400">회사 회의록 양식(PDF·Word(.docx)·PNG·JPG, 10MB 이하. Word는 서버 설정이 켜져 있을 때)을 미리 올려 두면 회의가 끝난 뒤 '회의록·후보' 탭에서 양식에 맞춘 보고서를 만들 수 있습니다. 여러 번 올리면 마지막 파일이 쓰입니다.</p>
          <TemplateUploader meetingId={m.meetingId} />
        </Card>
      )}

      {/* 원본 녹음 합본(③): 종료된 회의에서 받을 수 있는 사람(참여자·프로젝트 담당자)에게만. 서버에서 꺼져 있거나 권한이 없으면 카드가 스스로 숨는다. */}
      {m.status === "ENDED" && !isOutsideViewer && <RecordingDownload meetingId={m.meetingId} />}

      <Msg msg={msg} />
      {isReviewOwner && !isOrganizer && <p className="text-[11px] text-slate-400">회의록 검토자로 지정되어 있어 회의록·후보 탭에서 승인/확정 권한이 있습니다.</p>}
    </div>
  );
}
