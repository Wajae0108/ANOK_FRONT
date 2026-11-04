// "내 업무" — 내가 담당한 업무를 모아 보여준다. 기본은 미완료, 완료/취소는 별도 탭. 업무를 선택하면 오른쪽 상세 패널이 열린다.
// 목록(기본)과 보드는 같은 데이터를 쓰고, 목록 행의 빠른 상태 변경도 유지한다.
import { useMemo, useState } from "react";
import * as api from "../api/project";
import type { TaskStatus } from "../api/project";
import { errorText } from "../api/errors";
import { useAuth } from "../auth/AuthProvider";
import { Button, ErrorBox, Input, Select, Spinner, Tabs } from "../ui/kit";
import { BoardIcon, ListIcon, SearchIcon } from "../ui/icons";
import type { Navigate } from "../workspace/nav";
import { isOpenStatus, nextStatuses, useMyTasks } from "./myTasks";
import type { MyTaskRow } from "./myTasks";
import TaskDetailPanel from "./TaskDetailPanel";
import { DUE_TONE_CLS, dueTone, fmtMD, taskStatusLabel, TaskStatusChip, TaskStatusMark } from "./shared";

type TabKey = "open" | "done";
type SortKey = "due" | "project" | "updated";
type View = "list" | "board";

const LIST_GRID = "grid grid-cols-[minmax(0,1fr)_110px_minmax(0,200px)_90px] gap-x-6";
const ACTION_LABEL:Record<TaskStatus, string> = { TODO: "대기로", IN_PROGRESS: "진행 시작", DONE: "완료", CANCELED: "취소" };

function sortRows(rows: MyTaskRow[], sort: SortKey) {
  const r = [...rows];
  if (sort === "due") r.sort((a, b) => (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999"));
  else if (sort === "project") r.sort((a, b) => a.projectName.localeCompare(b.projectName, "ko") || (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999"));
  else r.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return r;
}

export default function MyTasksScreen({ navigate, initialTaskId }: { navigate: Navigate; initialTaskId?: string }) {
  const { me } = useAuth();
  const { data, setData, loading, error, reload } = useMyTasks(me?.userId);
  const [tab, setTab] = useState<TabKey>("open");
  const [view, setView] = useState<View>("list");
  const [q, setQ] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "">("");
  const [sort, setSort] = useState<SortKey>("due");
  const [selectedId, setSelectedId] = useState<string | null>(initialTaskId ?? null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const rows = data ?? [];
  const selected = rows.find(r => r.taskId === selectedId) ?? null;
  const openCount = rows.filter(r => isOpenStatus(r.status)).length;
  const doneCount = rows.length - openCount;
  const projects = useMemo(() => [...new Map(rows.map(r => [r.projectId, r.projectName])).entries()], [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const base = rows.filter(r => {
      if (view === "list" && (tab === "open") !== isOpenStatus(r.status)) return false;
      if (projectFilter && r.projectId !== projectFilter) return false;
      if (statusFilter && r.status !== statusFilter) return false;
      if (needle && !r.title.toLowerCase().includes(needle) && !r.projectName.toLowerCase().includes(needle)) return false;
      return true;
    });
    return sortRows(base, sort);
  }, [rows, view, tab, projectFilter, statusFilter, q, sort]);

  function applyUpdate(updated: MyTaskRow) {
    // 담당자가 다른 사람으로 바뀌면 더 이상 "내 업무"가 아니므로 목록과 패널에서 뺀다.
    if (updated.assigneeUserId !== me?.userId) {
      setData(d => d && d.filter(r => r.taskId !== updated.taskId));
      setSelectedId(s => (s === updated.taskId ? null : s));
    } else {
      setData(d => d && d.map(r => (r.taskId === updated.taskId ? updated : r)));
    }
  }

  async function quickStatus(row: MyTaskRow, status: TaskStatus) {
    setBusyId(row.taskId); setRowError(null);
    try { applyUpdate({ ...(await api.updateTaskStatus(row.projectId, row.taskId, { status, version: row.version })), projectName: row.projectName, myRoleInProject: row.myRoleInProject }); }
    catch (e) { setRowError(errorText(e)); }
    finally { setBusyId(null); }
  }

  if (loading && !data) return <Spinner text="내 업무를 불러오는 중..." />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;

  const statusOptions: TaskStatus[] = tab === "open" ? ["TODO", "IN_PROGRESS"] : ["DONE", "CANCELED"];
  const filtering = !!(q.trim() || projectFilter || statusFilter);

  function quickActions(row: MyTaskRow) {
    const next = nextStatuses(row);
    if (next.length === 0) return null;
    return (
      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1 pl-6 bg-gradient-to-l from-white via-white to-transparent opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        {next.map(s => (
          <Button key={s} size="sm" variant="secondary" disabled={busyId === row.taskId} onClick={e => { e.stopPropagation(); quickStatus(row, s); }} aria-label={`${row.title} — ${ACTION_LABEL[s]}`}>{ACTION_LABEL[s]}</Button>
        ))}
      </div>
    );
  }

  return (
    <div className="h-full flex overflow-hidden bg-white">
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="shrink-0 px-10 pt-9">
          <header className="flex items-start justify-between gap-6">
            <div>
              <p className="text-[12px] text-slate-400">나의 업무 공간</p>
              <h1 className="mt-4 text-[30px] leading-none font-extrabold tracking-tight text-slate-900">My Tasks</h1>
              <p className="mt-4 text-[13px] text-slate-500">내가 맡은 일과 완료한 일을 빠르게 확인하세요.</p>
            </div>
            <p className="mt-6 text-[12px] text-slate-400 whitespace-nowrap">나에게 연결된 업무만 표시합니다</p>
          </header>

          <div className="mt-7 flex items-end justify-between gap-4 border-b border-slate-200">
            {view === "list" ? (
              <Tabs<TabKey> label="업무 구분" value={tab} onChange={t => { setTab(t); setStatusFilter(""); }} className="!border-b-0"
                items={[{ value: "open", label: "내 업무", count: openCount }, { value: "done", label: "완료", count: doneCount }]} />
            ) : <div className="-mb-px border-b-2 border-indigo-600 px-0.5 py-2.5 text-[13px] font-semibold text-indigo-700">보드 <span className="text-slate-400 font-medium ml-1">{filtered.length}</span></div>}
            <div className="mb-2 flex p-1 rounded-xl bg-slate-100" role="group" aria-label="보기 방식">
              {([["list", "목록", ListIcon], ["board", "보드", BoardIcon]] as const).map(([v, label, Icon]) => (
                <button key={v} onClick={() => setView(v)} aria-pressed={view === v}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-indigo-500 ${view === v ? "bg-white text-slate-900 shadow-sm" : "text-slate-400 hover:text-slate-600"}`}>
                  <Icon size={13} />{label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 py-5">
            <div className="relative w-56">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><SearchIcon size={14} /></span>
              <Input value={q} onChange={e => setQ(e.target.value)} placeholder="업무 검색" maxLength={100} aria-label="내 업무 검색" className="!pl-9 !py-2.5 !rounded-xl" />
            </div>
            {view === "list" && (
              <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value as TaskStatus | "")} aria-label="상태 필터" className="!w-auto !py-2.5 !rounded-xl">
                <option value="">전체 상태</option>
                {statusOptions.map(s => <option key={s} value={s}>{taskStatusLabel(s)}</option>)}
              </Select>
            )}
            {projects.length > 1 && (
              <Select value={projectFilter} onChange={e => setProjectFilter(e.target.value)} aria-label="프로젝트 필터" className="!w-auto !py-2.5 !rounded-xl">
                <option value="">전체 프로젝트</option>
                {projects.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </Select>
            )}
            <Select value={sort} onChange={e => setSort(e.target.value as SortKey)} aria-label="정렬" className="ml-auto !w-auto !py-2.5 !rounded-xl">
              <option value="due">마감일순</option><option value="project">프로젝트순</option><option value="updated">최근 수정순</option>
            </Select>
          </div>
          {rowError && <p role="alert" className="mb-2 text-[12px] text-rose-600">{rowError}</p>}
        </div>

        <div className="flex-1 overflow-y-auto px-10 pb-8">
          {error && data && <p className="mb-2 text-[12px] text-rose-500">목록을 새로 고치지 못했습니다. <button onClick={reload} className="underline">다시 시도</button></p>}
          {filtered.length === 0 ? (
            <div className="py-20 text-center">
              <p className="text-[14px] font-semibold text-slate-700">{filtering ? "조건에 맞는 업무가 없습니다" : view === "board" || tab === "open" ? "진행할 업무가 없습니다" : "완료한 업무가 없습니다"}</p>
              <p className="text-[12px] text-slate-400 mt-1">{filtering ? "검색어나 필터를 바꿔 보세요." : "프로젝트에서 나에게 배정된 업무가 여기에 표시됩니다."}</p>
              {filtering && <Button variant="secondary" size="sm" className="mt-3" onClick={() => { setQ(""); setProjectFilter(""); setStatusFilter(""); }}>필터 초기화</Button>}
            </div>
          ) : view === "list" ? (
            <div role="list" aria-label={tab === "open" ? "진행할 업무" : "완료한 업무"}>
              <div className={`${LIST_GRID} px-4 py-3 rounded-lg bg-slate-50 text-[12px] font-semibold text-slate-400`}>
                <span>업무</span><span>상태</span><span>프로젝트</span><span>마감일</span>
              </div>
              {filtered.map(t => {
                const tone = dueTone(t.dueAt, t.status);
                return (
                  <div key={t.taskId} role="listitem" onClick={() => setSelectedId(t.taskId)}
                    className={`group relative ${LIST_GRID} items-center px-4 py-4 border-b border-slate-100 cursor-pointer transition-colors ${selectedId === t.taskId ? "bg-indigo-50/60" : "hover:bg-slate-50"}`}>
                    <span className="min-w-0">
                      <button onClick={() => setSelectedId(t.taskId)} aria-current={selectedId === t.taskId} className={`block max-w-full text-left text-[14px] font-medium truncate focus-visible:outline-2 focus-visible:outline-indigo-500 rounded ${t.status === "DONE" || t.status === "CANCELED" ? "text-slate-400" : "text-slate-900"}`}>{t.title}</button>
                      <span className="block mt-1 text-[11px] text-slate-400 truncate">{t.projectName}</span>
                    </span>
                    <span><TaskStatusChip status={t.status} /></span>
                    <span className="text-[13px] text-slate-700 truncate">{t.projectName}</span>
                    <span className={`text-[13px] tabular-nums ${tone === "normal" ? "text-slate-600" : `font-medium ${DUE_TONE_CLS[tone]}`}`}>{fmtMD(t.dueAt)}</span>
                    {quickActions(t)}
                  </div>
                );
              })}
              <p className="mt-5 text-[12px] text-slate-400">{filtered.length}개 업무 · 업무를 선택해 상세 정보를 확인하세요</p>
            </div>
          ) : (
            <div className="flex gap-4 min-h-full" style={{ minWidth: 600 }}>
              {(["TODO", "IN_PROGRESS", "DONE"] as const).map(col => {
                const colTasks = filtered.filter(t => t.status === col);
                return (
                  <section key={col} className="flex-1 min-w-0" aria-label={taskStatusLabel(col)}>
                    <div className="flex items-center gap-2 mb-2 px-1">
                      <TaskStatusMark status={col} />
                      <span className="text-[12px] font-semibold text-slate-700">{taskStatusLabel(col)}</span>
                      <span className="text-[11px] text-slate-400">{colTasks.length}</span>
                    </div>
                    <div className="space-y-2">
                      {colTasks.map(t => {
                        const tone = dueTone(t.dueAt, t.status);
                        const next = nextStatuses(t);
                        return (
                          <div key={t.taskId} className={`border rounded-lg px-3 py-2.5 transition-colors ${selectedId === t.taskId ? "border-indigo-300 bg-indigo-50/50" : "border-slate-200 bg-white hover:border-slate-300"}`}>
                            <button onClick={() => setSelectedId(t.taskId)} className="w-full text-left text-[13px] font-medium text-slate-800 focus-visible:outline-2 focus-visible:outline-indigo-500 rounded">{t.title}</button>
                            <p className="text-[11px] text-slate-400 mt-1 truncate">{t.projectName}</p>
                            <div className="flex items-center justify-between mt-2">
                              <span className={`text-[11px] font-medium tabular-nums ${DUE_TONE_CLS[tone]}`}>{fmtMD(t.dueAt)}</span>
                              <div className="flex gap-1">
                                {next.filter(s => s !== "CANCELED").map(s => (
                                  <Button key={s} size="sm" variant="ghost" disabled={busyId === t.taskId} onClick={() => quickStatus(t, s)} aria-label={`${t.title} — ${ACTION_LABEL[s]}`}>{s === "TODO" ? "◀" : s === "IN_PROGRESS" ? "▶" : "✓"}</Button>
                                ))}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {selected && (
        <TaskDetailPanel key={selected.taskId} row={selected} myUserId={me?.userId} navigate={navigate} onUpdated={applyUpdate} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}
