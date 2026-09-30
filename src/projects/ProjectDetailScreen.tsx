// Anok_02 — 프로젝트 상세: 개요/구성원/업무/결정/일정/회의. 문서는 03 API에 프로젝트 기준 목록 조회가 없어 자리만 표시한다.
import { useState } from "react";
import * as api from "../api/project";
import type {
  DecisionResponse, ExternalAiPolicy, ProjectMemberResponse, ProjectResponse, ProjectRole,
  ProjectScheduleItemResponse, ProjectScheduleType, TaskResponse, TaskStatus,
} from "../api/project";
import * as mtg from "../api/meeting";
import { errorText, fieldErrorMap } from "../api/errors";
import { useAuth } from "../auth/AuthProvider";
import { Card, ErrorBox, Field, ghostBtn, inputCls, labelCls, Modal, primaryBtn, Section, Spinner, useLoad } from "../ui/kit";
import { fmtDateTime, MeetingStatusBadge } from "../meetings/shared";
import { DecisionStatusBadge, ProjectRoleBadge, ProjectStatusBadge, TaskStatusBadge, daysUntil, fmtDate, useOrgUsers } from "./shared";

type Tab = "개요" | "구성원" | "업무" | "결정" | "일정" | "회의" | "문서";
const TABS: Tab[] = ["개요", "구성원", "업무", "결정", "일정", "회의", "문서"];

// ───────────────────────── 회의 ─────────────────────────
function MeetingsTab({ projectId, navigate }: { projectId: string; navigate: (s: any, ctx?: any) => void }) {
  const { data, loading, error, reload } = useLoad(() => mtg.listMeetings({ projectId, limit: 50 }), [projectId]);
  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  const items = data?.items ?? [];
  return (
    <div className="max-w-2xl space-y-3">
      <div className="flex items-center justify-between"><Section>회의 ({items.length})</Section><button onClick={() => navigate("meetings")} className="text-[11px] text-indigo-500 font-semibold hover:text-indigo-700">전체 회의 화면에서 생성 →</button></div>
      {items.length === 0 ? <p className="text-[13px] text-slate-400 py-8 text-center">이 프로젝트에 등록된 회의가 없습니다.</p> : (
        <div className="space-y-2">
          {items.map(m => (
            <Card key={m.meetingId} className="p-4 cursor-pointer hover:border-indigo-200 transition-colors" >
              <div onClick={() => navigate("meeting-detail", { meetingId: m.meetingId })} className="flex items-center justify-between gap-2">
                <div><p className="text-[13px] font-bold text-slate-800">{m.title}</p><p className="text-[11px] text-slate-400 mt-0.5">{fmtDateTime(m.scheduledStartAt)}</p></div>
                <MeetingStatusBadge status={m.status} />
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function ComingSoon({ label, reason }: { label: string; reason?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
      <p className="text-[14px] font-bold text-slate-700">{label} 연동 예정</p>
      <p className="text-[12px] text-slate-400">{reason ?? "이 탭은 해당 서비스 API 명세 작업 이후 연결됩니다."}</p>
    </div>
  );
}

// ───────────────────────── 개요 ─────────────────────────
function OverviewTab({ p, canManage, onChanged }: { p: ProjectResponse; canManage: boolean; onChanged: (p: ProjectResponse) => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(p.name);
  const [description, setDescription] = useState(p.description ?? "");
  const [aiPolicy, setAiPolicy] = useState<ExternalAiPolicy>(p.externalAiPolicy);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function act(name2: string, fn: () => Promise<ProjectResponse>, success: string) {
    setBusy(name2); setMsg(null); setFields({});
    try { onChanged(await fn()); setMsg({ ok: true, text: success }); }
    catch (e) { setMsg({ ok: false, text: errorText(e) }); setFields(fieldErrorMap(e)); }
    finally { setBusy(null); }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <Section>프로젝트 개요</Section>
          {canManage && p.status !== "ARCHIVED" && !editing && <button onClick={() => { setEditing(true); setName(p.name); setDescription(p.description ?? ""); }} className="text-[11px] text-indigo-500 font-semibold hover:text-indigo-700">수정</button>}
        </div>
        {editing ? (
          <div className="space-y-3">
            <Field label="프로젝트명" error={fields.name}><input value={name} onChange={e => setName(e.target.value)} maxLength={120} className={inputCls} /></Field>
            <Field label="설명" error={fields.description}><textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} maxLength={4000} className={inputCls} /></Field>
            <div className="flex gap-2">
              <button onClick={() => setEditing(false)} className={`flex-1 ${ghostBtn}`}>취소</button>
              <button disabled={busy === "meta" || !name.trim()} onClick={() => act("meta", () => api.updateProject(p.projectId, { name: name.trim(), description: description.trim() || undefined, version: p.version }).then(r => { setEditing(false); return r; }), "저장했습니다.")} className={`flex-1 ${primaryBtn}`}>저장</button>
            </div>
          </div>
        ) : (
          <p className="text-[14px] text-slate-700 leading-relaxed">{p.description || "설명이 없습니다."}</p>
        )}
        <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-50">
          {[["생성일", fmtDate(p.createdAt)], ["최근 수정", fmtDate(p.updatedAt)], ["완료일", p.completedAt ? fmtDate(p.completedAt) : "-"], ["보관일", p.archivedAt ? fmtDate(p.archivedAt) : "-"]].map(([l, v]) => (
            <div key={l}><p className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">{l}</p><p className="text-[14px] font-bold text-slate-800 mt-0.5">{v}</p></div>
          ))}
        </div>
      </Card>

      {canManage && (
        <Card className="p-5 space-y-3">
          <Section>외부 AI 전송 정책</Section>
          <p className="text-[11px] text-slate-400">이 프로젝트 자료를 외부 AI에 보낼지 결정합니다. 미확정 시 회사 기본 정책을 따릅니다.</p>
          <div className="flex gap-2">
            {(["INHERIT", "ALLOWED", "BLOCKED"] as const).map(v => (
              <button key={v} onClick={() => setAiPolicy(v)} className={`flex-1 py-2 rounded-xl text-[12px] font-bold border ${aiPolicy === v ? "bg-indigo-500 text-white border-indigo-500" : "border-slate-200 text-slate-500 hover:border-indigo-300"}`}>
                {v === "INHERIT" ? "회사 기본값" : v === "ALLOWED" ? "허용" : "차단"}
              </button>
            ))}
          </div>
          <button disabled={busy === "policy" || aiPolicy === p.externalAiPolicy} onClick={() => act("policy", () => api.updateProjectAiPolicy(p.projectId, { externalAiPolicy: aiPolicy, version: p.version }), "AI 정책을 변경했습니다.")} className={primaryBtn}>저장</button>
        </Card>
      )}

      {canManage && (
        <Card className="p-5 space-y-3">
          <Section>프로젝트 상태</Section>
          <div className="flex flex-wrap gap-2">
            {p.status === "ACTIVE" && <button disabled={!!busy} onClick={() => act("complete", () => api.completeProject(p.projectId, p.version).then(r => r.project), "프로젝트를 완료 처리했습니다.")} className={ghostBtn}>완료 처리</button>}
            {p.status === "COMPLETED" && <button disabled={!!busy} onClick={() => act("reopen", () => api.reopenProject(p.projectId, p.version), "프로젝트를 재개했습니다.")} className={ghostBtn}>다시 진행</button>}
            {p.status !== "ARCHIVED" && (
              <button disabled={!!busy} onClick={() => { if (confirm("보관하면 되돌릴 수 없습니다. 계속할까요?")) act("archive", () => api.archiveProject(p.projectId, p.version), "프로젝트를 보관했습니다."); }}
                className="px-4 py-2.5 border border-rose-200 text-rose-500 text-[13px] font-semibold rounded-xl hover:bg-rose-50 disabled:opacity-40">보관</button>
            )}
          </div>
        </Card>
      )}
      {msg && <p className={`text-[12px] font-medium ${msg.ok ? "text-emerald-600" : "text-rose-500"}`}>{msg.text}</p>}
    </div>
  );
}

// ───────────────────────── 구성원 ─────────────────────────
function AddMemberModal({ projectId, existing, onClose, onAdded }: { projectId: string; existing: Set<string>; onClose: () => void; onAdded: (m: ProjectMemberResponse) => void }) {
  const { users, loading } = useOrgUsers();
  const candidates = users.filter(u => !existing.has(u.userId));
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<ProjectRole>("MEMBER");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setError(null);
    try { onAdded(await api.addProjectMember(projectId, { userId, role })); onClose(); }
    catch (e) { setError(errorText(e)); setBusy(false); }
  }

  return (
    <Modal title="구성원 추가" onClose={onClose}>
      {loading ? <Spinner /> : (
        <>
          <Field label="사용자">
            <select value={userId} onChange={e => setUserId(e.target.value)} className={inputCls}>
              <option value="">선택하세요</option>
              {candidates.map(u => <option key={u.userId} value={u.userId}>{u.displayName}{u.jobTitle ? ` · ${u.jobTitle}` : ""}</option>)}
            </select>
          </Field>
          <Field label="역할">
            <div className="flex gap-2">
              {(["MANAGER", "MEMBER", "VIEWER"] as const).map(r => (
                <button key={r} onClick={() => setRole(r)} className={`flex-1 py-2 rounded-xl text-[12px] font-bold border ${role === r ? "bg-indigo-500 text-white border-indigo-500" : "border-slate-200 text-slate-500"}`}>
                  {r === "MANAGER" ? "담당자" : r === "MEMBER" ? "멤버" : "열람자"}
                </button>
              ))}
            </div>
          </Field>
          {error && <p className="text-[12px] text-rose-500 font-medium">{error}</p>}
          <div className="flex gap-2">
            <button onClick={onClose} className={`flex-1 ${ghostBtn}`}>취소</button>
            <button disabled={busy || !userId} onClick={submit} className={`flex-1 ${primaryBtn}`}>{busy ? "추가 중..." : "추가"}</button>
          </div>
        </>
      )}
    </Modal>
  );
}

function MembersTab({ projectId, canManage, myUserId }: { projectId: string; canManage: boolean; myUserId?: string }) {
  const { data, setData, loading, error, reload } = useLoad(() => api.listProjectMembers(projectId, { limit: 100 }), [projectId]);
  const { nameOf } = useOrgUsers();
  const [showAdd, setShowAdd] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const items = (data?.items ?? []).filter(m => m.status !== "REMOVED");

  function replace(m: ProjectMemberResponse) { setData(d => d && { ...d, items: d.items.map(x => x.membershipId === m.membershipId ? m : x) }); }

  async function changeRole(m: ProjectMemberResponse, role: ProjectRole) {
    setBusyId(m.membershipId); setMsg(null);
    try { replace(await api.updateProjectMemberRole(projectId, m.membershipId, { role, version: m.version })); }
    catch (e) { setMsg(errorText(e)); } finally { setBusyId(null); }
  }
  async function remove(m: ProjectMemberResponse) {
    if (!confirm(`${nameOf(m.userId)}님을 프로젝트에서 제거할까요?`)) return;
    setBusyId(m.membershipId); setMsg(null);
    try { await api.removeProjectMember(projectId, m.membershipId); setData(d => d && { ...d, items: d.items.filter(x => x.membershipId !== m.membershipId) }); }
    catch (e) { setMsg(errorText(e)); } finally { setBusyId(null); }
  }
  async function restore(m: ProjectMemberResponse) {
    setBusyId(m.membershipId); setMsg(null);
    try { replace(await api.restoreProjectMember(projectId, m.membershipId, m.version)); }
    catch (e) { setMsg(errorText(e)); } finally { setBusyId(null); }
  }

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  return (
    <Card className="max-w-2xl">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <p className="text-[13px] font-bold text-slate-800">구성원 {items.length}명</p>
        {canManage && <button onClick={() => setShowAdd(true)} className="flex items-center gap-1 px-3 py-1.5 bg-indigo-500 hover:bg-indigo-600 text-white text-[12px] font-bold rounded-xl">+ 구성원 추가</button>}
      </div>
      {msg && <p className="px-5 pt-3 text-[12px] text-rose-500 font-medium">{msg}</p>}
      {items.map(m => (
        <div key={m.membershipId} className="flex items-center gap-3 px-5 py-3 border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors">
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-slate-800 truncate">{nameOf(m.userId)}{m.userId === myUserId && " (나)"}</p>
            <p className="text-[11px] text-slate-400">{m.status === "SUSPENDED_BY_IDENTITY" ? "일시 정지됨" : m.status === "ACTIVE" ? "활성" : m.status}{!m.identityAvailability && " · 계정 비활성"}</p>
          </div>
          {canManage ? (
            <select value={m.role} disabled={busyId === m.membershipId || m.status !== "ACTIVE"} onChange={e => changeRole(m, e.target.value as ProjectRole)}
              className="text-[11px] font-semibold border border-slate-200 rounded-lg px-2 py-1 bg-white disabled:opacity-50">
              <option value="MANAGER">담당자</option><option value="MEMBER">멤버</option><option value="VIEWER">열람자</option>
            </select>
          ) : <ProjectRoleBadge role={m.role} />}
          {canManage && m.status === "SUSPENDED_BY_IDENTITY" && <button disabled={busyId === m.membershipId} onClick={() => restore(m)} className="text-[11px] text-emerald-600 font-semibold hover:bg-emerald-50 px-2 py-1 rounded-lg">복구</button>}
          {canManage && m.status === "ACTIVE" && <button disabled={busyId === m.membershipId} onClick={() => remove(m)} className="text-[11px] text-slate-400 hover:text-rose-500 px-2 py-1 rounded-lg hover:bg-rose-50">제거</button>}
        </div>
      ))}
      {showAdd && <AddMemberModal projectId={projectId} existing={new Set(items.filter(m => m.status !== "REMOVED").map(m => m.userId))} onClose={() => setShowAdd(false)} onAdded={m => setData(d => d ? { ...d, items: [...d.items, m] } : d)} />}
    </Card>
  );
}

// ───────────────────────── 업무 ─────────────────────────
const MEMBER_NEXT: Record<TaskStatus, TaskStatus[]> = { TODO: ["IN_PROGRESS"], IN_PROGRESS: ["TODO", "DONE"], DONE: [], CANCELED: [] };
const MANAGER_NEXT: Record<TaskStatus, TaskStatus[]> = { TODO: ["IN_PROGRESS", "CANCELED"], IN_PROGRESS: ["TODO", "DONE", "CANCELED"], DONE: ["IN_PROGRESS"], CANCELED: ["TODO"] };

function TaskModal({ projectId, task, canManage, myUserId, members, nameOf, onClose, onSaved, onCreated }: {
  projectId: string; task: TaskResponse | null; canManage: boolean; myUserId?: string;
  members: ProjectMemberResponse[]; nameOf: (id?: string | null) => string;
  onClose: () => void; onSaved: (t: TaskResponse) => void; onCreated: (t: TaskResponse) => void;
}) {
  const isNew = !task;
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [assigneeUserId, setAssigneeUserId] = useState(task?.assigneeUserId ?? "");
  const [dueAt, setDueAt] = useState(task?.dueAt ? task.dueAt.slice(0, 10) : "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const isAssignee = !!task && task.assigneeUserId === myUserId;
  const nextStatuses = task ? (canManage ? MANAGER_NEXT[task.status] : isAssignee ? MEMBER_NEXT[task.status] : []) : [];
  const assignable = members.filter(m => m.role !== "VIEWER" && m.status === "ACTIVE");

  async function run(name: string, fn: () => Promise<TaskResponse>) {
    setBusy(name); setError(null); setFields({});
    try { const r = await fn(); onSaved(r); return r; } catch (e) { setError(errorText(e)); setFields(fieldErrorMap(e)); throw e; } finally { setBusy(null); }
  }

  async function create() {
    setBusy("create"); setError(null); setFields({});
    try {
      const r = await api.createTask(projectId, { title: title.trim(), description: description.trim() || undefined, assigneeUserId: assigneeUserId || undefined, dueAt: dueAt ? new Date(dueAt).toISOString() : undefined });
      onCreated(r); onClose();
    } catch (e) { setError(errorText(e)); setFields(fieldErrorMap(e)); } finally { setBusy(null); }
  }
  async function saveMeta() { if (task) await run("meta", () => api.updateTask(projectId, task.taskId, { title: title.trim(), description: description.trim() || undefined, version: task.version })); }
  async function saveDeadline(t: TaskResponse) { await run("deadline", () => api.updateTaskDeadline(projectId, t.taskId, { dueAt: dueAt ? new Date(dueAt).toISOString() : null, version: t.version })); }
  async function saveAssignee(t: TaskResponse, uid: string) {
    await run("assignee", () => uid ? api.updateTaskAssignee(projectId, t.taskId, { assigneeUserId: uid, version: t.version }) : api.unassignTask(projectId, t.taskId));
  }
  async function setStatus(t: TaskResponse, status: TaskStatus) { await run("status", () => api.updateTaskStatus(projectId, t.taskId, { status, version: t.version })); }
  async function cancelTask(t: TaskResponse) { if (confirm("이 업무를 취소할까요?")) await run("cancel", () => api.cancelTask(projectId, t.taskId, t.version)); }

  return (
    <Modal title={isNew ? "새 업무" : "업무 상세"} onClose={onClose}>
      {(!isNew && canManage) || isNew ? (
        <>
          <Field label="제목" error={fields.title}><input value={title} onChange={e => setTitle(e.target.value)} maxLength={160} disabled={!isNew && busy !== null} className={inputCls} /></Field>
          <Field label="설명" error={fields.description}><textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} maxLength={4000} className={inputCls} /></Field>
        </>
      ) : (
        <div><p className={labelCls}>제목</p><p className="text-[14px] font-semibold text-slate-800">{title}</p>{description && <p className="text-[12px] text-slate-500 mt-1">{description}</p>}</div>
      )}

      {isNew ? (
        <>
          <Field label="담당자 (선택)">
            <select value={assigneeUserId} onChange={e => setAssigneeUserId(e.target.value)} className={inputCls}>
              <option value="">미지정</option>
              {assignable.map(m => <option key={m.userId} value={m.userId}>{nameOf(m.userId)}</option>)}
            </select>
          </Field>
          <Field label="마감일 (선택)"><input type="date" value={dueAt} onChange={e => setDueAt(e.target.value)} className={inputCls} /></Field>
          {error && <p className="text-[12px] text-rose-500 font-medium">{error}</p>}
          <div className="flex gap-2">
            <button onClick={onClose} className={`flex-1 ${ghostBtn}`}>취소</button>
            <button disabled={busy !== null || !title.trim()} onClick={create} className={`flex-1 ${primaryBtn}`}>{busy ? "생성 중..." : "생성"}</button>
          </div>
        </>
      ) : task && (
        <>
          <div className="flex items-center gap-2"><TaskStatusBadge status={task.status} />{task.assigneeUserId && !task.assigneeAvailability && <span className="text-[10px] text-rose-500 font-semibold">담당자 계정 비활성</span>}</div>

          {canManage ? (
            <Field label="담당자">
              <select value={task.assigneeUserId ?? ""} disabled={busy !== null} onChange={e => saveAssignee(task, e.target.value)} className={inputCls}>
                <option value="">미지정</option>
                {assignable.map(m => <option key={m.userId} value={m.userId}>{nameOf(m.userId)}</option>)}
              </select>
            </Field>
          ) : <div><p className={labelCls}>담당자</p><p className="text-[13px] text-slate-700">{nameOf(task.assigneeUserId) ?? "미지정"}</p></div>}

          {canManage ? (
            <Field label="마감일">
              <div className="flex gap-2">
                <input type="date" value={dueAt} onChange={e => setDueAt(e.target.value)} className={inputCls} />
                <button disabled={busy !== null} onClick={() => saveDeadline(task)} className={ghostBtn}>저장</button>
              </div>
            </Field>
          ) : <div><p className={labelCls}>마감일</p><p className="text-[13px] text-slate-700">{fmtDate(task.dueAt)}</p></div>}

          {canManage && (
            <div className="flex gap-2">
              <button disabled={busy !== null} onClick={saveMeta} className={ghostBtn}>제목/설명 저장</button>
            </div>
          )}

          {nextStatuses.length > 0 && (
            <div>
              <p className={labelCls}>상태 변경</p>
              <div className="flex flex-wrap gap-2">
                {nextStatuses.map(s => <button key={s} disabled={busy !== null} onClick={() => setStatus(task, s)} className={ghostBtn}><TaskStatusBadge status={s} /></button>)}
              </div>
            </div>
          )}
          {canManage && task.status !== "CANCELED" && task.status !== "DONE" && (
            <button disabled={busy !== null} onClick={() => cancelTask(task)} className="text-[12px] text-rose-500 font-semibold hover:bg-rose-50 px-3 py-2 rounded-xl">업무 취소</button>
          )}
          {error && <p className="text-[12px] text-rose-500 font-medium">{error}</p>}
        </>
      )}
    </Modal>
  );
}

function TasksTab({ projectId, canManage, myUserId }: { projectId: string; canManage: boolean; myUserId?: string }) {
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "ALL">("ALL");
  const { data, setData, loading, error, reload } = useLoad(() => api.listTasks(projectId, { status: statusFilter === "ALL" ? undefined : statusFilter, limit: 100 }), [projectId, statusFilter]);
  const membersLoad = useLoad(() => api.listProjectMembers(projectId, { limit: 100 }), [projectId]);
  const { nameOf } = useOrgUsers();
  const [open, setOpen] = useState<TaskResponse | "new" | null>(null);
  const items = data?.items ?? [];
  const members = membersLoad.data?.items ?? [];

  function replace(t: TaskResponse) { setData(d => d && { ...d, items: d.items.map(x => x.taskId === t.taskId ? t : x) }); setOpen(null); }
  function add(t: TaskResponse) { setData(d => d && { ...d, items: [t, ...d.items] }); }

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  return (
    <div className="max-w-2xl space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {(["ALL", "TODO", "IN_PROGRESS", "DONE", "CANCELED"] as const).map(s => (
            <button key={s} onClick={() => setStatusFilter(s)} className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold ${statusFilter === s ? "bg-indigo-500 text-white" : "text-slate-500 hover:bg-slate-100"}`}>{s === "ALL" ? "전체" : s}</button>
          ))}
        </div>
        <button onClick={() => setOpen("new")} className="flex items-center gap-1 px-3 py-1.5 bg-indigo-500 hover:bg-indigo-600 text-white text-[12px] font-bold rounded-xl">+ 업무</button>
      </div>
      {items.length === 0 ? <Card className="p-8 text-center text-[13px] text-slate-400">업무가 없습니다.</Card> : items.map(t => {
        const d = daysUntil(t.dueAt);
        return (
          <div key={t.taskId} onClick={() => setOpen(t)}
            className="bg-white border border-slate-100 rounded-2xl px-4 py-3 flex items-center gap-3 hover:border-indigo-200 hover:shadow-sm transition-all cursor-pointer">
            <TaskStatusBadge status={t.status} />
            <div className="flex-1 min-w-0"><p className="text-[13px] font-semibold text-slate-800 truncate">{t.title}</p><p className="text-[11px] text-slate-400">{nameOf(t.assigneeUserId) ?? "미지정"}</p></div>
            {d != null && t.status !== "DONE" && t.status !== "CANCELED" && <span className={`text-[11px] font-semibold ${d < 0 ? "text-rose-500" : d <= 3 ? "text-amber-500" : "text-slate-400"}`}>{d < 0 ? `D+${Math.abs(d)}` : `D-${d}`}</span>}
          </div>
        );
      })}
      {open && (
        <TaskModal projectId={projectId} task={open === "new" ? null : open} canManage={canManage} myUserId={myUserId} members={members} nameOf={nameOf}
          onClose={() => setOpen(null)} onSaved={replace} onCreated={t => { add(t); setOpen(null); }} />
      )}
    </div>
  );
}

// ───────────────────────── 결정 ─────────────────────────
function DecisionModal({ projectId, decision, onClose, onSaved, onCreated, onSuperseded }: {
  projectId: string; decision: DecisionResponse | null; onClose: () => void;
  onSaved: (d: DecisionResponse) => void; onCreated: (d: DecisionResponse) => void; onSuperseded: (prev: DecisionResponse, cur: DecisionResponse) => void;
}) {
  const isNew = !decision;
  const [title, setTitle] = useState(decision?.title ?? "");
  const [content, setContent] = useState(decision?.content ?? "");
  const [mode, setMode] = useState<"edit" | "supersede">("edit");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function submit() {
    setBusy(true); setError(null); setFields({});
    try {
      if (isNew) onCreated(await api.createDecision(projectId, { title: title.trim(), content: content.trim() }));
      else if (mode === "edit") onSaved(await api.updateDecision(projectId, decision.decisionId, { title: title.trim(), content: content.trim(), version: decision.version }));
      else { const r = await api.supersedeDecision(projectId, decision.decisionId, { title: title.trim(), content: content.trim(), sourceDecisionVersion: decision.version }); onSuperseded(r.previous, r.current); }
      onClose();
    } catch (e) { setError(errorText(e)); setFields(fieldErrorMap(e)); } finally { setBusy(false); }
  }

  return (
    <Modal title={isNew ? "새 결정" : "결정 수정"} onClose={onClose}>
      {!isNew && decision.status === "ACTIVE" && (
        <div className="flex gap-2">
          {(["edit", "supersede"] as const).map(m => (
            <button key={m} onClick={() => setMode(m)} className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold border ${mode === m ? "bg-indigo-500 text-white border-indigo-500" : "border-slate-200 text-slate-500"}`}>
              {m === "edit" ? "내용 수정" : "새 버전으로 대체"}
            </button>
          ))}
        </div>
      )}
      <Field label="제목" error={fields.title}><input value={title} onChange={e => setTitle(e.target.value)} maxLength={160} className={inputCls} /></Field>
      <Field label="내용" error={fields.content}><textarea rows={4} value={content} onChange={e => setContent(e.target.value)} maxLength={10000} className={inputCls} /></Field>
      {mode === "supersede" && <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">기존 결정은 "대체됨"으로 표시되고, 이 내용으로 새 결정이 생성됩니다.</p>}
      {error && <p className="text-[12px] text-rose-500 font-medium">{error}</p>}
      <div className="flex gap-2">
        <button onClick={onClose} className={`flex-1 ${ghostBtn}`}>취소</button>
        <button disabled={busy || !title.trim() || !content.trim()} onClick={submit} className={`flex-1 ${primaryBtn}`}>{busy ? "저장 중..." : "저장"}</button>
      </div>
    </Modal>
  );
}

function DecisionsTab({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const { data, setData, loading, error, reload } = useLoad(() => api.listDecisions(projectId, { limit: 100 }), [projectId]);
  const [open, setOpen] = useState<DecisionResponse | "new" | null>(null);
  const items = data?.items ?? [];

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  return (
    <div className="max-w-2xl space-y-3">
      {canManage && <div className="flex justify-end"><button onClick={() => setOpen("new")} className="flex items-center gap-1.5 px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white text-[13px] font-bold rounded-xl">+ 결정 기록</button></div>}
      {items.length === 0 ? <Card className="p-8 text-center text-[13px] text-slate-400">결정 내역이 없습니다.</Card> : items.map(d => (
        <Card key={d.decisionId} className={`p-5 ${canManage && d.status === "ACTIVE" ? "cursor-pointer hover:border-indigo-200" : ""}`} {...(canManage && d.status === "ACTIVE" ? { onClick: () => setOpen(d) } : {})}>
          <div className="flex items-center gap-2 mb-2"><DecisionStatusBadge status={d.status} /><p className="text-[14px] font-bold text-slate-800">{d.title}</p></div>
          <p className="text-[12px] text-slate-500 whitespace-pre-wrap">{d.content}</p>
          <p className="text-[11px] text-slate-400 mt-2">확정일 {fmtDate(d.confirmedAt)}</p>
        </Card>
      ))}
      {open && (
        <DecisionModal projectId={projectId} decision={open === "new" ? null : open}
          onClose={() => setOpen(null)}
          onSaved={d => setData(x => x && { ...x, items: x.items.map(y => y.decisionId === d.decisionId ? d : y) })}
          onCreated={d => setData(x => x && { ...x, items: [d, ...x.items] })}
          onSuperseded={(prev, cur) => setData(x => x && { ...x, items: [cur, ...x.items.map(y => y.decisionId === prev.decisionId ? prev : y)] })}
        />
      )}
    </div>
  );
}

// ───────────────────────── 일정 ─────────────────────────
function ScheduleModal({ projectId, item, onClose, onSaved, onCreated }: {
  projectId: string; item: ProjectScheduleItemResponse | null; onClose: () => void;
  onSaved: (s: ProjectScheduleItemResponse) => void; onCreated: (s: ProjectScheduleItemResponse) => void;
}) {
  const isNew = !item;
  const [type, setType] = useState<ProjectScheduleType>(item?.type ?? "MILESTONE");
  const [title, setTitle] = useState(item?.title ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [startsAt, setStartsAt] = useState(item?.startsAt ? item.startsAt.slice(0, 10) : "");
  const [endsAt, setEndsAt] = useState(item?.endsAt ? item.endsAt.slice(0, 10) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function submit() {
    setBusy(true); setError(null); setFields({});
    const body = { type, title: title.trim(), description: description.trim() || undefined, startsAt: new Date(startsAt).toISOString(), endsAt: endsAt ? new Date(endsAt).toISOString() : undefined };
    try {
      if (isNew) onCreated(await api.createScheduleItem(projectId, body));
      else onSaved(await api.updateScheduleItem(projectId, item.scheduleItemId, { ...body, version: item.version }));
      onClose();
    } catch (e) { setError(errorText(e)); setFields(fieldErrorMap(e)); } finally { setBusy(false); }
  }
  async function cancelItem() {
    if (!item || !confirm("이 일정을 취소할까요?")) return;
    setBusy(true);
    try { onSaved(await api.cancelScheduleItem(projectId, item.scheduleItemId, item.version)); onClose(); }
    catch (e) { setError(errorText(e)); setBusy(false); }
  }

  return (
    <Modal title={isNew ? "새 일정" : "일정 수정"} onClose={onClose}>
      <Field label="종류">
        <div className="flex gap-2">
          {(["MILESTONE", "EVENT"] as const).map(t => <button key={t} onClick={() => setType(t)} className={`flex-1 py-2 rounded-xl text-[12px] font-bold border ${type === t ? "bg-indigo-500 text-white border-indigo-500" : "border-slate-200 text-slate-500"}`}>{t === "MILESTONE" ? "마일스톤" : "이벤트"}</button>)}
        </div>
      </Field>
      <Field label="제목" error={fields.title}><input value={title} onChange={e => setTitle(e.target.value)} maxLength={160} className={inputCls} /></Field>
      <Field label="설명 (선택)" error={fields.description}><textarea rows={2} value={description} onChange={e => setDescription(e.target.value)} maxLength={2000} className={inputCls} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="시작일" error={fields.startsAt}><input type="date" value={startsAt} onChange={e => setStartsAt(e.target.value)} className={inputCls} /></Field>
        <Field label="종료일 (선택)" error={fields.endsAt}><input type="date" value={endsAt} onChange={e => setEndsAt(e.target.value)} className={inputCls} /></Field>
      </div>
      {error && <p className="text-[12px] text-rose-500 font-medium">{error}</p>}
      <div className="flex gap-2">
        {!isNew && item.status === "ACTIVE" && <button onClick={cancelItem} disabled={busy} className="px-4 py-2.5 border border-rose-200 text-rose-500 text-[13px] font-semibold rounded-xl hover:bg-rose-50 disabled:opacity-40">취소 처리</button>}
        <button onClick={onClose} className={`flex-1 ${ghostBtn}`}>닫기</button>
        <button disabled={busy || !title.trim() || !startsAt} onClick={submit} className={`flex-1 ${primaryBtn}`}>{busy ? "저장 중..." : "저장"}</button>
      </div>
    </Modal>
  );
}

function ScheduleTab({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const { data, setData, loading, error, reload } = useLoad(() => api.listSchedule(projectId, { limit: 100 }), [projectId]);
  const [open, setOpen] = useState<ProjectScheduleItemResponse | "new" | null>(null);
  const items = data?.items ?? [];

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  return (
    <div className="max-w-2xl space-y-3">
      {canManage && <div className="flex justify-end"><button onClick={() => setOpen("new")} className="flex items-center gap-1.5 px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white text-[13px] font-bold rounded-xl">+ 일정 추가</button></div>}
      {items.length === 0 ? <Card className="p-8 text-center text-[13px] text-slate-400">등록된 일정이 없습니다.</Card> : items.map(s => (
        <div key={s.scheduleItemId} onClick={() => canManage && setOpen(s)}
          className={`flex items-center gap-3 py-2 px-4 bg-white border border-slate-100 rounded-2xl ${canManage ? "cursor-pointer hover:border-indigo-200" : ""} ${s.status === "CANCELED" ? "opacity-50" : ""}`}>
          <div className="w-12 h-12 rounded-xl bg-indigo-50 flex flex-col items-center justify-center shrink-0">
            <p className="text-[10px] text-indigo-400 font-bold">{s.startsAt ? new Date(s.startsAt).toLocaleDateString("ko-KR", { month: "short" }) : "-"}</p>
            <p className="text-[16px] font-extrabold text-indigo-600 leading-none">{s.startsAt ? new Date(s.startsAt).getDate() : "-"}</p>
          </div>
          <div className="flex-1"><p className="text-[13px] font-semibold text-slate-800">{s.title}{s.status === "CANCELED" && " (취소됨)"}</p><p className="text-[11px] text-slate-400">{s.type === "MILESTONE" ? "마일스톤" : "이벤트"}</p></div>
        </div>
      ))}
      {open && <ScheduleModal projectId={projectId} item={open === "new" ? null : open} onClose={() => setOpen(null)}
        onSaved={s => setData(d => d && { ...d, items: d.items.map(x => x.scheduleItemId === s.scheduleItemId ? s : x) })}
        onCreated={s => setData(d => d && { ...d, items: [...d.items, s] })} />}
    </div>
  );
}

// ───────────────────────── 화면 ─────────────────────────
export default function ProjectDetailScreen({ projectId, navigate, initialTab }: { projectId: string; navigate: (s: any, ctx?: any) => void; initialTab?: string }) {
  const { me } = useAuth();
  const [tab, setTab] = useState<Tab>((TABS as string[]).includes(initialTab ?? "") ? (initialTab as Tab) : "개요");
  const { data: project, setData: setProject, loading, error, reload } = useLoad(() => api.getProject(projectId), [projectId]);

  if (loading && !project) return <Spinner text="프로젝트를 불러오는 중..." />;
  if (error && !project) return <ErrorBox message={error} onRetry={reload} />;
  if (!project) return null;

  const canManage = project.myRole === "MANAGER";

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="shrink-0 bg-white border-b border-slate-100 px-6 py-4">
        <div className="flex items-center gap-3 mb-3">
          <button onClick={() => navigate("projects")} className="w-8 h-8 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h2 className="text-[17px] font-extrabold text-slate-900">{project.name}</h2>
              <ProjectStatusBadge status={project.status} />
              <ProjectRoleBadge role={project.myRole} />
              {project.managerRecoveryRequired && <span className="text-[10px] font-bold text-rose-500 bg-rose-50 px-2 py-0.5 rounded-full">담당자 없음</span>}
            </div>
          </div>
        </div>
        <div className="flex gap-0 overflow-x-auto">
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)} className={`px-4 py-2.5 text-[13px] font-semibold border-b-2 transition-colors shrink-0 ${tab === t ? "border-indigo-500 text-indigo-600" : "border-transparent text-slate-400 hover:text-slate-600"}`}>{t}</button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 bg-slate-50/40">
        {tab === "개요" && <OverviewTab p={project} canManage={canManage} onChanged={setProject} />}
        {tab === "구성원" && <MembersTab projectId={projectId} canManage={canManage} myUserId={me?.userId} />}
        {tab === "업무" && <TasksTab projectId={projectId} canManage={canManage} myUserId={me?.userId} />}
        {tab === "결정" && <DecisionsTab projectId={projectId} canManage={canManage} />}
        {tab === "일정" && <ScheduleTab projectId={projectId} canManage={canManage} />}
        {tab === "회의" && <MeetingsTab projectId={projectId} navigate={navigate} />}
        {tab === "문서" && <ComingSoon label="프로젝트별 문서 목록" reason="문서(03) API는 문서→프로젝트 연결/해제만 제공하고 프로젝트 기준 문서 목록 조회 API가 없습니다. 연결된 문서는 문서 화면에서 개별적으로 확인해 주세요." />}
      </div>
    </div>
  );
}
