// 보고서(칸 목록)를 PDF·Word 문서로 내려받기 위한 변환. 서버는 보고서를 파일로 주지 않고 칸(label·kind·value)만 주므로
// 화면에 있는 내용으로 파일을 만든다. 업로드한 양식 파일 위에 직접 채우지는 못한다(칸 위치 정보가 없다) — 양식의 칸 순서대로 정리한 문서가 된다.
//   · PDF  : 인쇄용 HTML을 만들어 브라우저 인쇄 창("PDF로 저장")으로 보낸다. 한글 글꼴은 브라우저가 처리한다.
//   · Word : 외부 라이브러리 없이 최소 .docx(ZIP+XML)를 만든다(zipStore.ts).
import type { ReportFieldResponse } from "../api/meeting";
import { zipStore } from "./zipStore";

export type ExportFormat = "pdf" | "docx";

/** 올린 양식의 형식에 맞춰 기본으로 권할 내려받기 형식. 이미지(PNG·JPG)이거나 모르면 null — 둘 다 같은 비중으로 보여 준다. */
export function formatForTemplate(mimeType?: string | null): ExportFormat | null {
  const m = (mimeType ?? "").toLowerCase();
  if (m === "application/pdf") return "pdf";
  if (m.includes("wordprocessingml") || m === "application/msword") return "docx";
  return null;
}

export type Block =
  | { type: "text"; text: string }
  | { type: "note"; text: string }
  | { type: "list"; items: string[] }
  | { type: "table"; columns: string[]; rows: string[][] }
  | { type: "choice"; options: { label: string; selected: boolean }[] };
export interface Section { label: string; blocks: Block[] }
export interface ReportMeta { title: string; meetingDate?: string; completedAt?: string | null }

const cell = (v: unknown) => (v == null ? "" : String(v));

/** 화면(FieldValue)과 같은 규칙으로 칸 하나를 문서 블록으로 바꾼다. */
export function reportSections(fields: ReportFieldResponse[]): Section[] {
  return fields.map(f => {
    const v = f.value;
    let blocks: Block[];
    if (f.kind === "signature") blocks = [{ type: "note", text: "서명·결재 칸 — 직접 작성하는 칸입니다." }];
    else if (!f.filled || v == null) blocks = [{ type: "note", text: f.source === "HUMAN" ? "사람이 채우는 칸입니다." : "근거를 찾지 못했거나 아직 채워지지 않았습니다." }];
    else if (f.kind === "list" && Array.isArray(v)) blocks = [{ type: "list", items: (v as unknown[]).map(cell) }];
    else if (f.kind === "table" && Array.isArray(v)) {
      const columns = f.columns ?? [];
      blocks = [{ type: "table", columns, rows: (v as Record<string, unknown>[]).map(r => columns.map(c => cell(r?.[c]))) }];
    } else if (f.kind === "choice") blocks = [{ type: "choice", options: (f.options ?? []).map(o => ({ label: o, selected: o === v })) }];
    else blocks = cell(v).replace(/\r\n?/g, "\n").split("\n").map(line => ({ type: "text" as const, text: line }));
    return { label: f.label, blocks };
  });
}

// ─────────────────────────────── PDF (인쇄용 HTML) ───────────────────────────────
const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function reportHtml(meta: ReportMeta, sections: Section[]): string {
  const body = sections.map(s => {
    const blocks = s.blocks.map(b => {
      switch (b.type) {
        case "note": return `<p class="note">${escHtml(b.text)}</p>`;
        case "text": return b.text.trim() ? `<p>${escHtml(b.text)}</p>` : `<p class="gap">&nbsp;</p>`;
        case "list": return `<ul>${b.items.map(i => `<li>${escHtml(i)}</li>`).join("")}</ul>`;
        case "choice": return `<p>${b.options.map(o => `${o.selected ? "☑" : "☐"} ${escHtml(o.label)}`).join("&nbsp;&nbsp;&nbsp;")}</p>`;
        case "table": return `<table><thead><tr>${b.columns.map(c => `<th>${escHtml(c)}</th>`).join("")}</tr></thead><tbody>${b.rows.map(r => `<tr>${r.map(c => `<td>${escHtml(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
      }
    }).join("");
    return `<section><h2>${escHtml(s.label)}</h2>${blocks}</section>`;
  }).join("");
  const sub = [meta.meetingDate && `회의 일시 ${meta.meetingDate}`, meta.completedAt && `작성 ${meta.completedAt}`].filter(Boolean).join(" · ");
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${escHtml(meta.title)}</title><style>
@page { size: A4; margin: 18mm 16mm; }
* { box-sizing: border-box; }
body { font-family: "Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif; color: #111; font-size: 11pt; line-height: 1.6; margin: 0; }
h1 { font-size: 18pt; margin: 0 0 4px; }
.sub { color: #666; font-size: 9.5pt; margin: 0 0 18px; }
section { margin: 0 0 14px; break-inside: avoid-page; }
h2 { font-size: 10.5pt; color: #444; border-bottom: 1px solid #ccc; padding-bottom: 3px; margin: 0 0 6px; }
p { margin: 0 0 4px; white-space: pre-wrap; word-break: break-word; }
p.note { color: #888; }
p.gap { margin: 0; }
ul { margin: 0 0 4px; padding-left: 20px; }
table { width: 100%; border-collapse: collapse; margin: 2px 0 4px; font-size: 10pt; }
th, td { border: 1px solid #bbb; padding: 4px 6px; text-align: left; vertical-align: top; word-break: break-word; }
th { background: #f0f0f0; }
tr { break-inside: avoid; }
</style></head><body><h1>${escHtml(meta.title)}</h1>${sub ? `<p class="sub">${escHtml(sub)}</p>` : ""}${body}</body></html>`;
}

// ─────────────────────────────── Word (.docx) ───────────────────────────────
// XML에 못 들어가는 제어문자를 지우고 특수문자를 이스케이프한다.
const escXml = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const FONT = "맑은 고딕";
const fontXml = `<w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:eastAsia="${FONT}" w:cs="${FONT}"/>`;

function run(text: string, o: { bold?: boolean; size?: number; color?: string } = {}): string {
  const rpr = `<w:rPr>${fontXml}${o.bold ? "<w:b/>" : ""}${o.color ? `<w:color w:val="${o.color}"/>` : ""}<w:sz w:val="${o.size ?? 22}"/><w:szCs w:val="${o.size ?? 22}"/></w:rPr>`;
  return `<w:r>${rpr}<w:t xml:space="preserve">${escXml(text)}</w:t></w:r>`;
}
function para(text: string, o: { bold?: boolean; size?: number; color?: string; indent?: boolean; before?: number; after?: number } = {}): string {
  const ppr = `<w:pPr><w:spacing w:before="${o.before ?? 0}" w:after="${o.after ?? 60}"/>${o.indent ? '<w:ind w:left="360" w:hanging="240"/>' : ""}</w:pPr>`;
  return `<w:p>${ppr}${run(text, o)}</w:p>`;
}
function table(columns: string[], rows: string[][]): string {
  const n = Math.max(columns.length, 1);
  const w = Math.floor(9638 / n);
  const border = (side: string) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="BBBBBB"/>`;
  const tc = (t: string, head: boolean) =>
    `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${head ? '<w:shd w:val="clear" w:color="auto" w:fill="F0F0F0"/>' : ""}</w:tcPr>${para(t, { bold: head, size: 20, after: 0 })}</w:tc>`;
  const tr = (cells: string[], head: boolean) => `<w:tr>${cells.map(c => tc(c, head)).join("")}</w:tr>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="${w * n}" w:type="dxa"/><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map(border).join("")}</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr>` +
    `<w:tblGrid>${columns.map(() => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>${tr(columns, true)}${rows.map(r => tr(columns.map((_, i) => r[i] ?? ""), false)).join("")}</w:tbl>${para("", { after: 0 })}`;
}

export function reportDocumentXml(meta: ReportMeta, sections: Section[]): string {
  const sub = [meta.meetingDate && `회의 일시 ${meta.meetingDate}`, meta.completedAt && `작성 ${meta.completedAt}`].filter(Boolean).join(" · ");
  const parts: string[] = [para(meta.title, { bold: true, size: 36, after: 60 })];
  if (sub) parts.push(para(sub, { size: 19, color: "666666", after: 240 }));
  for (const s of sections) {
    parts.push(para(s.label, { bold: true, size: 22, color: "444444", before: 160, after: 60 }));
    for (const b of s.blocks) {
      if (b.type === "note") parts.push(para(b.text, { color: "888888" }));
      else if (b.type === "text") parts.push(para(b.text));
      else if (b.type === "list") b.items.forEach(i => parts.push(para(`• ${i}`, { indent: true, after: 30 })));
      else if (b.type === "choice") parts.push(para(b.options.map(o => `${o.selected ? "☑" : "☐"} ${o.label}`).join("    ")));
      else parts.push(table(b.columns, b.rows));
    }
  }
  const sect = `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${parts.join("")}${sect}</w:body></w:document>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export function reportDocxBytes(meta: ReportMeta, sections: Section[]): Uint8Array {
  return zipStore([
    { name: "[Content_Types].xml", data: CONTENT_TYPES },
    { name: "_rels/.rels", data: ROOT_RELS },
    { name: "word/document.xml", data: reportDocumentXml(meta, sections) },
  ]);
}
