import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  acceptInvitation, completeLoginMfa, completePasswordReset, confirmAdminMfaBootstrap, login,
  requestPasswordReset, startAdminMfaBootstrap,
} from "../api/identity";
import type { FactorType, MfaEnrollmentSecretResponse } from "../api/identity";
import { errorText, fieldErrorMap } from "../api/errors";
import { USE_MOCK } from "../api/config";
import { MOCK_DEMO_ACCOUNTS, MOCK_PASSWORD, MOCK_TOTP } from "../api/mock";
import { useAuth } from "./AuthProvider";

type Mode =
  | { k: "login" }
  | { k: "mfa"; token: string }
  | { k: "bootstrap"; token: string; secret: MfaEnrollmentSecretResponse | null }
  | { k: "recovery"; codes: string[]; accessToken: string }
  | { k: "forgot" }
  | { k: "reset" }
  | { k: "accept" };

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
  const { establish, sessionExpired } = useAuth();
  const [mode, setMode] = useState<Mode>({ k: "login" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [factorType, setFactorType] = useState<FactorType>("TOTP");
  const [code, setCode] = useState("");
  const [f, setF] = useState({ token: "", fullName: "", displayName: "", password: "" });

  function go(next: Mode, msg: string | null = null) {
    setMode(next); setError(null); setFields({}); setCode(""); setNotice(msg);
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true); setError(null); setFields({});
    try { await fn(); } catch (e) { setError(errorText(e)); setFields(fieldErrorMap(e)); } finally { setBusy(false); }
  }

  const submitLogin = () => run(async () => {
    const r = await login({ email: email.trim(), password });
    if (r.type === "SESSION") await establish(r.accessToken);
    else if (r.type === "MFA_REQUIRED") go({ k: "mfa", token: r.challengeToken });
    else if (r.type === "ADMIN_MFA_BOOTSTRAP_REQUIRED") go({ k: "bootstrap", token: r.challengeToken, secret: null });
  });

  const submitMfa = (token: string) => run(async () => {
    const r = await completeLoginMfa({ challengeToken: token, factorType, factorCode: code.trim() });
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

  const submitBootstrap = (token: string, enrollmentId: string) => run(async () => {
    const r = await confirmAdminMfaBootstrap({ challengeToken: token, enrollmentId, totpCode: code.trim() });
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

  const title: Record<Mode["k"], string> = {
    login: "로그인", mfa: "2단계 인증", bootstrap: "관리자 MFA 설정", recovery: "복구 코드 보관",
    forgot: "비밀번호 재설정", reset: "새 비밀번호 설정", accept: "초대 수락",
  };

  return (
    <div className="min-h-full h-full flex items-center justify-center bg-slate-50 p-6 overflow-y-auto">
      <div className="w-full max-w-sm space-y-4 my-auto">
        <div className="flex items-center gap-3 justify-center">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#6366f1,#4f6ef7)" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
          <p className="text-[20px] font-extrabold text-slate-900 tracking-tight">Anok</p>
        </div>

        <div className="bg-white border border-slate-100 rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.05)] p-6 space-y-4">
          <p className="text-[16px] font-bold text-slate-900">{title[mode.k]}</p>

          {sessionExpired && mode.k === "login" && (
            <p className="text-[12px] text-amber-600 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">세션이 만료되어 로그아웃되었습니다. 다시 로그인해 주세요.</p>
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
            </form>
          )}

          {mode.k === "mfa" && (
            <form className="space-y-3" onSubmit={e => { e.preventDefault(); submitMfa(mode.token); }}>
              <p className="text-[12px] text-slate-400">인증 앱의 6자리 코드 또는 복구 코드를 입력해 주세요.</p>
              <div className="flex gap-2">
                {(["TOTP", "RECOVERY_CODE"] as const).map(t => (
                  <button key={t} type="button" onClick={() => setFactorType(t)}
                    className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold border ${factorType === t ? "bg-indigo-500 text-white border-indigo-500" : "border-slate-200 text-slate-500"}`}>
                    {t === "TOTP" ? "인증 앱 코드" : "복구 코드"}
                  </button>
                ))}
              </div>
              <input value={code} onChange={e => setCode(e.target.value)} autoComplete="one-time-code" className={inputCls} placeholder={factorType === "TOTP" ? "123456" : "복구 코드"} />
              <button type="submit" disabled={busy || !code.trim()} className={primaryCls}>{busy ? "확인 중..." : "확인"}</button>
              <button type="button" onClick={() => go({ k: "login" })} className={linkCls}>처음으로</button>
            </form>
          )}

          {mode.k === "bootstrap" && (
            <div className="space-y-3">
              {!mode.secret ? <p className="text-[12px] text-slate-400">MFA 설정 정보를 준비하고 있습니다...</p> : (
                <form className="space-y-3" onSubmit={e => { e.preventDefault(); submitBootstrap(mode.token, mode.secret!.enrollmentId); }}>
                  <p className="text-[12px] text-slate-400">관리자 계정은 MFA 설정 후 사용할 수 있습니다. 인증 앱에 아래 키를 등록하고 6자리 코드를 입력해 주세요.</p>
                  <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">수동 입력 키</p>
                    <p className="text-[13px] font-mono font-bold text-slate-800 break-all select-all">{mode.secret.manualKey}</p>
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
