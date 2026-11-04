// 백엔드가 없을 때(VITE_API_BASE_URL 미설정) ANOK_BACKEND identity_service의 실제 DTO/규칙으로 응답하는 인메모리 서버.
// 실 API 연결 시 이 파일은 사용되지 않는다(config.USE_MOCK === false).
import { ApiError } from "./errors";
import type { RequestOptions } from "./http";
import type { AdminUserResponse, CurrentUserResponse, DepartmentResponse, InvitationResponse, TeamResponse } from "./identity";
import {
  DEPARTMENTS_SEED as DEPT, TEAMS_SEED as TEAM, MOCK_PASSWORD, MOCK_TOTP, MOCK_RECOVERY,
  activeAdmins, admin, byId, check, clearStepUp, delay, EMAIL, fail, id, invalid, markStepUp, principal, stepUp, str, users, versioned,
} from "./mockCore";
import type { MockUser } from "./mockCore";
import { routeAi, streamAiMessage } from "./mockAi";
import { downloadResponse, routeDocument } from "./mockDocument";
import { routeMeeting, streamMeetingChat } from "./mockMeeting";
import { routeNotification, subscribe as subscribeNotifications } from "./mockNotification";
import { routeProject } from "./mockProject";
import type { FieldError } from "./types";

export { MOCK_PASSWORD, MOCK_TOTP, MOCK_RECOVERY };
export const MOCK_DEMO_ACCOUNTS = [
  { email: "wonjae@anok.io", label: "이원재 · 직원", demoUserId: 1 },
  { email: "gyuchan@anok.io", label: "김규찬 · 직원", demoUserId: 2 },
  { email: "insung@anok.io", label: "박인성 · 관리자(MFA)", demoUserId: 3 },
  { email: "bootstrap@anok.io", label: "신규 관리자 · MFA 최초 설정", demoUserId: undefined },
];
export const mockDemoUserId = (email: string) => MOCK_DEMO_ACCOUNTS.find(a => a.email === email)?.demoUserId;
export const mockInviteToken = (invitationId: string) => `invite-${invitationId}`;

const SESSION_KEY = "anok_mock_session";
const ACCESS_TTL_MS = 10 * 60 * 1000;

const departments: DepartmentResponse[] = [
  { id: DEPT.dev, name: "개발부", status: "ACTIVE", version: 1 },
  { id: DEPT.tech, name: "기술부", status: "ACTIVE", version: 1 },
  { id: DEPT.product, name: "프로덕트부", status: "ACTIVE", version: 1 },
];
const teams: TeamResponse[] = [
  { id: TEAM.be, departmentId: DEPT.dev, name: "백엔드팀", status: "ACTIVE", version: 1 },
  { id: TEAM.fe, departmentId: DEPT.dev, name: "프론트엔드팀", status: "ACTIVE", version: 1 },
  { id: TEAM.data, departmentId: DEPT.tech, name: "데이터팀", status: "ACTIVE", version: 1 },
  { id: TEAM.ai, departmentId: DEPT.tech, name: "AI팀", status: "ACTIVE", version: 1 },
  { id: TEAM.infra, departmentId: DEPT.tech, name: "인프라팀", status: "ACTIVE", version: 1 },
  { id: TEAM.plan, departmentId: DEPT.product, name: "기획팀", status: "ACTIVE", version: 1 },
  { id: TEAM.design, departmentId: DEPT.product, name: "디자인팀", status: "ACTIVE", version: 1 },
];

const company = {
  companyId: id(4, 1), displayName: "(주)아녹 테크놀로지", industry: "소프트웨어", description: "회의·문서·업무를 연결하는 AI 업무 운영 플랫폼",
  productsServicesSummary: "Anok 웹/데스크톱", status: "ACTIVE", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", version: 1,
};
const invitations = new Map<string, InvitationResponse>();

const CREATED_AT = "2026-01-01T00:00:00Z";
const toMe = (x: MockUser): CurrentUserResponse => ({
  userId: x.userId, companyId: company.companyId, email: x.email, displayName: x.displayName, jobTitle: x.jobTitle, companyRole: x.companyRole, status: x.status,
  departmentId: x.departmentId, teamId: x.teamId, mfaEnabled: x.mfa, createdAt: CREATED_AT, updatedAt: CREATED_AT, version: x.version,
});
// AdminUserSummary: fullName/jobTitle이 없다.
const toAdmin = (x: MockUser): AdminUserResponse => ({
  userId: x.userId, email: x.email, displayName: x.displayName, companyRole: x.companyRole,
  status: x.status, departmentId: x.departmentId, teamId: x.teamId, createdAt: CREATED_AT, version: x.version,
});

const newToken = (x: MockUser) => `mock.${x.userId}.${Date.now() + ACCESS_TTL_MS}`;
const session = (x: MockUser) => {
  sessionStorage.setItem(SESSION_KEY, x.userId);
  return { accessToken: newToken(x), expiresIn: ACCESS_TTL_MS / 1000 };
};
// 서버는 TOTP → 복구 코드 순으로 단일 code를 검증한다.
const validCode = (code: unknown) => code === MOCK_TOTP || code === MOCK_RECOVERY;
const secret = () => ({ otpAuthUri: "otpauth://totp/Anok:mock?secret=JBSWY3DPEHPK3PXP&issuer=Anok", secret: "JBSWY3DPEHPK3PXP" });
const recoveryCodes = () => Array.from({ length: 8 }, (_, i) => `RECOVERY-${String(i + 1).padStart(4, "0")}`);

const CREATED = new Set([
  "POST /api/auth/company-registrations/complete", "POST /api/auth/invitations/accept",
  "POST /api/admin/users/invitations", "POST /api/admin/departments", "POST /api/admin/teams",
]);
const CREATED_PATTERNS = [
  /^POST \/api\/projects$/, /^POST \/api\/projects\/[^/]+\/members$/, /^POST \/api\/projects\/[^/]+\/decisions$/,
  /^POST \/api\/projects\/[^/]+\/decisions\/[^/]+\/supersede$/, /^POST \/api\/projects\/[^/]+\/tasks$/, /^POST \/api\/projects\/[^/]+\/schedule$/,
  /^POST \/api\/documents$/, /^POST \/api\/documents\/[^/]+\/versions$/, /^POST \/api\/documents\/[^/]+\/project-attachments$/, /^POST \/api\/meetings\/[^/]+\/attachments$/,
  /^POST \/api\/meetings$/, /^POST \/api\/meetings\/[^/]+\/participants$/, /^POST \/api\/meetings\/[^/]+\/chat\/messages$/,
  /^POST \/api\/ai\/conversations$/,
];
const ACCEPTED_PATTERNS = [
  /^POST \/api\/documents\/[^/]+\/processing$/, /^POST \/api\/documents\/[^/]+\/processing\/retry$/,
  /^POST \/api\/meetings\/[^/]+\/candidates\/[^/]+\/materialize$/,
  // 보고서 요청(기본·회사 양식 모두 202), 회의록 재생성, 후처리 재시도도 202다.
  /^POST \/api\/meetings\/[^/]+\/custom-report$/, /^POST \/api\/meetings\/[^/]+\/minutes\/regenerate$/, /^POST \/api\/meetings\/[^/]+\/postprocess\/retry$/,
];

// 서버의 @RequestPart("metadata")(JSON) + @RequestPart("file")에 대응한다. metadata가 없거나 JSON이 아니면 400.
// 보고서 양식 올리기(PUT /minutes-template)는 `file` 파트만 보낸다(metadata 파트 없음).
async function readMultipart(fd: FormData, requireMetadata = true): Promise<Record<string, unknown>> {
  if (!requireMetadata) return { file: fd.get("file") ?? undefined };
  const meta = fd.get("metadata");
  let parsed: Record<string, unknown> = {};
  try {
    const text = typeof meta === "string" ? meta : meta ? await (meta as Blob).text() : "";
    parsed = JSON.parse(text);
  } catch { throw new ApiError(400, "VALIDATION_ERROR", "입력값이 올바르지 않습니다.", crypto.randomUUID(), [{ field: "metadata", reason: "REQUIRED" }]); }
  return { ...parsed, file: fd.get("file") ?? undefined };
}

// fetch 계층 mock: 실제 Gateway처럼 status/헤더/공통 JSON Wrapper를 만들어 돌려주므로
// http.ts의 래퍼 파싱, 401→refresh 재시도, STEP_UP_REQUIRED 처리가 mock 모드에서도 동일하게 실행된다.
export async function mockFetch(input: string, init: { method?: string; headers?: Record<string, string>; body?: string | FormData }): Promise<Response> {
  await delay(180);
  const url = new URL(input);
  const method = (init.method ?? "GET") as RequestOptions["method"];
  const isForm = typeof FormData !== "undefined" && init.body instanceof FormData;
  const o: RequestOptions = {
    method, path: url.pathname, query: Object.fromEntries(url.searchParams),
    body: isForm ? await readMultipart(init.body as FormData, !url.pathname.endsWith("/minutes-template")) : init.body ? JSON.parse(init.body as string) : undefined,
  };
  const token = /^Bearer (.+)$/.exec(init.headers?.Authorization ?? "")?.[1] ?? null;
  const requestId = crypto.randomUUID();
  try {
    const data = await route(o, token);
    if (data === undefined) return new Response(null, { status: 204, headers: { "X-Request-Id": requestId } });
    const key = `${method} ${o.path}`;
    const status = CREATED.has(key) || CREATED_PATTERNS.some(p => p.test(key)) ? 201
      : ACCEPTED_PATTERNS.some(p => p.test(key)) || (data as { accepted?: boolean })?.accepted === true ? 202
      : 200;
    return new Response(JSON.stringify({ success: true, message: "요청이 성공적으로 처리되었습니다.", data, errorCode: null }), { status, headers: { "Content-Type": "application/json", "X-Request-Id": requestId } });
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    const body = { success: false, message: e.message, data: null, errorCode: e.errorCode, requestId, ...(e.fieldErrors ? { fieldErrors: e.fieldErrors } : {}) };
    return new Response(JSON.stringify(body), { status: e.status, headers: { "Content-Type": "application/json", "X-Request-Id": requestId } });
  }
}

// FILE_DOWNLOAD 라우트 전용: http.ts의 downloadFile()이 JSON Wrapper 없이 직접 호출한다.
export async function mockDownload(path: string, headers: Record<string, string>): Promise<Response> {
  await delay(180);
  const token = /^Bearer (.+)$/.exec(headers.Authorization ?? "")?.[1] ?? null;
  return downloadResponse(path, token);
}

// SSE(NTF-API-05, AI-API-05) 전용: http.ts의 openStream()/openMessageStream()이 공통 JSON Wrapper 없이 직접 호출한다.
// 실제 fetch 없이도 ReadableStream으로 text/event-stream 바디를 만들어 진짜 스트리밍을 재현한다.
export async function mockStream(path: string, headers: Record<string, string>, signal?: AbortSignal, body?: unknown): Promise<Response> {
  await delay(80);
  const token = /^Bearer (.+)$/.exec(headers.Authorization ?? "")?.[1] ?? null;
  let me: MockUser;
  try { me = principal(token); }
  catch (e) {
    if (!(e instanceof ApiError)) throw e;
    const requestId = crypto.randomUUID();
    return new Response(JSON.stringify({ success: false, message: e.message, data: null, errorCode: e.errorCode, requestId }), { status: e.status, headers: { "Content-Type": "application/json", "X-Request-Id": requestId } });
  }

  const aiMsgMatch = /^\/api\/ai\/conversations\/([^/]+)\/messages$/.exec(path);
  if (aiMsgMatch) return streamAiMessage(aiMsgMatch[1], body, me, signal);
  // 회의 채팅 SSE (GET /api/meetings/{id}/chat/stream?afterSequence=N, Last-Event-ID 헤더)
  const chatMatch = /^\/api\/meetings\/([^/]+)\/chat\/stream(?:\?.*)?$/.exec(path);
  if (chatMatch) {
    const after = new URL(path, "http://mock").searchParams.get("afterSequence");
    return streamMeetingChat(chatMatch[1], Number(headers["Last-Event-ID"] ?? after ?? 0) || 0, me, signal);
  }
  if (path !== "/api/notifications/stream") return new Response(null, { status: 404 });

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`event: connected\ndata: {}\n\n`));
      unsubscribe = subscribeNotifications(me.userId, n => {
        const data = JSON.stringify({
          notificationId: n.notificationId, notificationType: n.notificationType, resourceType: n.resourceType, resourceId: n.resourceId,
          secondaryResourceType: n.secondaryResourceType, secondaryResourceId: n.secondaryResourceId, presentationCode: n.presentationCode,
          safeParameters: n.safeParameters, occurredAt: n.occurredAt, createdAt: new Date(n.createdAtMs).toISOString(),
        });
        try { controller.enqueue(encoder.encode(`event: notification\nid: ${n.notificationId}\ndata: ${data}\n\n`)); } catch { /* 연결이 이미 닫힌 뒤의 늦은 broadcast는 무시한다 */ }
      });
      signal?.addEventListener("abort", () => { unsubscribe?.(); try { controller.close(); } catch { /* 이미 닫힘 */ } });
    },
    cancel() { unsubscribe?.(); },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

async function route(o: RequestOptions, token: string | null): Promise<unknown> {
  const b: any = o.body ?? {};
  const key = `${o.method} ${o.path}`;
  const path = o.path;

  // ── Public auth ──
  if (key === "POST /api/auth/login") {
    const e: FieldError[] = [];
    const email = str(e, b, "email", 1, 254); const password = str(e, b, "password", 1, 128);
    if (email && !EMAIL.test(email)) e.push({ field: "email", reason: "INVALID_FORMAT" });
    check(e);
    const x = users.find(v => v.email === email!.toLowerCase() && v.password === password);
    if (!x) return fail(401, "INVALID_CREDENTIALS");
    if (x.status !== "ACTIVE") return fail(403, "USER_INACTIVE");
    const exp = new Date(Date.now() + 5 * 60000).toISOString();
    if (x.mfa) return { status: "LOGIN_MFA_REQUIRED", challengeToken: `mfa:${x.userId}`, challengeExpiresAt: exp };
    if (x.companyRole === "ADMIN") return { status: "ADMIN_MFA_BOOTSTRAP_REQUIRED", challengeToken: `boot:${x.userId}`, challengeExpiresAt: exp };
    return { status: "FULL_SESSION", ...session(x) };
  }
  if (key === "POST /api/auth/login/mfa") {
    const x = byId(String(b.challengeToken ?? "").replace(/^mfa:/, ""));
    if (!x || !String(b.challengeToken).startsWith("mfa:")) return fail(401, "AUTH_CHALLENGE_INVALID");
    if (!validCode(b.code)) return fail(401, "MFA_CODE_INVALID");
    return session(x);
  }
  if (key === "POST /api/auth/admin-mfa-bootstrap/enrollment") {
    if (!String(b.challengeToken ?? "").startsWith("boot:")) return fail(401, "AUTH_CHALLENGE_INVALID");
    return secret();
  }
  if (key === "POST /api/auth/admin-mfa-bootstrap/enrollment/confirm") {
    const x = byId(String(b.challengeToken ?? "").replace(/^boot:/, ""));
    if (!x || !String(b.challengeToken).startsWith("boot:")) return fail(401, "AUTH_CHALLENGE_INVALID");
    if (b.code !== MOCK_TOTP) return fail(401, "MFA_CODE_INVALID");
    x.mfa = true; x.version++; markStepUp();
    return { ...session(x), recoveryCodes: recoveryCodes() };
  }
  if (key === "POST /api/auth/refresh") {
    const x = byId(sessionStorage.getItem(SESSION_KEY) ?? "");
    if (!x) return fail(401, "REFRESH_INVALID");
    if (x.status !== "ACTIVE") return fail(403, "USER_INACTIVE");
    return session(x);
  }
  if (key === "POST /api/auth/logout" || key === "POST /api/auth/logout-all") { sessionStorage.removeItem(SESSION_KEY); clearStepUp(); return undefined; }
  if (key === "POST /api/auth/password-resets") {
    const e: FieldError[] = []; const email = str(e, b, "email", 1, 254);
    if (email && !EMAIL.test(email)) e.push({ field: "email", reason: "INVALID_FORMAT" });
    check(e); return undefined;
  }
  if (key === "POST /api/auth/password-resets/complete") {
    const e: FieldError[] = []; str(e, b, "newPassword", 12, 128); check(e);
    if (!String(b.resetToken ?? "").startsWith("reset-")) return fail(401, "PASSWORD_RESET_TOKEN_INVALID");
    return undefined;
  }
  if (key === "POST /api/auth/invitations/accept") {
    const e: FieldError[] = [];
    str(e, b, "invitationToken", 1, 512); str(e, b, "fullName", 1, 100); str(e, b, "displayName", 1, 100); str(e, b, "password", 12, 128); check(e);
    const inv = invitations.get(String(b.invitationToken).replace(/^invite-/, ""));
    if (!inv) return fail(401, "INVITATION_INVALID");
    if (users.some(v => v.email === inv.email)) return fail(409, "EMAIL_UNAVAILABLE");
    const x: MockUser = { userId: crypto.randomUUID(), email: inv.email, password: b.password, fullName: b.fullName, displayName: b.displayName, jobTitle: null, companyRole: "EMPLOYEE", status: "ACTIVE", departmentId: null, teamId: null, version: 1, mfa: false };
    users.push(x); invitations.delete(inv.invitationId);
    return { userId: x.userId };
  }
  if (path.startsWith("/api/auth/company-registrations")) {
    const e: FieldError[] = [];
    if (key.endsWith("/verify-email")) {
      str(e, b, "verificationToken", 1, 512); check(e);
      if (!String(b.verificationToken).startsWith("verify-")) return fail(401, "REGISTRATION_VERIFICATION_INVALID");
      return { challengeToken: "reg-mock", expiresAt: new Date(Date.now() + 600000).toISOString() };
    }
    if (key.endsWith("/complete")) {
      str(e, b, "challengeToken", 1, 512); str(e, b, "adminFullName", 1, 100); str(e, b, "adminDisplayName", 1, 100); str(e, b, "password", 12, 128); check(e);
      if (b.challengeToken !== "reg-mock") return fail(401, "REGISTRATION_CHALLENGE_INVALID");
      return { companyId: crypto.randomUUID(), adminUserId: crypto.randomUUID(), nextAction: "LOGIN" };
    }
    if (key.endsWith("/resend-verification")) { str(e, b, "adminEmail", 1, 254); check(e); return { accepted: true }; }
    str(e, b, "companyName", 2, 100); const adminEmail = str(e, b, "adminEmail", 1, 254);
    if (adminEmail && !EMAIL.test(adminEmail)) e.push({ field: "adminEmail", reason: "Email" });
    check(e);
    if (users.some(x => x.email === adminEmail!.toLowerCase())) return fail(409, "EMAIL_UNAVAILABLE");
    return { accepted: true, verificationExpiresAt: new Date(Date.now() + 600000).toISOString() };
  }

  // ── Bearer routes ──
  const me = principal(token);

  if (key === "POST /api/auth/step-up/challenges") { admin(me); return { challengeToken: `step:${me.userId}`, expiresAt: new Date(Date.now() + 5 * 60000).toISOString() }; }
  if (key === "POST /api/auth/step-up/complete") {
    if (b.challengeToken !== `step:${me.userId}`) return fail(401, "AUTH_CHALLENGE_INVALID");
    if (b.password !== me.password) return fail(401, "INVALID_CREDENTIALS");
    if (!validCode(b.code)) return fail(401, "MFA_CODE_INVALID");
    markStepUp();
    return { accessToken: newToken(me), expiresIn: ACCESS_TTL_MS / 1000 };
  }

  if (key === "GET /api/users/me") return toMe(me);
  if (key === "PUT /api/users/me") {
    const e: FieldError[] = [];
    const displayName = str(e, b, "displayName", 1, 160); const jobTitle = str(e, b, "jobTitle", 0, 160, false); check(e);
    Object.assign(me, { displayName, jobTitle: jobTitle ?? null, version: me.version + 1 });
    return toMe(me);
  }
  if (key === "PUT /api/users/me/password") {
    const e: FieldError[] = []; str(e, b, "currentPassword", 1, 128); str(e, b, "newPassword", 12, 128); check(e);
    if (b.currentPassword !== me.password) return fail(401, "INVALID_CREDENTIALS");
    me.password = b.newPassword; return undefined;
  }
  if (key === "POST /api/users/me/mfa/enrollment") {
    if (b.currentPassword !== me.password) return fail(401, "INVALID_CREDENTIALS");
    if (me.mfa) return fail(409, "MFA_ALREADY_ACTIVE");
    return secret();
  }
  if (key === "POST /api/users/me/mfa/enrollment/confirm") {
    if (b.code !== MOCK_TOTP) return fail(401, "MFA_CODE_INVALID");
    me.mfa = true; me.version++; return { recoveryCodes: recoveryCodes() };
  }
  if (key === "POST /api/users/me/mfa/recovery-codes/use") {
    if (b.code !== MOCK_RECOVERY) return fail(401, "RECOVERY_CODE_INVALID");
    return { used: true, remainingUnusedCodes: 7 };
  }
  if (key === "POST /api/users/me/mfa/recovery-codes/rotate") {
    if (!me.mfa) return fail(403, "MFA_NOT_ACTIVE");
    if (me.companyRole === "ADMIN") stepUp(me);
    return { recoveryCodes: recoveryCodes() };
  }
  if (key === "POST /api/users/me/mfa/disable") {
    if (me.companyRole === "ADMIN") return fail(403, "ACTIVE_ADMIN_MFA_REQUIRED");
    if (b.password !== me.password) return fail(401, "INVALID_CREDENTIALS");
    if (!me.mfa) return fail(409, "MFA_NOT_ACTIVE");
    if (!validCode(b.code)) return fail(401, "MFA_CODE_INVALID");
    me.mfa = false; me.version++; return undefined;
  }

  if (key === "GET /api/organization") {
    return {
      users: users.filter(x => x.status === "ACTIVE")
        .map(x => ({ userId: x.userId, displayName: x.displayName, jobTitle: x.jobTitle, companyRole: x.companyRole, departmentId: x.departmentId, teamId: x.teamId })),
      departments: departments.filter(d => d.status === "ACTIVE").map(({ id, name, status }) => ({ id, name, status })),
      teams: teams.filter(t => t.status === "ACTIVE").map(({ id, departmentId, name, status }) => ({ id, departmentId, name, status })),
    };
  }

  // ── Project / Work / Schedule (02) ──
  if (path.startsWith("/api/admin/projects")) { stepUp(me); return routeProject(o, me); }
  if (path === "/api/projects" || path.startsWith("/api/projects/")) return routeProject(o, me);

  // ── Document / File (03) ──
  if (path.startsWith("/api/admin/documents")) { stepUp(me); return routeDocument(o, me); }
  if (path === "/api/documents" || path.startsWith("/api/documents/") || /^\/api\/meetings\/[^/]+\/(attachments|minutes-template)/.test(path)) return routeDocument(o, me);

  // ── Meeting (04) ──
  if (path.startsWith("/api/admin/meetings") || path === "/api/admin/meeting-settings") { stepUp(me); return routeMeeting(o, me); }
  if (path === "/api/meetings" || path.startsWith("/api/meetings/")) return routeMeeting(o, me);

  // ── Notification (05) ──
  if (path === "/api/notifications" || path.startsWith("/api/notifications/")) return routeNotification(o, me.userId);

  // ── AI (06) ── (실시간 대화 스트림은 mockStream()이 별도로 처리하므로 여기는 JSON 라우트만)
  if (path === "/api/ai/models" || path === "/api/ai/conversations" || path.startsWith("/api/ai/conversations/")) return routeAi(o, me);
  if (path === "/api/admin/ai/settings" && o.method === "PUT") { stepUp(me); return routeAi(o, me); }
  if (path.startsWith("/api/admin/ai/")) { admin(me); return routeAi(o, me); }

  // ── Admin ──
  admin(me);
  if (key === "GET /api/admin/users") {
    const q = o.query ?? {};
    const offset = Number(q.offset ?? 0); const limit = Number(q.limit ?? 20);
    if (!(offset >= 0) || !(limit >= 1 && limit <= 100)) invalid({ field: "limit", reason: "OUT_OF_RANGE" });
    const text = String(q.q ?? "").toLowerCase();
    const rows = users.filter(x =>
      (!q.status || x.status === q.status) && (!q.departmentId || x.departmentId === q.departmentId) && (!q.teamId || x.teamId === q.teamId) &&
      (!text || x.displayName.toLowerCase().includes(text) || x.email.includes(text)));
    return { items: rows.slice(offset, offset + limit).map(toAdmin), page: { offset, limit, total: rows.length } };
  }
  if (key === "POST /api/admin/users/invitations") {
    const e: FieldError[] = []; const email = str(e, b, "email", 1, 254);
    if (email && !EMAIL.test(email)) e.push({ field: "email", reason: "INVALID_FORMAT" });
    check(e);
    const em = email!.toLowerCase();
    if (users.some(x => x.email === em)) return fail(409, "EMAIL_UNAVAILABLE");
    if ([...invitations.values()].some(v => v.email === em)) return fail(409, "INVITATION_ALREADY_ACTIVE");
    const inv: InvitationResponse = { invitationId: crypto.randomUUID(), email: em, status: "ISSUED", expiresAt: new Date(Date.now() + 7 * 86400000).toISOString() };
    invitations.set(inv.invitationId, inv); return inv;
  }
  let m = /^\/api\/admin\/users\/invitations\/([^/]+)(\/resend)?$/.exec(path);
  if (m) {
    const inv = invitations.get(m[1]);
    if (!inv) return fail(404, "INVITATION_NOT_FOUND");
    if (o.method === "DELETE") { invitations.delete(m[1]); return undefined; }
    inv.expiresAt = new Date(Date.now() + 7 * 86400000).toISOString(); return inv;
  }
  m = /^\/api\/admin\/users\/([^/]+)\/(status|company-role|organization|password-reset)$/.exec(path);
  if (m) {
    const target = byId(m[1]);
    if (m[2] === "password-reset") {
      if (!target) return fail(404, "USER_NOT_FOUND");
      if (target.status !== "ACTIVE") return fail(409, "TARGET_USER_INACTIVE");
      return undefined;
    }
    if (m[2] === "status") {
      stepUp(me);
      const e: FieldError[] = [];
      if (b.status !== "ACTIVE" && b.status !== "INACTIVE") e.push({ field: "status", reason: "INVALID_ENUM" });
      if (!["TEMPORARY_SUSPENSION", "EMPLOYMENT_TERMINATION", "ACCOUNT_RETIREMENT", "REACTIVATION", "OTHER_ADMIN_SECURITY_ACTION"].includes(b.reasonClass)) e.push({ field: "reasonClass", reason: "INVALID_ENUM" });
      check(e);
      const row = versioned(target, b, "USER_NOT_FOUND");
      if (row.userId === me.userId) return fail(403, "SELF_STATUS_CHANGE_FORBIDDEN");
      if (row.status === b.status) return fail(409, "USER_STATUS_CONFLICT");
      if (b.status === "INACTIVE" && row.companyRole === "ADMIN" && activeAdmins() <= 1) return fail(409, "LAST_ACTIVE_ADMIN");
      row.status = b.status; row.version++; return toAdmin(row);
    }
    if (m[2] === "company-role") {
      stepUp(me);
      if (b.companyRole !== "ADMIN" && b.companyRole !== "EMPLOYEE") invalid({ field: "companyRole", reason: "INVALID_ENUM" });
      const row = versioned(target, b, "USER_NOT_FOUND");
      if (row.status !== "ACTIVE") return fail(409, "TARGET_USER_INACTIVE");
      if (b.companyRole === "ADMIN" && !row.mfa) return fail(409, "TARGET_MFA_REQUIRED");
      if (b.companyRole === "EMPLOYEE" && row.companyRole === "ADMIN" && activeAdmins() <= 1) return fail(409, "LAST_ACTIVE_ADMIN");
      row.companyRole = b.companyRole; row.version++; return toAdmin(row);
    }
    const e: FieldError[] = []; const job = str(e, b, "jobTitle", 0, 100, false); check(e);
    const row = versioned(target, b, "USER_NOT_FOUND");
    const dept = b.departmentId ? departments.find(d => d.id === b.departmentId) : null;
    const team = b.teamId ? teams.find(t => t.id === b.teamId) : null;
    if (b.departmentId && !dept) return fail(404, "DEPARTMENT_NOT_FOUND");
    if (b.teamId && !team) return fail(404, "TEAM_NOT_FOUND");
    if ((dept && dept.status !== "ACTIVE") || (team && team.status !== "ACTIVE") || (team && dept && team.departmentId !== dept.id) || (team && !dept)) return fail(409, "ORGANIZATION_STATE_CONFLICT");
    Object.assign(row, { departmentId: dept?.id ?? null, teamId: team?.id ?? null, jobTitle: job ?? null, version: row.version + 1 });
    return toAdmin(row);
  }
  if (key === "GET /api/admin/company") return company;
  if (key === "PUT /api/admin/company") {
    const e: FieldError[] = [];
    const displayName = str(e, b, "displayName", 2, 100); const industry = str(e, b, "industry", 0, 100, false);
    const description = str(e, b, "description", 0, 2000, false); const productsServicesSummary = str(e, b, "productsServicesSummary", 0, 2000, false); check(e);
    if (b.version !== company.version) return fail(409, "VERSION_CONFLICT");
    Object.assign(company, { displayName, industry: industry ?? null, description: description ?? null, productsServicesSummary: productsServicesSummary ?? null, version: company.version + 1, updatedAt: new Date().toISOString() });
    return company;
  }

  if (key === "GET /api/admin/departments") return departments;
  if (key === "POST /api/admin/departments") {
    const e: FieldError[] = []; const name = str(e, b, "name", 1, 100); check(e);
    if (departments.some(d => d.name === name && d.status === "ACTIVE")) return fail(409, "DEPARTMENT_NAME_CONFLICT");
    const d: DepartmentResponse = { id: crypto.randomUUID(), name: name!, status: "ACTIVE", version: 1 };
    departments.push(d); return d;
  }
  m = /^\/api\/admin\/departments\/([^/]+)(\/inactivate)?$/.exec(path);
  if (m) {
    const d = versioned(departments.find(v => v.id === m![1]), b, "DEPARTMENT_NOT_FOUND");
    if (m[2]) {
      if (d.status === "INACTIVE") return fail(409, "DEPARTMENT_ALREADY_INACTIVE");
      if (teams.some(t => t.departmentId === d.id && t.status === "ACTIVE") || users.some(x => x.departmentId === d.id && x.status === "ACTIVE")) return fail(409, "ORGANIZATION_STATE_CONFLICT");
      d.status = "INACTIVE"; d.version++; return undefined;
    }
    const e: FieldError[] = []; const name = str(e, b, "name", 1, 100); check(e);
    if (departments.some(v => v !== d && v.name === name && v.status === "ACTIVE")) return fail(409, "DEPARTMENT_NAME_CONFLICT");
    d.name = name!; d.version++; return d;
  }
  if (key === "GET /api/admin/teams") return teams;
  if (key === "POST /api/admin/teams") {
    const e: FieldError[] = []; const name = str(e, b, "name", 1, 100); if (!b.departmentId) e.push({ field: "departmentId", reason: "REQUIRED" }); check(e);
    const d = departments.find(v => v.id === b.departmentId);
    if (!d) return fail(404, "DEPARTMENT_NOT_FOUND");
    if (d.status !== "ACTIVE") return fail(409, "DEPARTMENT_INACTIVE");
    if (teams.some(t => t.departmentId === d.id && t.name === name && t.status === "ACTIVE")) return fail(409, "TEAM_NAME_CONFLICT");
    const t: TeamResponse = { id: crypto.randomUUID(), departmentId: d.id, name: name!, status: "ACTIVE", version: 1 };
    teams.push(t); return t;
  }
  m = /^\/api\/admin\/teams\/([^/]+)(\/inactivate)?$/.exec(path);
  if (m) {
    const t = versioned(teams.find(v => v.id === m![1]), b, "TEAM_NOT_FOUND");
    if (m[2]) {
      if (t.status === "INACTIVE") return fail(409, "TEAM_ALREADY_INACTIVE");
      if (users.some(x => x.teamId === t.id && x.status === "ACTIVE")) return fail(409, "ORGANIZATION_STATE_CONFLICT");
      t.status = "INACTIVE"; t.version++; return undefined;
    }
    const e: FieldError[] = []; const name = str(e, b, "name", 1, 100); check(e);
    const d = departments.find(v => v.id === b.departmentId);
    if (!d) return fail(404, "DEPARTMENT_NOT_FOUND");
    if (d.status !== "ACTIVE") return fail(409, "DEPARTMENT_INACTIVE");
    if (teams.some(v => v !== t && v.departmentId === d.id && v.name === name && v.status === "ACTIVE")) return fail(409, "TEAM_NAME_CONFLICT");
    Object.assign(t, { departmentId: d.id, name, version: t.version + 1 }); return t;
  }

  return fail(404, "NOT_FOUND");
}
