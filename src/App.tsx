import { useState, useEffect, useMemo } from "react";
import { USE_MOCK } from "./api/config";
import { mockDemoUserId } from "./api/mock";
import { getOrganization } from "./api/identity";
import type { CurrentUserResponse, OrganizationDirectoryResponse } from "./api/identity";
import * as projectApi from "./api/project";
import AdminShell from "./admin/AdminShell";
import CompanyAdminScreen, { isAdminTab } from "./admin/CompanyAdmin";
import type { AdminTab } from "./admin/CompanyAdmin";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import LoginScreen from "./auth/LoginScreen";
import MyAccountModal from "./auth/MyAccountModal";
import ProjectsScreen from "./projects/ProjectsScreen";
import ProjectDetailScreen from "./projects/ProjectDetailScreen";
import MyTasksScreen from "./projects/MyTasksScreen";
import DocumentDetailScreen from "./documents/DocumentDetailScreen";
import MeetingsScreen from "./meetings/MeetingsScreen";
import MeetingDetailScreen from "./meetings/MeetingDetailScreen";
import PostprocessPopup from "./meetings/PostprocessPopup";
import AIScreen from "./ai/AIScreen";
import { useNotificationCenter } from "./notifications/shared";
import NotificationToasts from "./notifications/NotificationToasts";
import { useLoad } from "./ui/kit";
import HomeScreen from "./workspace/HomeScreen";
import WorkspaceShell from "./workspace/WorkspaceShell";
import { isAdminScreen } from "./workspace/nav";
import type { CurrentUser, NavCtx, Screen } from "./workspace/nav";

// ─── Demo users (mock 모드에서 Identity 응답에 데모 표시 이름·팀을 입히는 용도) ───────────────
const DEMO_USERS: CurrentUser[] = [
  { id: 1, name: "이원재", avatar: "원", color: "#4f6ef7", team: "프론트엔드팀", companyRole: "EMPLOYEE" },
  { id: 2, name: "김규찬", avatar: "규", color: "#0891b2", team: "백엔드팀", companyRole: "EMPLOYEE" },
  { id: 3, name: "박인성", avatar: "인", color: "#059669", team: "관리팀", companyRole: "ADMIN" },
];

// ─── Common State Components ──────────────────────────────────────────────────
function LoadingState({ message = "불러오는 중..." }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 py-16">
      <span className="w-8 h-8 border-[3px] border-slate-200 border-t-indigo-500 rounded-full animate-spin" />
      <p className="text-[13px] text-slate-500 font-medium">{message}</p>
    </div>
  );
}

function AccessDenied({ message }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-16">
      <div className="w-14 h-14 rounded-2xl bg-rose-50 flex items-center justify-center text-rose-400">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
      </div>
      <div><p className="text-[14px] font-bold text-slate-700">접근 권한이 없습니다</p><p className="text-[12px] text-slate-400 mt-1">{message ?? "이 항목을 볼 수 있는 권한이 없습니다."}</p></div>
    </div>
  );
}

// ─── App Shell ────────────────────────────────────────────────────────────────
// Identity(01) 응답을 화면 도메인 사용자로 변환한다. 프로젝트 권한은 여기서 만들지 않는다 — Project 서비스가 돌려주는
// 내 역할(myRole)과 접근 범위만 신뢰하며, companyRole(ADMIN)은 관리자 콘솔 진입 여부에만 쓴다.
const AVATAR_COLORS = ["#4f6ef7","#0891b2","#059669","#dc2626","#d97706","#7c3aed","#be185d","#0d9488","#ea580c","#6366f1"];
function colorFor(seed: string) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
// /api/users/me는 부서·팀 ID만 주므로 이름은 조직 디렉터리(/api/organization)에서 찾는다.
function toCurrentUser(me: CurrentUserResponse, org: OrganizationDirectoryResponse | null): CurrentUser {
  const demo = USE_MOCK ? DEMO_USERS.find(d => d.id === mockDemoUserId(me.email)) : undefined;
  const team = org?.teams.find(t => t.id === me.teamId)?.name ?? org?.departments.find(d => d.id === me.departmentId)?.name ?? "";
  if (demo) return { ...demo, userId: me.userId, name: me.displayName, avatar: me.displayName.charAt(0), team: team || demo.team, companyRole: me.companyRole };
  return { id: -1, userId: me.userId, name: me.displayName, avatar: me.displayName.charAt(0), color: colorFor(me.userId), team, companyRole: me.companyRole };
}

export default function App() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
}

function AuthGate() {
  const { status, me } = useAuth();
  if (status === "loading") return <div className="h-full bg-slate-50"><LoadingState message="세션을 확인하는 중..." /></div>;
  if (status === "anonymous" || !me) return <LoginScreen />;
  return <MainApp key={me.userId} me={me} />;
}

const BREADCRUMBS: Partial<Record<Screen, string[]>> = {
  home:               ["Anok", "홈"],
  projects:           ["Anok", "Work", "프로젝트"],
  "project-detail":   ["Anok", "Work", "프로젝트", "상세"],
  tasks:              ["Anok", "Work", "내 업무"],
  meetings:           ["Anok", "Work", "회의"],
  "meeting-detail":   ["Anok", "Work", "회의", "상세"],
  "document-detail":  ["Anok", "Work", "회의", "자료"],
  ai:                 ["Anok", "Ask ANOK"],
};

function MainApp({ me }: { me: CurrentUserResponse }) {
  const { logout } = useAuth();
  const [org, setOrg] = useState<OrganizationDirectoryResponse | null>(null);
  useEffect(() => {
    let alive = true;
    getOrganization().then(o => { if (alive) setOrg(o); }).catch(() => { /* 이름 표시만 비므로 조용히 무시 */ });
    return () => { alive = false; };
  }, [me.userId, me.teamId, me.departmentId]);
  const user = useMemo(() => toCurrentUser(me, org), [me, org]);
  const [showAccount, setShowAccount] = useState(false);
  const [screen, setScreen] = useState<Screen>("home");
  const [ctx, setCtx] = useState<NavCtx>({});
  const notif = useNotificationCenter(user.userId);
  // 내가 참여한 프로젝트(서버가 내 접근 범위만 돌려준다). 사이드바·홈·검색이 함께 쓴다.
  const projectsLoad = useLoad(() => projectApi.listProjects({ limit: 100 }).then(p => p.items), [me.userId]);
  const projects = projectsLoad.data ?? [];

  // 화면을 옮길 때마다 이전 화면의 맥락(열린 업무 등)을 비운다.
  function navigate(s: Screen, newCtx?: NavCtx) {
    setScreen(s);
    setCtx(newCtx ?? {});
  }

  const isAdmin = user.companyRole === "ADMIN";
  const adminTab: AdminTab = isAdminTab(ctx.adminTab) ? ctx.adminTab : "회사설정";

  // 관리자 콘솔: 딥 네이비 셸. ADMIN만 들어갈 수 있고, 아니면 업무 공간의 접근 불가 화면을 보여 준다.
  if (isAdminScreen(screen) && isAdmin) {
    return (
      <>
        <AdminShell user={user} tab={adminTab} onTabChange={t => navigate("company-admin", { adminTab: t })} navigate={navigate} onLogout={logout} onOpenAccount={() => setShowAccount(true)}>
          <CompanyAdminScreen tab={adminTab} />
        </AdminShell>
        {showAccount && <MyAccountModal onClose={() => setShowAccount(false)} />}
      </>
    );
  }

  const breadcrumb = isAdminScreen(screen) ? ["Anok", "관리자 콘솔"] : BREADCRUMBS[screen] ?? ["Anok"];

  return (
    <>
      <WorkspaceShell user={user} screen={screen} navigate={navigate} breadcrumb={breadcrumb} projects={projects} notif={notif}
        activeProjectId={ctx.projectId} onLogout={logout} onOpenAccount={() => setShowAccount(true)}>
        {screen === "home"              && <HomeScreen user={user} navigate={navigate} projects={projects} projectsLoading={projectsLoad.loading} projectsError={projectsLoad.error} reloadProjects={projectsLoad.reload} />}
        {screen === "projects"          && <ProjectsScreen navigate={navigate} onProjectsChanged={projectsLoad.reload} />}
        {screen === "project-detail"    && (ctx.projectId ? <ProjectDetailScreen projectId={ctx.projectId} navigate={navigate} initialTab={ctx.projectTab} /> : <AccessDenied />)}
        {screen === "tasks"             && <MyTasksScreen navigate={navigate} initialTaskId={ctx.taskId} />}
        {screen === "meetings"          && <MeetingsScreen navigate={navigate} />}
        {screen === "meeting-detail"    && (ctx.meetingId ? <MeetingDetailScreen meetingId={ctx.meetingId} navigate={navigate} /> : <AccessDenied />)}
        {screen === "document-detail"   && (ctx.docId ? <DocumentDetailScreen docId={ctx.docId} backMeetingId={ctx.fromMeetingId} navigate={navigate} /> : <AccessDenied />)}
        {screen === "ai"                && <AIScreen key={ctx.aiQuestion ?? ""} initialQuestion={ctx.aiQuestion} />}
        {screen === "company-admin"     && <AccessDenied message="회사 관리자만 접근할 수 있습니다." />}
      </WorkspaceShell>
      <PostprocessPopup navigate={navigate} />
      <NotificationToasts latest={notif.latest} navigate={navigate} onRead={notif.markRead} />
      {showAccount && <MyAccountModal onClose={() => setShowAccount(false)} />}
    </>
  );
}
