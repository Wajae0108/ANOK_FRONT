// Anok_03_Document_File_API_Event_Spec_v2_3_3_FINAL — Public API 27개
// `permissionSource`는 명세에 exact enum이 없어 권한 §3(Permission Resolution)의 출처 4가지로 가정했다. 백엔드 확정 후 좁힐 것.
import { downloadFile, request } from "./http";
import type { OffsetPage, Rfc3339, Uuid } from "./types";

export type DocumentStatus = "ACTIVE" | "ARCHIVED";
export type OwnerAccessState = "ACTIVE" | "SUSPENDED_BY_IDENTITY";
export type AclPermission = "EDITOR" | "VIEWER" | "DENY";
export type AclStatus = "ACTIVE" | "SUSPENDED_BY_IDENTITY" | "REVOKED";
export type DocumentProcessingStatus = "NOT_REQUESTED" | "QUEUED" | "PARSING" | "PARSED" | "EMBEDDING" | "READY" | "BLOCKED_BY_POLICY" | "FAILED" | "STALE";
export type ExternalAiPolicy = "INHERIT" | "ALLOWED" | "BLOCKED";
export type SensitivityClassification = "INTERNAL" | "CONFIDENTIAL" | "PII" | "CORE_TRADE_SECRET";
export type EffectivePermission = "OWNER" | "EDITOR" | "VIEWER";
export type PermissionSource = "OWNER" | "EXPLICIT_ACL" | "PROJECT_INHERITED" | "MEETING_INHERITED";
export type OwnerRecoveryType = "RESTORE_OWNER_ACCESS" | "TRANSFER_OWNERSHIP";
export type OwnerRecoveryReasonCode = "OWNER_REACTIVATED" | "OWNER_UNAVAILABLE" | "EMPLOYMENT_CHANGE" | "SECURITY_RECOVERY" | "OTHER";

export interface DocumentVersionSummary { versionId: Uuid; versionNo: number; originalFilename: string; sizeBytes: number; detectedMimeType: string; createdAt: Rfc3339 }
export interface DocumentResponse {
  documentId: Uuid; title: string; description?: string | null; ownerUserId: Uuid; ownerAccessState: OwnerAccessState; status: DocumentStatus;
  currentVersion: DocumentVersionSummary; externalAiPolicy: ExternalAiPolicy; sensitivityClassification: SensitivityClassification;
  processingStatus: DocumentProcessingStatus; effectivePermission: EffectivePermission; permissionSource: PermissionSource;
  createdByUserId: Uuid; createdAt: Rfc3339; updatedAt: Rfc3339; archivedAt?: Rfc3339 | null; version: number;
}
export interface DocumentVersionResponse {
  versionId: Uuid; documentId: Uuid; versionNo: number; originalFilename: string; sizeBytes: number; detectedMimeType: string;
  sha256: string; uploadedByUserId: Uuid; createdAt: Rfc3339; isCurrent: boolean;
}
export interface DocumentPermissionResponse { userId: Uuid; permission: AclPermission; status: AclStatus; createdByUserId: Uuid; createdAt: Rfc3339; updatedAt: Rfc3339; version: number }
export interface DocumentProjectAttachmentResponse { attachmentId: Uuid; documentId: Uuid; projectId: Uuid; createdAt: Rfc3339 }
export interface MeetingAttachmentResponse {
  attachmentId: Uuid; meetingId: Uuid; documentId: Uuid; title: string; ownerUserId: Uuid; currentVersionId: Uuid;
  originalFilename: string; sizeBytes: number; detectedMimeType: string; effectivePermission: EffectivePermission; createdAt: Rfc3339;
}
export interface DocumentProcessingResponse {
  documentId: Uuid; documentVersionId: Uuid; status: DocumentProcessingStatus; processingGeneration: number;
  failureCode?: string | null; blockCode?: string | null; updatedAt: Rfc3339; version: number;
}
export interface DocumentOwnerRecoveryItemResponse { documentId: Uuid; ownerUserId: Uuid; ownerAccessState: OwnerAccessState; documentStatus: DocumentStatus; createdAt: Rfc3339; updatedAt: Rfc3339; version: number }
export interface DocumentOwnerRecoveryResponse { documentId: Uuid; ownerUserId: Uuid; ownerAccessState: OwnerAccessState; recoveryType: OwnerRecoveryType; recoveredAt: Rfc3339; version: number }

const auth = { auth: "bearer" } as const;

function uploadForm(file: File, fields: Record<string, string | undefined>): FormData {
  const fd = new FormData();
  fd.append("file", file);
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) fd.append(k, v);
  return fd;
}

// ── Documents ────────────────────────────────────────────────────
export const listDocuments = (q: { status?: DocumentStatus; q?: string; offset?: number; limit?: number } = {}) =>
  request<OffsetPage<DocumentResponse>>({ method: "GET", path: "/api/documents", query: q, ...auth });

export const uploadDocument = (file: File, fields: { title: string; description?: string; externalAiPolicy?: ExternalAiPolicy; sensitivityClassification?: SensitivityClassification }) =>
  request<DocumentResponse>({ method: "POST", path: "/api/documents", body: uploadForm(file, fields), ...auth, idempotent: true });

export const getDocument = (documentId: Uuid) =>
  request<DocumentResponse>({ method: "GET", path: `/api/documents/${documentId}`, ...auth });

export const updateDocument = (documentId: Uuid, b: { title: string; description?: string; sensitivityClassification: SensitivityClassification; version: number }) =>
  request<DocumentResponse>({ method: "PUT", path: `/api/documents/${documentId}`, body: b, ...auth });

export const archiveDocument = (documentId: Uuid, version: number) =>
  request<DocumentResponse>({ method: "POST", path: `/api/documents/${documentId}/archive`, body: { version }, ...auth, idempotent: true });

export const updateDocumentAiPolicy = (documentId: Uuid, b: { externalAiPolicy: ExternalAiPolicy; version: number }) =>
  request<DocumentResponse>({ method: "PUT", path: `/api/documents/${documentId}/ai-policy`, body: b, ...auth });

export const transferDocumentOwner = (documentId: Uuid, b: { targetUserId: Uuid; version: number }) =>
  request<DocumentResponse>({ method: "PUT", path: `/api/documents/${documentId}/owner`, body: b, ...auth });

// ── Versions ─────────────────────────────────────────────────────
export const listDocumentVersions = (documentId: Uuid, q: { offset?: number; limit?: number } = {}) =>
  request<OffsetPage<DocumentVersionResponse>>({ method: "GET", path: `/api/documents/${documentId}/versions`, query: q, ...auth });

export const uploadDocumentVersion = (documentId: Uuid, file: File, expectedDocumentVersion: number) =>
  request<DocumentVersionResponse>({ method: "POST", path: `/api/documents/${documentId}/versions`, body: uploadForm(file, { expectedDocumentVersion: String(expectedDocumentVersion) }), ...auth, idempotent: true });

export const getDocumentVersion = (documentId: Uuid, versionId: Uuid) =>
  request<DocumentVersionResponse>({ method: "GET", path: `/api/documents/${documentId}/versions/${versionId}`, ...auth });

export const downloadCurrentVersion = (documentId: Uuid) => downloadFile(`/api/documents/${documentId}/download`);
export const downloadVersion = (documentId: Uuid, versionId: Uuid) => downloadFile(`/api/documents/${documentId}/versions/${versionId}/download`);

// ── ACL ──────────────────────────────────────────────────────────
export const listDocumentPermissions = (documentId: Uuid, q: { status?: AclStatus; offset?: number; limit?: number } = {}) =>
  request<OffsetPage<DocumentPermissionResponse>>({ method: "GET", path: `/api/documents/${documentId}/permissions`, query: q, ...auth });

export const replaceDocumentPermissions = (documentId: Uuid, b: { expectedDocumentVersion: number; permissions: { userId: Uuid; permission: AclPermission }[] }) =>
  request<DocumentPermissionResponse[]>({ method: "PUT", path: `/api/documents/${documentId}/permissions`, body: b, ...auth });

export const upsertDocumentPermission = (documentId: Uuid, userId: Uuid, b: { permission: AclPermission; expectedDocumentVersion: number }) =>
  request<DocumentPermissionResponse>({ method: "PUT", path: `/api/documents/${documentId}/permissions/${userId}`, body: b, ...auth });

export const revokeDocumentPermission = (documentId: Uuid, userId: Uuid) =>
  request({ method: "DELETE", path: `/api/documents/${documentId}/permissions/${userId}`, ...auth });

// ── Project attachment ──────────────────────────────────────────
export const attachDocumentToProject = (documentId: Uuid, projectId: Uuid) =>
  request<DocumentProjectAttachmentResponse>({ method: "POST", path: `/api/documents/${documentId}/project-attachments`, body: { projectId }, ...auth, idempotent: true });

export const detachDocumentFromProject = (documentId: Uuid, projectId: Uuid) =>
  request({ method: "DELETE", path: `/api/documents/${documentId}/project-attachments/${projectId}`, ...auth });

// ── Meeting attachment (MeetingDetailScreen의 "자료" 탭에서 사용) ──
export const listMeetingAttachments = (meetingId: Uuid, q: { offset?: number; limit?: number } = {}) =>
  request<OffsetPage<MeetingAttachmentResponse>>({ method: "GET", path: `/api/meetings/${meetingId}/attachments`, query: q, ...auth });

export const uploadMeetingAttachment = (meetingId: Uuid, file: File, fields: { title: string; description?: string; externalAiPolicy?: ExternalAiPolicy; sensitivityClassification?: SensitivityClassification }) =>
  request<MeetingAttachmentResponse>({ method: "POST", path: `/api/meetings/${meetingId}/attachments`, body: uploadForm(file, fields), ...auth, idempotent: true });

export const attachExistingDocumentToMeeting = (meetingId: Uuid, documentId: Uuid) =>
  request<MeetingAttachmentResponse>({ method: "PUT", path: `/api/meetings/${meetingId}/attachments/${documentId}`, body: {}, ...auth });

export const detachMeetingAttachment = (meetingId: Uuid, documentId: Uuid) =>
  request({ method: "DELETE", path: `/api/meetings/${meetingId}/attachments/${documentId}`, ...auth });

// ── Processing ───────────────────────────────────────────────────
export const getDocumentProcessing = (documentId: Uuid) =>
  request<DocumentProcessingResponse>({ method: "GET", path: `/api/documents/${documentId}/processing`, ...auth });

export const requestDocumentProcessing = (documentId: Uuid) =>
  request<DocumentProcessingResponse>({ method: "POST", path: `/api/documents/${documentId}/processing`, body: {}, ...auth, idempotent: true });

export const retryDocumentProcessing = (documentId: Uuid) =>
  request<DocumentProcessingResponse>({ method: "POST", path: `/api/documents/${documentId}/processing/retry`, body: {}, ...auth, idempotent: true });

// ── Admin: owner recovery ────────────────────────────────────────
export const listOwnerRecoveryDocuments = (q: { offset?: number; limit?: number } = {}) =>
  request<OffsetPage<DocumentOwnerRecoveryItemResponse>>({ method: "GET", path: "/api/admin/documents/owner-recovery", query: q, ...auth });

export const recoverDocumentOwner = (documentId: Uuid, b: { recoveryType: OwnerRecoveryType; targetUserId: Uuid | null; reasonCode: OwnerRecoveryReasonCode; reason: string; version: number }) =>
  request<DocumentOwnerRecoveryResponse>({ method: "POST", path: `/api/admin/documents/${documentId}/owner-recovery`, body: b, ...auth, idempotent: true });
