// Anok_04 — 회의 목록 + 생성.
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import * as api from "../api/meeting";
import type { MeetingExternalAiPolicy, MeetingSensitivity } from "../api/meeting";
import * as prj from "../api/project";
import { ApiError, errorText, fieldErrorMap } from "../api/errors";
import { Avatar, Badge, Button, ErrorBox, Input, Modal, Select, Spinner, Tabs, Textarea, useLoad } from "../ui/kit";
import SchedulePicker from "../ui/SchedulePicker";
import { useAuth } from "../auth/AuthProvider";
import { ArrowUpRightIcon, ChevronDownIcon, PlusIcon } from "../ui/icons";
import type { Navigate } from "../workspace/nav";
import { useOrgUsers } from "../projects/shared";
import { AI_BLOCKED_TEXT, AI_POLICY_LABEL, localInputToIso, MeetingStatusBadge, PostprocessBadge, SENS_LABEL, SENSITIVITY_LEVELS, SensitivityBadge } from "./shared";

// 회의 만들기 모달 전용 입력 행: 라벨(작고 진하게) → 컨트롤 → 보조 문구/오류. 공용 Field보다 라벨 위계를 높이고 간격을 줄였다.
function FormRow({ label, htmlFor, optional, hint, error, children }: { label: string; htmlFor?: string; optional?: boolean; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <label htmlFor={htmlFor} className="text-[12px] font-semibold text-slate-700">{label}</label>
        {optional && <span className="text-[11px] text-slate-400">선택</span>}
      </div>
      {children}
      {error ? <p className="text-[11px] text-rose-500 mt-1">{error}</p> : hint && <p className="text-[11px] text-slate-400 mt-1.5">{hint}</p>}
    </div>
  );
}

// "회사 기본값"은 sensitivityClassification을 보내지 않는 선택이다 — 서버가 회사 설정(없으면 INTERNAL)을 적용한다. 이 선택을 두지 않고
// 항상 INTERNAL을 보내면 회사 관리자가 올려 둔 기본 민감도를 덮어쓰게 된다.
type SensitivityChoice = "" | MeetingSensitivity;

function CreateMeetingModal({ onClose, onCreated }: { onClose: () => void; onCreated: (m: api.MeetingResponse) => void }) {
  const { data: projectPage, loading: loadingProjects } = useLoad(() => prj.listProjects({ status: "ACTIVE", limit: 100 }), []);
  const { users, nameOf } = useOrgUsers();
  const { me } = useAuth();
  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [scheduledStartAt, setScheduledStartAt] = useState("");
  const [scheduledEndAt, setScheduledEndAt] = useState("");
  const [sensitivity, setSensitivity] = useState<SensitivityChoice>("");
  const [aiPolicy, setAiPolicy] = useState<MeetingExternalAiPolicy>("INHERIT");
  const [password, setPassword] = useState("");
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  // 열람자는 처음부터 지정할 수 있고 프로젝트 멤버가 아니어도 된다(같은 회사 직원). 승인된 회의록·최종 보고서만 본다(FRONTEND_06).
  const [viewerIds, setViewerIds] = useState<string[]>([]);
  const [members, setMembers] = useState<prj.ProjectMemberResponse[] | null>(null);
  const [showMore, setShowMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  // 같은 내용으로 다시 시도하면 같은 Idempotency-Key를 써서 회의가 두 개 생기지 않게 한다. 내용이 바뀌면(같은 키 + 다른 본문 = 409) 새 키.
  const attempt = useRef<{ body: string; key: string } | null>(null);

  async function pickProject(id: string) {
    setProjectId(id); setParticipantIds([]); setMembers(null);
    if (!id) return;
    try { setMembers((await prj.listProjectMembers(id, { status: "ACTIVE", limit: 100 })).items); }
    catch (e) { setMembers([]); setError(errorText(e)); }
  }
  function toggle(userId: string) {
    setViewerIds(v => v.filter(x => x !== userId)); // 참가자로 고르면 열람자 지정은 풀린다(같은 사람을 둘 다로 보내지 않는다)
    setParticipantIds(p => p.includes(userId) ? p.filter(x => x !== userId) : [...p, userId]);
  }
  function toggleViewer(userId: string) {
    setViewerIds(v => v.includes(userId) ? v.filter(x => x !== userId) : [...v, userId]);
  }

  const startIso = scheduledStartAt ? localInputToIso(scheduledStartAt) : null;
  const endIso = scheduledEndAt ? localInputToIso(scheduledEndAt) : null;
  const endBeforeStart = !!startIso && !!endIso && new Date(endIso) < new Date(startIso);
  const inPast = !!startIso && new Date(startIso).getTime() < Date.now() - 60_000;
  const passwordBad = !!password && (password.length < 4 || password.length > 128);
  const blocked = (sensitivity !== "" && sensitivity !== "INTERNAL") || aiPolicy === "BLOCKED";

  async function submit() {
    setBusy(true); setError(null); setFields({});
    // 시각은 시간대가 붙은 RFC 3339(UTC)로 보낸다. 비어 있는 선택 값은 아예 보내지 않는다(null/빈 문자열을 보내면 검증 오류가 된다).
    const body = {
      projectId, title: title.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(startIso ? { scheduledStartAt: startIso } : {}), ...(endIso ? { scheduledEndAt: endIso } : {}),
      ...(sensitivity ? { sensitivityClassification: sensitivity } : {}), ...(aiPolicy !== "INHERIT" ? { externalAiPolicy: aiPolicy } : {}),
      ...(participantIds.length ? { participantUserIds: participantIds } : {}), ...(viewerIds.length ? { viewerUserIds: viewerIds } : {}), ...(password ? { password } : {}),
    };
    const json = JSON.stringify(body);
    if (!attempt.current || attempt.current.body !== json) attempt.current = { body: json, key: crypto.randomUUID() };
    try {
      const m = await api.createMeeting(body, attempt.current.key);
      attempt.current = null;
      onCreated(m); onClose();
    } catch (e) {
      setError(errorText(e)); setFields(fieldErrorMap(e));
      // 참여자 한 명이라도 부적격이면 회의 전체가 만들어지지 않고 누가 문제인지도 알려 주지 않는다 — 목록을 다시 받아 걸러서 보내게 한다.
      if (e instanceof ApiError && (e.errorCode === "PARTICIPANT_NOT_ELIGIBLE" || e.errorCode === "PARTICIPANT_NOT_FOUND") && projectId) void pickProject(projectId).then(() => { setParticipantIds([]); setViewerIds([]); });
    }
    finally { setBusy(false); }
  }

  // 회의는 프로젝트 담당자·멤버만 만들 수 있다(열람 전용은 403). 진행 중인 프로젝트에서만 만들 수 있다.
  const projects = (projectPage?.items ?? []).filter(p => p.status === "ACTIVE" && (p.myRole === "MANAGER" || p.myRole === "MEMBER"));
  const canSubmit = projectId && title.trim().length > 0 && title.trim().length <= 160 && !endBeforeStart && !passwordBad;
  const selectable = (members ?? []).filter(mem => mem.userId !== me?.userId);
  const SENS_CHOICES: { value: SensitivityChoice; label: string }[] = [{ value: "", label: "회사 기본값" }, ...SENSITIVITY_LEVELS.map(v => ({ value: v, label: SENS_LABEL[v] }))];

  function onSensitivityKey(e: ReactKeyboardEvent<HTMLButtonElement>, i: number) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const n = (i + (e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : SENS_CHOICES.length - 1)) % SENS_CHOICES.length;
    setSensitivity(SENS_CHOICES[n].value);
    e.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="radio"]')[n]?.focus();
  }

  const footer = loadingProjects ? undefined : (
    <>
      {error && <p role="alert" className="mr-auto text-[12px] text-rose-500 font-medium">{error}</p>}
      <Button variant="ghost" onClick={onClose}>취소</Button>
      <Button disabled={busy || !canSubmit} onClick={submit}>{busy ? "생성 중..." : "회의 만들기"}</Button>
    </>
  );

  return (
    <Modal compact width="max-w-lg" title="회의 만들기" description="새로운 회의를 만들거나 일정을 예약하세요. 만든 사람이 주최자이자 회의록 검토 담당자가 됩니다." onClose={onClose} footer={footer}>
      {loadingProjects ? <Spinner /> : (
        <>
          <FormRow label="프로젝트" htmlFor="mtg-project" error={fields.projectId} hint={projects.length === 0 ? "회의를 만들 수 있는 진행 중 프로젝트가 없습니다. (열람 전용 구성원은 회의를 만들 수 없습니다)" : undefined}>
            <Select id="mtg-project" value={projectId} onChange={e => pickProject(e.target.value)}>
              <option value="">프로젝트 선택</option>
              {projects.map(p => <option key={p.projectId} value={p.projectId}>{p.name}</option>)}
            </Select>
          </FormRow>
          <FormRow label="회의 제목" htmlFor="mtg-title" error={fields.title}>
            <Input id="mtg-title" value={title} onChange={e => setTitle(e.target.value)} maxLength={160} placeholder="예: 주간 개발 회의" />
          </FormRow>
          <FormRow label="설명" htmlFor="mtg-desc" optional error={fields.description}>
            <Textarea id="mtg-desc" rows={2} value={description} onChange={e => setDescription(e.target.value)} maxLength={4000} placeholder="회의 안건이나 목적" />
          </FormRow>
          <div className="grid grid-cols-2 gap-3">
            {/* 값은 로컬 datetime 문자열("YYYY-MM-DDTHH:mm") 하나로 유지되고, submit에서 시간대가 붙은 ISO로 변환된다. */}
            <FormRow label="시작 예정" htmlFor="mtg-date" optional error={fields.scheduledStartAt}>
              <SchedulePicker id="mtg-date" value={scheduledStartAt} onChange={setScheduledStartAt} />
            </FormRow>
            <FormRow label="종료 예정" htmlFor="mtg-end" optional error={fields.scheduledEndAt ?? (endBeforeStart ? "종료 시각이 시작 시각보다 빠릅니다" : undefined)}>
              <SchedulePicker id="mtg-end" value={scheduledEndAt} onChange={setScheduledEndAt} />
            </FormRow>
          </div>
          {inPast && <p className="-mt-2 text-[11px] text-amber-600">시작 예정이 과거입니다. 그대로 만들 수는 있지만 일정을 확인해 주세요.</p>}
          {!scheduledStartAt && <p className="-mt-2 text-[11px] text-slate-400">비워 두면 시작 시각 없이 만들어지며, 예정 시각과 관계없이 언제든 시작할 수 있습니다.</p>}
          <FormRow label="민감도" error={fields.sensitivityClassification}>
            <div role="radiogroup" aria-label="민감도 분류" className="inline-flex flex-wrap gap-0.5 p-0.5 rounded-lg bg-slate-100">
              {SENS_CHOICES.map((c, i) => {
                const on = sensitivity === c.value;
                return (
                  <button key={c.value || "default"} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} onClick={() => setSensitivity(c.value)} onKeyDown={e => onSensitivityKey(e, i)}
                    className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-[12px] transition-colors focus-visible:outline-2 focus-visible:outline-indigo-500 ${on ? "bg-white text-slate-900 font-semibold shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>
                    <span aria-hidden className={`w-1.5 h-1.5 rounded-full ${on ? "bg-indigo-600" : "ring-1 ring-inset ring-slate-400"}`} />
                    {c.label}
                  </button>
                );
              })}
            </div>
          </FormRow>
          <FormRow label="외부 AI 정책" htmlFor="mtg-ai" error={fields.externalAiPolicy}
            hint="일반 민감도이고 차단이 아니어도, 회사의 AI 설정과 프로젝트 정책이 허용해야 AI 처리가 됩니다.">
            <Select id="mtg-ai" value={aiPolicy} onChange={e => setAiPolicy(e.target.value as MeetingExternalAiPolicy)}>
              {(["INHERIT", "ALLOWED", "BLOCKED"] as MeetingExternalAiPolicy[]).map(p => <option key={p} value={p}>{AI_POLICY_LABEL[p]}</option>)}
            </Select>
          </FormRow>
          {blocked && <p role="status" className="text-[12px] text-amber-700 bg-amber-50 rounded-lg px-3 py-2 leading-relaxed">{AI_BLOCKED_TEXT}</p>}
          {sensitivity === "" && <p className="-mt-2 text-[11px] text-slate-400">'회사 기본값'은 관리자가 정한 기본 민감도를 따릅니다. 일반이 아니면 AI 처리가 되지 않습니다.</p>}
          {projectId && (
            <FormRow label={`참가자${participantIds.length ? ` · ${participantIds.length}명` : ""}`} error={fields.participantUserIds}
              hint="프로젝트 구성원만 고를 수 있습니다. 나는 자동으로 참가합니다. 열람 전용 구성원도 참가할 수 있습니다.">
              {members === null ? <Spinner text="구성원을 불러오는 중..." /> : (
                <div className="max-h-40 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                  {selectable.length === 0 && <p className="text-[12px] text-slate-400 px-3 py-2.5">추가할 수 있는 구성원이 없습니다.</p>}
                  {selectable.map(mem => {
                    const u = users.find(x => x.userId === mem.userId);
                    const selected = participantIds.includes(mem.userId);
                    return (
                      <button key={mem.membershipId} type="button" role="checkbox" aria-checked={selected} onClick={() => toggle(mem.userId)}
                        className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-indigo-500 ${selected ? "bg-indigo-50/70" : "hover:bg-slate-50"}`}>
                        <Avatar name={nameOf(mem.userId)} seed={mem.userId} size={22} />
                        <span className="flex-1 min-w-0 truncate text-[12px] font-medium text-slate-700">{nameOf(mem.userId)}{u?.jobTitle ? ` · ${u.jobTitle}` : ""}</span>
                        {mem.role === "VIEWER" && <span className="text-[10px] text-slate-400">열람</span>}
                        {selected && <svg className="w-4 h-4 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden><polyline points="20 6 9 17 4 12"/></svg>}
                      </button>
                    );
                  })}
                </div>
              )}
            </FormRow>
          )}
          <div className="border-t border-slate-100 pt-3">
            <button type="button" onClick={() => setShowMore(v => !v)} aria-expanded={showMore} aria-controls="mtg-more"
              className="inline-flex items-center gap-1 -ml-1 px-1 py-0.5 rounded text-[12px] font-semibold text-slate-500 hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-indigo-500">
              <span className={`transition-transform ${showMore ? "" : "-rotate-90"}`}><ChevronDownIcon size={14} /></span>추가 설정{!showMore && password && <span className="ml-1 font-medium text-slate-400">· 비밀번호 설정됨</span>}
            </button>
            {showMore && (
              <div id="mtg-more" className="mt-3 space-y-3">
                <FormRow label={`열람자${viewerIds.length ? ` · ${viewerIds.length}명` : ""}`} optional error={fields.viewerUserIds}
                  hint="프로젝트 구성원이 아니어도 됩니다. 열람자는 승인된 회의록과 최종 보고서만 볼 수 있고, 음성·채팅·자료·녹음은 쓸 수 없습니다. 종료 후에도 초대할 수 있습니다.">
                  <div className="max-h-36 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                    {users.filter(u => u.userId !== me?.userId && !participantIds.includes(u.userId)).length === 0 && <p className="text-[12px] text-slate-400 px-3 py-2.5">초대할 수 있는 사람이 없습니다.</p>}
                    {users.filter(u => u.userId !== me?.userId && !participantIds.includes(u.userId)).map(u => {
                      const selected = viewerIds.includes(u.userId);
                      return (
                        <button key={u.userId} type="button" role="checkbox" aria-checked={selected} onClick={() => toggleViewer(u.userId)}
                          className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-indigo-500 ${selected ? "bg-indigo-50/70" : "hover:bg-slate-50"}`}>
                          <Avatar name={u.displayName} seed={u.userId} size={22} />
                          <span className="flex-1 min-w-0 truncate text-[12px] font-medium text-slate-700">{u.displayName}{u.jobTitle ? ` · ${u.jobTitle}` : ""}</span>
                          {selected && <svg className="w-4 h-4 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden><polyline points="20 6 9 17 4 12"/></svg>}
                        </button>
                      );
                    })}
                  </div>
                </FormRow>
                <FormRow label="회의 비밀번호" htmlFor="mtg-password" optional error={fields.password ?? (passwordBad ? "비밀번호는 4~128자여야 합니다" : undefined)} hint="설정하면 주최자가 아닌 참가자가 음성에 입장할 때 비밀번호가 필요합니다. 5번 틀리면 15분간 잠깁니다.">
                  <Input id="mtg-password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="비밀번호 설정 (4~128자)" autoComplete="new-password" />
                </FormRow>
              </div>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}

// 목록 한 줄: 시각 · 제목/프로젝트 · 상태 · 행동 버튼. 카드 대신 행과 구분선으로 나눈다.
function MeetingRow({ m, projectName, action, onOpen }: { m: api.MeetingResponse; projectName?: string; action: { label: string; primary?: boolean } | null; onOpen: () => void }) {
  const start = m.scheduledStartAt ? new Date(m.scheduledStartAt) : null;
  const live = m.status === "IN_PROGRESS";
  return (
    <div role="listitem" className="flex items-center gap-5 py-4 border-b border-slate-100">
      <div className="w-20 shrink-0">
        {live ? <p className="text-[13px] font-bold text-emerald-600">진행 중</p>
          : <p className="text-[18px] font-bold text-slate-900 tabular-nums leading-none">{start ? start.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false }) : "미정"}</p>}
        {start && <p className="text-[11px] text-slate-400 mt-1">{start.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit", weekday: "short" })}</p>}
      </div>
      <button onClick={onOpen} className="flex-1 min-w-0 text-left rounded focus-visible:outline-2 focus-visible:outline-indigo-500">
        <span className="flex items-center gap-2">
          <span className="text-[14px] font-semibold text-slate-900 truncate">{m.title}</span>
          {m.passwordProtected && <Badge>비밀번호</Badge>}
        </span>
        <span className="flex items-center gap-2 mt-1 text-[12px] text-slate-400">
          <span className="truncate">{projectName ?? "프로젝트"}</span><SensitivityBadge level={m.sensitivityClassification} />
          {m.status === "ENDED" && <PostprocessBadge status={m.postprocessStatus} />}
        </span>
      </button>
      <MeetingStatusBadge status={m.status} />
      {action ? <Button variant={action.primary ? "primary" : "secondary"} size="sm" onClick={onOpen} aria-label={`${m.title} ${action.label}`}>{action.label}<ArrowUpRightIcon size={11} /></Button> : <span className="w-[74px]" />}
    </div>
  );
}

function Group({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-[13px] font-bold text-slate-900 pb-2 border-b border-slate-200">{title}{count != null && <span className="ml-1.5 font-medium text-slate-400">{count}</span>}</h2>
      <div role="list">{children}</div>
    </section>
  );
}

export default function MeetingsScreen({ navigate }: { navigate: Navigate }) {
  const { me } = useAuth();
  const { data, loading, error, reload } = useLoad(() => api.listMeetings({ limit: 100 }), []);
  const projectsLoad = useLoad(() => prj.listProjects({ limit: 100 }), []);
  const [showCreate, setShowCreate] = useState(false);
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");
  // limit은 최대 100이라 그보다 많으면 offset을 올려 가며 더 읽는다. 첫 쪽을 다시 읽으면(reload) 추가로 읽은 쪽은 비운다.
  const [more, setMore] = useState<api.MeetingResponse[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  useEffect(() => { setMore([]); setMoreError(null); }, [data]);

  if (loading && !data) return <Spinner text="회의 목록을 불러오는 중..." />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  const items = [...(data?.items ?? []), ...more];
  const total = data?.page.total ?? items.length;
  async function loadMore() {
    setLoadingMore(true); setMoreError(null);
    try { const page = await api.listMeetings({ limit: 100, offset: items.length }); setMore(prev => [...prev, ...page.items]); }
    catch (e) { setMoreError(errorText(e)); } finally { setLoadingMore(false); }
  }
  const nameOf = (projectId: string) => projectsLoad.data?.items.find(p => p.projectId === projectId)?.name;
  const startMs = (m: api.MeetingResponse) => new Date(m.scheduledStartAt ?? m.createdAt).getTime();
  // 검토할 회의록 초안이 있는 회의. AI 처리가 막힌 회의(AI_EGRESS_BLOCKED)는 회의록이 만들어지지 않아 검토할 것이 없다.
  const needsMyReview = (m: api.MeetingResponse) => m.status === "ENDED" && m.reviewOwnerUserId === me?.userId && (m.postprocessStatus === "MINUTES_DRAFT" || m.postprocessStatus === "REVIEWING");
  const reviewList = items.filter(needsMyReview);
  const inProgress = items.filter(m => m.status === "IN_PROGRESS");
  const scheduled = items.filter(m => m.status === "SCHEDULED").sort((a, b) => startMs(a) - startMs(b));
  const past = items.filter(m => m.status === "ENDED" || m.status === "CANCELED").sort((a, b) => startMs(b) - startMs(a));
  const open = (m: api.MeetingResponse) => () => navigate("meeting-detail", { meetingId: m.meetingId });

  return (
    <>
      {showCreate && <CreateMeetingModal onClose={() => setShowCreate(false)} onCreated={() => reload()} />}
      <div className="h-full overflow-y-auto">
        <div className="max-w-[960px] mx-auto px-8 py-6">
          <div className="flex items-center justify-between gap-4 mb-6">
            <Tabs<"upcoming" | "past"> label="회의 구분" value={tab} onChange={setTab} className="flex-1"
              items={[{ value: "upcoming", label: "예정된 회의", count: inProgress.length + scheduled.length }, { value: "past", label: "지난 회의", count: past.length }]} />
            <Button onClick={() => setShowCreate(true)}><PlusIcon size={13} />회의 생성</Button>
          </div>
          {error && <p className="mb-3 text-[12px] text-rose-500">목록을 새로 고치지 못했습니다. <button onClick={reload} className="underline">다시 시도</button></p>}

          {tab === "upcoming" ? (
            <>
              {reviewList.length > 0 && (
                <Group title="결과 확인 필요" count={reviewList.length}>
                  {reviewList.map(m => <MeetingRow key={m.meetingId} m={m} projectName={nameOf(m.projectId)} action={{ label: "검토하기", primary: true }} onOpen={open(m)} />)}
                </Group>
              )}
              {inProgress.length > 0 && (
                <Group title="진행 중" count={inProgress.length}>
                  {inProgress.map(m => <MeetingRow key={m.meetingId} m={m} projectName={nameOf(m.projectId)} action={m.myParticipationStatus === "REMOVED" ? null : { label: "참여하기", primary: true }} onOpen={open(m)} />)}
                </Group>
              )}
              <Group title="예정" count={scheduled.length}>
                {scheduled.length === 0 ? <p className="text-[13px] text-slate-400 py-8">예정된 회의가 없습니다. 오른쪽 위의 회의 생성으로 새 회의를 잡을 수 있습니다.</p>
                  : scheduled.map(m => <MeetingRow key={m.meetingId} m={m} projectName={nameOf(m.projectId)} action={m.myParticipationStatus === "REMOVED" ? null : { label: "참여하기" }} onOpen={open(m)} />)}
              </Group>
            </>
          ) : (
            <Group title="지난 회의" count={past.length}>
              {past.length === 0 ? <p className="text-[13px] text-slate-400 py-8">지난 회의가 없습니다.</p>
                : past.map(m => <MeetingRow key={m.meetingId} m={m} projectName={nameOf(m.projectId)} action={m.status === "CANCELED" ? null : needsMyReview(m) ? { label: "검토하기", primary: true } : { label: "결과 보기" }} onOpen={open(m)} />)}
            </Group>
          )}
          {items.length < total && (
            <div className="flex flex-col items-center gap-1 py-4">
              <Button variant="secondary" size="sm" disabled={loadingMore} onClick={loadMore}>{loadingMore ? "불러오는 중..." : `더 불러오기 (${items.length}/${total})`}</Button>
              {moreError && <p className="text-[11px] text-rose-500">{moreError}</p>}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
