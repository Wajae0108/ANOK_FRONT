// 회의 채팅의 문서 공유 메시지(docShare)와 미리보기 허용 목록.
import { describe, expect, it } from "vitest";
import { formatDocShare, parseDocShare, previewKindOf } from "../src/meetings/docShare";

const ID = "8f2920d7-d7f6-4367-8795-d2859fc50733";

describe("문서 공유 메시지", () => {
  it("만든 메시지를 그대로 다시 읽을 수 있다", () => {
    const text = formatDocShare("설계 초안 v2", ID);
    expect(text).toBe(`📎 문서 공유: 설계 초안 v2 [doc:${ID}]`);
    expect(parseDocShare(text)).toEqual({ title: "설계 초안 v2", documentId: ID });
  });

  it("제목의 줄바꿈·제어문자는 공백으로 바뀌고, 긴 제목은 160자로 잘린다", () => {
    const text = formatDocShare("첫 줄\n둘째 줄\u0007끝", ID);
    expect(text).not.toMatch(/[\n\u0007]/);
    expect(parseDocShare(formatDocShare("가".repeat(500), ID))?.title).toHaveLength(160);
    expect(parseDocShare(formatDocShare("   ", ID))?.title).toBe("문서");
  });

  it("제목에 대괄호나 [doc:...] 비슷한 글자가 있어도 마지막 표식의 ID만 쓴다", () => {
    const evil = "다른 문서 [doc:00000000-0000-4000-8000-000000000000]";
    expect(parseDocShare(formatDocShare(evil, ID))?.documentId).toBe(ID);
  });

  it("형식이 다르거나 UUID가 아니면 일반 채팅으로 본다", () => {
    expect(parseDocShare("안녕하세요")).toBeNull();
    expect(parseDocShare("📎 문서 공유: 제목 [doc:not-a-uuid]")).toBeNull();
    expect(parseDocShare(`그냥 말하다가 📎 문서 공유: 제목 [doc:${ID}] 뒤에 글자`)).toBeNull();
    expect(parseDocShare(`[문서 공유] 제목`)).toBeNull(); // 예전 형식
  });

  it("ID는 소문자로 정규화된다", () => {
    expect(parseDocShare(`📎 문서 공유: 제목 [doc:${ID.toUpperCase()}]`)?.documentId).toBe(ID);
  });
});

describe("미리보기 허용 형식", () => {
  it("PDF·이미지·텍스트만 미리본다", () => {
    expect(previewKindOf("application/pdf")).toBe("pdf");
    expect(previewKindOf("image/png")).toBe("image");
    expect(previewKindOf("image/jpeg; charset=binary")).toBe("image");
    expect(previewKindOf("text/plain")).toBe("text");
    expect(previewKindOf("TEXT/CSV")).toBe("text");
  });

  it("스크립트가 들어갈 수 있는 형식은 절대 미리보지 않는다", () => {
    for (const m of ["text/html", "image/svg+xml", "application/xhtml+xml", "application/javascript", "text/javascript", "application/octet-stream", "application/zip"]) {
      expect(previewKindOf(m), m).toBeNull();
    }
    expect(previewKindOf(undefined)).toBeNull();
    expect(previewKindOf("")).toBeNull();
  });
});
