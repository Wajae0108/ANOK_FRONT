// 7개 시나리오 스위트가 공유하는 로그인/보조 유틸. 이전에는 Claude 세션 스크래치패드의 각 스크립트에
// 거의 동일한 코드로 중복돼 있었다 — 저장소로 옮기면서 한 번만 정의한다.
import { ApiError } from "../src/api/errors";
import * as idn from "../src/api/identity";
import { tokenStore } from "../src/api/tokenStore";

export const DEMO_PASSWORD = "AnokDemo!2026";

export const code = async (p: Promise<unknown>) => {
  try { await p; return "OK"; }
  catch (e) { return e instanceof ApiError ? `${e.status} ${e.errorCode}` : String(e); }
};

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export function makeFile(name: string, content: string, type = "text/plain") {
  return new File([content], name, { type });
}

// 비-MFA 계정 로그인(FULL_SESSION을 바로 기대). 로그인 응답에는 user가 없어 /users/me로 조회한다.
export async function loginAs(email: string, password = DEMO_PASSWORD) {
  const r = await idn.login({ email, password });
  if (r.status !== "FULL_SESSION") throw new Error(`unexpected login result ${r.status} for ${email}`);
  tokenStore.set(r.accessToken);
  return idn.getMe();
}
// 관리자 계정 로그인(LOGIN_MFA_REQUIRED를 기대하고 통과).
export async function loginAdmin(email: string) {
  const r = await idn.login({ email, password: DEMO_PASSWORD });
  if (r.status !== "LOGIN_MFA_REQUIRED") throw new Error(`expected LOGIN_MFA_REQUIRED for ${email}`);
  const s = await idn.completeLoginMfa({ challengeToken: r.challengeToken, code: "123456" });
  tokenStore.set(s.accessToken);
  return idn.getMe();
}
// MFA 여부를 몰라도 되는 범용 로그인(일부 데모 계정은 MFA가 켜져 있다).
export async function loginSmart(email: string) {
  const r = await idn.login({ email, password: DEMO_PASSWORD });
  if (r.status === "LOGIN_MFA_REQUIRED") {
    const s = await idn.completeLoginMfa({ challengeToken: r.challengeToken, code: "123456" });
    tokenStore.set(s.accessToken);
    return idn.getMe();
  }
  if (r.status !== "FULL_SESSION") throw new Error(`unexpected login result ${r.status} for ${email}`);
  tokenStore.set(r.accessToken);
  return idn.getMe();
}
// 이미 관리자 세션인 상태에서 step-up만 완료.
export async function stepUpAdmin() {
  const ch = await idn.createStepUpChallenge();
  const su = await idn.completeStepUp({ challengeToken: ch.challengeToken, password: DEMO_PASSWORD, code: "123456" });
  tokenStore.set(su.accessToken);
}
// organization directory 응답엔 email이 없어 관리자 목록으로 역조회한다.
export async function userIdByEmailAdmin(email: string) {
  const page = await idn.listAdminUsers({ limit: 100 });
  const u = page.items.find((x: any) => x.email === email);
  if (!u) throw new Error(`admin: user not found ${email}`);
  return u.userId as string;
}

// 시나리오 하나(한 개의 it 블록) 안에서 다건 소프트 단언을 모아 마지막에 한 번에 판정한다.
// 기존 스크립트의 "전부 실행 후 실패 개수 출력" 동작을 유지하면서 vitest expect로 연결한다.
export function createScenario() {
  let pass = 0;
  const failures: string[] = [];
  const ok = (name: string, cond: boolean, extra = "") => {
    if (cond) pass++;
    else failures.push(extra ? `${name} ${extra}` : name);
  };
  return {
    ok,
    get pass() { return pass; },
    get fail() { return failures.length; },
    get failures() { return failures; },
    summary() {
      return `${pass} passed, ${failures.length} failed` + (failures.length ? `\nFAILED:\n- ${failures.join("\n- ")}` : "");
    },
  };
}
