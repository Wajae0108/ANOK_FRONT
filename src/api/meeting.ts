// Anok_04_Meeting_API_Event_Spec_v2_3_4_FINAL — Public API 36개.
// 실시간 Chat은 명세상 fetch-streaming SSE(MTG-API-18)이지만, 이 프론트는 대체로 MTG-API-16(replay)을 짧은 간격으로 폴링해 구현한다(§하단 주석 참고).
// LiveKit은 self-hosted 실시간 미디어 인프라라 이 프론트 범위 밖 — issueLiveKitToken()은 서버의 입장 권한 검증까지만 재현하고 실제 WebRTC 연결은 하지 않는다.
import { request } from "./http";
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
export interface MeetingParticipantResponse {
  participantId: Uuid; meetingId: Uuid; userId: Uuid; participationStatus: ParticipationStatus; recordAccessState: RecordAccessState;
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
  descriptionOrContent?: string | null; assigneeUserId?: Uuid | null; dueAt?: Rfc3339 | null; sourceGeneration: number;
  materializedResourceId?: Uuid | null; failureReasonCode?: string | null; attemptCount: number; createdAt: Rfc3339; updatedAt: Rfc3339; version: number;
}
export interface MeetingPostprocessResponse {
  meetingId: Uuid; status: PostprocessStatus; sourceGeneration: number; recordingGeneration?: number | null;
  transcriptPurgeStatus?: string | null; rawChatPurgeStatus?: string | null; recordingPurgeStatus?: string | null;
  rawHardDeleteAt?: Rfc3339 | null; failureCode?: string | null; updatedAt: Rfc3339; version: number;
}
export interface MeetingEndResponse { meeting: MeetingResponse; endOperationId: Uuid; evidenceSnapshotId: Uuid; postprocess: MeetingPostprocessResponse }
export interface MeetingRecoverySummary { meetingId: Uuid; projectId: Uuid; status: MeetingStatus; organizerUserId: Uuid; reviewOwnerUserId: Uuid; recoveryReasonClass: RecoveryReasonClass; endOperationState?: string | null }
export interface MeetingSettingsResponse { defaultSensitivityClassification: MeetingSensitivity; updatedByUserId?: Uuid | null; updatedAt?: Rfc3339 | null; version: number }

const auth = { auth: "bearer" } as const;

// ── Meeting lifecycle ───────────────────────────────────────────
export const listMeetings = (q: { projectId?: Uuid; status?: MeetingStatus; from?: Rfc3339; to?: Rfc3339; offset?: number; limit?: number } = {}) =>
  request<OffsetPage<MeetingResponse>>({ method: "GET", path: "/api/meetings", query: q, ...auth });
export const createMeeting = (b: { projectId: Uuid; title: string; description?: string; scheduledStartAt?: Rfc3339; scheduledEndAt?: Rfc3339; participantUserIds?: Uuid[]; password?: string; sensitivityClassification?: MeetingSensitivity; externalAiPolicy?: MeetingExternalAiPolicy }) =>
  request<MeetingResponse>({ method: "POST", path: "/api/meetings", body: b, ...auth, idempotent: true });
export const getMeeting = (meetingId: Uuid) => request<MeetingResponse>({ method: "GET", path: `/api/meetings/${meetingId}`, ...auth });
export const updateMeeting = (meetingId: Uuid, b: { title?: string; description?: string | null; scheduledStartAt?: Rfc3339 | null; scheduledEndAt?: Rfc3339 | null; sensitivityClassification?: MeetingSensitivity; externalAiPolicy?: MeetingExternalAiPolicy; version: number }) =>
  request<MeetingResponse>({ method: "PUT", path: `/api/meetings/${meetingId}`, body: b, ...auth });
export const startMeeting = (meetingId: Uuid, b: { version: number; password?: string }) =>
  request<MeetingResponse>({ method: "POST", path: `/api/meetings/${meetingId}/start`, body: b, ...auth, idempotent: true });
export const endMeeting = (meetingId: Uuid) =>
  request<MeetingEndResponse>({ method: "POST", path: `/api/meetings/${meetingId}/end`, body: {}, ...auth, idempotent: true });
export const cancelMeeting = (meetingId: Uuid, b: { reason?: string; version: number }) =>
  request<MeetingResponse>({ method: "POST", path: `/api/meetings/${meetingId}/cancel`, body: b, ...auth, idempotent: true });
export const transferMeetingOrganizer = (meetingId: Uuid, b: { targetUserId: Uuid; version: number }) =>
  request<MeetingResponse>({ method: "PUT", path: `/api/meetings/${meetingId}/organizer`, body: b, ...auth });

// ── Participants ─────────────────────────────────────────────────
export const listMeetingParticipants = (meetingId: Uuid, q: { participationStatus?: ParticipationStatus; recordAccessState?: RecordAccessState; offset?: number; limit?: number } = {}) =>
  request<OffsetPage<MeetingParticipantResponse>>({ method: "GET", path: `/api/meetings/${meetingId}/participants`, query: q, ...auth });
export const addMeetingParticipant = (meetingId: Uuid, userId: Uuid) =>
  request<MeetingParticipantResponse>({ method: "POST", path: `/api/meetings/${meetingId}/participants`, body: { userId }, ...auth, idempotent: true });
export const removeMeetingParticipant = (meetingId: Uuid, userId: Uuid) =>
  request({ method: "DELETE", path: `/api/meetings/${meetingId}/participants/${userId}`, ...auth });
export const updateMeetingRecordAccess = (meetingId: Uuid, userId: Uuid, b: { state: RecordAccessState; reason: string; version: number }) =>
  request<MeetingParticipantResponse>({ method: "PUT", path: `/api/meetings/${meetingId}/participants/${userId}/record-access`, body: b, ...auth });

// ── Password ─────────────────────────────────────────────────────
export const setMeetingPassword = (meetingId: Uuid, b: { password: string; version: number }) =>
  request({ method: "PUT", path: `/api/meetings/${meetingId}/password`, body: b, ...auth });
export const removeMeetingPassword = (meetingId: Uuid) =>
  request({ method: "DELETE", path: `/api/meetings/${meetingId}/password`, ...auth });

// ── LiveKit (권한 검증만 재현, 실 미디어 연결 없음) ──────────────
export const issueLiveKitToken = (meetingId: Uuid, password?: string) =>
  request<LiveKitTokenResponse>({ method: "POST", path: `/api/meetings/${meetingId}/livekit-token`, body: { password }, ...auth });

// ── Chat (실시간 SSE 대신 replay 폴링으로 대체) ──────────────────
export const listChatMessages = (meetingId: Uuid, q: { afterSequence?: number; limit?: number } = {}) =>
  request<ChatReplayResponse>({ method: "GET", path: `/api/meetings/${meetingId}/chat/messages`, query: q, ...auth });
export const sendChatMessage = (meetingId: Uuid, text: string, clientMessageId?: Uuid) =>
  request<ChatMessageResponse>({ method: "POST", path: `/api/meetings/${meetingId}/chat/messages`, body: { text, clientMessageId }, ...auth, idempotent: true });

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
