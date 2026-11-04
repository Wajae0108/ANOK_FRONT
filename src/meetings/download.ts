// 브라우저에서 파일 저장·복사·PDF 인쇄. 서버에서 파일을 받지 않고 화면에 있는 내용으로 파일을 만들 때 쓴다.

/** 파일 이름에 못 쓰는 글자를 지운다(Windows 기준). 비면 fallback. */
export function safeFileName(name: string, fallback = "download"): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return cleaned || fallback;
}

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function saveText(text: string, filename: string, mime = "text/plain"): void {
  // BOM을 붙여 메모장 등에서 한글이 깨지지 않게 한다.
  saveBlob(new Blob(["﻿", text], { type: `${mime};charset=utf-8` }), filename);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* 권한 거부 등 — 아래 대체 방법으로 */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch { return false; }
}

/** 숨은 iframe에 HTML을 넣고 인쇄 창을 연다 — 대상에서 "PDF로 저장"을 고르면 PDF가 된다(한글 글꼴은 브라우저가 처리). */
export function printHtml(html: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    const cleanup = () => setTimeout(() => iframe.remove(), 1000);
    iframe.onload = () => {
      const win = iframe.contentWindow;
      if (!win) { cleanup(); reject(new Error("인쇄 창을 열 수 없습니다.")); return; }
      try {
        win.addEventListener("afterprint", cleanup, { once: true });
        win.focus(); win.print();
        setTimeout(cleanup, 120_000); // afterprint가 안 오는 브라우저 대비
        resolve();
      } catch (e) { cleanup(); reject(e); }
    };
    iframe.srcdoc = html;
    document.body.appendChild(iframe);
  });
}
