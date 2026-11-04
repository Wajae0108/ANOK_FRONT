// 회의 "열람자"(FRONTEND_06) 화면 규칙. 종료 후에도 같은 회사 직원을 열람자로 초대해 승인된 회의록·최종 보고서만 보게 한다.
// 회의 상세 응답에는 "내가 열람자인지"가 없어서 참가자 목록의 내 행(meetingRole)으로 알아낸다. 프로젝트 멤버인지도 응답에 없어서
// 프로젝트 조회(GET /api/projects/{id})가 되는지로 판단한다 — 서버는 매번 다시 확인하므로 화면은 미리 숨길 뿐이다.
import type { MeetingParticipantResponse, MeetingResponse, MeetingRole } from "../api/meeting";

/** 참가자 목록에서 내 역할. 내 행이 없거나 아직 못 읽었으면 null. 회수된(REMOVED) 행은 현재 역할이 아니다. */
export function myMeetingRole(items: MeetingParticipantResponse[], myUserId?: string | null): MeetingRole | null {
  if (!myUserId) return null;
  const mine = items.find(p => p.userId === myUserId && p.participationStatus === "ACTIVE");
  return mine ? (mine.meetingRole ?? "PARTICIPANT") : null;
}

export const isViewerRow = (p: MeetingParticipantResponse) => p.meetingRole === "VIEWER";

/** 프로젝트 멤버가 아닌 열람자: 승인된 회의록·최종 보고서만 볼 수 있다(자료·녹음·후보·AI 분석·후처리 상태는 403). */
export function isOutsideViewer(role: MeetingRole | null, projectKnown: boolean, isProjectMember: boolean): boolean {
  return role === "VIEWER" && projectKnown && !isProjectMember;
}

/** 열람자 초대 버튼: 주최자만, 회의가 예정이거나 종료됐을 때만(진행 중에는 409 MEETING_NOT_SCHEDULED). */
export const canInviteViewer = (m: Pick<MeetingResponse, "status">, isOrganizer: boolean) => isOrganizer && (m.status === "SCHEDULED" || m.status === "ENDED");

/** 종료 후 회수 버튼: 주최자만, 열람자 행에만(실제 참석자는 409 MEETING_STATE_NOT_MUTABLE). 예정·진행 중의 "제외"는 기존 규칙. */
export const canRevokeViewer = (m: Pick<MeetingResponse, "status">, isOrganizer: boolean, p: MeetingParticipantResponse) =>
  isOrganizer && m.status === "ENDED" && isViewerRow(p) && p.participationStatus === "ACTIVE";

/** 회수된 열람자를 같은 요청으로 다시 초대하는 버튼. */
export const canReinviteViewer = (m: Pick<MeetingResponse, "status">, isOrganizer: boolean, p: MeetingParticipantResponse) =>
  canInviteViewer(m, isOrganizer) && isViewerRow(p) && p.participationStatus === "REMOVED";

/** 열람자로 초대할 수 있는 사람: 이미 활성 참가자인 사람과, 열람자가 아닌데 빠진 사람(다시 추가 불가)은 뺀다. 회수된 열람자는 다시 초대할 수 있다. */
export function viewerInviteExclude(items: MeetingParticipantResponse[]): Set<string> {
  return new Set(items.filter(p => p.participationStatus === "ACTIVE" || !isViewerRow(p)).map(p => p.userId));
}

/** 초대·회수 실패 문구 (6-1, 4-1/4-2 표). errorCode로만 분기한다. */
export function viewerInviteErrorText(e: { status: number; errorCode: string }): string | null {
  switch (e.errorCode) {
    case "TARGET_USER_NOT_FOUND": return "찾을 수 없는 사용자입니다.";
    case "TARGET_USER_INACTIVE": return "비활성 사용자입니다.";
    case "PARTICIPANT_ALREADY_EXISTS": return "이미 추가된 사람입니다.";
    // 종료 후 일반 참여자 추가와 진행 중 회의 추가가 같은 코드다 — 일반 문구로.
    case "MEETING_NOT_SCHEDULED": return "지금은 추가할 수 없는 회의 상태입니다.";
    case "MEETING_ORGANIZER_REQUIRED": return "회의 주최자만 초대할 수 있습니다.";
    case "MEETING_STATE_NOT_MUTABLE": return "실제로 참석한 사람은 종료 후에 뺄 수 없습니다.";
    case "ORGANIZER_REMOVE_FORBIDDEN": return "주최자는 뺄 수 없습니다.";
    case "PARTICIPANT_ALREADY_REMOVED": return "이미 회수된 사람입니다. 목록을 새로고침해 주세요.";
    case "PARTICIPANT_NOT_FOUND": return "이 회의에 없는 사람입니다. 목록을 새로고침해 주세요.";
  }
  return null;
}

/** 403은 코드로 문구를 나누지 않고 "접근할 수 없습니다"로 통일한다(회수 직후 API마다 코드가 다르다). */
export const isNoAccess = (e: { status: number }) => e.status === 403;
export const NO_ACCESS_TEXT = "접근할 수 없습니다.";
