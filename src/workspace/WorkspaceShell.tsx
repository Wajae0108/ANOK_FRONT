// User Workspace 레이아웃: 밝은 회색 사이드바 + 흰색 콘텐츠 + 인디고 선택 상태.
// 관리자 콘솔(AdminShell)과 시각적으로 구분되며, 관리자 진입 버튼은 companyRole === "ADMIN"일 때만 보인다.
// (관리자 권한은 프로젝트·회의·문서 열람 권한과 별개다 — 이 셸은 권한을 추론하지 않고, 목록은 서버가 준 것만 보여 준다.)
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import * as mtgApi from "../api/meeting";
import type { ProjectResponse } from "../api/project";
import { loadMyTasks } from "../projects/myTasks";
import type { MyTaskRow } from "../projects/myTasks";
import { useMyMeetingsSummary } from "../meetings/shared";
import type { NotificationCenter } from "../notifications/shared";
import logoMark from "../assets/logo/logo-mark.png";
import logoWordmark from "../assets/logo/logo-wordmark.png";
import { Avatar, useLoad } from "../ui/kit";
import { ArrowUpRightIcon, ChevronsLeftIcon, ChevronsRightIcon, FolderIcon, HomeIcon, SearchIcon, SettingsIcon, ShieldIcon, SparkIcon, TaskIcon, VideoIcon } from "../ui/icons";
import { NotificationBell, UserMenu } from "./chrome";
import type { CurrentUser, Navigate, Screen } from "./nav";

const NAV_ACTIVE: Record<string, Screen[]> = {
  home: ["home"], tasks: ["tasks"],
  projects: ["projects", "project-detail"], meetings: ["meetings", "meeting-detail", "document-detail"], ai: ["ai"],
};

function NavButton({ id, screen, icon, label, collapsed, badge, onClick }: { id: string; screen: Screen; icon: ReactNode; label: string; collapsed: boolean; badge?: number; onClick: () => void }) {
  const active = NAV_ACTIVE[id]?.includes(screen);
  return (
    <button onClick={onClick} aria-current={active ? "page" : undefined} title={collapsed ? label : undefined}
      className={`relative w-full flex items-center gap-3 rounded-lg text-left text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-indigo-500 ${collapsed ? "justify-center px-0 py-2.5" : "px-3 py-2"} ${active ? "bg-indigo-50 text-indigo-700 font-semibold" : "text-slate-600 font-medium hover:bg-slate-200/60"}`}>
      <span className={active ? "text-indigo-600" : "text-slate-400"}>{icon}</span>
      {!collapsed && <span className="flex-1 truncate">{label}</span>}
      {!!badge && (collapsed
        ? <span className="absolute top-1 right-3 w-2 h-2 rounded-full bg-rose-500" />
        : <span className="min-w-5 h-5 px-1.5 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">{badge}</span>)}
    </button>
  );
}

function Sidebar({ user, screen, navigate, projects, collapsed, onToggle, onOpenAccount, activeProjectId }: {
  user: CurrentUser; screen: Screen; navigate: Navigate; projects: ProjectResponse[];
  collapsed: boolean; onToggle: () => void; onOpenAccount: () => void; activeProjectId?: string;
}) {
  const { needsReview } = useMyMeetingsSummary(user.userId);
  const isAdmin = user.companyRole === "ADMIN";
  const activeProjects = projects.filter(p => p.status === "ACTIVE").slice(0, 6);

  return (
    <aside className={`shrink-0 h-full flex flex-col bg-[#f7f8fa] border-r border-slate-200/80 transition-[width] duration-150 ${collapsed ? "w-16" : "w-[232px]"}`}>
      <div className={`h-[68px] shrink-0 flex items-center ${collapsed ? "justify-center" : "justify-between px-5"}`}>
        <button onClick={() => navigate("home")} aria-label="홈으로" className="flex items-center gap-2.5 focus-visible:outline-2 focus-visible:outline-indigo-500 rounded-lg">
          <img src={logoMark} alt="" className="h-8 w-auto shrink-0" />
          {!collapsed && <img src={logoWordmark} alt="Anok" className="h-[18px] w-auto" />}
        </button>
        {!collapsed && (
          <button onClick={onToggle} aria-label="사이드바 접기" className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 focus-visible:outline-2 focus-visible:outline-indigo-500"><ChevronsLeftIcon /></button>
        )}
      </div>
      {collapsed && (
        <button onClick={onToggle} aria-label="사이드바 펼치기" className="mx-auto mb-2 w-8 h-8 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 focus-visible:outline-2 focus-visible:outline-indigo-500"><ChevronsRightIcon /></button>
      )}

      {!collapsed && (
        <div className="px-5 pb-4">
          <p className="text-[14px] font-bold text-slate-900 truncate">{user.team || "나의 업무 공간"}</p>
          {user.team && <p className="text-[11px] text-slate-400 mt-0.5">나의 업무 공간</p>}
        </div>
      )}

      <nav aria-label="업무 공간" className="flex-1 overflow-y-auto px-3 space-y-0.5">
        <NavButton id="home" screen={screen} icon={<HomeIcon />} label="홈" collapsed={collapsed} onClick={() => navigate("home")} />

        {collapsed ? <div className="h-px bg-slate-200 mx-2 my-3" /> : <p className="px-3 pt-5 pb-1.5 text-[10px] font-bold tracking-[0.14em] text-slate-400">WORK</p>}
        <NavButton id="tasks" screen={screen} icon={<TaskIcon />} label="내 업무" collapsed={collapsed} onClick={() => navigate("tasks")} />
        <NavButton id="projects" screen={screen} icon={<FolderIcon />} label="프로젝트" collapsed={collapsed} onClick={() => navigate("projects")} />
        <NavButton id="meetings" screen={screen} icon={<VideoIcon />} label="회의" collapsed={collapsed} badge={needsReview.length} onClick={() => navigate("meetings")} />

        <div className="pt-3">
          <button onClick={() => navigate("ai")} title={collapsed ? "Ask ANOK" : undefined} aria-current={screen === "ai" ? "page" : undefined}
            className={`w-full flex items-center gap-3 rounded-lg border text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-indigo-500 ${collapsed ? "justify-center py-2.5" : "px-3 py-2.5"} ${screen === "ai" ? "bg-indigo-50 border-indigo-200 text-indigo-700" : "bg-white border-slate-200 text-slate-700 hover:border-indigo-200 hover:text-indigo-700"}`}>
            <span className="text-indigo-600"><SparkIcon /></span>
            {!collapsed && <><span className="flex-1 text-left">Ask ANOK</span><span className="text-slate-300"><ArrowUpRightIcon size={12} /></span></>}
          </button>
        </div>

        {!collapsed && activeProjects.length > 0 && (
          <div className="pt-5">
            <p className="px-3 pb-1.5 text-[11px] font-semibold text-slate-400">참여 프로젝트</p>
            {activeProjects.map(p => (
              <button key={p.projectId} onClick={() => navigate("project-detail", { projectId: p.projectId })} aria-current={screen === "project-detail" && activeProjectId === p.projectId ? "page" : undefined}
                className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-left text-[12px] transition-colors focus-visible:outline-2 focus-visible:outline-indigo-500 ${screen === "project-detail" && activeProjectId === p.projectId ? "bg-indigo-50 text-indigo-700 font-semibold" : "text-slate-500 hover:bg-slate-200/60"}`}>
                <span className="w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0" /><span className="truncate">{p.name}</span>
              </button>
            ))}
          </div>
        )}
      </nav>

      <div className="shrink-0 border-t border-slate-200/80 px-3 py-3 space-y-0.5">
        {isAdmin && (
          <button onClick={() => navigate("company-admin")} title={collapsed ? "관리자 콘솔" : undefined}
            className={`w-full flex items-center gap-3 rounded-lg text-[13px] font-medium text-slate-600 hover:bg-slate-200/60 transition-colors focus-visible:outline-2 focus-visible:outline-indigo-500 ${collapsed ? "justify-center py-2.5" : "px-3 py-2"}`}>
            <span className="text-slate-400"><ShieldIcon size={16} /></span>
            {!collapsed && <><span className="flex-1 text-left">관리자 콘솔</span><span className="text-slate-300"><ArrowUpRightIcon size={12} /></span></>}
          </button>
        )}
        <button onClick={onOpenAccount} title={collapsed ? "개인 설정" : undefined}
          className={`w-full flex items-center gap-3 rounded-lg text-[13px] font-medium text-slate-600 hover:bg-slate-200/60 transition-colors focus-visible:outline-2 focus-visible:outline-indigo-500 ${collapsed ? "justify-center py-2.5" : "px-3 py-2"}`}>
          <span className="text-slate-400"><SettingsIcon /></span>{!collapsed && <span>개인 설정</span>}
        </button>
        <div className={`flex items-center gap-2.5 pt-2 ${collapsed ? "justify-center" : "px-3"}`}>
          <Avatar name={user.avatar} seed={user.userId ?? user.name} size={30} />
          {!collapsed && <div className="min-w-0"><p className="text-[12px] font-semibold text-slate-800 truncate">{user.name}</p>{user.team && <p className="text-[11px] text-slate-400 truncate">{user.team}</p>}</div>}
        </div>
      </div>
    </aside>
  );
}

// 헤더 검색: 입력창에 포커스하면 한 번 불러온 내 업무·회의와 프로젝트 목록에서 클라이언트 측으로 찾는다(서버에 통합 검색 API는 없다).
function GlobalSearch({ user, projects, navigate }: { user: CurrentUser; projects: ProjectResponse[]; navigate: Navigate }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const meetings = useLoad(() => (armed ? mtgApi.listMeetings({ limit: 100 }).then(p => p.items) : Promise.resolve([] as mtgApi.MeetingResponse[])), [armed]);
  const tasks = useLoad<MyTaskRow[]>(() => (armed && user.userId ? loadMyTasks(user.userId) : Promise.resolve([])), [armed, user.userId]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); inputRef.current?.focus(); } };
    const h = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("keydown", k);
    document.addEventListener("mousedown", h);
    return () => { document.removeEventListener("keydown", k); document.removeEventListener("mousedown", h); };
  }, []);

  const needle = q.trim().toLowerCase();
  const results = useMemo(() => {
    if (!needle) return null;
    const has = (s: string) => s.toLowerCase().includes(needle);
    return {
      tasks: (tasks.data ?? []).filter(t => has(t.title) || has(t.projectName)).slice(0, 4),
      projects: projects.filter(p => has(p.name)).slice(0, 4),
      meetings: (meetings.data ?? []).filter(m => has(m.title)).slice(0, 4),
    };
  }, [needle, tasks.data, meetings.data, projects]);
  const empty = results && !results.tasks.length && !results.projects.length && !results.meetings.length;
  const pending = armed && (tasks.loading || meetings.loading);

  function pick(go: () => void) { go(); setOpen(false); setQ(""); inputRef.current?.blur(); }
  const Group = ({ label, children }: { label: string; children: ReactNode }) => (
    <div className="py-1.5"><p className="px-4 py-1 text-[10px] font-bold tracking-wider text-slate-400">{label}</p>{children}</div>
  );
  const Item = ({ text, sub, onClick }: { text: string; sub?: string; onClick: () => void }) => (
    <button onClick={() => pick(onClick)} className="w-full text-left px-4 py-1.5 hover:bg-slate-50 flex items-baseline gap-2">
      <span className="text-[13px] text-slate-800 truncate">{text}</span>{sub && <span className="text-[11px] text-slate-400 truncate">{sub}</span>}
    </button>
  );

  return (
    <div ref={boxRef} className="relative w-[360px] max-w-full">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><SearchIcon /></span>
      <input ref={inputRef} value={q} role="combobox" aria-expanded={open && !!needle} aria-label="회의, 프로젝트, 업무 검색" placeholder="회의, 프로젝트, 업무 검색" maxLength={100}
        onFocus={() => { setArmed(true); setOpen(true); }} onChange={e => { setQ(e.target.value); setOpen(true); }}
        onKeyDown={e => { if (e.key === "Escape") { setOpen(false); inputRef.current?.blur(); } }}
        className="w-full h-9 pl-9 pr-14 rounded-lg bg-slate-50 border border-slate-200 text-[13px] text-slate-700 placeholder-slate-400 outline-none focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-colors" />
      <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 border border-slate-200 rounded px-1.5 py-0.5 bg-white pointer-events-none">Ctrl K</kbd>
      {open && needle && (
        <div className="absolute left-0 right-0 top-full mt-2 bg-white border border-slate-200 rounded-xl shadow-[0_8px_30px_rgba(15,23,42,0.12)] z-50 max-h-96 overflow-y-auto divide-y divide-slate-50">
          {pending && !results?.tasks.length && !results?.meetings.length && !results?.projects.length && <p className="text-[12px] text-slate-400 px-4 py-4">검색 대상을 불러오는 중...</p>}
          {!pending && empty && <p className="text-[12px] text-slate-400 px-4 py-4">“{q.trim()}”에 대한 결과가 없습니다.</p>}
          {results && results.tasks.length > 0 && <Group label="내 업무">{results.tasks.map(t => <Item key={t.taskId} text={t.title} sub={t.projectName} onClick={() => navigate("tasks", { taskId: t.taskId })} />)}</Group>}
          {results && results.projects.length > 0 && <Group label="프로젝트">{results.projects.map(p => <Item key={p.projectId} text={p.name} onClick={() => navigate("project-detail", { projectId: p.projectId })} />)}</Group>}
          {results && results.meetings.length > 0 && <Group label="회의">{results.meetings.map(m => <Item key={m.meetingId} text={m.title} onClick={() => navigate("meeting-detail", { meetingId: m.meetingId })} />)}</Group>}
          {(tasks.error || meetings.error) && <p className="text-[11px] text-amber-600 px-4 py-2">일부 항목을 불러오지 못해 결과가 일부만 표시됩니다.</p>}
        </div>
      )}
    </div>
  );
}

export default function WorkspaceShell({ user, screen, navigate, breadcrumb, projects, notif, activeProjectId, onLogout, onOpenAccount, children }: {
  user: CurrentUser; screen: Screen; navigate: Navigate; breadcrumb: string[]; projects: ProjectResponse[]; notif: NotificationCenter;
  activeProjectId?: string; onLogout: () => void; onOpenAccount: () => void; children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const title = breadcrumb[breadcrumb.length - 1];
  return (
    <div className="flex h-full overflow-hidden bg-white">
      <Sidebar user={user} screen={screen} navigate={navigate} projects={projects} collapsed={collapsed} onToggle={() => setCollapsed(c => !c)} onOpenAccount={onOpenAccount} activeProjectId={activeProjectId} />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="shrink-0 h-[68px] flex items-center justify-between gap-4 px-8 border-b border-slate-200/80 bg-white">
          <div className="min-w-0">
            <p className="flex items-center gap-1 text-[11px] text-slate-400 font-medium truncate">
              {breadcrumb.slice(0, -1).map((b, i) => <span key={i} className="flex items-center gap-1">{i > 0 && <span className="text-slate-300">/</span>}{b}</span>)}
            </p>
            <h1 className="text-[15px] font-bold text-slate-900 leading-tight truncate">{title}</h1>
          </div>
          <div className="flex items-center gap-3 min-w-0">
            <GlobalSearch user={user} projects={projects} navigate={navigate} />
            <NotificationBell notif={notif} navigate={navigate} />
            <div className="w-px h-6 bg-slate-200" />
            <UserMenu user={user} onLogout={onLogout} onOpenAccount={onOpenAccount} />
          </div>
        </header>
        <main className="flex-1 min-h-0 relative overflow-hidden bg-white">{children}</main>
      </div>
    </div>
  );
}
