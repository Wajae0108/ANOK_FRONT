// Projects 화면들이 공유하는 조직 디렉터리 조회와 배지 컴포넌트.
import { getOrganization } from "../api/identity";
import type { ProjectRole } from "../api/project";
import { useLoad } from "../ui/kit";

export function useOrgUsers() {
  const { data, loading, error, reload } = useLoad(() => getOrganization(), []);
  const users = data?.users ?? [];
  const nameOf = (userId?: string | null) => (userId && users.find(u => u.userId === userId)?.displayName) ?? "알 수 없음";
  return { users, nameOf, loading, error, reload };
}

const ROLE_LABEL: Record<ProjectRole, string> = { MANAGER: "담당자", MEMBER: "멤버", VIEWER: "열람자" };
const ROLE_CLS: Record<ProjectRole, string> = { MANAGER: "bg-indigo-100 text-indigo-700", MEMBER: "bg-slate-100 text-slate-600", VIEWER: "bg-slate-50 text-slate-400" };
export function ProjectRoleBadge({ role }: { role: ProjectRole }) {
  return <span className={`inline-flex text-[10px] font-bold px-2 py-0.5 rounded ${ROLE_CLS[role]}`}>{ROLE_LABEL[role]}</span>;
}

const STATUS_LABEL: Record<string, string> = { ACTIVE: "진행", COMPLETED: "완료", ARCHIVED: "보관" };
const STATUS_CLS: Record<string, string> = { ACTIVE: "bg-indigo-50 text-indigo-600", COMPLETED: "bg-emerald-50 text-emerald-600", ARCHIVED: "bg-slate-100 text-slate-500" };
export function ProjectStatusBadge({ status }: { status: string }) {
  return <span className={`inline-flex text-[10px] font-bold px-2.5 py-0.5 rounded-full ${STATUS_CLS[status] ?? "bg-slate-100 text-slate-500"}`}>{STATUS_LABEL[status] ?? status}</span>;
}

const TASK_STATUS_LABEL: Record<string, string> = { TODO: "대기", IN_PROGRESS: "진행 중", DONE: "완료", CANCELED: "취소" };
const TASK_STATUS_CLS: Record<string, string> = { TODO: "bg-slate-100 text-slate-500", IN_PROGRESS: "bg-indigo-50 text-indigo-600", DONE: "bg-emerald-50 text-emerald-600", CANCELED: "bg-slate-100 text-slate-400" };
export function TaskStatusBadge({ status }: { status: string }) {
  return <span className={`inline-flex text-[10px] font-bold px-2.5 py-0.5 rounded-full ${TASK_STATUS_CLS[status] ?? "bg-slate-100"}`}>{TASK_STATUS_LABEL[status] ?? status}</span>;
}

const DECISION_STATUS_LABEL: Record<string, string> = { ACTIVE: "확정", SUPERSEDED: "대체됨" };
export function DecisionStatusBadge({ status }: { status: string }) {
  return <span className={`inline-flex text-[10px] font-bold px-2.5 py-0.5 rounded-full ${status === "ACTIVE" ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400"}`}>{DECISION_STATUS_LABEL[status] ?? status}</span>;
}

export function fmtDate(iso?: string | null) {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
}
export function daysUntil(iso?: string | null) {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
}
