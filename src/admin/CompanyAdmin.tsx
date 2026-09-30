import { useEffect, useRef, useState } from "react";
import * as api from "../api/identity";
import type { AdminUserResponse, CompanyAdminResponse, DepartmentResponse, InvitationResponse, LifecycleReasonClass, TeamResponse } from "../api/identity";
import * as ai from "../api/ai";
import { errorText, fieldErrorMap } from "../api/errors";
import { USE_MOCK } from "../api/config";
import { mockInviteToken } from "../api/mock";
import { useAuth } from "../auth/AuthProvider";
import { Avatar, Card, ErrorBox, Field, ghostBtn, inputCls, labelCls, Modal, primaryBtn, Section, Spinner, useLoad } from "../ui/kit";

const REASONS: { value: LifecycleReasonClass; label: string }[] = [
  { value: "TEMPORARY_SUSPENSION", label: "일시 정지" },
  { value: "EMPLOYMENT_TERMINATION", label: "퇴사" },
  { value: "ACCOUNT_RETIREMENT", label: "계정 폐기" },
  { value: "REACTIVATION", label: "재활성화" },
  { value: "OTHER_ADMIN_SECURITY_ACTION", label: "기타 보안 조치" },
];

function RoleBadge({ role }: { role: "ADMIN" | "EMPLOYEE" }) {
  return <span className={`inline-flex text-[10px] font-bold px-2 py-0.5 rounded ${role === "ADMIN" ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-600"}`}>{role === "ADMIN" ? "관리자" : "직원"}</span>;
}

type Org = { departments: DepartmentResponse[]; teams: TeamResponse[] };

// ───────────────────────── 회사 프로필 (API-34/35) ─────────────────────────
function CompanyTab() {
  const { data, setData, loading, error, reload } = useLoad(() => api.getCompany(), []);
  const [form, setForm] = useState({ displayName: "", industry: "", description: "", productsServicesSummary: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  useEffect(() => {
    if (data) setForm({ displayName: data.displayName, industry: data.industry ?? "", description: data.description ?? "", productsServicesSummary: data.productsServicesSummary ?? "" });
  }, [data]);

  async function save() {
    if (!data) return;
    setBusy(true); setMsg(null); setFields({});
    try {
      const next: CompanyAdminResponse = await api.updateCompany({
        displayName: form.displayName.trim(), industry: form.industry.trim() || null, description: form.description.trim() || null,
        productsServicesSummary: form.productsServicesSummary.trim() || null, version: data.version,
      });
      setData(next); setMsg({ ok: true, text: "저장했습니다." });
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) }); setFields(fieldErrorMap(e));
    } finally { setBusy(false); }
  }

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  return (
    <Card className="max-w-xl p-6 space-y-4">
      <Section>회사 프로필</Section>
      <Field label="회사명" error={fields.displayName}><input value={form.displayName} onChange={e => setForm(p => ({ ...p, displayName: e.target.value }))} className={inputCls} /></Field>
      <Field label="업종" error={fields.industry}><input value={form.industry} onChange={e => setForm(p => ({ ...p, industry: e.target.value }))} className={inputCls} /></Field>
      <Field label="회사 소개" error={fields.description}><textarea rows={3} value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} className={inputCls} /></Field>
      <Field label="주요 제품/서비스" error={fields.productsServicesSummary}><textarea rows={3} value={form.productsServicesSummary} onChange={e => setForm(p => ({ ...p, productsServicesSummary: e.target.value }))} className={inputCls} /></Field>
      {msg && <p className={`text-[12px] font-medium ${msg.ok ? "text-emerald-600" : "text-rose-500"}`}>{msg.text}</p>}
      <button onClick={save} disabled={busy || form.displayName.trim().length < 2} className={primaryBtn}>{busy ? "저장 중..." : "저장"}</button>
    </Card>
  );
}

// ───────────────────────── 사용자 (API-26~33) ─────────────────────────
function InviteModal({ onClose, onIssued }: { onClose: () => void; onIssued: (i: InvitationResponse) => void }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function submit() {
    setBusy(true); setError(null); setFields({});
    try { onIssued(await api.createInvitation(email.trim())); onClose(); }
    catch (e) { setError(errorText(e)); setFields(fieldErrorMap(e)); setBusy(false); }
  }
  return (
    <Modal title="사용자 초대" onClose={onClose}>
      <p className="text-[12px] text-slate-400">초대 메일을 받은 사용자가 직접 이름과 비밀번호를 설정하고 가입합니다. 소속·권한은 가입 후 지정할 수 있습니다.</p>
      <Field label="이메일" error={fields.email}>
        <input type="email" autoFocus value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && email.trim() && submit()} placeholder="hong@company.com" className={inputCls} />
      </Field>
      {error && <p className="text-[12px] text-rose-500 font-medium">{error}</p>}
      <div className="flex gap-2">
        <button onClick={onClose} className={`flex-1 ${ghostBtn}`}>취소</button>
        <button onClick={submit} disabled={busy || !email.trim()} className={`flex-1 ${primaryBtn}`}>{busy ? "발송 중..." : "초대 발송"}</button>
      </div>
    </Modal>
  );
}

function ManageModal({ target, org, avatarUrl, onAvatar, onUpdated, onClose }: {
  target: AdminUserResponse; org: Org; avatarUrl?: string; onAvatar: (url: string | null) => void;
  onUpdated: (u: AdminUserResponse) => void; onClose: () => void;
}) {
  const { me } = useAuth();
  const [user, setUser] = useState(target);
  const [jobTitle, setJobTitle] = useState(target.jobTitle ?? "");
  const [departmentId, setDepartmentId] = useState(target.departmentId ?? "");
  const [teamId, setTeamId] = useState(target.teamId ?? "");
  const [reason, setReason] = useState<LifecycleReasonClass>(target.status === "ACTIVE" ? "TEMPORARY_SUSPENSION" : "REACTIVATION");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const isSelf = me?.userId === user.userId;
  const activeDepts = org.departments.filter(d => d.status === "ACTIVE");
  const deptTeams = org.teams.filter(t => t.status === "ACTIVE" && t.departmentId === departmentId);

  // 비밀번호 재설정 메일 발송은 data 없이 성공만 돌려준다(undefined).
  async function act(name: string, fn: () => Promise<AdminUserResponse | undefined | void>, success: string) {
    setBusy(name); setMsg(null);
    try {
      const r = await fn();
      if (r) { setUser(r); onUpdated(r); }
      setMsg({ ok: true, text: success });
    } catch (e) { setMsg({ ok: false, text: errorText(e) }); }
    finally { setBusy(null); }
  }

  function pickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 2 * 1024 * 1024) { setMsg({ ok: false, text: "2MB 이하 이미지 파일만 선택할 수 있습니다." }); return; }
    const r = new FileReader();
    r.onload = () => typeof r.result === "string" && onAvatar(r.result);
    r.readAsDataURL(file);
  }

  const orgDirty = jobTitle.trim() !== (user.jobTitle ?? "") || departmentId !== (user.departmentId ?? "") || teamId !== (user.teamId ?? "");

  return (
    <Modal title="계정 관리" onClose={onClose}>
      <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
        <Avatar name={user.displayName} seed={user.userId} imageUrl={avatarUrl} size={40} />
        <div className="min-w-0">
          <p className="text-[14px] font-bold text-slate-800 truncate">{user.displayName}</p>
          <p className="text-[12px] text-slate-400 truncate">{user.email}</p>
        </div>
        <div className="ml-auto flex gap-1.5"><RoleBadge role={user.companyRole} />
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${user.status === "ACTIVE" ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400"}`}>{user.status === "ACTIVE" ? "활성" : "비활성"}</span>
        </div>
      </div>

      <div>
        <label className={labelCls}>프로필 이미지 <span className="normal-case font-normal text-amber-500">· 이 브라우저에서만 표시 (서버 저장 API 없음)</span></label>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pickImage} />
          <button type="button" onClick={() => fileRef.current?.click()} className="px-3 py-1.5 border border-slate-200 text-slate-600 text-[11px] font-semibold rounded-lg hover:border-indigo-300 hover:text-indigo-600">이미지 선택</button>
          {avatarUrl && <button type="button" onClick={() => onAvatar(null)} className="px-3 py-1.5 text-slate-400 text-[11px] font-semibold hover:text-rose-500">기본 프로필로</button>}
        </div>
      </div>

      <div className="space-y-3 pb-3 border-b border-slate-100">
        <Field label="직무"><input value={jobTitle} onChange={e => setJobTitle(e.target.value)} maxLength={100} className={inputCls} placeholder="예: 프론트엔드 개발자" /></Field>
        {user.jobTitle === undefined && <p className="text-[11px] text-amber-500">이 계정의 현재 직무는 조회할 수 없습니다. 소속을 저장하면 위에 입력한 직무로 덮어씁니다.</p>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="부서">
            <select value={departmentId} onChange={e => { setDepartmentId(e.target.value); setTeamId(""); }} className={inputCls}>
              <option value="">미지정</option>
              {activeDepts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="팀">
            <select value={teamId} onChange={e => setTeamId(e.target.value)} disabled={!departmentId} className={inputCls}>
              <option value="">미지정</option>
              {deptTeams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
        </div>
        <button disabled={!!busy || !orgDirty} className={primaryBtn}
          onClick={() => act("org", () => api.updateUserOrganization(user.userId, { departmentId: departmentId || null, teamId: teamId || null, jobTitle: jobTitle.trim() || null, version: user.version }), "소속 정보를 저장했습니다.")}>
          {busy === "org" ? "저장 중..." : "소속 저장"}
        </button>
      </div>

      <div className="space-y-2 pb-3 border-b border-slate-100">
        <label className={labelCls}>회사 권한 <span className="normal-case font-normal text-slate-400">· 변경 시 추가 본인 확인</span></label>
        <div className="flex gap-2">
          {(["EMPLOYEE", "ADMIN"] as const).map(r => (
            <button key={r} disabled={!!busy || user.companyRole === r}
              onClick={() => act("role", () => api.updateUserCompanyRole(user.userId, { companyRole: r, version: user.version }), "권한을 변경했습니다.")}
              className={`flex-1 py-2 rounded-xl text-[12px] font-bold border transition-colors ${user.companyRole === r ? "bg-indigo-500 text-white border-indigo-500" : "border-slate-200 text-slate-500 hover:border-indigo-300"} disabled:cursor-default`}>
              {r === "EMPLOYEE" ? "직원" : "관리자"}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2 pb-3 border-b border-slate-100">
        <label className={labelCls}>계정 상태 <span className="normal-case font-normal text-slate-400">· 변경 시 추가 본인 확인</span></label>
        <div className="flex gap-2">
          <select value={reason} onChange={e => setReason(e.target.value as LifecycleReasonClass)} className={inputCls}>
            {REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <button disabled={!!busy || isSelf}
            onClick={() => act("status", () => api.updateUserStatus(user.userId, { status: user.status === "ACTIVE" ? "INACTIVE" : "ACTIVE", reasonClass: reason, version: user.version }), "계정 상태를 변경했습니다.")}
            className={`shrink-0 px-3 text-[12px] font-bold rounded-xl border disabled:opacity-40 ${user.status === "ACTIVE" ? "border-rose-200 text-rose-500 hover:bg-rose-50" : "border-emerald-200 text-emerald-600 hover:bg-emerald-50"}`}>
            {user.status === "ACTIVE" ? "비활성화" : "활성화"}
          </button>
        </div>
        {isSelf && <p className="text-[11px] text-slate-400">자기 자신의 상태는 변경할 수 없습니다.</p>}
      </div>

      <button disabled={!!busy || user.status !== "ACTIVE"} onClick={() => act("reset", () => api.triggerPasswordReset(user.userId), "비밀번호 재설정 메일을 발송했습니다.")} className={ghostBtn}>
        {busy === "reset" ? "발송 중..." : "비밀번호 재설정 메일 발송"}
      </button>

      {msg && <p className={`text-[12px] font-medium ${msg.ok ? "text-emerald-600" : "text-rose-500"}`}>{msg.text}</p>}
    </Modal>
  );
}

function UsersTab({ org }: { org: Org }) {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [status, setStatus] = useState<"" | "ACTIVE" | "INACTIVE">("");
  const [offset, setOffset] = useState(0);
  const limit = 20;
  const [showInvite, setShowInvite] = useState(false);
  const [manage, setManage] = useState<AdminUserResponse | null>(null);
  const [invitations, setInvitations] = useState<InvitationResponse[]>([]);
  const [invMsg, setInvMsg] = useState<string | null>(null);
  const [avatars, setAvatars] = useState<Record<string, string>>({});

  useEffect(() => { const t = setTimeout(() => { setDebouncedQ(q.trim()); setOffset(0); }, 300); return () => clearTimeout(t); }, [q]);

  const { data, setData, loading, error, reload } = useLoad(
    () => api.listAdminUsers({ offset, limit, q: debouncedQ || undefined, status: status || undefined }),
    [offset, debouncedQ, status],
  );

  const deptName = (id?: string | null) => org.departments.find(d => d.id === id)?.name;
  const teamName = (id?: string | null) => org.teams.find(t => t.id === id)?.name;
  const total = data?.page.total ?? 0;

  function replaceRow(u: AdminUserResponse) {
    setManage(u);
    setData(d => d && { ...d, items: d.items.map(x => x.userId === u.userId ? u : x) });
  }

  async function invAct(inv: InvitationResponse, kind: "resend" | "cancel") {
    setInvMsg(null);
    try {
      if (kind === "cancel") { await api.cancelInvitation(inv.invitationId); setInvitations(p => p.filter(i => i.invitationId !== inv.invitationId)); }
      else { const n = await api.resendInvitation(inv.invitationId); setInvitations(p => p.map(i => i.invitationId === n.invitationId ? n : i)); setInvMsg("초대 메일을 다시 발송했습니다."); }
    } catch (e) { setInvMsg(errorText(e)); }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 flex-1 bg-white border border-slate-200 rounded-xl px-3 py-2">
          <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="이름, 이메일 검색" maxLength={100} className="flex-1 text-[13px] bg-transparent outline-none text-slate-700 placeholder-slate-400" />
        </div>
        <select value={status} onChange={e => { setStatus(e.target.value as typeof status); setOffset(0); }} className="border border-slate-200 rounded-xl px-3 py-2 text-[12px] font-semibold text-slate-600 bg-white outline-none">
          <option value="">전체</option><option value="ACTIVE">활성</option><option value="INACTIVE">비활성</option>
        </select>
        <button onClick={() => setShowInvite(true)} className="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white text-[12px] font-bold rounded-xl transition-colors shrink-0">+ 사용자 초대</button>
      </div>

      {invitations.length > 0 && (
        <Card className="p-4 space-y-2">
          <Section>이번 접속에서 발급한 초대</Section>
          {invitations.map(inv => (
            <div key={inv.invitationId} className="flex items-center gap-3 text-[12px] py-1.5 border-b border-slate-50 last:border-0">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-700 truncate">{inv.email}</p>
                <p className="text-[10px] text-slate-400">만료 {new Date(inv.expiresAt).toLocaleDateString("ko-KR")}{USE_MOCK && ` · mock 초대 코드: ${mockInviteToken(inv.invitationId)}`}</p>
              </div>
              <button onClick={() => invAct(inv, "resend")} className="text-indigo-500 font-semibold hover:text-indigo-700">재발송</button>
              <button onClick={() => invAct(inv, "cancel")} className="text-rose-400 font-semibold hover:text-rose-600">취소</button>
            </div>
          ))}
          {invMsg && <p className="text-[11px] text-slate-500">{invMsg}</p>}
          <p className="text-[10px] text-slate-400">초대 목록 조회 API가 없어 이 화면에서 발급한 초대만 표시됩니다.</p>
        </Card>
      )}

      <Card>
        <div className="flex items-center px-5 py-3 border-b border-slate-100 bg-slate-50/50">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide flex-1">사용자</p>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide w-20 text-center">권한</p>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide w-16 text-center">상태</p>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide w-14 text-right">관리</p>
        </div>
        {loading && !data ? <Spinner /> : error && !data ? <ErrorBox message={error} onRetry={reload} /> : (
          <>
            {data?.items.length === 0 && <div className="py-10 text-center text-[13px] text-slate-400">조건에 맞는 사용자가 없습니다.</div>}
            {data?.items.map(u => (
              <div key={u.userId} className={`flex items-center gap-3 px-5 py-3 border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors ${loading ? "opacity-60" : ""}`}>
                <Avatar name={u.displayName} seed={u.userId} imageUrl={avatars[u.userId]} />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-slate-800 truncate">{u.displayName}</p>
                  <p className="text-[11px] text-slate-400 truncate">{u.email}{(deptName(u.departmentId) || teamName(u.teamId)) && ` · ${[deptName(u.departmentId), teamName(u.teamId)].filter(Boolean).join(" ")}`}</p>
                </div>
                <div className="w-20 flex justify-center"><RoleBadge role={u.companyRole} /></div>
                <div className="w-16 flex justify-center">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${u.status === "ACTIVE" ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400"}`}>{u.status === "ACTIVE" ? "활성" : "비활성"}</span>
                </div>
                <div className="w-14 flex justify-end">
                  <button onClick={() => setManage(u)} className="text-[11px] text-slate-400 hover:text-indigo-600 px-2 py-1 rounded-lg hover:bg-indigo-50 font-semibold">관리</button>
                </div>
              </div>
            ))}
          </>
        )}
      </Card>

      <div className="flex items-center justify-between text-[11px] text-slate-400">
        <span>총 {total}명</span>
        <div className="flex items-center gap-2">
          <button disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - limit))} className="px-3 py-1.5 rounded-lg border border-slate-200 font-semibold disabled:opacity-40">이전</button>
          <span>{total === 0 ? 0 : offset + 1}–{Math.min(offset + limit, total)}</span>
          <button disabled={offset + limit >= total || loading} onClick={() => setOffset(offset + limit)} className="px-3 py-1.5 rounded-lg border border-slate-200 font-semibold disabled:opacity-40">다음</button>
        </div>
      </div>

      {showInvite && <InviteModal onClose={() => setShowInvite(false)} onIssued={inv => setInvitations(p => [inv, ...p])} />}
      {manage && (
        <ManageModal key={manage.userId} target={manage} org={org} avatarUrl={avatars[manage.userId]}
          onAvatar={url => setAvatars(p => { const n = { ...p }; if (url) n[manage.userId] = url; else delete n[manage.userId]; return n; })}
          onUpdated={replaceRow} onClose={() => setManage(null)} />
      )}
    </div>
  );
}

// ───────────────────────── 조직 (API-36~43) ─────────────────────────
function OrgTab({ org, reload }: { org: Org; reload: () => void }) {
  const [showInactive, setShowInactive] = useState(false);
  const [newDept, setNewDept] = useState("");
  const [addingTeamFor, setAddingTeamFor] = useState<string | null>(null);
  const [newTeam, setNewTeam] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(fn: () => Promise<unknown>, after?: () => void) {
    setBusy(true); setMsg(null);
    try { await fn(); after?.(); reload(); } catch (e) { setMsg(errorText(e)); } finally { setBusy(false); }
  }

  const depts = org.departments.filter(d => showInactive || d.status === "ACTIVE");
  const inactiveTag = <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded ml-2">비활성</span>;

  const editor = (id: string, onSave: (name: string) => Promise<unknown>) => (
    <div className="flex items-center gap-2 flex-1">
      <input autoFocus value={editing!.name} onChange={e => setEditing({ id, name: e.target.value })} maxLength={160}
        onKeyDown={e => { if (e.key === "Enter" && editing!.name.trim()) act(() => onSave(editing!.name.trim()), () => setEditing(null)); if (e.key === "Escape") setEditing(null); }}
        className="flex-1 border border-slate-200 rounded-lg px-2.5 py-1.5 text-[13px] outline-none focus:border-indigo-300" />
      <button disabled={busy || !editing!.name.trim()} onClick={() => act(() => onSave(editing!.name.trim()), () => setEditing(null))} className="text-[11px] text-indigo-500 font-semibold">저장</button>
      <button onClick={() => setEditing(null)} className="text-[11px] text-slate-400 font-semibold">취소</button>
    </div>
  );
  const inactivateBtn = (id: string, run: () => Promise<unknown>) => confirm === id
    ? <button disabled={busy} onClick={() => act(run, () => setConfirm(null))} className="text-[11px] text-rose-500 font-bold">정말 비활성화</button>
    : <button onClick={() => setConfirm(id)} className="text-[11px] text-slate-400 hover:text-rose-500 font-semibold">비활성화</button>;

  return (
    <div className="max-w-xl space-y-3">
      <div className="flex items-center gap-2">
        <input value={newDept} onChange={e => setNewDept(e.target.value)} maxLength={160} placeholder="새 부서명" className={`${inputCls} flex-1`}
          onKeyDown={e => e.key === "Enter" && newDept.trim() && act(() => api.createDepartment(newDept.trim()), () => setNewDept(""))} />
        <button disabled={busy || !newDept.trim()} onClick={() => act(() => api.createDepartment(newDept.trim()), () => setNewDept(""))} className={primaryBtn}>부서 추가</button>
      </div>
      <label className="flex items-center gap-2 text-[12px] text-slate-500"><input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />비활성 조직 표시</label>
      {msg && <p className="text-[12px] text-rose-500 font-medium">{msg}</p>}

      {depts.length === 0 && <Card className="p-6 text-center text-[13px] text-slate-400">등록된 부서가 없습니다.</Card>}
      {depts.map(d => {
        const dTeams = org.teams.filter(t => t.departmentId === d.id && (showInactive || t.status === "ACTIVE"));
        return (
          <Card key={d.id} className="p-4">
            <div className="flex items-center gap-2 mb-2">
              {editing?.id === d.id ? editor(d.id, name => api.updateDepartment(d.id, { name, version: d.version })) : (
                <p className={`text-[14px] font-bold flex-1 ${d.status === "ACTIVE" ? "text-slate-800" : "text-slate-400"}`}>{d.name}{d.status === "INACTIVE" && inactiveTag}</p>
              )}
              {d.status === "ACTIVE" && editing?.id !== d.id && (
                <>
                  <button onClick={() => setEditing({ id: d.id, name: d.name })} className="text-[11px] text-slate-400 hover:text-indigo-600 font-semibold">이름 변경</button>
                  <button onClick={() => { setAddingTeamFor(d.id); setNewTeam(""); }} className="text-[11px] text-indigo-500 font-semibold">팀 추가</button>
                  {inactivateBtn(d.id, () => api.inactivateDepartment(d.id, d.version))}
                </>
              )}
            </div>
            {addingTeamFor === d.id && (
              <div className="flex items-center gap-2 mb-2">
                <input autoFocus value={newTeam} onChange={e => setNewTeam(e.target.value)} maxLength={160} placeholder="새 팀명" className="flex-1 border border-slate-200 rounded-lg px-2.5 py-1.5 text-[13px] outline-none focus:border-indigo-300"
                  onKeyDown={e => e.key === "Enter" && newTeam.trim() && act(() => api.createTeam({ departmentId: d.id, name: newTeam.trim() }), () => setAddingTeamFor(null))} />
                <button disabled={busy || !newTeam.trim()} onClick={() => act(() => api.createTeam({ departmentId: d.id, name: newTeam.trim() }), () => setAddingTeamFor(null))} className="text-[11px] text-indigo-500 font-semibold">추가</button>
                <button onClick={() => setAddingTeamFor(null)} className="text-[11px] text-slate-400 font-semibold">취소</button>
              </div>
            )}
            {dTeams.length === 0 && <p className="text-[12px] text-slate-300 py-1">팀이 없습니다.</p>}
            {dTeams.map(t => (
              <div key={t.id} className="flex items-center gap-2 py-2 border-t border-slate-50">
                {editing?.id === t.id ? editor(t.id, name => api.updateTeam(t.id, { departmentId: t.departmentId, name, version: t.version })) : (
                  <p className={`text-[13px] flex-1 ${t.status === "ACTIVE" ? "text-slate-700" : "text-slate-400"}`}>{t.name}{t.status === "INACTIVE" && inactiveTag}</p>
                )}
                {t.status === "ACTIVE" && editing?.id !== t.id && (
                  <>
                    <button onClick={() => setEditing({ id: t.id, name: t.name })} className="text-[11px] text-slate-400 hover:text-indigo-600 font-semibold">이름 변경</button>
                    {inactivateBtn(t.id, () => api.inactivateTeam(t.id, t.version))}
                  </>
                )}
              </div>
            ))}
          </Card>
        );
      })}
    </div>
  );
}

// AI 설정은 06(AI Context) 명세 작업 단계에서 API로 교체한다. 그 전까지는 기존 정적 화면을 유지한다.
// ───────────────────────── AI 설정 (06) ─────────────────────────
function AiUsageSummary() {
  const { data, loading, error } = useLoad(() => ai.getCompanyAiUsage({ groupBy: "PROVIDER" }), []);
  if (loading && !data) return <Spinner />;
  if (error && !data) return <p className="text-[12px] text-slate-400">사용량을 불러오지 못했습니다.</p>;
  if (!data) return null;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-3">
        {[["요청 수", data.totals.requestCount], ["입력 토큰", data.totals.inputTokens], ["출력 토큰", data.totals.outputTokens]].map(([l, v]) => (
          <div key={l as string}><p className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">{l}</p><p className="text-[18px] font-extrabold text-slate-800 mt-0.5">{v}</p></div>
        ))}
      </div>
      {data.breakdown.length > 0 && (
        <div className="pt-2 border-t border-slate-50 space-y-1.5">
          {data.breakdown.map(b => (
            <div key={b.key} className="flex items-center gap-3 text-[12px] text-slate-600">
              <span className="w-24 shrink-0 font-semibold text-slate-700">{b.key}</span>
              <span className="text-slate-400">요청 {b.requestCount}건 · 예상 비용 ${b.estimatedCost.toFixed(4)}</span>
            </div>
          ))}
        </div>
      )}
      {(data.blockedRequestCount > 0 || data.failedRequestCount > 0) && (
        <p className="text-[11px] text-slate-400 pt-1">정책 차단 {data.blockedRequestCount}건 · 실패 {data.failedRequestCount}건</p>
      )}
    </div>
  );
}

function AiSettingsTab() {
  const { data, setData, loading, error, reload } = useLoad(() => ai.getCompanyAiSettings(), []);
  const { data: approved } = useLoad(() => ai.listAdminApprovedModels(), []);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [defaultKey, setDefaultKey] = useState("");
  const [enabledSet, setEnabledSet] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!data) return;
    setAiEnabled(data.aiEnabled);
    setDefaultKey(`${data.defaultGenerationProvider}:${data.defaultGenerationModel}`);
    setEnabledSet(new Set(data.enabledGenerationModels.map(m => `${m.provider}:${m.model}`)));
  }, [data]);

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return null;

  function toggle(key: string) {
    setEnabledSet(prev => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next; });
  }

  async function save() {
    setBusy(true); setMsg(null); setFields({});
    try {
      const enabledGenerationModels = [...enabledSet].map(k => { const [provider, model] = k.split(":"); return { provider, model }; });
      const [defaultGenerationProvider, defaultGenerationModel] = defaultKey.split(":");
      const updated = await ai.updateCompanyAiSettings({ aiEnabled, defaultGenerationProvider, defaultGenerationModel, enabledGenerationModels, version: data!.version });
      setData(updated); setMsg({ ok: true, text: "저장했습니다." });
    } catch (e) { setMsg({ ok: false, text: errorText(e) }); setFields(fieldErrorMap(e)); }
    finally { setBusy(false); }
  }

  const models = approved?.models ?? [];

  return (
    <div className="max-w-xl space-y-4">
      <Card className="p-5 space-y-4">
        <Section>AI 서비스 설정</Section>
        <p className="text-[12px] text-slate-500">개별 사용자는 AI 모델을 변경할 수 없습니다. 회사 단위로 승인된 Provider/모델만 사용됩니다.</p>
        <div className="flex items-center justify-between py-2 border-t border-slate-50">
          <div><p className="text-[13px] font-semibold text-slate-800">AI 기능 활성화</p><p className="text-[11px] text-slate-400 mt-0.5">비활성화 시 새 대화 생성과 질문이 모두 차단됩니다.</p></div>
          <button onClick={() => setAiEnabled(v => !v)} className={`relative w-10 h-6 rounded-full transition-colors shrink-0 ${aiEnabled ? "bg-indigo-500" : "bg-slate-200"}`}>
            <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${aiEnabled ? "translate-x-5" : "translate-x-1"}`} />
          </button>
        </div>
        <Field label="회사 활성화 모델" error={fields.enabledGenerationModels}>
          <div className="space-y-1.5">
            {models.map(m => {
              const key = `${m.provider}:${m.model}`;
              return (
                <label key={key} className="flex items-center gap-2.5 px-3 py-2 rounded-xl border border-slate-100 hover:bg-slate-50 cursor-pointer">
                  <input type="checkbox" checked={enabledSet.has(key)} onChange={() => toggle(key)} className="w-4 h-4" />
                  <span className="text-[13px] text-slate-700">{m.provider} · {m.model}</span>
                </label>
              );
            })}
          </div>
        </Field>
        <Field label="기본 Provider/모델" error={fields.defaultGenerationModel}>
          <select value={defaultKey} onChange={e => setDefaultKey(e.target.value)} className={inputCls}>
            {enabledSet.size === 0 && <option value="">활성화된 모델이 없습니다</option>}
            {[...enabledSet].map(k => { const [p, m] = k.split(":"); return <option key={k} value={k}>{p} · {m}</option>; })}
          </select>
        </Field>
        {msg && <p className={`text-[12px] font-medium ${msg.ok ? "text-emerald-600" : "text-rose-500"}`}>{msg.text}</p>}
        <button disabled={busy || !defaultKey} onClick={save} className={primaryBtn}>{busy ? "저장 중..." : "변경 저장"}</button>
      </Card>
      <Card className="p-5">
        <Section>사용량 요약</Section>
        <AiUsageSummary />
      </Card>
    </div>
  );
}

// ───────────────────────── 화면 ─────────────────────────
type Tab = "회사설정" | "사용자" | "조직" | "AI설정" | "MFA";

export default function CompanyAdminScreen() {
  const [tab, setTab] = useState<Tab>("회사설정");
  const orgLoad = useLoad<Org>(async () => {
    const [departments, teams] = await Promise.all([api.listDepartments(), api.listTeams()]);
    return { departments, teams };
  }, []);
  const org: Org = orgLoad.data ?? { departments: [], teams: [] };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="shrink-0 bg-white border-b border-slate-100 px-6 py-4">
        <div className="flex">
          {(["회사설정", "사용자", "조직", "AI설정", "MFA"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} className={`px-4 py-2.5 text-[13px] font-semibold border-b-2 transition-colors ${tab === t ? "border-indigo-500 text-indigo-600" : "border-transparent text-slate-400 hover:text-slate-600"}`}>{t}</button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 bg-slate-50/40">
        {tab === "회사설정" && <CompanyTab />}
        {tab === "사용자" && <UsersTab org={org} />}
        {tab === "조직" && (orgLoad.loading && !orgLoad.data ? <Spinner /> : orgLoad.error && !orgLoad.data ? <ErrorBox message={orgLoad.error} onRetry={orgLoad.reload} /> : <OrgTab org={org} reload={orgLoad.reload} />)}

        {tab === "AI설정" && <AiSettingsTab />}

        {tab === "MFA" && (
          <Card className="max-w-xl p-5 space-y-2">
            <Section>MFA (다단계 인증)</Section>
            <p className="text-[12px] text-slate-500">관리자 계정은 로그인 시 MFA가 필수이며, 회사 단위로 켜고 끄는 설정은 제공되지 않습니다. 본인의 MFA·복구 코드는 우측 상단 <b>내 계정 → MFA</b>에서 관리합니다.</p>
          </Card>
        )}
      </div>
    </div>
  );
}
