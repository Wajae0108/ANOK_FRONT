// "내 업무" — 모든 접근 가능한 프로젝트에서 나에게 배정된 Task를 모아 보여준다 (project-service에 cross-project 조회 API가 없어 프론트에서 취합).
import { useState } from "react";
import * as api from "../api/project";
import type { ProjectRole, TaskResponse, TaskStatus } from "../api/project";
import { errorText } from "../api/errors";
import { useAuth } from "../auth/AuthProvider";
import { Card, ErrorBox, Spinner, useLoad } from "../ui/kit";
import { TaskStatusBadge, daysUntil, fmtDate } from "./shared";

type Row = TaskResponse & { projectName: string; myRoleInProject: ProjectRole };

const MEMBER_NEXT: Record<TaskStatus, TaskStatus[]> = { TODO: ["IN_PROGRESS"], IN_PROGRESS: ["TODO", "DONE"], DONE: [], CANCELED: [] };
const MANAGER_NEXT: Record<TaskStatus, TaskStatus[]> = { TODO: ["IN_PROGRESS", "CANCELED"], IN_PROGRESS: ["TODO", "DONE", "CANCELED"], DONE: ["IN_PROGRESS"], CANCELED: ["TODO"] };

// 서버는 "me" 같은 별칭 필터가 없다. assigneeUserId에는 본인 ID만 허용된다(다른 사람이면 TASK_FILTER_FORBIDDEN).
async function loadMyTasks(userId: string): Promise<Row[]> {
  const projects = (await api.listProjects({ limit: 100 })).items;
  const perProject = await Promise.all(projects.map(async p => {
    const tasks = (await api.listTasks(p.projectId, { assigneeUserId: userId, limit: 100 })).items;
    return tasks.map(t => ({ ...t, projectName: p.name, myRoleInProject: p.myRole }));
  }));
  return perProject.flat().sort((a, b) => (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999"));
}

export default function MyTasksScreen() {
  const { me } = useAuth();
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "ALL">("ALL");
  const [view, setView] = useState<"list" | "kanban">("list");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const { data, setData, loading, error, reload } = useLoad(() => (me ? loadMyTasks(me.userId) : Promise.resolve([])), [me?.userId]);
  const rows = data ?? [];
  const filtered = statusFilter === "ALL" ? rows : rows.filter(r => r.status === statusFilter);

  async function setStatus(row: Row, status: TaskStatus) {
    setBusyId(row.taskId); setRowError(null);
    try {
      const updated = await api.updateTaskStatus(row.projectId, row.taskId, { status, version: row.version });
      setData(d => d && d.map(r => r.taskId === row.taskId ? { ...updated, projectName: row.projectName, myRoleInProject: row.myRoleInProject } : r));
    } catch (e) { setRowError(errorText(e)); } finally { setBusyId(null); }
  }

  if (loading && !data) return <div className="h-full bg-slate-50/40"><Spinner text="내 업무를 불러오는 중..." /></div>;
  if (error && !data) return <div className="h-full bg-slate-50/40"><ErrorBox message={error} onRetry={reload} /></div>;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="shrink-0 px-6 py-4 bg-white border-b border-slate-100 flex items-center justify-between">
        <div className="flex gap-1">
          {(["ALL", "TODO", "IN_PROGRESS", "DONE", "CANCELED"] as const).map(f => (
            <button key={f} onClick={() => setStatusFilter(f)} className={`px-3 py-1.5 rounded-xl text-[12px] font-semibold transition-colors ${statusFilter === f ? "bg-indigo-500 text-white" : "text-slate-500 hover:bg-slate-100"}`}>{f === "ALL" ? "전체" : f}</button>
          ))}
        </div>
        <div className="flex gap-1">
          {(["list", "kanban"] as const).map(v => (
            <button key={v} onClick={() => setView(v)} className={`px-3 py-1.5 rounded-xl text-[12px] font-semibold transition-colors ${view === v ? "bg-slate-200 text-slate-700" : "text-slate-400 hover:bg-slate-100"}`}>{v === "list" ? "목록" : "칸반"}</button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 bg-slate-50/40">
        {rowError && <p className="mb-3 text-[12px] text-rose-500 font-medium">{rowError}</p>}
        {filtered.length === 0 ? (
          <Card className="p-10 text-center text-[13px] text-slate-400">배정된 업무가 없습니다.</Card>
        ) : view === "list" ? (
          <Card>
            <table className="w-full">
              <thead><tr className="border-b border-slate-100 bg-slate-50/50">
                {["업무명", "프로젝트", "상태", "마감일", "상태 변경"].map(h => <th key={h} className="text-left text-[10px] font-bold text-slate-400 uppercase tracking-[0.1em] px-4 py-3.5">{h}</th>)}
              </tr></thead>
              <tbody>
                {filtered.map(t => {
                  const d = daysUntil(t.dueAt);
                  const overdue = d != null && d < 0 && t.status !== "DONE" && t.status !== "CANCELED";
                  const next = t.myRoleInProject === "MANAGER" ? MANAGER_NEXT[t.status] : MEMBER_NEXT[t.status];
                  return (
                    <tr key={t.taskId} className="border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 font-semibold text-slate-800 text-[13px]"><div className="flex items-center gap-2">{overdue && <span className="w-2 h-2 rounded-full bg-rose-400 shrink-0" />}{t.title}</div></td>
                      <td className="px-4 py-3 text-[12px] text-slate-400 font-medium">{t.projectName}</td>
                      <td className="px-4 py-3"><TaskStatusBadge status={t.status} /></td>
                      <td className={`px-4 py-3 text-[12px] font-semibold ${overdue ? "text-rose-500" : d != null && d <= 3 ? "text-amber-500" : "text-slate-400"}`}>{fmtDate(t.dueAt)}{overdue ? " (기한 초과)" : ""}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1.5">
                          {next.map(s => <button key={s} disabled={busyId === t.taskId} onClick={() => setStatus(t, s)} className="text-[11px] font-semibold text-indigo-500 hover:bg-indigo-50 px-2 py-1 rounded-lg disabled:opacity-40">{s === "TODO" ? "대기로" : s === "IN_PROGRESS" ? "진행 시작" : s === "DONE" ? "완료" : "취소"}</button>)}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        ) : (
          <div className="flex gap-4 h-full" style={{ minWidth: "640px" }}>
            {(["TODO", "IN_PROGRESS", "DONE"] as const).map(col => {
              const colTasks = filtered.filter(t => t.status === col);
              return (
                <div key={col} className="flex-1 flex flex-col">
                  <div className="flex items-center gap-2 mb-3 px-1">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: col === "IN_PROGRESS" ? "#4f6ef7" : col === "DONE" ? "#10b981" : "#94a3b8" }} />
                    <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">{col === "TODO" ? "대기" : col === "IN_PROGRESS" ? "진행 중" : "완료"}</span>
                    <span className="text-[10px] text-slate-400 bg-slate-100 rounded-full px-1.5 py-0.5 font-semibold">{colTasks.length}</span>
                  </div>
                  <div className="space-y-2.5 overflow-y-auto flex-1">
                    {colTasks.map(t => {
                      const next = t.myRoleInProject === "MANAGER" ? MANAGER_NEXT[t.status] : MEMBER_NEXT[t.status];
                      return (
                        <div key={t.taskId} className="bg-white border border-slate-100 rounded-2xl p-4 hover:border-indigo-200 hover:shadow-[0_4px_16px_rgba(79,110,247,0.08)] transition-all">
                          <p className="text-[13px] font-semibold text-slate-800 mb-1.5">{t.title}</p>
                          <p className="text-[11px] text-slate-400 mb-3">{t.projectName}</p>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-slate-400 font-semibold">{fmtDate(t.dueAt)}</span>
                            <div className="flex gap-1">
                              {next.map(s => <button key={s} disabled={busyId === t.taskId} onClick={() => setStatus(t, s)} className="text-[10px] font-semibold text-indigo-500 hover:bg-indigo-50 px-1.5 py-0.5 rounded disabled:opacity-40">{s === "TODO" ? "◀" : s === "IN_PROGRESS" ? "▶" : s === "DONE" ? "✓" : "✕"}</button>)}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
