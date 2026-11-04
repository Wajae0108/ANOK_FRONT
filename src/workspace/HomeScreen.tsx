// User Home — "오늘 처리할 일"을 위한 화면. 업무 · 프로젝트 · 회의 세 가지만 보여 준다. 모든 데이터는 실제 API(업무·회의·프로젝트)에서 온다.
// 카드 그리드 대신 목록·행·구분선으로 정보를 나눈다.
import { useState } from "react";
import type { ReactNode } from "react";
import * as mtg from "../api/meeting";
import type { ProjectResponse } from "../api/project";
import { useAuth } from "../auth/AuthProvider";
import { fmtDateTime, useMyMeetingsSummary } from "../meetings/shared";
import { isOpenStatus, useMyTasks } from "../projects/myTasks";
import { DUE_TONE_CLS, dueTone, fmtMD, ProjectRoleBadge, TaskStatusChip, TaskStatusMark } from "../projects/shared";
import { Button, ErrorBox, Tabs, useLoad } from "../ui/kit";
import { ArrowUpRightIcon, VideoIcon } from "../ui/icons";
import type { CurrentUser, Navigate } from "./nav";

function SectionHeader({ id, title, action }: { id?: string; title: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 id={id} className="text-[15px] font-bold text-slate-900">{title}</h2>
      {action && (
        <button onClick={action.onClick} className="inline-flex items-center gap-1 text-[12px] text-slate-400 hover:text-indigo-600 transition-colors focus-visible:outline-2 focus-visible:outline-indigo-500 rounded">
          {action.label}<ArrowUpRightIcon size={11} />
        </button>
      )}
    </div>
  );
}
const Muted = ({ children }: { children: ReactNode }) => <p className="text-[13px] text-slate-400 py-6 border-t border-slate-100">{children}</p>;
const Loading = ({ text }: { text: string }) => <p className="text-[13px] text-slate-400 py-6 border-t border-slate-100 flex items-center gap-2"><span className="w-4 h-4 border-2 border-slate-200 border-t-indigo-500 rounded-full animate-spin" />{text}</p>;

// 참석 인원은 회의 목록 응답에 없어 참가자 목록을 따로 조회한다. 실패하면 인원 표기만 생략한다.
function ParticipantCount({ meetingId }: { meetingId: string }) {
  const { data } = useLoad(() => mtg.listMeetingParticipants(meetingId, { limit: 100 }), [meetingId]);
  const n = data?.items.filter(p => p.participationStatus === "ACTIVE").length;
  return n == null ? null : <> · {n}명 참석</>;
}

export default function HomeScreen({ user, navigate, projects, projectsLoading, projectsError, reloadProjects }: {
  user: CurrentUser; navigate: Navigate;
  projects: ProjectResponse[]; projectsLoading: boolean; projectsError: string | null; reloadProjects: () => void;
}) {
  const { me } = useAuth();
  const [taskTab, setTaskTab] = useState<"open" | "done">("open");
  const tasks = useMyTasks(me?.userId);
  const meetings = useMyMeetingsSummary(user.userId);
  const projectName = new Map(projects.map(p => [p.projectId, p.name]));

  const rows = tasks.data ?? [];
  const shownTasks = rows.filter(r => (taskTab === "open") === isOpenStatus(r.status)).slice(0, 5);
  const openCount = rows.filter(r => isOpenStatus(r.status)).length;
  const today = new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "long" });

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[1180px] mx-auto px-8 py-8">
        <div className="flex items-start justify-between gap-6 mb-10">
          <div>
            <p className="text-[12px] text-slate-400">{today}</p>
            <h2 className="text-[26px] font-extrabold text-slate-900 mt-2 tracking-tight">안녕하세요, {user.name}님<span className="text-indigo-600">.</span></h2>
            <p className="text-[13px] text-slate-400 mt-2">업무, 프로젝트, 회의를 한눈에 확인하세요.</p>
          </div>
          <Button onClick={() => navigate("meetings")} className="shrink-0 !px-5 !py-2.5"><VideoIcon size={16} />회의 확인하기</Button>
        </div>

        <div className="space-y-12">
          {/* 업무 + 프로젝트: 한 줄에 나란히 */}
          <div className="flex gap-10 items-start">
          {/* 업무 */}
          <section aria-labelledby="home-tasks" className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1">
              <h2 id="home-tasks" className="text-[15px] font-bold text-slate-900">업무</h2>
              <button onClick={() => navigate("tasks")} className="inline-flex items-center gap-1 text-[12px] text-slate-400 hover:text-indigo-600 transition-colors">내 업무 전체 보기<ArrowUpRightIcon size={11} /></button>
            </div>
            <Tabs<"open" | "done"> label="업무 구분" value={taskTab} onChange={setTaskTab} className="mb-0"
              items={[{ value: "open", label: "진행할 업무", count: tasks.data ? openCount : undefined }, { value: "done", label: "완료한 업무" }]} />
            {tasks.loading && !tasks.data ? <Loading text="업무를 불러오는 중..." />
              : tasks.error && !tasks.data ? <ErrorBox message={tasks.error} onRetry={tasks.reload} />
              : shownTasks.length === 0 ? <Muted>{taskTab === "open" ? "지금 처리할 업무가 없습니다." : "완료한 업무가 아직 없습니다."}</Muted>
              : (
                <ul>
                  {shownTasks.map(t => {
                    const tone = dueTone(t.dueAt, t.status);
                    return (
                      <li key={t.taskId}>
                        <button onClick={() => navigate("tasks", { taskId: t.taskId })} className="w-full flex items-center gap-4 py-4 border-b border-slate-100 text-left hover:bg-slate-50/70 transition-colors -mx-2 px-2 rounded focus-visible:outline-2 focus-visible:outline-indigo-500">
                          <TaskStatusMark status={t.status} />
                          <span className="flex-1 min-w-0">
                            <span className="block text-[14px] font-medium text-slate-900 truncate">{t.title}</span>
                            <span className="block text-[12px] text-slate-400 mt-0.5 truncate">{t.projectName}</span>
                          </span>
                          <TaskStatusChip status={t.status} />
                          <span className={`w-12 text-right text-[12px] font-medium tabular-nums ${DUE_TONE_CLS[tone]}`}>{fmtMD(t.dueAt)}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
          </section>

          {/* 프로젝트 */}
          <section aria-labelledby="home-projects" className="w-[300px] shrink-0 border-l border-slate-100 pl-8">
            <SectionHeader id="home-projects" title="프로젝트" action={{ label: "전체 보기", onClick: () => navigate("projects") }} />
            {projectsLoading && projects.length === 0 ? <Loading text="프로젝트를 불러오는 중..." />
              : projectsError && projects.length === 0 ? <ErrorBox message={projectsError} onRetry={reloadProjects} />
              : projects.length === 0 ? (
                <p className="text-[12px] text-slate-400 py-2 leading-relaxed">참여 중인 프로젝트가 없습니다.{user.companyRole === "ADMIN" && " 관리자 권한은 프로젝트 열람 권한과 별개이며, 프로젝트 구성원으로 추가되어야 합니다."}</p>
              ) : (
                <ul>
                  {projects.slice(0, 5).map(p => (
                    <li key={p.projectId}>
                      <button onClick={() => navigate("project-detail", { projectId: p.projectId })} className="w-full flex items-center gap-2.5 py-2 text-left hover:text-indigo-700 transition-colors rounded focus-visible:outline-2 focus-visible:outline-indigo-500">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0" />
                        <span className="flex-1 min-w-0 text-[13px] text-slate-700 truncate">{p.name}</span>
                        <ProjectRoleBadge role={p.myRole} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
          </section>
          </div>

          {/* 회의 */}
          <section aria-labelledby="home-meetings">
            <SectionHeader id="home-meetings" title="회의" action={{ label: "전체 보기", onClick: () => navigate("meetings") }} />
            {meetings.loading && meetings.upcoming.length === 0 && meetings.active.length === 0 ? <Loading text="회의를 불러오는 중..." />
              : meetings.error && meetings.active.length === 0 && meetings.needsReview.length === 0 ? <ErrorBox message={meetings.error} onRetry={meetings.reload} />
              : (
                <>
                  {meetings.needsReview.map(m => (
                    <div key={m.meetingId} className="flex items-center gap-4 py-3.5 border-t border-slate-100">
                      <span className="w-14 text-[12px] font-semibold text-amber-600">검토 필요</span>
                      <span className="flex-1 min-w-0"><span className="block text-[14px] font-medium text-slate-900 truncate">{m.title}</span><span className="block text-[12px] text-slate-400 mt-0.5">AI 회의록·후보를 검토하고 확정해 주세요</span></span>
                      <Button variant="secondary" size="sm" onClick={() => navigate("meeting-detail", { meetingId: m.meetingId })}>검토하기<ArrowUpRightIcon size={11} /></Button>
                    </div>
                  ))}
                  {meetings.active.length === 0 && meetings.needsReview.length === 0 ? <Muted>예정된 회의가 없습니다.</Muted> : meetings.active.slice(0, 3).map(m => {
                    const start = m.scheduledStartAt ? new Date(m.scheduledStartAt) : null;
                    const live = m.status === "IN_PROGRESS";
                    return (
                      <div key={m.meetingId} className="flex items-center gap-5 py-4 border-t border-slate-100">
                        <div className="w-16 shrink-0">
                          {live ? <p className="text-[13px] font-bold text-emerald-600">진행 중</p>
                            : <p className="text-[19px] font-bold text-slate-900 tabular-nums leading-none">{start ? start.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false }) : "미정"}</p>}
                          {start && <p className="text-[11px] text-slate-400 mt-1 tabular-nums">{fmtMD(m.scheduledStartAt)}</p>}
                        </div>
                        <div className="self-stretch w-0.5 rounded bg-indigo-500/80" />
                        <div className="flex-1 min-w-0">
                          <p className="text-[14px] font-semibold text-slate-900 truncate">{m.title}</p>
                          <p className="text-[12px] text-slate-400 mt-1 truncate">{projectName.get(m.projectId) ?? "프로젝트"}<ParticipantCount meetingId={m.meetingId} /></p>
                        </div>
                        <Button variant="secondary" size="sm" onClick={() => navigate("meeting-detail", { meetingId: m.meetingId })} aria-label={`${m.title} 참여하기 (${fmtDateTime(m.scheduledStartAt)})`}>참여하기<ArrowUpRightIcon size={11} /></Button>
                      </div>
                    );
                  })}
                </>
              )}
          </section>
        </div>
      </div>
    </div>
  );
}
