// Meeting 화면들이 공유하는 배지·포맷 헬퍼와 홈 화면용 요약 훅.
import * as api from "../api/meeting";
import type { CandidateReviewReason, CandidateStatus, MeetingExternalAiPolicy, MeetingSensitivity, MeetingStatus, MinutesStatus, ParticipationStatus, PostprocessStatus, RecordAccessState } from "../api/meeting";
import type { DocumentProcessingStatus } from "../api/document";
import { useLoad } from "../ui/kit";

const STATUS_LABEL: Record<MeetingStatus, string> = { SCHEDULED: "예정", IN_PROGRESS: "진행 중", ENDED: "종료", CANCELED: "취소됨" };
const STATUS_CLS: Record<MeetingStatus, string> = { SCHEDULED: "bg-indigo-50 text-indigo-600", IN_PROGRESS: "bg-emerald-50 text-emerald-600", ENDED: "bg-slate-100 text-slate-500", CANCELED: "bg-rose-50 text-rose-400" };
export function MeetingStatusBadge({ status }: { status: MeetingStatus }) {
  return <span className={`inline-flex text-[10px] font-bold px-2.5 py-0.5 rounded-full ${STATUS_CLS[status]}`}>{STATUS_LABEL[status]}</span>;
}

export const SENS_LABEL: Record<MeetingSensitivity, string> = { INTERNAL: "일반", CONFIDENTIAL: "기밀", PII: "개인정보", CORE_TRADE_SECRET: "핵심 영업비밀" };
const SENS_CLS: Record<MeetingSensitivity, string> = { INTERNAL: "bg-slate-100 text-slate-500", CONFIDENTIAL: "bg-amber-50 text-amber-600", PII: "bg-rose-50 text-rose-600", CORE_TRADE_SECRET: "bg-rose-100 text-rose-700" };
export function SensitivityBadge({ level }: { level: MeetingSensitivity }) {
  return <span className={`inline-flex text-[10px] font-bold px-2.5 py-0.5 rounded-full ${SENS_CLS[level]}`}>{SENS_LABEL[level]}</span>;
}
export const SENSITIVITY_LEVELS: MeetingSensitivity[] = ["INTERNAL", "CONFIDENTIAL", "PII", "CORE_TRADE_SECRET"];
export const SENS_RANK: Record<MeetingSensitivity, number> = { INTERNAL: 0, CONFIDENTIAL: 1, PII: 2, CORE_TRADE_SECRET: 3 };

export const PP_LABEL: Record<PostprocessStatus, string> = {
  NOT_STARTED: "대기", WAITING_EVIDENCE_SNAPSHOT: "증거 스냅샷 준비", WAITING_RECORDING: "녹음 확보 중", STT_QUEUED: "음성 인식 대기",
  STT_PROCESSING: "음성 인식 중", STT_READY: "음성 인식 완료", MINUTES_QUEUED: "회의록 생성 대기", MINUTES_PROCESSING: "회의록 생성 중",
  MINUTES_DRAFT: "AI 초안 · 검토 필요", REVIEWING: "검토 중", APPROVED: "승인 완료", AI_EGRESS_BLOCKED: "민감정보 · 외부 AI 전송 차단",
  SOURCE_EXPIRED: "원본 만료", MANUAL_RESOLUTION: "수동 처리 필요", FAILED: "처리 실패",
};
export const PP_BUSY: PostprocessStatus[] = ["WAITING_EVIDENCE_SNAPSHOT", "WAITING_RECORDING", "STT_QUEUED", "STT_PROCESSING", "STT_READY", "MINUTES_QUEUED", "MINUTES_PROCESSING"];
export function PostprocessBadge({ status }: { status: PostprocessStatus }) {
  const busy = PP_BUSY.includes(status);
  const bad = status === "AI_EGRESS_BLOCKED" || status === "FAILED" || status === "SOURCE_EXPIRED" || status === "MANUAL_RESOLUTION";
  const cls = status === "APPROVED" ? "bg-emerald-50 text-emerald-600 border-emerald-100"
    : status === "MINUTES_DRAFT" || status === "REVIEWING" ? "bg-amber-50 text-amber-600 border-amber-100"
    : bad ? "bg-rose-50 text-rose-600 border-rose-100"
    : busy ? "bg-indigo-50 text-indigo-600 border-indigo-100" : "bg-slate-50 text-slate-400 border-slate-100";
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold border rounded-full px-2.5 py-1 ${cls}`}>
      {busy && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}{PP_LABEL[status]}
    </span>
  );
}

const MINUTES_LABEL: Record<MinutesStatus, string> = { NOT_STARTED: "미시작", PROCESSING: "생성 중", DRAFT: "초안", APPROVED: "승인됨", FAILED: "실패" };
export function MinutesStatusBadge({ status }: { status: MinutesStatus }) {
  const cls = status === "APPROVED" ? "bg-emerald-50 text-emerald-600" : status === "DRAFT" ? "bg-amber-50 text-amber-600" : status === "FAILED" ? "bg-rose-50 text-rose-600" : "bg-slate-100 text-slate-500";
  return <span className={`inline-flex text-[10px] font-bold px-2.5 py-0.5 rounded-full ${cls}`}>{MINUTES_LABEL[status]}</span>;
}

const CAND_LABEL: Record<CandidateStatus, string> = {
  PROPOSED: "AI 제안", EDITED: "수정됨", CONFIRMED: "확정됨", REJECTED: "반려됨",
  MATERIALIZATION_PENDING: "생성 대기", MATERIALIZED: "생성 완료", MATERIALIZATION_FAILED: "생성 실패",
};
export function CandidateStatusBadge({ status }: { status: CandidateStatus }) {
  const cls = status === "MATERIALIZED" ? "bg-emerald-50 text-emerald-600" : status === "CONFIRMED" ? "bg-indigo-50 text-indigo-600"
    : status === "REJECTED" || status === "MATERIALIZATION_FAILED" ? "bg-rose-50 text-rose-500" : "bg-amber-50 text-amber-600";
  return <span className={`inline-flex text-[10px] font-bold px-2.5 py-0.5 rounded-full ${cls}`}>{CAND_LABEL[status]}</span>;
}

const PART_CLS: Record<ParticipationStatus, string> = { ACTIVE: "bg-slate-100 text-slate-600", REMOVED: "bg-rose-50 text-rose-400" };
export function ParticipationBadge({ status }: { status: ParticipationStatus }) {
  return <span className={`inline-flex text-[10px] font-bold px-2 py-0.5 rounded ${PART_CLS[status]}`}>{status === "ACTIVE" ? "참여 중" : "제외됨"}</span>;
}
const REC_CLS: Record<RecordAccessState, string> = { GRANTED: "bg-emerald-50 text-emerald-600", REVOKED: "bg-rose-50 text-rose-500" };
export function RecordAccessBadge({ state }: { state: RecordAccessState }) {
  return <span className={`inline-flex text-[10px] font-bold px-2 py-0.5 rounded ${REC_CLS[state]}`}>{state === "GRANTED" ? "기록 접근 가능" : "기록 접근 회수됨"}</span>;
}

export function fmtDateTime(iso?: string | null) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
export function fmtDate(iso?: string | null) {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
}

// SchedulePicker는 로컬 시각 문자열("YYYY-MM-DDTHH:mm")을 쓴다. 서버로는 시간대가 붙은 RFC 3339로 보내고(없으면 400 TIMEZONE_REQUIRED),
// 응답 시각은 생성·수정 응답이 보낸 표기 그대로(+09:00)이고 조회는 UTC(Z)라서 항상 Date로 파싱해 다룬다.
const pad2 = (n: number) => String(n).padStart(2, "0");
export function isoToLocalInput(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
export function localInputToIso(local: string) {
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// 후보의 dueAt은 서버가 Asia/Seoul 기준으로 계산한 UTC 시각이다(예: 목요일 0시 KST = 수요일 15:00Z).
// UTC 날짜를 잘라 쓰면 하루 밀리므로 날짜는 항상 KST로 읽고 쓴다.
const KST_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" });
export function kstDateInput(iso?: string | null) {
  return iso ? KST_DATE.format(new Date(iso)) : "";
}
export function kstDueAt(date: string) {
  return `${date}T00:00:00+09:00`;
}
export function fmtKstDate(iso?: string | null) {
  return iso ? kstDateInput(iso).replace(/-/g, ".") : "-";
}

// 후보 reviewReason: AI가 다 확정하지 못한 TASK → "검토 필요" 표시.
export const REVIEW_REASON_LABEL: Record<CandidateReviewReason, string> = {
  UNKNOWN_ASSIGNEE: "담당자 확인 필요", AMBIGUOUS_DEADLINE: "기한 확인 필요", UNKNOWN_STATE: "진행 상태 확인 필요", AMBIGUOUS_REFERENCE: "대상 확인 필요",
};
export function ReviewReasonBadge({ reason }: { reason?: CandidateReviewReason | null }) {
  if (!reason) return null;
  return <span className="inline-flex text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-orange-50 text-orange-600">검토 필요 · {REVIEW_REASON_LABEL[reason] ?? "확인 필요"}</span>;
}

export const AI_POLICY_LABEL: Record<MeetingExternalAiPolicy, string> = { INHERIT: "프로젝트 정책 따름", ALLOWED: "허용", BLOCKED: "차단" };

// 회의 내용을 외부 AI로 보낼 수 있는 조건은 민감도 INTERNAL + 외부 AI 정책이 BLOCKED가 아닐 때다(그래도 회사 AI 설정에 따라 막힐 수 있다).
// 막히면 종료 후 후처리가 AI_EGRESS_BLOCKED로 끝나고 회의록·후보·보고서가 만들어지지 않는다. 종료 후에는 민감도를 바꿀 수 없다.
export const isAiBlocked = (sensitivity: MeetingSensitivity, policy: MeetingExternalAiPolicy) => sensitivity !== "INTERNAL" || policy === "BLOCKED";
export const AI_BLOCKED_TEXT = "이 설정에서는 AI 처리(회의록·후보·보고서)가 되지 않습니다. 민감도는 올리기만 할 수 있고 되돌릴 수 없으니 신중히 선택해 주세요.";

// 후처리 실패 사유(검토 담당자에게만 온다). 14-1: 녹음이 없으면 재시도해도 막다른 길이다.
export const POSTPROCESS_FAILURE_TEXT: Record<string, string> = {
  RECORDING_FAILED: "녹음이 없어 회의록을 만들 수 없습니다. 회의에서 아무도 마이크를 켜지 않았거나 녹음 파일이 오지 않았습니다.",
  STT_FAILED: "음성을 글로 바꾸지 못했습니다.",
  AI_EGRESS_BLOCKED: "민감도 또는 외부 AI 정책 때문에 AI 처리가 허용되지 않은 회의입니다. 종료 후에는 설정을 바꿀 수 없어 회의록을 직접 작성해야 합니다.",
  MINUTES_GENERATION_FAILED: "회의록을 만들지 못했습니다.",
  CANDIDATE_GENERATION_FAILED: "회의록은 만들어졌지만 결정·업무 후보를 만들지 못했습니다.",
  SOURCE_EXPIRED: "원본 보관 기간(종료 후 7일)이 지나 더 진행할 수 없습니다.",
  ATTACHMENT_POLICY_BLOCKED: "회의 자료가 정책에 막혀 처리할 수 없습니다.",
};
// 다시 시도해도 같은 결과인 실패 — 재시도 버튼을 숨긴다(14-1 #1·#2).
export const POSTPROCESS_NOT_RETRYABLE = new Set(["RECORDING_FAILED", "AI_EGRESS_BLOCKED", "SOURCE_EXPIRED", "ATTACHMENT_POLICY_BLOCKED"]);

// 후보를 프로젝트에 반영하다 실패한 이유(failureReasonCode). mock은 PROJECT_NOT_ACTIVE·ASSIGNEE_INVALID도 쓴다.
export const MATERIALIZE_FAILURE_TEXT: Record<string, string> = {
  ASSIGNEE_UNAVAILABLE: "담당자 계정을 사용할 수 없습니다. 담당자를 바꿔 다시 시도해 주세요.",
  ASSIGNEE_INVALID: "담당자가 프로젝트의 활성 구성원(담당자·멤버)이 아닙니다. 담당자를 바꿔 다시 시도해 주세요.",
  CROSS_TENANT_CANDIDATE_TARGET: "다른 회사의 대상으로는 만들 수 없습니다.",
  CROSS_TENANT_CONTEXT: "다른 회사의 데이터는 사용할 수 없습니다.",
  PROJECT_COMPLETED: "완료된 프로젝트에는 반영할 수 없습니다.",
  PROJECT_ARCHIVED: "보관된 프로젝트에는 반영할 수 없습니다.",
  PROJECT_NOT_ACTIVE: "진행 중인 프로젝트에만 반영할 수 있습니다.",
  SOURCE_CANDIDATE_ALREADY_PROCESSED: "이미 처리된 후보입니다.",
  INVALID_SOURCE: "유효하지 않은 출처의 후보입니다.",
};

// 회의 자료(첨부) 처리 상태. READY만 AI 근거로 쓰인다. FAILED는 보고서·후보 생성을 막지 않고 그 파일만 근거에서 빠진다.
const ATT_LABEL: Record<DocumentProcessingStatus, string> = {
  NOT_REQUESTED: "처리 전", QUEUED: "대기 중", PARSING: "글자 추출 중", PARSED: "글자 추출 완료", EMBEDDING: "색인 중",
  READY: "AI 근거로 사용 가능", FAILED: "처리 실패", BLOCKED_BY_POLICY: "정책으로 AI 사용 안 함", STALE: "문서가 바뀌어 다시 처리 필요",
};
export const ATTACHMENT_BUSY: DocumentProcessingStatus[] = ["QUEUED", "PARSING", "PARSED", "EMBEDDING"];
export const ATTACHMENT_FAILURE_TEXT: Record<string, string> = {
  NOT_SUPPORTED: "AI가 읽을 수 없는 형식입니다 (PDF·Word(.docx)·PowerPoint(.pptx)·텍스트만 읽습니다)",
  PARSER_ERROR: "파일을 읽지 못했습니다",
  AI_JOB_SOURCE_UNAVAILABLE: "일시적으로 처리하지 못했습니다. 잠시 후 다시 확인해 주세요",
  AI_JOB_RETRY_EXHAUSTED: "자동 재시도를 모두 사용했습니다. 파일을 다시 올려 주세요",
};
export function AttachmentStatusBadge({ status, failureCode }: { status?: DocumentProcessingStatus; failureCode?: string | null }) {
  if (!status) return null;
  const busy = ATTACHMENT_BUSY.includes(status);
  const cls = status === "READY" ? "bg-emerald-50 text-emerald-600" : status === "FAILED" ? "bg-rose-50 text-rose-500" : busy ? "bg-indigo-50 text-indigo-600" : "bg-slate-100 text-slate-500";
  return (
    <span title={failureCode ? ATTACHMENT_FAILURE_TEXT[failureCode] ?? failureCode : undefined} className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${cls}`}>
      {busy && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}{ATT_LABEL[status]}
    </span>
  );
}

// 홈 화면 위젯: 예정·진행 중 회의 + 내가 reviewOwner인 검토 대기 회의를 한 번의 목록 조회로 파생한다.
export function useMyMeetingsSummary(myUserId?: string) {
  const { data, loading, error, reload } = useLoad(() => api.listMeetings({ limit: 50 }), []);
  const items = data?.items ?? [];
  const startMs = (m: api.MeetingResponse) => new Date(m.scheduledStartAt ?? m.createdAt).getTime();
  const upcoming = items.filter(m => m.status === "SCHEDULED").sort((a, b) => startMs(a) - startMs(b));
  // 참여할 수 있는 회의: 진행 중이 먼저, 그다음 예정 시각순. 참가에서 제외된 회의는 뺀다.
  const active = items.filter(m => (m.status === "SCHEDULED" || m.status === "IN_PROGRESS") && m.myParticipationStatus !== "REMOVED")
    .sort((a, b) => (a.status === b.status ? startMs(a) - startMs(b) : a.status === "IN_PROGRESS" ? -1 : 1));
  const needsReview = items.filter(m => m.status === "ENDED" && m.reviewOwnerUserId === myUserId && (m.postprocessStatus === "MINUTES_DRAFT" || m.postprocessStatus === "REVIEWING"));
  return { upcoming, active, needsReview, loading, error, reload };
}
