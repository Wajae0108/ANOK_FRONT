// 기본 보고서의 후속 업무 선택(includeFollowUpActions / includeNextSteps) — 요청 본문 규칙.
import { describe, expect, it } from "vitest";
import { customReportBody } from "../src/api/meeting";

const date = "2026-10-20";

describe("보고서 요청 본문의 후속 업무 선택", () => {
  it("기본 보고서: 고른 true/false를 그대로 보낸다", () => {
    expect(customReportBody({ hasTemplate: false, meetingDate: date, includeFollowUpActions: false, includeNextSteps: true }))
      .toEqual({ hasTemplate: false, meetingDate: date, includeFollowUpActions: false, includeNextSteps: true });
  });
  it("기본 보고서: 고르지 않았으면(undefined) 필드를 아예 보내지 않는다 — 서버 기본값을 따른다", () => {
    expect(customReportBody({ hasTemplate: false, meetingDate: date })).toEqual({ hasTemplate: false, meetingDate: date });
  });
  it("회사 양식: 서버가 400 NOT_ALLOWED로 거절하므로 선택값을 본문에서 뺀다", () => {
    const b = customReportBody({ hasTemplate: true, meetingDate: date, includeFollowUpActions: false, includeNextSteps: true });
    expect(b).toEqual({ hasTemplate: true, meetingDate: date });
    expect("includeFollowUpActions" in b).toBe(false);
  });
});
