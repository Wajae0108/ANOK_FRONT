// 내 업무 오른쪽 상세 패널. 저장은 항상 project API(상태/마감/담당자/제목·설명)로 하고, 권한 규칙은 기존 프로젝트 상세의 TaskModal과 같다:
// 담당자 본인은 상태만(MEMBER_NEXT), 프로젝트 MANAGER는 상태·담당자·마감·제목/설명을 바꿀 수 있다. 최종 권한 판단은 서버가 한다.
import { useEffect, useState } from "react";
import * as api from "../api/project";
import type { TaskStatus } from "../api/project";
import * as mtg from "../api/meeting";
import { USE_MOCK } from "../api/config";
import { errorText, fieldErrorMap } from "../api/errors";
import { Avatar, Badge, Button, Drawer, Input, Select, Textarea, useLoad } from "../ui/kit";
import type { Navigate } from "../workspace/nav";
import { ArrowUpRightIcon } from "../ui/icons";
import type { MyTaskRow } from "./myTasks";
import { nextStatuses } from "./myTasks";
import { DUE_TONE_CLS, dueTone, fmtDate, taskStatusLabel, TaskStatusChip, useOrgUsers } from "./shared";

const SOURCE_LABEL: Record<string, string> = { MANUAL: "직접 생성", MEETING_CANDIDATE: "회의 AI 후보에서 생성", DECISION: "결정에서 생성" };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[84px_1fr] items-start gap-3 min-h-8">
      <dt className="text-[12px] font-medium text-slate-400 pt-2">{label}</dt>
      <dd className="min-w-0 text-[13px] text-slate-700">{children}</dd>
    </div>
  );
}
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[12px] font-bold text-slate-900 mb-2">{children}</h3>;
}
function RelatedLink({ kind, label, onClick }: { kind: string; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-2.5 px-2 -mx-2 py-1.5 rounded-lg text-left hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-indigo-500 group">
      <span className="w-14 shrink-0 text-[11px] font-semibold text-slate-400">{kind}</span>
      <span className="flex-1 min-w-0 text-[13px] text-slate-700 truncate group-hover:text-indigo-700">{label}</span>
      <span className="text-slate-300 group-hover:text-indigo-500"><ArrowUpRightIcon size={12} /></span>
    </button>
  );
}

export default function TaskDetailPanel({ row, myUserId, navigate, onUpdated, onClose }: {
  row: MyTaskRow; myUserId?: string; navigate: Navigate; onUpdated: (r: MyTaskRow) => void; onClose: () => void;
}) {
  const canManage = row.myRoleInProject === "MANAGER";
  const { nameOf } = useOrgUsers();
  const [title, setTitle] = useState(row.title);
  const [description, setDescription] = useState(row.description ?? "");
  const [dueAt, setDueAt] = useState(row.dueAt ? row.dueAt.slice(0, 10) : "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  // 서버 응답(새 version)이나 다른 업무 선택 시 입력값을 서버 값으로 맞춘다.
  useEffect(() => {
    setTitle(row.title); setDescription(row.description ?? ""); setDueAt(row.dueAt ? row.dueAt.slice(0, 10) : "");
  }, [row.taskId, row.version]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setError(null); setFields({}); }, [row.taskId]);

  const membersLoad = useLoad(() => (canManage ? api.listProjectMembers(row.projectId, { status: "ACTIVE", limit: 100 }) : Promise.resolve(null)), [row.projectId, canManage]);
  const assignable = (membersLoad.data?.items ?? []).filter(m => m.role !== "VIEWER");
  const meetingLoad = useLoad(() => (row.sourceMeetingId ? mtg.getMeeting(row.sourceMeetingId) : Promise.resolve(null)), [row.sourceMeetingId]);
  const decisionLoad = useLoad(() => (row.sourceDecisionId ? api.getDecision(row.projectId, row.sourceDecisionId) : Promise.resolve(null)), [row.projectId, row.sourceDecisionId]);

  async function run(name: string, fn: () => Promise<api.TaskResponse>) {
    setBusy(name); setError(null); setFields({});
    try { onUpdated({ ...(await fn()), projectName: row.projectName, myRoleInProject: row.myRoleInProject }); }
    catch (e) { setError(errorText(e)); setFields(fieldErrorMap(e)); }
    finally { setBusy(null); }
  }
  const setStatus = (status: TaskStatus) => run("status", () => api.updateTaskStatus(row.projectId, row.taskId, { status, version: row.version }));
  const saveMeta = () => run("meta", () => api.updateTask(row.projectId, row.taskId, { title: title.trim(), description: description.trim() || undefined, version: row.version }));
  const saveDeadline = () => run("deadline", () => api.updateTaskDeadline(row.projectId, row.taskId, { dueAt: dueAt ? new Date(dueAt).toISOString() : null, version: row.version }));
  const saveAssignee = (uid: string) => run("assignee", () => uid ? api.updateTaskAssignee(row.projectId, row.taskId, { assigneeUserId: uid, version: row.version }) : api.unassignTask(row.projectId, row.taskId));

  const statusOptions: TaskStatus[] = [row.status, ...nextStatuses(row)];
  const metaDirty = title.trim() !== row.title || description.trim() !== (row.description ?? "");
  const dueDirty = dueAt !== (row.dueAt ? row.dueAt.slice(0, 10) : "");
  const tone = dueTone(row.dueAt, row.status);
  const isMine = row.assigneeUserId === myUserId;

  // 활동: 업무 응답이 가진 실제 타임스탬프만 사용한다(업무 활동 이력 API는 없다).
  const activity: Array<{ at: string; text: string }> = [];
  activity.push({ at: row.createdAt, text: `${nameOf(row.createdByUserId)}님이 업무를 만들었습니다 · ${SOURCE_LABEL[row.sourceType] ?? row.sourceType}` });
  if (row.startedAt) activity.push({ at: row.startedAt, text: "진행을 시작했습니다" });
  if (row.completedAt) activity.push({ at: row.completedAt, text: "완료 처리되었습니다" });
  if (row.canceledAt) activity.push({ at: row.canceledAt, text: "취소되었습니다" });
  const lastTouched = [row.createdAt, row.startedAt, row.completedAt, row.canceledAt].filter(Boolean) as string[];
  if (!lastTouched.includes(row.updatedAt)) activity.push({ at: row.updatedAt, text: "내용이 수정되었습니다" });
  activity.sort((a, b) => b.at.localeCompare(a.at));

  return (
    <Drawer title="업무 상세" onClose={onClose}>
      <div className="px-6 py-5 space-y-6">
        <div>
          {canManage ? (
            <Input value={title} maxLength={160} aria-label="업무 제목" onChange={e => setTitle(e.target.value)} disabled={busy !== null} className="!text-[16px] !font-bold !px-2 !py-1.5 -mx-2 !border-transparent hover:!border-slate-200" />
          ) : (
            <h2 className="text-[16px] font-bold text-slate-900 leading-snug">{row.title}</h2>
          )}
          {fields.title && <p className="text-[11px] text-rose-500 mt-1">{fields.title}</p>}
        </div>

        <dl className="space-y-1">
          <Row label="상태">
            {statusOptions.length > 1 ? (
              <Select value={row.status} disabled={busy !== null} onChange={e => setStatus(e.target.value as TaskStatus)} aria-label="상태 변경" className="!w-auto min-w-36">
                {statusOptions.map(s => <option key={s} value={s}>{taskStatusLabel(s)}</option>)}
              </Select>
            ) : <div className="pt-1.5"><TaskStatusChip status={row.status} /></div>}
          </Row>
          <Row label="마감일">
            {canManage ? (
              <div className="flex items-center gap-2">
                <Input type="date" value={dueAt} disabled={busy !== null} onChange={e => setDueAt(e.target.value)} aria-label="마감일" className="!w-auto" />
                {dueDirty && <Button size="sm" variant="secondary" disabled={busy !== null} onClick={saveDeadline}>저장</Button>}
              </div>
            ) : <span className={`inline-block pt-1.5 font-medium ${tone === "normal" ? "text-slate-700" : DUE_TONE_CLS[tone]}`}>{fmtDate(row.dueAt)}{tone === "overdue" ? " · 기한 초과" : ""}</span>}
            {fields.dueAt && <p className="text-[11px] text-rose-500 mt-1">{fields.dueAt}</p>}
          </Row>
          <Row label="담당자">
            {canManage ? (
              <>
                <Select value={row.assigneeUserId ?? ""} disabled={busy !== null || membersLoad.loading} onChange={e => saveAssignee(e.target.value)} aria-label="담당자 변경">
                  <option value="">미지정</option>
                  {assignable.map(m => <option key={m.userId} value={m.userId}>{nameOf(m.userId)}{m.userId === myUserId ? " (나)" : ""}</option>)}
                </Select>
                {membersLoad.error && <p className="text-[11px] text-rose-500 mt-1">구성원 목록을 불러오지 못했습니다. {membersLoad.error}</p>}
                <p className="text-[11px] text-slate-400 mt-1">다른 사람으로 바꾸면 내 업무 목록에서 사라집니다.</p>
              </>
            ) : (
              <span className="inline-flex items-center gap-2 pt-1">
                {row.assigneeUserId && <Avatar name={nameOf(row.assigneeUserId)} seed={row.assigneeUserId} size={20} />}
                {row.assigneeUserId ? <>{nameOf(row.assigneeUserId)}{isMine && " (나)"}</> : "미지정"}
                {row.assigneeUserId && !row.assigneeAvailability && <Badge tone="rose">계정 비활성</Badge>}
              </span>
            )}
          </Row>
        </dl>

        <section>
          <SectionTitle>설명</SectionTitle>
          {canManage ? (
            <Textarea rows={4} value={description} maxLength={4000} disabled={busy !== null} placeholder="설명을 입력하세요" aria-label="업무 설명" onChange={e => setDescription(e.target.value)} />
          ) : (
            <p className="text-[13px] text-slate-600 leading-relaxed whitespace-pre-wrap">{row.description || <span className="text-slate-400">설명이 없습니다.</span>}</p>
          )}
          {fields.description && <p className="text-[11px] text-rose-500 mt-1">{fields.description}</p>}
          {canManage && metaDirty && (
            <div className="flex justify-end gap-2 mt-2">
              <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => { setTitle(row.title); setDescription(row.description ?? ""); }}>되돌리기</Button>
              <Button size="sm" disabled={busy !== null || !title.trim()} onClick={saveMeta}>{busy === "meta" ? "저장 중..." : "제목·설명 저장"}</Button>
            </div>
          )}
        </section>

        <section>
          <SectionTitle>관련 항목</SectionTitle>
          <div>
            <RelatedLink kind="프로젝트" label={row.projectName} onClick={() => navigate("project-detail", { projectId: row.projectId })} />
            {row.sourceMeetingId && (
              <RelatedLink kind="회의" label={meetingLoad.loading ? "불러오는 중..." : meetingLoad.data?.title ?? "회의 보기"} onClick={() => navigate("meeting-detail", { meetingId: row.sourceMeetingId! })} />
            )}
            {row.sourceDecisionId && (
              <RelatedLink kind="결정" label={decisionLoad.loading ? "불러오는 중..." : decisionLoad.data?.title ?? "결정 보기"} onClick={() => navigate("project-detail", { projectId: row.projectId, projectTab: "결정" })} />
            )}
            {row.sourceMeetingId && (
              <RelatedLink kind="자료" label="회의에 병합된 자료 보기" onClick={() => navigate("meeting-detail", { meetingId: row.sourceMeetingId! })} />
            )}
          </div>
          {!row.sourceMeetingId && !row.sourceDecisionId && <p className="text-[12px] text-slate-400 mt-1">이 업무에 연결된 회의·결정은 없습니다.</p>}
        </section>

        <section>
          <SectionTitle>활동</SectionTitle>
          <ol className="space-y-3 border-l border-slate-200 ml-1.5">
            {activity.map((a, i) => (
              <li key={i} className="relative pl-4">
                <span className="absolute -left-[4.5px] top-1.5 w-2 h-2 rounded-full bg-slate-300" />
                <p className="text-[12px] text-slate-600">{a.text}</p>
                <p className="text-[11px] text-slate-400">{new Date(a.at).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</p>
              </li>
            ))}
          </ol>
        </section>

        {error && <p role="alert" className="text-[12px] text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">{error}</p>}
        {USE_MOCK && <p className="text-[11px] text-slate-400">데모 모드입니다. 변경은 이 브라우저의 메모리에만 반영되며 새로고침하면 초기화됩니다.</p>}
      </div>
    </Drawer>
  );
}
