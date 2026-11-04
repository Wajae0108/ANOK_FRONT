// 보고서 PDF·Word 내려받기 변환 — 순수 함수만 검증한다(파일 저장·인쇄 창은 브라우저 동작이라 제외).
import { describe, expect, it } from "vitest";
import type { ReportFieldResponse } from "../src/api/meeting";
import { crc32, zipStore } from "../src/meetings/zipStore";
import { formatForTemplate, reportDocumentXml, reportDocxBytes, reportHtml, reportSections } from "../src/meetings/reportExport";
import { safeFileName } from "../src/meetings/download";

const dec = new TextDecoder();

/** 저장(무압축) ZIP을 중앙 디렉터리 기준으로 읽는 시험용 해제기. */
function unzip(bytes: Uint8Array): Record<string, { text: string; crcOk: boolean }> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = bytes.length - 22;
  expect(v.getUint32(eocd, true)).toBe(0x06054b50);
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out: Record<string, { text: string; crcOk: boolean }> = {};
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(p, true)).toBe(0x02014b50);
    const crc = v.getUint32(p + 16, true), size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true), local = v.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    expect(v.getUint32(local, true)).toBe(0x04034b50);
    const dataStart = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const data = bytes.subarray(dataStart, dataStart + size);
    out[name] = { text: dec.decode(data), crcOk: crc32(data) === crc };
    p += 46 + nameLen;
  }
  return out;
}

const F = (o: Partial<ReportFieldResponse> & Pick<ReportFieldResponse, "key" | "label" | "kind">): ReportFieldResponse =>
  ({ source: "AI", filled: true, ...o });

const fields: ReportFieldResponse[] = [
  F({ key: "F01", label: "회의명", kind: "text", value: "베타 <출시> & 점검" }),
  F({ key: "F02", label: "회의 개요", kind: "long_text", value: "첫 줄\n\n셋째 줄" }),
  F({ key: "F03", label: "참석자", kind: "list", value: ["규찬", "인성"] }),
  F({ key: "F04", label: "실행 항목", kind: "table", columns: ["업무", "담당자"], value: [{ 업무: "검증", 담당자: "규찬" }, { 업무: "배포" }] as never }),
  F({ key: "F05", label: "결재", kind: "choice", options: ["승인", "반려"], value: "승인" }),
  F({ key: "F06", label: "서명", kind: "signature", filled: false, source: "HUMAN" }),
  F({ key: "F07", label: "비고", kind: "text", filled: false, value: null }),
];

describe("양식 형식 → 기본 내려받기 형식", () => {
  it("PDF 양식은 pdf, Word 양식은 docx, 이미지·모름은 null", () => {
    expect(formatForTemplate("application/pdf")).toBe("pdf");
    expect(formatForTemplate("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("docx");
    expect(formatForTemplate("application/msword")).toBe("docx");
    expect(formatForTemplate("image/png")).toBeNull();
    expect(formatForTemplate("image/jpeg")).toBeNull();
    expect(formatForTemplate(undefined)).toBeNull();
  });
});

describe("칸 → 문서 블록", () => {
  const s = reportSections(fields);
  it("칸 종류별로 화면과 같은 규칙으로 바뀐다", () => {
    expect(s.map(x => x.label)).toEqual(["회의명", "회의 개요", "참석자", "실행 항목", "결재", "서명", "비고"]);
    expect(s[1].blocks).toEqual([{ type: "text", text: "첫 줄" }, { type: "text", text: "" }, { type: "text", text: "셋째 줄" }]);
    expect(s[2].blocks).toEqual([{ type: "list", items: ["규찬", "인성"] }]);
    expect(s[3].blocks).toEqual([{ type: "table", columns: ["업무", "담당자"], rows: [["검증", "규찬"], ["배포", ""]] }]);
    expect(s[4].blocks).toEqual([{ type: "choice", options: [{ label: "승인", selected: true }, { label: "반려", selected: false }] }]);
    expect(s[5].blocks).toEqual([{ type: "note", text: "서명·결재 칸 — 직접 작성하는 칸입니다." }]);
    expect(s[6].blocks).toEqual([{ type: "note", text: "근거를 찾지 못했거나 아직 채워지지 않았습니다." }]);
  });
  it("사람이 채우는 빈 칸은 그렇게 안내한다", () => {
    const [h] = reportSections([F({ key: "X", label: "x", kind: "text", source: "HUMAN", filled: false })]);
    expect(h.blocks).toEqual([{ type: "note", text: "사람이 채우는 칸입니다." }]);
  });
});

describe("PDF용 HTML", () => {
  const html = reportHtml({ title: "<b>제목</b>", meetingDate: "2026-10-28" }, reportSections(fields));
  it("값의 HTML 특수문자를 모두 이스케이프한다(주입 차단)", () => {
    expect(html).not.toContain("<b>제목</b>");
    expect(html).toContain("&lt;b&gt;제목&lt;/b&gt;");
    expect(html).toContain("베타 &lt;출시&gt; &amp; 점검");
    expect(html).not.toMatch(/<script/i);
  });
  it("표·목록·선택 칸이 들어간다", () => {
    expect(html).toContain("<th>업무</th>");
    expect(html).toContain("<li>규찬</li>");
    expect(html).toContain("☑ 승인");
    expect(html).toContain("☐ 반려");
    expect(html).toContain("회의 일시 2026-10-28");
  });
});

describe("ZIP(저장 방식)", () => {
  it("여러 파일을 묶고 다시 읽으면 내용·CRC가 같다(한글 이름 포함)", () => {
    const z = unzip(zipStore([{ name: "a.txt", data: "안녕" }, { name: "폴더/b.xml", data: new Uint8Array([1, 2, 3, 250]) }]));
    expect(Object.keys(z)).toEqual(["a.txt", "폴더/b.xml"]);
    expect(z["a.txt"].text).toBe("안녕");
    expect(z["a.txt"].crcOk && z["폴더/b.xml"].crcOk).toBe(true);
  });
  it("CRC32 표준 값(\"123456789\" → CBF43926)", () => {
    expect(crc32(new TextEncoder().encode("123456789")).toString(16)).toBe("cbf43926");
  });
});

describe("Word(.docx)", () => {
  const z = unzip(reportDocxBytes({ title: "베타 & 점검", meetingDate: "2026-10-28" }, reportSections(fields)));
  it("Word가 요구하는 최소 구성 파일이 모두 있다", () => {
    expect(Object.keys(z).sort()).toEqual(["[Content_Types].xml", "_rels/.rels", "word/document.xml"]);
    expect(Object.values(z).every(e => e.crcOk)).toBe(true);
    expect(z["[Content_Types].xml"].text).toContain("wordprocessingml.document.main+xml");
    expect(z["_rels/.rels"].text).toContain('Target="word/document.xml"');
  });
  it("본문에 내용이 들어가고 XML 특수문자는 이스케이프된다", () => {
    const x = z["word/document.xml"].text;
    expect(x).toContain("베타 &amp; 점검");
    expect(x).toContain("베타 &lt;출시&gt; &amp; 점검");
    expect(x).toContain("• 규찬");
    expect(x).toContain("☑ 승인");
    expect(x).not.toMatch(/<출시>/);
  });
  it("표는 열 수만큼 격자 열과 머리글 행을 가진다", () => {
    const x = z["word/document.xml"].text;
    expect(x.match(/<w:gridCol /g)?.length).toBe(2);
    expect(x.match(/<w:tr>/g)?.length).toBe(3); // 머리글 + 2행
    expect(x).toContain("<w:sectPr>");
  });
  it("XML에 못 넣는 제어문자는 지운다", () => {
    const x = reportDocumentXml({ title: "a\u0001b" }, []);
    expect(x).toContain(">ab<");
  });
});

describe("파일 이름", () => {
  it("Windows에서 못 쓰는 글자를 지우고, 비면 대체 이름을 쓴다", () => {
    expect(safeFileName('베타: 출시/점검 "회의"?')).toBe("베타 출시 점검 회의");
    expect(safeFileName("///", "보고서")).toBe("보고서");
  });
});
