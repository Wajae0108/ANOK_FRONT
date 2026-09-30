// ANOK_BACKEND project_service의 실제 Controller/DTO 기준. 명세와 다른 점:
// - identityAvailability/assigneeAvailability는 enum 문자열이 아니라 boolean(true = 사용 가능).
// - Task 목록 필터는 assigneeUserId/dueAfter/dueBefore, Schedule 목록 필터는 startsAfter/startsBefore(기간)다.
// - ScheduleItem.startsAt은 필수(@NotNull)다.
// - Manager recovery 목록은 status 필터가 없고, 복구 응답은 ProjectMemberResponse가 아니라 ManagerRecoveryProjectResponse다.
import { request } from "./http";
import type { OffsetPage, Rfc3339, Uuid } from "./types";

export type ProjectStatus = "ACTIVE" | "COMPLETED" | "ARCHIVED";
export type ProjectRole = "MANAGER" | "MEMBER" | "VIEWER";
export type ProjectMembershipStatus = "ACTIVE" | "SUSPENDED_BY_IDENTITY" | "REMOVED";
export type ExternalAiPolicy = "INHERIT" | "ALLOWED" | "BLOCKED";
export type DecisionStatus = "ACTIVE" | "SUPERSEDED";
export type DecisionSourceType = "MANUAL" | "MEETING_CANDIDATE";
export type TaskStatus = "TODO" | "IN_PROGRESS" | "DONE" | "CANCELED";
export type TaskSourceType = "MANUAL" | "MEETING_CANDIDATE" | "DECISION";
export type ProjectScheduleType = "MILESTONE" | "EVENT";
export type ProjectScheduleStatus = "ACTIVE" | "CANCELED";

export interface ProjectResponse {
  projectId: Uuid; name: string; description?: string | null; status: ProjectStatus; externalAiPolicy: ExternalAiPolicy;
  myRole: ProjectRole; managerRecoveryRequired: boolean; createdByUserId: Uuid;
  createdAt: Rfc3339; updatedAt: Rfc3339; completedAt?: Rfc3339 | null; archivedAt?: Rfc3339 | null; version: number;
}
export interface ProjectCompletionResponse { project: ProjectResponse; incompleteTaskCount: number }
export interface ProjectMemberResponse {
  membershipId: Uuid; projectId: Uuid; userId: Uuid; role: ProjectRole; status: ProjectMembershipStatus;
  joinedAt: Rfc3339; suspendedAt?: Rfc3339 | null; restoredAt?: Rfc3339 | null; removedAt?: Rfc3339 | null;
  version: number; identityAvailability: boolean;
}
export interface ManagerRecoveryProjectSummary { projectId: Uuid; name: string; status: ProjectStatus; activeManagerCount: number }
export interface DecisionResponse {
  decisionId: Uuid; projectId: Uuid; title: string; content: string; status: DecisionStatus; sourceType: DecisionSourceType;
  sourceMeetingId?: Uuid | null; sourceCandidateId?: Uuid | null; createdByUserId: Uuid; confirmedAt: Rfc3339;
  supersededById?: Uuid | null; createdAt: Rfc3339; updatedAt: Rfc3339; version: number;
}
export interface DecisionSupersedeResponse { previous: DecisionResponse; current: DecisionResponse }
export interface TaskResponse {
  taskId: Uuid; projectId: Uuid; title: string; description?: string | null; status: TaskStatus;
  assigneeUserId?: Uuid | null; assigneeAvailability: boolean; dueAt?: Rfc3339 | null;
  sourceType: TaskSourceType; sourceMeetingId?: Uuid | null; sourceCandidateId?: Uuid | null; sourceDecisionId?: Uuid | null;
  createdByUserId: Uuid; createdAt: Rfc3339; updatedAt: Rfc3339;
  startedAt?: Rfc3339 | null; completedAt?: Rfc3339 | null; canceledAt?: Rfc3339 | null; version: number;
}
export interface ProjectScheduleItemResponse {
  scheduleItemId: Uuid; projectId: Uuid; type: ProjectScheduleType; title: string; description?: string | null;
  startsAt: Rfc3339; endsAt?: Rfc3339 | null; status: ProjectScheduleStatus;
  createdByUserId: Uuid; createdAt: Rfc3339; updatedAt: Rfc3339; canceledAt?: Rfc3339 | null; version: number;
}

const auth = { auth: "bearer" } as const;

// ── Project ──────────────────────────────────────────────────────
export const listProjects = (q: { status?: ProjectStatus; offset?: number; limit?: number; q?: string } = {}) =>
  request<OffsetPage<ProjectResponse>>({ method: "GET", path: "/api/projects", query: q, ...auth });
export const createProject = (b: { name: string; description?: string; externalAiPolicy?: ExternalAiPolicy }) =>
  request<ProjectResponse>({ method: "POST", path: "/api/projects", body: b, ...auth, idempotent: true });
export const getProject = (projectId: Uuid) =>
  request<ProjectResponse>({ method: "GET", path: `/api/projects/${projectId}`, ...auth });
export const updateProject = (projectId: Uuid, b: { name: string; description?: string; version: number }) =>
  request<ProjectResponse>({ method: "PUT", path: `/api/projects/${projectId}`, body: b, ...auth });
export const completeProject = (projectId: Uuid, version: number) =>
  request<ProjectCompletionResponse>({ method: "POST", path: `/api/projects/${projectId}/complete`, body: { version }, ...auth, idempotent: true });
export const reopenProject = (projectId: Uuid, version: number) =>
  request<ProjectResponse>({ method: "POST", path: `/api/projects/${projectId}/reopen`, body: { version }, ...auth, idempotent: true });
export const archiveProject = (projectId: Uuid, version: number) =>
  request<ProjectResponse>({ method: "POST", path: `/api/projects/${projectId}/archive`, body: { version }, ...auth, idempotent: true });
export const updateProjectAiPolicy = (projectId: Uuid, b: { externalAiPolicy: ExternalAiPolicy; version: number }) =>
  request<ProjectResponse>({ method: "PUT", path: `/api/projects/${projectId}/ai-policy`, body: b, ...auth });

// ── Members ──────────────────────────────────────────────────────
export const listProjectMembers = (projectId: Uuid, q: { status?: ProjectMembershipStatus; offset?: number; limit?: number } = {}) =>
  request<OffsetPage<ProjectMemberResponse>>({ method: "GET", path: `/api/projects/${projectId}/members`, query: q, ...auth });
export const addProjectMember = (projectId: Uuid, b: { userId: Uuid; role: ProjectRole }) =>
  request<ProjectMemberResponse>({ method: "POST", path: `/api/projects/${projectId}/members`, body: b, ...auth, idempotent: true });
export const updateProjectMemberRole = (projectId: Uuid, membershipId: Uuid, b: { role: ProjectRole; version: number }) =>
  request<ProjectMemberResponse>({ method: "PUT", path: `/api/projects/${projectId}/members/${membershipId}/role`, body: b, ...auth });
export const removeProjectMember = (projectId: Uuid, membershipId: Uuid) =>
  request<ProjectMemberResponse>({ method: "DELETE", path: `/api/projects/${projectId}/members/${membershipId}`, ...auth, idempotent: true });
export const restoreProjectMember = (projectId: Uuid, membershipId: Uuid, version: number) =>
  request<ProjectMemberResponse>({ method: "POST", path: `/api/projects/${projectId}/members/${membershipId}/restore`, body: { version }, ...auth, idempotent: true });

// ── Manager recovery (Admin, step-up) ───────────────────────────
export const listManagerRecoveryProjects = (q: { offset?: number; limit?: number } = {}) =>
  request<OffsetPage<ManagerRecoveryProjectSummary>>({ method: "GET", path: "/api/admin/projects/manager-recovery", query: q, ...auth });
export const recoverProjectManager = (projectId: Uuid, targetUserId: Uuid) =>
  request<ManagerRecoveryProjectSummary>({ method: "POST", path: `/api/admin/projects/${projectId}/manager-recovery`, body: { targetUserId }, ...auth, idempotent: true });

// ── Decisions ────────────────────────────────────────────────────
export const listDecisions = (projectId: Uuid, q: { status?: DecisionStatus; offset?: number; limit?: number } = {}) =>
  request<OffsetPage<DecisionResponse>>({ method: "GET", path: `/api/projects/${projectId}/decisions`, query: q, ...auth });
export const createDecision = (projectId: Uuid, b: { title: string; content: string }) =>
  request<DecisionResponse>({ method: "POST", path: `/api/projects/${projectId}/decisions`, body: b, ...auth, idempotent: true });
export const getDecision = (projectId: Uuid, decisionId: Uuid) =>
  request<DecisionResponse>({ method: "GET", path: `/api/projects/${projectId}/decisions/${decisionId}`, ...auth });
export const updateDecision = (projectId: Uuid, decisionId: Uuid, b: { title: string; content: string; version: number }) =>
  request<DecisionResponse>({ method: "PUT", path: `/api/projects/${projectId}/decisions/${decisionId}`, body: b, ...auth });
export const supersedeDecision = (projectId: Uuid, decisionId: Uuid, b: { title: string; content: string; sourceDecisionVersion: number }) =>
  request<DecisionSupersedeResponse>({ method: "POST", path: `/api/projects/${projectId}/decisions/${decisionId}/supersede`, body: b, ...auth, idempotent: true });

// ── Tasks ────────────────────────────────────────────────────────
export const listTasks = (projectId: Uuid, q: { status?: TaskStatus; assigneeUserId?: Uuid; dueAfter?: Rfc3339; dueBefore?: Rfc3339; offset?: number; limit?: number } = {}) =>
  request<OffsetPage<TaskResponse>>({ method: "GET", path: `/api/projects/${projectId}/tasks`, query: q, ...auth });
export const createTask = (projectId: Uuid, b: { title: string; description?: string; assigneeUserId?: Uuid | null; dueAt?: Rfc3339 | null }) =>
  request<TaskResponse>({ method: "POST", path: `/api/projects/${projectId}/tasks`, body: b, ...auth, idempotent: true });
export const getTask = (projectId: Uuid, taskId: Uuid) =>
  request<TaskResponse>({ method: "GET", path: `/api/projects/${projectId}/tasks/${taskId}`, ...auth });
export const updateTask = (projectId: Uuid, taskId: Uuid, b: { title: string; description?: string; version: number }) =>
  request<TaskResponse>({ method: "PUT", path: `/api/projects/${projectId}/tasks/${taskId}`, body: b, ...auth });
export const updateTaskStatus = (projectId: Uuid, taskId: Uuid, b: { status: TaskStatus; version: number }) =>
  request<TaskResponse>({ method: "PUT", path: `/api/projects/${projectId}/tasks/${taskId}/status`, body: b, ...auth });
export const updateTaskAssignee = (projectId: Uuid, taskId: Uuid, b: { assigneeUserId: Uuid; version: number }) =>
  request<TaskResponse>({ method: "PUT", path: `/api/projects/${projectId}/tasks/${taskId}/assignee`, body: b, ...auth });
export const unassignTask = (projectId: Uuid, taskId: Uuid) =>
  request<TaskResponse>({ method: "DELETE", path: `/api/projects/${projectId}/tasks/${taskId}/assignee`, ...auth });
export const updateTaskDeadline = (projectId: Uuid, taskId: Uuid, b: { dueAt: Rfc3339 | null; version: number }) =>
  request<TaskResponse>({ method: "PUT", path: `/api/projects/${projectId}/tasks/${taskId}/deadline`, body: b, ...auth });
export const cancelTask = (projectId: Uuid, taskId: Uuid, version: number) =>
  request<TaskResponse>({ method: "POST", path: `/api/projects/${projectId}/tasks/${taskId}/cancel`, body: { version }, ...auth, idempotent: true });

// ── Schedule ─────────────────────────────────────────────────────
export const listSchedule = (projectId: Uuid, q: { status?: ProjectScheduleStatus; type?: ProjectScheduleType; startsAfter?: Rfc3339; startsBefore?: Rfc3339; offset?: number; limit?: number } = {}) =>
  request<OffsetPage<ProjectScheduleItemResponse>>({ method: "GET", path: `/api/projects/${projectId}/schedule`, query: q, ...auth });
export const createScheduleItem = (projectId: Uuid, b: { type: ProjectScheduleType; title: string; description?: string; startsAt: Rfc3339; endsAt?: Rfc3339 | null }) =>
  request<ProjectScheduleItemResponse>({ method: "POST", path: `/api/projects/${projectId}/schedule`, body: b, ...auth, idempotent: true });
export const getScheduleItem = (projectId: Uuid, scheduleItemId: Uuid) =>
  request<ProjectScheduleItemResponse>({ method: "GET", path: `/api/projects/${projectId}/schedule/${scheduleItemId}`, ...auth });
export const updateScheduleItem = (projectId: Uuid, scheduleItemId: Uuid, b: { type: ProjectScheduleType; title: string; description?: string; startsAt: Rfc3339; endsAt?: Rfc3339 | null; version: number }) =>
  request<ProjectScheduleItemResponse>({ method: "PUT", path: `/api/projects/${projectId}/schedule/${scheduleItemId}`, body: b, ...auth });
export const cancelScheduleItem = (projectId: Uuid, scheduleItemId: Uuid, version: number) =>
  request<ProjectScheduleItemResponse>({ method: "POST", path: `/api/projects/${projectId}/schedule/${scheduleItemId}/cancel`, body: { version }, ...auth, idempotent: true });
