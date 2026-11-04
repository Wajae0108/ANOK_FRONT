// 양식 위에 채운 보고서 파일 내려받기(양식기능_PDF_Word_전체정리 2.6·2.7) — 파일 이름 파싱, 응답 헤더, 오류 문구, mock 경로.
import { describe, expect, it } from "vitest";
import { parseFilename } from "../src/api/http";
import * as meeting from "../src/api/meeting";
import * as doc from "../src/api/document";
import { putMeetingTemplateFile } from "../src/api/mockTemplate";
import { pdfPartialNotice, reportFileErrorText, templateUploadErrorText } from "../src/meetings/reportFileText";
import { loginAs } from "./helpers";

describe("Content-Disposition 파일 이름", () => {
  it("filename*(한글, 퍼센트 인코딩)를 ASCII filename보다 우선한다 — 서버가 실제로 보내는 형태", () => {
    const cd = `attachment; filename="meeting-report.docx"; filename*=UTF-8''${encodeURIComponent("베타 점검_보고서.docx")}`;
    expect(parseFilename(cd)).toBe("베타 점검_보고서.docx");
  });
  it("filename*가 앞에 와도, filename만 있어도 읽는다", () => {
    expect(parseFilename(`attachment; filename*=UTF-8''%EB%B3%B4%EA%B3%A0%EC%84%9C.pdf; filename="x.pdf"`)).toBe("보고서.pdf");
    expect(parseFilename(`attachment; filename="meeting-report.pdf"`)).toBe("meeting-report.pdf");
    expect(parseFilename(`attachment; filename=plain.pdf`)).toBe("plain.pdf");
  });
  it("없거나 깨졌으면 download", () => {
    expect(parseFilename(null)).toBe("download");
    expect(parseFilename("attachment")).toBe("download");
  });
});

describe("오류 문구(2.7)", () => {
  it("문서의 코드마다 사용자가 할 일을 안내한다", () => {
    const codes = ["REPORT_FORM_NOT_PDF", "REPORT_FORM_UNREADABLE", "REPORT_FORM_LAYOUT_UNKNOWN", "TEMPLATE_CONTENT_GONE", "REPORT_NOT_READY",
      "CUSTOM_REPORT_NOT_FOUND", "REPORT_PDF_UNAVAILABLE", "TEMPLATE_SOURCE_UNAVAILABLE", "ROUTE_NOT_FOUND", "NETWORK_ERROR"];
    const texts = codes.map(c => reportFileErrorText({ status: 0, errorCode: c }));
    expect(new Set(texts).size).toBeGreaterThan(8);              // 코드별로 다른 문구
    expect(texts.every(t => t.length > 10)).toBe(true);
    expect(reportFileErrorText({ status: 409, errorCode: "REPORT_FORM_NOT_PDF" })).toContain("PNG·JPG");
    expect(reportFileErrorText({ status: 422, errorCode: "REPORT_FORM_UNREADABLE" })).toContain("다른 양식");
  });
  it("모르는 코드는 상태 코드로 일반 문구", () => {
    expect(reportFileErrorText({ status: 404, errorCode: "WHATEVER" })).toContain("꺼져 있거나");
    expect(reportFileErrorText({ status: 503, errorCode: "WHATEVER" })).toContain("불안정");
    expect(reportFileErrorText({ status: 500, errorCode: "WHATEVER" })).toContain("받지 못했습니다");
  });
  it("PDF가 일부 값을 못 넣거나 잘랐을 때만 알린다", () => {
    expect(pdfPartialNotice(0, 0)).toBeNull();
    expect(pdfPartialNotice(2, 0)).toContain("넣지 못한 값 2개");
    expect(pdfPartialNotice(0, 3)).toContain("잘린 값 3개");
    expect(pdfPartialNotice(1, 1)).toMatch(/1개.*1개/);
  });
  it("양식 업로드 거절 사유(2.2)", () => {
    expect(templateUploadErrorText({ status: 400, errorCode: "FILE_TYPE_NOT_ALLOWED" })).toContain("변경 추적");
    expect(templateUploadErrorText({ status: 409, errorCode: "FILE_SECURITY_BLOCKED" })).toContain("보안");
    expect(templateUploadErrorText({ status: 413, errorCode: "MINUTES_TEMPLATE_TOO_LARGE" })).toContain("10MB");
    expect(templateUploadErrorText({ status: 413, errorCode: "OTHER" })).toContain("10MB");
    expect(templateUploadErrorText({ status: 403, errorCode: "MEETING_ATTACHMENT_FORBIDDEN" })).toContain("검토 담당자");
    expect(templateUploadErrorText({ status: 503, errorCode: "FILE_VALIDATION_UNAVAILABLE" })).toContain("검사");
    expect(templateUploadErrorText({ status: 500, errorCode: "X" })).toBeNull(); // 모르는 코드는 서버 메시지를 쓰게
  });
});

describe("업로드 형식", () => {
  it("Word(.docx)를 받는다 — 서버 설정이 꺼져 있으면 서버가 FILE_TYPE_NOT_ALLOWED로 거절한다", () => {
    expect(doc.MINUTES_TEMPLATE_ACCEPT).toContain(doc.DOCX_MIME);
    expect(doc.MINUTES_TEMPLATE_ACCEPT).toContain(".docx");
    expect(doc.MINUTES_TEMPLATE_ACCEPT).toContain("application/pdf");
    expect(doc.MINUTES_TEMPLATE_MAX_BYTES).toBe(10_485_760);
  });
});

// mock 서버(VITE_API_BASE_URL이 비어 있을 때의 mock 계층)에 양식 종류별로 양식을 심어 두고 실제 호출 함수로 받아 본다.
// 실제 서버 응답 형태는 문서(2.6)의 시험 로그 헤더(Content-Disposition의 filename*, x-report-pdf-unplaced/cut)를 따른다.
const plant = (meetingId: string, filename: string, mimeType: string) =>
  putMeetingTemplateFile({ meetingId, filename, mimeType, sizeBytes: 100, sha256: `h-${meetingId}`, uploadedAt: new Date().toISOString() });
const head = async (b: Blob, n: number) => new Uint8Array(await b.slice(0, n).arrayBuffer());

describe("양식 파일 내려받기(downloadCustomReportFile)", () => {
  it("PDF 양식 → PDF 파일, 한글 이름(filename*)과 못 넣은·잘린 값 개수", async () => {
    await loginAs("wonjae@anok.io");
    plant("m-pdf", "주간회의_양식.pdf", "application/pdf");
    const r = await meeting.downloadCustomReportFile("m-pdf");
    expect(r.filename).toBe("주간회의_양식_보고서.pdf");
    expect(r.unplaced).toBe(0);
    expect(r.cut).toBe(0);
    expect(Array.from(await head(r.blob, 4))).toEqual([0x25, 0x50, 0x44, 0x46]); // %PDF
  });
  it("Word 양식 → Word 파일(ZIP/PK), 개수 헤더는 없어 0", async () => {
    await loginAs("wonjae@anok.io");
    plant("m-docx", "결과보고서.docx", doc.DOCX_MIME);
    const r = await meeting.downloadCustomReportFile("m-docx");
    expect(r.filename).toBe("결과보고서_보고서.docx");
    expect(r.unplaced + r.cut).toBe(0);
    expect(Array.from(await head(r.blob, 2))).toEqual([0x50, 0x4b]);
  });
  it("PNG·JPG 양식은 409 REPORT_FORM_NOT_PDF — 화면은 이 코드로 '정리본'을 안내한다", async () => {
    await loginAs("wonjae@anok.io");
    plant("m-png", "스캔.png", "image/png");
    await expect(meeting.downloadCustomReportFile("m-png")).rejects.toMatchObject({ status: 409, errorCode: "REPORT_FORM_NOT_PDF" });
  });
  it("양식·보고서가 없으면 404 CUSTOM_REPORT_NOT_FOUND", async () => {
    await loginAs("wonjae@anok.io");
    await expect(meeting.downloadCustomReportFile("m-none")).rejects.toMatchObject({ status: 404, errorCode: "CUSTOM_REPORT_NOT_FOUND" });
  });
});
