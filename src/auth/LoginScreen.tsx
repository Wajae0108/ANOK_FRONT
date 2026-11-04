import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  acceptInvitation, completeCompanyRegistration, completeLoginMfa, completePasswordReset, confirmAdminMfaBootstrap, login,
  requestPasswordReset, resendRegistrationVerification, startAdminMfaBootstrap, startCompanyRegistration, verifyRegistrationEmail,
} from "../api/identity";
import type { MfaEnrollmentSecretResponse } from "../api/identity";
import { errorText, fieldErrorMap } from "../api/errors";
import { USE_MOCK } from "../api/config";
import { MOCK_DEMO_ACCOUNTS, MOCK_PASSWORD, MOCK_TOTP } from "../api/mock";
import QrCode from "../ui/QrCode";
import logoFull from "../assets/logo/logo-full.png";
import { useAuth } from "./AuthProvider";

type Mode =
  | { k: "login" }
  | { k: "mfa"; token: string }
  | { k: "bootstrap"; token: string; secret: MfaEnrollmentSecretResponse | null }
  | { k: "recovery"; codes: string[]; accessToken: string }
  | { k: "forgot" }
  | { k: "reset" }
  | { k: "accept" }
  | { k: "register" }
  | { k: "verify" }
  | { k: "regcomplete"; challengeToken: string };

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <div>
      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block mb-1">{label}</label>
      {children}
      {error && <p className="text-[11px] text-rose-500 mt-1">{error}</p>}
    </div>
  );
}
const inputCls = "w-full border border-slate-200 rounded-xl px-3 py-2.5 text-[13px] text-slate-700 outline-none focus:border-indigo-300 transition-colors bg-white";
const primaryCls = "w-full py-3 bg-indigo-500 hover:bg-indigo-600 text-white text-[14px] font-bold rounded-xl transition-colors disabled:opacity-40";
const linkCls = "text-[12px] text-indigo-500 hover:text-indigo-700 font-semibold";

export default function LoginScreen() {
  const { establish, sessionExpired, passwordChanged } = useAuth();
  const [mode, setMode] = useState<Mode>({ k: "login" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [f, setF] = useState({ token: "", fullName: "", displayName: "", password: "" });
  const [company, setCompany] = useState("");

  function go(next: Mode, msg: string | null = null) {
    setMode(next); setError(null); setFields({}); setCode(""); setNotice(msg);
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true); setError(null); setFields({});
    try { await fn(); } catch (e) { setError(errorText(e)); setFields(fieldErrorMap(e)); } finally { setBusy(false); }
  }

  const submitLogin = () => run(async () => {
    const r = await login({ email: email.trim(), password });
    // LoginResponse.status로 분기한다. FULL_SESSION이면 access token을 받고, 나머지는 challengeToken으로 다음 단계를 진행한다.
    if (r.status === "FULL_SESSION") await establish(r.accessToken);
    else if (r.status === "LOGIN_MFA_REQUIRED") go({ k: "mfa", token: r.challengeToken });
    else if (r.status === "ADMIN_MFA_BOOTSTRAP_REQUIRED") go({ k: "bootstrap", token: r.challengeToken, secret: null });
  });

  const submitMfa = (token: string) => run(async () => {
    const r = await completeLoginMfa({ challengeToken: token, code: code.trim() });
    await establish(r.accessToken);
  });

  // MFA 최초 설정 화면 진입 시 enrollment(secret) 발급
  useEffect(() => {
    if (mode.k !== "bootstrap" || mode.secret) return;
    let alive = true;
    startAdminMfaBootstrap(mode.token)
      .then(s => { if (alive) setMode({ k: "bootstrap", token: (mode as { token: string }).token, secret: s }); })
      .catch(e => { if (alive) { setMode({ k: "login" }); setError(errorText(e)); } });
    return () => { alive = false; };
  }, [mode]);

  const submitBootstrap = (token: string) => run(async () => {
    const r = await confirmAdminMfaBootstrap({ challengeToken: token, code: code.trim() });
    go({ k: "recovery", codes: r.recoveryCodes, accessToken: r.accessToken });
  });

  const submitForgot = () => run(async () => {
    await requestPasswordReset(email.trim());
    go({ k: "reset" }, "입력하신 이메일이 등록되어 있다면 재설정 안내를 보냈습니다.");
  });

  const submitReset = () => run(async () => {
    await completePasswordReset({ resetToken: f.token.trim(), newPassword: f.password });
    setPassword("");
    go({ k: "login" }, "비밀번호가 변경되었습니다. 새 비밀번호로 로그인해 주세요.");
  });

  const submitAccept = () => run(async () => {
    await acceptInvitation({ invitationToken: f.token.trim(), fullName: f.fullName.trim(), displayName: f.displayName.trim(), password: f.password });
    go({ k: "login" }, "계정이 생성되었습니다. 로그인해 주세요.");
  });

  // 회사 가입: ① 회사명·관리자 이메일 → ② 메일로 받은 인증 코드 확인 → ③ 관리자 이름·비밀번호로 완료(이후 로그인 → MFA 최초 설정).
  const submitRegister = () => run(async () => {
    await startCompanyRegistration({ companyName: company.trim(), adminEmail: email.trim() });
    go({ k: "verify" }, "입력하신 이메일로 인증 코드를 보냈습니다. 메일의 코드를 입력해 주세요.");
  });
  const submitVerify = () => run(async () => {
    const r = await verifyRegistrationEmail(f.token.trim());
    setF(p => ({ ...p, token: "" }));
    go({ k: "regcomplete", challengeToken: r.challengeToken });
  });
  const resendVerify = () => run(async () => {
    await resendRegistrationVerification(email.trim());
    setNotice("인증 메일을 다시 보냈습니다.");
  });
  const submitRegComplete = (challengeToken: string) => run(async () => {
    await completeCompanyRegistration({ challengeToken, adminFullName: f.fullName.trim(), adminDisplayName: f.displayName.trim(), password: f.password });
    setF({ token: "", fullName: "", displayName: "", password: "" });
    setPassword("");
    go({ k: "login" }, "회사 가입이 완료되었습니다. 관리자 계정으로 로그인하면 MFA 설정을 진행합니다.");
  });

  const title: Record<Mode["k"], string> = {
    register: "회사 가입", verify: "이메일 인증", regcomplete: "관리자 계정 만들기",
    login: "로그인", mfa: "2단계 인증", bootstrap: "관리자 MFA 설정", recovery: "복구 코드 보관",
    forgot: "비밀번호 재설정", reset: "새 비밀번호 설정", accept: "초대 수락",
  };

  return (
    <div className="min-h-full h-full flex items-center justify-center bg-slate-50 p-6 overflow-y-auto">
      <div className="w-full max-w-sm space-y-4 my-auto">
        <div className="flex justify-center">
          <img src={logoFull} alt="Anok — Knowledge flows. Better decisions." className="h-28 w-auto" />
        </div>

        <div className="bg-white border border-slate-100 rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.05)] p-6 space-y-4">
          <p className="text-[16px] font-bold text-slate-900">{title[mode.k]}</p>

          {sessionExpired && mode.k === "login" && (
            <p className="text-[12px] text-amber-600 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">세션이 만료되어 로그아웃되었습니다. 다시 로그인해 주세요.</p>
          )}
          {passwordChanged && mode.k === "login" && (
            <p className="text-[12px] text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2">비밀번호를 바꿨습니다. 보안을 위해 모든 기기에서 로그아웃되었으니 새 비밀번호로 다시 로그인해 주세요. (바로 로그인이 거절되면 1~2초 뒤에 다시 시도해 주세요)</p>
          )}
          {notice && <p className="text-[12px] text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2">{notice}</p>}

          {mode.k === "login" && (
            <form className="space-y-3" onSubmit={e => { e.preventDefault(); submitLogin(); }}>
              <Field label="이메일" error={fields.email}>
                <input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} className={inputCls} placeholder="name@company.com" />
              </Field>
              <Field label="비밀번호" error={fields.password}>
                <input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} className={inputCls} />
              </Field>
              <button type="submit" disabled={busy || !email.trim() || !password} className={primaryCls}>{busy ? "로그인 중..." : "로그인"}</button>
              <div className="flex justify-between">
                <button type="button" onClick={() => go({ k: "forgot" })} className={linkCls}>비밀번호를 잊으셨나요?</button>
                <button type="button" onClick={() => go({ k: "accept" })} className={linkCls}>초대 코드로 가입</button>
              </div>
              <button type="button" onClick={() => go({ k: "register" })} className={linkCls}>새 회사 등록하기</button>
            </form>
          )}

          {mode.k === "mfa" && (
            <form className="space-y-3" onSubmit={e => { e.preventDefault(); submitMfa(mode.token); }}>
              <p className="text-[12px] text-slate-400">인증 앱의 6자리 코드 또는 복구 코드를 입력해 주세요.</p>
              <input value={code} onChange={e => setCode(e.target.value)} autoComplete="one-time-code" className={inputCls} placeholder="6자리 코드 또는 복구 코드" />
              <button type="submit" disabled={busy || !code.trim()} className={primaryCls}>{busy ? "확인 중..." : "확인"}</button>
              <button type="button" onClick={() => go({ k: "login" })} className={linkCls}>처음으로</button>
            </form>
          )}

          {mode.k === "bootstrap" && (
            <div className="space-y-3">
              {!mode.secret ? <p className="text-[12px] text-slate-400">MFA 설정 정보를 준비하고 있습니다...</p> : (
                <form className="space-y-3" onSubmit={e => { e.preventDefault(); submitBootstrap(mode.token); }}>
                  <p className="text-[12px] text-slate-400">관리자 계정은 MFA 설정 후 사용할 수 있습니다. 인증 앱(Google Authenticator 등)으로 QR 코드를 스캔한 뒤 6자리 코드를 입력해 주세요.</p>
                  <QrCode value={mode.secret.otpAuthUri} />
                  <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">QR이 안 될 때 수동 입력 키</p>
                    <p className="text-[13px] font-mono font-bold text-slate-800 break-all select-all">{mode.secret.secret}</p>
                  </div>
                  <input value={code} onChange={e => setCode(e.target.value)} autoComplete="one-time-code" className={inputCls} placeholder="6자리 코드" />
                  <button type="submit" disabled={busy || !code.trim()} className={primaryCls}>{busy ? "확인 중..." : "설정 완료"}</button>
                </form>
              )}
              <button type="button" onClick={() => go({ k: "login" })} className={linkCls}>처음으로</button>
            </div>
          )}

          {mode.k === "recovery" && (
            <div className="space-y-3">
              <p className="text-[12px] text-slate-400">복구 코드는 지금 한 번만 표시됩니다. 안전한 곳에 보관해 주세요.</p>
              <div className="grid grid-cols-2 gap-2 bg-slate-50 border border-slate-200 rounded-xl p-3">
                {mode.codes.map(c => <p key={c} className="text-[12px] font-mono font-semibold text-slate-800 select-all">{c}</p>)}
              </div>
              <button onClick={() => run(() => establish(mode.accessToken))} disabled={busy} className={primaryCls}>{busy ? "시작하는 중..." : "보관했습니다"}</button>
            </div>
          )}

          {mode.k === "forgot" && (
            <form className="space-y-3" onSubmit={e => { e.preventDefault(); submitForgot(); }}>
              <Field label="이메일" error={fields.email}>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={inputCls} placeholder="name@company.com" />
              </Field>
              <button type="submit" disabled={busy || !email.trim()} className={primaryCls}>{busy ? "요청 중..." : "재설정 메일 받기"}</button>
              <div className="flex justify-between">
                <button type="button" onClick={() => go({ k: "login" })} className={linkCls}>로그인으로</button>
                <button type="button" onClick={() => go({ k: "reset" })} className={linkCls}>재설정 코드가 있어요</button>
              </div>
            </form>
          )}

          {mode.k === "reset" && (
            <form className="space-y-3" onSubmit={e => { e.preventDefault(); submitReset(); }}>
              <Field label="재설정 코드" error={fields.resetToken}>
                <input value={f.token} onChange={e => setF(p => ({ ...p, token: e.target.value }))} className={inputCls} placeholder={USE_MOCK ? "reset-아무값" : "메일로 받은 코드"} />
              </Field>
              <Field label="새 비밀번호 (12~128자)" error={fields.newPassword}>
                <input type="password" autoComplete="new-password" value={f.password} onChange={e => setF(p => ({ ...p, password: e.target.value }))} className={inputCls} />
              </Field>
              <button type="submit" disabled={busy || !f.token.trim() || !f.password} className={primaryCls}>{busy ? "변경 중..." : "비밀번호 변경"}</button>
              <button type="button" onClick={() => go({ k: "login" })} className={linkCls}>로그인으로</button>
            </form>
          )}

          {mode.k === "accept" && (
            <form className="space-y-3" onSubmit={e => { e.preventDefault(); submitAccept(); }}>
              <Field label="초대 코드" error={fields.invitationToken}>
                <input value={f.token} onChange={e => setF(p => ({ ...p, token: e.target.value }))} className={inputCls} placeholder="메일로 받은 초대 코드" />
              </Field>
              <Field label="이름" error={fields.fullName}>
                <input value={f.fullName} onChange={e => setF(p => ({ ...p, fullName: e.target.value }))} className={inputCls} placeholder="홍길동" />
              </Field>
              <Field label="표시 이름" error={fields.displayName}>
                <input value={f.displayName} onChange={e => setF(p => ({ ...p, displayName: e.target.value }))} className={inputCls} placeholder="길동" />
              </Field>
              <Field label="비밀번호 (12~128자)" error={fields.password}>
                <input type="password" autoComplete="new-password" value={f.password} onChange={e => setF(p => ({ ...p, password: e.target.value }))} className={inputCls} />
              </Field>
              <button type="submit" disabled={busy || !f.token.trim() || !f.fullName.trim() || !f.displayName.trim() || !f.password} className={primaryCls}>{busy ? "가입 중..." : "계정 만들기"}</button>
              <button type="button" onClick={() => go({ k: "login" })} className={linkCls}>로그인으로</button>
            </form>
          )}

          {mode.k === "register" && (
            <form className="space-y-3" onSubmit={e => { e.preventDefault(); submitRegister(); }}>
              <Field label="회사명 (2~100자)" error={fields.companyName}>
                <input value={company} onChange={e => setCompany(e.target.value)} maxLength={100} className={inputCls} />
              </Field>
              <Field label="관리자 이메일" error={fields.adminEmail}>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} maxLength={254} className={inputCls} placeholder="admin@company.com" />
              </Field>
              <button type="submit" disabled={busy || company.trim().length < 2 || !email.trim()} className={primaryCls}>{busy ? "요청 중..." : "인증 메일 받기"}</button>
              <div className="flex justify-between">
                <button type="button" onClick={() => go({ k: "login" })} className={linkCls}>로그인으로</button>
                <button type="button" onClick={() => go({ k: "verify" })} className={linkCls}>인증 코드가 있어요</button>
              </div>
            </form>
          )}

          {mode.k === "verify" && (
            <form className="space-y-3" onSubmit={e => { e.preventDefault(); submitVerify(); }}>
              <Field label="인증 코드" error={fields.verificationToken}>
                <input value={f.token} onChange={e => setF(p => ({ ...p, token: e.target.value }))} className={inputCls} placeholder="메일로 받은 인증 코드" />
              </Field>
              <button type="submit" disabled={busy || !f.token.trim()} className={primaryCls}>{busy ? "확인 중..." : "인증 확인"}</button>
              <div className="flex justify-between">
                <button type="button" onClick={() => go({ k: "register" })} className={linkCls}>처음으로</button>
                {email.trim() && <button type="button" disabled={busy} onClick={resendVerify} className={linkCls}>인증 메일 다시 받기</button>}
              </div>
            </form>
          )}

          {mode.k === "regcomplete" && (
            <form className="space-y-3" onSubmit={e => { e.preventDefault(); submitRegComplete(mode.challengeToken); }}>
              <Field label="이름" error={fields.adminFullName}>
                <input value={f.fullName} onChange={e => setF(p => ({ ...p, fullName: e.target.value }))} maxLength={100} className={inputCls} placeholder="홍길동" />
              </Field>
              <Field label="표시 이름" error={fields.adminDisplayName}>
                <input value={f.displayName} onChange={e => setF(p => ({ ...p, displayName: e.target.value }))} maxLength={100} className={inputCls} placeholder="길동" />
              </Field>
              <Field label="비밀번호 (12~128자)" error={fields.password}>
                <input type="password" autoComplete="new-password" value={f.password} onChange={e => setF(p => ({ ...p, password: e.target.value }))} maxLength={128} className={inputCls} />
              </Field>
              <button type="submit" disabled={busy || !f.fullName.trim() || !f.displayName.trim() || f.password.length < 12} className={primaryCls}>{busy ? "가입 중..." : "가입 완료"}</button>
              <button type="button" onClick={() => go({ k: "login" })} className={linkCls}>취소</button>
            </form>
          )}

          {error && <p className="text-[12px] text-rose-500 font-medium">{error}</p>}
        </div>

        {USE_MOCK && mode.k === "login" && (
          <div className="bg-white border border-dashed border-slate-200 rounded-2xl p-4 space-y-2">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">mock 서버 데모 계정 (API 미연결)</p>
            <div className="flex flex-wrap gap-1.5">
              {MOCK_DEMO_ACCOUNTS.map(a => (
                <button key={a.email} type="button" onClick={() => { setEmail(a.email); setPassword(MOCK_PASSWORD); }}
                  className="px-2.5 py-1 rounded-lg border border-slate-200 text-[11px] font-semibold text-slate-600 hover:border-indigo-300 hover:text-indigo-600">{a.label}</button>
              ))}
            </div>
            <p className="text-[10px] text-slate-400">비밀번호 {MOCK_PASSWORD} · MFA 코드 {MOCK_TOTP}</p>
          </div>
        )}
      </div>
    </div>
  );
}
