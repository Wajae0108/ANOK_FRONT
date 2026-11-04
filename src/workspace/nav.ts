// 화면 이동 계약. App.tsx(라우팅)와 Workspace/Admin 셸·화면이 공유한다. 라우터 라이브러리 없이 screen 상태로 전환한다.
export type CompanyRole = "ADMIN" | "EMPLOYEE";

export interface CurrentUser {
  id: number;
  userId?: string;
  name: string;
  avatar: string;
  color: string;
  team: string;
  companyRole: CompanyRole;
}

export type Screen =
  | "home"
  | "projects" | "project-detail"
  | "tasks"
  | "meetings" | "meeting-detail"
  | "document-detail"
  | "ai"
  | "company-admin";

export interface NavCtx {
  projectId?: string;
  meetingId?: string;
  docId?: string;
  fromMeetingId?: string;
  projectTab?: string;
  /** 내 업무 화면에서 상세 패널로 열 업무 */
  taskId?: string;
  /** 관리자 콘솔의 활성 메뉴 */
  adminTab?: string;
  /** Ask ANOK 입력창에 미리 채울 질문 */
  aiQuestion?: string;
}

export type Navigate = (s: Screen, ctx?: NavCtx) => void;

/** 관리자 콘솔에 속하는 화면 — 나머지는 모두 User Workspace. */
export const isAdminScreen = (s: Screen) => s === "company-admin";
