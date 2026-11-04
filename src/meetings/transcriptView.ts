// 전사문(STT 원문) 화면용 순수 함수: 트랙별로 묶기, 복사·내려받기 글, 오류 문구. 화면(TranscriptPanel)과 분리해 시험한다.
// 원칙: 서버가 준 글자는 고치지 않는다(원문). 화자는 확정하지 않는다 — 트랙을 올린 사람은 "마이크 주인"일 뿐 말한 사람이라는 증거가 아니다.
import type { TranscriptSegmentResponse } from "../api/meeting";

export interface TranscriptGroup { key: string; label: string; publisherId: string | null; segments: TranscriptSegmentResponse[] }

/** 같은 트랙(라벨+올린 사람)의 문장을 순서대로 묶는다. 서버가 준 순서(sequence)는 바꾸지 않는다. */
export function groupByTrack(segments: TranscriptSegmentResponse[]): TranscriptGroup[] {
  const sorted = [...segments].sort((a, b) => a.sequence - b.sequence);
  const groups: TranscriptGroup[] = [];
  let unlabeled = 0;
  for (const s of sorted) {
    const given = s.speakerLabel?.trim() || "";
    const publisher = s.trackPublisherUserId ?? null;
    const key = `${given}|${publisher ?? ""}`;
    let g = groups.find(x => x.key === key);
    // 로컬 모델의 전사문은 라벨이 비어 있다 — 올린 사람(트랙)이 새로 나올 때마다 "음성 트랙 N"으로 번호를 붙인다.
    if (!g) { g = { key, label: given || `음성 트랙 ${++unlabeled}`, publisherId: publisher, segments: [] }; groups.push(g); }
    g.segments.push(s);
  }
  return groups;
}

export const fmtMs = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, "0"), rr = String(r).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${rr}` : `${mm}:${rr}`;
};

/** 트랙 머리글: 올린 사람 이름을 알면 "음성 트랙 1 · 홍길동의 마이크". 말한 사람이 아니라 마이크 주인이다. */
export function trackTitle(g: TranscriptGroup, nameOf: (id?: string | null) => string): string {
  const name = g.publisherId ? nameOf(g.publisherId) : "";
  return name ? `${g.label} · ${name}의 마이크` : g.label;
}

/** 복사·내려받기용 글. 문장 글자는 그대로 두고 트랙 머리글만 붙인다. */
export function transcriptText(groups: TranscriptGroup[], nameOf: (id?: string | null) => string): string {
  return groups.map(g => {
    const body = g.segments.map(s => (s.startMs != null ? `[${fmtMs(s.startMs)}] ` : "") + s.text).join("\n");
    return `[${trackTitle(g, nameOf)}]\n${body}`;
  }).join("\n\n");
}

export type TranscriptState =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "hidden" }                       // 기능이 꺼져 있거나(404 ROUTE_NOT_FOUND) 읽을 권한이 없다(403) — 카드를 아예 보이지 않는다
  | { kind: "notice"; text: string; retry: boolean };

/** 오류 → 화면 상태. 숨길 것과 안내할 것을 나눈다. */
export function transcriptErrorState(e: { status: number; errorCode: string }): TranscriptState {
  if (e.errorCode === "ROUTE_NOT_FOUND" || e.errorCode === "TRANSCRIPT_FORBIDDEN" || e.status === 403) return { kind: "hidden" };
  switch (e.errorCode) {
    case "TRANSCRIPT_NOT_READY": return { kind: "notice", text: "음성 인식이 아직 끝나지 않았습니다. 잠시 뒤 다시 확인해 주세요.", retry: true };
    case "SOURCE_EXPIRED": return { kind: "notice", text: "원본 보관 기한이 지나 음성 원문을 볼 수 없습니다.", retry: false };
    case "TRANSCRIPT_NOT_FOUND": return { kind: "notice", text: "저장된 음성 원문이 없습니다(이미 삭제됐거나 만들어지지 않았습니다).", retry: false };
    case "MEETING_NOT_ENDED": return { kind: "notice", text: "회의가 끝난 뒤에 볼 수 있습니다.", retry: false };
    case "TRANSCRIPT_SOURCE_UNAVAILABLE": return { kind: "notice", text: "음성 원문을 불러오지 못했습니다(AI 서비스가 일시적으로 응답하지 않습니다).", retry: true };
    case "NETWORK_ERROR": return { kind: "notice", text: "네트워크 오류로 불러오지 못했습니다.", retry: true };
  }
  return { kind: "notice", text: "음성 원문을 불러오지 못했습니다.", retry: e.status >= 500 };
}

/** 후처리가 이 단계 이후면 음성 인식이 끝나 전사문이 저장돼 있다. 그 전에는 카드를 띄우지 않는다. */
export const TRANSCRIPT_READY_STATUSES = ["STT_READY", "MINUTES_QUEUED", "MINUTES_PROCESSING", "MINUTES_DRAFT", "REVIEWING", "APPROVED"] as const;
