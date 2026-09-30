// Anok_02_Project_Work_Schedule_API_Event_Spec_v2_3_1_FINAL 기준 인메모리 mock.
// mock.ts가 /api/projects, /api/admin/projects 경로를 이 파일의 routeProject()로 위임한다.
import type { RequestOptions } from "./http";
import { byId, check, fail, id, invalid, offsetPage, str, versioned } from "./mockCore";
import type { MockUser } from "./mockCore";
import { emit } from "./mockNotification";
import type {
  DecisionResponse, DecisionSourceType, DecisionStatus, ExternalAiPolicy, ManagerRecoveryProjectSummary,
  ProjectMemberResponse, ProjectMembershipStatus, ProjectResponse, ProjectRole, ProjectScheduleItemResponse,
  ProjectScheduleStatus, ProjectScheduleType, ProjectStatus, TaskResponse, TaskSourceType, TaskStatus,
} from "./project";
import type { FieldError } from "./types";

interface Project {
  projectId: string; name: string; description: string | null; status: ProjectStatus; externalAiPolicy: ExternalAiPolicy;
  createdByUserId: string; createdAt: string; updatedAt: string; completedAt: string | null; archivedAt: string | null; version: number;
}
interface Membership {
  membershipId: string; projectId: string; userId: string; role: ProjectRole; status: ProjectMembershipStatus;
  joinedAt: string; suspendedAt: string | null; restoredAt: string | null; removedAt: string | null; version: number;
}
interface Decision {
  decisionId: string; projectId: string; title: string; content: string; status: DecisionStatus; sourceType: DecisionSourceType;
  sourceMeetingId: string | null; sourceCandidateId: string | null; createdByUserId: string; confirmedAt: string;
  supersededById: string | null; createdAt: string; updatedAt: string; version: number;
}
interface Task {
  taskId: string; projectId: string; title: string; description: string | null; status: TaskStatus;
  assigneeUserId: string | null; dueAt: string | null; sourceType: TaskSourceType;
  sourceMeetingId: string | null; sourceCandidateId: string | null; sourceDecisionId: string | null;
  createdByUserId: string; createdAt: string; updatedAt: string;
  startedAt: string | null; completedAt: string | null; canceledAt: string | null; version: number;
}
interface ScheduleItem {
  scheduleItemId: string; projectId: string; type: ProjectScheduleType; title: string; description: string | null;
  startsAt: string | null; endsAt: string | null; status: ProjectScheduleStatus;
  createdByUserId: string; createdAt: string; updatedAt: string; canceledAt: string | null; version: number;
}

const now = () => new Date().toISOString();
const U = { wonjae: id(1, 1), gyuchan: id(1, 2), insung: id(1, 3), minjun: id(1, 4), dayoung: id(1, 5), seoyeon: id(1, 6), seungwoo: id(1, 7), jihyun: id(1, 8), taeyang: id(1, 9) };

const projects: Project[] = [
  { projectId: id(5, 1), name: "인증 시스템 개편", description: "기존 세션 기반 인증을 OAuth 2.0으로 전환합니다.", status: "ACTIVE", externalAiPolicy: "INHERIT", createdByUserId: U.gyuchan, createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z", completedAt: null, archivedAt: null, version: 1 },
  { projectId: id(5, 2), name: "AI 회의록 파이프라인", description: "회의 녹음 → STT → AI 분석 → 회의록 초안 자동 생성 파이프라인 구축", status: "ACTIVE", externalAiPolicy: "INHERIT", createdByUserId: U.wonjae, createdAt: "2026-09-08T00:00:00Z", updatedAt: "2026-09-08T00:00:00Z", completedAt: null, archivedAt: null, version: 1 },
  { projectId: id(5, 3), name: "대시보드 리뉴얼", description: "사용자 대시보드 전면 개편 및 다크모드 지원", status: "ACTIVE", externalAiPolicy: "INHERIT", createdByUserId: U.jihyun, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", completedAt: null, archivedAt: null, version: 1 },
  { projectId: id(5, 4), name: "알림 시스템 고도화", description: "실시간 알림 시스템 구축", status: "ACTIVE", externalAiPolicy: "INHERIT", createdByUserId: U.gyuchan, createdAt: "2026-09-10T00:00:00Z", updatedAt: "2026-09-10T00:00:00Z", completedAt: null, archivedAt: null, version: 1 },
];

let membershipSeq = 0;
const mkMembership = (projectId: string, userId: string, role: ProjectRole): Membership =>
  ({ membershipId: id(6, ++membershipSeq), projectId, userId, role, status: "ACTIVE", joinedAt: now(), suspendedAt: null, restoredAt: null, removedAt: null, version: 1 });
const memberships: Membership[] = [
  mkMembership(projects[0].projectId, U.gyuchan, "MANAGER"),
  mkMembership(projects[0].projectId, U.wonjae, "MEMBER"),
  mkMembership(projects[0].projectId, U.seoyeon, "MEMBER"),
  mkMembership(projects[0].projectId, U.taeyang, "VIEWER"),
  mkMembership(projects[1].projectId, U.wonjae, "MANAGER"),
  mkMembership(projects[1].projectId, U.gyuchan, "MEMBER"),
  mkMembership(projects[1].projectId, U.minjun, "MEMBER"),
  mkMembership(projects[1].projectId, U.dayoung, "MEMBER"),
  mkMembership(projects[1].projectId, U.seungwoo, "MEMBER"),
  mkMembership(projects[2].projectId, U.jihyun, "MANAGER"),
  mkMembership(projects[2].projectId, U.wonjae, "VIEWER"),
  mkMembership(projects[2].projectId, U.taeyang, "MEMBER"),
  mkMembership(projects[3].projectId, U.gyuchan, "MANAGER"),
  mkMembership(projects[3].projectId, U.seoyeon, "MEMBER"),
];

let decisionSeq = 0;
const mkDecision = (projectId: string, title: string, content: string, createdByUserId: string): Decision =>
  ({ decisionId: id(7, ++decisionSeq), projectId, title, content, status: "ACTIVE", sourceType: "MANUAL", sourceMeetingId: null, sourceCandidateId: null, createdByUserId, confirmedAt: now(), supersededById: null, createdAt: now(), updatedAt: now(), version: 1 });
const decisions: Decision[] = [
  mkDecision(projects[0].projectId, "인증 방식으로 OAuth 2.0 도입", "보안성과 확장성 면에서 세션 기반 인증 대비 우위", U.gyuchan),
  mkDecision(projects[1].projectId, "임베딩 모델 선정", "MVP 단계에서 OpenAI text-embedding-3-small을 사용한다. 이후 비용 검토 예정", U.wonjae),
  mkDecision(projects[1].projectId, "RAG 파이프라인 기술 스택", "Python FastAPI 기반으로 구현한다 — AI 라이브러리 생태계 호환성", U.wonjae),
];

let taskSeq = 0;
const mkTask = (projectId: string, title: string, assigneeUserId: string | null, dueAt: string | null, status: TaskStatus, createdByUserId: string): Task => ({
  taskId: id(8, ++taskSeq), projectId, title, description: null, status, assigneeUserId, dueAt,
  sourceType: "MANUAL", sourceMeetingId: null, sourceCandidateId: null, sourceDecisionId: null, createdByUserId,
  createdAt: now(), updatedAt: now(), startedAt: status !== "TODO" ? now() : null, completedAt: null, canceledAt: null, version: 1,
});
const tasks: Task[] = [
  mkTask(projects[0].projectId, "OAuth 2.0 Provider 연동 API 개발", U.wonjae, "2026-09-25T00:00:00Z", "IN_PROGRESS", U.gyuchan),
  mkTask(projects[0].projectId, "소셜 로그인 UI 컴포넌트 수정", U.wonjae, "2026-09-28T00:00:00Z", "TODO", U.gyuchan),
  mkTask(projects[0].projectId, "JWT Refresh Token 로직 구현", U.gyuchan, "2026-09-30T00:00:00Z", "IN_PROGRESS", U.gyuchan),
  mkTask(projects[1].projectId, "RAG 파이프라인 초기 구현", U.dayoung, "2026-10-15T00:00:00Z", "IN_PROGRESS", U.wonjae),
  mkTask(projects[1].projectId, "LLM 추출 프롬프트 설계", U.dayoung, "2026-10-01T00:00:00Z", "TODO", U.wonjae),
  mkTask(projects[1].projectId, "회의록 파싱 모듈 개발", U.wonjae, "2026-10-10T00:00:00Z", "TODO", U.wonjae),
  mkTask(projects[2].projectId, "대시보드 메인 레이아웃 리디자인", U.jihyun, "2026-10-08T00:00:00Z", "TODO", U.jihyun),
  mkTask(projects[3].projectId, "알림 설정 API 연동", U.gyuchan, "2026-09-27T00:00:00Z", "IN_PROGRESS", U.gyuchan),
];

let scheduleSeq = 0;
const mkSchedule = (projectId: string, type: ProjectScheduleType, title: string, startsAt: string, createdByUserId: string): ScheduleItem =>
  ({ scheduleItemId: id(9, ++scheduleSeq), projectId, type, title, description: null, startsAt, endsAt: null, status: "ACTIVE", createdByUserId, createdAt: now(), updatedAt: now(), canceledAt: null, version: 1 });
const scheduleItems: ScheduleItem[] = [
  mkSchedule(projects[0].projectId, "MILESTONE", "OAuth 전환 1차 배포", "2026-10-31T00:00:00Z", U.gyuchan),
  mkSchedule(projects[1].projectId, "MILESTONE", "파이프라인 MVP 완료", "2026-11-30T00:00:00Z", U.wonjae),
];

const TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  TODO: ["IN_PROGRESS", "CANCELED"],
  IN_PROGRESS: ["TODO", "DONE", "CANCELED"],
  DONE: ["IN_PROGRESS"],
  CANCELED: ["TODO"],
};
const MEMBER_TASK_TRANSITIONS: Record<string, boolean> = { "TODO>IN_PROGRESS": true, "IN_PROGRESS>TODO": true, "IN_PROGRESS>DONE": true };

function project(projectId: string): Project { const p = projects.find(x => x.projectId === projectId); if (!p) return fail(404, "PROJECT_NOT_FOUND"); return p; }

// Document mock(project attachment inherited VIEWER)이 참조하는 최소 조회 API. 실 서비스라면 Document→Project internal capability 호출에 해당한다.
export function projectExists(projectId: string): boolean { return projects.some(p => p.projectId === projectId); }
export function isEffectiveProjectMember(projectId: string, userId: string): boolean { return !!effectiveMembership(projectId, userId); }
export function effectiveProjectRole(projectId: string, userId: string): ProjectRole | undefined { return effectiveMembership(projectId, userId)?.role; }
export const SEED_PROJECT_IDS = { authRevamp: projects[0].projectId, aiPipeline: projects[1].projectId, dashboard: projects[2].projectId, notifications: projects[3].projectId };

// AI(06) Permission-aware RAG용 최소 조회 — 실제로는 AI Service의 PROJECT_STRUCTURED_CONTEXT internal capability 호출에 해당한다.
export function getProjectContextForAi(projectId: string, userId: string): { name: string; description: string | null; accessible: boolean; decisions: { title: string; content: string }[]; taskSummary: { total: number; done: number; inProgress: number } } | undefined {
  const p = projects.find(x => x.projectId === projectId);
  if (!p) return undefined;
  const projDecisions = decisions.filter(d => d.projectId === projectId && d.status === "ACTIVE").slice(0, 5).map(d => ({ title: d.title, content: d.content }));
  const projTasks = tasks.filter(t => t.projectId === projectId);
  return {
    name: p.name, description: p.description, accessible: isEffectiveProjectMember(projectId, userId), decisions: projDecisions,
    taskSummary: { total: projTasks.length, done: projTasks.filter(t => t.status === "DONE").length, inProgress: projTasks.filter(t => t.status === "IN_PROGRESS").length },
  };
}

// Meeting(04) 회의록 후보 확정(materialize) 연동 — 실제로는 Meeting Service가 Project Service의 내부 capability를 호출하는 경계.
export function isProjectActive(projectId: string): boolean { const p = projects.find(x => x.projectId === projectId); return !!p && p.status === "ACTIVE"; }
export function isTaskAssigneeEligible(projectId: string, userId: string): boolean { const role = effectiveProjectRole(projectId, userId); return role === "MANAGER" || role === "MEMBER"; }
export function materializeCandidateAsTask(projectId: string, b: { title: string; description: string | null; assigneeUserId: string | null; dueAt: string | null; sourceMeetingId: string; sourceCandidateId: string }, createdByUserId: string): string {
  const t: Task = {
    taskId: id(8, ++taskSeq), projectId, title: b.title, description: b.description, status: "TODO", assigneeUserId: b.assigneeUserId, dueAt: b.dueAt,
    sourceType: "MEETING_CANDIDATE", sourceMeetingId: b.sourceMeetingId, sourceCandidateId: b.sourceCandidateId, sourceDecisionId: null,
    createdByUserId, createdAt: now(), updatedAt: now(), startedAt: null, completedAt: null, canceledAt: null, version: 1,
  };
  tasks.push(t);
  return t.taskId;
}
export function materializeCandidateAsDecision(projectId: string, b: { title: string; content: string; sourceMeetingId: string; sourceCandidateId: string }, createdByUserId: string): string {
  const d: Decision = {
    decisionId: id(7, ++decisionSeq), projectId, title: b.title, content: b.content, status: "ACTIVE", sourceType: "MEETING_CANDIDATE",
    sourceMeetingId: b.sourceMeetingId, sourceCandidateId: b.sourceCandidateId, createdByUserId, confirmedAt: now(), supersededById: null,
    createdAt: now(), updatedAt: now(), version: 1,
  };
  decisions.push(d);
  return d.decisionId;
}
function activeManagerCount(projectId: string) { return memberships.filter(m => m.projectId === projectId && m.role === "MANAGER" && m.status === "ACTIVE").length; }
function effectiveMembership(projectId: string, userId: string): Membership | undefined {
  const m = memberships.find(x => x.projectId === projectId && x.userId === userId && x.status === "ACTIVE");
  if (!m) return undefined;
  const identity = byId(userId);
  return identity && identity.status === "ACTIVE" ? m : undefined;
}
function requireMember(p: Project, me: MockUser): Membership {
  const m = effectiveMembership(p.projectId, me.userId);
  if (!m) return fail(403, "PROJECT_MEMBER_REQUIRED");
  return m;
}
function requireManager(p: Project, me: MockUser): Membership {
  const m = requireMember(p, me);
  if (m.role !== "MANAGER") return fail(403, "PROJECT_MANAGER_REQUIRED");
  return m;
}
function toProjectResponse(p: Project, me: MockUser): ProjectResponse {
  const mine = effectiveMembership(p.projectId, me.userId);
  return {
    projectId: p.projectId, name: p.name, description: p.description, status: p.status, externalAiPolicy: p.externalAiPolicy,
    myRole: mine?.role ?? "VIEWER", managerRecoveryRequired: p.status !== "ARCHIVED" && activeManagerCount(p.projectId) === 0,
    createdByUserId: p.createdByUserId, createdAt: p.createdAt, updatedAt: p.updatedAt, completedAt: p.completedAt, archivedAt: p.archivedAt, version: p.version,
  };
}
function toMemberResponse(m: Membership): ProjectMemberResponse {
  const identity = byId(m.userId);
  return {
    membershipId: m.membershipId, projectId: m.projectId, userId: m.userId, role: m.role, status: m.status,
    joinedAt: m.joinedAt, suspendedAt: m.suspendedAt, restoredAt: m.restoredAt, removedAt: m.removedAt, version: m.version,
    identityAvailability: identity && identity.status === "ACTIVE" ? "AVAILABLE" : "UNAVAILABLE_MEMBER",
  };
}
function toDecisionResponse(d: Decision): DecisionResponse {
  return { decisionId: d.decisionId, projectId: d.projectId, title: d.title, content: d.content, status: d.status, sourceType: d.sourceType, sourceMeetingId: d.sourceMeetingId, sourceCandidateId: d.sourceCandidateId, createdByUserId: d.createdByUserId, confirmedAt: d.confirmedAt, supersededById: d.supersededById, createdAt: d.createdAt, updatedAt: d.updatedAt, version: d.version };
}
function toTaskResponse(t: Task): TaskResponse {
  const identity = t.assigneeUserId ? byId(t.assigneeUserId) : undefined;
  return {
    taskId: t.taskId, projectId: t.projectId, title: t.title, description: t.description, status: t.status,
    assigneeUserId: t.assigneeUserId, assigneeAvailability: !t.assigneeUserId || (identity && identity.status === "ACTIVE") ? "AVAILABLE" : "UNAVAILABLE_ASSIGNEE",
    dueAt: t.dueAt, sourceType: t.sourceType, sourceMeetingId: t.sourceMeetingId, sourceCandidateId: t.sourceCandidateId, sourceDecisionId: t.sourceDecisionId,
    createdByUserId: t.createdByUserId, createdAt: t.createdAt, updatedAt: t.updatedAt, startedAt: t.startedAt, completedAt: t.completedAt, canceledAt: t.canceledAt, version: t.version,
  };
}
function toScheduleResponse(s: ScheduleItem): ProjectScheduleItemResponse {
  return { scheduleItemId: s.scheduleItemId, projectId: s.projectId, type: s.type, title: s.title, description: s.description, startsAt: s.startsAt, endsAt: s.endsAt, status: s.status, createdByUserId: s.createdByUserId, createdAt: s.createdAt, updatedAt: s.updatedAt, canceledAt: s.canceledAt, version: s.version };
}

function assignEligible(projectId: string, userId: unknown): Membership {
  if (typeof userId !== "string" || !userId) return fail(404, "ASSIGNEE_NOT_FOUND");
  const m = effectiveMembership(projectId, userId);
  if (!m) return fail(404, "ASSIGNEE_NOT_FOUND");
  if (m.role === "VIEWER") return fail(409, "ASSIGNEE_NOT_ELIGIBLE");
  return m;
}

export function routeProject(o: RequestOptions, me: MockUser): unknown {
  const b: any = o.body ?? {};
  const path = o.path;
  const key = `${o.method} ${path}`;
  const q = o.query ?? {};

  // ── Project ──
  if (key === "GET /api/projects") {
    const rows = projects
      .filter(p => effectiveMembership(p.projectId, me.userId))
      .filter(p => !q.status || p.status === q.status)
      .filter(p => !q.q || p.name.toLowerCase().includes(String(q.q).toLowerCase()))
      .sort((a, b2) => b2.createdAt.localeCompare(a.createdAt));
    const page = offsetPage(rows, q);
    return { items: page.items.map(p => toProjectResponse(p, me)), page: page.page };
  }
  if (key === "POST /api/projects") {
    const e: FieldError[] = [];
    const name = str(e, b, "name", 1, 200);
    const description = str(e, b, "description", 0, 2000, false);
    if (b.externalAiPolicy && !["INHERIT", "ALLOWED", "BLOCKED"].includes(b.externalAiPolicy)) e.push({ field: "externalAiPolicy", reason: "INVALID_ENUM" });
    check(e);
    const p: Project = { projectId: crypto.randomUUID(), name: name!, description: description ?? null, status: "ACTIVE", externalAiPolicy: b.externalAiPolicy ?? "INHERIT", createdByUserId: me.userId, createdAt: now(), updatedAt: now(), completedAt: null, archivedAt: null, version: 1 };
    projects.push(p);
    memberships.push(mkMembership(p.projectId, me.userId, "MANAGER"));
    return toProjectResponse(p, me);
  }

  let m = /^\/api\/projects\/([^/]+)$/.exec(path);
  if (m) {
    const p = project(m[1]);
    if (o.method === "GET") { requireMember(p, me); return toProjectResponse(p, me); }
    requireManager(p, me);
    if (p.status === "ARCHIVED") return fail(409, "PROJECT_ARCHIVED");
    const e: FieldError[] = []; const name = str(e, b, "name", 1, 200); const description = str(e, b, "description", 0, 2000, false); check(e);
    const row = versioned(p, b, "PROJECT_NOT_FOUND");
    Object.assign(row, { name, description: description ?? null, version: row.version + 1, updatedAt: now() });
    return toProjectResponse(row, me);
  }

  m = /^\/api\/projects\/([^/]+)\/(complete|reopen|archive)$/.exec(path);
  if (m) {
    const p = project(m[1]);
    requireManager(p, me);
    const row = versioned(p, b, "PROJECT_NOT_FOUND");
    if (m[2] === "complete") {
      if (row.status !== "ACTIVE") return fail(409, "PROJECT_NOT_ACTIVE");
      row.status = "COMPLETED"; row.completedAt = now(); row.version++; row.updatedAt = now();
      const incompleteTaskCount = tasks.filter(t => t.projectId === row.projectId && (t.status === "TODO" || t.status === "IN_PROGRESS")).length;
      return { project: toProjectResponse(row, me), incompleteTaskCount };
    }
    if (m[2] === "reopen") {
      if (row.status !== "COMPLETED") return fail(409, "PROJECT_NOT_COMPLETED");
      if (activeManagerCount(row.projectId) === 0) return fail(409, "MANAGER_RECOVERY_REQUIRED");
      row.status = "ACTIVE"; row.completedAt = null; row.version++; row.updatedAt = now();
      return toProjectResponse(row, me);
    }
    if (row.status === "ARCHIVED") return fail(409, "PROJECT_ALREADY_ARCHIVED");
    row.status = "ARCHIVED"; row.archivedAt = now(); row.version++; row.updatedAt = now();
    return toProjectResponse(row, me);
  }

  m = /^\/api\/projects\/([^/]+)\/ai-policy$/.exec(path);
  if (m) {
    const p = project(m[1]);
    requireManager(p, me);
    if (p.status === "ARCHIVED") return fail(409, "PROJECT_ARCHIVED");
    if (!["INHERIT", "ALLOWED", "BLOCKED"].includes(b.externalAiPolicy)) invalid({ field: "externalAiPolicy", reason: "INVALID_ENUM" });
    const row = versioned(p, b, "PROJECT_NOT_FOUND");
    row.externalAiPolicy = b.externalAiPolicy; row.version++; row.updatedAt = now();
    return toProjectResponse(row, me);
  }

  // ── Members ──
  m = /^\/api\/projects\/([^/]+)\/members$/.exec(path);
  if (m) {
    const p = project(m[1]);
    if (o.method === "GET") {
      requireMember(p, me);
      const rows = memberships.filter(x => x.projectId === p.projectId && (!q.status || x.status === q.status));
      const page = offsetPage(rows, q);
      return { items: page.items.map(toMemberResponse), page: page.page };
    }
    requireManager(p, me);
    if (p.status !== "ACTIVE") return fail(409, "PROJECT_NOT_ACTIVE");
    const e: FieldError[] = [];
    if (typeof b.userId !== "string" || !b.userId) e.push({ field: "userId", reason: "REQUIRED" });
    if (!["MANAGER", "MEMBER", "VIEWER"].includes(b.role)) e.push({ field: "role", reason: "INVALID_ENUM" });
    check(e);
    if (!byId(b.userId)) return fail(404, "TARGET_USER_NOT_FOUND");
    if (memberships.some(x => x.projectId === p.projectId && x.userId === b.userId && x.status !== "REMOVED")) return fail(409, "PROJECT_MEMBER_ALREADY_EXISTS");
    const row = mkMembership(p.projectId, b.userId, b.role);
    memberships.push(row);
    emit(b.userId, "PROJECT_MEMBER_ADDED", "PROJECT", p.projectId, { actorUserId: me.userId });
    return toMemberResponse(row);
  }

  m = /^\/api\/projects\/([^/]+)\/members\/([^/]+)\/role$/.exec(path);
  if (m) {
    const p = project(m[1]);
    requireManager(p, me);
    if (p.status === "ARCHIVED") return fail(409, "PROJECT_STATE_CONFLICT");
    if (!["MANAGER", "MEMBER", "VIEWER"].includes(b.role)) invalid({ field: "role", reason: "INVALID_ENUM" });
    const target = memberships.find(x => x.membershipId === m![2] && x.projectId === p.projectId);
    const row = versioned(target, b, "PROJECT_MEMBERSHIP_NOT_FOUND");
    if (row.status !== "ACTIVE") return fail(409, "MEMBERSHIP_NOT_ACTIVE");
    if (row.role === "MANAGER" && b.role !== "MANAGER" && activeManagerCount(p.projectId) <= 1) return fail(409, "LAST_ACTIVE_MANAGER");
    row.role = b.role; row.version++;
    return toMemberResponse(row);
  }

  m = /^\/api\/projects\/([^/]+)\/members\/([^/]+)$/.exec(path);
  if (m && o.method === "DELETE") {
    const p = project(m[1]);
    requireManager(p, me);
    if (p.status === "ARCHIVED") return fail(409, "PROJECT_STATE_CONFLICT");
    const row = memberships.find(x => x.membershipId === m![2] && x.projectId === p.projectId);
    if (!row) return fail(404, "PROJECT_MEMBERSHIP_NOT_FOUND");
    if (row.status === "REMOVED") return fail(409, "MEMBERSHIP_ALREADY_REMOVED");
    if (row.role === "MANAGER" && activeManagerCount(p.projectId) <= 1) return fail(409, "LAST_ACTIVE_MANAGER");
    row.status = "REMOVED"; row.removedAt = now(); row.version++;
    return undefined;
  }

  m = /^\/api\/projects\/([^/]+)\/members\/([^/]+)\/restore$/.exec(path);
  if (m) {
    const p = project(m[1]);
    requireManager(p, me);
    if (p.status !== "ACTIVE") return fail(409, "PROJECT_NOT_ACTIVE");
    const target = memberships.find(x => x.membershipId === m![2] && x.projectId === p.projectId);
    const row = versioned(target, b, "PROJECT_MEMBERSHIP_NOT_FOUND");
    if (row.status !== "SUSPENDED_BY_IDENTITY") return fail(409, "MEMBERSHIP_NOT_SUSPENDED");
    const identity = byId(row.userId);
    if (!identity || identity.status !== "ACTIVE") return fail(409, "TARGET_USER_INACTIVE");
    row.status = "ACTIVE"; row.restoredAt = now(); row.version++;
    return toMemberResponse(row);
  }

  // ── Manager recovery (Admin, step-up — 게이트는 mock.ts가 "AUTH_BEARER_ADMIN_STEP_UP" 경로에서 이미 통과시켜 호출한다) ──
  if (key === "GET /api/admin/projects/manager-recovery") {
    const rows: ManagerRecoveryProjectSummary[] = projects
      .filter(p => !q.status || p.status === q.status)
      .filter(p => activeManagerCount(p.projectId) === 0)
      .map(p => ({ projectId: p.projectId, name: p.name, status: p.status, activeManagerCount: 0, recoveryRequiredSince: p.updatedAt }));
    return offsetPage(rows, q);
  }
  m = /^\/api\/admin\/projects\/([^/]+)\/manager-recovery$/.exec(path);
  if (m) {
    const p = project(m[1]);
    if (p.status === "ARCHIVED") return fail(409, "PROJECT_ARCHIVED");
    if (activeManagerCount(p.projectId) > 0) return fail(409, "MANAGER_RECOVERY_NOT_REQUIRED");
    if (typeof b.targetUserId !== "string" || !b.targetUserId) invalid({ field: "targetUserId", reason: "REQUIRED" });
    const identity = byId(b.targetUserId);
    if (!identity) return fail(404, "TARGET_USER_NOT_FOUND");
    if (identity.status !== "ACTIVE") return fail(409, "TARGET_MEMBERSHIP_CONFLICT");
    let row = memberships.find(x => x.projectId === p.projectId && x.userId === b.targetUserId && x.status !== "REMOVED");
    if (row) {
      if (row.status === "SUSPENDED_BY_IDENTITY" && row.role === "MANAGER") { row.status = "ACTIVE"; row.restoredAt = now(); row.version++; }
      else if (row.status === "ACTIVE") { row.role = "MANAGER"; row.version++; }
      else return fail(409, "TARGET_MEMBERSHIP_CONFLICT");
    } else {
      row = mkMembership(p.projectId, b.targetUserId, "MANAGER");
      memberships.push(row);
    }
    return toMemberResponse(row);
  }

  // ── Decisions ──
  m = /^\/api\/projects\/([^/]+)\/decisions$/.exec(path);
  if (m) {
    const p = project(m[1]);
    if (o.method === "GET") {
      requireMember(p, me);
      const rows = decisions.filter(d => d.projectId === p.projectId && (!q.status || d.status === q.status)).sort((a, b2) => b2.createdAt.localeCompare(a.createdAt));
      const page = offsetPage(rows, q);
      return { items: page.items.map(toDecisionResponse), page: page.page };
    }
    requireManager(p, me);
    if (p.status !== "ACTIVE") return fail(409, "PROJECT_NOT_ACTIVE");
    const e: FieldError[] = []; const title = str(e, b, "title", 1, 200); const content = str(e, b, "content", 1, 4000); check(e);
    const row = mkDecision(p.projectId, title!, content!, me.userId);
    decisions.push(row);
    return toDecisionResponse(row);
  }
  m = /^\/api\/projects\/([^/]+)\/decisions\/([^/]+)$/.exec(path);
  if (m) {
    const p = project(m[1]);
    const target = decisions.find(x => x.decisionId === m![2] && x.projectId === p.projectId);
    if (o.method === "GET") { requireMember(p, me); if (!target) return fail(404, "DECISION_NOT_FOUND"); return toDecisionResponse(target); }
    requireManager(p, me);
    const e: FieldError[] = []; const title = str(e, b, "title", 1, 200); const content = str(e, b, "content", 1, 4000); check(e);
    const row = versioned(target, b, "DECISION_NOT_FOUND");
    if (row.status !== "ACTIVE") return fail(409, "DECISION_SUPERSEDED");
    Object.assign(row, { title, content, version: row.version + 1, updatedAt: now() });
    return toDecisionResponse(row);
  }
  m = /^\/api\/projects\/([^/]+)\/decisions\/([^/]+)\/supersede$/.exec(path);
  if (m) {
    const p = project(m[1]);
    requireManager(p, me);
    if (p.status !== "ACTIVE") return fail(409, "PROJECT_NOT_ACTIVE");
    const target = decisions.find(x => x.decisionId === m![2] && x.projectId === p.projectId);
    if (!target) return fail(404, "DECISION_NOT_FOUND");
    const e: FieldError[] = []; const title = str(e, b, "title", 1, 200); const content = str(e, b, "content", 1, 4000);
    if (typeof b.sourceDecisionVersion !== "number") e.push({ field: "sourceDecisionVersion", reason: "REQUIRED" });
    check(e);
    if (target.status !== "ACTIVE") return fail(409, "DECISION_ALREADY_SUPERSEDED");
    if (target.version !== b.sourceDecisionVersion) return fail(409, "VERSION_CONFLICT");
    const next = mkDecision(p.projectId, title!, content!, me.userId);
    decisions.push(next);
    target.status = "SUPERSEDED"; target.supersededById = next.decisionId; target.version++; target.updatedAt = now();
    return { previous: toDecisionResponse(target), current: toDecisionResponse(next) };
  }

  // ── Tasks ──
  m = /^\/api\/projects\/([^/]+)\/tasks$/.exec(path);
  if (m) {
    const p = project(m[1]);
    if (o.method === "GET") {
      const membership = requireMember(p, me);
      if (q.assigneeUserId && membership.role !== "MANAGER") return fail(403, "TASK_FILTER_FORBIDDEN");
      let rows = tasks.filter(t => t.projectId === p.projectId);
      if (q.status) rows = rows.filter(t => t.status === q.status);
      if (q.assignee === "me") rows = rows.filter(t => t.assigneeUserId === me.userId);
      else if (q.assignee === "unassigned") rows = rows.filter(t => !t.assigneeUserId);
      else if (q.assigneeUserId) rows = rows.filter(t => t.assigneeUserId === q.assigneeUserId);
      if (q.dueFrom) rows = rows.filter(t => t.dueAt && t.dueAt >= String(q.dueFrom));
      if (q.dueTo) rows = rows.filter(t => t.dueAt && t.dueAt <= String(q.dueTo));
      rows = rows.sort((a, b2) => b2.createdAt.localeCompare(a.createdAt));
      const page = offsetPage(rows, q);
      return { items: page.items.map(toTaskResponse), page: page.page };
    }
    const membership = requireMember(p, me);
    if (membership.role === "VIEWER") return fail(403, "PROJECT_WRITE_FORBIDDEN");
    if (p.status !== "ACTIVE") return fail(409, "PROJECT_NOT_ACTIVE");
    const e: FieldError[] = []; const title = str(e, b, "title", 1, 200); const description = str(e, b, "description", 0, 4000, false); check(e);
    if (b.assigneeUserId != null) assignEligible(p.projectId, b.assigneeUserId);
    const row = mkTask(p.projectId, title!, b.assigneeUserId ?? null, b.dueAt ?? null, "TODO", me.userId);
    row.description = description ?? null;
    tasks.push(row);
    if (row.assigneeUserId) emit(row.assigneeUserId, "TASK_ASSIGNED", "TASK", row.taskId, { secondaryResourceType: "PROJECT", secondaryResourceId: p.projectId, actorUserId: me.userId });
    return toTaskResponse(row);
  }
  function findTask(p: Project, taskId: string): Task { const t = tasks.find(x => x.taskId === taskId && x.projectId === p.projectId); if (!t) return fail(404, "TASK_NOT_FOUND"); return t; }

  m = /^\/api\/projects\/([^/]+)\/tasks\/([^/]+)$/.exec(path);
  if (m) {
    const p = project(m[1]);
    if (o.method === "GET") { requireMember(p, me); return toTaskResponse(findTask(p, m[2])); }
    const membership = requireMember(p, me);
    const target = findTask(p, m[2]);
    if (membership.role === "VIEWER" || (membership.role === "MEMBER" && target.assigneeUserId !== me.userId)) return fail(403, "TASK_UPDATE_FORBIDDEN");
    if (p.status !== "ACTIVE") return fail(409, "PROJECT_NOT_ACTIVE");
    const e: FieldError[] = []; const title = str(e, b, "title", 1, 200); const description = str(e, b, "description", 0, 4000, false); check(e);
    const row = versioned(target, b, "TASK_NOT_FOUND");
    Object.assign(row, { title, description: description ?? null, version: row.version + 1, updatedAt: now() });
    return toTaskResponse(row);
  }

  m = /^\/api\/projects\/([^/]+)\/tasks\/([^/]+)\/status$/.exec(path);
  if (m) {
    const p = project(m[1]);
    const membership = requireMember(p, me);
    const target = findTask(p, m[2]);
    const to = b.status as TaskStatus;
    if (!["TODO", "IN_PROGRESS", "DONE", "CANCELED"].includes(to)) invalid({ field: "status", reason: "INVALID_ENUM" });
    const isAssignee = target.assigneeUserId === me.userId;
    if (membership.role === "VIEWER") return fail(403, "TASK_STATUS_CHANGE_FORBIDDEN");
    if (membership.role === "MEMBER" && (!isAssignee || !MEMBER_TASK_TRANSITIONS[`${target.status}>${to}`])) return fail(403, "TASK_STATUS_CHANGE_FORBIDDEN");
    if (p.status !== "ACTIVE") return fail(409, "PROJECT_NOT_ACTIVE");
    const row = versioned(target, b, "TASK_NOT_FOUND");
    if (!TASK_TRANSITIONS[row.status].includes(to)) return fail(409, "INVALID_TASK_TRANSITION");
    if (to === "IN_PROGRESS" && !row.assigneeUserId) return fail(409, "ASSIGNEE_REQUIRED");
    row.status = to; row.version++; row.updatedAt = now();
    if (to === "IN_PROGRESS" && !row.startedAt) row.startedAt = now();
    if (to === "DONE") row.completedAt = now(); else if (row.status !== "DONE") row.completedAt = null;
    if (to === "CANCELED") row.canceledAt = now(); else row.canceledAt = null;
    return toTaskResponse(row);
  }

  m = /^\/api\/projects\/([^/]+)\/tasks\/([^/]+)\/assignee$/.exec(path);
  if (m) {
    const p = project(m[1]);
    requireManager(p, me);
    const target = findTask(p, m[2]);
    if (o.method === "DELETE") {
      if (p.status !== "ACTIVE") return fail(409, "PROJECT_NOT_ACTIVE");
      if (!target.assigneeUserId) return fail(409, "TASK_ALREADY_UNASSIGNED");
      const prevAssignee = target.assigneeUserId;
      target.assigneeUserId = null; target.version++; target.updatedAt = now();
      emit(prevAssignee, "TASK_UNASSIGNED", "TASK", target.taskId, { secondaryResourceType: "PROJECT", secondaryResourceId: p.projectId, actorUserId: me.userId });
      return toTaskResponse(target);
    }
    if (p.status !== "ACTIVE") return fail(409, "PROJECT_NOT_ACTIVE");
    assignEligible(p.projectId, b.assigneeUserId);
    const prevAssignee = target.assigneeUserId;
    const row = versioned(target, b, "TASK_NOT_FOUND");
    row.assigneeUserId = b.assigneeUserId; row.version++; row.updatedAt = now();
    if (prevAssignee && prevAssignee !== row.assigneeUserId) emit(prevAssignee, "TASK_UNASSIGNED", "TASK", row.taskId, { secondaryResourceType: "PROJECT", secondaryResourceId: p.projectId, actorUserId: me.userId });
    if (row.assigneeUserId && row.assigneeUserId !== prevAssignee) emit(row.assigneeUserId, "TASK_ASSIGNED", "TASK", row.taskId, { secondaryResourceType: "PROJECT", secondaryResourceId: p.projectId, actorUserId: me.userId });
    return toTaskResponse(row);
  }

  m = /^\/api\/projects\/([^/]+)\/tasks\/([^/]+)\/deadline$/.exec(path);
  if (m) {
    const p = project(m[1]);
    requireManager(p, me);
    const target = findTask(p, m[2]);
    if (p.status !== "ACTIVE") return fail(409, "PROJECT_NOT_ACTIVE");
    const row = versioned(target, b, "TASK_NOT_FOUND");
    row.dueAt = b.dueAt ?? null; row.version++; row.updatedAt = now();
    return toTaskResponse(row);
  }

  m = /^\/api\/projects\/([^/]+)\/tasks\/([^/]+)\/cancel$/.exec(path);
  if (m) {
    const p = project(m[1]);
    requireManager(p, me);
    const target = findTask(p, m[2]);
    if (p.status !== "ACTIVE") return fail(409, "PROJECT_NOT_ACTIVE");
    const row = versioned(target, b, "TASK_NOT_FOUND");
    if (!TASK_TRANSITIONS[row.status].includes("CANCELED") && row.status !== "TODO" && row.status !== "IN_PROGRESS") return fail(409, "INVALID_TASK_TRANSITION");
    row.status = "CANCELED"; row.canceledAt = now(); row.version++; row.updatedAt = now();
    return toTaskResponse(row);
  }

  // ── Schedule ──
  m = /^\/api\/projects\/([^/]+)\/schedule$/.exec(path);
  if (m) {
    const p = project(m[1]);
    if (o.method === "GET") {
      requireMember(p, me);
      let rows = scheduleItems.filter(s => s.projectId === p.projectId);
      if (q.status) rows = rows.filter(s => s.status === q.status);
      if (q.type) rows = rows.filter(s => s.type === q.type);
      if (q.from) rows = rows.filter(s => !s.startsAt || s.startsAt >= String(q.from));
      if (q.to) rows = rows.filter(s => !s.startsAt || s.startsAt <= String(q.to));
      rows = rows.sort((a, b2) => (a.startsAt ?? "").localeCompare(b2.startsAt ?? ""));
      const page = offsetPage(rows, q);
      return { items: page.items.map(toScheduleResponse), page: page.page };
    }
    requireManager(p, me);
    if (p.status !== "ACTIVE") return fail(409, "PROJECT_NOT_ACTIVE");
    const e: FieldError[] = [];
    if (!["MILESTONE", "EVENT"].includes(b.type)) e.push({ field: "type", reason: "INVALID_ENUM" });
    const title = str(e, b, "title", 1, 200); const description = str(e, b, "description", 0, 2000, false); check(e);
    const row = mkSchedule(p.projectId, b.type, title!, b.startsAt ?? null, me.userId);
    row.description = description ?? null; row.endsAt = b.endsAt ?? null;
    scheduleItems.push(row);
    return toScheduleResponse(row);
  }
  function findSchedule(p: Project, itemId: string): ScheduleItem { const s = scheduleItems.find(x => x.scheduleItemId === itemId && x.projectId === p.projectId); if (!s) return fail(404, "SCHEDULE_ITEM_NOT_FOUND"); return s; }

  m = /^\/api\/projects\/([^/]+)\/schedule\/([^/]+)$/.exec(path);
  if (m) {
    const p = project(m[1]);
    if (o.method === "GET") { requireMember(p, me); return toScheduleResponse(findSchedule(p, m[2])); }
    requireManager(p, me);
    const target = findSchedule(p, m[2]);
    if (p.status !== "ACTIVE") return fail(409, "PROJECT_NOT_ACTIVE");
    if (target.status === "CANCELED") return fail(409, "SCHEDULE_ITEM_CANCELED");
    const e: FieldError[] = [];
    if (!["MILESTONE", "EVENT"].includes(b.type)) e.push({ field: "type", reason: "INVALID_ENUM" });
    const title = str(e, b, "title", 1, 200); const description = str(e, b, "description", 0, 2000, false); check(e);
    const row = versioned(target, b, "SCHEDULE_ITEM_NOT_FOUND");
    Object.assign(row, { type: b.type, title, description: description ?? null, startsAt: b.startsAt ?? null, endsAt: b.endsAt ?? null, version: row.version + 1, updatedAt: now() });
    return toScheduleResponse(row);
  }

  m = /^\/api\/projects\/([^/]+)\/schedule\/([^/]+)\/cancel$/.exec(path);
  if (m) {
    const p = project(m[1]);
    requireManager(p, me);
    const target = findSchedule(p, m[2]);
    if (p.status !== "ACTIVE") return fail(409, "PROJECT_NOT_ACTIVE");
    const row = versioned(target, b, "SCHEDULE_ITEM_NOT_FOUND");
    if (row.status === "CANCELED") return fail(409, "SCHEDULE_ITEM_ALREADY_CANCELED");
    row.status = "CANCELED"; row.canceledAt = now(); row.version++; row.updatedAt = now();
    return toScheduleResponse(row);
  }

  return fail(404, "NOT_FOUND");
}
