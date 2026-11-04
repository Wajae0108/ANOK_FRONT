// 회의 채팅의 "문서 공유" 메시지. 채팅 API는 글자(text)만 받으므로 문서 ID를 메시지 안에 표식으로 심고, 화면에서 링크 카드로 바꿔 그린다.
//   📎 문서 공유: {제목} [doc:{documentId}]
// 표식을 못 알아보는 곳(예: 다른 클라이언트)에서도 사람이 읽을 수 있는 글자로 남는다.
// 누구든 같은 모양의 글자를 직접 칠 수 있으므로 이 표식을 신뢰하지 않는다 — 열 때는 항상 서버가 문서 권한을 다시 확인하고(없으면 403/404),
// 미리보기 창에는 메시지가 아니라 서버가 준 실제 제목을 보여 준다.
const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const SHARE_RE = new RegExp(`^📎 문서 공유: (.*) \\[doc:(${UUID})\\]$`, "s");
const MAX_TITLE = 160;

export function formatDocShare(title: string, documentId: string): string {
  const clean = title.replace(/[\r\n\u0000-\u001F\u007F]+/g, " ").trim().slice(0, MAX_TITLE) || "문서";
  return `📎 문서 공유: ${clean} [doc:${documentId}]`;
}

export function parseDocShare(text: string): { title: string; documentId: string } | null {
  const m = SHARE_RE.exec(text.trim());
  return m ? { title: m[1], documentId: m[2].toLowerCase() } : null;
}

// 브라우저가 안전하게 그릴 수 있는 형식만 미리본다. HTML·SVG처럼 스크립트가 들어갈 수 있는 형식은 절대 미리보지 않는다.
export type PreviewKind = "pdf" | "image" | "text" | null;
const IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const TEXT_MIME = new Set(["text/plain", "text/csv", "text/markdown"]);
export const PREVIEW_MAX_BYTES = 20 * 1024 * 1024;
export function previewKindOf(mime: string | undefined | null): PreviewKind {
  const m = (mime ?? "").split(";")[0].trim().toLowerCase();
  if (m === "application/pdf") return "pdf";
  if (IMAGE_MIME.has(m)) return "image";
  if (TEXT_MIME.has(m)) return "text";
  return null;
}
