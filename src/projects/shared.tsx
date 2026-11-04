// Projects 화면들이 공유하는 조직 디렉터리 조회와 배지 컴포넌트.
import type { ReactNode } from "react";
import { getOrganization } from "../api/identity";
import type { ProjectRole } from "../api/project";
import { Badge, useLoad } from "../ui/kit";
import type { BadgeTone } from "../ui/kit";
import { CircleCheckIcon, CircleHalfIcon, CircleIcon, CircleSlashIcon } from "../ui/icons";

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
export const taskStatusLabel = (s: string) => TASK_STATUS_LABEL[s] ?? s;

// 목록 행용 상태 칩(아이콘 + 라벨). 기존 TaskStatusBadge(프로젝트 상세 등)는 그대로 둔다.
const TASK_CHIP_TONE: Record<string, BadgeTone> = { TODO: "neutral", IN_PROGRESS: "indigo", DONE: "emerald", CANCELED: "neutral" };
const TASK_CHIP_ICON: Record<string, () => ReactNode> = {
  TODO: () => <CircleIcon size={11} />, IN_PROGRESS: () => <CircleHalfIcon size={11} />, DONE: () => <CircleCheckIcon size={11} />, CANCELED: () => <CircleSlashIcon size={11} />,
};
export function TaskStatusChip({ status }: { status: string }) {
  return <Badge tone={TASK_CHIP_TONE[status] ?? "neutral"}>{TASK_CHIP_ICON[status]?.()}{TASK_STATUS_LABEL[status] ?? status}</Badge>;
}
/** 목록 왼쪽의 상태 아이콘(체크 원). 클릭 대상이 아니라 상태 표시용이다. */
export function TaskStatusMark({ status }: { status: string }) {
  const cls = status === "DONE" ? "text-emerald-500" : status === "IN_PROGRESS" ? "text-indigo-500" : "text-slate-300";
  const Icon = status === "DONE" ? CircleCheckIcon : status === "IN_PROGRESS" ? CircleHalfIcon : status === "CANCELED" ? CircleSlashIcon : CircleIcon;
  return <span className={`shrink-0 ${cls}`}><Icon size={18} /></span>;
}

const DECISION_STATUS_LABEL: Record<string, string> = { ACTIVE: "확정", SUPERSEDED: "대체됨" };
export function DecisionStatusBadge({ status }: { status: string }) {
  return <span className={`inline-flex text-[10px] font-bold px-2.5 py-0.5 rounded-full ${status === "ACTIVE" ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400"}`}>{DECISION_STATUS_LABEL[status] ?? status}</span>;
}

/** 목록용 짧은 날짜(MM.DD). */
export function fmtMD(iso?: string | null) {
  if (!iso) return "-";
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}
/** 마감일 표시 색: 기한 초과/임박/보통. 완료·취소 업무는 강조하지 않는다. */
export function dueTone(iso: string | null | undefined, status: string): "overdue" | "soon" | "normal" {
  if (status === "DONE" || status === "CANCELED") return "normal";
  const d = daysUntil(iso);
  if (d == null) return "normal";
  return d < 0 ? "overdue" : d <= 3 ? "soon" : "normal";
}
export const DUE_TONE_CLS = { overdue: "text-rose-500", soon: "text-amber-600", normal: "text-slate-400" } as const;

export function fmtDate(iso?: string | null) {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
}
export function daysUntil(iso?: string | null) {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
}
