// 참가자 — 추가(②) · 제거 · 기록 접근권 · 주최자 변경 · 검토 담당자 복구 · 열람자 초대·회수(FRONTEND_06). 버튼은 FRONTEND_00 6절 표대로 미리 켜고 끈다.
//   열람자: 주최자만, 예정·종료일 때 초대(프로젝트 멤버가 아니어도 된다 — 같은 회사 직원). 종료 후에는 열람자 행만 회수할 수 있고(실제 참석자는 409), 회수한 열람자는 다시 초대할 수 있다.
//   추가: 주최자, 예정만 / 제거: 주최자, 예정·진행 중, 주최자 본인 제외(먼저 주최자 변경) / 기록 접근권: 주최자 또는 프로젝트 MANAGER, 취소 외 전부
//   주최자 변경: 주최자, 예정만(검토 담당자는 바뀌지 않는다) / 검토 담당자 복구: 프로젝트 MANAGER, 종료 후, 담당자가 부재일 때만
import { useState } from "react";
import * as api from "../api/meeting";
import type { MeetingParticipantResponse } from "../api/meeting";
import { ApiError, errorText } from "../api/errors";
import { Avatar, Card, Section } from "../ui/kit";
import { ParticipationBadge, RecordAccessBadge } from "./shared";
import { ProjectMemberPickModal, ReasonModal, UserPickModal } from "./dialogs";
import type { MeetingCtx } from "./meetingContext";
import { canInviteViewer, canReinviteViewer, canRevokeViewer, isViewerRow, viewerInviteErrorText, viewerInviteExclude } from "./viewerAccess";

export default function ParticipantsTab({ ctx }: { ctx: MeetingCtx }) {
  const { m, isOrganizer, projectRole, nameOf, isKnownUser, orgUsers, participants: items, reloadParticipants, setMeeting } = ctx;
  const [modal, setModal] = useState<"add" | "viewer" | "transfer" | "recover" | null>(null);
  const [accessTarget, setAccessTarget] = useState<MeetingParticipantResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showRemoved, setShowRemoved] = useState(false);

  const isManager = projectRole === "MANAGER";
  const canceled = m.status === "CANCELED";
  const canManageAccess = (isOrganizer || isManager) && !canceled;
  const editableRoster = m.status === "SCHEDULED" || m.status === "IN_PROGRESS";
  const live = items.filter(p => p.participationStatus === "ACTIVE");
  const visible = showRemoved ? items : live;
  const removedCount = items.length - live.length;

  // 검토 담당자가 부재인지 알려 주는 필드는 없다(14-1 #7). 참여자 목록의 접근권·참여 상태와 이름 목록(활성 사용자만)으로 추정한다.
  const reviewer = items.find(p => p.userId === m.reviewOwnerUserId);
  const reviewerAbsent = !reviewer || reviewer.participationStatus !== "ACTIVE" || reviewer.recordAccessState !== "GRANTED" || !isKnownUser(m.reviewOwnerUserId);
  const canRecover = isManager && m.status === "ENDED" && reviewerAbsent;

  async function remove(p: MeetingParticipantResponse) {
    const viewer = isViewerRow(p);
    if (!confirm(viewer
      ? `${nameOf(p.userId)} 님의 열람 권한을 회수하시겠습니까?\n회수하면 즉시 이 회의의 회의록·보고서를 볼 수 없게 됩니다. 필요하면 다시 초대할 수 있습니다.`
      : `${nameOf(p.userId)} 님을 이 회의에서 제외하시겠습니까?\n제외하면 기록 접근 권한도 함께 회수되고, 다시 추가할 수 없습니다.`)) return;
    setBusy(p.userId); setMsg(null);
    try { await api.removeMeetingParticipant(m.meetingId, p.userId); reloadParticipants(); }
    catch (e) {
      setMsg({ ok: false, text: (e instanceof ApiError ? viewerInviteErrorText(e) : null) ?? errorText(e) });
      reloadParticipants(); // 이미 회수됐거나 없는 사람이면 목록을 새로 읽어 맞춘다
    } finally { setBusy(null); }
  }
  // 열람자 초대(회수한 열람자의 재초대 포함). role은 반드시 "VIEWER"를 명시한다 — 안 보내면 PARTICIPANT로 처리돼 종료 후에는 409다.
  async function inviteViewer(userId: string) {
    try { await api.addMeetingParticipant(m.meetingId, userId, "VIEWER"); reloadParticipants(); }
    catch (e) {
      const t = e instanceof ApiError ? viewerInviteErrorText(e) : null;
      if (t && e instanceof ApiError) throw new ApiError(e.status, "VIEWER_INVITE_ERROR", t, e.requestId); // 모달이 errorText()로 보여 주도록 문구를 실어 보낸다
      throw e;
    }
  }
  async function reinvite(p: MeetingParticipantResponse) {
    setBusy(p.userId); setMsg(null);
    try { await inviteViewer(p.userId); setMsg({ ok: true, text: `${nameOf(p.userId)} 님을 다시 열람자로 초대했습니다.` }); }
    catch (e) { setMsg({ ok: false, text: errorText(e) }); } finally { setBusy(null); }
  }

  return (
    <div className="max-w-2xl space-y-4">
      {modal === "add" && (
        <ProjectMemberPickModal projectId={m.projectId} nameOf={nameOf} title="참가자 추가" confirmLabel="추가"
          description="프로젝트 구성원만 추가할 수 있습니다. 한 번 제외된 사람은 다시 추가할 수 없습니다."
          exclude={new Set(items.map(p => p.userId))} onClose={() => setModal(null)}
          onSubmit={async userId => { await api.addMeetingParticipant(m.meetingId, userId); reloadParticipants(); }} />
      )}
      {modal === "viewer" && (
        <UserPickModal title="열람자 초대" confirmLabel="초대"
          description="같은 회사의 직원을 이 회의의 열람자로 초대합니다. 프로젝트 멤버가 아니어도 됩니다. 열람자는 승인된 회의록과 최종 보고서만 볼 수 있고, 회의 자료·프로젝트 자료·원본 녹음은 볼 수 없습니다."
          emptyText="초대할 수 있는 사람이 없습니다."
          options={orgUsers.filter(u => !viewerInviteExclude(items).has(u.userId)).map(u => ({ userId: u.userId, label: u.displayName }))}
          onClose={() => setModal(null)} onSubmit={userId => inviteViewer(userId)} />
      )}
      {modal === "transfer" && (
        <ProjectMemberPickModal projectId={m.projectId} nameOf={nameOf} title="주최자 변경" confirmLabel="변경"
          description="새 주최자는 프로젝트 구성원이어야 하고, 참가자가 아니면 자동으로 추가됩니다. 검토 담당자(회의록·후보·보고서)는 바뀌지 않습니다. 변경하면 나는 더 이상 이 회의를 시작·수정할 수 없습니다."
          exclude={new Set([m.organizerUserId, ...items.filter(p => p.participationStatus === "REMOVED" || p.recordAccessState === "REVOKED").map(p => p.userId)])} onClose={() => setModal(null)}
          onSubmit={async userId => { setMeeting(await api.transferMeetingOrganizer(m.meetingId, { targetUserId: userId, version: m.version })); reloadParticipants(); }} />
      )}
      {modal === "recover" && (
        <UserPickModal title="검토 담당자 교체" confirmLabel="교체" withReason
          description="현재 검토 담당자가 일할 수 없을 때 프로젝트 담당자가 다른 사람으로 바꿉니다. 새 담당자는 이 회의의 참가자이고 기록 접근 권한이 있어야 합니다."
          emptyText="교체할 수 있는 참가자가 없습니다. 먼저 대상에게 기록 접근 권한을 부여해 주세요."
          options={live.filter(p => p.recordAccessState === "GRANTED" && p.userId !== m.reviewOwnerUserId && isKnownUser(p.userId)).map(p => ({ userId: p.userId, label: nameOf(p.userId) }))}
          onClose={() => setModal(null)}
          onSubmit={async (userId, reason) => { setMeeting(await api.reviewOwnerRecovery(m.meetingId, { targetUserId: userId, reason })); reloadParticipants(); }} />
      )}
      {accessTarget && (
        <ReasonModal required title={accessTarget.recordAccessState === "GRANTED" ? "기록 접근 회수" : "기록 접근 복원"}
          description={accessTarget.recordAccessState === "GRANTED"
            ? `${nameOf(accessTarget.userId)} 님은 이 회의의 회의록·후처리를 더 볼 수 없고, 진행 중이면 즉시 쫓겨납니다.`
            : `${nameOf(accessTarget.userId)} 님이 다시 이 회의의 기록을 볼 수 있습니다. (참여 상태는 그대로입니다)`}
          confirmLabel={accessTarget.recordAccessState === "GRANTED" ? "회수" : "복원"} danger={accessTarget.recordAccessState === "GRANTED"}
          onClose={() => setAccessTarget(null)}
          onSubmit={async reason => {
            // version은 회의가 아니라 그 참가자 항목의 값이다.
            await api.updateMeetingRecordAccess(m.meetingId, accessTarget.userId, { state: accessTarget.recordAccessState === "GRANTED" ? "REVOKED" : "GRANTED", reason, version: accessTarget.version });
            reloadParticipants();
          }} />
      )}

      <div className="flex items-center justify-between gap-2">
        <Section>참가자 ({live.length})</Section>
        <div className="flex items-center gap-3">
          {isOrganizer && m.status === "SCHEDULED" && <button onClick={() => setModal("transfer")} className="text-[11px] text-slate-500 font-semibold hover:text-indigo-600">주최자 변경</button>}
          {canRecover && <button onClick={() => setModal("recover")} className="text-[11px] text-amber-600 font-semibold hover:text-amber-700">검토 담당자 교체</button>}
          {canInviteViewer(m, isOrganizer) && <button onClick={() => setModal("viewer")} className="text-[11px] text-slate-500 font-semibold hover:text-indigo-600">+ 열람자 초대</button>}
          {isOrganizer && m.status === "SCHEDULED" && <button onClick={() => setModal("add")} className="text-[11px] text-indigo-500 font-semibold hover:text-indigo-700">+ 추가</button>}
        </div>
      </div>
      {canRecover && <p className="text-[12px] text-amber-700 bg-amber-50 rounded-xl px-3 py-2">검토 담당자({nameOf(m.reviewOwnerUserId)})가 비활성이거나 기록 접근 권한이 없는 것으로 보입니다. 프로젝트 담당자는 다른 참가자로 교체해 회의록 검토를 이어갈 수 있습니다.</p>}

      <Card className="divide-y divide-slate-50">
        {visible.length === 0 && <p className="text-[12px] text-slate-400 text-center py-8">참가자가 없습니다.</p>}
        {visible.map(p => {
          const removed = p.participationStatus === "REMOVED";
          return (
            <div key={p.participantId} className={`flex items-center gap-3 px-4 py-3 ${removed ? "opacity-60" : ""}`}>
              <Avatar name={nameOf(p.userId)} seed={p.userId} size={32} />
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-slate-800 truncate">{nameOf(p.userId)}{p.userId === m.organizerUserId && " · 주최자"}{p.userId === m.reviewOwnerUserId && " · 검토자"}{isViewerRow(p) && " · 열람자"}</p>
                <div className="flex items-center gap-1.5 mt-1"><ParticipationBadge status={p.participationStatus} /><RecordAccessBadge state={p.recordAccessState} /></div>
              </div>
              <div className="flex gap-2.5 shrink-0">
                {canManageAccess && (
                  <button disabled={busy === p.userId} onClick={() => setAccessTarget(p)} className="text-[11px] text-slate-500 font-semibold hover:text-indigo-600 disabled:opacity-40">
                    {p.recordAccessState === "GRANTED" ? "기록 회수" : "기록 복원"}
                  </button>
                )}
                {isOrganizer && editableRoster && !removed && p.userId !== m.organizerUserId && (
                  <button disabled={busy === p.userId} onClick={() => remove(p)} className="text-[11px] text-rose-400 font-semibold hover:text-rose-600 disabled:opacity-40">{isViewerRow(p) ? "회수" : "제외"}</button>
                )}
                {canRevokeViewer(m, isOrganizer, p) && (
                  <button disabled={busy === p.userId} onClick={() => remove(p)} className="text-[11px] text-rose-400 font-semibold hover:text-rose-600 disabled:opacity-40">열람 회수</button>
                )}
                {canReinviteViewer(m, isOrganizer, p) && (
                  <button disabled={busy === p.userId} onClick={() => void reinvite(p)} className="text-[11px] text-indigo-500 font-semibold hover:text-indigo-700 disabled:opacity-40">다시 초대</button>
                )}
              </div>
            </div>
          );
        })}
      </Card>
      {removedCount > 0 && (
        <button onClick={() => setShowRemoved(v => !v)} className="text-[11px] text-slate-400 font-semibold hover:text-slate-600">
          {showRemoved ? "제외·회수된 사람 숨기기" : `제외·회수된 사람 ${removedCount}명 보기`}
        </button>
      )}
      {!isOrganizer && !isManager && <p className="text-[11px] text-slate-400">참가자 변경은 주최자(또는 프로젝트 담당자)만 할 수 있습니다.</p>}
      {msg && <p className={`text-[12px] font-medium ${msg.ok ? "text-emerald-600" : "text-rose-500"}`}>{msg.text}</p>}
    </div>
  );
}
