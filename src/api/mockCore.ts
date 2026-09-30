// mock.ts(Identity)와 mockProject.ts(Project) 등 여러 mock 서버가 공유하는 원시 유틸/사용자 저장소.
// 실 API 연결 시(config.USE_MOCK === false) 이 파일 전체가 사용되지 않는다.
import { ApiError } from "./errors";
import type { CompanyRole, UserStatus } from "./identity";
import type { FieldError } from "./types";

export interface MockUser {
  userId: string; email: string; password: string; fullName: string; displayName: string; jobTitle: string | null;
  companyRole: CompanyRole; status: UserStatus; departmentId: string | null; teamId: string | null; version: number; mfa: boolean;
}

// 도메인별로 kind 접두사를 나눠 겹치지 않는 결정론적 mock UUID를 만든다 (1=user,2=dept,3=team,4=company,5+=project 도메인).
export const id = (kind: number, n: number) => `${kind.toString(16).padStart(8, "0")}-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

const DEPT = { dev: id(2, 1), tech: id(2, 2), product: id(2, 3) };
const TEAM = { be: id(3, 1), fe: id(3, 2), data: id(3, 3), ai: id(3, 4), infra: id(3, 5), plan: id(3, 6), design: id(3, 7) };

const u = (n: number, email: string, name: string, job: string, role: CompanyRole, dept: string | null, team: string | null, mfa = false): MockUser =>
  ({ userId: id(1, n), email, password: MOCK_PASSWORD, fullName: name, displayName: name, jobTitle: job, companyRole: role, status: "ACTIVE", departmentId: dept, teamId: team, version: 1, mfa });

export const MOCK_PASSWORD = "AnokDemo!2026";
export const MOCK_TOTP = "123456";
export const MOCK_RECOVERY = "RECOVERY-0001";

export const users: MockUser[] = [
  u(1, "wonjae@anok.io", "이원재", "프론트엔드 개발자", "EMPLOYEE", DEPT.dev, TEAM.fe),
  u(2, "gyuchan@anok.io", "김규찬", "백엔드 개발자", "EMPLOYEE", DEPT.dev, TEAM.be),
  u(3, "insung@anok.io", "박인성", "관리자", "ADMIN", null, null, true),
  u(4, "minjun@anok.io", "박민준", "데이터 엔지니어", "EMPLOYEE", DEPT.tech, TEAM.data),
  u(5, "dayoung@anok.io", "최다영", "AI 엔지니어", "EMPLOYEE", DEPT.tech, TEAM.ai),
  u(6, "seoyeon@anok.io", "정서연", "풀스택 개발자", "EMPLOYEE", DEPT.dev, TEAM.be, true),
  u(7, "seungwoo@anok.io", "한승우", "DevOps 엔지니어", "EMPLOYEE", DEPT.tech, TEAM.infra),
  u(8, "jihyun@anok.io", "오지현", "UI/UX 디자이너", "EMPLOYEE", DEPT.product, TEAM.design),
  u(9, "taeyang@anok.io", "윤태양", "프로덕트 매니저", "EMPLOYEE", DEPT.product, TEAM.plan),
  u(10, "bootstrap@anok.io", "신규 관리자", "관리자", "ADMIN", null, null, false),
];
export const DEPARTMENTS_SEED = DEPT;
export const TEAMS_SEED = TEAM;

export const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
export const fail = (status: number, code: string, fieldErrors?: FieldError[]): never => {
  throw new ApiError(status, code, "요청을 처리할 수 없습니다.", crypto.randomUUID(), fieldErrors);
};
export const invalid = (...fe: FieldError[]) => fail(400, "VALIDATION_ERROR", fe);
export function check(errors: FieldError[]) { if (errors.length) invalid(...errors); }
export function str(errors: FieldError[], b: any, field: string, min: number, max: number, required = true) {
  const v = b?.[field];
  if (v === undefined || v === null || v === "") { if (required) errors.push({ field, reason: "NotBlank" }); return undefined; }
  if (typeof v !== "string") { errors.push({ field, reason: "INVALID_FORMAT" }); return undefined; }
  // identity/project Service는 Bean Validation 코드(Size 등)를 fieldErrors[].reason에 그대로 내려준다.
  if (v.length < min || v.length > max) errors.push({ field, reason: "Size" });
  return v;
}
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const byId = (userId: string) => users.find(x => x.userId === userId);
export const activeAdmins = () => users.filter(x => x.companyRole === "ADMIN" && x.status === "ACTIVE").length;

export function principal(token: string | null): MockUser {
  const m = /^mock\.([^.]+)\.(\d+)$/.exec(token ?? "");
  if (!m || Number(m[2]) < Date.now()) return fail(401, "TOKEN_INVALID");
  const x = byId(m[1]);
  if (!x) return fail(401, "TOKEN_INVALID");
  if (x.status !== "ACTIVE") return fail(403, "USER_INACTIVE");
  return x;
}
export const admin = (x: MockUser) => { if (x.companyRole !== "ADMIN") fail(403, "ADMIN_REQUIRED"); };

let lastStepUpAt = 0;
const STEP_UP_TTL_MS = 10 * 60 * 1000;
export const markStepUp = () => { lastStepUpAt = Date.now(); };
export const clearStepUp = () => { lastStepUpAt = 0; };
export const stepUp = (x: MockUser) => { admin(x); if (Date.now() - lastStepUpAt > STEP_UP_TTL_MS) fail(403, "STEP_UP_REQUIRED"); };

export const versioned = <T extends { version: number }>(row: T | undefined, b: any, notFound: string): T => {
  if (!row) return fail(404, notFound);
  if (typeof b?.version !== "number") invalid({ field: "version", reason: "REQUIRED" });
  if (row.version !== b.version) fail(409, "VERSION_CONFLICT");
  return row;
};

export function offsetPage<T>(rows: T[], q: Record<string, unknown> | undefined) {
  const offset = Number(q?.offset ?? 0);
  const limit = Number(q?.limit ?? 20);
  if (!(offset >= 0) || !(Number.isFinite(limit) && limit >= 1 && limit <= 100)) invalid({ field: "limit", reason: "OUT_OF_RANGE" });
  return { items: rows.slice(offset, offset + limit), page: { offset, limit, total: rows.length } };
}
