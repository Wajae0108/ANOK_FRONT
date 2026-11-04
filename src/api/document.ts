// ANOK_BACKEND document_service의 실제 Controller/DTO 기준.
// - 업로드(POST /documents, /documents/{id}/versions, /meetings/{id}/attachments)는 multipart이며 JSON `metadata` part + `file` part로 보낸다.
// - 버전 응답의 현재 여부 필드는 `current`다. UI는 `isCurrent`를 쓰므로 adapter(toVersion)에서 변환한다.
// - DELETE(permissions/project-attachments/meeting attachments)는 204 본문 없음, 다운로드는 공통 Wrapper 없는 raw stream이다.
import { downloadFile, request } from "./http";
import type { OffsetPage, Rfc3339, Uuid } from "./types";

export type DocumentStatus = "ACTIVE" | "ARCHIVED";
export type OwnerAccessState = "ACTIVE" | "SUSPENDED_BY_IDENTITY";
export type AclPermission = "EDITOR" | "VIEWER" | "DENY";
export type AclStatus = "ACTIVE" | "SUSPENDED_BY_IDENTITY" | "REVOKED";
export type DocumentProcessingStatus = "NOT_REQUESTED" | "QUEUED" | "PARSING" | "PARSED" | "EMBEDDING" | "READY" | "BLOCKED_BY_POLICY" | "FAILED" | "STALE";
export type ExternalAiPolicy = "INHERIT" | "ALLOWED" | "BLOCKED";
export type SensitivityClassification = "INTERNAL" | "CONFIDENTIAL" | "PII" | "CORE_TRADE_SECRET";
export type EffectivePermission = "NONE" | "VIEWER" | "EDITOR" | "OWNER";
export type PermissionSource = "NONE" | "OWNER" | "EXPLICIT_ACL" | "INHERITED";
export type OwnerRecoveryType = "RESTORE_OWNER_ACCESS" | "TRANSFER_OWNERSHIP";
export type OwnerRecoveryReasonCode = "OWNER_REACTIVATED" | "OWNER_UNAVAILABLE" | "EMPLOYMENT_CHANGE" | "SECURITY_RECOVERY" | "OTHER";

export interface DocumentVersionSummary { versionId: Uuid; versionNo: number; originalFilename: string; sizeBytes: number; detectedMimeType: string; createdAt: Rfc3339 }
export interface DocumentResponse {
  documentId: Uuid; title: string; description?: string | null; ownerUserId: Uuid; ownerAccessState: OwnerAccessState; status: DocumentStatus;
  currentVersion: DocumentVersionSummary; externalAiPolicy: ExternalAiPolicy; sensitivityClassification: SensitivityClassification;
  processingStatus: DocumentProcessingStatus; effectivePermission: EffectivePermission; permissionSource: PermissionSource;
  createdByUserId: Uuid; createdAt: Rfc3339; updatedAt: Rfc3339; archivedAt?: Rfc3339 | null; version: number;
}
interface DocumentVersionWire {
  versionId: Uuid; documentId: Uuid; versionNo: number; originalFilename: string; sizeBytes: number; detectedMimeType: string;
  sha256: string; uploadedByUserId: Uuid; createdAt: Rfc3339; current: boolean;
}
export type DocumentVersionResponse = Omit<DocumentVersionWire, "current"> & { isCurrent: boolean };
const toVersion = ({ current, ...v }: DocumentVersionWire): DocumentVersionResponse => ({ ...v, isCurrent: current });
export interface DocumentPermissionResponse { userId: Uuid; permission: AclPermission; status: AclStatus; createdByUserId: Uuid; createdAt: Rfc3339; updatedAt: Rfc3339; version: number }
export interface DocumentProjectAttachmentResponse { attachmentId: Uuid; documentId: Uuid; projectId: Uuid; createdAt: Rfc3339 }
// processingStatus: AI가 읽을 수 있게 글자를 뽑는 처리 상태. READY만 AI 근거로 쓰인다. 항상 온다.
// processingFailureCode: FAILED일 때만 오고, 아니면 키 자체가 없다. NOT_SUPPORTED(이미지·오디오·Excel 등)·PARSER_ERROR·AI_JOB_SOURCE_UNAVAILABLE·AI_JOB_RETRY_EXHAUSTED.
export interface MeetingAttachmentResponse {
  attachmentId: Uuid; meetingId: Uuid; documentId: Uuid; title: string; ownerUserId: Uuid; currentVersionId: Uuid;
  originalFilename: string; sizeBytes: number; detectedMimeType: string; effectivePermission: EffectivePermission; createdAt: Rfc3339;
  processingStatus?: DocumentProcessingStatus; processingFailureCode?: string | null;
}
export interface DocumentProcessingResponse {
  documentId: Uuid; documentVersionId: Uuid; status: DocumentProcessingStatus; processingGeneration: number;
  failureCode?: string | null; blockCode?: string | null; updatedAt: Rfc3339; version: number;
}
export interface DocumentOwnerRecoveryItemResponse { documentId: Uuid; ownerUserId: Uuid; ownerAccessState: OwnerAccessState; documentStatus: DocumentStatus; createdAt: Rfc3339; updatedAt: Rfc3339; version: number }
export interface DocumentOwnerRecoveryResponse { documentId: Uuid; ownerUserId: Uuid; ownerAccessState: OwnerAccessState; recoveryType: OwnerRecoveryType; recoveredAt: Rfc3339; version: number }

const auth = { auth: "bearer" } as const;

// 서버는 @RequestPart("metadata")를 JSON으로, @RequestPart("file")을 파일로 받는다. metadata는 application/json Blob이어야 한다.
function uploadForm(file: File, metadata: Record<string, unknown>): FormData {
  const clean = Object.fromEntries(Object.entries(metadata).filter(([, v]) => v !== undefined));
  const fd = new FormData();
  fd.append("metadata", new Blob([JSON.stringify(clean)], { type: "application/json" }));
  fd.append("file", file);
  return fd;
}

// 업로드 전에 프론트에서 먼저 거른다(⑥⑦ 체크리스트). 50MB 초과나 너무 긴 파일 이름은 서버가 413 FILE_TOO_LARGE로 돌려준다.
export const UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
export const UPLOAD_MAX_FILENAME = 100;
export const UPLOAD_MAX_TITLE = 160;
const BLOCKED_UPLOAD_EXT = [".zip", ".7z", ".rar", ".tar", ".gz", ".tgz", ".exe", ".sh", ".bat", ".cmd", ".msi", ".dll", ".jar", ".apk"];
/** 올릴 수 없는 파일이면 사용자에게 보여 줄 사유를, 괜찮으면 null을 돌려준다. */
export function validateUploadFile(file: File): string | null {
  if (file.size === 0) return "빈 파일은 올릴 수 없습니다.";
  if (file.size > UPLOAD_MAX_BYTES) return "파일은 50MB 이하여야 합니다.";
  if (file.name.length > UPLOAD_MAX_FILENAME) return `파일 이름이 너무 깁니다. (${UPLOAD_MAX_FILENAME}자 이내로 바꿔 주세요)`;
  const lower = file.name.toLowerCase();
  if (BLOCKED_UPLOAD_EXT.some(ext => lower.endsWith(ext))) return "압축 파일과 실행 파일은 올릴 수 없습니다.";
  return null;
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
export const listDocumentVersions = async (documentId: Uuid, q: { offset?: number; limit?: number } = {}): Promise<OffsetPage<DocumentVersionResponse>> => {
  const page = await request<OffsetPage<DocumentVersionWire>>({ method: "GET", path: `/api/documents/${documentId}/versions`, query: q, ...auth });
  return { ...page, items: page.items.map(toVersion) };
};

export const uploadDocumentVersion = async (documentId: Uuid, file: File, expectedDocumentVersion: number) =>
  toVersion(await request<DocumentVersionWire>({ method: "POST", path: `/api/documents/${documentId}/versions`, body: uploadForm(file, { expectedDocumentVersion }), ...auth, idempotent: true }));

export const getDocumentVersion = async (documentId: Uuid, versionId: Uuid) =>
  toVersion(await request<DocumentVersionWire>({ method: "GET", path: `/api/documents/${documentId}/versions/${versionId}`, ...auth }));

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

// ── Meeting minutes template (회사 양식, 검토 담당자 전용) ──────
// PNG·JPG·PDF, 그리고 문서 서비스의 MINUTES_TEMPLATE_DOCX_ENABLED가 켜져 있을 때 Word(.docx). 10MiB 이하.
// multipart에는 `file` 파트만 보낸다(metadata 파트·Idempotency-Key 없음). 내용으로 형식을 판별하므로 확장자만 바꾼 파일은 거절된다.
// 같은 내용을 다시 올리면 같은 templateId를 돌려준다. 업로드만으로는 분석이 시작되지 않는다(requestMeetingCustomReport 때 시작).
// .docx가 꺼진 서버는 400 FILE_TYPE_NOT_ALLOWED로 거절하므로 화면에서 미리 막지 않고 서버 응답을 문구로 안내한다.
export const MINUTES_TEMPLATE_MAX_BYTES = 10 * 1024 * 1024;
export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const MINUTES_TEMPLATE_ACCEPT = `image/png,image/jpeg,application/pdf,${DOCX_MIME},.docx`;
export interface MeetingMinutesTemplateResponse {
  templateId: Uuid; meetingId: Uuid; filename: string; mimeType: "image/png" | "image/jpeg" | "application/pdf" | typeof DOCX_MIME;
  sizeBytes: number; sha256: string; uploadedAt: Rfc3339;
}
export const uploadMeetingMinutesTemplate = (meetingId: Uuid, file: File) => {
  const fd = new FormData();
  fd.append("file", file);
  return request<MeetingMinutesTemplateResponse>({ method: "PUT", path: `/api/meetings/${meetingId}/minutes-template`, body: fd, ...auth });
};

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
