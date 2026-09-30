// Anok_04 — 회의 목록 + 생성.
import { useState } from "react";
import * as api from "../api/meeting";
import type { MeetingSensitivity } from "../api/meeting";
import * as prj from "../api/project";
import { errorText, fieldErrorMap } from "../api/errors";
import { Avatar, Card, ErrorBox, Field, ghostBtn, inputCls, Modal, primaryBtn, Section, Spinner, useLoad } from "../ui/kit";
import { useOrgUsers } from "../projects/shared";
import { fmtDateTime, MeetingStatusBadge, PostprocessBadge, SENSITIVITY_LEVELS, SensitivityBadge } from "./shared";

function CreateMeetingModal({ onClose, onCreated }: { onClose: () => void; onCreated: (m: api.MeetingResponse) => void }) {
  const { data: projectPage, loading: loadingProjects } = useLoad(() => prj.listProjects({ status: "ACTIVE", limit: 100 }), []);
  const { users, nameOf } = useOrgUsers();
  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("");
  const [scheduledStartAt, setScheduledStartAt] = useState("");
  const [sensitivity, setSensitivity] = useState<MeetingSensitivity>("INTERNAL");
  const [password, setPassword] = useState("");
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  const [members, setMembers] = useState<prj.ProjectMemberResponse[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function pickProject(id: string) {
    setProjectId(id); setParticipantIds([]); setMembers(null);
    if (!id) return;
    const page = await prj.listProjectMembers(id, { status: "ACTIVE", limit: 100 });
    setMembers(page.items);
  }
  function toggle(userId: string) {
    setParticipantIds(p => p.includes(userId) ? p.filter(x => x !== userId) : [...p, userId]);
  }

  async function submit() {
    setBusy(true); setError(null); setFields({});
    try {
      const m = await api.createMeeting({
        projectId, title: title.trim(), scheduledStartAt: scheduledStartAt ? new Date(scheduledStartAt).toISOString() : undefined,
        sensitivityClassification: sensitivity, participantUserIds: participantIds, password: password.trim() || undefined,
      });
      onCreated(m); onClose();
    } catch (e) { setError(errorText(e)); setFields(fieldErrorMap(e)); }
    finally { setBusy(false); }
  }

  const projects = projectPage?.items ?? [];
  const canSubmit = projectId && title.trim().length > 0;

  return (
    <Modal title="회의 생성" onClose={onClose}>
      {loadingProjects ? <Spinner /> : (
        <>
          <Field label="프로젝트" error={fields.projectId}>
            <select value={projectId} onChange={e => pickProject(e.target.value)} className={inputCls}>
              <option value="">프로젝트 선택</option>
              {projects.map(p => <option key={p.projectId} value={p.projectId}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="회의 제목" error={fields.title}>
            <input value={title} onChange={e => setTitle(e.target.value)} maxLength={200} placeholder="예: 스프린트 계획 회의" className={inputCls} />
          </Field>
          <Field label="시작 예정 시각">
            <input type="datetime-local" value={scheduledStartAt} onChange={e => setScheduledStartAt(e.target.value)} className={inputCls} />
          </Field>
          <Field label="민감도 분류">
            <div className="flex flex-wrap gap-2">
              {SENSITIVITY_LEVELS.map(v => (
                <button key={v} onClick={() => setSensitivity(v)} className={`flex-1 min-w-[70px] py-2 rounded-xl text-[11px] font-bold border ${sensitivity === v ? "bg-indigo-500 text-white border-indigo-500" : "border-slate-200 text-slate-500 hover:border-indigo-300"}`}>
                  <SensitivityBadge level={v} />
                </button>
              ))}
            </div>
          </Field>
          <Field label="비밀번호 (선택)">
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="설정 시 입장에 필요합니다" className={inputCls} />
          </Field>
          {projectId && (
            <Field label={`참가자${participantIds.length ? ` (${participantIds.length}명)` : ""}`}>
              {members === null ? <Spinner text="구성원을 불러오는 중..." /> : (
                <div className="space-y-1 max-h-48 overflow-y-auto border border-slate-100 rounded-xl p-1.5">
                  {members.length === 0 && <p className="text-[12px] text-slate-400 px-2 py-2">활성 구성원이 없습니다.</p>}
                  {members.map(mem => {
                    const u = users.find(x => x.userId === mem.userId);
                    const selected = participantIds.includes(mem.userId);
                    return (
                      <button key={mem.membershipId} onClick={() => toggle(mem.userId)}
                        className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors ${selected ? "bg-indigo-50" : "hover:bg-slate-50"}`}>
                        <Avatar name={nameOf(mem.userId)} seed={mem.userId} size={26} />
                        <span className="flex-1 text-[12px] font-medium text-slate-700">{nameOf(mem.userId)}{u?.jobTitle ? ` · ${u.jobTitle}` : ""}</span>
                        {selected && <svg className="w-4 h-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><polyline points="20 6 9 17 4 12"/></svg>}
                      </button>
                    );
                  })}
                </div>
              )}
            </Field>
          )}
          {error && <p className="text-[12px] text-rose-500 font-medium">{error}</p>}
          <div className="flex gap-2">
            <button onClick={onClose} className={`flex-1 ${ghostBtn}`}>취소</button>
            <button disabled={busy || !canSubmit} onClick={submit} className={`flex-1 ${primaryBtn}`}>{busy ? "생성 중..." : "회의 생성"}</button>
          </div>
        </>
      )}
    </Modal>
  );
}

export default function MeetingsScreen({ navigate }: { navigate: (s: any, ctx?: any) => void }) {
  const { data, loading, error, reload } = useLoad(() => api.listMeetings({ limit: 100 }), []);
  const [showCreate, setShowCreate] = useState(false);

  if (loading && !data) return <Spinner text="회의 목록을 불러오는 중..." />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  const items = data?.items ?? [];
  const scheduled = items.filter(m => m.status === "SCHEDULED");
  const inProgress = items.filter(m => m.status === "IN_PROGRESS");
  const past = items.filter(m => m.status === "ENDED" || m.status === "CANCELED");

  function Row({ m }: { m: api.MeetingResponse }) {
    return (
      <div key={m.meetingId} onClick={() => navigate("meeting-detail", { meetingId: m.meetingId })}
        className="bg-white border border-slate-100 rounded-2xl p-4 hover:border-indigo-200 hover:shadow-[0_4px_16px_rgba(79,110,247,0.08)] transition-all cursor-pointer group">
        <div className="flex items-start justify-between gap-2 mb-2">
          <p className="text-[14px] font-bold text-slate-800 group-hover:text-indigo-700 transition-colors">{m.title}</p>
          <div className="flex gap-1.5 shrink-0"><SensitivityBadge level={m.sensitivityClassification} /><MeetingStatusBadge status={m.status} /></div>
        </div>
        <p className="text-[12px] text-slate-400 mb-2">{fmtDateTime(m.scheduledStartAt)}{m.passwordProtected ? " · 🔒 비밀번호" : ""}</p>
        {m.status === "ENDED" && <PostprocessBadge status={m.postprocessStatus} />}
      </div>
    );
  }

  return (
    <>
      {showCreate && <CreateMeetingModal onClose={() => setShowCreate(false)} onCreated={() => reload()} />}
      <div className="h-full overflow-y-auto p-6 space-y-6 bg-slate-50/40">
        <div className="flex justify-end">
          <button onClick={() => setShowCreate(true)} className={primaryBtn}>+ 회의 생성</button>
        </div>
        {inProgress.length > 0 && (
          <div>
            <Section>진행 중</Section>
            <div className="grid grid-cols-2 gap-3">{inProgress.map(m => <Row key={m.meetingId} m={m} />)}</div>
          </div>
        )}
        <div>
          <Section>예정된 회의</Section>
          {scheduled.length === 0 ? <Card className="p-8 text-center text-[13px] text-slate-400">예정된 회의가 없습니다.</Card> : (
            <div className="grid grid-cols-2 gap-3">{scheduled.map(m => <Row key={m.meetingId} m={m} />)}</div>
          )}
        </div>
        <div>
          <Section>지난 회의</Section>
          <div className="grid grid-cols-2 gap-3">{past.map(m => <Row key={m.meetingId} m={m} />)}</div>
        </div>
      </div>
    </>
  );
}
