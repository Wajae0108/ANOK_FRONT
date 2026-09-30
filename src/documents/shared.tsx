// Documents 화면들이 공유하는 배지/포맷 유틸.
import type { AclPermission, DocumentProcessingStatus, DocumentStatus, EffectivePermission, SensitivityClassification } from "../api/document";

const PERM_LABEL: Record<EffectivePermission, string> = { OWNER: "소유자", EDITOR: "편집자", VIEWER: "열람자" };
const PERM_CLS: Record<EffectivePermission, string> = { OWNER: "bg-indigo-100 text-indigo-700", EDITOR: "bg-amber-50 text-amber-600", VIEWER: "bg-slate-50 text-slate-400" };
export function PermissionBadge({ permission }: { permission: EffectivePermission }) {
  return <span className={`inline-flex text-[10px] font-bold px-2 py-0.5 rounded ${PERM_CLS[permission]}`}>{PERM_LABEL[permission]}</span>;
}

const ACL_LABEL: Record<AclPermission, string> = { EDITOR: "편집자", VIEWER: "열람자", DENY: "차단" };
export function AclBadge({ permission }: { permission: AclPermission }) {
  const cls = permission === "DENY" ? "bg-rose-50 text-rose-600" : permission === "EDITOR" ? "bg-amber-50 text-amber-600" : "bg-slate-50 text-slate-400";
  return <span className={`inline-flex text-[10px] font-bold px-2 py-0.5 rounded ${cls}`}>{ACL_LABEL[permission]}</span>;
}

const SENSITIVITY_LABEL: Record<SensitivityClassification, string> = { INTERNAL: "일반", CONFIDENTIAL: "기밀", PII: "개인정보", CORE_TRADE_SECRET: "핵심 영업기밀" };
const SENSITIVITY_CLS: Record<SensitivityClassification, string> = { INTERNAL: "bg-slate-100 text-slate-500", CONFIDENTIAL: "bg-amber-50 text-amber-600", PII: "bg-rose-50 text-rose-600", CORE_TRADE_SECRET: "bg-rose-100 text-rose-700" };
export function SensitivityBadge({ value }: { value: SensitivityClassification }) {
  return <span className={`inline-flex text-[10px] font-bold px-2.5 py-0.5 rounded-full ${SENSITIVITY_CLS[value]}`}>{SENSITIVITY_LABEL[value]}</span>;
}

const STATUS_LABEL: Record<DocumentStatus, string> = { ACTIVE: "사용 중", ARCHIVED: "보관됨" };
export function DocumentStatusBadge({ status }: { status: DocumentStatus }) {
  return <span className={`inline-flex text-[10px] font-bold px-2.5 py-0.5 rounded-full ${status === "ACTIVE" ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-500"}`}>{STATUS_LABEL[status]}</span>;
}

const PROCESSING_LABEL: Record<DocumentProcessingStatus, string> = {
  NOT_REQUESTED: "AI 처리 안 함", QUEUED: "대기 중", PARSING: "분석 중", PARSED: "분석 완료", EMBEDDING: "임베딩 중",
  READY: "AI 검색 가능", BLOCKED_BY_POLICY: "정책상 차단", FAILED: "처리 실패", STALE: "재처리 필요",
};
const PROCESSING_CLS: Record<DocumentProcessingStatus, string> = {
  NOT_REQUESTED: "bg-slate-100 text-slate-400", QUEUED: "bg-amber-50 text-amber-600", PARSING: "bg-amber-50 text-amber-600", PARSED: "bg-amber-50 text-amber-600",
  EMBEDDING: "bg-amber-50 text-amber-600", READY: "bg-emerald-50 text-emerald-600", BLOCKED_BY_POLICY: "bg-rose-50 text-rose-600", FAILED: "bg-rose-50 text-rose-600", STALE: "bg-slate-100 text-slate-500",
};
export function ProcessingBadge({ status }: { status: DocumentProcessingStatus }) {
  return <span className={`inline-flex text-[10px] font-bold px-2.5 py-0.5 rounded-full ${PROCESSING_CLS[status]}`}>{PROCESSING_LABEL[status]}</span>;
}

export function fmtDate(iso?: string | null) { return iso ? new Date(iso).toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" }) : "-"; }
export function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
