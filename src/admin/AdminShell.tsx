// 관리자 콘솔 레이아웃: 기존 관리 화면의 딥 네이비 사이드바를 유지하고, 관리 기능 전용 내비게이션만 둔다.
// 업무 공간으로 돌아가는 버튼을 항상 제공한다. 관리자 권한은 프로젝트·회의·문서 열람 권한과 별개이므로 이 셸에는 해당 화면으로 가는 항목이 없다.
import type { ReactNode } from "react";
import { UserMenu } from "../workspace/chrome";
import type { CurrentUser, Navigate } from "../workspace/nav";
import { ArrowLeftIcon, BuildingIcon, OrgIcon, ShieldIcon, SlidersIcon, UsersIcon, VideoIcon } from "../ui/icons";
import logoMark from "../assets/logo/logo-mark.png";
import { ADMIN_TABS } from "./CompanyAdmin";
import type { AdminTab } from "./CompanyAdmin";

const TAB_ICON: Record<AdminTab, ReactNode> = {
  회사설정: <BuildingIcon />, 사용자: <UsersIcon />, 조직: <OrgIcon />, AI설정: <SlidersIcon />, 회의: <VideoIcon />, MFA: <ShieldIcon />,
};

export default function AdminShell({ user, tab, onTabChange, navigate, onLogout, onOpenAccount, children }: {
  user: CurrentUser; tab: AdminTab; onTabChange: (t: AdminTab) => void; navigate: Navigate;
  onLogout: () => void; onOpenAccount: () => void; children: ReactNode;
}) {
  const current = ADMIN_TABS.find(t => t.id === tab)!;
  return (
    <div className="flex h-full overflow-hidden bg-slate-50">
      <aside className="w-[220px] shrink-0 flex flex-col h-full" style={{ backgroundColor: "#0c1120" }}>
        <div className="px-5 pt-6 pb-5">
          <div className="flex items-center gap-3">
            <img src={logoMark} alt="" className="h-8 w-auto shrink-0" />
            <div>
              <p className="text-[16px] font-extrabold text-white tracking-tight leading-none">Anok</p>
              <p className="text-[9px] text-white/30 font-medium tracking-widest uppercase mt-1">관리자 콘솔</p>
            </div>
          </div>
        </div>

        <nav aria-label="관리자 콘솔" className="flex-1 overflow-y-auto py-2 px-3 space-y-0.5">
          <p className="px-3 pb-1.5 text-[10px] font-bold tracking-[0.14em] text-white/25">ADMIN</p>
          {ADMIN_TABS.map(item => {
            const active = item.id === tab;
            return (
              <button key={item.id} onClick={() => onTabChange(item.id)} aria-current={active ? "page" : undefined}
                className="relative w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all duration-150 text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-indigo-300"
                style={active ? { backgroundColor: "rgba(79,110,247,0.18)", boxShadow: "inset 0 0 0 1px rgba(79,110,247,0.25)" } : {}}>
                {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full bg-indigo-400" />}
                <span style={{ color: active ? "#a5b4fc" : "rgba(255,255,255,0.4)" }}>{TAB_ICON[item.id]}</span>
                <span style={{ color: active ? "#e0e7ff" : "rgba(255,255,255,0.5)" }}>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="px-3 pb-4">
          <button onClick={() => navigate("home")}
            className="w-full flex items-center gap-2.5 px-3.5 py-3 rounded-xl text-left text-[12px] font-semibold text-indigo-200 transition-colors hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-indigo-300"
            style={{ border: "1px solid rgba(255,255,255,0.1)" }}>
            <ArrowLeftIcon size={14} />업무 공간으로 돌아가기
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="shrink-0 h-[58px] flex items-center justify-between px-6 bg-white border-b border-slate-100 z-10">
          <div>
            <p className="text-[10px] text-slate-400 mb-0.5 font-medium">Anok / 관리자 콘솔</p>
            <h1 className="text-[15px] font-bold text-slate-900 leading-none">{current.label}</h1>
          </div>
          <UserMenu user={user} onLogout={onLogout} onOpenAccount={onOpenAccount} roleLabel="회사 관리자" />
        </header>
        <main className="flex-1 min-h-0 overflow-hidden relative">{children}</main>
      </div>
    </div>
  );
}
