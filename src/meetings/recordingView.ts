// 원본 녹음 합본(MP3) 받기 화면 규칙 — FRONTEND_03. 순수 함수만 둬서 화면(RecordingDownload)과 따로 시험한다.
// 상태: CHECKING → READY / NOT_READY / UNAVAILABLE / HIDDEN → (클릭) PROCESSING → DONE | FAILED(재시도 허용)
// 화면에는 화자 수·파일 크기·길이·삭제 시각을 보여 주지 않는다 — 서버가 일부러 주지 않는 값이다.
import type { RecordingAvailabilityResponse } from "../api/meeting";

export type RecordingUi =
  | { kind: "hidden" }                                  // 서버에서 기능이 꺼져 있거나(404 ROUTE_NOT_FOUND) 받을 수 있는 사람이 아니다(403) — 카드를 그리지 않는다
  | { kind: "ready" }
  | { kind: "notice"; tone: "wait" | "off"; text: string; recheck: boolean }; // wait=곧 가능(다시 확인), off=되돌아오지 않음

/** availability 응답 → 화면 상태. 알 수 없는 state는 안전하게 "받을 수 없음"으로 본다. */
export function recordingUiFromAvailability(a: RecordingAvailabilityResponse): RecordingUi {
  if (a.state === "READY") return { kind: "ready" };
  if (a.state === "NOT_READY") return { kind: "notice", tone: "wait", text: "녹음을 정리하는 중입니다. 잠시 뒤 다시 확인해 주세요.", recheck: true };
  if (a.reasonCode === "RECORDING_DOWNLOAD_TOO_LARGE") return { kind: "notice", tone: "off", text: "녹음이 너무 길거나 커서 내려받을 수 없습니다.", recheck: false };
  return { kind: "notice", tone: "off", text: "내려받을 수 없습니다. (원본이 삭제됐거나 보관 기한이 지났습니다)", recheck: false };
}

/** availability 호출 실패 → 화면 상태. 403은 이유를 추측해 보여 주지 않고 카드를 숨긴다. */
export function recordingUiFromError(e: { status: number; errorCode: string }): RecordingUi {
  if (e.errorCode === "ROUTE_NOT_FOUND" || e.status === 403 || e.errorCode === "RECORDING_DOWNLOAD_FORBIDDEN") return { kind: "hidden" };
  if (e.errorCode === "MEETING_NOT_FOUND") return { kind: "hidden" };
  return { kind: "notice", tone: "wait", text: "녹음 상태를 확인하지 못했습니다.", recheck: true };
}

/** download 실패 문구(4-2 표). errorCode로만 분기한다. */
export function recordingDownloadError(e: { status: number; errorCode: string }): { text: string; retry: boolean } {
  switch (e.errorCode) {
    case "RECORDING_DOWNLOAD_FORBIDDEN": return { text: "권한이 없습니다.", retry: false };
    case "MEETING_NOT_FOUND": return { text: "회의를 찾을 수 없습니다.", retry: false };
    case "ROUTE_NOT_FOUND": return { text: "녹음 내려받기를 사용할 수 없습니다.", retry: false };
    case "RECORDING_UNAVAILABLE": return { text: "내려받을 수 없습니다. 원본이 삭제됐거나 보관 기한이 지났습니다. 다시 시도해도 같습니다.", retry: false };
    case "RECORDING_NOT_READY": return { text: "녹음을 정리하는 중입니다. 잠시 후 다시 시도해 주세요.", retry: true };
    case "RECORDING_DOWNLOAD_TOO_LARGE": return { text: "녹음이 너무 커서 내려받을 수 없습니다.", retry: false };
    // 같은 회의를 이미 만드는 중이다 — 자동으로 반복하지 않고 사용자가 다시 누르게 한다(Retry-After 없음).
    case "RECORDING_DOWNLOAD_BUSY": return { text: "이미 파일을 만들고 있습니다. 잠시 후 다시 눌러 주세요.", retry: true };
    case "GATEWAY_RATE_LIMITED": return { text: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.", retry: true };
    case "RECORDING_DOWNLOAD_FAILED": return { text: "문제가 생겨 파일을 만들지 못했습니다. 나중에 다시 시도하고, 계속되면 문의해 주세요.", retry: true };
    case "RECORDING_DOWNLOAD_UNAVAILABLE": return { text: "서버가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해 주세요.", retry: true };
    case "RECORDING_DOWNLOAD_TIMEOUT": return { text: "정해진 시간 안에 파일을 만들지 못했습니다. 다시 시도해 주세요. 반복되면 문의해 주세요(긴 회의일 수 있습니다).", retry: true };
    case "RECORDING_DOWNLOAD_INCOMPLETE": return { text: "파일이 끝까지 오지 않아 저장하지 않았습니다. 다시 시도해 주세요.", retry: true };
    case "NETWORK_ERROR": return { text: "네트워크 오류로 받지 못했습니다. 다시 시도해 주세요.", retry: true };
  }
  return { text: "녹음을 내려받지 못했습니다.", retry: e.status >= 500 || e.status === 0 };
}
