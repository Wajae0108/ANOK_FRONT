// 관리자 콘솔 "회의" — FRONTEND_00 11-1.
//  · 새 회의의 기본 민감도(회사 설정). 처음 설정은 version 0으로 보낸다. 이미 만든 회의에는 영향이 없고, 올리면 새 회의는 AI 처리가 막힌 채 만들어진다.
//  · 복구 큐: 주최자가 부재한 채 진행 중인 회의(강제 종료), 검토 담당자가 부재한 종료 회의(교체). 관리자는 회의 내용(회의록 등)을 볼 수 없다.
//  쓰기·복구 큐는 최근 10분 안에 MFA를 한 토큰이 필요하다 — 403 STEP_UP_REQUIRED는 HTTP 계층이 단계 인증을 거쳐 같은 요청을 다시 보낸다.
import { useState } from "react";
import * as api from "../api/meeting";
import type { MeetingRecoverySummary, MeetingSensitivity } from "../api/meeting";
import { errorText } from "../api/errors";
import { Card, ErrorBox, ghostBtn, primaryBtn, Section, Spinner, Tabs, useLoad } from "../ui/kit";
import { useOrgUsers } from "../projects/shared";
import { ReasonModal, UserPickModal } from "../meetings/dialogs";
import { fmtDateTime, MeetingStatusBadge, SENS_LABEL, SENSITIVITY_LEVELS } from "../meetings/shared";

function SettingsCard() {
  const { data, setData, loading, error, reload } = useLoad(() => api.getMeetingSettings(), []);
  const [level, setLevel] = useState<MeetingSensitivity | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return null;
  const current = level ?? data.defaultSensitivityClassification;
  const dirty = current !== data.defaultSensitivityClassification;

  async function save() {
    if (!data) return;
    if (current !== "INTERNAL" && !confirm(`새 회의의 기본 민감도를 '${SENS_LABEL[current]}'(으)로 바꾸면, 민감도를 직접 고르지 않고 만든 회의는 AI 처리(회의록·후보·보고서)가 되지 않습니다. 계속하시겠습니까?\n(이미 만든 회의에는 영향이 없습니다)`)) return;
    setBusy(true); setMsg(null);
    try {
      setData(await api.updateMeetingSettings({ defaultSensitivityClassification: current, version: data.version }));
      setLevel(null); setMsg({ ok: true, text: "저장했습니다." });
    } catch (e) { setMsg({ ok: false, text: errorText(e) }); void reload(); } finally { setBusy(false); }
  }

  return (
    <Card className="max-w-xl p-5 space-y-3">
      <Section>새 회의의 기본 민감도</Section>
      <p className="text-[12px] text-slate-500 leading-relaxed">회의를 만들 때 민감도를 고르지 않으면 이 값이 들어갑니다. 일반이 아니면 회의 내용을 외부 AI로 보낼 수 없어 회의록·후보·보고서가 만들어지지 않습니다.</p>
      <div className="flex flex-wrap gap-2">
        {SENSITIVITY_LEVELS.map(v => (
          <button key={v} onClick={() => setLevel(v)} aria-pressed={current === v}
            className={`px-3 py-2 rounded-xl border text-[12px] font-semibold ${current === v ? "border-indigo-400 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}>{SENS_LABEL[v]}</button>
        ))}
      </div>
      <p className="text-[11px] text-slate-400">{data.version === 0 ? "아직 설정한 적이 없어 '일반'이 적용됩니다." : `마지막 변경 ${fmtDateTime(data.updatedAt)}`}</p>
      {msg && <p className={`text-[12px] font-medium ${msg.ok ? "text-emerald-600" : "text-rose-500"}`}>{msg.text}</p>}
      <button disabled={busy || !dirty} onClick={save} className={primaryBtn}>{busy ? "저장 중..." : "변경 저장"}</button>
    </Card>
  );
}

const REASON_LABEL: Record<string, string> = {
  END_OPERATION_STUCK: "종료 처리가 멈춤", STUCK_IN_PROGRESS: "진행 중인 채 오래됨(12시간 초과)", REVIEW_OWNER_UNAVAILABLE: "검토 담당자 부재",
};

function RecoveryCard() {
  const [type, setType] = useState<"ALL" | "FORCE_END" | "REVIEW_OWNER">("ALL");
  const { data, loading, error, reload } = useLoad(() => api.listMeetingRecoveryQueue({ type: type === "ALL" ? undefined : type, limit: 100 }), [type]);
  const { users, nameOf } = useOrgUsers();
  const [forceEnd, setForceEnd] = useState<MeetingRecoverySummary | null>(null);
  const [recover, setRecover] = useState<MeetingRecoverySummary | null>(null);

  return (
    <Card className="p-5 space-y-3">
      {forceEnd && (
        <ReasonModal title="회의 강제 종료" required danger confirmLabel="강제 종료" onClose={() => setForceEnd(null)}
          description="주최자가 부재한 진행 중 회의를 관리자가 종료합니다. 주최자가 아직 부재 상태가 아니면 거절됩니다."
          onSubmit={async reason => { await api.adminForceEndMeeting(forceEnd.meetingId, reason); reload(); }} />
      )}
      {recover && (
        <UserPickModal title="검토 담당자 교체" withReason confirmLabel="교체" emptyText="선택할 수 있는 사용자가 없습니다." onClose={() => setRecover(null)}
          description="새 검토 담당자는 활성 계정이고, 그 프로젝트의 구성원이며, 이 회의의 참가자로 기록 접근 권한이 있어야 합니다."
          options={users.filter(u => u.userId !== recover.reviewOwnerUserId).map(u => ({ userId: u.userId, label: `${u.displayName}${u.jobTitle ? ` · ${u.jobTitle}` : ""}` }))}
          onSubmit={async (userId, reason) => { await api.adminReviewOwnerRecovery(recover.meetingId, { targetUserId: userId, reason }); reload(); }} />
      )}
      <div className="flex items-center justify-between gap-3">
        <Section>복구가 필요한 회의</Section>
        <Tabs<"ALL" | "FORCE_END" | "REVIEW_OWNER"> variant="pill" label="복구 유형" value={type} onChange={setType}
          items={[{ value: "ALL", label: "전체" }, { value: "FORCE_END", label: "강제 종료" }, { value: "REVIEW_OWNER", label: "담당자 교체" }]} />
      </div>
      <p className="text-[11px] text-slate-400">관리자는 회의록 등 회의 내용을 볼 수 없습니다. 목록이 비어 있는 것이 정상입니다. 문서 서비스 장애로 종료가 지연되는 회의는 서버가 알아서 마무리하므로 이 목록에 나타나지 않을 수 있습니다.</p>
      {loading && !data ? <Spinner /> : error && !data ? <ErrorBox message={error} onRetry={reload} /> : (data?.items.length ?? 0) === 0 ? (
        <p className="text-[13px] text-slate-400 py-8 text-center">복구가 필요한 회의가 없습니다.</p>
      ) : (
        <div className="divide-y divide-slate-50">
          {data!.items.map(r => {
            const forceable = r.recoveryReasonClass !== "REVIEW_OWNER_UNAVAILABLE";
            return (
              <div key={`${r.meetingId}:${r.recoveryReasonClass}`} className="flex items-center gap-3 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-slate-800">회의 {r.meetingId.slice(0, 8)}… <MeetingStatusBadge status={r.status} /></p>
                  <p className="text-[11px] text-slate-400 mt-0.5">{REASON_LABEL[r.recoveryReasonClass] ?? r.recoveryReasonClass} · 주최자 {nameOf(r.organizerUserId)} · 검토 담당자 {nameOf(r.reviewOwnerUserId)}
                    {r.timestamps?.startedAt && ` · 시작 ${fmtDateTime(r.timestamps.startedAt)}`}{r.timestamps?.endedAt && ` · 종료 ${fmtDateTime(r.timestamps.endedAt)}`}</p>
                </div>
                {forceable ? <button onClick={() => setForceEnd(r)} className={ghostBtn}>강제 종료</button> : <button onClick={() => setRecover(r)} className={ghostBtn}>담당자 교체</button>}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

export default function MeetingAdmin() {
  return (
    <div className="space-y-4 max-w-3xl">
      <SettingsCard />
      <RecoveryCard />
    </div>
  );
}
