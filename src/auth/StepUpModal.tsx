import { useState } from "react";
import { completeStepUp, createStepUpChallenge } from "../api/identity";
import { errorText } from "../api/errors";
import { tokenStore } from "../api/tokenStore";
import { USE_MOCK } from "../api/config";
import { MOCK_PASSWORD, MOCK_TOTP } from "../api/mock";

// API-09/10: 사용자 상태·회사 권한 변경 같은 고위험 ADMIN 작업 직전 비밀번호 + MFA로 재인증한다.
export default function StepUpModal({ onDone }: { onDone: (ok: boolean) => void }) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const ch = await createStepUpChallenge();
      const res = await completeStepUp({ challengeToken: ch.challengeToken, password, code: code.trim() });
      tokenStore.set(res.accessToken);
      onDone(true);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[300] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <div>
          <p className="text-[15px] font-bold text-slate-900">추가 본인 확인</p>
          <p className="text-[12px] text-slate-400 mt-1">보안이 필요한 관리자 작업입니다. 비밀번호와 인증 코드를 다시 입력해 주세요.</p>
        </div>
        <div>
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block mb-1">비밀번호</label>
          <input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)}
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-[13px] outline-none focus:border-indigo-300" />
        </div>
        <div>
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block mb-1">인증 코드 또는 복구 코드</label>
          <input value={code} onChange={e => setCode(e.target.value)} autoComplete="one-time-code" inputMode="text"
            placeholder="6자리 코드 또는 복구 코드"
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-[13px] outline-none focus:border-indigo-300" />
        </div>
        {USE_MOCK && <p className="text-[10px] text-slate-400">mock: 비밀번호 {MOCK_PASSWORD} / 코드 {MOCK_TOTP}</p>}
        {error && <p className="text-[12px] text-rose-500 font-medium">{error}</p>}
        <div className="flex gap-2">
          <button onClick={() => onDone(false)} disabled={busy} className="flex-1 py-2.5 border border-slate-200 text-slate-500 text-[13px] font-semibold rounded-xl hover:bg-slate-50 disabled:opacity-40">취소</button>
          <button onClick={submit} disabled={busy || !password || !code.trim()}
            className="flex-1 py-2.5 bg-indigo-500 hover:bg-indigo-600 text-white text-[13px] font-bold rounded-xl disabled:opacity-40">
            {busy ? "확인 중..." : "확인"}
          </button>
        </div>
      </div>
    </div>
  );
}
