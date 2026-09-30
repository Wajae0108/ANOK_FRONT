// Meeting 화면들이 공유하는 배지·포맷 헬퍼와 홈 화면용 요약 훅.
import * as api from "../api/meeting";
import type { CandidateStatus, MeetingSensitivity, MeetingStatus, MinutesStatus, ParticipationStatus, PostprocessStatus, RecordAccessState } from "../api/meeting";
import { useLoad } from "../ui/kit";

const STATUS_LABEL: Record<MeetingStatus, string> = { SCHEDULED: "예정", IN_PROGRESS: "진행 중", ENDED: "종료", CANCELED: "취소됨" };
const STATUS_CLS: Record<MeetingStatus, string> = { SCHEDULED: "bg-indigo-50 text-indigo-600", IN_PROGRESS: "bg-emerald-50 text-emerald-600", ENDED: "bg-slate-100 text-slate-500", CANCELED: "bg-rose-50 text-rose-400" };
export function MeetingStatusBadge({ status }: { status: MeetingStatus }) {
  return <span className={`inline-flex text-[10px] font-bold px-2.5 py-0.5 rounded-full ${STATUS_CLS[status]}`}>{STATUS_LABEL[status]}</span>;
}

const SENS_LABEL: Record<MeetingSensitivity, string> = { INTERNAL: "일반", CONFIDENTIAL: "기밀", PII: "개인정보", CORE_TRADE_SECRET: "핵심 영업비밀" };
const SENS_CLS: Record<MeetingSensitivity, string> = { INTERNAL: "bg-slate-100 text-slate-500", CONFIDENTIAL: "bg-amber-50 text-amber-600", PII: "bg-rose-50 text-rose-600", CORE_TRADE_SECRET: "bg-rose-100 text-rose-700" };
export function SensitivityBadge({ level }: { level: MeetingSensitivity }) {
  return <span className={`inline-flex text-[10px] font-bold px-2.5 py-0.5 rounded-full ${SENS_CLS[level]}`}>{SENS_LABEL[level]}</span>;
}
export const SENSITIVITY_LEVELS: MeetingSensitivity[] = ["INTERNAL", "CONFIDENTIAL", "PII", "CORE_TRADE_SECRET"];
export const SENS_RANK: Record<MeetingSensitivity, number> = { INTERNAL: 0, CONFIDENTIAL: 1, PII: 2, CORE_TRADE_SECRET: 3 };

const PP_LABEL: Record<PostprocessStatus, string> = {
  NOT_STARTED: "대기", WAITING_EVIDENCE_SNAPSHOT: "증거 스냅샷 준비", WAITING_RECORDING: "녹음 확보 중", STT_QUEUED: "음성 인식 대기",
  STT_PROCESSING: "음성 인식 중", STT_READY: "음성 인식 완료", MINUTES_QUEUED: "회의록 생성 대기", MINUTES_PROCESSING: "회의록 생성 중",
  MINUTES_DRAFT: "AI 초안 · 검토 필요", REVIEWING: "검토 중", APPROVED: "승인 완료", AI_EGRESS_BLOCKED: "민감정보 · 외부 AI 전송 차단",
  SOURCE_EXPIRED: "원본 만료", MANUAL_RESOLUTION: "수동 처리 필요", FAILED: "처리 실패",
};
const PP_BUSY: PostprocessStatus[] = ["WAITING_EVIDENCE_SNAPSHOT", "WAITING_RECORDING", "STT_QUEUED", "STT_PROCESSING", "STT_READY", "MINUTES_QUEUED", "MINUTES_PROCESSING"];
export function PostprocessBadge({ status }: { status: PostprocessStatus }) {
  const busy = PP_BUSY.includes(status);
  const bad = status === "AI_EGRESS_BLOCKED" || status === "FAILED" || status === "SOURCE_EXPIRED" || status === "MANUAL_RESOLUTION";
  const cls = status === "APPROVED" ? "bg-emerald-50 text-emerald-600 border-emerald-100"
    : status === "MINUTES_DRAFT" ? "bg-amber-50 text-amber-600 border-amber-100"
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

// 홈 화면 위젯: 예정 회의 + 내가 reviewOwner인 검토 대기 회의를 한 번의 목록 조회로 파생한다.
export function useMyMeetingsSummary(myUserId?: string) {
  const { data, loading, error } = useLoad(() => api.listMeetings({ limit: 50 }), []);
  const items = data?.items ?? [];
  const upcoming = items.filter(m => m.status === "SCHEDULED").sort((a, b) => new Date(a.scheduledStartAt ?? a.createdAt).getTime() - new Date(b.scheduledStartAt ?? b.createdAt).getTime());
  const needsReview = items.filter(m => m.reviewOwnerUserId === myUserId && (m.postprocessStatus === "MINUTES_DRAFT" || m.postprocessStatus === "AI_EGRESS_BLOCKED"));
  return { upcoming, needsReview, loading, error };
}
