// ANOK_BACKEND identity_service의 실제 Controller/DTO(record)를 기준으로 한 Wire 타입과 호출 함수.
// 명세(Anok_01 v2.3.1)와 구현이 다른 부분은 구현이 우선이다(예: MFA 입력은 factorType/factorCode가 아니라 단일 `code`,
// 만료는 `expiresAt`이 아니라 `expiresIn`(초), /users/me에는 fullName·company·department 이름이 없다).
import { request } from "./http";
import type { OffsetPage, Rfc3339, Uuid } from "./types";

export type CompanyRole = "ADMIN" | "EMPLOYEE";
export type UserStatus = "ACTIVE" | "INACTIVE";
export type OrganizationStatus = "ACTIVE" | "INACTIVE";
export type LifecycleReasonClass =
  | "TEMPORARY_SUSPENSION"
  | "EMPLOYMENT_TERMINATION"
  | "ACCOUNT_RETIREMENT"
  | "REACTIVATION"
  | "OTHER_ADMIN_SECURITY_ACTION";

// MeResponse
export interface CurrentUserResponse {
  userId: Uuid;
  companyId: Uuid;
  email: string;
  displayName: string;
  jobTitle: string | null;
  companyRole: CompanyRole;
  status: UserStatus;
  departmentId: Uuid | null;
  teamId: Uuid | null;
  mfaEnabled: boolean;
  createdAt: Rfc3339;
  updatedAt: Rfc3339;
  version: number;
}

// AdminUserSummary — jobTitle/fullName은 응답에 없다. jobTitle은 listAdminUsers가 /api/organization에서 보충한다(활성 사용자만).
export interface AdminUserResponse {
  userId: Uuid;
  email: string;
  displayName: string;
  companyRole: CompanyRole;
  status: UserStatus;
  departmentId: Uuid | null;
  teamId: Uuid | null;
  createdAt: Rfc3339;
  version: number;
  jobTitle?: string | null;
}

export interface InvitationResponse { invitationId: Uuid; email: string; status: string; expiresAt: Rfc3339 }
export interface DepartmentResponse { id: Uuid; name: string; status: OrganizationStatus; version: number }
export interface TeamResponse { id: Uuid; departmentId: Uuid; name: string; status: OrganizationStatus; version: number }
export interface CompanyAdminResponse {
  companyId: Uuid; displayName: string; industry: string | null; description: string | null;
  productsServicesSummary: string | null; status: string; createdAt: Rfc3339; updatedAt: Rfc3339; version: number;
}
export interface OrganizationDirectoryResponse {
  users: { userId: Uuid; displayName: string; jobTitle: string | null; companyRole: CompanyRole; departmentId: Uuid | null; teamId: Uuid | null }[];
  departments: { id: Uuid; name: string; status: OrganizationStatus }[];
  teams: { id: Uuid; departmentId: Uuid; name: string; status: OrganizationStatus }[];
}
// MfaEnrollmentStartResponse
export interface MfaEnrollmentSecretResponse { otpAuthUri: string; secret: string }

// LoginResponse: status로 판별한다. FULL_SESSION이면 accessToken/expiresIn, 그 외에는 challengeToken/challengeExpiresAt.
export type LoginResult =
  | { status: "FULL_SESSION"; accessToken: string; expiresIn: number }
  | { status: "LOGIN_MFA_REQUIRED"; challengeToken: string; challengeExpiresAt: Rfc3339 }
  | { status: "ADMIN_MFA_BOOTSTRAP_REQUIRED"; challengeToken: string; challengeExpiresAt: Rfc3339 };

// AccessTokenResponse
export interface AccessTokenResponse { accessToken: string; expiresIn: number }

const auth = { auth: "bearer" } as const;
const ceremony = { auth: "none", cookies: true } as const;

// ── Auth (Public) ───────────────────────────────────────────────
export const startCompanyRegistration = (b: { companyName: string; adminEmail: string }) =>
  request<{ accepted: boolean; verificationExpiresAt: Rfc3339 }>({ method: "POST", path: "/api/auth/company-registrations", body: b, auth: "none", idempotent: true });
export const verifyRegistrationEmail = (verificationToken: string) =>
  request<{ challengeToken: string; expiresAt: Rfc3339 }>({ method: "POST", path: "/api/auth/company-registrations/verify-email", body: { verificationToken }, auth: "none" });
export const completeCompanyRegistration = (b: { challengeToken: string; adminFullName: string; adminDisplayName: string; password: string }) =>
  request<{ companyId: Uuid; adminUserId: Uuid; nextAction: "LOGIN" }>({ method: "POST", path: "/api/auth/company-registrations/complete", body: b, auth: "none", idempotent: true });
export const resendRegistrationVerification = (adminEmail: string) =>
  request<{ accepted: boolean }>({ method: "POST", path: "/api/auth/company-registrations/resend-verification", body: { adminEmail }, auth: "none", idempotent: true });

export const login = (b: { email: string; password: string }) =>
  request<LoginResult>({ method: "POST", path: "/api/auth/login", body: b, ...ceremony });
// 로그인 MFA와 step-up 모두 TOTP 또는 복구 코드를 단일 `code`로 받는다(서버가 TOTP → 복구 코드 순으로 검증).
export const completeLoginMfa = (b: { challengeToken: string; code: string }) =>
  request<AccessTokenResponse>({ method: "POST", path: "/api/auth/login/mfa", body: b, ...ceremony });
export const startAdminMfaBootstrap = (challengeToken: string) =>
  request<MfaEnrollmentSecretResponse>({ method: "POST", path: "/api/auth/admin-mfa-bootstrap/enrollment", body: { challengeToken }, auth: "none" });
export const confirmAdminMfaBootstrap = (b: { challengeToken: string; code: string }) =>
  request<AccessTokenResponse & { recoveryCodes: string[] }>({ method: "POST", path: "/api/auth/admin-mfa-bootstrap/enrollment/confirm", body: b, ...ceremony });
export const createStepUpChallenge = () =>
  request<{ challengeToken: string; expiresAt: Rfc3339 }>({ method: "POST", path: "/api/auth/step-up/challenges", body: {}, ...auth });
export const completeStepUp = (b: { challengeToken: string; password: string; code: string }) =>
  request<AccessTokenResponse>({ method: "POST", path: "/api/auth/step-up/complete", body: b, ...auth });
export const refresh = () => request<AccessTokenResponse>({ method: "POST", path: "/api/auth/refresh", auth: "none", cookies: true });
export const logout = () => request({ method: "POST", path: "/api/auth/logout", auth: "none", cookies: true });
export const logoutAll = () => request({ method: "POST", path: "/api/auth/logout-all", auth: "none", cookies: true });
export const requestPasswordReset = (email: string) =>
  request({ method: "POST", path: "/api/auth/password-resets", body: { email }, auth: "none", idempotent: true });
export const completePasswordReset = (b: { resetToken: string; newPassword: string }) =>
  request({ method: "POST", path: "/api/auth/password-resets/complete", body: b, auth: "none" });
export const acceptInvitation = (b: { invitationToken: string; fullName: string; displayName: string; password: string }) =>
  request<{ userId: Uuid }>({ method: "POST", path: "/api/auth/invitations/accept", body: b, auth: "none", idempotent: true });

// ── Me ─────────────────────────────────────────────────────────
export const getMe = () => request<CurrentUserResponse>({ method: "GET", path: "/api/users/me", ...auth });
// fullName/version은 UpdateMeRequest에 없다(서버는 displayName·jobTitle만 받는다).
export const updateMe = (b: { displayName: string; jobTitle?: string | null }) =>
  request<CurrentUserResponse>({ method: "PUT", path: "/api/users/me", body: b, ...auth });
export const changeMyPassword = (b: { currentPassword: string; newPassword: string }) =>
  request({ method: "PUT", path: "/api/users/me/password", body: b, ...auth });
export const startMfaEnrollment = (currentPassword: string) =>
  request<MfaEnrollmentSecretResponse>({ method: "POST", path: "/api/users/me/mfa/enrollment", body: { currentPassword }, ...auth });
export const confirmMfaEnrollment = (code: string) =>
  request<{ recoveryCodes: string[] }>({ method: "POST", path: "/api/users/me/mfa/enrollment/confirm", body: { code }, ...auth });
export const useRecoveryCode = (code: string) =>
  request<{ used: boolean; remainingUnusedCodes: number }>({ method: "POST", path: "/api/users/me/mfa/recovery-codes/use", body: { code }, ...auth });
export const rotateRecoveryCodes = () =>
  request<{ recoveryCodes: string[] }>({ method: "POST", path: "/api/users/me/mfa/recovery-codes/rotate", body: {}, ...auth });
export const disableMfa = (b: { password: string; code: string }) =>
  request({ method: "POST", path: "/api/users/me/mfa/disable", body: b, ...auth });

// ── Organization directory ─────────────────────────────────────
// 서버는 q 파라미터를 받지 않는다(OrganizationController.getOrganization(actor)). 필터링이 필요하면 호출 측에서 한다.
export const getOrganization = () => request<OrganizationDirectoryResponse>({ method: "GET", path: "/api/organization", ...auth });

// ── Admin: users ───────────────────────────────────────────────
// AdminUserSummary에는 jobTitle이 없어 조직 디렉터리(활성 사용자)에서 보충한다. 조직 변경 API는 jobTitle을 그대로 덮어쓰기 때문이다.
export async function listAdminUsers(q: { offset?: number; limit?: number; status?: UserStatus; departmentId?: Uuid; teamId?: Uuid; q?: string } = {}): Promise<OffsetPage<AdminUserResponse>> {
  const [page, dir] = await Promise.all([
    request<OffsetPage<AdminUserResponse>>({ method: "GET", path: "/api/admin/users", query: q, ...auth }),
    getOrganization().catch(() => null),
  ]);
  const jobs = new Map((dir?.users ?? []).map(u => [u.userId, u.jobTitle]));
  return { ...page, items: page.items.map(u => (jobs.has(u.userId) ? { ...u, jobTitle: jobs.get(u.userId) } : u)) };
}
export const createInvitation = (email: string) =>
  request<InvitationResponse>({ method: "POST", path: "/api/admin/users/invitations", body: { email }, ...auth, idempotent: true });
export const resendInvitation = (invitationId: Uuid) =>
  request<InvitationResponse>({ method: "POST", path: `/api/admin/users/invitations/${invitationId}/resend`, ...auth, idempotent: true });
export const cancelInvitation = (invitationId: Uuid) =>
  request({ method: "DELETE", path: `/api/admin/users/invitations/${invitationId}`, ...auth });
export const updateUserStatus = (userId: Uuid, b: { status: UserStatus; reasonClass?: LifecycleReasonClass; version: number }) =>
  request<AdminUserResponse>({ method: "PUT", path: `/api/admin/users/${userId}/status`, body: b, ...auth });
export const updateUserCompanyRole = (userId: Uuid, b: { companyRole: CompanyRole; version: number }) =>
  request<AdminUserResponse>({ method: "PUT", path: `/api/admin/users/${userId}/company-role`, body: b, ...auth });
export const updateUserOrganization = (userId: Uuid, b: { departmentId?: Uuid | null; teamId?: Uuid | null; jobTitle?: string | null; version: number }) =>
  request<AdminUserResponse>({ method: "PUT", path: `/api/admin/users/${userId}/organization`, body: b, ...auth });
export const triggerPasswordReset = (userId: Uuid) =>
  request({ method: "POST", path: `/api/admin/users/${userId}/password-reset`, ...auth, idempotent: true });

// ── Admin: company ─────────────────────────────────────────────
export const getCompany = () => request<CompanyAdminResponse>({ method: "GET", path: "/api/admin/company", ...auth });
export const updateCompany = (b: { displayName: string; industry?: string | null; description?: string | null; productsServicesSummary?: string | null; version: number }) =>
  request<CompanyAdminResponse>({ method: "PUT", path: "/api/admin/company", body: b, ...auth });

// ── Admin: departments / teams ─────────────────────────────────
// 목록 API는 status/departmentId 필터를 받지 않는다(전체를 돌려주므로 호출 측에서 거른다). inactivate는 data 없이 성공만 돌려준다.
export const listDepartments = () => request<DepartmentResponse[]>({ method: "GET", path: "/api/admin/departments", ...auth });
export const createDepartment = (name: string) =>
  request<DepartmentResponse>({ method: "POST", path: "/api/admin/departments", body: { name }, ...auth, idempotent: true });
export const updateDepartment = (departmentId: Uuid, b: { name: string; version: number }) =>
  request<DepartmentResponse>({ method: "PUT", path: `/api/admin/departments/${departmentId}`, body: b, ...auth });
export const inactivateDepartment = (departmentId: Uuid, version: number) =>
  request({ method: "POST", path: `/api/admin/departments/${departmentId}/inactivate`, body: { version }, ...auth, idempotent: true });
export const listTeams = () => request<TeamResponse[]>({ method: "GET", path: "/api/admin/teams", ...auth });
export const createTeam = (b: { departmentId: Uuid; name: string }) =>
  request<TeamResponse>({ method: "POST", path: "/api/admin/teams", body: b, ...auth, idempotent: true });
export const updateTeam = (teamId: Uuid, b: { departmentId: Uuid; name: string; version: number }) =>
  request<TeamResponse>({ method: "PUT", path: `/api/admin/teams/${teamId}`, body: b, ...auth });
export const inactivateTeam = (teamId: Uuid, version: number) =>
  request({ method: "POST", path: `/api/admin/teams/${teamId}/inactivate`, body: { version }, ...auth, idempotent: true });
