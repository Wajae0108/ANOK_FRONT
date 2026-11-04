// 일정 간격으로 fn을 부르는 폴링 훅. 탭이 숨겨져 있으면 쉬고, 다시 보이면 곧바로 한 번 부른다.
// 이전 호출이 끝나기 전에는 다음 호출을 겹쳐 보내지 않는다. fn의 오류는 호출 쪽이 처리한다(여기서는 삼킨다).
import { useEffect, useRef } from "react";

export function usePoll(fn: () => Promise<unknown> | void, intervalMs: number, active: boolean, deps: unknown[] = []) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!active) return;
    let alive = true;
    let inFlight = false;
    const tick = async () => {
      if (!alive || inFlight || document.hidden) return;
      inFlight = true;
      try { await ref.current(); } catch { /* 폴링 실패는 다음 주기에 다시 시도한다 */ }
      finally { inFlight = false; }
    };
    const iv = setInterval(tick, intervalMs);
    const onVisible = () => { if (!document.hidden) void tick(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { alive = false; clearInterval(iv); document.removeEventListener("visibilitychange", onVisible); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, intervalMs, ...deps]);
}
