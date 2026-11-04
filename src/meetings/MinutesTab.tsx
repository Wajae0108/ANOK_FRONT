// 회의 종료 후: 후처리 진행 → 회의록 검토·승인 → 후보 확정·반영 → 보고서 (FRONTEND_00 10절, 03·04).
//   · 후처리는 3~5초 간격으로 폴링한다. REVIEWING이 되어도 후보·6유형 결과는 몇 초 뒤에 생기므로 후보 개수가 0보다 커질 때까지 2~3초 간격으로 더 읽는다.
//   · 회의록: 초안(DRAFT)은 검토 담당자만 본다. 승인(APPROVED) 후에는 기록 접근권이 있는 참가자 누구나 본다. 후보는 승인 후에도 검토 담당자만 본다.
//   · 회의록을 고치거나 다시 만들면 후보가 새로 만들어져 손본 후보가 사라진다 → 후보는 회의록 승인 뒤에 손본다. 확정(confirm)은 승인 후에만, 프로젝트 반영은 materialize를 따로 불러야 생긴다.
import { useEffect, useState } from "react";
import * as api from "../api/meeting";
import type { MeetingCandidateResponse, MeetingMinutesResponse, MeetingPostprocessResponse } from "../api/meeting";
import * as prj from "../api/project";
import { ApiError, errorText, fieldErrorMap } from "../api/errors";
import { Card, ErrorBox, Field, ghostBtn, inputCls, Modal, primaryBtn, Section, Spinner, useLoad } from "../ui/kit";
import { copyText, safeFileName, saveText } from "./download";
import TranscriptPanel from "./TranscriptPanel";
import { TRANSCRIPT_READY_STATUSES } from "./transcriptView";
import Markdown from "../ui/Markdown";
import {
  CandidateStatusBadge, fmtDateTime, fmtKstDate, kstDateInput, kstDueAt, MATERIALIZE_FAILURE_TEXT, MinutesStatusBadge, POSTPROCESS_FAILURE_TEXT,
  POSTPROCESS_NOT_RETRYABLE, PP_BUSY, PostprocessBadge, ReviewReasonBadge,
} from "./shared";
import ReportPanel from "./ReportPanel";
import type { MeetingCtx } from "./meetingContext";
import { usePoll } from "./usePoll";

const CANDIDATE_WAIT_MS = 90_000; // 회의록 초안(REVIEWING) 뒤 후보가 나타나길 기다리는 최대 시간. 지나면 "다시 확인" 버튼만 남긴다.

function Msg({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return <p className={`text-[12px] font-medium ${msg.ok ? "text-emerald-600" : "text-rose-500"}`}>{msg.text}</p>;
}

// ───────────────────────── 후보 ─────────────────────────
function CandidateEditModal({ meetingId, projectId, c, onClose, onSaved, nameOf }: {
  meetingId: string; projectId: string; c: MeetingCandidateResponse; onClose: () => void; onSaved: (c: MeetingCandidateResponse) => void; nameOf: (id?: string | null) => string;
}) {
  // 담당자는 활성 계정이면서 프로젝트 담당자·멤버여야 한다(열람 전용은 확정·반영 때 409 ASSIGNEE_INVALID).
  const { data: members } = useLoad(() => prj.listProjectMembers(projectId, { status: "ACTIVE", limit: 100 }), [projectId]);
  const assignable = (members?.items ?? []).filter(mem => mem.role === "MANAGER" || mem.role === "MEMBER");
  const [title, setTitle] = useState(c.title);
  const [content, setContent] = useState(c.descriptionOrContent ?? "");
  const [assigneeUserId, setAssigneeUserId] = useState(c.assigneeUserId ?? "");
  // 기한은 KST 날짜로 읽고 쓴다(UTC로 자르면 하루 밀림). 날짜를 건드리지 않았으면 서버 값을 그대로 돌려보낸다.
  const originalDue = kstDateInput(c.dueAt);
  const [dueAt, setDueAt] = useState(originalDue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});
  // DECISION은 내용이 필수다(서버: descriptionOrContent REQUIRED → 400).
  const contentMissing = c.type === "DECISION" && !content.trim();

  async function submit() {
    if (contentMissing) { setFieldErrs({ descriptionOrContent: "결정 내용은 필수 입력입니다" }); return; }
    setBusy(true); setError(null); setFieldErrs({});
    try {
      const due = !dueAt ? null : dueAt === originalDue && c.dueAt ? c.dueAt : kstDueAt(dueAt);
      // PUT은 전체 교체다: 보내지 않은 내용·담당자·마감은 지워진다. TASK는 현재 값을 모두 채워 보내고, DECISION에는 담당자·마감을 보내지 않는다(NOT_ALLOWED).
      onSaved(await api.updateMeetingCandidate(meetingId, c.candidateId, {
        title: title.trim(), descriptionOrContent: content.trim() || null,
        ...(c.type === "TASK" ? { assigneeUserId: assigneeUserId || null, dueAt: due } : {}),
        version: c.version,
      }));
      onClose();
    } catch (e) { setError(errorText(e)); setFieldErrs(fieldErrorMap(e)); } finally { setBusy(false); }
  }
  const knownAssignee = !assigneeUserId || assignable.some(mem => mem.userId === assigneeUserId);
  return (
    <Modal title={`${c.type === "TASK" ? "업무" : "결정"} 후보 수정`} onClose={onClose}>
      {c.reviewReason && <p className="text-[12px] text-orange-600 bg-orange-50 rounded-xl px-3 py-2"><ReviewReasonBadge reason={c.reviewReason} /> AI가 다 확정하지 못한 항목입니다. 담당자와 기한을 채워 수정한 뒤 확정해 주세요.</p>}
      <Field label="제목" error={fieldErrs.title}><input value={title} maxLength={300} onChange={e => setTitle(e.target.value)} className={inputCls} /></Field>
      <Field label={c.type === "DECISION" ? "결정 내용 (필수)" : "내용"} error={fieldErrs.descriptionOrContent}>
        <textarea rows={4} value={content} maxLength={10000} onChange={e => { setContent(e.target.value); if (fieldErrs.descriptionOrContent) setFieldErrs({}); }} className={inputCls} />
      </Field>
      {c.type === "TASK" && (
        <>
          <Field label="담당자" error={fieldErrs.assigneeUserId}>
            <select value={assigneeUserId} onChange={e => setAssigneeUserId(e.target.value)} className={inputCls}>
              <option value="">미지정</option>
              {!knownAssignee && <option value={assigneeUserId}>{nameOf(assigneeUserId)} (프로젝트 담당자·멤버가 아님)</option>}
              {assignable.map(mem => <option key={mem.userId} value={mem.userId}>{nameOf(mem.userId)}</option>)}
            </select>
            {!knownAssignee && <p className="text-[11px] text-amber-600 mt-1">이 사람은 담당자로 확정할 수 없습니다. 다른 사람으로 바꾸거나 비워 주세요.</p>}
          </Field>
          <Field label="마감일 (한국 시간 기준)" error={fieldErrs.dueAt}>
            <input type="date" value={dueAt} onChange={e => setDueAt(e.target.value)} className={inputCls} />
            {c.dueAt && <p className="text-[11px] text-slate-400 mt-1">AI가 회의 내용으로 계산한 기한입니다. 날짜가 맞는지 확인해 주세요.</p>}
          </Field>
        </>
      )}
      {error && <p className="text-[12px] text-rose-500 font-medium">{error}</p>}
      <div className="flex gap-2">
        <button onClick={onClose} className={`flex-1 ${ghostBtn}`}>취소</button>
        <button disabled={busy || !title.trim() || contentMissing} onClick={submit} className={`flex-1 ${primaryBtn}`}>{busy ? "저장 중..." : "저장"}</button>
      </div>
    </Modal>
  );
}

function CandidateRow({ meetingId, projectId, c, minutesApproved, nameOf, onChanged, onStale }: {
  meetingId: string; projectId: string; c: MeetingCandidateResponse; minutesApproved: boolean; nameOf: (id?: string | null) => string;
  onChanged: (c: MeetingCandidateResponse) => void; onStale: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ text: string; code?: string } | null>(null);
  const [editing, setEditing] = useState(false);
  // 상태별로 가능한 동작(10-4): 수정 PROPOSED·EDITED·MATERIALIZATION_FAILED / 확정 PROPOSED·EDITED / 거절 + CONFIRMED·MATERIALIZATION_FAILED / 반영 CONFIRMED·MATERIALIZATION_FAILED
  const canEdit = c.status === "PROPOSED" || c.status === "EDITED" || c.status === "MATERIALIZATION_FAILED";
  const canConfirm = c.status === "PROPOSED" || c.status === "EDITED";
  const canReject = canConfirm || c.status === "CONFIRMED" || c.status === "MATERIALIZATION_FAILED";
  const canMaterialize = c.status === "CONFIRMED" || c.status === "MATERIALIZATION_FAILED";

  async function run(key: string, fn: () => Promise<MeetingCandidateResponse>) {
    setBusy(key); setError(null);
    try { onChanged(await fn()); }
    catch (e) {
      setError({ text: errorText(e), code: e instanceof ApiError ? e.errorCode : undefined });
      // 후보가 오래된 세대이거나 다른 곳에서 바뀌었다 — 목록을 다시 읽어 최신으로 맞춘다.
      if (e instanceof ApiError && ["VERSION_CONFLICT", "SOURCE_STALE", "CANDIDATE_NOT_FOUND", "CANDIDATE_NOT_CONFIRMABLE", "CANDIDATE_NOT_EDITABLE", "CANDIDATE_NOT_REJECTABLE"].includes(e.errorCode)) onStale();
    } finally { setBusy(null); }
  }

  return (
    <Card className="p-4 space-y-2">
      {editing && <CandidateEditModal meetingId={meetingId} projectId={projectId} c={c} nameOf={nameOf} onClose={() => setEditing(false)} onSaved={onChanged} />}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{c.type === "TASK" ? "업무 후보" : "결정 후보"}</p>
          <p className="text-[14px] font-bold text-slate-800 mt-0.5 break-words">{c.title}</p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0"><CandidateStatusBadge status={c.status} />{c.type === "TASK" && <ReviewReasonBadge reason={c.reviewReason} />}</div>
      </div>
      <p className="text-[13px] text-slate-600 whitespace-pre-wrap break-words">{c.descriptionOrContent}</p>
      {c.type === "TASK" && <p className="text-[11px] text-slate-400">담당자: {c.assigneeUserId ? nameOf(c.assigneeUserId) : "미지정"} · 마감 {c.dueAt ? fmtKstDate(c.dueAt) : "미지정"}</p>}
      {c.status === "MATERIALIZED" && <p className="text-[11px] text-emerald-600 font-semibold">프로젝트의 {c.type === "TASK" ? "업무" : "결정"}로 만들어졌습니다. 프로젝트 화면에서 확인하세요.</p>}
      {c.status === "MATERIALIZATION_PENDING" && <p className="text-[11px] text-amber-600 flex items-center gap-1.5"><span className="w-3 h-3 border-2 border-amber-300 border-t-amber-600 rounded-full animate-spin" />프로젝트에 반영하는 중입니다...</p>}
      {c.status === "MATERIALIZATION_FAILED" && <p className="text-[11px] text-rose-500">반영 실패: {(c.failureReasonCode && MATERIALIZE_FAILURE_TEXT[c.failureReasonCode]) || c.failureReasonCode || "알 수 없는 이유"}</p>}

      {(canEdit || canConfirm || canReject || canMaterialize) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-2 border-t border-slate-50">
          {canEdit && <button disabled={!!busy} onClick={() => setEditing(true)} className="text-[11px] text-slate-500 font-semibold hover:text-indigo-600 disabled:opacity-40">수정</button>}
          {canConfirm && (
            <button disabled={!!busy || !minutesApproved} title={!minutesApproved ? "회의록을 승인한 뒤에 확정할 수 있습니다" : undefined}
              onClick={() => run("confirm", () => api.confirmMeetingCandidate(meetingId, c.candidateId, c.version))}
              className="text-[11px] text-indigo-500 font-semibold hover:text-indigo-700 disabled:opacity-30">확정</button>
          )}
          {canReject && <button disabled={!!busy} onClick={() => { if (confirm("이 후보를 반려하시겠습니까?")) void run("reject", () => api.rejectMeetingCandidate(meetingId, c.candidateId, { version: c.version })); }} className="text-[11px] text-rose-400 font-semibold hover:text-rose-600 disabled:opacity-30">반려</button>}
          {canMaterialize && (
            <button disabled={!!busy} onClick={() => run("materialize", () => api.materializeMeetingCandidate(meetingId, c.candidateId, c.version))} className={`${primaryBtn} !py-1.5 !text-[12px]`}>
              {busy === "materialize" ? "요청 중..." : c.status === "MATERIALIZATION_FAILED" ? "다시 반영" : c.type === "TASK" ? "프로젝트 업무로 반영" : "프로젝트 결정으로 반영"}
            </button>
          )}
          {canConfirm && !minutesApproved && <span className="text-[10px] text-slate-400">회의록 승인 후 확정할 수 있습니다</span>}
          {canConfirm && minutesApproved && <span className="text-[10px] text-slate-400">확정만으로는 프로젝트에 생기지 않습니다. 확정 뒤 '반영'을 눌러 주세요</span>}
        </div>
      )}
      {error && (
        <p className="text-[11px] text-rose-500 font-medium">
          {error.text}
          {error.code === "ASSIGNEE_INVALID" && canEdit && <button onClick={() => setEditing(true)} className="ml-2 underline">담당자 수정</button>}
        </p>
      )}
    </Card>
  );
}

// ───────────────────────── 탭 ─────────────────────────
export default function MinutesTab({ ctx }: { ctx: MeetingCtx }) {
  const { m, isReviewOwner, nameOf } = ctx;
  const ended = m.status === "ENDED";
  const [pp, setPp] = useState<MeetingPostprocessResponse | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [minutes, setMinutes] = useState<MeetingMinutesResponse | null>(null);
  const [minutesDenied, setMinutesDenied] = useState(false); // 초안은 검토 담당자 외에는 403 MEETING_MINUTES_ACCESS_DENIED
  const [candidates, setCandidates] = useState<MeetingCandidateResponse[] | null>(null);
  const [candDeadline, setCandDeadline] = useState(0);
  const [, rerender] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [editingContent, setEditingContent] = useState<string | null>(null);
  // 회의록 본문 보기 방식: 렌더링된 화면 / Markdown 소스(복사·내려받기 가능). 화면에 보이는 회의록 그대로의 글자이며, 음성 인식(STT) 원문이 아니다.
  const [rawView, setRawView] = useState(false);
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const minutesReadable = !!minutes && (minutes.status === "DRAFT" || minutes.status === "APPROVED");
  const wantCandidates = isReviewOwner && minutesReadable;

  async function loadCandidates() {
    try { const page = await api.listMeetingCandidates(m.meetingId, { limit: 100 }); setCandidates(page.items); }
    catch { /* 일시 오류는 다음 주기에 다시 시도한다 */ }
  }

  async function refresh() {
    try { const next = await api.getMeetingPostprocess(m.meetingId); setPp(next); setFatal(null); }
    catch (e) { setFatal(errorText(e)); setLoaded(true); return; }
    let min: MeetingMinutesResponse | null = null;
    try { min = await api.getMeetingMinutes(m.meetingId); setMinutes(min); setMinutesDenied(false); }
    catch (e) {
      if (e instanceof ApiError && e.errorCode === "MEETING_MINUTES_ACCESS_DENIED") { setMinutes(null); setMinutesDenied(true); }
      else setFatal(errorText(e));
    }
    if (isReviewOwner && min && (min.status === "DRAFT" || min.status === "APPROVED")) {
      await loadCandidates();
      setCandDeadline(d => (d > Date.now() ? d : Date.now() + CANDIDATE_WAIT_MS));
    } else setCandidates(null);
    setLoaded(true); rerender(x => x + 1);
  }
  useEffect(() => {
    if (ended) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.meetingId, ended, m.postprocessStatus, isReviewOwner]);

  const ppBusy = !!pp && PP_BUSY.includes(pp.status);
  // 1) 후처리 진행 중(또는 회의록 생성 중) → 3초마다 후처리·회의록을 다시 읽는다.
  usePoll(refresh, 3000, ended && (ppBusy || pp?.status === "MINUTES_DRAFT" || minutes?.status === "PROCESSING"), [pp?.status, minutes?.status]);
  // 2) REVIEWING인데 후보가 아직 0건 → 후보가 생길 때까지 2.5초마다(최대 90초). 후보가 없는 채로 끝나는 회의도 있다.
  const waitingCandidates = wantCandidates && minutes?.status === "DRAFT" && candidates?.length === 0 && Date.now() < candDeadline;
  usePoll(async () => { await loadCandidates(); rerender(x => x + 1); }, 2500, !!waitingCandidates, [candidates?.length, candDeadline]);
  // 3) 프로젝트 반영(materialize)은 비동기 — 결과가 MATERIALIZED/MATERIALIZATION_FAILED가 될 때까지.
  usePoll(loadCandidates, 2500, !!candidates?.some(c => c.status === "MATERIALIZATION_PENDING"), [candidates]);
  // 4) 검토 담당자가 아니면 승인되기 전까지 가끔 확인한다(승인 후에야 회의록이 열린다).
  usePoll(refresh, 8000, ended && !isReviewOwner && !!pp && pp.status !== "APPROVED" && !["AI_EGRESS_BLOCKED", "SOURCE_EXPIRED", "FAILED", "MANUAL_RESOLUTION"].includes(pp.status), [pp?.status]);

  if (m.status === "CANCELED") return <p className="text-[13px] text-slate-400 py-8 text-center">취소된 회의입니다.</p>;
  if (!ended) return <p className="text-[13px] text-slate-400 py-8 text-center">{m.status === "IN_PROGRESS" ? "회의가 끝나면 서버가 녹음을 정리해 음성 인식 → 회의록 초안 → 후보 순서로 자동 처리합니다." : "회의가 종료되면 AI 회의록·후보 처리가 시작됩니다."}</p>;
  if (!loaded) return <Spinner text="처리 상태를 불러오는 중..." />;
  if (fatal && !pp) return <ErrorBox message={fatal} onRetry={() => void refresh()} />;
  if (!pp) return null;

  const approved = minutes?.status === "APPROVED";
  const failureCode = pp.failureCode ?? null; // 검토 담당자에게만 온다
  const candidateFailed = (pp.status === "REVIEWING" || pp.status === "APPROVED") && failureCode === "CANDIDATE_GENERATION_FAILED";
  const retryable = isReviewOwner && ((pp.status === "FAILED" && !POSTPROCESS_NOT_RETRYABLE.has(failureCode ?? "")) || candidateFailed);
  const failedLike = pp.status === "FAILED" || pp.status === "AI_EGRESS_BLOCKED" || pp.status === "SOURCE_EXPIRED" || pp.status === "MANUAL_RESOLUTION";

  const guard = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setMsg(null);
    try { await fn(); }
    catch (e) {
      setMsg({ ok: false, text: errorText(e) });
      if (e instanceof ApiError && ["VERSION_CONFLICT", "MINUTES_NOT_DRAFT", "MINUTES_SOURCE_STALE", "MINUTES_REGENERATION_NOT_ALLOWED"].includes(e.errorCode)) void refresh();
    } finally { setBusy(null); }
  };
  const approve = () => {
    if (!minutes) return;
    if (!confirm("회의록을 승인하시겠습니까?\n승인하면 더 이상 수정하거나 다시 만들 수 없고, 기록 접근 권한이 있는 모든 참가자가 회의록을 볼 수 있게 됩니다. 후보 확정은 승인 뒤에 할 수 있습니다.")) return;
    return guard("approve", async () => { setMinutes(await api.approveMeetingMinutes(m.meetingId, minutes.version)); void refresh(); setMsg({ ok: true, text: "회의록을 승인했습니다. 이제 후보를 확정할 수 있습니다." }); });
  };
  const saveContent = () => {
    if (editingContent == null || !minutes) return;
    if ((candidates?.length ?? 0) > 0 && editingContent !== (minutes.content ?? "")
      && !confirm("회의록 내용을 바꾸면 결정·업무 후보가 새로 만들어지고, 이미 손본 후보는 사라집니다. 계속하시겠습니까?")) return;
    return guard("save", async () => {
      const changed = editingContent !== (minutes.content ?? "");
      setMinutes(await api.updateMeetingMinutes(m.meetingId, { content: editingContent, version: minutes.version }));
      setEditingContent(null);
      if (changed) { setCandidates([]); setCandDeadline(Date.now() + CANDIDATE_WAIT_MS); } // 내용이 바뀌면 후보가 몇 초 뒤 새로 생긴다
    });
  };
  const regenerate = () => {
    if (!confirm("회의록을 AI로 처음부터 다시 만들까요?\n내가 고친 내용과 손본 후보가 모두 사라집니다.")) return;
    return guard("regen", async () => { setPp(await api.regenerateMeetingMinutes(m.meetingId)); setCandidates([]); setCandDeadline(Date.now() + CANDIDATE_WAIT_MS); await refresh(); });
  };
  const retry = () => guard("retry", async () => { setPp(await api.retryMeetingPostprocess(m.meetingId, candidateFailed ? { stage: "CANDIDATES" } : {})); await refresh(); });

  const changeTimes = [minutes?.lastEditedAt, minutes?.approvedAt, ...(candidates ?? []).filter(c => !c.status.startsWith("MATERIALIZ")).map(c => c.updatedAt)].filter((t): t is string => !!t).map(t => new Date(t).getTime());
  const latestChangeAt = changeTimes.length ? new Date(Math.max(...changeTimes)).toISOString() : null;
  const decisionCands = (candidates ?? []).filter(c => c.type === "DECISION");
  const taskCands = (candidates ?? []).filter(c => c.type === "TASK");
  const updateCandidate = (u: MeetingCandidateResponse) => setCandidates(cs => (cs ?? []).map(x => x.candidateId === u.candidateId ? u : x));
  const confirmedCount = (candidates ?? []).filter(c => ["CONFIRMED", "MATERIALIZATION_PENDING", "MATERIALIZED", "MATERIALIZATION_FAILED"].includes(c.status)).length;

  return (
    <div className="max-w-2xl space-y-4">
      <Card className="p-5 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div><Section>AI 처리 상태</Section><PostprocessBadge status={pp.status} /></div>
          {retryable && <button disabled={!!busy} onClick={retry} className={ghostBtn}>{busy === "retry" ? "요청 중..." : "다시 시도"}</button>}
        </div>
        {ppBusy && <p className="text-[12px] text-slate-400">회의 길이에 따라 몇 분 이상 걸릴 수 있습니다. 이 화면을 열어 두면 자동으로 갱신됩니다.</p>}
        {failedLike && (
          <p className="text-[12px] text-rose-600 leading-relaxed">
            {(failureCode && POSTPROCESS_FAILURE_TEXT[failureCode])
              ?? (pp.status === "AI_EGRESS_BLOCKED" ? POSTPROCESS_FAILURE_TEXT.AI_EGRESS_BLOCKED
              : pp.status === "SOURCE_EXPIRED" ? POSTPROCESS_FAILURE_TEXT.SOURCE_EXPIRED
              : isReviewOwner ? "처리에 실패했습니다." : `처리에 실패했습니다. 검토 담당자(${nameOf(m.reviewOwnerUserId)})에게 문의해 주세요.`)}
          </p>
        )}
        {candidateFailed && isReviewOwner && <p className="text-[12px] text-amber-600">{POSTPROCESS_FAILURE_TEXT.CANDIDATE_GENERATION_FAILED}</p>}
        {pp.rawHardDeleteAt && pp.status !== "SOURCE_EXPIRED" && !approved && <p className="text-[11px] text-slate-400">녹음·전사문·채팅 원본은 {fmtDateTime(pp.rawHardDeleteAt)}까지 보관되며, 그 뒤에는 회의록을 다시 만들 수 없습니다.</p>}
        {fatal && <p className="text-[12px] text-rose-500">{fatal}</p>}
      </Card>

      {/* 회의록 */}
      {minutes && (minutes.status === "DRAFT" || minutes.status === "APPROVED") && (
        <Card className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <Section>회의록</Section>
            <div className="flex items-center gap-2">
              <MinutesStatusBadge status={minutes.status} />
              {isReviewOwner && minutes.status === "DRAFT" && editingContent == null && <button onClick={() => setEditingContent(minutes.content ?? "")} className="text-[11px] text-indigo-500 font-semibold hover:text-indigo-700">편집</button>}
            </div>
          </div>
          {editingContent != null ? (
            <div className="space-y-2">
              <textarea rows={14} value={editingContent} maxLength={100000} onChange={e => setEditingContent(e.target.value)} className={`${inputCls} font-mono`} />
              <p className="text-[11px] text-slate-400">Markdown으로 작성합니다. {editingContent.length.toLocaleString()} / 100,000자 · 내용을 바꾸면 후보가 새로 만들어집니다.</p>
              <div className="flex gap-2">
                <button onClick={() => setEditingContent(null)} className={`flex-1 ${ghostBtn}`}>취소</button>
                <button disabled={busy === "save" || !editingContent.trim()} onClick={saveContent} className={`flex-1 ${primaryBtn}`}>{busy === "save" ? "저장 중..." : "저장"}</button>
              </div>
            </div>
          ) : minutes.content ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex p-0.5 rounded-lg bg-slate-100" role="group" aria-label="회의록 보기 방식">
                  {([[false, "보기"], [true, "Markdown 소스"]] as const).map(([raw, label]) => (
                    <button key={label} onClick={() => setRawView(raw)} aria-pressed={rawView === raw}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${rawView === raw ? "bg-white text-slate-900 shadow-sm" : "text-slate-400 hover:text-slate-600"}`}>{label}</button>
                  ))}
                </div>
                {rawView && (
                  <div className="flex items-center gap-3">
                    <button onClick={async () => { setCopied((await copyText(minutes.content ?? "")) ? "ok" : "fail"); setTimeout(() => setCopied(null), 2000); }}
                      className="text-[11px] font-semibold text-indigo-500 hover:text-indigo-700">{copied === "ok" ? "복사했습니다" : copied === "fail" ? "복사하지 못했습니다" : "복사"}</button>
                    <button onClick={() => saveText(minutes.content ?? "", `${safeFileName(m.title, "회의록")} 회의록.md`, "text/markdown")}
                      className="text-[11px] font-semibold text-indigo-500 hover:text-indigo-700">.md로 내려받기</button>
                  </div>
                )}
              </div>
              {rawView
                ? <pre tabIndex={0} className="max-h-[480px] overflow-auto rounded-xl bg-slate-50 border border-slate-100 p-3 text-[12px] leading-relaxed font-mono text-slate-700 whitespace-pre-wrap break-words">{minutes.content}</pre>
                : <Markdown source={minutes.content} />}
            </div>
          ) : <p className="text-[12px] text-slate-400">내용이 없습니다.</p>}
          {minutes.lastEditedAt && <p className="text-[11px] text-slate-400">{nameOf(minutes.lastEditedBy)} 님이 {fmtDateTime(minutes.lastEditedAt)}에 수정했습니다.</p>}
          {approved && <p className="text-[11px] text-emerald-600">{nameOf(minutes.approvedBy)} 님이 {fmtDateTime(minutes.approvedAt)}에 승인했습니다.</p>}
          {isReviewOwner && minutes.status === "DRAFT" && editingContent == null && (
            <div className="flex gap-2 pt-2 border-t border-slate-50">
              <button disabled={!!busy} onClick={approve} className={primaryBtn}>{busy === "approve" ? "승인 중..." : "회의록 승인"}</button>
              <button disabled={!!busy} onClick={regenerate} className={ghostBtn}>{busy === "regen" ? "요청 중..." : "다시 생성"}</button>
            </div>
          )}
        </Card>
      )}
      {minutes?.status === "PROCESSING" && <Card className="p-5"><Spinner text="회의록을 다시 만드는 중입니다..." /></Card>}
      {!isReviewOwner && minutesDenied && (pp.status === "REVIEWING" || pp.status === "MINUTES_DRAFT") && (
        <Card className="p-5 text-[13px] text-slate-500">회의록 초안을 검토 담당자({nameOf(m.reviewOwnerUserId)})가 검토하고 있습니다. 승인되면 이곳에서 볼 수 있고 알림이 갑니다.</Card>
      )}
      {minutes && minutes.status === "NOT_STARTED" && !ppBusy && !failedLike && <Card className="p-5 text-[13px] text-slate-500">아직 회의록이 만들어지지 않았습니다.</Card>}

      {/* 후보 — 검토 담당자 전용 */}
      {isReviewOwner && minutesReadable && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Section>결정·업무 후보 ({candidates?.length ?? 0})</Section>
            {minutes?.status === "DRAFT" && <span className="text-[11px] text-slate-400">회의록을 승인해야 확정할 수 있습니다</span>}
          </div>
          {candidates?.length === 0 && (
            waitingCandidates
              ? <Card className="p-4"><Spinner text="후보를 만들고 있습니다... (회의록 초안 뒤 몇 초 더 걸립니다)" /></Card>
              : <Card className="p-4 flex items-center justify-between gap-3"><p className="text-[12px] text-slate-400">후보가 없습니다. 아직 만들어지는 중이거나, 회의에서 뽑힌 항목이 없을 수 있습니다.</p><button onClick={() => { setCandDeadline(Date.now() + CANDIDATE_WAIT_MS); void loadCandidates(); }} className={ghostBtn}>다시 확인</button></Card>
          )}
          {decisionCands.length > 0 && <p className="text-[11px] font-bold text-slate-500">결정 후보</p>}
          {decisionCands.map(c => <CandidateRow key={c.candidateId} meetingId={m.meetingId} projectId={m.projectId} c={c} minutesApproved={approved} nameOf={nameOf} onChanged={updateCandidate} onStale={() => void loadCandidates()} />)}
          {taskCands.length > 0 && <p className="text-[11px] font-bold text-slate-500">업무 후보</p>}
          {taskCands.map(c => <CandidateRow key={c.candidateId} meetingId={m.meetingId} projectId={m.projectId} c={c} minutesApproved={approved} nameOf={nameOf} onChanged={updateCandidate} onStale={() => void loadCandidates()} />)}
          {approved && confirmedCount > 0 && <p className="text-[11px] text-slate-400">후보를 확정했다면 아래 보고서를 만들어 '결정 사항'·'실행 항목'에 반영하세요. (보고서는 요청한 시점의 복사본입니다)</p>}
        </div>
      )}

      {ended && <TranscriptPanel meetingId={m.meetingId} meetingTitle={m.title} nameOf={nameOf} ready={(TRANSCRIPT_READY_STATUSES as readonly string[]).includes(pp.status)} />}
      {isReviewOwner && <ReportPanel m={m} minutesReady={minutesReadable} latestChangeAt={latestChangeAt} />}
      <Msg msg={msg} />
    </div>
  );
}
