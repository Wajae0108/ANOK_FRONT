// Anok_02 PRJ-API-01/02 — 내가 effective member인 프로젝트 목록 + 생성.
// 서버가 내 접근 범위(membership)만 돌려주므로 회사 관리자라도 구성원이 아닌 프로젝트는 여기에 나오지 않는다.
import { useEffect, useState } from "react";
import * as api from "../api/project";
import type { ProjectResponse, ProjectRole, ProjectStatus } from "../api/project";
import { errorText, fieldErrorMap } from "../api/errors";
import { useAuth } from "../auth/AuthProvider";
import { Avatar, Badge, Button, ErrorBox, Field, Input, Modal, Spinner, Textarea, useLoad } from "../ui/kit";
import type { BadgeTone } from "../ui/kit";
import { BoardIcon, CircleCheckIcon, CircleHalfIcon, CircleIcon, FolderIcon, ListIcon, PlusIcon, SearchIcon } from "../ui/icons";
import type { Navigate } from "../workspace/nav";
import { fmtDate, useOrgUsers } from "./shared";

const FILTERS: Array<{ label: string; value: ProjectStatus | "ALL" }> = [
  { label: "전체", value: "ALL" }, { label: "진행", value: "ACTIVE" }, { label: "완료", value: "COMPLETED" }, { label: "보관", value: "ARCHIVED" },
];

const STATUS_CHIP: Record<ProjectStatus, { label: string; tone: BadgeTone; icon: typeof CircleIcon }> = {
  ACTIVE: { label: "진행", tone: "indigo", icon: CircleHalfIcon },
  COMPLETED: { label: "완료", tone: "emerald", icon: CircleCheckIcon },
  ARCHIVED: { label: "보관", tone: "neutral", icon: CircleIcon },
};
const ROLE_SUBTITLE: Record<ProjectRole, string> = { MANAGER: "프로젝트 관리자", MEMBER: "참여 프로젝트", VIEWER: "열람 프로젝트" };

function StatusChip({ status }: { status: ProjectStatus }) {
  const { label, tone, icon: Icon } = STATUS_CHIP[status];
  return <Badge tone={tone}><Icon size={11} />{label}</Badge>;
}

// ── 행 단위 부가 정보(진행률·구성원) ───────────────────────────────────────────
// 프로젝트 응답에는 진행률과 구성원이 없어서, 행마다 업무·구성원 목록을 따로 불러온다(목록 자체는 먼저 그려진다).
// 업무가 한 번에 못 담길 만큼 많으면 DONE/CANCELED 건수를 따로 세어 정확한 값을 구한다.
interface ProjectStats { progress: number; memberIds: string[]; memberTotal: number }

async function loadProjectStats(projectId: string): Promise<ProjectStats> {
  const [members, tasks] = await Promise.all([
    api.listProjectMembers(projectId, { status: "ACTIVE", limit: 100 }),
    api.listTasks(projectId, { limit: 100 }),
  ]);
  let done = tasks.items.filter(t => t.status === "DONE").length;
  let counted = tasks.items.filter(t => t.status !== "CANCELED").length;
  if (tasks.page.total > tasks.items.length) {
    const [d, c] = await Promise.all([
      api.listTasks(projectId, { status: "DONE", limit: 1 }),
      api.listTasks(projectId, { status: "CANCELED", limit: 1 }),
    ]);
    done = d.page.total;
    counted = tasks.page.total - c.page.total;
  }
  return { progress: counted > 0 ? Math.round((done / counted) * 100) : 0, memberIds: members.items.map(m => m.userId), memberTotal: members.page.total };
}

function useProjectStats(projectId: string) {
  return useLoad(() => loadProjectStats(projectId), [projectId]);
}

function ProgressBar({ stats, loading }: { stats: ProjectStats | null; loading: boolean }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1.5">
        <span>진행률</span><span className="tabular-nums">{stats ? `${stats.progress}%` : loading ? "…" : "-"}</span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden" role="progressbar" aria-label="진행률" aria-valuemin={0} aria-valuemax={100} aria-valuenow={stats?.progress ?? 0}>
        <div className="h-full rounded-full bg-indigo-400 transition-[width] duration-300" style={{ width: `${stats?.progress ?? 0}%` }} />
      </div>
    </div>
  );
}

function MemberStack({ stats, nameOf }: { stats: ProjectStats | null; nameOf: (id?: string | null) => string }) {
  if (!stats) return <span />;
  const shown = stats.memberIds.slice(0, 3);
  return (
    <div className="flex items-center gap-2 justify-end">
      <div className="flex -space-x-2">{shown.map(id => <Avatar key={id} name={nameOf(id)} seed={id} size={28} />)}</div>
      <span className="text-[12px] text-slate-400 tabular-nums whitespace-nowrap">{stats.memberTotal}명</span>
    </div>
  );
}

function ProjectIconTile() {
  return <span className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-500 flex items-center justify-center shrink-0"><FolderIcon size={18} /></span>;
}

function ProjectTitle({ p }: { p: ProjectResponse }) {
  return (
    <span className="min-w-0">
      <span className="flex items-center gap-2"><span className="text-[15px] font-bold text-slate-900 truncate">{p.name}</span>{p.managerRecoveryRequired && <Badge tone="rose">담당자 없음</Badge>}</span>
      <span className="block text-[12px] text-slate-400 mt-0.5 truncate">{ROLE_SUBTITLE[p.myRole]} · 최근 기록 {fmtDate(p.updatedAt).replace(/\.\s*/g, "-").replace(/-$/, "")}</span>
    </span>
  );
}

const ROW_GRID = "grid grid-cols-[minmax(0,1fr)_84px_200px_140px] gap-x-6";

function ProjectRow({ p, navigate, nameOf }: { p: ProjectResponse; navigate: Navigate; nameOf: (id?: string | null) => string }) {
  const { data: stats, loading } = useProjectStats(p.projectId);
  return (
    <div role="listitem">
      <button onClick={() => navigate("project-detail", { projectId: p.projectId })}
        className={`w-full ${ROW_GRID} items-center px-3.5 py-5 border-b border-slate-100 text-left hover:bg-slate-50 transition-colors focus-visible:outline-2 focus-visible:outline-indigo-500`}>
        <span className="min-w-0">
          <span className="flex items-center gap-3.5"><ProjectIconTile /><ProjectTitle p={p} /></span>
          {p.description && <span className="block text-[13px] text-slate-500 mt-2.5 truncate">{p.description}</span>}
        </span>
        <span><StatusChip status={p.status} /></span>
        <ProgressBar stats={stats} loading={loading} />
        <MemberStack stats={stats} nameOf={nameOf} />
      </button>
    </div>
  );
}

function ProjectCard({ p, navigate, nameOf }: { p: ProjectResponse; navigate: Navigate; nameOf: (id?: string | null) => string }) {
  const { data: stats, loading } = useProjectStats(p.projectId);
  return (
    <div role="listitem">
      <button onClick={() => navigate("project-detail", { projectId: p.projectId })}
        className="w-full h-full flex flex-col gap-4 p-5 rounded-2xl border border-slate-200 bg-white text-left hover:border-indigo-200 hover:shadow-sm transition focus-visible:outline-2 focus-visible:outline-indigo-500">
        <span className="flex items-start justify-between gap-3"><ProjectIconTile /><StatusChip status={p.status} /></span>
        <ProjectTitle p={p} />
        <span className="block text-[13px] text-slate-500 line-clamp-2 min-h-[2.6em]">{p.description ?? ""}</span>
        <ProgressBar stats={stats} loading={loading} />
        <MemberStack stats={stats} nameOf={nameOf} />
      </button>
    </div>
  );
}

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
    <Modal title="새 프로젝트" onClose={onClose}>
      <Field label="프로젝트명" error={fields.name}>
        <Input autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={120} placeholder="예: 인증 시스템 개편" />
      </Field>
      <Field label="설명 (선택)" error={fields.description}>
        <Textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} maxLength={4000} />
      </Field>
      <p className="text-[11px] text-slate-400">생성한 사람이 자동으로 담당자(MANAGER)가 됩니다.</p>
      {error && <p role="alert" className="text-[12px] text-rose-500 font-medium">{error}</p>}
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy} className="flex-1">취소</Button>
        <Button onClick={submit} disabled={busy || !name.trim()} className="flex-1">{busy ? "생성 중..." : "생성"}</Button>
      </div>
    </Modal>
  );
}

type ViewMode = "list" | "card";

export default function ProjectsScreen({ navigate, onProjectsChanged }: { navigate: Navigate; onProjectsChanged?: () => void }) {
  const { me } = useAuth();
  const { nameOf } = useOrgUsers();
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [status, setStatus] = useState<ProjectStatus | "ALL">("ALL");
  const [view, setView] = useState<ViewMode>("list");
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => { const t = setTimeout(() => setDebouncedQ(q.trim()), 300); return () => clearTimeout(t); }, [q]);

  const { data, setData, loading, error, reload } = useLoad(
    () => api.listProjects({ status: status === "ALL" ? undefined : status, q: debouncedQ || undefined, limit: 100 }),
    [status, debouncedQ],
  );
  const items = data?.items ?? [];
  const filtered = debouncedQ !== "" || status !== "ALL";

  return (
    <div className="h-full overflow-y-auto bg-white">
      <div className="max-w-[1200px] mx-auto px-11 pt-9 pb-10">
        <header className="flex items-start justify-between gap-6">
          <div>
            <p className="text-[11px] font-bold tracking-[0.14em] text-indigo-500">TEAM PROJECTS</p>
            <h1 className="mt-3 text-[30px] leading-none font-extrabold tracking-tight text-slate-900">프로젝트</h1>
            <p className="mt-4 text-[13px] text-slate-500">팀의 목표, 대화, 할 일이 한곳에.</p>
          </div>
          {data && <p className="mt-8 text-[12px] text-slate-400 whitespace-nowrap">{filtered ? "검색 결과" : "참여 중인 프로젝트"} {data.page.total}개</p>}
        </header>

        <div className="mt-8 pb-4 flex flex-wrap items-center gap-3 border-b border-slate-200">
          <div role="tablist" aria-label="프로젝트 상태" className="flex gap-1">
            {FILTERS.map(f => {
              const active = f.value === status;
              return (
                <button key={f.value} role="tab" aria-selected={active} onClick={() => setStatus(f.value)}
                  className={`px-3.5 py-2 rounded-lg text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-indigo-500 ${active ? "bg-indigo-50 text-indigo-700" : "text-slate-500 hover:bg-slate-100"}`}>{f.label}</button>
              );
            })}
          </div>
          <div className="ml-auto flex items-center gap-3">
            <div className="relative w-56">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><SearchIcon size={14} /></span>
              <Input value={q} onChange={e => setQ(e.target.value)} placeholder="프로젝트 검색" maxLength={100} aria-label="프로젝트 검색" className="!pl-9 !py-2 !rounded-xl" />
            </div>
            <div role="group" aria-label="보기 방식" className="flex p-1 rounded-xl bg-slate-100">
              {([["list", "목록", ListIcon], ["card", "카드", BoardIcon]] as const).map(([v, label, Icon]) => (
                <button key={v} onClick={() => setView(v)} aria-pressed={view === v}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-indigo-500 ${view === v ? "bg-white text-slate-900 shadow-sm" : "text-slate-400 hover:text-slate-600"}`}>
                  <Icon size={13} />{label}
                </button>
              ))}
            </div>
            <Button onClick={() => setShowCreate(true)}><PlusIcon size={13} />프로젝트 생성</Button>
          </div>
        </div>

        {loading && !data ? <Spinner /> : error && !data ? <ErrorBox message={error} onRetry={reload} /> : items.length === 0 ? (
          <div className="py-20 text-center">
            <p className="text-[14px] font-semibold text-slate-700">{filtered ? "조건에 맞는 프로젝트가 없습니다" : "참여 중인 프로젝트가 없습니다"}</p>
            <p className="text-[12px] text-slate-400 mt-1 max-w-sm mx-auto leading-relaxed">
              {filtered ? "검색어나 상태 필터를 바꿔 보세요." : me?.companyRole === "ADMIN"
                ? "관리자 권한은 프로젝트 열람 권한과 별개입니다. 프로젝트를 만들거나 구성원으로 추가되면 여기에 표시됩니다."
                : "프로젝트를 만들거나 구성원으로 추가되면 여기에 표시됩니다."}
            </p>
          </div>
        ) : view === "list" ? (
          <div role="list" aria-label="프로젝트 목록">
            {items.map(p => <ProjectRow key={p.projectId} p={p} navigate={navigate} nameOf={nameOf} />)}
          </div>
        ) : (
          <div role="list" aria-label="프로젝트 목록" className="mt-6 grid gap-4 grid-cols-[repeat(auto-fill,minmax(300px,1fr))]">
            {items.map(p => <ProjectCard key={p.projectId} p={p} navigate={navigate} nameOf={nameOf} />)}
          </div>
        )}
      </div>
      {showCreate && <CreateProjectModal onClose={() => setShowCreate(false)} onCreated={p => { setData(d => d && { ...d, items: [p, ...d.items] }); onProjectsChanged?.(); navigate("project-detail", { projectId: p.projectId }); }} />}
    </div>
  );
}
