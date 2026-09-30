import { useState } from "react";
import type { ReactNode } from "react";
import {
  changeMyPassword, confirmMfaEnrollment, disableMfa, rotateRecoveryCodes, startMfaEnrollment, updateMe,
} from "../api/identity";
import type { MfaEnrollmentSecretResponse } from "../api/identity";
import { ApiError, errorText, fieldErrorMap } from "../api/errors";
import { useAuth } from "./AuthProvider";

type Tab = "프로필" | "비밀번호" | "MFA";
const inputCls = "w-full border border-slate-200 rounded-xl px-3 py-2.5 text-[13px] text-slate-700 outline-none focus:border-indigo-300 transition-colors bg-white";
const btnCls = "px-4 py-2.5 bg-indigo-500 hover:bg-indigo-600 text-white text-[13px] font-bold rounded-xl transition-colors disabled:opacity-40";

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <div>
      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block mb-1">{label}</label>
      {children}
      {error && <p className="text-[11px] text-rose-500 mt-1">{error}</p>}
    </div>
  );
}

// API-17~24: 내 프로필/비밀번호/MFA. 백엔드 응답이 `version`을 주지 않으면 프로필 수정은 서버 계약과 맞지 않는다(명세 확인 필요).
export default function MyAccountModal({ onClose }: { onClose: () => void }) {
  const { me, reloadMe } = useAuth();
  const [tab, setTab] = useState<Tab>("프로필");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const [profile, setProfile] = useState({ fullName: me?.fullName ?? "", displayName: me?.displayName ?? "", jobTitle: me?.jobTitle ?? "" });
  const [pw, setPw] = useState({ current: "", next: "" });
  const [mfaPw, setMfaPw] = useState("");
  const [secret, setSecret] = useState<MfaEnrollmentSecretResponse | null>(null);
  const [totp, setTotp] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [reason, setReason] = useState("");

  if (!me) return null;

  async function run(fn: () => Promise<void>, success?: string) {
    setBusy(true); setError(null); setOk(null); setFields({});
    try { await fn(); if (success) setOk(success); }
    catch (e) {
      setError(errorText(e)); setFields(fieldErrorMap(e));
      if (e instanceof ApiError && e.errorCode === "VERSION_CONFLICT") await reloadMe().catch(() => undefined);
    } finally { setBusy(false); }
  }

  const saveProfile = () => run(async () => {
    await updateMe({ fullName: profile.fullName.trim(), displayName: profile.displayName.trim(), jobTitle: profile.jobTitle.trim() || null, version: me.version ?? 0 });
    await reloadMe();
  }, "프로필을 저장했습니다.");

  const savePassword = () => run(async () => {
    await changeMyPassword({ currentPassword: pw.current, newPassword: pw.next });
    setPw({ current: "", next: "" });
  }, "비밀번호를 변경했습니다.");

  const startEnroll = () => run(async () => { setSecret(await startMfaEnrollment(mfaPw)); setMfaPw(""); });
  const confirmEnroll = () => run(async () => {
    const r = await confirmMfaEnrollment({ enrollmentId: secret!.enrollmentId, totpCode: totp.trim() });
    setCodes(r.recoveryCodes); setSecret(null); setTotp("");
    await reloadMe();
  });
  const rotate = () => run(async () => { setCodes((await rotateRecoveryCodes()).recoveryCodes); });
  const disable = () => run(async () => {
    await disableMfa({ currentPassword: mfaPw, reason: reason.trim() || undefined });
    setMfaPw(""); setReason(""); await reloadMe();
  }, "MFA를 해제했습니다.");

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[200] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <p className="text-[15px] font-bold text-slate-900">내 계정</p>
            <p className="text-[11px] text-slate-400">{me.email}</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="flex px-5 border-b border-slate-100">
          {(["프로필", "비밀번호", "MFA"] as const).map(t => (
            <button key={t} onClick={() => { setTab(t); setError(null); setOk(null); setFields({}); }}
              className={`px-3 py-2.5 text-[13px] font-semibold border-b-2 ${tab === t ? "border-indigo-500 text-indigo-600" : "border-transparent text-slate-400"}`}>{t}</button>
          ))}
        </div>

        <div className="p-5 space-y-4">
          {tab === "프로필" && (
            <>
              <Field label="이름" error={fields.fullName}><input value={profile.fullName} onChange={e => setProfile(p => ({ ...p, fullName: e.target.value }))} className={inputCls} /></Field>
              <Field label="표시 이름" error={fields.displayName}><input value={profile.displayName} onChange={e => setProfile(p => ({ ...p, displayName: e.target.value }))} className={inputCls} /></Field>
              <Field label="직무" error={fields.jobTitle}><input value={profile.jobTitle} onChange={e => setProfile(p => ({ ...p, jobTitle: e.target.value }))} className={inputCls} /></Field>
              <p className="text-[11px] text-slate-400">소속 부서/팀은 회사 관리자가 변경합니다.</p>
              <button onClick={saveProfile} disabled={busy || !profile.fullName.trim() || !profile.displayName.trim()} className={btnCls}>{busy ? "저장 중..." : "저장"}</button>
            </>
          )}

          {tab === "비밀번호" && (
            <>
              <Field label="현재 비밀번호" error={fields.currentPassword}><input type="password" autoComplete="current-password" value={pw.current} onChange={e => setPw(p => ({ ...p, current: e.target.value }))} className={inputCls} /></Field>
              <Field label="새 비밀번호 (12~128자)" error={fields.newPassword}><input type="password" autoComplete="new-password" value={pw.next} onChange={e => setPw(p => ({ ...p, next: e.target.value }))} className={inputCls} /></Field>
              <button onClick={savePassword} disabled={busy || !pw.current || !pw.next} className={btnCls}>{busy ? "변경 중..." : "비밀번호 변경"}</button>
            </>
          )}

          {tab === "MFA" && (
            <>
              <p className="text-[13px] font-semibold text-slate-800">2단계 인증: <span className={me.mfa.enabled ? "text-emerald-600" : "text-slate-400"}>{me.mfa.enabled ? "사용 중" : "사용 안 함"}</span></p>

              {codes && (
                <div className="space-y-2">
                  <p className="text-[12px] text-slate-400">복구 코드는 지금 한 번만 표시됩니다. 안전한 곳에 보관해 주세요.</p>
                  <div className="grid grid-cols-2 gap-2 bg-slate-50 border border-slate-200 rounded-xl p-3">
                    {codes.map(c => <p key={c} className="text-[12px] font-mono font-semibold text-slate-800 select-all">{c}</p>)}
                  </div>
                  <button onClick={() => setCodes(null)} className="text-[12px] text-indigo-500 font-semibold">보관했습니다</button>
                </div>
              )}

              {!me.mfa.enabled && !secret && !codes && (
                <>
                  <Field label="현재 비밀번호" error={fields.currentPassword}><input type="password" value={mfaPw} onChange={e => setMfaPw(e.target.value)} className={inputCls} /></Field>
                  <button onClick={startEnroll} disabled={busy || !mfaPw} className={btnCls}>MFA 설정 시작</button>
                </>
              )}
              {secret && (
                <>
                  <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">수동 입력 키</p>
                    <p className="text-[13px] font-mono font-bold text-slate-800 break-all select-all">{secret.manualKey}</p>
                  </div>
                  <Field label="인증 코드" error={fields.totpCode}><input value={totp} onChange={e => setTotp(e.target.value)} autoComplete="one-time-code" className={inputCls} placeholder="6자리 코드" /></Field>
                  <button onClick={confirmEnroll} disabled={busy || !totp.trim()} className={btnCls}>설정 완료</button>
                </>
              )}

              {me.mfa.enabled && !codes && (
                <div className="space-y-3">
                  <button onClick={rotate} disabled={busy} className="px-4 py-2.5 border border-slate-200 text-slate-600 text-[13px] font-semibold rounded-xl hover:bg-slate-50 disabled:opacity-40">복구 코드 재발급</button>
                  {me.companyRole === "ADMIN" ? (
                    <p className="text-[11px] text-slate-400">관리자 계정은 MFA를 해제할 수 없습니다.</p>
                  ) : (
                    <div className="space-y-2 pt-2 border-t border-slate-100">
                      <Field label="현재 비밀번호" error={fields.currentPassword}><input type="password" value={mfaPw} onChange={e => setMfaPw(e.target.value)} className={inputCls} /></Field>
                      <Field label="해제 사유 (선택)" error={fields.reason}><input value={reason} onChange={e => setReason(e.target.value)} className={inputCls} /></Field>
                      <button onClick={disable} disabled={busy || !mfaPw} className="px-4 py-2.5 border border-rose-200 text-rose-500 text-[13px] font-semibold rounded-xl hover:bg-rose-50 disabled:opacity-40">MFA 해제</button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {ok && <p className="text-[12px] text-emerald-600 font-medium">{ok}</p>}
          {error && <p className="text-[12px] text-rose-500 font-medium">{error}</p>}
        </div>
      </div>
    </div>
  );
}
