// Identity(01) 서비스 시나리오: 세션/로그인/MFA/step-up/토큰 갱신/조직 관리.
// 이전에 Claude 세션 스크래치패드에 있던 api-scenario.mts를 저장소로 옮기고 vitest로 연결했다.
import { describe, it, expect } from "vitest";
import * as id from "../src/api/identity";
import * as http from "../src/api/http";
import { tokenStore } from "../src/api/tokenStore";
import { code, createScenario } from "./helpers";

describe("Identity(01) 시나리오", () => {
  it("세션 없음/로그인 실패/MFA/step-up/토큰 갱신/초대/조직 관리가 명세대로 동작한다", async () => {
    const scenario = createScenario();
    const { ok } = scenario;

    let stepUps = 0, expired = 0;
    http.configureSession({
      onExpired: () => { expired++; },
      onStepUp: async () => {
        stepUps++;
        const ch = await id.createStepUpChallenge();
        const r = await id.completeStepUp({ challengeToken: ch.challengeToken, password: "AnokDemo!2026", code: "123456" });
        tokenStore.set(r.accessToken);
        return true;
      },
    });

    // 1) 세션 없음 → refresh 실패
    ok("refresh without session → false", (await http.refreshSession()) === false);
    ok("bearer call without session → 401 + onExpired", (await code(id.getMe())) === "401 TOKEN_INVALID" && expired === 1);

    // 2) 로그인 검증/실패
    ok("login bad password", (await code(id.login({ email: "wonjae@anok.io", password: "x" }))) === "401 INVALID_CREDENTIALS");
    ok("login invalid email → 400 VALIDATION_ERROR", (await code(id.login({ email: "nope", password: "x" }))) === "400 VALIDATION_ERROR");
    const employee = await id.login({ email: "wonjae@anok.io", password: "AnokDemo!2026" });
    ok("employee login → FULL_SESSION", employee.status === "FULL_SESSION");
    tokenStore.set((employee as any).accessToken);
    const meNow = await id.getMe();
    ok("GET /users/me (MeResponse 형태)", meNow.email === "wonjae@anok.io" && meNow.mfaEnabled === false && "companyId" in meNow && !("fullName" in meNow));
    ok("employee → admin API 403 ADMIN_REQUIRED", (await code(id.listAdminUsers())) === "403 ADMIN_REQUIRED");

    // 3) 만료된 access token → 자동 refresh 후 재시도
    tokenStore.set(`mock.${meNow.userId}.${Date.now() - 1000}`);
    ok("expired access token auto-refresh", (await id.getMe()).email === "wonjae@anok.io");

    // 4) 관리자: MFA → 스텝업 → 상태 변경
    const adminLogin = await id.login({ email: "insung@anok.io", password: "AnokDemo!2026" });
    ok("admin login → LOGIN_MFA_REQUIRED", adminLogin.status === "LOGIN_MFA_REQUIRED");
    ok("wrong TOTP", (await code(id.completeLoginMfa({ challengeToken: (adminLogin as any).challengeToken, code: "000000" }))) === "401 MFA_CODE_INVALID");
    const mfa = await id.completeLoginMfa({ challengeToken: (adminLogin as any).challengeToken, code: "123456" });
    tokenStore.set(mfa.accessToken);

    const page = await id.listAdminUsers({ offset: 0, limit: 3 });
    ok("OFFSET page shape", page.items.length === 3 && page.page.offset === 0 && page.page.limit === 3 && page.page.total >= 10);
    const page2 = await id.listAdminUsers({ offset: 3, limit: 3, q: "" });
    ok("second page differs", page2.items[0].userId !== page.items[0].userId);
    ok("limit 0 → 400", (await code(id.listAdminUsers({ limit: 0 }))) === "400 VALIDATION_ERROR");

    const target = (await id.listAdminUsers({ q: "박민준" })).items[0];
    const suspended = await id.updateUserStatus(target.userId, { status: "INACTIVE", reasonClass: "TEMPORARY_SUSPENSION", version: target.version });
    ok("status change triggers step-up once", stepUps === 1 && suspended.status === "INACTIVE" && suspended.version === target.version + 1);
    ok("stale version → 409 VERSION_CONFLICT", (await code(id.updateUserStatus(target.userId, { status: "ACTIVE", reasonClass: "REACTIVATION", version: target.version }))) === "409 VERSION_CONFLICT");
    const admin = (await id.listAdminUsers({ q: "박인성" })).items[0];
    ok("self status change forbidden", (await code(id.updateUserStatus(admin.userId, { status: "INACTIVE", reasonClass: "OTHER_ADMIN_SECURITY_ACTION", version: admin.version }))) === "403 SELF_STATUS_CHANGE_FORBIDDEN");
    const emp = (await id.listAdminUsers({ q: "이원재" })).items[0];
    ok("promote without MFA → 409 TARGET_MFA_REQUIRED", (await code(id.updateUserCompanyRole(emp.userId, { companyRole: "ADMIN", version: emp.version }))) === "409 TARGET_MFA_REQUIRED");

    // 5) 초대 → 수락 → 로그인
    const inv = await id.createInvitation("new.user@anok.io");
    ok("invitation issued", inv.status === "ISSUED");
    ok("duplicate invitation → 409", (await code(id.createInvitation("new.user@anok.io"))) === "409 INVITATION_ALREADY_ACTIVE");
    ok("existing email → 409 EMAIL_UNAVAILABLE", (await code(id.createInvitation("wonjae@anok.io"))) === "409 EMAIL_UNAVAILABLE");
    ok("short password → 400 + fieldErrors", await (async () => {
      try { await id.acceptInvitation({ invitationToken: `invite-${inv.invitationId}`, fullName: "신규", displayName: "신규", password: "short" }); return false; }
      catch (e: any) { return e.status === 400 && e.fieldErrors?.[0]?.field === "password" && e.fieldErrors[0].reason === "Size"; }
    })());
    const accepted = await id.acceptInvitation({ invitationToken: `invite-${inv.invitationId}`, fullName: "신규", displayName: "신규", password: "NewPassword!2026" });
    ok("accept invitation → { userId }", typeof accepted.userId === "string");
    ok("new user can login", (await id.login({ email: "new.user@anok.io", password: "NewPassword!2026" })).status === "FULL_SESSION");

    // 6) 조직
    const dept = await id.createDepartment("영업부");
    ok("create dept", dept.status === "ACTIVE" && dept.version === 1);
    ok("dup dept name", (await code(id.createDepartment("영업부"))) === "409 DEPARTMENT_NAME_CONFLICT");
    const team = await id.createTeam({ departmentId: dept.id, name: "국내영업팀" });
    ok("inactivate dept with active team → 409", (await code(id.inactivateDepartment(dept.id, dept.version))) === "409 ORGANIZATION_STATE_CONFLICT");
    await id.inactivateTeam(team.id, team.version);
    // inactivate는 data 없이 성공만 돌려주므로 목록으로 상태를 확인한다.
    await id.inactivateDepartment(dept.id, dept.version);
    ok("inactivate dept after team", (await id.listDepartments()).find(d => d.id === dept.id)?.status === "INACTIVE");
    const c = await id.getCompany();
    const c2 = await id.updateCompany({ displayName: "(주)아녹", version: c.version });
    ok("company update bumps version", c2.version === c.version + 1);
    ok("company stale version", (await code(id.updateCompany({ displayName: "xx", version: c.version }))) === "409 VERSION_CONFLICT");

    // 7) 로그아웃 → refresh 불가
    await id.logout(); tokenStore.set(null);
    ok("after logout refresh fails", (await http.refreshSession()) === false);

    expect(scenario.fail, scenario.summary()).toBe(0);
  });
});
