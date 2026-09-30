// Anok_03 — 문서 상세: 개요/버전/권한/프로젝트 연결/AI 처리
import { useRef, useState } from "react";
import * as api from "../api/document";
import type { AclPermission, DocumentPermissionResponse, DocumentResponse, DocumentVersionResponse, ExternalAiPolicy, SensitivityClassification } from "../api/document";
import { errorText, fieldErrorMap } from "../api/errors";
import * as projectApi from "../api/project";
import { useOrgUsers } from "../projects/shared";
import { Card, ErrorBox, Field, ghostBtn, inputCls, labelCls, Modal, primaryBtn, Section, Spinner, useLoad } from "../ui/kit";
import { AclBadge, DocumentStatusBadge, fmtDate, fmtSize, PermissionBadge, ProcessingBadge, SensitivityBadge, triggerBrowserDownload } from "./shared";

type Tab = "개요" | "버전" | "권한" | "프로젝트 연결" | "AI 처리";
const TABS: Tab[] = ["개요", "버전", "권한", "프로젝트 연결", "AI 처리"];
const SENSITIVITY_OPTIONS: { value: SensitivityClassification; label: string }[] = [
  { value: "INTERNAL", label: "일반" }, { value: "CONFIDENTIAL", label: "기밀" }, { value: "PII", label: "개인정보" }, { value: "CORE_TRADE_SECRET", label: "핵심 영업기밀" },
];

// ───────────────────────── 개요 ─────────────────────────
function OverviewTab({ doc, onChanged }: { doc: DocumentResponse; onChanged: (d: DocumentResponse) => void }) {
  const isOwner = doc.effectivePermission === "OWNER";
  const isEditor = doc.effectivePermission === "EDITOR";
  const canEditMeta = isOwner || isEditor;
  const [title, setTitle] = useState(doc.title);
  const [description, setDescription] = useState(doc.description ?? "");
  const [sensitivity, setSensitivity] = useState<SensitivityClassification>(doc.sensitivityClassification);
  const [editing, setEditing] = useState(false);
  const [aiPolicy, setAiPolicy] = useState<ExternalAiPolicy>(doc.externalAiPolicy);
  const [transferTo, setTransferTo] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const { users } = useOrgUsers();

  async function act(name: string, fn: () => Promise<DocumentResponse>, success: string) {
    setBusy(name); setMsg(null); setFields({});
    try { onChanged(await fn()); setMsg({ ok: true, text: success }); }
    catch (e) { setMsg({ ok: false, text: errorText(e) }); setFields(fieldErrorMap(e)); } finally { setBusy(null); }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <Section>문서 정보</Section>
          {canEditMeta && doc.status !== "ARCHIVED" && !editing && <button onClick={() => { setEditing(true); setTitle(doc.title); setDescription(doc.description ?? ""); setSensitivity(doc.sensitivityClassification); }} className="text-[11px] text-indigo-500 font-semibold hover:text-indigo-700">수정</button>}
        </div>
        {editing ? (
          <div className="space-y-3">
            <Field label="제목" error={fields.title}><input value={title} onChange={e => setTitle(e.target.value)} maxLength={200} className={inputCls} /></Field>
            <Field label="설명" error={fields.description}><textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} maxLength={2000} className={inputCls} /></Field>
            <Field label="민감도 분류" error={fields.sensitivityClassification}>
              <select value={sensitivity} onChange={e => setSensitivity(e.target.value as SensitivityClassification)} disabled={!isOwner} className={inputCls}>
                {SENSITIVITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              {!isOwner && <p className="text-[10px] text-slate-400 mt-1">편집자는 민감도를 변경할 수 없습니다.</p>}
            </Field>
            <div className="flex gap-2">
              <button onClick={() => setEditing(false)} className={`flex-1 ${ghostBtn}`}>취소</button>
              <button disabled={busy === "meta" || !title.trim()}
                onClick={() => act("meta", () => api.updateDocument(doc.documentId, { title: title.trim(), description: description.trim() || undefined, sensitivityClassification: sensitivity, version: doc.version }).then(r => { setEditing(false); return r; }), "저장했습니다.")}
                className={`flex-1 ${primaryBtn}`}>저장</button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-[14px] text-slate-700 leading-relaxed">{doc.description || "설명이 없습니다."}</p>
            <div className="flex items-center gap-2">
              <DocumentStatusBadge status={doc.status} /><SensitivityBadge value={doc.sensitivityClassification} /><ProcessingBadge status={doc.processingStatus} /><PermissionBadge permission={doc.effectivePermission} />
            </div>
          </>
        )}
        <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-50">
          {[["현재 파일", `${doc.currentVersion.originalFilename} (v${doc.currentVersion.versionNo})`], ["크기", fmtSize(doc.currentVersion.sizeBytes)], ["생성일", fmtDate(doc.createdAt)], ["최근 수정", fmtDate(doc.updatedAt)]].map(([l, v]) => (
            <div key={l}><p className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">{l}</p><p className="text-[13px] font-bold text-slate-800 mt-0.5">{v}</p></div>
          ))}
        </div>
      </Card>

      {isOwner && (
        <Card className="p-5 space-y-3">
          <Section>외부 AI 전송 정책</Section>
          <div className="flex gap-2">
            {(["INHERIT", "ALLOWED", "BLOCKED"] as const).map(v => (
              <button key={v} onClick={() => setAiPolicy(v)} className={`flex-1 py-2 rounded-xl text-[12px] font-bold border ${aiPolicy === v ? "bg-indigo-500 text-white border-indigo-500" : "border-slate-200 text-slate-500"}`}>{v === "INHERIT" ? "회사 기본값" : v === "ALLOWED" ? "허용" : "차단"}</button>
            ))}
          </div>
          {doc.sensitivityClassification !== "INTERNAL" && <p className="text-[11px] text-amber-600">민감도가 "일반"이 아니므로 "허용"으로 저장할 수 없습니다.</p>}
          <button disabled={busy === "policy" || aiPolicy === doc.externalAiPolicy} onClick={() => act("policy", () => api.updateDocumentAiPolicy(doc.documentId, { externalAiPolicy: aiPolicy, version: doc.version }), "AI 정책을 변경했습니다.")} className={primaryBtn}>저장</button>
        </Card>
      )}

      {isOwner && (
        <Card className="p-5 space-y-3">
          <Section>소유권 이전</Section>
          <select value={transferTo} onChange={e => setTransferTo(e.target.value)} className={inputCls}>
            <option value="">대상 선택</option>
            {users.filter(u => u.userId !== doc.ownerUserId).map(u => <option key={u.userId} value={u.userId}>{u.displayName}</option>)}
          </select>
          <button disabled={busy === "transfer" || !transferTo} onClick={() => act("transfer", () => api.transferDocumentOwner(doc.documentId, { targetUserId: transferTo, version: doc.version }), "소유권을 이전했습니다. 이제 이 문서에 접근할 수 없습니다.")} className={ghostBtn}>이전</button>
        </Card>
      )}

      {isOwner && doc.status !== "ARCHIVED" && (
        <Card className="p-5 space-y-3">
          <Section>문서 상태</Section>
          <button disabled={busy === "archive"} onClick={() => { if (confirm("보관하면 되돌릴 수 없습니다. 계속할까요?")) act("archive", () => api.archiveDocument(doc.documentId, doc.version), "문서를 보관했습니다."); }}
            className="px-4 py-2.5 border border-rose-200 text-rose-500 text-[13px] font-semibold rounded-xl hover:bg-rose-50 disabled:opacity-40">보관</button>
        </Card>
      )}
      {msg && <p className={`text-[12px] font-medium ${msg.ok ? "text-emerald-600" : "text-rose-500"}`}>{msg.text}</p>}
    </div>
  );
}

// ───────────────────────── 버전 ─────────────────────────
function VersionsTab({ doc, canUpload }: { doc: DocumentResponse; canUpload: boolean }) {
  const { data, setData, loading, error, reload } = useLoad(() => api.listDocumentVersions(doc.documentId, { limit: 100 }), [doc.documentId]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const items = data?.items ?? [];

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file) return;
    setBusy("upload"); setMsg(null);
    try { const v = await api.uploadDocumentVersion(doc.documentId, file, doc.version); setData(d => d && { ...d, items: [v, ...d.items.map(x => ({ ...x, isCurrent: false }))] }); }
    catch (e) { setMsg(errorText(e)); } finally { setBusy(null); }
  }
  async function download(v: DocumentVersionResponse) {
    setBusy(v.versionId);
    try { const r = v.isCurrent ? await api.downloadCurrentVersion(doc.documentId) : await api.downloadVersion(doc.documentId, v.versionId); triggerBrowserDownload(r.blob, r.filename); }
    catch (e) { setMsg(errorText(e)); } finally { setBusy(null); }
  }

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  return (
    <div className="max-w-2xl space-y-3">
      {canUpload && doc.status !== "ARCHIVED" && (
        <div className="flex justify-end">
          <input ref={fileRef} type="file" className="hidden" onChange={upload} />
          <button onClick={() => fileRef.current?.click()} disabled={busy === "upload"} className="flex items-center gap-1.5 px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white text-[13px] font-bold rounded-xl disabled:opacity-40">{busy === "upload" ? "업로드 중..." : "+ 새 버전 업로드"}</button>
        </div>
      )}
      {msg && <p className="text-[12px] text-rose-500 font-medium">{msg}</p>}
      <Card>
        {items.map(v => (
          <div key={v.versionId} className="flex items-center gap-3 px-5 py-3 border-b border-slate-50 last:border-0">
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-slate-800 truncate">v{v.versionNo} · {v.originalFilename} {v.isCurrent && <span className="text-indigo-500">(현재)</span>}</p>
              <p className="text-[11px] text-slate-400">{fmtSize(v.sizeBytes)} · {fmtDate(v.createdAt)}</p>
            </div>
            <button disabled={busy === v.versionId} onClick={() => download(v)} className="text-[11px] text-indigo-500 font-semibold hover:bg-indigo-50 px-2 py-1 rounded-lg disabled:opacity-40">{busy === v.versionId ? "다운로드 중..." : "다운로드"}</button>
          </div>
        ))}
      </Card>
    </div>
  );
}

// ───────────────────────── 권한 ─────────────────────────
function GrantModal({ doc, existing, onClose, onSaved }: { doc: DocumentResponse; existing: Set<string>; onClose: () => void; onSaved: (p: DocumentPermissionResponse) => void }) {
  const { users, loading } = useOrgUsers();
  const [userId, setUserId] = useState("");
  const [permission, setPermission] = useState<AclPermission>("VIEWER");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const candidates = users.filter(u => u.userId !== doc.ownerUserId && !existing.has(u.userId));

  async function submit() {
    setBusy(true); setError(null);
    try { onSaved(await api.upsertDocumentPermission(doc.documentId, userId, { permission, expectedDocumentVersion: doc.version })); onClose(); }
    catch (e) { setError(errorText(e)); setBusy(false); }
  }
  return (
    <Modal title="권한 부여" onClose={onClose}>
      {loading ? <Spinner /> : (
        <>
          <Field label="사용자">
            <select value={userId} onChange={e => setUserId(e.target.value)} className={inputCls}>
              <option value="">선택하세요</option>
              {candidates.map(u => <option key={u.userId} value={u.userId}>{u.displayName}</option>)}
            </select>
          </Field>
          <Field label="권한">
            <div className="flex gap-2">
              {(["VIEWER", "EDITOR", "DENY"] as const).map(p => <button key={p} onClick={() => setPermission(p)} className={`flex-1 py-2 rounded-xl text-[12px] font-bold border ${permission === p ? "bg-indigo-500 text-white border-indigo-500" : "border-slate-200 text-slate-500"}`}>{p === "VIEWER" ? "열람자" : p === "EDITOR" ? "편집자" : "차단"}</button>)}
            </div>
          </Field>
          {error && <p className="text-[12px] text-rose-500 font-medium">{error}</p>}
          <div className="flex gap-2">
            <button onClick={onClose} className={`flex-1 ${ghostBtn}`}>취소</button>
            <button disabled={busy || !userId} onClick={submit} className={`flex-1 ${primaryBtn}`}>{busy ? "저장 중..." : "저장"}</button>
          </div>
        </>
      )}
    </Modal>
  );
}

function PermissionsTab({ doc }: { doc: DocumentResponse }) {
  const { data, setData, loading, error, reload } = useLoad(() => api.listDocumentPermissions(doc.documentId, { limit: 100 }), [doc.documentId]);
  const { nameOf } = useOrgUsers();
  const [showGrant, setShowGrant] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const items = (data?.items ?? []).filter(p => p.status !== "REVOKED");

  async function revoke(p: DocumentPermissionResponse) {
    if (!confirm(`${nameOf(p.userId)}님의 권한을 회수할까요?`)) return;
    setBusyId(p.userId); setMsg(null);
    try { await api.revokeDocumentPermission(doc.documentId, p.userId); setData(d => d && { ...d, items: d.items.filter(x => x.userId !== p.userId) }); }
    catch (e) { setMsg(errorText(e)); } finally { setBusyId(null); }
  }

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  return (
    <Card className="max-w-2xl">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <p className="text-[13px] font-bold text-slate-800">권한 {items.length}건</p>
        <button onClick={() => setShowGrant(true)} className="flex items-center gap-1 px-3 py-1.5 bg-indigo-500 hover:bg-indigo-600 text-white text-[12px] font-bold rounded-xl">+ 권한 부여</button>
      </div>
      {msg && <p className="px-5 pt-3 text-[12px] text-rose-500 font-medium">{msg}</p>}
      {items.length === 0 && <div className="py-10 text-center text-[13px] text-slate-400">소유자 외 명시적으로 권한을 받은 사용자가 없습니다.</div>}
      {items.map(p => (
        <div key={p.userId} className="flex items-center gap-3 px-5 py-3 border-b border-slate-50 last:border-0">
          <div className="flex-1 min-w-0"><p className="text-[13px] font-semibold text-slate-800 truncate">{nameOf(p.userId)}</p>{p.status === "SUSPENDED_BY_IDENTITY" && <p className="text-[11px] text-amber-500">계정 일시 정지됨</p>}</div>
          <AclBadge permission={p.permission} />
          <button disabled={busyId === p.userId} onClick={() => revoke(p)} className="text-[11px] text-slate-400 hover:text-rose-500 px-2 py-1 rounded-lg hover:bg-rose-50 disabled:opacity-40">회수</button>
        </div>
      ))}
      {showGrant && <GrantModal doc={doc} existing={new Set(items.map(p => p.userId))} onClose={() => setShowGrant(false)} onSaved={p => setData(d => { if (!d) return d; const rest = d.items.filter(x => x.userId !== p.userId); return { ...d, items: [...rest, p] }; })} />}
    </Card>
  );
}

// ───────────────────────── 프로젝트 연결 ─────────────────────────
function ProjectAttachmentsTab({ doc, isOwner }: { doc: DocumentResponse; isOwner: boolean }) {
  const myProjects = useLoad(() => projectApi.listProjects({ limit: 100 }), []);
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [attached, setAttached] = useState<{ projectId: string; name: string }[]>([]);
  const managerProjects = (myProjects.data?.items ?? []).filter(p => p.myRole === "MANAGER" && !attached.some(a => a.projectId === p.projectId));

  async function attach() {
    if (!projectId) return;
    setBusy("attach"); setMsg(null);
    try {
      await api.attachDocumentToProject(doc.documentId, projectId);
      const p = myProjects.data?.items.find(x => x.projectId === projectId);
      setAttached(a => [...a, { projectId, name: p?.name ?? projectId }]); setProjectId("");
    } catch (e) { setMsg(errorText(e)); } finally { setBusy(null); }
  }
  async function detach(pid: string) {
    setBusy(pid); setMsg(null);
    try { await api.detachDocumentFromProject(doc.documentId, pid); setAttached(a => a.filter(x => x.projectId !== pid)); }
    catch (e) { setMsg(errorText(e)); } finally { setBusy(null); }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <Card className="p-5 space-y-2">
        <Section>연결된 프로젝트</Section>
        <p className="text-[11px] text-slate-400">프로젝트에 연결하면 해당 프로젝트 구성원 전체가 자동으로 열람자 권한을 받습니다.</p>
        {attached.length === 0 && <p className="text-[13px] text-slate-400 py-4 text-center">이 세션에서 연결한 프로젝트가 없습니다. (프로젝트 연결 목록 조회 API가 없어 이번에 연결/해제한 것만 표시됩니다.)</p>}
        {attached.map(a => (
          <div key={a.projectId} className="flex items-center gap-3 py-2 border-b border-slate-50 last:border-0">
            <p className="flex-1 text-[13px] font-semibold text-slate-800">{a.name}</p>
            {isOwner && <button disabled={busy === a.projectId} onClick={() => detach(a.projectId)} className="text-[11px] text-rose-500 font-semibold hover:bg-rose-50 px-2 py-1 rounded-lg disabled:opacity-40">연결 해제</button>}
          </div>
        ))}
      </Card>
      {isOwner && (
        <Card className="p-5 space-y-2">
          <Section>새로 연결</Section>
          <p className="text-[11px] text-slate-400">내가 담당자(MANAGER)인 프로젝트에만 연결할 수 있습니다.</p>
          <div className="flex gap-2">
            <select value={projectId} onChange={e => setProjectId(e.target.value)} className={inputCls}>
              <option value="">프로젝트 선택</option>
              {managerProjects.map(p => <option key={p.projectId} value={p.projectId}>{p.name}</option>)}
            </select>
            <button disabled={busy === "attach" || !projectId} onClick={attach} className={ghostBtn}>연결</button>
          </div>
        </Card>
      )}
      {msg && <p className="text-[12px] text-rose-500 font-medium">{msg}</p>}
    </div>
  );
}

// ───────────────────────── AI 처리 ─────────────────────────
function ProcessingTab({ doc, canRequest }: { doc: DocumentResponse; canRequest: boolean }) {
  const { data, setData, loading, error, reload } = useLoad(() => api.getDocumentProcessing(doc.documentId), [doc.documentId]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run(fn: () => Promise<typeof data>) {
    setBusy(true); setMsg(null);
    try { setData(await fn()); } catch (e) { setMsg(errorText(e)); } finally { setBusy(false); }
  }

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return null;
  const canRetry = data.status === "FAILED" || data.status === "BLOCKED_BY_POLICY";
  const canQueue = data.status === "NOT_REQUESTED" || data.status === "STALE";
  return (
    <Card className="max-w-2xl p-5 space-y-3">
      <Section>AI 처리 상태</Section>
      <ProcessingBadge status={data.status} />
      {data.blockCode && <p className="text-[12px] text-rose-500">차단 사유: {data.blockCode}</p>}
      {data.failureCode && <p className="text-[12px] text-rose-500">실패 사유: {data.failureCode}</p>}
      <p className="text-[11px] text-slate-400">처리 세대(generation): {data.processingGeneration} · 최근 갱신: {fmtDate(data.updatedAt)}</p>
      {canRequest && canQueue && <button disabled={busy} onClick={() => run(() => api.requestDocumentProcessing(doc.documentId))} className={primaryBtn}>{busy ? "요청 중..." : "AI 처리 요청"}</button>}
      {canRequest && canRetry && <button disabled={busy} onClick={() => run(() => api.retryDocumentProcessing(doc.documentId))} className={ghostBtn}>{busy ? "요청 중..." : "다시 시도"}</button>}
      {msg && <p className="text-[12px] text-rose-500 font-medium">{msg}</p>}
    </Card>
  );
}

// ───────────────────────── 화면 ─────────────────────────
export default function DocumentDetailScreen({ docId, backMeetingId, navigate }: { docId: string; backMeetingId?: string; navigate: (s: any, ctx?: any) => void }) {
  const [tab, setTab] = useState<Tab>("개요");
  const { data: doc, setData: setDoc, loading, error, reload } = useLoad(() => api.getDocument(docId), [docId]);
  const [dlBusy, setDlBusy] = useState(false);
  const [dlErr, setDlErr] = useState<string | null>(null);

  if (loading && !doc) return <div className="h-full bg-slate-50/40"><Spinner text="문서를 불러오는 중..." /></div>;
  if (error && !doc) return <div className="h-full bg-slate-50/40"><ErrorBox message={error} onRetry={reload} /></div>;
  if (!doc) return null;

  const isOwner = doc.effectivePermission === "OWNER";
  const isEditor = doc.effectivePermission === "EDITOR";

  async function download() {
    setDlBusy(true); setDlErr(null);
    try { const r = await api.downloadCurrentVersion(doc!.documentId); triggerBrowserDownload(r.blob, r.filename); }
    catch (e) { setDlErr(errorText(e)); } finally { setDlBusy(false); }
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="shrink-0 bg-white border-b border-slate-100 px-6 py-4">
        <div className="flex items-center gap-3 mb-3">
          <button onClick={() => backMeetingId ? navigate("meeting-detail", { meetingId: backMeetingId }) : navigate("home")} className="w-8 h-8 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="text-[17px] font-extrabold text-slate-900 truncate">{doc.title}</h2>
          </div>
          <button onClick={download} disabled={dlBusy} className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-indigo-600 text-[12px] font-semibold transition-colors disabled:opacity-40">{dlBusy ? "다운로드 중..." : "다운로드"}</button>
        </div>
        {dlErr && <p className="text-[11px] text-rose-500 mb-2">{dlErr}</p>}
        <div className="flex gap-0 overflow-x-auto">
          {TABS.map(t => <button key={t} onClick={() => setTab(t)} className={`px-4 py-2.5 text-[13px] font-semibold border-b-2 transition-colors shrink-0 ${tab === t ? "border-indigo-500 text-indigo-600" : "border-transparent text-slate-400 hover:text-slate-600"}`}>{t}</button>)}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 bg-slate-50/40">
        {tab === "개요" && <OverviewTab doc={doc} onChanged={setDoc} />}
        {tab === "버전" && <VersionsTab doc={doc} canUpload={isOwner || isEditor} />}
        {tab === "권한" && (isOwner ? <PermissionsTab doc={doc} /> : <Card className="max-w-2xl p-8 text-center text-[13px] text-slate-400">권한 관리는 소유자만 볼 수 있습니다.</Card>)}
        {tab === "프로젝트 연결" && <ProjectAttachmentsTab doc={doc} isOwner={isOwner} />}
        {tab === "AI 처리" && <ProcessingTab doc={doc} canRequest={isOwner || isEditor} />}
      </div>
    </div>
  );
}
