import type { FieldError } from "./types";

export class ApiError extends Error {
  readonly status: number;
  readonly errorCode: string;
  readonly requestId?: string;
  readonly fieldErrors?: FieldError[];

  constructor(status: number, errorCode: string, message: string, requestId?: string, fieldErrors?: FieldError[]) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.errorCode = errorCode;
    this.requestId = requestId;
    this.fieldErrors = fieldErrors;
  }
}

// Client는 message 문자열이 아니라 HTTP status + errorCode로 분기한다. 아래는 화면 표시용 문구다.
const MESSAGES: Record<string, string> = {
  NETWORK_ERROR: "네트워크 연결을 확인한 뒤 다시 시도해 주세요.",
  VALIDATION_ERROR: "입력값이 올바르지 않습니다.",
  INVALID_CREDENTIALS: "이메일 또는 비밀번호가 올바르지 않습니다.",
  USER_INACTIVE: "비활성화된 계정입니다. 회사 관리자에게 문의해 주세요.",
  COMPANY_INACTIVE: "비활성화된 회사입니다.",
  RATE_LIMIT_EXCEEDED: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
  TOKEN_INVALID: "로그인이 만료되었습니다. 다시 로그인해 주세요.",
  REFRESH_INVALID: "세션이 만료되었습니다. 다시 로그인해 주세요.",
  REFRESH_EXPIRED: "세션이 만료되었습니다. 다시 로그인해 주세요.",
  REFRESH_REUSED: "보안을 위해 세션이 종료되었습니다. 다시 로그인해 주세요.",
  AUTH_CHALLENGE_INVALID: "인증 단계가 만료되었습니다. 처음부터 다시 시도해 주세요.",
  AUTH_CHALLENGE_CONSUMED: "이미 사용된 인증 요청입니다. 처음부터 다시 시도해 주세요.",
  AUTH_CHALLENGE_ATTEMPTS_EXCEEDED: "인증 시도 횟수를 초과했습니다. 처음부터 다시 시도해 주세요.",
  MFA_CODE_INVALID: "인증 코드가 올바르지 않습니다.",
  RECOVERY_CODE_INVALID: "복구 코드가 올바르지 않습니다.",
  RECOVERY_CODE_ALREADY_USED: "이미 사용된 복구 코드입니다.",
  BOOTSTRAP_NOT_ALLOWED: "MFA 초기 설정을 진행할 수 없는 상태입니다.",
  MFA_ALREADY_ACTIVE: "이미 MFA가 활성화되어 있습니다.",
  ADMIN_REQUIRED: "회사 관리자만 사용할 수 있는 기능입니다.",
  STEP_UP_REQUIRED: "추가 본인 확인이 필요합니다.",
  SELF_STATUS_CHANGE_FORBIDDEN: "자기 자신의 상태는 변경할 수 없습니다.",
  LAST_ACTIVE_ADMIN: "마지막 활성 관리자는 변경할 수 없습니다.",
  TARGET_MFA_REQUIRED: "대상 사용자가 MFA를 먼저 설정해야 합니다.",
  TARGET_USER_INACTIVE: "비활성 사용자에게는 적용할 수 없습니다.",
  USER_NOT_FOUND: "사용자를 찾을 수 없습니다.",
  USER_STATUS_CONFLICT: "이미 같은 상태이거나 변경할 수 없는 상태입니다.",
  VERSION_CONFLICT: "다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 시도해 주세요.",
  EMAIL_UNAVAILABLE: "사용할 수 없는 이메일입니다.",
  INVITATION_ALREADY_ACTIVE: "이미 유효한 초대가 있습니다.",
  INVITATION_INVALID: "유효하지 않거나 만료된 초대입니다.",
  INVITATION_NOT_FOUND: "초대를 찾을 수 없습니다.",
  INVITATION_STATE_CONFLICT: "현재 상태에서는 처리할 수 없는 초대입니다.",
  PASSWORD_RESET_TOKEN_INVALID: "유효하지 않거나 만료된 재설정 링크입니다.",
  PASSWORD_RESET_TOKEN_CONSUMED: "이미 사용된 재설정 링크입니다.",
  ORGANIZATION_STATE_CONFLICT: "현재 조직 상태에서는 변경할 수 없습니다.",
  DEPARTMENT_NOT_FOUND: "부서를 찾을 수 없습니다.",
  DEPARTMENT_NAME_CONFLICT: "이미 존재하는 부서명입니다.",
  DEPARTMENT_ALREADY_INACTIVE: "이미 비활성화된 부서입니다.",
  DEPARTMENT_INACTIVE: "비활성화된 부서입니다.",
  TEAM_NOT_FOUND: "팀을 찾을 수 없습니다.",
  TEAM_NAME_CONFLICT: "같은 부서에 이미 존재하는 팀명입니다.",
  TEAM_ALREADY_INACTIVE: "이미 비활성화된 팀입니다.",
  EMAIL_DELIVERY_UNAVAILABLE: "이메일 발송이 일시적으로 불가합니다. 잠시 후 다시 시도해 주세요.",
  ACTIVE_ADMIN_MFA_REQUIRED: "활성 관리자는 MFA를 해제할 수 없습니다.",
  MFA_NOT_ACTIVE: "MFA가 활성화되어 있지 않습니다.",

  // Project / Work / Schedule (02)
  PROJECT_NOT_FOUND: "프로젝트를 찾을 수 없습니다.",
  PROJECT_MEMBER_REQUIRED: "이 프로젝트에 접근할 권한이 없습니다.",
  PROJECT_MEMBERSHIP_SUSPENDED: "프로젝트 접근이 일시 정지되었습니다.",
  PROJECT_MANAGER_REQUIRED: "프로젝트 담당자만 할 수 있는 작업입니다.",
  PROJECT_WRITE_FORBIDDEN: "열람 권한만 있어 변경할 수 없습니다.",
  PROJECT_NOT_ACTIVE: "진행 중인 프로젝트에서만 가능합니다.",
  PROJECT_NOT_COMPLETED: "완료된 프로젝트가 아닙니다.",
  PROJECT_ARCHIVED: "보관된 프로젝트는 수정할 수 없습니다.",
  PROJECT_ALREADY_ARCHIVED: "이미 보관된 프로젝트입니다.",
  PROJECT_STATE_CONFLICT: "현재 프로젝트 상태에서는 처리할 수 없습니다.",
  PROJECT_CREATION_QUOTA_EXCEEDED: "프로젝트 생성 한도를 초과했습니다.",
  MANAGER_RECOVERY_REQUIRED: "담당자가 없어 관리자 복구가 먼저 필요합니다.",
  MANAGER_RECOVERY_NOT_REQUIRED: "이 프로젝트는 이미 담당자가 있습니다.",
  LAST_ACTIVE_MANAGER: "마지막 남은 담당자는 변경/제거할 수 없습니다.",
  PROJECT_MEMBERSHIP_NOT_FOUND: "구성원 정보를 찾을 수 없습니다.",
  PROJECT_MEMBER_ALREADY_EXISTS: "이미 프로젝트에 속한 사용자입니다.",
  MEMBERSHIP_NOT_ACTIVE: "활성 상태가 아닌 구성원입니다.",
  MEMBERSHIP_NOT_SUSPENDED: "정지 상태가 아니어서 복구할 수 없습니다.",
  MEMBERSHIP_ALREADY_REMOVED: "이미 제거된 구성원입니다.",
  TARGET_USER_NOT_FOUND: "대상 사용자를 찾을 수 없습니다.",
  TARGET_MEMBERSHIP_CONFLICT: "대상 사용자의 구성원 상태가 충돌합니다.",
  DECISION_NOT_FOUND: "결정을 찾을 수 없습니다.",
  DECISION_SUPERSEDED: "이미 대체된 결정은 수정할 수 없습니다.",
  DECISION_ALREADY_SUPERSEDED: "이미 대체된 결정입니다.",
  TASK_NOT_FOUND: "업무를 찾을 수 없습니다.",
  TASK_FILTER_FORBIDDEN: "다른 사람의 담당 업무는 담당자만 필터링할 수 있습니다.",
  TASK_UPDATE_FORBIDDEN: "이 업무를 수정할 권한이 없습니다.",
  TASK_STATUS_CHANGE_FORBIDDEN: "이 업무의 상태를 변경할 권한이 없습니다.",
  INVALID_TASK_TRANSITION: "허용되지 않는 상태 변경입니다.",
  ASSIGNEE_REQUIRED: "진행 중으로 바꾸려면 담당자가 필요합니다.",
  ASSIGNEE_NOT_FOUND: "담당자를 찾을 수 없습니다.",
  ASSIGNEE_NOT_ELIGIBLE: "열람 권한만 있는 구성원은 담당자로 지정할 수 없습니다.",
  ASSIGNEE_UNAVAILABLE: "담당자 계정을 사용할 수 없습니다.",
  TASK_ALREADY_UNASSIGNED: "이미 담당자가 없는 업무입니다.",
  SCHEDULE_ITEM_NOT_FOUND: "일정을 찾을 수 없습니다.",
  SCHEDULE_ITEM_CANCELED: "취소된 일정은 수정할 수 없습니다.",
  SCHEDULE_ITEM_ALREADY_CANCELED: "이미 취소된 일정입니다.",
};

const FIELD_REASONS: Record<string, string> = {
  REQUIRED: "필수 입력입니다",
  INVALID_FORMAT: "형식이 올바르지 않습니다",
  INVALID_UUID: "올바르지 않은 식별자입니다",
  INVALID_ENUM: "허용되지 않는 값입니다",
  OUT_OF_RANGE: "허용 범위를 벗어났습니다",
  TOO_LONG: "너무 깁니다",
  TOO_SHORT: "너무 짧습니다",
};

export function errorText(e: unknown): string {
  if (e instanceof ApiError) return MESSAGES[e.errorCode] ?? (e.status >= 500 ? "서버에 일시적인 문제가 있습니다. 잠시 후 다시 시도해 주세요." : e.message);
  return "알 수 없는 오류가 발생했습니다.";
}

export function fieldErrorMap(e: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (e instanceof ApiError) for (const f of e.fieldErrors ?? []) out[f.field] = FIELD_REASONS[f.reason] ?? f.reason;
  return out;
}
