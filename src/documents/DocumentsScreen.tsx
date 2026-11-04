// Anok_03 DOC-API-01/02 — 내가 OWNER이거나 explicit ACL을 받은 문서 목록 + 업로드
import { useEffect, useRef, useState } from "react";
import * as api from "../api/document";
import type { DocumentResponse, DocumentStatus, ExternalAiPolicy, SensitivityClassification } from "../api/document";
import { errorText, fieldErrorMap } from "../api/errors";
import { Field, inputCls, primaryBtn, Spinner, ErrorBox, useLoad, ghostBtn } from "../ui/kit";
import { DocumentStatusBadge, fmtDate, fmtSize, PermissionBadge, ProcessingBadge, SensitivityBadge } from "./shared";

const FILTERS: Array<{ label: string; value: DocumentStatus | "ALL" }> = [{ label: "전체", value: "ALL" }, { label: "사용 중", value: "ACTIVE" }, { label: "보관됨", value: "ARCHIVED" }];

function UploadModal({ onClose, onUploaded }: { onClose: () => void; onUploaded: (d: DocumentResponse) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [sensitivity, setSensitivity] = useState<SensitivityClassification>("INTERNAL");
  const [aiPolicy, setAiPolicy] = useState<ExternalAiPolicy>("INHERIT");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    // 올리기 전에 50MB·파일 이름 길이·형식을 먼저 거른다. 서버는 크기 초과나 너무 긴 이름을 413으로, 압축·실행 파일을 400으로 거절한다.
    const bad = api.validateUploadFile(f);
    setError(bad);
    if (bad) { setFile(null); if (fileRef.current) fileRef.current.value = ""; return; }
    setFile(f);
    if (!title.trim()) setTitle(f.name.replace(/\.[^.]+$/, "").slice(0, api.UPLOAD_MAX_TITLE));
  }
  async function submit() {
    if (!file) return;
    setBusy(true); setError(null); setFields({});
    try { onUploaded(await api.uploadDocument(file, { title: title.trim(), description: description.trim() || undefined, sensitivityClassification: sensitivity, externalAiPolicy: aiPolicy })); onClose(); }
    catch (e) { setError(errorText(e)); setFields(fieldErrorMap(e)); setBusy(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[200] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-4">
        <p className="text-[15px] font-bold text-slate-900">문서 업로드</p>
        <input ref={fileRef} type="file" className="hidden" onChange={pick} />
        <button onClick={() => fileRef.current?.click()} className="w-full py-6 border-2 border-dashed border-slate-200 rounded-xl text-[13px] text-slate-500 hover:border-indigo-300 hover:text-indigo-600 transition-colors">
          {file ? <span className="font-semibold text-slate-700">{file.name} ({fmtSize(file.size)})</span> : "파일을 선택하세요 (최대 50MB)"}
        </button>
        <p className="text-[11px] text-slate-400 -mt-2">이렇게 올린 문서는 AI가 자동으로 읽지 않습니다. 회의 자료로 붙일 때 글자 추출이 시작됩니다.</p>
        <Field label="제목" error={fields.title}><input value={title} onChange={e => setTitle(e.target.value)} maxLength={160} className={inputCls} /></Field>
        <Field label="설명 (선택)" error={fields.description}><textarea rows={2} value={description} onChange={e => setDescription(e.target.value)} maxLength={4000} className={inputCls} /></Field>
        <Field label="민감도 분류">
          <select value={sensitivity} onChange={e => setSensitivity(e.target.value as SensitivityClassification)} className={inputCls}>
            <option value="INTERNAL">일반</option><option value="CONFIDENTIAL">기밀</option><option value="PII">개인정보</option><option value="CORE_TRADE_SECRET">핵심 영업기밀</option>
          </select>
        </Field>
        <Field label="외부 AI 전송 정책">
          <select value={aiPolicy} onChange={e => setAiPolicy(e.target.value as ExternalAiPolicy)} className={inputCls}>
            <option value="INHERIT">회사 기본값 따름</option><option value="ALLOWED">허용</option><option value="BLOCKED">차단</option>
          </select>
        </Field>
        {error && <p className="text-[12px] text-rose-500 font-medium">{error}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} disabled={busy} className={`flex-1 ${ghostBtn}`}>취소</button>
          <button onClick={submit} disabled={busy || !file || !title.trim()} className={`flex-1 ${primaryBtn}`}>{busy ? "업로드 중..." : "업로드"}</button>
        </div>
      </div>
    </div>
  );
}

export default function DocumentsScreen({ navigate }: { navigate: (screen: "document-detail", ctx: { docId: string }) => void }) {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [status, setStatus] = useState<DocumentStatus | "ALL">("ALL");
  const [showUpload, setShowUpload] = useState(false);

  useEffect(() => { const t = setTimeout(() => setDebouncedQ(q.trim()), 300); return () => clearTimeout(t); }, [q]);

  const { data, setData, loading, error, reload } = useLoad(
    () => api.listDocuments({ status: status === "ALL" ? undefined : status, q: debouncedQ || undefined, limit: 100 }),
    [status, debouncedQ],
  );
  const items = data?.items ?? [];

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="shrink-0 px-6 py-4 bg-white border-b border-slate-100 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 flex-1 max-w-xs bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
          <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="문서 검색" maxLength={100} className="flex-1 text-[13px] bg-transparent outline-none text-slate-700 placeholder-slate-400" />
        </div>
        <div className="flex gap-1">
          {FILTERS.map(f => <button key={f.value} onClick={() => setStatus(f.value)} className={`px-3 py-1.5 rounded-xl text-[12px] font-semibold transition-colors ${status === f.value ? "bg-indigo-500 text-white" : "text-slate-500 hover:bg-slate-100"}`}>{f.label}</button>)}
        </div>
        <button onClick={() => setShowUpload(true)} className="flex items-center gap-1.5 px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white text-[12px] font-bold rounded-xl transition-colors shrink-0">+ 문서 업로드</button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 bg-slate-50/40">
        <p className="text-[10px] text-slate-400 font-semibold mb-3">※ 직접 소유하거나 권한을 받은 문서만 표시됩니다. 프로젝트를 통해 열람 가능한 문서는 해당 프로젝트의 문서 탭에서 확인하세요.</p>
        {loading && !data ? <Spinner /> : error && !data ? <ErrorBox message={error} onRetry={reload} /> : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
            <p className="text-[14px] font-bold text-slate-700">문서가 없습니다</p>
            <p className="text-[12px] text-slate-400">접근 가능한 문서가 없거나 검색 결과가 없습니다.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map(d => (
              <div key={d.documentId} onClick={() => navigate("document-detail", { docId: d.documentId })}
                className="bg-white border border-slate-100 rounded-2xl p-4 flex items-center gap-4 hover:border-indigo-200 cursor-pointer hover:shadow-sm transition-all">
                <div className="w-11 h-11 rounded-xl bg-red-50 border border-red-100 flex items-center justify-center shrink-0">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-bold text-slate-800 truncate">{d.title}</p>
                  <p className="text-[11px] text-slate-400">{d.currentVersion.originalFilename} · v{d.currentVersion.versionNo} · {fmtSize(d.currentVersion.sizeBytes)} · {fmtDate(d.updatedAt)}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {d.status === "ARCHIVED" && <DocumentStatusBadge status={d.status} />}
                  <SensitivityBadge value={d.sensitivityClassification} />
                  <ProcessingBadge status={d.processingStatus} />
                  <PermissionBadge permission={d.effectivePermission} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {showUpload && <UploadModal onClose={() => setShowUpload(false)} onUploaded={d => setData(x => x && { ...x, items: [d, ...x.items] })} />}
    </div>
  );
}
