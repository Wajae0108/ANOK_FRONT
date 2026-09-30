// Anok_01_Identity_Company_Organization_API_Event_Spec_v2_3_1_FINAL — Public API 43개
// 명세에 필드가 명시되지 않은 응답 DTO(AdminUser*, Department*, Team*, user.version 등)는 `?` 로 두었다. 백엔드 확정 후 좁힐 것.
import { request } from "./http";
import type { OffsetPage, Rfc3339, Uuid } from "./types";

export type CompanyRole = "ADMIN" | "EMPLOYEE";
export type UserStatus = "ACTIVE" | "INACTIVE";
export type OrganizationStatus = "ACTIVE" | "INACTIVE";
export type FactorType = "TOTP" | "RECOVERY_CODE";
export type LifecycleReasonClass =
  | "TEMPORARY_SUSPENSION"
  | "EMPLOYMENT_TERMINATION"
  | "ACCOUNT_RETIREMENT"
  | "REACTIVATION"
  | "OTHER_ADMIN_SECURITY_ACTION";

export interface OrgRef { id?: Uuid; departmentId?: Uuid; teamId?: Uuid; name: string }

export interface CurrentUserResponse {
  userId: Uuid;
  email: string;
  fullName: string;
  displayName: string;
  jobTitle?: string | null;
  companyRole: CompanyRole;
  status: UserStatus;
  company: { id: Uuid; displayName: string; status: string };
  department?: OrgRef | null;
  team?: OrgRef | null;
  mfa: { enabled: boolean };
  version?: number;
}

export interface AdminUserResponse {
  userId: Uuid;
  email: string;
  fullName?: string;
  displayName: string;
  jobTitle?: string | null;
  companyRole: CompanyRole;
  status: UserStatus;
  departmentId?: Uuid | null;
  teamId?: Uuid | null;
  version: number;
}

export interface InvitationResponse { invitationId: Uuid; email: string; status: string; expiresAt: Rfc3339 }
export interface DepartmentResponse { departmentId: Uuid; name: string; status: OrganizationStatus; version: number }
export interface TeamResponse { teamId: Uuid; departmentId: Uuid; name: string; status: OrganizationStatus; version: number }
export interface CompanyAdminResponse {
  companyId: Uuid; displayName: string; industry?: string | null; description?: string | null;
  productsServicesSummary?: string | null; status: string; createdAt: Rfc3339; updatedAt: Rfc3339; version: number;
}
export interface OrganizationDirectoryResponse {
  departments: DepartmentResponse[];
  teams: TeamResponse[];
  users: { userId: Uuid; displayName: string; fullName: string; jobTitle?: string | null; departmentId?: Uuid | null; teamId?: Uuid | null }[];
}
export interface MfaEnrollmentSecretResponse { enrollmentId: Uuid; otpauthUri: string; manualKey: string; expiresAt: Rfc3339 }

export type LoginResult =
  | { type: "SESSION"; accessToken: string; expiresAt: Rfc3339; user: CurrentUserResponse }
  | { type: "MFA_REQUIRED"; challengeToken: string; expiresAt: Rfc3339 }
  | { type: "ADMIN_MFA_BOOTSTRAP_REQUIRED"; challengeToken: string; expiresAt: Rfc3339 };

const auth = { auth: "bearer" } as const;
const ceremony = { auth: "none", cookies: true } as const;

// ── Auth (Public) ───────────────────────────────────────────────
export const startCompanyRegistration = (b: { companyName: string; adminEmail: string }) =>
  request<{ accepted: true; verificationExpiresAt: Rfc3339 }>({ method: "POST", path: "/api/auth/company-registrations", body: b, auth: "none", idempotent: true });
export const verifyRegistrationEmail = (verificationToken: string) =>
  request<{ challengeToken: string; expiresAt: Rfc3339 }>({ method: "POST", path: "/api/auth/company-registrations/verify-email", body: { verificationToken }, auth: "none" });
export const completeCompanyRegistration = (b: { challengeToken: string; adminFullName: string; adminDisplayName: string; password: string }) =>
  request<{ companyId: Uuid; adminUserId: Uuid; nextAction: "LOGIN" }>({ method: "POST", path: "/api/auth/company-registrations/complete", body: b, auth: "none", idempotent: true });
export const resendRegistrationVerification = (adminEmail: string) =>
  request<{ accepted: true }>({ method: "POST", path: "/api/auth/company-registrations/resend-verification", body: { adminEmail }, auth: "none", idempotent: true });

export async function login(b: { email: string; password: string }): Promise<LoginResult> {
  const raw = await request<any>({ method: "POST", path: "/api/auth/login", body: b, ...ceremony });
  // 명세는 union 판별 필드명을 정의하지 않았다. accessToken 유무로 SESSION을 구분하고 나머지는 `type`으로 읽는다.
  if (raw?.accessToken) return { type: "SESSION", accessToken: raw.accessToken, expiresAt: raw.expiresAt, user: raw.user };
  return { type: raw?.type, challengeToken: raw?.challengeToken, expiresAt: raw?.expiresAt } as LoginResult;
}
export const completeLoginMfa = (b: { challengeToken: string; factorType: FactorType; factorCode: string }) =>
  request<{ accessToken: string; tokenType: "Bearer"; expiresAt: Rfc3339; user: CurrentUserResponse }>({ method: "POST", path: "/api/auth/login/mfa", body: b, ...ceremony });
export const startAdminMfaBootstrap = (challengeToken: string) =>
  request<MfaEnrollmentSecretResponse>({ method: "POST", path: "/api/auth/admin-mfa-bootstrap/enrollment", body: { challengeToken }, auth: "none" });
export const confirmAdminMfaBootstrap = (b: { challengeToken: string; enrollmentId: Uuid; totpCode: string }) =>
  request<{ accessToken: string; tokenType: "Bearer"; expiresAt: Rfc3339; recoveryCodes: string[]; user: CurrentUserResponse }>({ method: "POST", path: "/api/auth/admin-mfa-bootstrap/enrollment/confirm", body: b, ...ceremony });
export const createStepUpChallenge = () =>
  request<{ challengeToken: string; expiresAt: Rfc3339 }>({ method: "POST", path: "/api/auth/step-up/challenges", body: {}, ...auth });
export const completeStepUp = (b: { challengeToken: string; password: string; factorType: FactorType; factorCode: string }) =>
  request<{ accessToken: string; tokenType: "Bearer"; expiresAt: Rfc3339; authTime: Rfc3339 }>({ method: "POST", path: "/api/auth/step-up/complete", body: b, ...auth });
export const refresh = () => request<{ accessToken: string; tokenType: "Bearer"; expiresAt: Rfc3339 }>({ method: "POST", path: "/api/auth/refresh", auth: "none", cookies: true });
export const logout = () => request({ method: "POST", path: "/api/auth/logout", auth: "none", cookies: true });
export const logoutAll = () => request({ method: "POST", path: "/api/auth/logout-all", auth: "none", cookies: true });
export const requestPasswordReset = (email: string) =>
  request<{ accepted: true }>({ method: "POST", path: "/api/auth/password-resets", body: { email }, auth: "none", idempotent: true });
export const completePasswordReset = (b: { resetToken: string; newPassword: string }) =>
  request({ method: "POST", path: "/api/auth/password-resets/complete", body: b, auth: "none" });
export const acceptInvitation = (b: { invitationToken: string; fullName: string; displayName: string; password: string }) =>
  request<{ userId: Uuid; companyId: Uuid; companyRole: "EMPLOYEE"; nextAction: "LOGIN" }>({ method: "POST", path: "/api/auth/invitations/accept", body: b, auth: "none", idempotent: true });

// ── Me ─────────────────────────────────────────────────────────
export const getMe = () => request<CurrentUserResponse>({ method: "GET", path: "/api/users/me", ...auth });
export const updateMe = (b: { fullName: string; displayName: string; jobTitle?: string | null; version: number }) =>
  request<CurrentUserResponse>({ method: "PUT", path: "/api/users/me", body: b, ...auth });
export const changeMyPassword = (b: { currentPassword: string; newPassword: string }) =>
  request({ method: "PUT", path: "/api/users/me/password", body: b, ...auth });
export const startMfaEnrollment = (currentPassword: string) =>
  request<MfaEnrollmentSecretResponse>({ method: "POST", path: "/api/users/me/mfa/enrollment", body: { currentPassword }, ...auth });
export const confirmMfaEnrollment = (b: { enrollmentId: Uuid; totpCode: string }) =>
  request<{ enabled: true; recoveryCodes: string[] }>({ method: "POST", path: "/api/users/me/mfa/enrollment/confirm", body: b, ...auth });
export const useRecoveryCode = (recoveryCode: string) =>
  request<{ used: true; remainingUnusedCodes: number }>({ method: "POST", path: "/api/users/me/mfa/recovery-codes/use", body: { recoveryCode }, ...auth });
export const rotateRecoveryCodes = () =>
  request<{ recoveryCodes: string[] }>({ method: "POST", path: "/api/users/me/mfa/recovery-codes/rotate", body: {}, ...auth });
export const disableMfa = (b: { currentPassword: string; reason?: string }) =>
  request({ method: "POST", path: "/api/users/me/mfa/disable", body: b, ...auth });

// ── Organization directory ─────────────────────────────────────
export const getOrganization = (q?: string) => request<OrganizationDirectoryResponse>({ method: "GET", path: "/api/organization", query: { q }, ...auth });

// ── Admin: users ───────────────────────────────────────────────
export const listAdminUsers = (q: { offset?: number; limit?: number; status?: UserStatus; departmentId?: Uuid; teamId?: Uuid; q?: string } = {}) =>
  request<OffsetPage<AdminUserResponse>>({ method: "GET", path: "/api/admin/users", query: q, ...auth });
export const createInvitation = (email: string) =>
  request<InvitationResponse>({ method: "POST", path: "/api/admin/users/invitations", body: { email }, ...auth, idempotent: true });
export const resendInvitation = (invitationId: Uuid) =>
  request<InvitationResponse>({ method: "POST", path: `/api/admin/users/invitations/${invitationId}/resend`, body: {}, ...auth, idempotent: true });
export const cancelInvitation = (invitationId: Uuid) =>
  request({ method: "DELETE", path: `/api/admin/users/invitations/${invitationId}`, ...auth });
export const updateUserStatus = (userId: Uuid, b: { status: UserStatus; reasonClass: LifecycleReasonClass; version: number }) =>
  request<AdminUserResponse>({ method: "PUT", path: `/api/admin/users/${userId}/status`, body: b, ...auth });
export const updateUserCompanyRole = (userId: Uuid, b: { companyRole: CompanyRole; version: number }) =>
  request<AdminUserResponse>({ method: "PUT", path: `/api/admin/users/${userId}/company-role`, body: b, ...auth });
export const updateUserOrganization = (userId: Uuid, b: { departmentId?: Uuid | null; teamId?: Uuid | null; jobTitle?: string | null; version: number }) =>
  request<AdminUserResponse>({ method: "PUT", path: `/api/admin/users/${userId}/organization`, body: b, ...auth });
export const triggerPasswordReset = (userId: Uuid) =>
  request<{ accepted: true }>({ method: "POST", path: `/api/admin/users/${userId}/password-reset`, body: {}, ...auth, idempotent: true });

// ── Admin: company ─────────────────────────────────────────────
export const getCompany = () => request<CompanyAdminResponse>({ method: "GET", path: "/api/admin/company", ...auth });
export const updateCompany = (b: { displayName: string; industry?: string | null; description?: string | null; productsServicesSummary?: string | null; version: number }) =>
  request<CompanyAdminResponse>({ method: "PUT", path: "/api/admin/company", body: b, ...auth });

// ── Admin: departments / teams ─────────────────────────────────
export const listDepartments = (status?: OrganizationStatus) => request<DepartmentResponse[]>({ method: "GET", path: "/api/admin/departments", query: { status }, ...auth });
export const createDepartment = (name: string) =>
  request<DepartmentResponse>({ method: "POST", path: "/api/admin/departments", body: { name }, ...auth, idempotent: true });
export const updateDepartment = (departmentId: Uuid, b: { name: string; version: number }) =>
  request<DepartmentResponse>({ method: "PUT", path: `/api/admin/departments/${departmentId}`, body: b, ...auth });
export const inactivateDepartment = (departmentId: Uuid, version: number) =>
  request<DepartmentResponse>({ method: "POST", path: `/api/admin/departments/${departmentId}/inactivate`, body: { version }, ...auth, idempotent: true });
export const listTeams = (q: { departmentId?: Uuid; status?: OrganizationStatus } = {}) => request<TeamResponse[]>({ method: "GET", path: "/api/admin/teams", query: q, ...auth });
export const createTeam = (b: { departmentId: Uuid; name: string }) =>
  request<TeamResponse>({ method: "POST", path: "/api/admin/teams", body: b, ...auth, idempotent: true });
export const updateTeam = (teamId: Uuid, b: { departmentId: Uuid; name: string; version: number }) =>
  request<TeamResponse>({ method: "PUT", path: `/api/admin/teams/${teamId}`, body: b, ...auth });
export const inactivateTeam = (teamId: Uuid, version: number) =>
  request<TeamResponse>({ method: "POST", path: `/api/admin/teams/${teamId}/inactivate`, body: { version }, ...auth, idempotent: true });
