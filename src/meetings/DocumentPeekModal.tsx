// 회의 중 채팅에 공유된 문서를 화면 이동 없이 바로 본다. 회의방(음성 연결) 위에 떠서 닫으면 그대로 회의로 돌아온다.
// 권한은 서버가 확인한다: 회의 자료로 붙은 문서는 참가자가 읽을 수 있다(VIEWER, 상속). 못 읽으면 403/404 안내가 뜬다.
// PDF·이미지·텍스트만 미리보고(docShare.previewKindOf), 나머지는 다운로드만 준다. 20MB를 넘으면 미리보기 없이 다운로드만 한다.
import { useEffect, useState } from "react";
import * as doc from "../api/document";
import type { DocumentResponse } from "../api/document";
import { errorText } from "../api/errors";
import { useEscape } from "../ui/kit";
import { fmtSize, PermissionBadge, triggerBrowserDownload } from "../documents/shared";
import { PREVIEW_MAX_BYTES, previewKindOf } from "./docShare";
import type { PreviewKind } from "./docShare";

type View =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; doc: DocumentResponse; kind: PreviewKind; url?: string; text?: string; blob?: Blob; filename: string; tooBig: boolean };

export default function DocumentPeekModal({ documentId, onClose, onOpenDetail }: {
  documentId: string; onClose: () => void;
  /** 문서 상세 화면으로 이동한다(회의를 떠난다). 회의방 안에서는 주지 않는다. */
  onOpenDetail?: (documentId: string) => void;
}) {
  const [view, setView] = useState<View>({ state: "loading" });
  const [busy, setBusy] = useState(false);
  useEscape(onClose);

  useEffect(() => {
    let alive = true;
    let objectUrl: string | undefined;
    setView({ state: "loading" });
    (async () => {
      try {
        const d = await doc.getDocument(documentId);
        if (!alive) return;
        const mime = d.currentVersion.detectedMimeType;
        const kind = previewKindOf(mime);
        const tooBig = d.currentVersion.sizeBytes > PREVIEW_MAX_BYTES;
        if (!kind || tooBig) { setView({ state: "ready", doc: d, kind: null, filename: d.currentVersion.originalFilename, tooBig }); return; }
        const { blob, filename } = await doc.downloadCurrentVersion(documentId);
        if (!alive) return;
        // 서버가 준 Content-Type이 아니라 서버가 내용으로 판단한 형식(detectedMimeType)으로 다시 감싼다 — 허용 목록 밖 형식이 렌더되지 않게.
        const typed = new Blob([blob], { type: mime });
        if (kind === "text") {
          setView({ state: "ready", doc: d, kind, text: (await typed.text()).slice(0, 200_000), blob: typed, filename, tooBig });
        } else {
          objectUrl = URL.createObjectURL(typed);
          setView({ state: "ready", doc: d, kind, url: objectUrl, blob: typed, filename, tooBig });
        }
      } catch (e) { if (alive) setView({ state: "error", message: errorText(e) }); }
    })();
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [documentId]);

  async function download() {
    if (view.state !== "ready") return;
    setBusy(true);
    try {
      const { blob, filename } = view.blob ? { blob: view.blob, filename: view.filename } : await doc.downloadCurrentVersion(documentId);
      triggerBrowserDownload(blob, filename);
    } catch (e) { setView({ state: "error", message: errorText(e) }); }
    finally { setBusy(false); }
  }

  return (
    // 회의방 오버레이(z-300) 위에 떠야 한다.
    <div className="fixed inset-0 z-[400] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="공유된 문서" onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden">
        <div className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-slate-100">
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-bold text-slate-900 truncate">{view.state === "ready" ? view.doc.title : "공유된 문서"}</p>
            {view.state === "ready" && <p className="text-[11px] text-slate-400 truncate">{view.doc.currentVersion.originalFilename} · {fmtSize(view.doc.currentVersion.sizeBytes)}</p>}
          </div>
          {view.state === "ready" && <PermissionBadge permission={view.doc.effectivePermission} />}
          {view.state === "ready" && <button disabled={busy} onClick={download} className="text-[12px] font-semibold text-indigo-600 hover:text-indigo-800 disabled:opacity-40">{busy ? "받는 중..." : "다운로드"}</button>}
          {onOpenDetail && view.state === "ready" && <button onClick={() => onOpenDetail(documentId)} className="text-[12px] font-semibold text-slate-500 hover:text-slate-800">문서 상세</button>}
          <button onClick={onClose} aria-label="닫기" className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100">✕</button>
        </div>

        <div className="flex-1 min-h-0 bg-slate-50 overflow-auto">
          {view.state === "loading" && <div className="h-full flex items-center justify-center gap-3 text-[13px] text-slate-500"><span className="w-5 h-5 border-2 border-slate-200 border-t-indigo-500 rounded-full animate-spin" />문서를 불러오는 중...</div>}
          {view.state === "error" && <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-6"><p className="text-[13px] font-semibold text-slate-700">문서를 열 수 없습니다</p><p className="text-[12px] text-slate-400">{view.message}</p></div>}
          {view.state === "ready" && view.kind === "pdf" && view.url && <iframe title={view.doc.title} src={view.url} className="w-full h-full bg-white" />}
          {view.state === "ready" && view.kind === "image" && view.url && <div className="min-h-full flex items-center justify-center p-4"><img src={view.url} alt={view.doc.title} className="max-w-full max-h-full object-contain" /></div>}
          {view.state === "ready" && view.kind === "text" && <pre className="p-5 text-[12.5px] leading-relaxed text-slate-700 whitespace-pre-wrap break-words font-mono">{view.text}</pre>}
          {view.state === "ready" && !view.kind && (
            <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-6">
              <p className="text-[13px] font-semibold text-slate-700">{view.tooBig ? "파일이 커서 미리볼 수 없습니다" : "이 형식은 미리볼 수 없습니다"}</p>
              <p className="text-[12px] text-slate-400">PDF·이미지·텍스트만 바로 볼 수 있습니다. 위의 다운로드로 받아 열어 주세요.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
