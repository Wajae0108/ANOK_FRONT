// Anok_03_Document_File_API_Event_Spec_v2_3_3_FINAL 기준 인메모리 mock.
// mock.ts가 /api/documents, /api/meetings/{id}/attachments, /api/admin/documents 경로를 이 파일로 위임한다.
// 실제 파일 바이너리는 브라우저 메모리(Blob)에만 보관되며, 새로고침하면 사라진다.
import { ApiError } from "./errors";
import type { RequestOptions } from "./http";
import { byId, check, fail, id, invalid, offsetPage, principal, str, versioned } from "./mockCore";
import type { MockUser } from "./mockCore";
import { effectiveProjectRole, isEffectiveProjectMember, projectExists, SEED_PROJECT_IDS } from "./mockProject";
import { getMeetingAttachmentAccess } from "./mockMeeting";
import { emit } from "./mockNotification";
import type {
  AclPermission, AclStatus, DocumentPermissionResponse, DocumentProcessingResponse, DocumentProcessingStatus,
  DocumentProjectAttachmentResponse, DocumentResponse, DocumentStatus, DocumentVersionResponse, EffectivePermission,
  ExternalAiPolicy, MeetingAttachmentResponse, OwnerAccessState, OwnerRecoveryReasonCode, OwnerRecoveryType,
  PermissionSource, SensitivityClassification,
} from "./document";
import type { FieldError } from "./types";

interface Doc {
  documentId: string; title: string; description: string | null; ownerUserId: string; ownerAccessState: OwnerAccessState;
  status: DocumentStatus; externalAiPolicy: ExternalAiPolicy; sensitivityClassification: SensitivityClassification;
  currentVersionId: string; createdByUserId: string; createdAt: string; updatedAt: string; archivedAt: string | null; version: number;
}
interface Version {
  versionId: string; documentId: string; versionNo: number; originalFilename: string; sizeBytes: number;
  detectedMimeType: string; sha256: string; uploadedByUserId: string; createdAt: string; blob: Blob;
}
interface Acl { documentId: string; userId: string; permission: AclPermission; status: AclStatus; createdByUserId: string; createdAt: string; updatedAt: string; version: number }
interface ProjectAttachment { attachmentId: string; documentId: string; projectId: string; createdAt: string }
interface MeetingAttachment { attachmentId: string; meetingId: string; documentId: string; createdAt: string }
interface Processing { documentId: string; documentVersionId: string; status: DocumentProcessingStatus; processingGeneration: number; failureCode: string | null; blockCode: string | null; updatedAt: string; version: number }

const now = () => new Date().toISOString();
const U = { wonjae: id(1, 1), gyuchan: id(1, 2), minjun: id(1, 4), dayoung: id(1, 5) };
const MAX_SIZE = 50 * 1024 * 1024;
const BLOCKED_EXT = [".zip", ".rar", ".7z", ".tar", ".gz", ".exe", ".bat", ".sh", ".cmd", ".msi", ".dll", ".jar", ".apk"];

const docs: Doc[] = [];
const versions: Version[] = [];
const acls: Acl[] = [];
const projectAttachments: ProjectAttachment[] = [];
const meetingAttachments: MeetingAttachment[] = [];
const processing = new Map<string, Processing>();

let docSeq = 0, versionSeq = 0, aclSeq = 0, projAttachSeq = 0, meetingAttachSeq = 0;

async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}
function validateFile(file: unknown): File {
  if (!(file instanceof File)) return invalid({ field: "file", reason: "REQUIRED" });
  if (file.size > MAX_SIZE) fail(413, "FILE_TOO_LARGE");
  const name = file.name.toLowerCase();
  if (BLOCKED_EXT.some(ext => name.endsWith(ext))) fail(400, "FILE_TYPE_NOT_ALLOWED");
  return file;
}
async function createVersion(documentId: string, file: File, versionNo: number, uploadedByUserId: string): Promise<Version> {
  const v: Version = {
    versionId: id(11, ++versionSeq), documentId, versionNo, originalFilename: file.name, sizeBytes: file.size,
    detectedMimeType: file.type || "application/octet-stream", sha256: await sha256Hex(file), uploadedByUserId, createdAt: now(), blob: file,
  };
  versions.push(v);
  return v;
}
function seedDoc(title: string, ownerUserId: string, sensitivity: SensitivityClassification, aiPolicy: ExternalAiPolicy, aclList: [string, AclPermission][], projectId: string | null): Doc {
  const documentId = id(12, ++docSeq);
  const versionId = id(11, ++versionSeq);
  const seedText = new Blob([`${title} (mock seed document)`], { type: "text/plain" });
  versions.push({ versionId, documentId, versionNo: 1, originalFilename: `${title}.txt`, sizeBytes: seedText.size, detectedMimeType: "text/plain", sha256: "seed", uploadedByUserId: ownerUserId, createdAt: now(), blob: seedText });
  const d: Doc = { documentId, title, description: null, ownerUserId, ownerAccessState: "ACTIVE", status: "ACTIVE", externalAiPolicy: aiPolicy, sensitivityClassification: sensitivity, currentVersionId: versionId, createdByUserId: ownerUserId, createdAt: now(), updatedAt: now(), archivedAt: null, version: 1 };
  docs.push(d);
  processing.set(documentId, { documentId, documentVersionId: versionId, status: "READY", processingGeneration: 1, failureCode: null, blockCode: null, updatedAt: now(), version: 1 });
  for (const [userId, permission] of aclList) acls.push({ documentId, userId, permission, status: "ACTIVE", createdByUserId: ownerUserId, createdAt: now(), updatedAt: now(), version: 1 });
  if (projectId) projectAttachments.push({ attachmentId: id(13, ++projAttachSeq), documentId, projectId, createdAt: now() });
  return d;
}
seedDoc("API 명세서 v2.1.pdf", U.gyuchan, "INTERNAL", "INHERIT", [[U.wonjae, "VIEWER"]], SEED_PROJECT_IDS.authRevamp);
seedDoc("OAuth 2.0 설계 문서.docx", U.wonjae, "CONFIDENTIAL", "INHERIT", [[U.gyuchan, "EDITOR"]], SEED_PROJECT_IDS.authRevamp);
seedDoc("AI 아키텍처 리뷰 회의록.pdf", U.minjun, "INTERNAL", "INHERIT", [[U.wonjae, "EDITOR"], [U.gyuchan, "VIEWER"]], SEED_PROJECT_IDS.aiPipeline);
seedDoc("RAG 파이프라인 설계서.pdf", U.dayoung, "CORE_TRADE_SECRET", "BLOCKED", [[U.wonjae, "VIEWER"]], SEED_PROJECT_IDS.aiPipeline);

// ── 권한 해석 (§3 Permission Resolution) ──
function resolvePermission(doc: Doc, userId: string): { permission: EffectivePermission | "NONE"; source: PermissionSource } {
  const identity = byId(userId);
  if (doc.ownerUserId === userId && doc.ownerAccessState === "ACTIVE" && identity?.status === "ACTIVE") return { permission: "OWNER", source: "OWNER" };
  const acl = acls.find(a => a.documentId === doc.documentId && a.userId === userId && a.status === "ACTIVE");
  if (acl) return { permission: acl.permission === "DENY" ? "NONE" : acl.permission, source: "EXPLICIT_ACL" };
  if (projectAttachments.some(pa => pa.documentId === doc.documentId && isEffectiveProjectMember(pa.projectId, userId))) return { permission: "VIEWER", source: "INHERITED" };
  if (meetingAttachments.some(ma => ma.documentId === doc.documentId && getMeetingAttachmentAccess(ma.meetingId, userId).hasAccess)) return { permission: "VIEWER", source: "INHERITED" };
  return { permission: "NONE", source: "NONE" };
}
function findDoc(documentId: string): Doc { const d = docs.find(x => x.documentId === documentId); if (!d) return fail(404, "DOCUMENT_NOT_FOUND"); return d; }
function requireReader(doc: Doc, userId: string) { const r = resolvePermission(doc, userId); if (r.permission === "NONE") return fail(403, "DOCUMENT_ACCESS_DENIED"); return r; }
function requireEditor(doc: Doc, userId: string) { const r = requireReader(doc, userId); if (r.permission !== "OWNER" && r.permission !== "EDITOR") return fail(403, "DOCUMENT_EDIT_FORBIDDEN"); return r; }
function requireOwner(doc: Doc, userId: string) { const r = requireReader(doc, userId); if (r.permission !== "OWNER") return fail(403, "DOCUMENT_OWNER_REQUIRED"); return r; }

// AI(06) Permission-aware RAG용 최소 조회 — 실제로는 AI Service의 VALIDATE_DOCUMENT_ACCESS internal capability 호출에 해당한다.
export function getDocumentContextForAi(documentId: string, userId: string): { title: string; description: string | null; sensitivityClassification: SensitivityClassification; accessible: boolean } | undefined {
  const doc = docs.find(x => x.documentId === documentId);
  if (!doc) return undefined;
  return { title: doc.title, description: doc.description, sensitivityClassification: doc.sensitivityClassification, accessible: resolvePermission(doc, userId).permission !== "NONE" };
}

function toDocumentResponse(doc: Doc, userId: string): DocumentResponse {
  const v = versions.find(x => x.versionId === doc.currentVersionId)!;
  const proc = processing.get(doc.documentId)!;
  const perm = resolvePermission(doc, userId);
  return {
    documentId: doc.documentId, title: doc.title, description: doc.description, ownerUserId: doc.ownerUserId, ownerAccessState: doc.ownerAccessState, status: doc.status,
    currentVersion: { versionId: v.versionId, versionNo: v.versionNo, originalFilename: v.originalFilename, sizeBytes: v.sizeBytes, detectedMimeType: v.detectedMimeType, createdAt: v.createdAt },
    externalAiPolicy: doc.externalAiPolicy, sensitivityClassification: doc.sensitivityClassification, processingStatus: proc.status,
    effectivePermission: perm.permission === "NONE" ? "VIEWER" : perm.permission, permissionSource: perm.source,
    createdByUserId: doc.createdByUserId, createdAt: doc.createdAt, updatedAt: doc.updatedAt, archivedAt: doc.archivedAt, version: doc.version,
  };
}
// 서버 Wire 형태: 현재 여부 필드는 `current`다(UI용 `isCurrent` 변환은 api/document.ts의 adapter가 한다).
const toVersionResponse = (v: Version, doc: Doc): Omit<DocumentVersionResponse, "isCurrent"> & { current: boolean } => ({ versionId: v.versionId, documentId: v.documentId, versionNo: v.versionNo, originalFilename: v.originalFilename, sizeBytes: v.sizeBytes, detectedMimeType: v.detectedMimeType, sha256: v.sha256, uploadedByUserId: v.uploadedByUserId, createdAt: v.createdAt, current: v.versionId === doc.currentVersionId });
const toPermissionResponse = (a: Acl): DocumentPermissionResponse => ({ userId: a.userId, permission: a.permission, status: a.status, createdByUserId: a.createdByUserId, createdAt: a.createdAt, updatedAt: a.updatedAt, version: a.version });
const toProcessingResponse = (p: Processing): DocumentProcessingResponse => ({ documentId: p.documentId, documentVersionId: p.documentVersionId, status: p.status, processingGeneration: p.processingGeneration, failureCode: p.failureCode, blockCode: p.blockCode, updatedAt: p.updatedAt, version: p.version });

function toMeetingAttachmentResponse(ma: MeetingAttachment, doc: Doc, userId: string): MeetingAttachmentResponse {
  const v = versions.find(x => x.versionId === doc.currentVersionId)!;
  const perm = resolvePermission(doc, userId);
  return { attachmentId: ma.attachmentId, meetingId: ma.meetingId, documentId: doc.documentId, title: doc.title, ownerUserId: doc.ownerUserId, currentVersionId: v.versionId, originalFilename: v.originalFilename, sizeBytes: v.sizeBytes, detectedMimeType: v.detectedMimeType, effectivePermission: perm.permission === "NONE" ? "VIEWER" : perm.permission, createdAt: ma.createdAt };
}

// mockFetch가 multipart body를 { ...JSON metadata part, file: File } 형태 객체로 풀어서 넘겨준다.
export function routeDocument(o: RequestOptions, me: MockUser): unknown | Promise<unknown> {
  const b: any = o.body ?? {};
  const path = o.path;
  const key = `${o.method} ${path}`;
  const q = o.query ?? {};

  if (key === "GET /api/documents") {
    const rows = docs
      .filter(d => (!q.status || d.status === q.status))
      .filter(d => resolvePermission(d, me.userId).permission !== "NONE")
      .filter(d => resolvePermission(d, me.userId).source === "OWNER" || resolvePermission(d, me.userId).source === "EXPLICIT_ACL")
      .filter(d => !q.q || d.title.toLowerCase().includes(String(q.q).toLowerCase()))
      .sort((a, c) => c.updatedAt.localeCompare(a.updatedAt));
    const page = offsetPage(rows, q);
    return { items: page.items.map(d => toDocumentResponse(d, me.userId)), page: page.page };
  }
  if (key === "POST /api/documents") {
    const e: FieldError[] = []; const title = str(e, b, "title", 1, 200); const description = str(e, b, "description", 0, 2000, false);
    const aiPolicy = (b.externalAiPolicy ?? "INHERIT") as ExternalAiPolicy;
    const sensitivity = (b.sensitivityClassification ?? "INTERNAL") as SensitivityClassification;
    if (!["INHERIT", "ALLOWED", "BLOCKED"].includes(aiPolicy)) e.push({ field: "externalAiPolicy", reason: "INVALID_ENUM" });
    if (!["INTERNAL", "CONFIDENTIAL", "PII", "CORE_TRADE_SECRET"].includes(sensitivity)) e.push({ field: "sensitivityClassification", reason: "INVALID_ENUM" });
    check(e);
    const file = validateFile(b.file);
    return (async () => {
      const documentId = id(12, ++docSeq);
      const v = await createVersion(documentId, file, 1, me.userId);
      const d: Doc = { documentId, title: title!, description: description ?? null, ownerUserId: me.userId, ownerAccessState: "ACTIVE", status: "ACTIVE", externalAiPolicy: aiPolicy, sensitivityClassification: sensitivity, currentVersionId: v.versionId, createdByUserId: me.userId, createdAt: now(), updatedAt: now(), archivedAt: null, version: 1 };
      docs.push(d);
      processing.set(documentId, { documentId, documentVersionId: v.versionId, status: "NOT_REQUESTED", processingGeneration: 0, failureCode: null, blockCode: null, updatedAt: now(), version: 1 });
      return toDocumentResponse(d, me.userId);
    })();
  }

  let m = /^\/api\/documents\/([^/]+)$/.exec(path);
  if (m) {
    const doc = findDoc(m[1]);
    if (o.method === "GET") { requireReader(doc, me.userId); return toDocumentResponse(doc, me.userId); }
    const perm = requireEditor(doc, me.userId);
    if (doc.status === "ARCHIVED") return fail(409, "DOCUMENT_ARCHIVED");
    const e: FieldError[] = []; const title = str(e, b, "title", 1, 200); const description = str(e, b, "description", 0, 2000, false);
    if (!["INTERNAL", "CONFIDENTIAL", "PII", "CORE_TRADE_SECRET"].includes(b.sensitivityClassification)) e.push({ field: "sensitivityClassification", reason: "INVALID_ENUM" });
    check(e);
    const row = versioned(doc, b, "DOCUMENT_NOT_FOUND");
    if (perm.permission === "EDITOR" && b.sensitivityClassification !== row.sensitivityClassification) return fail(403, "DOCUMENT_OWNER_REQUIRED");
    if (row.sensitivityClassification !== "INTERNAL" && b.sensitivityClassification === "INTERNAL") return fail(409, "SENSITIVITY_DOWNGRADE_FORBIDDEN");
    Object.assign(row, { title, description: description ?? null, sensitivityClassification: b.sensitivityClassification, version: row.version + 1, updatedAt: now() });
    return toDocumentResponse(row, me.userId);
  }

  m = /^\/api\/documents\/([^/]+)\/archive$/.exec(path);
  if (m) {
    const doc = findDoc(m[1]); requireOwner(doc, me.userId);
    const row = versioned(doc, b, "DOCUMENT_NOT_FOUND");
    if (row.status === "ARCHIVED") return fail(409, "DOCUMENT_ALREADY_ARCHIVED");
    row.status = "ARCHIVED"; row.archivedAt = now(); row.version++; row.updatedAt = now();
    return toDocumentResponse(row, me.userId);
  }

  m = /^\/api\/documents\/([^/]+)\/ai-policy$/.exec(path);
  if (m) {
    const doc = findDoc(m[1]); requireOwner(doc, me.userId);
    if (doc.status === "ARCHIVED") return fail(409, "DOCUMENT_ARCHIVED");
    if (!["INHERIT", "ALLOWED", "BLOCKED"].includes(b.externalAiPolicy)) invalid({ field: "externalAiPolicy", reason: "INVALID_ENUM" });
    const row = versioned(doc, b, "DOCUMENT_NOT_FOUND");
    if (row.sensitivityClassification !== "INTERNAL" && b.externalAiPolicy === "ALLOWED") return fail(409, "DOCUMENT_AI_POLICY_LOCKED_BY_SENSITIVITY");
    row.externalAiPolicy = b.externalAiPolicy; row.version++; row.updatedAt = now();
    return toDocumentResponse(row, me.userId);
  }

  m = /^\/api\/documents\/([^/]+)\/owner$/.exec(path);
  if (m) {
    const doc = findDoc(m[1]); requireOwner(doc, me.userId);
    if (typeof b.targetUserId !== "string" || !b.targetUserId) invalid({ field: "targetUserId", reason: "REQUIRED" });
    const target = byId(b.targetUserId);
    if (!target) return fail(404, "TARGET_USER_NOT_FOUND");
    const row = versioned(doc, b, "DOCUMENT_NOT_FOUND");
    if (target.userId === row.ownerUserId) return fail(409, "SAME_OWNER");
    if (target.status !== "ACTIVE") return fail(409, "TARGET_USER_INACTIVE");
    row.ownerUserId = target.userId; row.ownerAccessState = "ACTIVE"; row.version++; row.updatedAt = now();
    emit(target.userId, "DOCUMENT_OWNERSHIP_TRANSFERRED", "DOCUMENT", row.documentId, { actorUserId: me.userId });
    return toDocumentResponse(row, me.userId);
  }

  // ── Versions ──
  m = /^\/api\/documents\/([^/]+)\/versions$/.exec(path);
  if (m) {
    const doc = findDoc(m[1]);
    if (o.method === "GET") {
      requireEditor(doc, me.userId);
      const rows = versions.filter(v => v.documentId === doc.documentId).sort((a, c) => c.versionNo - a.versionNo);
      const page = offsetPage(rows, q);
      return { items: page.items.map(v => toVersionResponse(v, doc)), page: page.page };
    }
    requireEditor(doc, me.userId);
    if (doc.status === "ARCHIVED") return fail(409, "DOCUMENT_ARCHIVED");
    const expected = Number(b.expectedDocumentVersion);
    if (!Number.isFinite(expected)) invalid({ field: "expectedDocumentVersion", reason: "REQUIRED" });
    const file = validateFile(b.file);
    if (expected !== doc.version) return fail(409, "VERSION_CONFLICT");
    return (async () => {
      const nextNo = Math.max(...versions.filter(v => v.documentId === doc.documentId).map(v => v.versionNo)) + 1;
      const v = await createVersion(doc.documentId, file, nextNo, me.userId);
      doc.currentVersionId = v.versionId; doc.version++; doc.updatedAt = now();
      processing.set(doc.documentId, { documentId: doc.documentId, documentVersionId: v.versionId, status: "NOT_REQUESTED", processingGeneration: 0, failureCode: null, blockCode: null, updatedAt: now(), version: 1 });
      return toVersionResponse(v, doc);
    })();
  }
  m = /^\/api\/documents\/([^/]+)\/versions\/([^/]+)$/.exec(path);
  if (m) {
    const doc = findDoc(m[1]); requireReader(doc, me.userId);
    const v = versions.find(x => x.versionId === m![2] && x.documentId === doc.documentId);
    if (!v) return fail(404, "DOCUMENT_VERSION_NOT_FOUND");
    if (v.versionId !== doc.currentVersionId) { const r = resolvePermission(doc, me.userId); if (r.permission !== "OWNER" && r.permission !== "EDITOR") return fail(403, "DOCUMENT_VERSION_HISTORY_FORBIDDEN"); }
    return toVersionResponse(v, doc);
  }

  // ── ACL ──
  m = /^\/api\/documents\/([^/]+)\/permissions$/.exec(path);
  if (m) {
    const doc = findDoc(m[1]);
    if (o.method === "GET") {
      requireOwner(doc, me.userId);
      const rows = acls.filter(a => a.documentId === doc.documentId && (!q.status || a.status === q.status));
      const page = offsetPage(rows, q);
      return { items: page.items.map(toPermissionResponse), page: page.page };
    }
    requireOwner(doc, me.userId);
    if (doc.status === "ARCHIVED") return fail(409, "DOCUMENT_ARCHIVED");
    const list = Array.isArray(b.permissions) ? b.permissions : invalid({ field: "permissions", reason: "REQUIRED" });
    const seen = new Set<string>();
    for (const p of list) {
      if (seen.has(p.userId)) return fail(400, "DUPLICATE_ACL_SUBJECT");
      seen.add(p.userId);
      if (p.userId === doc.ownerUserId) return fail(409, "OWNER_ACL_FORBIDDEN");
      if (!byId(p.userId)) return fail(404, "ACL_TARGET_NOT_FOUND");
      if (!["EDITOR", "VIEWER", "DENY"].includes(p.permission)) invalid({ field: "permission", reason: "INVALID_ENUM" });
    }
    const row = versioned(doc, { version: b.expectedDocumentVersion }, "DOCUMENT_NOT_FOUND");
    const current = acls.filter(a => a.documentId === doc.documentId);
    for (const a of current) if (a.status === "ACTIVE" && !list.some((p: any) => p.userId === a.userId)) { a.status = "REVOKED"; a.updatedAt = now(); a.version++; }
    for (const p of list) {
      const existing = current.find(a => a.userId === p.userId);
      if (existing) { existing.permission = p.permission; existing.status = "ACTIVE"; existing.updatedAt = now(); existing.version++; }
      else acls.push({ documentId: doc.documentId, userId: p.userId, permission: p.permission, status: "ACTIVE", createdByUserId: me.userId, createdAt: now(), updatedAt: now(), version: 1 });
    }
    row.version++; row.updatedAt = now();
    return acls.filter(a => a.documentId === doc.documentId && a.status === "ACTIVE").map(toPermissionResponse);
  }
  m = /^\/api\/documents\/([^/]+)\/permissions\/([^/]+)$/.exec(path);
  if (m) {
    const doc = findDoc(m[1]); requireOwner(doc, me.userId);
    const targetUserId = m[2];
    if (targetUserId === doc.ownerUserId) return fail(409, "OWNER_ACL_FORBIDDEN");
    if (doc.status === "ARCHIVED") return fail(409, "DOCUMENT_ARCHIVED");
    if (o.method === "DELETE") {
      const row = acls.find(a => a.documentId === doc.documentId && a.userId === targetUserId);
      if (!row) return fail(404, "DOCUMENT_PERMISSION_NOT_FOUND");
      if (row.status === "REVOKED") return fail(409, "PERMISSION_ALREADY_REVOKED");
      row.status = "REVOKED"; row.updatedAt = now(); row.version++;
      return undefined;
    }
    if (!["EDITOR", "VIEWER", "DENY"].includes(b.permission)) invalid({ field: "permission", reason: "INVALID_ENUM" });
    if (!byId(targetUserId)) return fail(404, "ACL_TARGET_NOT_FOUND");
    const docRow = versioned(doc, { version: b.expectedDocumentVersion }, "DOCUMENT_NOT_FOUND");
    docRow.version++; docRow.updatedAt = now();
    const existing = acls.find(a => a.documentId === doc.documentId && a.userId === targetUserId);
    if (existing) { existing.permission = b.permission; existing.status = "ACTIVE"; existing.updatedAt = now(); existing.version++; return toPermissionResponse(existing); }
    const row: Acl = { documentId: doc.documentId, userId: targetUserId, permission: b.permission, status: "ACTIVE", createdByUserId: me.userId, createdAt: now(), updatedAt: now(), version: 1 };
    acls.push(row);
    return toPermissionResponse(row);
  }

  // ── Project attachment ──
  m = /^\/api\/documents\/([^/]+)\/project-attachments$/.exec(path);
  if (m) {
    const doc = findDoc(m[1]); requireOwner(doc, me.userId);
    if (doc.status === "ARCHIVED") return fail(409, "DOCUMENT_ARCHIVED");
    if (typeof b.projectId !== "string" || !b.projectId) invalid({ field: "projectId", reason: "REQUIRED" });
    if (!projectExists(b.projectId)) return fail(404, "PROJECT_NOT_FOUND");
    if (effectiveProjectRole(b.projectId, me.userId) !== "MANAGER") return fail(403, "PROJECT_ATTACH_FORBIDDEN");
    if (projectAttachments.some(pa => pa.documentId === doc.documentId && pa.projectId === b.projectId)) return fail(409, "PROJECT_ATTACHMENT_ALREADY_EXISTS");
    const row: ProjectAttachment = { attachmentId: id(13, ++projAttachSeq), documentId: doc.documentId, projectId: b.projectId, createdAt: now() };
    projectAttachments.push(row);
    return row satisfies DocumentProjectAttachmentResponse;
  }
  m = /^\/api\/documents\/([^/]+)\/project-attachments\/([^/]+)$/.exec(path);
  if (m) {
    const doc = findDoc(m[1]);
    const perm = requireEditor(doc, me.userId);
    const idx = projectAttachments.findIndex(pa => pa.documentId === doc.documentId && pa.projectId === m![2]);
    if (idx < 0) return fail(404, "PROJECT_ATTACHMENT_NOT_FOUND");
    if (perm.permission === "EDITOR" && effectiveProjectRole(m[2], me.userId) !== "MANAGER") return fail(403, "PROJECT_DETACH_FORBIDDEN");
    projectAttachments.splice(idx, 1);
    return undefined;
  }

  // ── Meeting attachments (실제 Meeting(04) 참가자/진행 상태를 getMeetingAttachmentAccess로 참조) ──
  m = /^\/api\/meetings\/([^/]+)\/attachments$/.exec(path);
  if (m) {
    const meetingId = m[1];
    const access = getMeetingAttachmentAccess(meetingId, me.userId);
    if (!access.exists) return fail(404, "MEETING_NOT_FOUND");
    if (o.method === "GET") {
      if (!access.hasAccess) return fail(403, "MEETING_DOCUMENT_ACCESS_DENIED");
      const rows = meetingAttachments.filter(ma => ma.meetingId === meetingId);
      const page = offsetPage(rows, q);
      return { items: page.items.map(ma => toMeetingAttachmentResponse(ma, findDoc(ma.documentId), me.userId)), page: page.page };
    }
    if (!access.hasAccess) return fail(403, "MEETING_ATTACHMENT_FORBIDDEN");
    if (!access.controlOpen) return fail(409, "MEETING_EVIDENCE_FROZEN");
    const e: FieldError[] = []; const title = str(e, b, "title", 1, 200); const description = str(e, b, "description", 0, 2000, false);
    const aiPolicy = (b.externalAiPolicy ?? "INHERIT") as ExternalAiPolicy;
    check(e);
    const file = validateFile(b.file);
    const requested = b.sensitivityClassification as SensitivityClassification | undefined;
    const meetingSensitivity: SensitivityClassification = "INTERNAL"; // mock meeting registry엔 sensitivity 개념이 없어 INTERNAL로 고정
    const finalSensitivity = requested && requested !== "INTERNAL" ? requested : meetingSensitivity;
    return (async () => {
      const documentId = id(12, ++docSeq);
      const v = await createVersion(documentId, file, 1, me.userId);
      const d: Doc = { documentId, title: title!, description: description ?? null, ownerUserId: me.userId, ownerAccessState: "ACTIVE", status: "ACTIVE", externalAiPolicy: aiPolicy, sensitivityClassification: finalSensitivity, currentVersionId: v.versionId, createdByUserId: me.userId, createdAt: now(), updatedAt: now(), archivedAt: null, version: 1 };
      docs.push(d);
      processing.set(documentId, { documentId, documentVersionId: v.versionId, status: "NOT_REQUESTED", processingGeneration: 0, failureCode: null, blockCode: null, updatedAt: now(), version: 1 });
      const ma: MeetingAttachment = { attachmentId: id(14, ++meetingAttachSeq), meetingId, documentId, createdAt: now() };
      meetingAttachments.push(ma);
      return toMeetingAttachmentResponse(ma, d, me.userId);
    })();
  }
  m = /^\/api\/meetings\/([^/]+)\/attachments\/([^/]+)$/.exec(path);
  if (m) {
    const meetingId = m[1]; const doc = findDoc(m[2]);
    const access = getMeetingAttachmentAccess(meetingId, me.userId);
    if (!access.exists) return fail(404, "MEETING_NOT_FOUND");
    if (o.method === "PUT") {
      requireOwner(doc, me.userId);
      if (!access.hasAccess) return fail(403, "MEETING_ATTACHMENT_FORBIDDEN");
      if (!access.controlOpen) return fail(409, "MEETING_EVIDENCE_FROZEN");
      let ma = meetingAttachments.find(x => x.meetingId === meetingId && x.documentId === doc.documentId);
      if (!ma) { ma = { attachmentId: id(14, ++meetingAttachSeq), meetingId, documentId: doc.documentId, createdAt: now() }; meetingAttachments.push(ma); }
      return toMeetingAttachmentResponse(ma, doc, me.userId);
    }
    requireEditor(doc, me.userId);
    if (!access.hasAccess) return fail(403, "MEETING_ATTACHMENT_FORBIDDEN");
    if (!access.controlOpen) return fail(409, "MEETING_EVIDENCE_FROZEN");
    const idx = meetingAttachments.findIndex(x => x.meetingId === meetingId && x.documentId === doc.documentId);
    if (idx < 0) return fail(404, "MEETING_ATTACHMENT_NOT_FOUND");
    meetingAttachments.splice(idx, 1);
    return undefined;
  }

  // ── Processing ──
  m = /^\/api\/documents\/([^/]+)\/processing$/.exec(path);
  if (m) {
    const doc = findDoc(m[1]);
    if (o.method === "GET") { requireReader(doc, me.userId); return toProcessingResponse(processing.get(doc.documentId)!); }
    requireEditor(doc, me.userId);
    if (doc.status === "ARCHIVED") return fail(409, "DOCUMENT_ARCHIVED");
    const p = processing.get(doc.documentId)!;
    if (p.status === "QUEUED" || p.status === "PARSING" || p.status === "EMBEDDING") return fail(409, "PROCESSING_ALREADY_RUNNING");
    if (doc.sensitivityClassification !== "INTERNAL" && doc.externalAiPolicy === "BLOCKED") { p.status = "BLOCKED_BY_POLICY"; p.blockCode = "EXTERNAL_EGRESS_BLOCKED"; p.updatedAt = now(); p.version++; return toProcessingResponse(p); }
    p.status = "QUEUED"; p.processingGeneration++; p.failureCode = null; p.blockCode = null; p.updatedAt = now(); p.version++;
    return toProcessingResponse(p);
  }
  m = /^\/api\/documents\/([^/]+)\/processing\/retry$/.exec(path);
  if (m) {
    const doc = findDoc(m[1]); requireEditor(doc, me.userId);
    if (doc.status === "ARCHIVED") return fail(409, "DOCUMENT_ARCHIVED");
    const p = processing.get(doc.documentId)!;
    if (p.status !== "FAILED" && p.status !== "BLOCKED_BY_POLICY") return fail(409, "PROCESSING_NOT_RETRYABLE");
    if (doc.sensitivityClassification !== "INTERNAL" && doc.externalAiPolicy === "BLOCKED") return fail(409, "DOCUMENT_PROCESSING_BLOCKED_LOCAL_POLICY");
    p.status = "QUEUED"; p.processingGeneration++; p.failureCode = null; p.blockCode = null; p.updatedAt = now(); p.version++;
    return toProcessingResponse(p);
  }

  // ── Admin: owner recovery ──
  if (key === "GET /api/admin/documents/owner-recovery") {
    const rows = docs.filter(d => d.ownerAccessState === "SUSPENDED_BY_IDENTITY").sort((a, c) => a.updatedAt.localeCompare(c.updatedAt));
    const page = offsetPage(rows, q);
    return { items: page.items.map(d => ({ documentId: d.documentId, ownerUserId: d.ownerUserId, ownerAccessState: d.ownerAccessState, documentStatus: d.status, createdAt: d.createdAt, updatedAt: d.updatedAt, version: d.version })), page: page.page };
  }
  m = /^\/api\/admin\/documents\/([^/]+)\/owner-recovery$/.exec(path);
  if (m) {
    const doc = findDoc(m[1]);
    if (doc.ownerAccessState !== "SUSPENDED_BY_IDENTITY") return fail(409, "DOCUMENT_OWNER_NOT_SUSPENDED");
    const e: FieldError[] = [];
    const recoveryType = b.recoveryType as OwnerRecoveryType;
    if (!["RESTORE_OWNER_ACCESS", "TRANSFER_OWNERSHIP"].includes(recoveryType)) e.push({ field: "recoveryType", reason: "INVALID_ENUM" });
    if (!["OWNER_REACTIVATED", "OWNER_UNAVAILABLE", "EMPLOYMENT_CHANGE", "SECURITY_RECOVERY", "OTHER"].includes(b.reasonCode)) e.push({ field: "reasonCode", reason: "INVALID_ENUM" });
    const reason = str(e, b, "reason", 1, 500); void (reason as OwnerRecoveryReasonCode | string | undefined);
    check(e);
    const row = versioned(doc, b, "DOCUMENT_NOT_FOUND");
    if (recoveryType === "RESTORE_OWNER_ACCESS") {
      if (b.targetUserId != null) return fail(403, "RECOVERY_TARGET_INVALID");
      const owner = byId(row.ownerUserId);
      if (!owner || owner.status !== "ACTIVE") return fail(403, "RECOVERY_TARGET_INVALID");
    } else {
      const target = byId(b.targetUserId);
      if (!target || target.status !== "ACTIVE") return fail(403, "RECOVERY_TARGET_INVALID");
      row.ownerUserId = b.targetUserId;
    }
    row.ownerAccessState = "ACTIVE"; row.version++; row.updatedAt = now();
    return { documentId: row.documentId, ownerUserId: row.ownerUserId, ownerAccessState: row.ownerAccessState, recoveryType, recoveredAt: now(), version: row.version };
  }

  return fail(404, "NOT_FOUND");
}

// GET .../download 계열: 성공 시 공통 JSON Wrapper 없이 raw Blob을 돌려준다.
export function downloadResponse(path: string, token: string | null): Response {
  try {
    const me = principal(token);
    let m = /^\/api\/documents\/([^/]+)\/download$/.exec(path);
    if (m) {
      const doc = findDoc(m[1]);
      requireReader(doc, me.userId);
      const v = versions.find(x => x.versionId === doc.currentVersionId)!;
      return fileResponse(v);
    }
    m = /^\/api\/documents\/([^/]+)\/versions\/([^/]+)\/download$/.exec(path);
    if (m) {
      const doc = findDoc(m[1]);
      const v = versions.find(x => x.versionId === m![2] && x.documentId === doc.documentId);
      if (!v) return errorResponse(404, "DOCUMENT_VERSION_NOT_FOUND");
      const r = requireReader(doc, me.userId);
      if (v.versionId !== doc.currentVersionId && r.permission !== "OWNER" && r.permission !== "EDITOR") return errorResponse(403, "DOCUMENT_VERSION_HISTORY_FORBIDDEN");
      return fileResponse(v);
    }
    return errorResponse(404, "NOT_FOUND");
  } catch (e) {
    if (e instanceof ApiError) return errorResponse(e.status, e.errorCode);
    throw e;
  }
}
function fileResponse(v: Version): Response {
  return new Response(v.blob, { status: 200, headers: { "Content-Type": v.detectedMimeType, "Content-Disposition": `attachment; filename="${encodeURIComponent(v.originalFilename)}"`, "X-Content-Type-Options": "nosniff", "X-Request-Id": crypto.randomUUID() } });
}
function errorResponse(status: number, errorCode: string): Response {
  return new Response(JSON.stringify({ success: false, message: "요청을 처리할 수 없습니다.", data: null, errorCode, requestId: crypto.randomUUID() }), { status, headers: { "Content-Type": "application/json" } });
}
