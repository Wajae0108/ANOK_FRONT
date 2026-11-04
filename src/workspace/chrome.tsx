// Workspace/Admin 셸이 함께 쓰는 헤더 구성요소: 사용자 메뉴, 알림 드롭다운.
import { useEffect, useRef, useState } from "react";
import { Avatar } from "../ui/kit";
import { BellIcon, ChevronDownIcon } from "../ui/icons";
import { CategoryBadge, fmtRelative, presentationText, targetForNotification } from "../notifications/shared";
import type { NotificationCenter } from "../notifications/shared";
import type { NotificationResponse } from "../api/notification";
import type { CurrentUser, Navigate, NavCtx, Screen } from "./nav";

// 알림 클릭 시 실제 접근 권한은 대상 화면(ProjectDetailScreen/MeetingDetailScreen 등) 자신이 재검증한다(Notification != Authorization).
export function goToNotification(n: NotificationResponse, navigate: Navigate) {
  const target = targetForNotification(n);
  if (target) navigate(target.screen as Screen, target.ctx as NavCtx);
}

function useOutsideClose(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", h);
    document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return ref;
}

export function NotificationBell({ notif, navigate }: { notif: NotificationCenter; navigate: Navigate }) {
  const [open, setOpen] = useState(false);
  const ref = useOutsideClose(() => setOpen(false));
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(v => !v)} aria-label={`알림${notif.unreadCount ? ` ${notif.unreadCount}건 읽지 않음` : ""}`} aria-expanded={open}
        className="relative w-9 h-9 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors focus-visible:outline-2 focus-visible:outline-indigo-500">
        <BellIcon />
        {notif.unreadCount > 0 && <span className="absolute top-1.5 right-2 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-white" />}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white border border-slate-200 rounded-xl shadow-[0_8px_30px_rgba(15,23,42,0.12)] z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <p className="text-[13px] font-bold text-slate-800">알림</p>
            <button onClick={() => notif.markAllRead()} className="text-[11px] text-indigo-600 font-medium hover:text-indigo-800">모두 읽음</button>
          </div>
          <div className="max-h-80 overflow-y-auto divide-y divide-slate-50">
            {notif.items.length === 0 && <p className="text-[12px] text-slate-400 text-center py-8">알림이 없습니다.</p>}
            {notif.items.slice(0, 8).map(n => (
              <button key={n.notificationId} onClick={() => { notif.markRead(n.notificationId); setOpen(false); goToNotification(n, navigate); }}
                className={`w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors ${!n.read ? "bg-indigo-50/40" : ""}`}>
                <div className="flex items-center gap-2 mb-0.5"><CategoryBadge type={n.notificationType} /><span className="text-[10px] text-slate-300">{fmtRelative(n.createdAt)}</span></div>
                <p className={`text-[13px] leading-snug ${!n.read ? "font-semibold text-slate-900" : "text-slate-700"}`}>{presentationText(n)}</p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function UserMenu({ user, onLogout, onOpenAccount, roleLabel }: { user: CurrentUser; onLogout: () => void; onOpenAccount: () => void; roleLabel?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useOutsideClose(() => setOpen(false));
  const role = roleLabel ?? (user.companyRole === "ADMIN" ? "관리자" : "직원");
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(v => !v)} aria-expanded={open} aria-haspopup="menu" className="flex items-center gap-2.5 pl-1.5 pr-2 py-1 rounded-lg hover:bg-slate-100 transition-colors focus-visible:outline-2 focus-visible:outline-indigo-500">
        <Avatar name={user.avatar} seed={user.userId ?? user.name} size={32} />
        <div className="text-left">
          <p className="text-[13px] font-semibold text-slate-800 leading-tight">{user.name}</p>
          <p className="text-[11px] text-slate-400 leading-none mt-0.5">{role}</p>
        </div>
        <span className={`text-slate-300 transition-transform ${open ? "rotate-180" : ""}`}><ChevronDownIcon size={13} /></span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full mt-2 bg-white border border-slate-200 rounded-xl shadow-[0_8px_30px_rgba(15,23,42,0.12)] z-50 py-1.5 w-44 overflow-hidden">
          <button role="menuitem" onClick={() => { onOpenAccount(); setOpen(false); }} className="w-full text-left px-4 py-2 text-[13px] font-medium text-slate-700 hover:bg-slate-50 transition-colors">내 계정</button>
          <button role="menuitem" onClick={() => { onLogout(); setOpen(false); }} className="w-full text-left px-4 py-2 text-[13px] font-medium text-rose-500 hover:bg-rose-50 transition-colors">로그아웃</button>
        </div>
      )}
    </div>
  );
}
