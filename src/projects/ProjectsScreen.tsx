// Anok_02 PRJ-API-01/02 — 내가 effective member인 프로젝트 목록 + 생성
import { useEffect, useState } from "react";
import * as api from "../api/project";
import type { ProjectResponse, ProjectStatus } from "../api/project";
import { errorText, fieldErrorMap } from "../api/errors";
import { Card, ErrorBox, Field, inputCls, primaryBtn, Spinner, useLoad } from "../ui/kit";
import { ProjectRoleBadge, ProjectStatusBadge } from "./shared";

const FILTERS: Array<{ label: string; value: ProjectStatus | "ALL" }> = [
  { label: "전체", value: "ALL" }, { label: "진행", value: "ACTIVE" }, { label: "완료", value: "COMPLETED" }, { label: "보관", value: "ARCHIVED" },
];

function CreateProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: (p: ProjectResponse) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function submit() {
    setBusy(true); setError(null); setFields({});
    try { onCreated(await api.createProject({ name: name.trim(), description: description.trim() || undefined })); onClose(); }
    catch (e) { setError(errorText(e)); setFields(fieldErrorMap(e)); setBusy(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[200] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-4">
        <p className="text-[15px] font-bold text-slate-900">새 프로젝트</p>
        <Field label="프로젝트명" error={fields.name}>
          <input autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={200} placeholder="예: 인증 시스템 개편" className={inputCls} />
        </Field>
        <Field label="설명 (선택)" error={fields.description}>
          <textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} maxLength={2000} className={inputCls} />
        </Field>
        <p className="text-[11px] text-slate-400">생성한 사람이 자동으로 담당자(MANAGER)가 됩니다.</p>
        {error && <p className="text-[12px] text-rose-500 font-medium">{error}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} disabled={busy} className="flex-1 py-2.5 border border-slate-200 text-slate-500 text-[13px] font-semibold rounded-xl hover:bg-slate-50 disabled:opacity-40">취소</button>
          <button onClick={submit} disabled={busy || !name.trim()} className={`flex-1 ${primaryBtn}`}>{busy ? "생성 중..." : "생성"}</button>
        </div>
      </div>
    </div>
  );
}

export default function ProjectsScreen({ navigate }: { navigate: (screen: "project-detail", ctx: { projectId: string }) => void }) {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [status, setStatus] = useState<ProjectStatus | "ALL">("ALL");
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => { const t = setTimeout(() => setDebouncedQ(q.trim()), 300); return () => clearTimeout(t); }, [q]);

  const { data, setData, loading, error, reload } = useLoad(
    () => api.listProjects({ status: status === "ALL" ? undefined : status, q: debouncedQ || undefined, limit: 100 }),
    [status, debouncedQ],
  );
  const items = data?.items ?? [];

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="shrink-0 px-6 py-4 bg-white border-b border-slate-100 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 flex-1 max-w-xs bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
          <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="프로젝트 검색" maxLength={100} className="flex-1 text-[13px] bg-transparent outline-none text-slate-700 placeholder-slate-400" />
        </div>
        <div className="flex gap-1">
          {FILTERS.map(f => (
            <button key={f.value} onClick={() => setStatus(f.value)} className={`px-3 py-1.5 rounded-xl text-[12px] font-semibold transition-colors ${status === f.value ? "bg-indigo-500 text-white" : "text-slate-500 hover:bg-slate-100"}`}>{f.label}</button>
          ))}
        </div>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white text-[12px] font-bold rounded-xl transition-colors shrink-0">+ 프로젝트 생성</button>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {loading && !data ? <Spinner /> : error && !data ? <ErrorBox message={error} onRetry={reload} /> : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center py-16">
            <p className="text-[14px] font-bold text-slate-700">프로젝트가 없습니다</p>
            <p className="text-[12px] text-slate-400">접근 가능한 프로젝트가 없거나 검색 결과가 없습니다.</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {items.map(p => (
              <div key={p.projectId} onClick={() => navigate("project-detail", { projectId: p.projectId })}
                className="bg-white border border-slate-100 rounded-2xl p-5 hover:border-indigo-200 hover:shadow-[0_4px_16px_rgba(79,110,247,0.1)] transition-all cursor-pointer group">
                <div className="flex items-start justify-between mb-3 gap-2">
                  <p className="text-[14px] font-bold text-slate-800 leading-snug group-hover:text-indigo-700 transition-colors">{p.name}</p>
                  <ProjectStatusBadge status={p.status} />
                </div>
                {p.description && <p className="text-[12px] text-slate-400 mb-4 line-clamp-2">{p.description}</p>}
                <div className="flex items-center gap-2">
                  <ProjectRoleBadge role={p.myRole} />
                  {p.managerRecoveryRequired && <span className="text-[10px] font-bold text-rose-500 bg-rose-50 px-2 py-0.5 rounded-full">담당자 없음</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {showCreate && <CreateProjectModal onClose={() => setShowCreate(false)} onCreated={p => { setData(d => d && { ...d, items: [p, ...d.items] }); navigate("project-detail", { projectId: p.projectId }); }} />}
    </div>
  );
}
