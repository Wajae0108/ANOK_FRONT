// 미팅 서비스 API — FRONTEND_00(⓪)~④ 명세 기준.
// 실시간 채팅은 fetch 기반 SSE(GET /chat/stream)로 받는다(src/meetings/chatStream.ts). EventSource는 Authorization 헤더를 못 붙인다.
// LiveKit 접속 토큰은 issueLiveKitToken()으로 받고, 실제 음성 연결은 브라우저가 LiveKit에 직접 한다(MeetingDetailScreen의 VideoRoomShell).
import { downloadFile, request } from "./http";
import { ApiError } from "./errors";
import type { OffsetPage, Rfc3339, Uuid } from "./types";

export type MeetingStatus = "SCHEDULED" | "IN_PROGRESS" | "ENDED" | "CANCELED";
export type ParticipationStatus = "ACTIVE" | "REMOVED";
export type RecordAccessState = "GRANTED" | "REVOKED";
export type MinutesStatus = "NOT_STARTED" | "PROCESSING" | "DRAFT" | "APPROVED" | "FAILED";
export type CandidateType = "TASK" | "DECISION";
export type CandidateStatus = "PROPOSED" | "EDITED" | "CONFIRMED" | "REJECTED" | "MATERIALIZATION_PENDING" | "MATERIALIZED" | "MATERIALIZATION_FAILED";
export type PostprocessStatus =
  | "NOT_STARTED" | "WAITING_EVIDENCE_SNAPSHOT" | "WAITING_RECORDING" | "STT_QUEUED" | "STT_PROCESSING" | "STT_READY"
  | "MINUTES_QUEUED" | "MINUTES_PROCESSING" | "MINUTES_DRAFT" | "REVIEWING" | "APPROVED"
  | "AI_EGRESS_BLOCKED" | "SOURCE_EXPIRED" | "MANUAL_RESOLUTION" | "FAILED";
export type MeetingSensitivity = "INTERNAL" | "CONFIDENTIAL" | "PII" | "CORE_TRADE_SECRET";
export type MeetingExternalAiPolicy = "INHERIT" | "ALLOWED" | "BLOCKED";
export type RecoveryReasonClass = string;

export interface MeetingResponse {
  meetingId: Uuid; projectId: Uuid; title: string; description?: string | null; organizerUserId: Uuid; reviewOwnerUserId: Uuid;
  status: MeetingStatus; scheduledStartAt?: Rfc3339 | null; scheduledEndAt?: Rfc3339 | null; startedAt?: Rfc3339 | null; endedAt?: Rfc3339 | null;
  sensitivityClassification: MeetingSensitivity; externalAiPolicy: MeetingExternalAiPolicy; passwordProtected: boolean;
  postprocessStatus: PostprocessStatus; myParticipationStatus?: ParticipationStatus; myRecordAccessState?: RecordAccessState;
  createdAt: Rfc3339; updatedAt: Rfc3339; version: number;
}
// meetingRole: 종료 후 초대된 "열람자"는 VIEWER(프로젝트 멤버십에 묶이지 않는다). 회의 상세에는 내 역할이 없어서 참가자 목록의 내 행으로 알아낸다.
export type MeetingRole = "PARTICIPANT" | "VIEWER";
export interface MeetingParticipantResponse {
  participantId: Uuid; meetingId: Uuid; userId: Uuid; meetingRole?: MeetingRole; displayName?: string | null; participationStatus: ParticipationStatus; recordAccessState: RecordAccessState;
  sourceProjectMembershipId?: Uuid | null; lastProjectMembershipVersion?: number | null; joinedRelationAt: Rfc3339;
  removedAt?: Rfc3339 | null; recordAccessRevokedAt?: Rfc3339 | null; version: number;
}
export interface LiveKitTokenResponse { token: string; expiresAt: Rfc3339; roomName: string; participantIdentity: string }
export interface ChatMessageResponse { messageId: Uuid; meetingId: Uuid; senderUserId: Uuid; text: string; streamSequence: number; sentAt: Rfc3339 }
export interface ChatReplayResponse { items: ChatMessageResponse[]; lastSequence: number; hasMore: boolean }
export interface MeetingMinutesResponse {
  minutesId: Uuid; meetingId: Uuid; status: MinutesStatus; content?: string | null; sourceGeneration: number;
  transcriptArtifactId?: Uuid | null; transcriptGeneration?: number | null; chatFinalSequence?: number | null; evidenceSnapshotId?: Uuid | null;
  generatedAt?: Rfc3339 | null; lastEditedBy?: Uuid | null; lastEditedAt?: Rfc3339 | null; approvedBy?: Uuid | null; approvedAt?: Rfc3339 | null; version: number;
}
export interface MeetingCandidateResponse {
  candidateId: Uuid; meetingId: Uuid; minutesId: Uuid; type: CandidateType; status: CandidateStatus; title: string;
  descriptionOrContent?: string | null; assigneeUserId?: Uuid | null; dueAt?: Rfc3339 | null;
  // null이면 일반 후보. 값이 있으면 AI가 다 확정하지 못한 TASK("검토 필요", 담당자·기한이 비어 있을 수 있다).
  reviewReason?: CandidateReviewReason | null; sourceGeneration: number;
  materializedResourceId?: Uuid | null; failureReasonCode?: string | null; attemptCount: number; createdAt: Rfc3339; updatedAt: Rfc3339; version: number;
}

// ── 커스텀 보고서(회사 양식) · 6유형 결과 — FRONTEND_API_SPEC.md B·C ──
export type CandidateReviewReason = "UNKNOWN_ASSIGNEE" | "AMBIGUOUS_DEADLINE" | "UNKNOWN_STATE" | "AMBIGUOUS_REFERENCE";
export type CustomReportStatus = "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED";
export type TemplateFieldKind = "text" | "long_text" | "list" | "date" | "table" | "choice" | "signature";
export type TemplateFieldSource = "SERVER" | "AI" | "HUMAN";
export type TemplateServerBinding = "MEETING_TITLE" | "MEETING_DATE" | "AUTHOR" | "PARTICIPANTS";
// 양식 분석 실패: TEMPLATE_*, 보고서 실패: CUSTOM_REPORT_FAILED 등. 알 수 없는 코드가 올 수 있어 string으로 둔다.
export type CustomReportFailureCode = string;

// value: text·long_text=string · list=string[] · date=YYYY-MM-DD · table=행 배열(열 이름 키) · choice=options 중 하나 · signature·근거 없음=null
export type ReportFieldValue = string | string[] | Record<string, string>[] | null;
export interface ReportFieldResponse {
  key: string; label: string; kind: TemplateFieldKind; source: TemplateFieldSource;
  columns?: string[] | null; options?: string[] | null; filled: boolean; value?: ReportFieldValue;
}
export interface CustomReportResponse {
  reportId: Uuid; meetingId: Uuid; templateId: Uuid; status: CustomReportStatus; failureCode?: CustomReportFailureCode | null;
  requestedAt: Rfc3339; completedAt?: Rfc3339 | null; fields?: ReportFieldResponse[] | null; version: number;
}
export interface TemplateFieldResponse {
  key: string; label: string; kind: TemplateFieldKind; source: TemplateFieldSource;
  serverBinding?: TemplateServerBinding | null; columns?: string[] | null; options?: string[] | null;
}
export interface TemplateStateResponse {
  meetingId: Uuid; templateId: Uuid; mimeType: string; byteSize: number; analysisStatus: CustomReportStatus;
  failureCode?: CustomReportFailureCode | null; schema?: { fields: TemplateFieldResponse[] } | null; updatedAt: Rfc3339; version: number;
}

export interface SemanticCaseResponse { id: string; label?: string | null }
export interface SemanticInformationResponse {
  id: string; caseId: string; type: string; normalizedText: string; certainty: string; conditionality: string; polarity: string;
  decisionState?: string | null; actionState?: string | null; candidateEligibility?: "ELIGIBLE" | "REVIEW_REQUIRED" | "NOT_ELIGIBLE" | null;
  eligibilityReason?: string | null; evidenceRefs: string[];
}
export interface SemanticAttributeResponse {
  id: string; informationId: string; type: "ASSIGNEE" | "DEADLINE" | "CONDITION" | "CLAIM_SOURCE" | string; rawText: string;
  normalizedValue?: string | null; resolvedRef?: { userId: Uuid } | null;
  certaintyOverride?: string | null; conditionalityOverride?: string | null; polarityOverride?: string | null; evidenceRefs: string[];
}
export interface SemanticRelationResponse { id: string; type: string; fromInformationId: string; toInformationId: string; evidenceRefs: string[] }
export interface SemanticEvidenceResponse {
  id: string; sourceType: string; role: string; locatorType: string; locator: { start: number; end: number } | Record<string, unknown>; quote?: string | null;
}
export interface SemanticCandidateLinkResponse { candidateIndex: number; informationId: string; candidateId?: Uuid | null }
export interface MeetingSemanticResultResponse {
  meetingId: Uuid; minutesId: Uuid; minutesVersion: number; sourceGeneration: number; isCurrent: boolean; semanticSchemaVersion: string;
  limitedContext: boolean; generatedAt: Rfc3339; cases: SemanticCaseResponse[]; informations: SemanticInformationResponse[];
  attributes: SemanticAttributeResponse[]; relations: SemanticRelationResponse[]; evidences: SemanticEvidenceResponse[];
  candidateLinks: SemanticCandidateLinkResponse[];
}
export interface MeetingPostprocessResponse {
  meetingId: Uuid; status: PostprocessStatus; sourceGeneration: number; recordingGeneration?: number | null;
  transcriptPurgeStatus?: string | null; rawChatPurgeStatus?: string | null; recordingPurgeStatus?: string | null;
  rawHardDeleteAt?: Rfc3339 | null; failureCode?: string | null; updatedAt: Rfc3339; version: number;
}
export interface MeetingEndResponse { meeting: MeetingResponse; endOperationId: Uuid; evidenceSnapshotId: Uuid; postprocess: MeetingPostprocessResponse | null }
// recoveryReasonClass: END_OPERATION_STUCK(종료 처리가 멈춤) · STUCK_IN_PROGRESS(진행 중인 채 12시간 넘음) · REVIEW_OWNER_UNAVAILABLE(검토 담당자 부재)
export interface MeetingRecoverySummary {
  meetingId: Uuid; projectId: Uuid; status: MeetingStatus; organizerUserId: Uuid; reviewOwnerUserId: Uuid; recoveryReasonClass: RecoveryReasonClass; endOperationState?: string | null;
  timestamps?: { startedAt?: Rfc3339 | null; endedAt?: Rfc3339 | null; updatedAt?: Rfc3339 | null } | null;
}
export interface MeetingSettingsResponse { defaultSensitivityClassification: MeetingSensitivity; updatedByUserId?: Uuid | null; updatedAt?: Rfc3339 | null; version: number }

const auth = { auth: "bearer" } as const;

// ── Meeting lifecycle ───────────────────────────────────────────
export const listMeetings = (q: { projectId?: Uuid; status?: MeetingStatus; from?: Rfc3339; to?: Rfc3339; offset?: number; limit?: number } = {}) =>
  request<OffsetPage<MeetingResponse>>({ method: "GET", path: "/api/meetings", query: q, ...auth });
// 주최자·검토 담당자는 항상 요청한 사람이라 지정 필드가 없다(보내면 400 NOT_ALLOWED). sensitivityClassification을 생략하면 회사 기본값이 적용된다.
// idempotencyKey: 같은 내용으로 "다시 시도"할 때 같은 키를 넘기면 회의가 하나 더 생기지 않는다. "새 회의를 하나 더"는 키를 넘기지 않는다(새 키).
export const createMeeting = (
  b: { projectId: Uuid; title: string; description?: string | null; scheduledStartAt?: Rfc3339 | null; scheduledEndAt?: Rfc3339 | null; participantUserIds?: Uuid[]; viewerUserIds?: Uuid[]; password?: string | null; sensitivityClassification?: MeetingSensitivity; externalAiPolicy?: MeetingExternalAiPolicy },
  idempotencyKey?: string,
) => request<MeetingResponse>({ method: "POST", path: "/api/meetings", body: b, ...auth, idempotent: true, idempotencyKey });
export const getMeeting = (meetingId: Uuid) => request<MeetingResponse>({ method: "GET", path: `/api/meetings/${meetingId}`, ...auth });
export const updateMeeting = (meetingId: Uuid, b: { title?: string; description?: string | null; scheduledStartAt?: Rfc3339 | null; scheduledEndAt?: Rfc3339 | null; sensitivityClassification?: MeetingSensitivity; externalAiPolicy?: MeetingExternalAiPolicy; version: number }) =>
  request<MeetingResponse>({ method: "PUT", path: `/api/meetings/${meetingId}`, body: b, ...auth });
// start의 password 필드는 서버가 쓰지 않는다(14-1 #13). 비밀번호는 접속 토큰을 받을 때 입력한다.
export const startMeeting = (meetingId: Uuid, b: { version: number }) =>
  request<MeetingResponse>({ method: "POST", path: `/api/meetings/${meetingId}/start`, body: { version: b.version }, ...auth, idempotent: true });
export const endMeeting = (meetingId: Uuid) =>
  request<MeetingEndResponse>({ method: "POST", path: `/api/meetings/${meetingId}/end`, body: {}, ...auth, idempotent: true });
export const cancelMeeting = (meetingId: Uuid, b: { reason?: string; version: number }) =>
  request<MeetingResponse>({ method: "POST", path: `/api/meetings/${meetingId}/cancel`, body: b, ...auth, idempotent: true });
export const transferMeetingOrganizer = (meetingId: Uuid, b: { targetUserId: Uuid; version: number }) =>
  request<MeetingResponse>({ method: "PUT", path: `/api/meetings/${meetingId}/organizer`, body: b, ...auth });

// ── Participants ─────────────────────────────────────────────────
export const listMeetingParticipants = (meetingId: Uuid, q: { participationStatus?: ParticipationStatus; recordAccessState?: RecordAccessState; offset?: number; limit?: number } = {}) =>
  request<OffsetPage<MeetingParticipantResponse>>({ method: "GET", path: `/api/meetings/${meetingId}/participants`, query: q, ...auth });
// role을 안 보내면 서버가 PARTICIPANT로 처리한다 — 종료 후에는 409이므로 열람자는 반드시 "VIEWER"를 명시한다.
// 회수된 열람자를 같은 요청으로 다시 초대하면 같은 행이 다시 활성화된다(version 증가).
export const addMeetingParticipant = (meetingId: Uuid, userId: Uuid, role?: MeetingRole) =>
  request<MeetingParticipantResponse>({ method: "POST", path: `/api/meetings/${meetingId}/participants`, body: role ? { userId, role } : { userId }, ...auth, idempotent: true });
export const removeMeetingParticipant = (meetingId: Uuid, userId: Uuid) =>
  request({ method: "DELETE", path: `/api/meetings/${meetingId}/participants/${userId}`, ...auth });
export const updateMeetingRecordAccess = (meetingId: Uuid, userId: Uuid, b: { state: RecordAccessState; reason: string; version: number }) =>
  request<MeetingParticipantResponse>({ method: "PUT", path: `/api/meetings/${meetingId}/participants/${userId}/record-access`, body: b, ...auth });

// ── Password ─────────────────────────────────────────────────────
export const setMeetingPassword = (meetingId: Uuid, b: { password: string; version: number }) =>
  request({ method: "PUT", path: `/api/meetings/${meetingId}/password`, body: b, ...auth });
export const removeMeetingPassword = (meetingId: Uuid) =>
  request({ method: "DELETE", path: `/api/meetings/${meetingId}/password`, ...auth });

// ── LiveKit ──────────────────────────────────────────────────────
// 토큰은 방에 들어가는 순간에만 필요하고 수명은 5분이다. 끊겼다 다시 접속할 때는 새로 받는다.
// 비밀번호가 있는 회의에서 주최자가 아니면 password가 필수다. 본문 자체는 {}라도 반드시 보낸다.
export const issueLiveKitToken = (meetingId: Uuid, password?: string) =>
  request<LiveKitTokenResponse>({ method: "POST", path: `/api/meetings/${meetingId}/livekit-token`, body: password ? { password } : {}, ...auth });

// ── Chat ─────────────────────────────────────────────────────────
// 진행 중인 회의에서만 쓸 수 있다(끝나면 409 MEETING_CHAT_CLOSED). 실시간 수신은 chatStream.ts의 SSE.
export const listChatMessages = (meetingId: Uuid, q: { afterSequence?: number; limit?: number } = {}) =>
  request<ChatReplayResponse>({ method: "GET", path: `/api/meetings/${meetingId}/chat/messages`, query: q, ...auth });
// clientMessageId는 재시도 중복 방지 키다. 메시지마다 새 UUID를 만들고, 응답을 못 받았을 때만 같은 값으로 재전송한다.
// Idempotency-Key 헤더는 선택이라 보내지 않는다.
export const sendChatMessage = (meetingId: Uuid, text: string, clientMessageId: Uuid = crypto.randomUUID()) =>
  request<ChatMessageResponse>({ method: "POST", path: `/api/meetings/${meetingId}/chat/messages`, body: { text, clientMessageId }, ...auth });

// ── Minutes ──────────────────────────────────────────────────────
export const getMeetingMinutes = (meetingId: Uuid) => request<MeetingMinutesResponse>({ method: "GET", path: `/api/meetings/${meetingId}/minutes`, ...auth });
export const updateMeetingMinutes = (meetingId: Uuid, b: { content: string; version: number }) =>
  request<MeetingMinutesResponse>({ method: "PUT", path: `/api/meetings/${meetingId}/minutes`, body: b, ...auth });
export const approveMeetingMinutes = (meetingId: Uuid, version: number) =>
  request<MeetingMinutesResponse>({ method: "POST", path: `/api/meetings/${meetingId}/minutes/approve`, body: { version }, ...auth, idempotent: true });
export const regenerateMeetingMinutes = (meetingId: Uuid, reason?: string) =>
  request<MeetingPostprocessResponse>({ method: "POST", path: `/api/meetings/${meetingId}/minutes/regenerate`, body: { reason }, ...auth, idempotent: true });

// ── AI Candidates ────────────────────────────────────────────────
export const listMeetingCandidates = (meetingId: Uuid, q: { type?: CandidateType; status?: CandidateStatus; offset?: number; limit?: number } = {}) =>
  request<OffsetPage<MeetingCandidateResponse>>({ method: "GET", path: `/api/meetings/${meetingId}/candidates`, query: q, ...auth });
export const updateMeetingCandidate = (meetingId: Uuid, candidateId: Uuid, b: { title: string; descriptionOrContent?: string | null; assigneeUserId?: Uuid | null; dueAt?: Rfc3339 | null; version: number }) =>
  request<MeetingCandidateResponse>({ method: "PUT", path: `/api/meetings/${meetingId}/candidates/${candidateId}`, body: b, ...auth });
export const confirmMeetingCandidate = (meetingId: Uuid, candidateId: Uuid, version: number) =>
  request<MeetingCandidateResponse>({ method: "POST", path: `/api/meetings/${meetingId}/candidates/${candidateId}/confirm`, body: { version }, ...auth, idempotent: true });
export const rejectMeetingCandidate = (meetingId: Uuid, candidateId: Uuid, b: { reason?: string; version: number }) =>
  request<MeetingCandidateResponse>({ method: "POST", path: `/api/meetings/${meetingId}/candidates/${candidateId}/reject`, body: b, ...auth, idempotent: true });
export const materializeMeetingCandidate = (meetingId: Uuid, candidateId: Uuid, version: number) =>
  request<MeetingCandidateResponse>({ method: "POST", path: `/api/meetings/${meetingId}/candidates/${candidateId}/materialize`, body: { version }, ...auth, idempotent: true });

// 전사문(STT 원문): 음성 인식이 글로 옮긴 그대로의 문장. 서버가 TRANSCRIPT_VIEW_ENABLED를 켠 경우에만 있고(꺼져 있으면 404 ROUTE_NOT_FOUND),
// 원본 녹음을 받을 수 있는 사람(참여자 — 열람 전용 제외 — 와 프로젝트 MANAGER)만 읽는다(그 밖은 403 TRANSCRIPT_FORBIDDEN).
// 화자는 확정하지 않는다: 문장마다 중립 라벨(음성 트랙 N)과 그 트랙을 올린 사람(trackPublisherUserId)만 있고, speakerIdentity는 항상 "TRACK_ONLY"다.
// 오류: 409 TRANSCRIPT_NOT_READY(음성 인식 전)·SOURCE_EXPIRED(보관 기한 지남)·MEETING_NOT_ENDED, 404 TRANSCRIPT_NOT_FOUND, 503 TRANSCRIPT_SOURCE_UNAVAILABLE.
export interface TranscriptSegmentResponse {
  sequence: number; text: string; speakerLabel?: string | null; trackPublisherUserId?: Uuid | null; speakerBasis?: string | null;
  startMs?: number | null; endMs?: number | null; timePrecision?: string | null;
}
export interface MeetingTranscriptResponse {
  meetingId: Uuid; transcriptId: Uuid; language?: string | null; recordingCompleteness?: string | null; createdAt?: Rfc3339 | null;
  speakerIdentity: "TRACK_ONLY"; segments: TranscriptSegmentResponse[];
}
export const getMeetingTranscript = (meetingId: Uuid) =>
  request<MeetingTranscriptResponse>({ method: "GET", path: `/api/meetings/${meetingId}/transcript`, ...auth });

// 6유형 결과: 없으면 data:null. 근거 인용문을 포함하므로 화면에는 일반 텍스트로만 출력한다.
export const getMeetingSemanticResult = (meetingId: Uuid) =>
  request<MeetingSemanticResultResponse | null>({ method: "GET", path: `/api/meetings/${meetingId}/semantic-result`, ...auth });

// ── Report (검토 담당자 전용) ────────────────────────────────────
// 본문은 { hasTemplate, meetingDate }뿐이다. 담당자·참석자 이름은 서버가 채우므로 author/participants를 보내면 400 NOT_ALLOWED다.
// hasTemplate:false(③ 기본 보고서) → 202 + 이미 SUCCEEDED인 완성본, 폴링하지 않는다. 회의록(DRAFT/APPROVED)이 있어야 하고 AI를 부르지 않는다.
// hasTemplate:true(④ 회사 양식 보고서) → 202 + PENDING. getMeetingCustomReport()를 3~5초 간격으로 폴링한다. 양식 파일은 uploadMeetingMinutesTemplate()로 먼저 올린다.
// 보고서는 요청한 시점의 복사본이다. 후보를 확정·수정하거나 회의록을 고친 뒤에는 새 Idempotency-Key로 다시 요청해야 반영된다(request()가 호출마다 새 키를 만든다).
// includeFollowUpActions(F08 실행 항목, 안 보내면 true)·includeNextSteps(F10 후속 조치, 안 보내면 false)는 기본 보고서(hasTemplate:false) 전용이다.
// 회사 양식과 같이 보내면 서버가 400 NOT_ALLOWED이므로 hasTemplate:true일 때는 본문에 넣지 않는다.
export interface CustomReportRequestBody { hasTemplate: boolean; meetingDate: string; includeFollowUpActions?: boolean; includeNextSteps?: boolean }
export const customReportBody = (b: CustomReportRequestBody) => ({
  hasTemplate: b.hasTemplate, meetingDate: b.meetingDate,
  ...(!b.hasTemplate && b.includeFollowUpActions !== undefined ? { includeFollowUpActions: b.includeFollowUpActions } : {}),
  ...(!b.hasTemplate && b.includeNextSteps !== undefined ? { includeNextSteps: b.includeNextSteps } : {}),
});
export const requestMeetingCustomReport = (meetingId: Uuid, b: CustomReportRequestBody) =>
  request<CustomReportResponse | null>({ method: "POST", path: `/api/meetings/${meetingId}/custom-report`, body: customReportBody(b), ...auth, idempotent: true });
export const getMeetingCustomReport = (meetingId: Uuid) =>
  request<CustomReportResponse | null>({ method: "GET", path: `/api/meetings/${meetingId}/custom-report`, ...auth });
export const getMeetingTemplate = (meetingId: Uuid) =>
  request<TemplateStateResponse | null>({ method: "GET", path: `/api/meetings/${meetingId}/template`, ...auth });

// 양식 위에 보고서 값을 채운 파일(올린 양식과 같은 종류: PDF 양식→PDF, Word 양식→Word). 보고서 status가 SUCCEEDED일 때만 부른다.
// Authorization 헤더가 필요해 링크(<a href>)로는 못 받는다 → fetch로 받아 Blob으로 저장한다. 서버는 파일을 저장하지 않고 요청마다 만든다.
// PDF는 못 넣은 값(x-report-pdf-unplaced)·칸보다 길어 잘린 값(x-report-pdf-cut)이 있어도 200으로 주므로 개수를 함께 돌려준다.
// Word는 값 하나라도 못 넣으면 파일 없이 422 REPORT_FORM_UNREADABLE이다. PNG·JPG 양식은 409 REPORT_FORM_NOT_PDF.
export async function downloadCustomReportFile(meetingId: Uuid): Promise<{ blob: Blob; filename: string; unplaced: number; cut: number }> {
  const r = await downloadFile(`/api/meetings/${meetingId}/custom-report/file`);
  const n = (h: string) => { const v = Number(r.headers.get(h)); return Number.isFinite(v) && v > 0 ? v : 0; };
  return { blob: r.blob, filename: r.filename, unplaced: n("x-report-pdf-unplaced"), cut: n("x-report-pdf-cut") };
}

// ── 원본 녹음 합본(MP3) — FRONTEND_03 ────────────────────────────
// 사람별 녹음을 회의 시간에 맞춰 하나로 합친 MP3. 서버에 저장하지 않고 누를 때마다 만든다(느릴 수 있어 취소 가능해야 한다).
// 서버 스위치가 꺼져 있으면 두 경로 모두 404 ROUTE_NOT_FOUND → 버튼을 그리지 않는다. 프로젝트 멤버가 아닌 열람자·무관한 사람은 403 RECORDING_DOWNLOAD_FORBIDDEN.
// 응답에는 화자 수·크기·길이·삭제 시각이 없다(일부러) — 화면에도 보여 주지 않는다.
export type RecordingAvailabilityState = "READY" | "NOT_READY" | "UNAVAILABLE";
export type RecordingReasonCode = "RECORDING_NOT_READY" | "RECORDING_UNAVAILABLE" | "RECORDING_DOWNLOAD_TOO_LARGE";
export interface RecordingAvailabilityResponse { state: RecordingAvailabilityState; reasonCode?: RecordingReasonCode | null; mediaType?: string | null; fileExtension?: string | null }
export const getRecordingAvailability = (meetingId: Uuid) =>
  request<RecordingAvailabilityResponse>({ method: "GET", path: `/api/meetings/${meetingId}/recording-download/availability`, ...auth });

/** 합본을 받는다. 사용자가 버튼을 눌렀을 때만 부른다(자동 호출 금지). 성공은 audio/* + 받은 바이트 수가 Content-Length와 같을 때만. */
export async function downloadRecording(meetingId: Uuid, signal?: AbortSignal): Promise<{ blob: Blob; filename: string }> {
  const r = await downloadFile(`/api/meetings/${meetingId}/recording/download`, false, signal);
  // 200인데 오디오가 아니면(JSON 오류 본문 등) 파일로 저장하지 않는다.
  if (!(r.headers.get("content-type") ?? "").toLowerCase().startsWith("audio/")) throw new ApiError(500, "RECORDING_DOWNLOAD_FAILED", "오디오 파일이 아닙니다.");
  // 전송 도중 삭제가 시작되면 연결이 중간에 끊긴다 — 받은 바이트 수가 Content-Length보다 작으면 실패다.
  const len = Number(r.headers.get("content-length"));
  if (Number.isFinite(len) && len > 0 && r.blob.size !== len) throw new ApiError(0, "RECORDING_DOWNLOAD_INCOMPLETE", "받은 파일이 끝까지 오지 않았습니다.");
  return { blob: r.blob, filename: r.filename.replace(/^download$/, "meeting-recording.mp3") };
}

// ── Postprocess ──────────────────────────────────────────────────
export const getMeetingPostprocess = (meetingId: Uuid) => request<MeetingPostprocessResponse>({ method: "GET", path: `/api/meetings/${meetingId}/postprocess`, ...auth });
export const retryMeetingPostprocess = (meetingId: Uuid, b: { stage?: "STT" | "MINUTES" | "CANDIDATES"; reason?: string } = {}) =>
  request<MeetingPostprocessResponse>({ method: "POST", path: `/api/meetings/${meetingId}/postprocess/retry`, body: b, ...auth, idempotent: true });

// ── Admin / Manager recovery (화면 미구현 — API만) ───────────────
export const listMeetingRecoveryQueue = (q: { type?: "FORCE_END" | "REVIEW_OWNER"; offset?: number; limit?: number } = {}) =>
  request<OffsetPage<MeetingRecoverySummary>>({ method: "GET", path: "/api/admin/meetings/recovery", query: q, ...auth });
export const adminForceEndMeeting = (meetingId: Uuid, reason: string) =>
  request<MeetingEndResponse>({ method: "POST", path: `/api/admin/meetings/${meetingId}/force-end`, body: { reason }, ...auth, idempotent: true });
export const forceEndMeeting = (meetingId: Uuid, reason: string) =>
  request<MeetingEndResponse>({ method: "POST", path: `/api/meetings/${meetingId}/force-end`, body: { reason }, ...auth, idempotent: true });
export const adminReviewOwnerRecovery = (meetingId: Uuid, b: { targetUserId: Uuid; reason: string }) =>
  request<MeetingResponse>({ method: "POST", path: `/api/admin/meetings/${meetingId}/review-owner-recovery`, body: b, ...auth, idempotent: true });
export const reviewOwnerRecovery = (meetingId: Uuid, b: { targetUserId: Uuid; reason: string }) =>
  request<MeetingResponse>({ method: "POST", path: `/api/meetings/${meetingId}/review-owner-recovery`, body: b, ...auth, idempotent: true });

// ── Admin: company meeting settings ─────────────────────────────
export const getMeetingSettings = () => request<MeetingSettingsResponse>({ method: "GET", path: "/api/admin/meeting-settings", ...auth });
export const updateMeetingSettings = (b: { defaultSensitivityClassification: MeetingSensitivity; version: number }) =>
  request<MeetingSettingsResponse>({ method: "PUT", path: "/api/admin/meeting-settings", body: b, ...auth });
