import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { configureSession, refreshSession } from "../api/http";
import { tokenStore } from "../api/tokenStore";
import { getMe, logout as apiLogout } from "../api/identity";
import type { CurrentUserResponse } from "../api/identity";
import StepUpModal from "./StepUpModal";

type Status = "loading" | "anonymous" | "authenticated";

interface AuthContextValue {
  status: Status;
  me: CurrentUserResponse | null;
  sessionExpired: boolean;
  /** 비밀번호를 바꿔 모든 기기의 세션이 폐기되었다 — 로그인 화면에 안내를 띄운다. */
  passwordChanged: boolean;
  establish: (accessToken: string) => Promise<void>;
  reloadMe: () => Promise<void>;
  logout: () => Promise<void>;
  /** 비밀번호 변경 직후: 서버가 모든 기기의 세션과 액세스 토큰을 이미 폐기했으므로 이 기기도 로컬 세션만 지우고 다시 로그인하게 한다. */
  endSessionAfterPasswordChange: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const v = useContext(AuthContext);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [me, setMe] = useState<CurrentUserResponse | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [passwordChanged, setPasswordChanged] = useState(false);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const stepUpWaiter = useRef<Promise<boolean> | null>(null);
  const stepUpResolve = useRef<((ok: boolean) => void) | null>(null);

  const clear = useCallback(() => { tokenStore.set(null); setMe(null); setStatus("anonymous"); }, []);

  useEffect(() => {
    configureSession({
      onExpired: () => { clear(); setSessionExpired(true); },
      onStepUp: () => {
        if (!stepUpWaiter.current) {
          stepUpWaiter.current = new Promise<boolean>(resolve => { stepUpResolve.current = resolve; setStepUpOpen(true); });
        }
        return stepUpWaiter.current;
      },
    });
  }, [clear]);

  // 새로고침 시 HttpOnly Refresh Cookie로 Access JWT를 복구한다. 동시 호출은 single-flight로 합쳐진다.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!(await refreshSession())) { if (alive) setStatus("anonymous"); return; }
        const m = await getMe();
        if (alive) { setMe(m); setStatus("authenticated"); }
      } catch {
        if (alive) clear();
      }
    })();
    return () => { alive = false; };
  }, [clear]);

  const establish = useCallback(async (accessToken: string) => {
    tokenStore.set(accessToken);
    const m = await getMe();
    setMe(m);
    setSessionExpired(false);
    setPasswordChanged(false);
    setStatus("authenticated");
  }, []);

  const reloadMe = useCallback(async () => { setMe(await getMe()); }, []);

  const logout = useCallback(async () => {
    try { await apiLogout(); } catch { /* 서버 실패와 무관하게 로컬 세션은 종료한다 */ }
    clear();
    setSessionExpired(false);
    setPasswordChanged(false);
  }, [clear]);

  const endSessionAfterPasswordChange = useCallback(() => { clear(); setSessionExpired(false); setPasswordChanged(true); }, [clear]);

  const finishStepUp = (ok: boolean) => {
    setStepUpOpen(false);
    stepUpResolve.current?.(ok);
    stepUpResolve.current = null;
    stepUpWaiter.current = null;
  };

  const value = useMemo(() => ({ status, me, sessionExpired, passwordChanged, establish, reloadMe, logout, endSessionAfterPasswordChange }), [status, me, sessionExpired, passwordChanged, establish, reloadMe, logout, endSessionAfterPasswordChange]);

  return (
    <AuthContext.Provider value={value}>
      {children}
      {stepUpOpen && <StepUpModal onDone={finishStepUp} />}
    </AuthContext.Provider>
  );
}
