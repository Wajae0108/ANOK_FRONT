// AI 스트림 하나만 "활성"으로 추적한다. 스코프/프로젝트 전환, 다른 대화 선택, 새 대화 시작,
// 컴포넌트 언마운트 시 이 컨트롤러의 cancel()/start()를 호출하면 이전 스트림이 정리되고,
// 그 이후 도착하는 delta/완료/오류 콜백은 "이 스트림이 아직 활성 세대인가"를 확인해 무시한다.
//
// sendAiMessage()가 돌려주는 stop()은 signal.aborted 체크가 있는 지점까지만 이벤트 발행을 막을 뿐이고
// (src/api/ai.ts:71-119, mock 쪽은 src/api/mockAi.ts의 for-loop 안 aborted 체크 지점들),
// 그 체크 지점 사이에 이미 큐잉된 이벤트 하나 정도는 abort 이후에도 도착할 수 있다. 세대(generation)
// 비교는 그 레이스와 무관하게 "지금 이 콜백이 여전히 최신 요청의 것인가"를 판정하므로 stop() 호출만으로는
// 막지 못하는 경우까지 커버한다.
//
// 주의: 이 취소는 브라우저 쪽 fetch/EventSource 연결을 끊는 것이지, 실제 서버의 LLM 생성이나 과금까지
// 즉시 멈춘다는 보장은 아니다(§실서버 확인 필요, 최종 보고 참고). 명세에 없는 서버 취소 API는 만들지 않았다.
import * as ai from "../api/ai";
import type { AiStreamHandlers } from "../api/ai";

type SendBody = Parameters<typeof ai.sendAiMessage>[1];

export interface AiStreamController {
  /** 새 스트림을 시작한다. 진행 중인 스트림이 있으면 먼저 취소한다. */
  start(conversationId: string, body: SendBody, handlers: AiStreamHandlers): void;
  /** 사용자 의도적 중단(또는 화면 전환/언마운트)으로 현재 스트림을 취소한다. 이미 끝난 스트림이면 아무 일도 하지 않는다. */
  cancel(): void;
  /** 아직 완료/취소되지 않은 스트림이 있는지. */
  readonly active: boolean;
}

export function createAiStreamController(): AiStreamController {
  let generation = 0;
  let activeStop: (() => void) | null = null;

  function cancel() {
    generation++; // 이 시점부터 이전 스트림의 모든 콜백은 isCurrent()에서 false가 된다.
    const stop = activeStop;
    activeStop = null;
    stop?.();
  }

  function start(conversationId: string, body: SendBody, handlers: AiStreamHandlers) {
    cancel(); // 이전 요청의 정리(cancel)가 지금 시작하는 요청의 activeStop을 건드리지 않도록 먼저 끝낸다.
    const myGeneration = generation;
    const isCurrent = () => myGeneration === generation;
    const handle = ai.sendAiMessage(conversationId, body, {
      onStarted: e => { if (isCurrent()) handlers.onStarted?.(e); },
      onSource: e => { if (isCurrent()) handlers.onSource?.(e); },
      onDelta: t => { if (isCurrent()) handlers.onDelta?.(t); },
      onCompleted: e => { if (!isCurrent()) return; activeStop = null; handlers.onCompleted?.(e); },
      onError: e => { if (!isCurrent()) return; activeStop = null; handlers.onError?.(e); },
    });
    activeStop = handle.stop;
  }

  return { start, cancel, get active() { return activeStop !== null; } };
}
