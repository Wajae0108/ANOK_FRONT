import { useState, useRef, useEffect, useMemo } from "react";
import { USE_MOCK } from "./api/config";
import { mockDemoUserId } from "./api/mock";
import type { CurrentUserResponse } from "./api/identity";
import CompanyAdminScreen from "./admin/CompanyAdmin";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import LoginScreen from "./auth/LoginScreen";
import MyAccountModal from "./auth/MyAccountModal";
import ProjectsScreen from "./projects/ProjectsScreen";
import ProjectDetailScreen from "./projects/ProjectDetailScreen";
import MyTasksScreen from "./projects/MyTasksScreen";
import DocumentDetailScreen from "./documents/DocumentDetailScreen";
import MeetingsScreen from "./meetings/MeetingsScreen";
import MeetingDetailScreen from "./meetings/MeetingDetailScreen";
import AIScreen from "./ai/AIScreen";
import { fmtDateTime, useMyMeetingsSummary } from "./meetings/shared";
import { CategoryBadge, fmtRelative, presentationText, targetForNotification, useNotificationCenter } from "./notifications/shared";
import type { NotificationCenter } from "./notifications/shared";
import type { NotificationResponse } from "./api/notification";

// ─── Permission Types ─────────────────────────────────────────────────────────
type CompanyRole = "ADMIN" | "EMPLOYEE";
type ProjectRole = "MANAGER" | "MEMBER" | "VIEWER";

interface CurrentUser {
  id: number;
  userId?: string;
  name: string;
  avatar: string;
  color: string;
  team: string;
  companyRole: CompanyRole;
  projectRoles: Record<number, ProjectRole>;
}

// ─── Screen Types ─────────────────────────────────────────────────────────────
type Screen =
  | "home"
  | "projects" | "project-detail"
  | "tasks"
  | "meetings" | "meeting-detail"
  | "document-detail"
  | "ai"
  | "notifications"
  | "company-admin";

// ─── Nav Context ──────────────────────────────────────────────────────────────
interface NavCtx {
  projectId?: string;
  meetingId?: string;
  docId?: string;
  fromMeetingId?: string;
  projectTab?: string;
}

// ─── Data ─────────────────────────────────────────────────────────────────────
const DEMO_USERS: CurrentUser[] = [
  { id: 1, name: "이원재", avatar: "원", color: "#4f6ef7", team: "프론트엔드팀", companyRole: "EMPLOYEE",
    projectRoles: { 1: "MEMBER", 2: "MANAGER", 3: "VIEWER" } },
  { id: 2, name: "김규찬", avatar: "규", color: "#0891b2", team: "백엔드팀", companyRole: "EMPLOYEE",
    projectRoles: { 1: "MANAGER", 2: "MEMBER" } },
  { id: 3, name: "박인성", avatar: "인", color: "#059669", team: "관리팀", companyRole: "ADMIN",
    projectRoles: {} },
];

const PEOPLE = [
  { id: 1,  name: "이원재", avatar: "원", color: "#4f6ef7", role: "프론트엔드 개발자", team: "개발부" },
  { id: 2,  name: "김규찬", avatar: "규", color: "#0891b2", role: "백엔드 개발자",    team: "개발부" },
  { id: 3,  name: "박민준", avatar: "민", color: "#059669", role: "데이터 엔지니어",  team: "데이터팀" },
  { id: 4,  name: "최다영", avatar: "다", color: "#dc2626", role: "AI 엔지니어",      team: "AI팀" },
  { id: 5,  name: "정서연", avatar: "서", color: "#d97706", role: "풀스택 개발자",    team: "개발부" },
  { id: 6,  name: "한승우", avatar: "한", color: "#0d9488", role: "DevOps 엔지니어",  team: "인프라팀" },
  { id: 7,  name: "오지현", avatar: "지", color: "#be185d", role: "UI/UX 디자이너",   team: "디자인팀" },
  { id: 8,  name: "윤태양", avatar: "태", color: "#1d4ed8", role: "프로덕트 매니저",  team: "기획팀" },
];

const PROJECTS = [
  { id: 1, name: "인증 시스템 개편", status: "진행", progress: 62, desc: "기존 세션 기반 인증을 OAuth 2.0으로 전환합니다.", startDate: "2026-09-01", endDate: "2026-10-31", members: [1,2,5,8] },
  { id: 2, name: "AI 회의록 파이프라인", status: "진행", progress: 38, desc: "회의 녹음 → STT → AI 분석 → 회의록 초안 자동 생성 파이프라인 구축", startDate: "2026-09-08", endDate: "2026-11-30", members: [1,2,3,4,6] },
  { id: 3, name: "대시보드 리뉴얼", status: "대기", progress: 12, desc: "사용자 대시보드 전면 개편 및 다크모드 지원", startDate: "2026-10-01", endDate: "2026-11-15", members: [1,7,8] },
  { id: 4, name: "알림 시스템 고도화", status: "진행", progress: 45, desc: "실시간 WebSocket 기반 알림 시스템 구축", startDate: "2026-09-10", endDate: "2026-10-20", members: [2,5] },
];

const TASKS = [
  { id: 1,  title: "OAuth 2.0 Provider 연동 API 개발", projectId: 1, assigneeId: 1, due: "2026-09-25", priority: "높음", status: "진행 중", sourceDecisionId: 1, sourceMeetingId: 1 },
  { id: 2,  title: "소셜 로그인 UI 컴포넌트 수정",     projectId: 1, assigneeId: 1, due: "2026-09-28", priority: "중간", status: "대기",   sourceDecisionId: null, sourceMeetingId: null },
  { id: 3,  title: "JWT Refresh Token 로직 구현",       projectId: 1, assigneeId: 2, due: "2026-09-30", priority: "높음", status: "진행 중", sourceDecisionId: 1, sourceMeetingId: 1 },
  { id: 4,  title: "RAG 파이프라인 초기 구현",          projectId: 2, assigneeId: 4, due: "2026-10-15", priority: "높음", status: "진행 중", sourceDecisionId: 2, sourceMeetingId: 2 },
  { id: 5,  title: "LLM 추출 프롬프트 설계",           projectId: 2, assigneeId: 4, due: "2026-10-01", priority: "높음", status: "대기",   sourceDecisionId: 2, sourceMeetingId: 2 },
  { id: 6,  title: "회의록 파싱 모듈 개발",             projectId: 2, assigneeId: 1, due: "2026-10-10", priority: "중간", status: "대기",   sourceDecisionId: null, sourceMeetingId: null },
  { id: 7,  title: "대시보드 메인 레이아웃 리디자인",   projectId: 3, assigneeId: 7, due: "2026-10-08", priority: "중간", status: "대기",   sourceDecisionId: null, sourceMeetingId: null },
  { id: 8,  title: "알림 설정 API 연동",               projectId: 4, assigneeId: 2, due: "2026-09-27", priority: "높음", status: "진행 중", sourceDecisionId: null, sourceMeetingId: null },
];

// 알림 클릭 시 실제 접근 권한은 대상 화면(ProjectDetailScreen/MeetingDetailScreen 등) 자신이 재검증한다(Notification != Authorization).
function goToNotification(n: NotificationResponse, navigate: (s: Screen, ctx?: NavCtx) => void) {
  const target = targetForNotification(n);
  if (target) navigate(target.screen as Screen, target.ctx as NavCtx);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function nowTime() {
  return new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}
function person(id: number) { return PEOPLE.find(p => p.id === id) ?? PEOPLE[0]; }
function project(id: number) { return PROJECTS.find(p => p.id === id); }

const PRIORITY_BADGE: Record<string, string> = {
  "높음": "bg-rose-50 text-rose-600 border border-rose-100",
  "중간": "bg-amber-50 text-amber-600 border border-amber-100",
  "낮음": "bg-emerald-50 text-emerald-600 border border-emerald-100",
};
const STATUS_BADGE_CLS: Record<string, string> = {
  "예정": "bg-indigo-50 text-indigo-600",
  "종료": "bg-slate-100 text-slate-500",
  "진행 중": "bg-emerald-50 text-emerald-600",
  "진행": "bg-indigo-50 text-indigo-600",
  "대기": "bg-slate-100 text-slate-500",
  "완료": "bg-emerald-50 text-emerald-600",
  "확정": "bg-emerald-50 text-emerald-600",
  "초안": "bg-amber-50 text-amber-600",
};

// ─── Common Components ────────────────────────────────────────────────────────
function Avatar({ name, color, size = "sm", imageUrl }: { name: string; color?: string; size?: "xs" | "sm" | "md"; imageUrl?: string | null }) {
  const sz = size === "xs" ? "w-6 h-6 text-[10px]" : size === "sm" ? "w-8 h-8 text-[12px]" : "w-10 h-10 text-[14px]";
  if (imageUrl) {
    return <img src={imageUrl} alt={name} className={`${sz} rounded-full object-cover shrink-0 ring-2 ring-white`} />;
  }
  return (
    <div className={`${sz} rounded-full flex items-center justify-center font-bold text-white shrink-0 ring-2 ring-white`}
      style={{ backgroundColor: color ?? "#4f6ef7" }}>
      {name}
    </div>
  );
}

function Badge({ label, className }: { label: string; className?: string }) {
  return <span className={`inline-flex items-center text-[10px] font-semibold tracking-wide px-2.5 py-0.5 rounded-full ${className ?? ""}`}>{label}</span>;
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-white border border-slate-100 rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.05)] ${className ?? ""}`}>{children}</div>;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.12em] mb-2">{children}</p>;
}

// ─── State Components ─────────────────────────────────────────────────────────
// ─── Common State Components ──────────────────────────────────────────────────

function EmptyState({ icon, title, desc, action }: { icon?: React.ReactNode; title: string; desc?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-16 px-6">
      {icon && <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400">{icon}</div>}
      <div><p className="text-[14px] font-bold text-slate-700">{title}</p>{desc && <p className="text-[12px] text-slate-400 mt-1">{desc}</p>}</div>
      {action}
    </div>
  );
}

function LoadingState({ message = "불러오는 중..." }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 py-16">
      <div className="relative w-14 h-14">
        <div className="absolute inset-0 rounded-full border-4 border-slate-100" />
        <div className="absolute inset-0 rounded-full border-4 border-t-indigo-500 animate-spin" />
        <div className="absolute inset-2 rounded-full bg-indigo-50 flex items-center justify-center">
          <div className="w-2 h-2 rounded-full bg-indigo-400" />
        </div>
      </div>
      <p className="text-[13px] text-slate-500 font-medium">{message}</p>
    </div>
  );
}

function ErrorState({ title, desc, onRetry }: { title?: string; desc?: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 py-16 px-6 text-center">
      <div className="w-14 h-14 rounded-2xl bg-rose-50 flex items-center justify-center text-rose-400">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      </div>
      <div>
        <p className="text-[14px] font-bold text-slate-700">{title ?? "오류가 발생했습니다"}</p>
        <p className="text-[12px] text-slate-400 mt-1">{desc ?? "잠시 후 다시 시도해 주세요."}</p>
      </div>
      {onRetry && (
        <button onClick={onRetry}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 hover:border-indigo-300 text-slate-700 hover:text-indigo-600 text-[13px] font-semibold rounded-xl transition-colors">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
          다시 시도
        </button>
      )}
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

function SessionExpired({ onLogin }: { onLogin?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 py-16 text-center">
      <div className="w-14 h-14 rounded-2xl bg-amber-50 flex items-center justify-center text-amber-400">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
      </div>
      <div>
        <p className="text-[14px] font-bold text-slate-700">세션이 만료되었습니다</p>
        <p className="text-[12px] text-slate-400 mt-1">보안을 위해 자동으로 로그아웃되었습니다. 다시 로그인해 주세요.</p>
      </div>
      {onLogin && (
        <button onClick={onLogin} className="px-5 py-2.5 bg-indigo-500 hover:bg-indigo-600 text-white text-[13px] font-bold rounded-xl transition-colors">
          다시 로그인
        </button>
      )}
    </div>
  );
}

function SaveStatus({ status }: { status: "saving" | "saved" | "error" }) {
  if (status === "saving") return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400 font-medium">
      <span className="w-3.5 h-3.5 border-2 border-slate-300 border-t-indigo-400 rounded-full animate-spin" />저장 중...
    </span>
  );
  if (status === "saved") return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-600 font-semibold">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>저장됨
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-rose-500 font-semibold">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>저장 실패
    </span>
  );
}

function ProcessingBadge({ status }: { status: "processing" | "draft" | "confirmed" }) {
  if (status === "processing") return <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-600 bg-amber-50 border border-amber-100 rounded-full px-2.5 py-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />처리 중</span>;
  if (status === "draft") return <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-full px-2.5 py-1"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>AI 초안 · 검토 필요</span>;
  return <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-full px-2.5 py-1"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>확정 완료</span>;
}

// ─── Nav Icons ────────────────────────────────────────────────────────────────
const Icons = {
  home:    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  folder:  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>,
  check:   <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>,
  video:   <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>,
  file:    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
  ai:      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>,
  bell:    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
  building:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="M3 9h6"/><path d="M3 15h6"/></svg>,
  chevronR:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><polyline points="9 18 15 12 9 6"/></svg>,
  plus:    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  back:    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>,
  mic:     <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>,
  micOff:  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>,
  record:  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8" fill="#ef4444"/></svg>,
};

// ─── Sidebar ──────────────────────────────────────────────────────────────────
interface NavAction { screen: Screen; label: string; icon: React.ReactNode; badge?: number; adminOnly?: boolean }

function Sidebar({ user, screen, navigate, unreadCount }: { user: CurrentUser; screen: Screen; navigate: (s: Screen, ctx?: NavCtx) => void; unreadCount: number }) {
  const unread = unreadCount;
  const { needsReview } = useMyMeetingsSummary(user.userId);
  const reviewPending = needsReview.length;
  const isAdmin = user.companyRole === "ADMIN";

  const navItems: NavAction[] = [
    { screen: "home",          label: "홈",       icon: Icons.home },
    { screen: "projects",      label: "프로젝트", icon: Icons.folder },
    { screen: "tasks",         label: "내 업무",  icon: Icons.check },
    { screen: "meetings",      label: "회의",     icon: Icons.video },
    { screen: "ai",            label: "AI 질문",  icon: Icons.ai },
    { screen: "notifications", label: "알림",     icon: Icons.bell, badge: unread },
    { screen: "company-admin", label: "회사 관리",icon: Icons.building, adminOnly: true },
  ];

  const meetingScreens: Screen[] = ["meeting-detail"];
  const projectScreens: Screen[] = ["project-detail"];

  function isActive(item: NavAction) {
    if (item.screen === "meetings") return screen === "meetings" || meetingScreens.includes(screen);
    if (item.screen === "projects") return screen === "projects" || projectScreens.includes(screen);
    return screen === item.screen;
  }

  return (
    <aside className="w-[220px] shrink-0 flex flex-col h-full" style={{ backgroundColor: "#0c1120" }}>
      <div className="px-5 pt-6 pb-5">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl shrink-0 flex items-center justify-center" style={{ background: "linear-gradient(135deg,#6366f1,#4f6ef7)" }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
          <div>
            <p className="text-[16px] font-extrabold text-white tracking-tight leading-none">Anok</p>
            <p className="text-[9px] text-white/25 font-medium tracking-widest uppercase mt-0.5">(주)아녹 테크</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto py-2 px-3 space-y-0.5">
        {navItems.filter(i => !i.adminOnly || isAdmin).map(item => {
          const active = isActive(item);
          return (
            <button key={item.screen} onClick={() => navigate(item.screen)}
              className="relative w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all duration-150 text-[13px] font-medium"
              style={active ? { backgroundColor: "rgba(79,110,247,0.18)", boxShadow: "inset 0 0 0 1px rgba(79,110,247,0.25)" } : {}}>
              {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full bg-indigo-400" />}
              <span style={{ color: active ? "#a5b4fc" : "rgba(255,255,255,0.4)" }}>{item.icon}</span>
              <span style={{ color: active ? "#e0e7ff" : "rgba(255,255,255,0.5)" }}>{item.label}</span>
              {item.badge ? <span className="ml-auto w-5 h-5 rounded-full bg-rose-500 flex items-center justify-center text-[10px] font-bold text-white">{item.badge}</span> : null}
            </button>
          );
        })}
      </nav>

      {reviewPending > 0 && (
        <div className="px-3 pb-4">
          <button onClick={() => navigate("meetings")}
            className="w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-left transition-all"
            style={{ background: "linear-gradient(135deg,rgba(79,110,247,0.22),rgba(99,102,241,0.12))", border: "1px solid rgba(79,110,247,0.28)" }}>
            <div className="w-7 h-7 rounded-lg bg-indigo-500/25 flex items-center justify-center shrink-0">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-semibold text-indigo-200">검토 대기</p>
              <p className="text-[10px] text-indigo-400/70">{reviewPending}건 확인 필요</p>
            </div>
            <span className="w-5 h-5 rounded-full bg-rose-500 flex items-center justify-center text-[10px] font-bold text-white shrink-0">{reviewPending}</span>
          </button>
        </div>
      )}
    </aside>
  );
}

// ─── Header ───────────────────────────────────────────────────────────────────
function Header({ user, breadcrumb, onLogout, onOpenAccount, notif, navigate }: {
  user: CurrentUser; screen: Screen; breadcrumb: string[];
  onLogout: () => void; onOpenAccount: () => void; notif: NotificationCenter; navigate: (s: Screen, ctx?: NavCtx) => void;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const [showNotif, setShowNotif] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false);
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setShowNotif(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const roleColors: Record<CompanyRole, string> = { ADMIN: "#7c3aed", EMPLOYEE: "#10b981" };

  return (
    <header className="shrink-0 h-[58px] flex items-center justify-between px-6 bg-white/95 backdrop-blur border-b border-slate-100 z-10">
      <div>
        <div className="flex items-center gap-1 text-[10px] text-slate-400 mb-0.5 font-medium">
          {breadcrumb.map((b, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span className="text-slate-300">/</span>}
              <span className={i === breadcrumb.length - 1 ? "text-slate-600 font-semibold" : ""}>{b}</span>
            </span>
          ))}
        </div>
        <h1 className="text-[15px] font-bold text-slate-900 leading-none">{breadcrumb[breadcrumb.length - 1]}</h1>
      </div>

      <div className="flex items-center gap-2">
        {/* Notification bell */}
        <div className="relative" ref={notifRef}>
          <button onClick={() => setShowNotif(v => !v)} className="relative w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition-colors">
            {Icons.bell}
            {notif.unreadCount > 0 && <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-rose-500" />}
          </button>
          {showNotif && (
            <div className="absolute right-0 top-full mt-2 w-80 bg-white border border-slate-100 rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] z-50 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                <p className="text-[13px] font-bold text-slate-800">알림</p>
                <button onClick={() => notif.markAllRead()} className="text-[11px] text-indigo-500 font-medium hover:text-indigo-700">모두 읽음</button>
              </div>
              <div className="max-h-80 overflow-y-auto divide-y divide-slate-50">
                {notif.items.length === 0 && <p className="text-[12px] text-slate-400 text-center py-8">알림이 없습니다.</p>}
                {notif.items.slice(0, 8).map(n => (
                  <div key={n.notificationId} onClick={() => { notif.markRead(n.notificationId); setShowNotif(false); goToNotification(n, navigate); }}
                    className={`px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors ${!n.read ? "bg-indigo-50/40" : ""}`}>
                    <div className="flex items-start gap-3">
                      <div className={`w-2 h-2 rounded-full mt-2 shrink-0 ${!n.read ? "bg-indigo-500" : "bg-slate-200"}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <CategoryBadge type={n.notificationType} />
                          <span className="text-[10px] text-slate-300">{fmtRelative(n.createdAt)}</span>
                        </div>
                        <p className={`text-[13px] leading-snug ${!n.read ? "font-semibold text-slate-900" : "text-slate-700"}`}>{presentationText(n)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={() => { setShowNotif(false); navigate("notifications"); }} className="w-full py-2.5 text-[12px] text-slate-400 hover:text-indigo-500 font-medium border-t border-slate-50 transition-colors">전체 알림 보기</button>
            </div>
          )}
        </div>

        <div className="w-px h-5 bg-slate-100 mx-1" />

        {/* User menu */}
        <div className="relative" ref={menuRef}>
          <button onClick={() => setShowMenu(v => !v)} className="flex items-center gap-2.5 pl-2 pr-3 py-1.5 rounded-xl hover:bg-slate-50 transition-colors">
            <div className="relative">
              <Avatar name={user.avatar} color={user.color} size="sm" />
              <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white" style={{ backgroundColor: roleColors[user.companyRole] }} />
            </div>
            <div className="text-left">
              <p className="text-[13px] font-semibold text-slate-800 leading-tight">{user.name}</p>
              <p className="text-[10px] text-slate-400 leading-none mt-0.5">{user.companyRole === "ADMIN" ? "회사 관리자" : "직원"}</p>
            </div>
            <svg className={`w-3.5 h-3.5 text-slate-300 transition-transform ${showMenu ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          {showMenu && (
            <div className="absolute right-0 top-full mt-2 bg-white border border-slate-100 rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] z-50 py-2 w-48 overflow-hidden">
              <button onClick={() => { onOpenAccount(); setShowMenu(false); }}
                className="w-full text-left px-4 py-2.5 text-[13px] font-medium text-slate-700 hover:bg-slate-50 transition-colors">내 계정</button>
              <button onClick={() => { onLogout(); setShowMenu(false); }}
                className="w-full text-left px-4 py-2.5 text-[13px] font-medium text-rose-500 hover:bg-rose-50 transition-colors">로그아웃</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

// ─── Home Screen ──────────────────────────────────────────────────────────────
function HomeScreen({ user, navigate, notif }: { user: CurrentUser; navigate: (s: Screen, ctx?: NavCtx) => void; notif: NotificationCenter }) {
  const myTasks = TASKS.filter(t => t.assigneeId === user.id);
  const urgentTasks = myTasks.filter(t => {
    const days = Math.ceil((new Date(t.due).getTime() - Date.now()) / 86400000);
    return days <= 3 && t.status !== "완료";
  });
  const { upcoming: upcomingMeetings, needsReview } = useMyMeetingsSummary(user.userId);
  const recentNotifs = notif.items.slice(0, 3);

  const todayStr = new Date().toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "long" });

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6 bg-slate-50/40">
      <div>
        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-1">{todayStr}</p>
        <h2 className="text-[22px] font-extrabold text-slate-900">안녕하세요, {user.name}님</h2>
        <p className="text-[13px] text-slate-400 mt-0.5">오늘 처리할 항목을 확인해 보세요.</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "배정된 업무", value: myTasks.length, color: "#4f6ef7", sub: `진행 중 ${myTasks.filter(t=>t.status==="진행 중").length}건` },
          { label: "기한 임박", value: urgentTasks.length, color: "#e11d48", sub: "3일 이내 마감" },
          { label: "예정 회의", value: upcomingMeetings.length, color: "#7c3aed", sub: "오늘 포함" },
          { label: "검토 대기", value: needsReview.length, color: "#d97706", sub: "확인 필요" },
        ].map(s => (
          <Card key={s.label} className="p-5 flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: s.color + "15" }}>
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: s.color }} />
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{s.label}</p>
              <p className="text-[24px] font-extrabold text-slate-800 leading-none mt-0.5">{s.value}</p>
              <p className="text-[11px] text-slate-400 mt-1">{s.sub}</p>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* My tasks */}
        <Card className="col-span-2 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2"><div className="w-1.5 h-5 rounded-full bg-indigo-400" /><h3 className="text-[14px] font-bold text-slate-800">배정된 업무</h3></div>
            <button onClick={() => navigate("tasks")} className="text-[11px] text-indigo-500 font-semibold hover:text-indigo-700">전체 보기 →</button>
          </div>
          {myTasks.length === 0 ? <EmptyState title="배정된 업무가 없습니다" icon={Icons.check} /> : (
            <div className="space-y-1">
              {myTasks.slice(0, 5).map(t => {
                const days = Math.ceil((new Date(t.due).getTime() - Date.now()) / 86400000);
                const overdue = days < 0;
                return (
                  <div key={t.id} onClick={() => navigate("tasks")}
                    className="flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer">
                    <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${t.status === "진행 중" ? "bg-indigo-400" : "bg-slate-200"}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-slate-800 truncate">{t.title}</p>
                      <p className="text-[11px] text-slate-400">{project(t.projectId)?.name}</p>
                    </div>
                    <Badge label={t.priority} className={PRIORITY_BADGE[t.priority]} />
                    <span className={`text-[11px] font-semibold shrink-0 ${overdue ? "text-rose-500" : days <= 3 ? "text-amber-500" : "text-slate-400"}`}>
                      {overdue ? `D+${Math.abs(days)}` : `D-${days}`}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Upcoming meetings */}
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-4"><div className="w-1.5 h-5 rounded-full bg-violet-400" /><h3 className="text-[14px] font-bold text-slate-800">예정 회의</h3></div>
          {upcomingMeetings.length === 0 ? <EmptyState title="예정된 회의가 없습니다" icon={Icons.video} /> : (
            <div className="space-y-3">
              {upcomingMeetings.slice(0, 5).map(m => (
                <div key={m.meetingId} onClick={() => navigate("meeting-detail", { meetingId: m.meetingId })}
                  className="p-3.5 rounded-xl border border-indigo-100 bg-indigo-50/40 cursor-pointer hover:border-indigo-300 transition-colors">
                  <p className="text-[13px] font-bold text-slate-800 leading-snug">{m.title}</p>
                  <p className="text-[11px] text-indigo-500 font-semibold mt-0.5">{fmtDateTime(m.scheduledStartAt)}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Review pending */}
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-4"><div className="w-1.5 h-5 rounded-full bg-amber-400" /><h3 className="text-[14px] font-bold text-slate-800">검토 대기</h3></div>
          {needsReview.length === 0 ? <EmptyState title="검토할 항목이 없습니다" /> : (
            <div className="space-y-2">
              {needsReview.map(m => (
                <div key={m.meetingId} onClick={() => navigate("meeting-detail", { meetingId: m.meetingId })}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-amber-100 bg-amber-50/40 cursor-pointer hover:border-amber-300 transition-colors">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  <div className="flex-1 min-w-0"><p className="text-[12px] font-semibold text-slate-800 truncate">{m.title}</p><p className="text-[10px] text-slate-400">회의록·후보 검토 필요</p></div>
                  <ProcessingBadge status="draft" />
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Recent notifications */}
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-4"><div className="w-1.5 h-5 rounded-full bg-rose-400" /><h3 className="text-[14px] font-bold text-slate-800">최근 알림</h3></div>
          <div className="space-y-2">
            {recentNotifs.length === 0 && <p className="text-[12px] text-slate-400 py-4">알림이 없습니다.</p>}
            {recentNotifs.map(n => (
              <div key={n.notificationId} onClick={() => { notif.markRead(n.notificationId); goToNotification(n, navigate); }}
                className="flex items-start gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer">
                <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${!n.read ? "bg-indigo-500" : "bg-slate-200"}`} />
                <div className="flex-1 min-w-0">
                  <p className={`text-[12px] leading-snug ${!n.read ? "font-semibold text-slate-800" : "text-slate-600"}`}>{presentationText(n)}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">{fmtRelative(n.createdAt)}</p>
                </div>
                <CategoryBadge type={n.notificationType} />
              </div>
            ))}
          </div>
          <button onClick={() => navigate("notifications")} className="mt-3 w-full py-2 text-[12px] text-slate-400 hover:text-indigo-500 font-medium transition-colors">전체 알림 보기 →</button>
        </Card>
      </div>
    </div>
  );
}


// ─── Notifications Screen ─────────────────────────────────────────────────────
function NotificationsScreen({ navigate, notif }: { navigate: (s: Screen, ctx?: NavCtx) => void; notif: NotificationCenter }) {
  return (
    <div className="h-full overflow-y-auto p-6 bg-slate-50/40">
      <div className="max-w-2xl space-y-3">
        <div className="flex items-center justify-between mb-4">
          <p className="text-[13px] font-bold text-slate-700">전체 {notif.items.length}건 · 미읽음 {notif.unreadCount}건</p>
          <button onClick={() => notif.markAllRead()} className="text-[12px] text-indigo-500 font-semibold hover:text-indigo-700">모두 읽음</button>
        </div>
        {notif.loading && notif.items.length === 0 && <Spinner_ />}
        {!notif.loading && notif.items.length === 0 && <EmptyState title="알림이 없습니다" icon={Icons.bell} />}
        {notif.items.map(n => {
          const target = targetForNotification(n);
          return (
          <div key={n.notificationId} onClick={() => { notif.markRead(n.notificationId); goToNotification(n, navigate); }}
            className={`flex items-start gap-4 p-4 rounded-2xl border cursor-pointer transition-all hover:shadow-sm ${!n.read ? "bg-white border-indigo-100" : "bg-white/60 border-slate-100"}`}>
            <div className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${!n.read ? "bg-indigo-500" : "bg-slate-200"}`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <CategoryBadge type={n.notificationType} />
                <span className="text-[10px] text-slate-300">{fmtRelative(n.createdAt)}</span>
              </div>
              <p className={`text-[13px] leading-snug ${!n.read ? "font-bold text-slate-900" : "font-medium text-slate-600"}`}>{presentationText(n)}</p>
            </div>
            {target && <span className="shrink-0 mt-1">{Icons.chevronR}</span>}
          </div>
          );
        })}
        {notif.hasMore && (
          <button onClick={() => notif.loadMore()} disabled={notif.loading} className="w-full py-2.5 text-[12px] text-slate-400 hover:text-indigo-500 font-medium transition-colors disabled:opacity-50">
            {notif.loading ? "불러오는 중..." : "더 보기"}
          </button>
        )}
      </div>
    </div>
  );
}
function Spinner_() { return <div className="flex items-center justify-center py-12"><span className="w-6 h-6 border-2 border-slate-200 border-t-indigo-500 rounded-full animate-spin" /></div>; }


// ─── App Shell ────────────────────────────────────────────────────────────────
// Identity(01) 응답을 화면 도메인 사용자로 변환한다. 프로젝트 역할(projectRoles)은 Project 서비스(02) 연동 전까지
// mock 모드에서만 데모 데이터로 채우고, 실 API 모드에서는 비어 있다.
const AVATAR_COLORS = ["#4f6ef7","#0891b2","#059669","#dc2626","#d97706","#7c3aed","#be185d","#0d9488","#ea580c","#6366f1"];
function colorFor(seed: string) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function toCurrentUser(me: CurrentUserResponse): CurrentUser {
  const demo = USE_MOCK ? DEMO_USERS.find(d => d.id === mockDemoUserId(me.email)) : undefined;
  const team = me.team?.name ?? me.department?.name ?? "";
  if (demo) return { ...demo, userId: me.userId, name: me.displayName, avatar: me.displayName.charAt(0), team: team || demo.team, companyRole: me.companyRole };
  return { id: -1, userId: me.userId, name: me.displayName, avatar: me.displayName.charAt(0), color: colorFor(me.userId), team, companyRole: me.companyRole, projectRoles: {} };
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

function MainApp({ me }: { me: CurrentUserResponse }) {
  const { logout } = useAuth();
  const user = useMemo(() => toCurrentUser(me), [me]);
  const [showAccount, setShowAccount] = useState(false);
  const [screen, setScreen] = useState<Screen>("home");
  const [ctx, setCtx] = useState<NavCtx>({});
  const notif = useNotificationCenter(user.userId);

  function navigate(s: Screen, newCtx?: NavCtx) {
    setScreen(s);
    if (newCtx) setCtx(newCtx);
  }

  const BREADCRUMBS: Partial<Record<Screen, string[]>> = {
    home:                ["Anok", "홈"],
    projects:            ["Anok", "프로젝트"],
    "project-detail":   ["Anok", "프로젝트", "상세"],
    tasks:               ["Anok", "내 업무"],
    meetings:            ["Anok", "회의"],
    "meeting-detail":   ["Anok", "회의", "상세"],
    "document-detail":  ["Anok", "회의", "자료", "상세"],
    ai:                  ["Anok", "AI 질문"],
    notifications:       ["Anok", "알림"],
    "company-admin":    ["Anok", "회사 관리"],
  };

  const breadcrumb = BREADCRUMBS[screen] ?? ["Anok"];

  return (
    <>
      <div className="flex h-full overflow-hidden bg-slate-50">
        <Sidebar user={user} screen={screen} navigate={navigate} unreadCount={notif.unreadCount} />
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <Header user={user} screen={screen} breadcrumb={breadcrumb} onLogout={logout} onOpenAccount={() => setShowAccount(true)} notif={notif} navigate={navigate} />
          <main className="flex-1 overflow-hidden relative">
            {screen === "home"              && <HomeScreen user={user} navigate={navigate} notif={notif} />}
            {screen === "projects"          && <ProjectsScreen navigate={navigate} />}
            {screen === "project-detail"    && (ctx.projectId ? <ProjectDetailScreen projectId={ctx.projectId} navigate={navigate} initialTab={ctx.projectTab} /> : <AccessDenied />)}
            {screen === "tasks"             && <MyTasksScreen />}
            {screen === "meetings"          && <MeetingsScreen navigate={navigate} />}
            {screen === "meeting-detail"    && (ctx.meetingId ? <MeetingDetailScreen meetingId={ctx.meetingId} navigate={navigate} /> : <AccessDenied />)}
            {screen === "document-detail"   && (ctx.docId ? <DocumentDetailScreen docId={ctx.docId} backMeetingId={ctx.fromMeetingId} navigate={navigate} /> : <AccessDenied />)}
            {screen === "ai"                && <AIScreen />}
            {screen === "notifications"     && <NotificationsScreen navigate={navigate} notif={notif} />}
            {screen === "company-admin"     && (user.companyRole === "ADMIN" ? <CompanyAdminScreen /> : <AccessDenied message="회사 관리자만 접근할 수 있습니다." />)}
          </main>
        </div>
      </div>
      {showAccount && <MyAccountModal onClose={() => setShowAccount(false)} />}
    </>
  );
}
