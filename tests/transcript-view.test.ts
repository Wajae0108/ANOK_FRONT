// 전사문(STT 원문) 화면 규칙 — 트랙별 묶기, 원문 보존, 복사 글, 오류→화면 상태, 그리고 mock 서버를 통한 실제 호출.
import { describe, expect, it } from "vitest";
import type { TranscriptSegmentResponse } from "../src/api/meeting";
import { fmtMs, groupByTrack, transcriptErrorState, transcriptText, trackTitle, TRANSCRIPT_READY_STATUSES } from "../src/meetings/transcriptView";

const seg = (sequence: number, text: string, label: string | null, pub: string | null, startMs: number | null = null): TranscriptSegmentResponse =>
  ({ sequence, text, speakerLabel: label, trackPublisherUserId: pub, speakerBasis: "UNKNOWN", startMs, endMs: null, timePrecision: "FILE_ONLY" });
const nameOf = (id?: string | null) => ({ u1: "홍길동", u2: "" } as Record<string, string>)[id ?? ""] ?? "";

describe("트랙별 묶기", () => {
  const segs = [seg(2, "셋", "음성 트랙 1", "u1"), seg(0, "하나", "음성 트랙 1", "u1"), seg(1, "둘", "음성 트랙 2", "u2")];
  it("sequence 순으로 정렬해 같은 트랙끼리 묶고 서버 글자는 그대로 둔다", () => {
    const g = groupByTrack(segs);
    expect(g.map(x => x.label)).toEqual(["음성 트랙 1", "음성 트랙 2"]);
    expect(g[0].segments.map(s => s.text)).toEqual(["하나", "셋"]);
    expect(g[1].segments.map(s => s.text)).toEqual(["둘"]);
  });
  it("원본 배열을 바꾸지 않는다", () => {
    const copy = [...segs];
    groupByTrack(segs);
    expect(segs).toEqual(copy);
  });
  it("라벨이 비어 있으면(로컬 모델) 올린 사람별로 '음성 트랙 N'을 번호 붙인다", () => {
    const g = groupByTrack([seg(0, "a", null, "u1"), seg(1, "b", null, "u2"), seg(2, "c", null, "u1"), seg(3, "d", "  ", null)]);
    expect(g.map(x => x.label)).toEqual(["음성 트랙 1", "음성 트랙 2", "음성 트랙 3"]);
    expect(g[0].segments.map(s => s.text)).toEqual(["a", "c"]);
  });
});

describe("머리글 — 말한 사람이 아니라 마이크 주인", () => {
  const g = groupByTrack([seg(0, "a", "음성 트랙 1", "u1"), seg(1, "b", "음성 트랙 2", "u2"), seg(2, "c", "음성 트랙 3", null)]);
  it("이름을 알면 '…의 마이크', 모르면 라벨만", () => {
    expect(trackTitle(g[0], nameOf)).toBe("음성 트랙 1 · 홍길동의 마이크");
    expect(trackTitle(g[1], nameOf)).toBe("음성 트랙 2");
    expect(trackTitle(g[2], nameOf)).toBe("음성 트랙 3");
    expect(trackTitle(g[0], nameOf)).not.toMatch(/발언자|말한/);
  });
});

describe("복사·내려받기 글", () => {
  it("문장은 그대로, 시간이 있으면 앞에 붙고, 트랙 머리글로 나뉜다", () => {
    const g = groupByTrack([seg(0, "안녕하세요.  (공백 두 칸)", "음성 트랙 1", "u1", 65_000), seg(1, "두 번째", "음성 트랙 1", "u1"), seg(2, "다른 트랙", "음성 트랙 2", "u2")]);
    expect(transcriptText(g, nameOf)).toBe("[음성 트랙 1 · 홍길동의 마이크]\n[1:05] 안녕하세요.  (공백 두 칸)\n두 번째\n\n[음성 트랙 2]\n다른 트랙");
  });
  it("시각 표기", () => {
    expect(fmtMs(0)).toBe("0:00");
    expect(fmtMs(65_000)).toBe("1:05");
    expect(fmtMs(3_725_000)).toBe("1:02:05");
  });
});

describe("오류 → 화면 상태", () => {
  it("기능이 꺼졌거나(404 ROUTE_NOT_FOUND) 권한이 없으면(403) 카드를 숨긴다", () => {
    expect(transcriptErrorState({ status: 404, errorCode: "ROUTE_NOT_FOUND" }).kind).toBe("hidden");
    expect(transcriptErrorState({ status: 403, errorCode: "TRANSCRIPT_FORBIDDEN" }).kind).toBe("hidden");
    expect(transcriptErrorState({ status: 403, errorCode: "ANY" }).kind).toBe("hidden");
  });
  it("나머지는 안내하고, 다시 시도가 의미 있는 것만 버튼을 준다", () => {
    const n = (code: string, status = 409) => transcriptErrorState({ status, errorCode: code }) as { kind: "notice"; text: string; retry: boolean };
    expect(n("TRANSCRIPT_NOT_READY")).toMatchObject({ kind: "notice", retry: true });
    expect(n("SOURCE_EXPIRED")).toMatchObject({ kind: "notice", retry: false });
    expect(n("TRANSCRIPT_NOT_FOUND", 404).retry).toBe(false);
    expect(n("TRANSCRIPT_SOURCE_UNAVAILABLE", 503).retry).toBe(true);
    expect(n("NETWORK_ERROR", 0).retry).toBe(true);
    expect(n("WHATEVER", 500).retry).toBe(true);
    expect(n("WHATEVER", 400).retry).toBe(false);
    expect(n("SOURCE_EXPIRED").text).toContain("보관 기한");
  });
  it("음성 인식이 끝난 단계에서만 요청한다", () => {
    expect(TRANSCRIPT_READY_STATUSES).toContain("MINUTES_DRAFT");
    expect(TRANSCRIPT_READY_STATUSES).not.toContain("STT_PROCESSING");
    expect(TRANSCRIPT_READY_STATUSES).not.toContain("FAILED");
  });
});
