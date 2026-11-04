// 회의 상세 화면의 탭들이 공유하는 값. 버튼은 이 값으로 미리 켜고 끈다(FRONTEND_00 6절) — 서버 403/409는 사용자에게 거의 보이지 않아야 한다.
import type { MeetingParticipantResponse, MeetingResponse } from "../api/meeting";
import type { ProjectRole } from "../api/project";

export interface MeetingCtx {
  m: MeetingResponse;
  myUserId?: string;
  /** 현재 주최자 — 예정·진행 중의 열쇠. 주최자를 바꿔도 검토 담당자는 바뀌지 않는다. */
  isOrganizer: boolean;
  /** 현재 검토 담당자 — 종료 후(회의록·후보·보고서)의 열쇠. */
  isReviewOwner: boolean;
  /** 참여 중(ACTIVE)이고 기록 접근권(GRANTED)이 있다. 진행 중 회의의 채팅·음성은 이 조건을 요구한다. */
  hasAccess: boolean;
  /** 이 프로젝트에서의 내 역할. 알 수 없으면 null(프로젝트 조회 실패·권한 없음). */
  projectRole: ProjectRole | null;
  /** 이 회의에서 내가 "열람자"(VIEWER)인가 — 참가자 목록의 내 행(meetingRole)으로 안다. 열람자는 음성·채팅·자료 올리기·검토를 못 한다. */
  isViewer: boolean;
  /** 프로젝트 멤버가 아닌 열람자 — 승인된 회의록과 최종 보고서만 볼 수 있다(자료·녹음·후보·AI 분석·후처리 상태는 서버가 403). */
  isOutsideViewer: boolean;
  /** 같은 회사의 사용자들(열람자 초대 대상 고르기). */
  orgUsers: { userId: string; displayName: string }[];
  nameOf: (id?: string | null) => string;
  /** 이름 목록(활성 사용자)에 있는가. 없으면 비활성·퇴사 등으로 일할 수 없는 사용자일 수 있다. */
  isKnownUser: (id?: string | null) => boolean;
  participants: MeetingParticipantResponse[];
  reloadParticipants: () => void;
  /** 성공한 변경 요청의 응답을 반영한다(version이 올라가므로 항상 응답의 값으로 갱신한다). */
  setMeeting: (m: MeetingResponse) => void;
  /** 서버의 최신 회의를 다시 읽어 반영한다(204 응답 뒤나 VERSION_CONFLICT 뒤). */
  refreshMeeting: () => Promise<MeetingResponse | null>;
  navigate: (s: any, ctx?: any) => void;
}
