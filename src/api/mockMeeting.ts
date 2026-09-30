// Anok_04_Meeting_API_Event_Spec_v2_3_4_FINAL 기준 인메모리 mock.
// Chat은 실제 SSE 대신 replay 배열 + streamSequence로 흉내낸다. Postprocess는 실제 STT/LLM 없이
// 경과 시간 기반으로 상태를 단계적으로 전진시키고, MINUTES_DRAFT 도달 시 결정/업무 후보를 생성한다.
// materialize는 실제로 Kafka 비동기(202 PENDING → project result consumer가 나중에 MATERIALIZED|MATERIALIZATION_FAILED로 갱신)이며,
// 이 mock도 요청 시각을 기록해두고 조회 시점에 MATERIALIZE_DELAY_MS가 지나면 지연을 해소하는 방식으로 동일하게 재현한다(resolveMaterialization 참고).
import type { RequestOptions } from "./http";
import { byId, check, fail, id, invalid, offsetPage, str, versioned } from "./mockCore";
import type { MockUser } from "./mockCore";
import { emit } from "./mockNotification";
import {
  effectiveProjectRole, isEffectiveProjectMember, isProjectActive, isTaskAssigneeEligible,
  materializeCandidateAsDecision, materializeCandidateAsTask, SEED_PROJECT_IDS,
} from "./mockProject";
import type {
  CandidateStatus, CandidateType, MeetingExternalAiPolicy, MeetingSensitivity, MeetingStatus,
  MinutesStatus, ParticipationStatus, PostprocessStatus, RecordAccessState,
} from "./meeting";
import type { FieldError } from "./types";

interface Meeting {
  meetingId: string; projectId: string; title: string; description: string | null; organizerUserId: string; reviewOwnerUserId: string;
  status: MeetingStatus; scheduledStartAt: string | null; scheduledEndAt: string | null; startedAt: string | null; endedAt: string | null;
  sensitivityClassification: MeetingSensitivity; externalAiPolicy: MeetingExternalAiPolicy; passwordHash: string | null;
  createdAt: string; updatedAt: string; version: number;
}
interface Participant {
  participantId: string; meetingId: string; userId: string; participationStatus: ParticipationStatus; recordAccessState: RecordAccessState;
  sourceProjectMembershipId: string | null; lastProjectMembershipVersion: number | null; joinedRelationAt: string;
  removedAt: string | null; recordAccessRevokedAt: string | null; version: number;
}
interface ChatMsg { messageId: string; meetingId: string; senderUserId: string; text: string; streamSequence: number; sentAt: string }
interface Minutes {
  minutesId: string; meetingId: string; status: MinutesStatus; content: string | null; sourceGeneration: number;
  transcriptArtifactId: string | null; transcriptGeneration: number | null; chatFinalSequence: number | null; evidenceSnapshotId: string | null;
  generatedAt: string | null; lastEditedBy: string | null; lastEditedAt: string | null; approvedBy: string | null; approvedAt: string | null; version: number;
}
interface Candidate {
  candidateId: string; meetingId: string; minutesId: string; type: CandidateType; status: CandidateStatus; title: string;
  descriptionOrContent: string | null; assigneeUserId: string | null; dueAt: string | null; sourceGeneration: number;
  materializedResourceId: string | null; failureReasonCode: string | null; attemptCount: number; createdAt: string; updatedAt: string; version: number;
  // materialize는 실제로 Kafka 비동기(202 PENDING → project result consumer가 MATERIALIZED|MATERIALIZATION_FAILED로 갱신)라
  // mock도 요청 시각을 기록해두고 일정 시간 뒤 조회 시점에 지연 해소한다(공개 API 응답에는 포함하지 않음 — toCandidateResponse 참고).
  materializeRequestedAt: number | null; materializedByUserId: string | null;
}
interface Postprocess {
  meetingId: string; status: PostprocessStatus; sourceGeneration: number; stageBaseAt: number; failureCode: string | null; updatedAt: string; version: number;
}

const now = () => new Date().toISOString();
const U = { wonjae: id(1, 1), gyuchan: id(1, 2), minjun: id(1, 4), dayoung: id(1, 5) };
const SENS_RANK: Record<MeetingSensitivity, number> = { INTERNAL: 0, CONFIDENTIAL: 1, PII: 2, CORE_TRADE_SECRET: 3 };
const STAGE_ORDER: PostprocessStatus[] = ["WAITING_EVIDENCE_SNAPSHOT", "WAITING_RECORDING", "STT_QUEUED", "STT_PROCESSING", "STT_READY", "MINUTES_QUEUED", "MINUTES_PROCESSING", "MINUTES_DRAFT"];
const STAGE_MS = 1200;
const MATERIALIZE_DELAY_MS = 600; // candidate materialize의 202 PENDING → MATERIALIZED|MATERIALIZATION_FAILED 지연 시뮬레이션
const BLOCK_AT_INDEX = STAGE_ORDER.indexOf("MINUTES_QUEUED"); // 민감 회의는 minutes 생성(외부 AI 필요) 직전에 멈춘다

const meetings: Meeting[] = [];
const participants: Participant[] = [];
const chats: ChatMsg[] = [];
const minutesStore = new Map<string, Minutes>();
const candidates: Candidate[] = [];
const postprocess = new Map<string, Postprocess>();
let meetingSeq = 0, participantSeq = 0, chatSeq = 0, minutesSeq = 0, candidateSeq = 0;
const chatSequenceOf = new Map<string, number>();
let meetingSettings = { defaultSensitivityClassification: "INTERNAL" as MeetingSensitivity, updatedByUserId: null as string | null, updatedAt: null as string | null, version: 1 };

function mkParticipant(meetingId: string, userId: string): Participant {
  return { participantId: id(20, ++participantSeq), meetingId, userId, participationStatus: "ACTIVE", recordAccessState: "GRANTED", sourceProjectMembershipId: null, lastProjectMembershipVersion: null, joinedRelationAt: now(), removedAt: null, recordAccessRevokedAt: null, version: 1 };
}
function seedMeeting(projectId: string, title: string, organizerUserId: string, participantIds: string[], status: MeetingStatus, sensitivity: MeetingSensitivity, offsetMinPast: number): Meeting {
  const meetingId = id(19, ++meetingSeq);
  const scheduled = new Date(Date.now() - offsetMinPast * 60000).toISOString();
  const m: Meeting = {
    meetingId, projectId, title, description: null, organizerUserId, reviewOwnerUserId: organizerUserId, status,
    scheduledStartAt: scheduled, scheduledEndAt: null, startedAt: status !== "SCHEDULED" ? scheduled : null, endedAt: status === "ENDED" ? scheduled : null,
    sensitivityClassification: sensitivity, externalAiPolicy: "INHERIT", passwordHash: null, createdAt: scheduled, updatedAt: scheduled, version: 1,
  };
  meetings.push(m);
  for (const uid of participantIds) participants.push(mkParticipant(meetingId, uid));
  const minutesId = id(21, ++minutesSeq);
  minutesStore.set(meetingId, { minutesId, meetingId, status: "NOT_STARTED", content: null, sourceGeneration: 0, transcriptArtifactId: null, transcriptGeneration: null, chatFinalSequence: null, evidenceSnapshotId: null, generatedAt: null, lastEditedBy: null, lastEditedAt: null, approvedBy: null, approvedAt: null, version: 1 });
  postprocess.set(meetingId, { meetingId, status: "NOT_STARTED", sourceGeneration: 0, stageBaseAt: 0, failureCode: null, updatedAt: scheduled, version: 1 });
  chatSequenceOf.set(meetingId, 0);
  if (status === "ENDED") {
    const pp = postprocess.get(meetingId)!;
    pp.status = "MINUTES_DRAFT"; pp.stageBaseAt = Date.now() - STAGE_ORDER.length * STAGE_MS; pp.updatedAt = scheduled;
    generateDraft(meetingId);
  }
  return m;
}
seedMeeting(SEED_PROJECT_IDS.authRevamp, "인증 시스템 킥오프", U.gyuchan, [U.gyuchan, U.wonjae], "SCHEDULED", "INTERNAL", -60);
seedMeeting(SEED_PROJECT_IDS.aiPipeline, "AI 파이프라인 설계 리뷰", U.wonjae, [U.wonjae, U.gyuchan, U.minjun, U.dayoung], "ENDED", "INTERNAL", 60 * 24);

function meeting(meetingId: string): Meeting { const m = meetings.find(x => x.meetingId === meetingId); if (!m) return fail(404, "MEETING_NOT_FOUND"); return m; }
function myParticipant(meetingId: string, userId: string): Participant | undefined { return participants.find(p => p.meetingId === meetingId && p.userId === userId); }
function currentAccess(m: Meeting, userId: string): boolean {
  const p = myParticipant(m.meetingId, userId);
  if (!p || p.recordAccessState !== "GRANTED") return false;
  const identity = byId(userId);
  if (!identity || identity.status !== "ACTIVE") return false;
  return isEffectiveProjectMember(m.projectId, userId) || p.participationStatus === "ACTIVE";
}
function requireAccess(m: Meeting, userId: string) { if (!currentAccess(m, userId)) return fail(403, "MEETING_ACCESS_DENIED"); }
function requireOrganizer(m: Meeting, userId: string) { if (m.organizerUserId !== userId) return fail(403, "MEETING_ORGANIZER_REQUIRED"); }
function requireReviewOwner(m: Meeting, userId: string) { if (m.reviewOwnerUserId !== userId) return fail(403, "REVIEW_OWNER_REQUIRED"); }

// AI(06) Permission-aware RAG용 최소 조회 — 실제로는 AI Service의 VALIDATE_MEETING_RECORD_ACCESS + GET_MEETING_CONTEXT internal capability 호출에 해당한다.
export function getMeetingContextForAi(meetingId: string, userId: string): { title: string; minutesContent: string | null; accessible: boolean } | undefined {
  const m = meetings.find(x => x.meetingId === meetingId);
  if (!m) return undefined;
  const min = minutesStore.get(meetingId);
  const minutesContent = min && min.status === "APPROVED" ? min.content : null;
  return { title: m.title, minutesContent, accessible: currentAccess(m, userId) };
}

// Document(03)의 회의 첨부 mock이 실제 회의 참가자/진행 상태를 참조하기 위한 최소 조회 —
// 실제로는 Document Service가 Meeting Service의 VALIDATE_MEETING_ATTACHMENT_MUTATION internal capability를 호출하는 것에 해당한다.
export function getMeetingAttachmentAccess(meetingId: string, userId: string): { exists: boolean; hasAccess: boolean; controlOpen: boolean } {
  const m = meetings.find(x => x.meetingId === meetingId);
  if (!m) return { exists: false, hasAccess: false, controlOpen: false };
  return { exists: true, hasAccess: currentAccess(m, userId), controlOpen: m.status === "SCHEDULED" || m.status === "IN_PROGRESS" };
}

function toMeetingResponse(m: Meeting, userId: string) {
  const p = myParticipant(m.meetingId, userId);
  const pp = postprocess.get(m.meetingId)!;
  return {
    meetingId: m.meetingId, projectId: m.projectId, title: m.title, description: m.description, organizerUserId: m.organizerUserId, reviewOwnerUserId: m.reviewOwnerUserId,
    status: m.status, scheduledStartAt: m.scheduledStartAt, scheduledEndAt: m.scheduledEndAt, startedAt: m.startedAt, endedAt: m.endedAt,
    sensitivityClassification: m.sensitivityClassification, externalAiPolicy: m.externalAiPolicy, passwordProtected: !!m.passwordHash,
    postprocessStatus: pp.status, myParticipationStatus: p?.participationStatus, myRecordAccessState: p?.recordAccessState,
    createdAt: m.createdAt, updatedAt: m.updatedAt, version: m.version,
  };
}
function toParticipantResponse(p: Participant) {
  return { participantId: p.participantId, meetingId: p.meetingId, userId: p.userId, participationStatus: p.participationStatus, recordAccessState: p.recordAccessState, sourceProjectMembershipId: p.sourceProjectMembershipId, lastProjectMembershipVersion: p.lastProjectMembershipVersion, joinedRelationAt: p.joinedRelationAt, removedAt: p.removedAt, recordAccessRevokedAt: p.recordAccessRevokedAt, version: p.version };
}
function toMinutesResponse(min: Minutes) { return { ...min }; }
// materializeRequestedAt/materializedByUserId는 mock 내부 지연 시뮬레이션용 필드라 공개 DTO엔 포함하지 않는다.
function toCandidateResponse(c: Candidate) {
  return {
    candidateId: c.candidateId, meetingId: c.meetingId, minutesId: c.minutesId, type: c.type, status: c.status, title: c.title,
    descriptionOrContent: c.descriptionOrContent, assigneeUserId: c.assigneeUserId, dueAt: c.dueAt, sourceGeneration: c.sourceGeneration,
    materializedResourceId: c.materializedResourceId, failureReasonCode: c.failureReasonCode, attemptCount: c.attemptCount,
    createdAt: c.createdAt, updatedAt: c.updatedAt, version: c.version,
  };
}
function toPostprocessResponse(p: Postprocess) { return { meetingId: p.meetingId, status: p.status, sourceGeneration: p.sourceGeneration, recordingGeneration: null, transcriptPurgeStatus: null, rawChatPurgeStatus: null, recordingPurgeStatus: null, rawHardDeleteAt: null, failureCode: p.failureCode, updatedAt: p.updatedAt, version: p.version }; }
function toRecoverySummary(m: Meeting, type: "FORCE_END" | "REVIEW_OWNER") {
  return { meetingId: m.meetingId, projectId: m.projectId, status: m.status, organizerUserId: m.organizerUserId, reviewOwnerUserId: m.reviewOwnerUserId, recoveryReasonClass: type, endOperationState: null as string | null };
}

function addCandidate(meetingId: string, minutesId: string, type: CandidateType, title: string, content: string, assigneeUserId: string | null, dueAt: string | null): Candidate {
  const c: Candidate = { candidateId: id(22, ++candidateSeq), meetingId, minutesId, type, status: "PROPOSED", title, descriptionOrContent: content, assigneeUserId, dueAt, sourceGeneration: 1, materializedResourceId: null, failureReasonCode: null, attemptCount: 0, createdAt: now(), updatedAt: now(), version: 1, materializeRequestedAt: null, materializedByUserId: null };
  candidates.push(c);
  return c;
}
function generateDraft(meetingId: string) {
  const min = minutesStore.get(meetingId)!;
  const m = meeting(meetingId);
  const msgs = chats.filter(x => x.meetingId === meetingId);
  const body = msgs.length ? msgs.map(c => `- ${c.text}`).join("\n") : "- (채팅 기록이 없어 회의 제목만으로 생성된 초안입니다)";
  min.content = `## 회의 요약\n\n"${m.title}" 회의 내용을 분석한 AI 초안입니다. 승인 전 내용을 확인해 주세요.\n\n## 주요 논의\n${body}\n\n## 결정 사항 (검토 필요)\n아래 후보를 확인 후 확정해 주세요.\n`;
  min.status = "DRAFT"; min.generatedAt = now(); min.sourceGeneration++; min.version++; min.chatFinalSequence = chatSequenceOf.get(meetingId) ?? 0;
  if (!candidates.some(c => c.meetingId === meetingId)) {
    addCandidate(meetingId, min.minutesId, "DECISION", `${m.title} 관련 결정`, "회의에서 논의된 핵심 결정 사항을 검토하고 확정해 주세요.", null, null);
    addCandidate(meetingId, min.minutesId, "TASK", "후속 조치 업무", "회의에서 언급된 후속 작업입니다. 담당자와 마감일을 확인해 주세요.", m.organizerUserId, new Date(Date.now() + 7 * 86400000).toISOString());
  }
}
function syncPostprocess(meetingId: string) {
  const p = postprocess.get(meetingId)!;
  const resolved: PostprocessStatus[] = ["MINUTES_DRAFT", "REVIEWING", "APPROVED", "AI_EGRESS_BLOCKED", "SOURCE_EXPIRED", "MANUAL_RESOLUTION", "FAILED", "NOT_STARTED"];
  if (resolved.includes(p.status)) return;
  const m = meeting(meetingId);
  const elapsed = Date.now() - p.stageBaseAt;
  const idx = Math.min(Math.floor(elapsed / STAGE_MS), STAGE_ORDER.length - 1);
  const sensitive = m.sensitivityClassification !== "INTERNAL";
  const blocked = sensitive && idx >= BLOCK_AT_INDEX;
  const target: PostprocessStatus = blocked ? "AI_EGRESS_BLOCKED" : STAGE_ORDER[idx];
  if (target === p.status) return;
  p.status = target; p.updatedAt = now(); p.version++;
  if (target === "AI_EGRESS_BLOCKED") {
    p.failureCode = "EXTERNAL_EGRESS_BLOCKED";
    const min = minutesStore.get(meetingId)!; min.status = "FAILED"; min.version++;
    emit(m.reviewOwnerUserId, "MEETING_POSTPROCESS_ATTENTION", "MEETING", meetingId, { safeParameters: { reasonCode: "AI_EGRESS_BLOCKED" }, dedupKey: `postprocess-blocked:${meetingId}` });
  } else if (target === "MINUTES_DRAFT") {
    generateDraft(meetingId);
  }
}

function findParticipantOrFail(meetingId: string, userId: string): Participant { const p = myParticipant(meetingId, userId); if (!p) return fail(404, "TARGET_USER_NOT_FOUND"); return p; }
// 실제로는 meeting-project-commands를 통해 project result consumer가 비동기로 갱신하는 전이(§MTG-API-27 Side Effects)를
// 조회 시점에 지연 해소하는 방식으로 흉내 낸다. 요청 시점엔 이미 유효성 검증을 통과했더라도, 지연 도중 project가
// archived/completed되거나 담당자가 부적격해지는 race는 실제로도 일어날 수 있는 것이라 이 시점에 다시 검증한다
// ("Project rejects invalid race" — Implementation Notes). 이 재검증이 이번 mock에서 성공/실패 시나리오를 가르는 지점이다.
function resolveMaterialization(c: Candidate) {
  if (c.status !== "MATERIALIZATION_PENDING" || c.materializeRequestedAt == null) return;
  if (Date.now() - c.materializeRequestedAt < MATERIALIZE_DELAY_MS) return;
  const m = meetings.find(x => x.meetingId === c.meetingId);
  if (!m) return;
  const creatorId = c.materializedByUserId ?? m.reviewOwnerUserId;
  const projectOk = isProjectActive(m.projectId);
  const assigneeOk = c.type !== "TASK" || !c.assigneeUserId || isTaskAssigneeEligible(m.projectId, c.assigneeUserId);
  if (!projectOk || !assigneeOk) {
    c.status = "MATERIALIZATION_FAILED";
    c.failureReasonCode = !projectOk ? "PROJECT_NOT_ACTIVE" : "ASSIGNEE_INVALID";
  } else {
    const resourceId = c.type === "TASK"
      ? materializeCandidateAsTask(m.projectId, { title: c.title, description: c.descriptionOrContent, assigneeUserId: c.assigneeUserId, dueAt: c.dueAt, sourceMeetingId: c.meetingId, sourceCandidateId: c.candidateId }, creatorId)
      : materializeCandidateAsDecision(m.projectId, { title: c.title, content: c.descriptionOrContent ?? "", sourceMeetingId: c.meetingId, sourceCandidateId: c.candidateId }, creatorId);
    c.status = "MATERIALIZED";
    c.materializedResourceId = resourceId;
  }
  c.materializeRequestedAt = null;
  c.updatedAt = now();
  c.version++;
}
function findCandidate(meetingId: string, candidateId: string): Candidate {
  const c = candidates.find(x => x.meetingId === meetingId && x.candidateId === candidateId);
  if (!c) return fail(404, "CANDIDATE_NOT_FOUND");
  resolveMaterialization(c);
  return c;
}

export function routeMeeting(o: RequestOptions, me: MockUser): unknown {
  const b: any = o.body ?? {};
  const path = o.path;
  const key = `${o.method} ${path}`;
  const q = o.query ?? {};

  if (key === "GET /api/meetings") {
    const rows = meetings
      .filter(m => currentAccess(m, me.userId))
      .filter(m => !q.projectId || m.projectId === q.projectId)
      .filter(m => !q.status || m.status === q.status)
      .sort((a, c) => (b2sort(a) - b2sort(c)));
    function b2sort(x: Meeting) { return -new Date(x.scheduledStartAt ?? x.createdAt).getTime(); }
    for (const m of rows) syncPostprocess(m.meetingId);
    const page = offsetPage(rows, q);
    return { items: page.items.map(m => toMeetingResponse(m, me.userId)), page: page.page };
  }
  if (key === "POST /api/meetings") {
    const e: FieldError[] = [];
    const title = str(e, b, "title", 1, 200); const description = str(e, b, "description", 0, 2000, false);
    if (!b.projectId) e.push({ field: "projectId", reason: "REQUIRED" });
    check(e);
    if (!isProjectActive(b.projectId)) { if (b.projectId && !isEffectiveProjectMember(b.projectId, me.userId)) return fail(404, "PROJECT_NOT_FOUND"); return fail(409, "PROJECT_NOT_ACTIVE"); }
    const role = effectiveProjectRole(b.projectId, me.userId);
    if (role !== "MANAGER" && role !== "MEMBER") return fail(403, "PROJECT_MEETING_CREATE_FORBIDDEN");
    const participantIds: string[] = Array.isArray(b.participantUserIds) ? [...new Set(b.participantUserIds as string[])] : [];
    for (const uid of participantIds) {
      if (!byId(uid)) return fail(404, "PARTICIPANT_NOT_FOUND");
      if (!isEffectiveProjectMember(b.projectId, uid)) return fail(409, "PARTICIPANT_NOT_ELIGIBLE");
    }
    const meetingId = id(19, ++meetingSeq);
    const m: Meeting = {
      meetingId, projectId: b.projectId, title: title!, description: description ?? null, organizerUserId: me.userId, reviewOwnerUserId: me.userId,
      status: "SCHEDULED", scheduledStartAt: b.scheduledStartAt ?? null, scheduledEndAt: b.scheduledEndAt ?? null, startedAt: null, endedAt: null,
      sensitivityClassification: b.sensitivityClassification ?? "INTERNAL", externalAiPolicy: b.externalAiPolicy ?? "INHERIT",
      passwordHash: b.password ? b.password : null, createdAt: now(), updatedAt: now(), version: 1,
    };
    meetings.push(m);
    participants.push(mkParticipant(meetingId, me.userId));
    for (const uid of participantIds) if (uid !== me.userId) {
      participants.push(mkParticipant(meetingId, uid));
      emit(uid, "MEETING_PARTICIPANT_ADDED", "MEETING", meetingId, { actorUserId: me.userId, safeParameters: { scheduledAt: m.scheduledStartAt } });
    }
    minutesStore.set(meetingId, { minutesId: id(21, ++minutesSeq), meetingId, status: "NOT_STARTED", content: null, sourceGeneration: 0, transcriptArtifactId: null, transcriptGeneration: null, chatFinalSequence: null, evidenceSnapshotId: null, generatedAt: null, lastEditedBy: null, lastEditedAt: null, approvedBy: null, approvedAt: null, version: 1 });
    postprocess.set(meetingId, { meetingId, status: "NOT_STARTED", sourceGeneration: 0, stageBaseAt: 0, failureCode: null, updatedAt: now(), version: 1 });
    chatSequenceOf.set(meetingId, 0);
    return toMeetingResponse(m, me.userId);
  }

  let m2 = /^\/api\/meetings\/([^/]+)$/.exec(path);
  if (m2) {
    const m = meeting(m2[1]);
    if (o.method === "GET") { requireAccess(m, me.userId); syncPostprocess(m.meetingId); return toMeetingResponse(m, me.userId); }
    requireOrganizer(m, me.userId);
    if (m.status !== "SCHEDULED" && m.status !== "IN_PROGRESS") return fail(409, "MEETING_STATE_NOT_MUTABLE");
    if (m.status === "IN_PROGRESS") { for (const f of ["title", "description", "scheduledStartAt", "scheduledEndAt", "externalAiPolicy"]) if (b[f] !== undefined) return fail(409, "MEETING_FIELD_UPDATE_NOT_ALLOWED_IN_PROGRESS"); }
    if (b.sensitivityClassification && SENS_RANK[b.sensitivityClassification as MeetingSensitivity] < SENS_RANK[m.sensitivityClassification]) return fail(409, "SENSITIVITY_DOWNGRADE_FORBIDDEN");
    const row = versioned(m, b, "MEETING_NOT_FOUND");
    if (b.title !== undefined) row.title = b.title;
    if (b.description !== undefined) row.description = b.description;
    if (b.scheduledStartAt !== undefined) row.scheduledStartAt = b.scheduledStartAt;
    if (b.scheduledEndAt !== undefined) row.scheduledEndAt = b.scheduledEndAt;
    if (b.sensitivityClassification !== undefined) row.sensitivityClassification = b.sensitivityClassification;
    if (b.externalAiPolicy !== undefined) row.externalAiPolicy = b.externalAiPolicy;
    row.version++; row.updatedAt = now();
    return toMeetingResponse(row, me.userId);
  }

  m2 = /^\/api\/meetings\/([^/]+)\/start$/.exec(path);
  if (m2) {
    const m = meeting(m2[1]); requireOrganizer(m, me.userId);
    if (m.status !== "SCHEDULED") return fail(409, "MEETING_NOT_SCHEDULED");
    if (!isProjectActive(m.projectId)) return fail(409, "PROJECT_NOT_ACTIVE");
    const row = versioned(m, b, "MEETING_NOT_FOUND");
    row.status = "IN_PROGRESS"; row.startedAt = now(); row.version++; row.updatedAt = now();
    return toMeetingResponse(row, me.userId);
  }
  m2 = /^\/api\/meetings\/([^/]+)\/end$/.exec(path);
  if (m2) {
    const m = meeting(m2[1]); requireOrganizer(m, me.userId);
    if (m.status !== "IN_PROGRESS") return fail(409, "MEETING_NOT_IN_PROGRESS");
    m.status = "ENDED"; m.endedAt = now(); m.version++; m.updatedAt = now();
    chatSequenceOf.set(m.meetingId, chatSequenceOf.get(m.meetingId) ?? 0);
    const pp = postprocess.get(m.meetingId)!;
    pp.status = "WAITING_EVIDENCE_SNAPSHOT"; pp.stageBaseAt = Date.now(); pp.sourceGeneration = 1; pp.updatedAt = now(); pp.version++;
    const min = minutesStore.get(m.meetingId)!; min.status = "PROCESSING"; min.version++;
    return { meeting: toMeetingResponse(m, me.userId), endOperationId: crypto.randomUUID(), evidenceSnapshotId: crypto.randomUUID(), postprocess: toPostprocessResponse(pp) };
  }
  m2 = /^\/api\/meetings\/([^/]+)\/cancel$/.exec(path);
  if (m2) {
    const m = meeting(m2[1]); requireOrganizer(m, me.userId);
    if (m.status !== "SCHEDULED") return fail(409, "MEETING_NOT_SCHEDULED");
    const row = versioned(m, b, "MEETING_NOT_FOUND");
    row.status = "CANCELED"; row.version++; row.updatedAt = now();
    return toMeetingResponse(row, me.userId);
  }
  m2 = /^\/api\/meetings\/([^/]+)\/organizer$/.exec(path);
  if (m2) {
    const m = meeting(m2[1]); requireOrganizer(m, me.userId);
    if (m.status !== "SCHEDULED") return fail(409, "MEETING_NOT_SCHEDULED");
    if (!byId(b.targetUserId)) return fail(404, "TARGET_USER_NOT_FOUND");
    if (b.targetUserId === m.organizerUserId) return fail(409, "SAME_ORGANIZER");
    if (!isEffectiveProjectMember(m.projectId, b.targetUserId)) return fail(409, "TARGET_NOT_PROJECT_MEMBER");
    const row = versioned(m, b, "MEETING_NOT_FOUND");
    row.organizerUserId = b.targetUserId;
    if (!myParticipant(m.meetingId, b.targetUserId)) participants.push(mkParticipant(m.meetingId, b.targetUserId));
    row.version++; row.updatedAt = now();
    return toMeetingResponse(row, me.userId);
  }

  // ── Participants ──
  m2 = /^\/api\/meetings\/([^/]+)\/participants$/.exec(path);
  if (m2) {
    const m = meeting(m2[1]);
    if (o.method === "GET") {
      requireAccess(m, me.userId);
      const rows = participants.filter(p => p.meetingId === m.meetingId && (!q.participationStatus || p.participationStatus === q.participationStatus) && (!q.recordAccessState || p.recordAccessState === q.recordAccessState));
      const page = offsetPage(rows, q);
      return { items: page.items.map(toParticipantResponse), page: page.page };
    }
    requireOrganizer(m, me.userId);
    if (m.status !== "SCHEDULED") return fail(409, "MEETING_NOT_SCHEDULED");
    if (!byId(b.userId)) return fail(404, "TARGET_USER_NOT_FOUND");
    if (participants.some(p => p.meetingId === m.meetingId && p.userId === b.userId && p.participationStatus === "ACTIVE")) return fail(409, "PARTICIPANT_ALREADY_EXISTS");
    if (!isEffectiveProjectMember(m.projectId, b.userId)) return fail(409, "TARGET_NOT_PROJECT_MEMBER");
    const p = mkParticipant(m.meetingId, b.userId);
    participants.push(p);
    emit(b.userId, "MEETING_PARTICIPANT_ADDED", "MEETING", m.meetingId, { actorUserId: me.userId, safeParameters: { scheduledAt: m.scheduledStartAt } });
    return toParticipantResponse(p);
  }
  m2 = /^\/api\/meetings\/([^/]+)\/participants\/([^/]+)$/.exec(path);
  if (m2 && o.method === "DELETE") {
    const m = meeting(m2[1]); requireOrganizer(m, me.userId);
    if (m2[2] === m.organizerUserId) return fail(409, "ORGANIZER_REMOVE_FORBIDDEN");
    const p = findParticipantOrFail(m.meetingId, m2[2]);
    if (p.participationStatus === "REMOVED") return fail(409, "PARTICIPANT_ALREADY_REMOVED");
    p.participationStatus = "REMOVED"; p.removedAt = now(); p.version++;
    emit(p.userId, "MEETING_PARTICIPATION_REMOVED", "MEETING", m.meetingId, { actorUserId: me.userId });
    return undefined;
  }
  m2 = /^\/api\/meetings\/([^/]+)\/participants\/([^/]+)\/record-access$/.exec(path);
  if (m2) {
    const m = meeting(m2[1]); requireOrganizer(m, me.userId);
    const e: FieldError[] = []; if (!["GRANTED", "REVOKED"].includes(b.state)) e.push({ field: "state", reason: "INVALID_ENUM" }); str(e, b, "reason", 1, 500); check(e);
    const target = findParticipantOrFail(m.meetingId, m2[2]);
    const row = versioned(target, b, "TARGET_USER_NOT_FOUND");
    if (row.recordAccessState === b.state) return fail(409, "RECORD_ACCESS_ALREADY_STATE");
    row.recordAccessState = b.state; row.recordAccessRevokedAt = b.state === "REVOKED" ? now() : null; row.version++;
    return toParticipantResponse(row);
  }

  // ── Password ──
  m2 = /^\/api\/meetings\/([^/]+)\/password$/.exec(path);
  if (m2) {
    const m = meeting(m2[1]); requireOrganizer(m, me.userId);
    if (m.status !== "SCHEDULED") return fail(409, "MEETING_NOT_SCHEDULED");
    if (o.method === "DELETE") { if (!m.passwordHash) return fail(409, "MEETING_PASSWORD_NOT_SET"); m.passwordHash = null; m.updatedAt = now(); return undefined; }
    const e: FieldError[] = []; const password = str(e, b, "password", 4, 64); check(e);
    const row = versioned(m, b, "MEETING_NOT_FOUND");
    row.passwordHash = password!; row.version++; row.updatedAt = now();
    return undefined;
  }

  // ── LiveKit ──
  m2 = /^\/api\/meetings\/([^/]+)\/livekit-token$/.exec(path);
  if (m2) {
    const m = meeting(m2[1]);
    if (m.status !== "IN_PROGRESS") return fail(409, "MEETING_NOT_IN_PROGRESS");
    const p = myParticipant(m.meetingId, me.userId);
    if (!p || p.participationStatus !== "ACTIVE") return fail(403, "MEETING_JOIN_DENIED");
    if (p.recordAccessState !== "GRANTED") return fail(403, "MEETING_RECORD_ACCESS_REVOKED");
    if (m.passwordHash && m.organizerUserId !== me.userId && b.password !== m.passwordHash) return fail(401, "MEETING_PASSWORD_INVALID");
    return { token: `mock-livekit-token.${m.meetingId}.${me.userId}.${Date.now()}`, expiresAt: new Date(Date.now() + 4 * 3600000).toISOString(), roomName: `room-${m.meetingId}`, participantIdentity: me.userId };
  }

  // ── Chat (replay 폴링) ──
  m2 = /^\/api\/meetings\/([^/]+)\/chat\/messages$/.exec(path);
  if (m2) {
    const m = meeting(m2[1]); requireAccess(m, me.userId);
    if (o.method === "GET") {
      const after = Number(q.afterSequence ?? 0);
      const limit = Math.min(Number(q.limit ?? 50), 100);
      const rows = chats.filter(c => c.meetingId === m.meetingId && c.streamSequence > after).sort((a, c) => a.streamSequence - c.streamSequence);
      const items = rows.slice(0, limit);
      const last = chatSequenceOf.get(m.meetingId) ?? 0;
      return { items, lastSequence: last, hasMore: rows.length > items.length };
    }
    if (m.status !== "IN_PROGRESS") return fail(409, "MEETING_CHAT_CLOSED");
    const e: FieldError[] = []; const text = str(e, b, "text", 1, 2000); check(e);
    const seq = (chatSequenceOf.get(m.meetingId) ?? 0) + 1;
    chatSequenceOf.set(m.meetingId, seq);
    const msg: ChatMsg = { messageId: crypto.randomUUID(), meetingId: m.meetingId, senderUserId: me.userId, text: text!, streamSequence: seq, sentAt: now() };
    chats.push(msg);
    return msg;
  }

  // ── Minutes ──
  m2 = /^\/api\/meetings\/([^/]+)\/minutes$/.exec(path);
  if (m2) {
    const m = meeting(m2[1]); syncPostprocess(m.meetingId);
    const min = minutesStore.get(m.meetingId)!;
    if (o.method === "GET") { requireAccess(m, me.userId); return toMinutesResponse(min); }
    requireReviewOwner(m, me.userId);
    if (min.status !== "DRAFT") return fail(409, "MINUTES_NOT_DRAFT");
    if (candidates.some(c => c.meetingId === m.meetingId && c.status === "CONFIRMED")) return fail(409, "CONFIRMED_CANDIDATE_EXISTS");
    const e: FieldError[] = []; const content = str(e, b, "content", 1, 20000); check(e);
    const row = versioned(min, b, "MEETING_MINUTES_NOT_FOUND");
    row.content = content!; row.lastEditedBy = me.userId; row.lastEditedAt = now(); row.version++;
    return toMinutesResponse(row);
  }
  m2 = /^\/api\/meetings\/([^/]+)\/minutes\/approve$/.exec(path);
  if (m2) {
    const m = meeting(m2[1]); requireReviewOwner(m, me.userId);
    const min = minutesStore.get(m.meetingId)!;
    if (min.status !== "DRAFT") return fail(409, "MINUTES_NOT_DRAFT");
    const row = versioned(min, b, "MEETING_MINUTES_NOT_FOUND");
    row.status = "APPROVED"; row.approvedBy = me.userId; row.approvedAt = now(); row.version++;
    const pp = postprocess.get(m.meetingId)!; pp.status = "APPROVED"; pp.updatedAt = now(); pp.version++;
    for (const p of participants.filter(x => x.meetingId === m.meetingId && x.participationStatus === "ACTIVE"))
      emit(p.userId, "MEETING_MINUTES_APPROVED", "MEETING_MINUTES", row.minutesId, { secondaryResourceType: "MEETING", secondaryResourceId: m.meetingId, actorUserId: me.userId });
    return toMinutesResponse(row);
  }
  m2 = /^\/api\/meetings\/([^/]+)\/minutes\/regenerate$/.exec(path);
  if (m2) {
    const m = meeting(m2[1]); requireReviewOwner(m, me.userId);
    const min = minutesStore.get(m.meetingId)!;
    if (min.status === "APPROVED") return fail(409, "MINUTES_APPROVED");
    min.status = "PROCESSING"; min.version++;
    generateDraft(m.meetingId);
    const pp = postprocess.get(m.meetingId)!; pp.status = "MINUTES_DRAFT"; pp.sourceGeneration++; pp.updatedAt = now(); pp.version++;
    return toPostprocessResponse(pp);
  }

  // ── Candidates ──
  m2 = /^\/api\/meetings\/([^/]+)\/candidates$/.exec(path);
  if (m2) {
    const m = meeting(m2[1]); requireAccess(m, me.userId); syncPostprocess(m.meetingId);
    for (const c of candidates) if (c.meetingId === m.meetingId) resolveMaterialization(c);
    const rows = candidates.filter(c => c.meetingId === m.meetingId && (!q.type || c.type === q.type) && (!q.status || c.status === q.status));
    const page = offsetPage(rows, q);
    return { items: page.items.map(toCandidateResponse), page: page.page };
  }
  m2 = /^\/api\/meetings\/([^/]+)\/candidates\/([^/]+)$/.exec(path);
  if (m2) {
    const m = meeting(m2[1]); requireReviewOwner(m, me.userId);
    const c = findCandidate(m.meetingId, m2[2]);
    if (c.status !== "PROPOSED" && c.status !== "EDITED") return fail(409, "CANDIDATE_NOT_EDITABLE");
    const e: FieldError[] = []; const title = str(e, b, "title", 1, 200); check(e);
    const row = versioned(c, b, "CANDIDATE_NOT_FOUND");
    row.title = title!; row.descriptionOrContent = b.descriptionOrContent ?? row.descriptionOrContent;
    if (b.assigneeUserId !== undefined) row.assigneeUserId = b.assigneeUserId;
    if (b.dueAt !== undefined) row.dueAt = b.dueAt;
    row.status = "EDITED"; row.version++; row.updatedAt = now();
    return toCandidateResponse(row);
  }
  m2 = /^\/api\/meetings\/([^/]+)\/candidates\/([^/]+)\/confirm$/.exec(path);
  if (m2) {
    const m = meeting(m2[1]); requireReviewOwner(m, me.userId);
    const min = minutesStore.get(m.meetingId)!;
    if (min.status !== "APPROVED") return fail(409, "MINUTES_NOT_APPROVED");
    const c = findCandidate(m.meetingId, m2[2]);
    if (c.status !== "PROPOSED" && c.status !== "EDITED") return fail(409, "CANDIDATE_NOT_CONFIRMABLE");
    if (c.type === "TASK" && c.assigneeUserId && !isTaskAssigneeEligible(m.projectId, c.assigneeUserId)) return fail(409, "ASSIGNEE_INVALID");
    const row = versioned(c, b, "CANDIDATE_NOT_FOUND");
    row.status = "CONFIRMED"; row.version++; row.updatedAt = now();
    return toCandidateResponse(row);
  }
  m2 = /^\/api\/meetings\/([^/]+)\/candidates\/([^/]+)\/reject$/.exec(path);
  if (m2) {
    const m = meeting(m2[1]); requireReviewOwner(m, me.userId);
    const c = findCandidate(m.meetingId, m2[2]);
    if (c.status === "MATERIALIZATION_PENDING" || c.status === "MATERIALIZED") return fail(409, "CANDIDATE_NOT_REJECTABLE");
    const row = versioned(c, b, "CANDIDATE_NOT_FOUND");
    row.status = "REJECTED"; row.version++; row.updatedAt = now();
    return toCandidateResponse(row);
  }
  m2 = /^\/api\/meetings\/([^/]+)\/candidates\/([^/]+)\/materialize$/.exec(path);
  if (m2) {
    const m = meeting(m2[1]); requireReviewOwner(m, me.userId);
    const min = minutesStore.get(m.meetingId)!;
    if (min.status !== "APPROVED") return fail(409, "MINUTES_NOT_APPROVED");
    const c = findCandidate(m.meetingId, m2[2]);
    if (c.status === "MATERIALIZATION_PENDING") return fail(409, "CANDIDATE_NOT_CONFIRMED"); // 처리 중 중복 확정 방지
    if (c.status === "MATERIALIZED") return fail(409, "ALREADY_MATERIALIZED");
    if (c.status !== "CONFIRMED" && c.status !== "MATERIALIZATION_FAILED") return fail(409, "CANDIDATE_NOT_CONFIRMED");
    if (!isProjectActive(m.projectId)) return fail(409, "PROJECT_NOT_ACTIVE");
    if (c.type === "TASK" && c.assigneeUserId && !isTaskAssigneeEligible(m.projectId, c.assigneeUserId)) return fail(409, "ASSIGNEE_INVALID");
    const row = versioned(c, b, "CANDIDATE_NOT_FOUND");
    row.attemptCount++;
    row.status = "MATERIALIZATION_PENDING";
    row.materializeRequestedAt = Date.now();
    row.materializedByUserId = me.userId;
    row.failureReasonCode = null;
    row.version++; row.updatedAt = now();
    return toCandidateResponse(row); // 202 — mock.ts의 ACCEPTED_PATTERNS가 상태 코드를 붙인다
  }

  // ── Postprocess ──
  m2 = /^\/api\/meetings\/([^/]+)\/postprocess$/.exec(path);
  if (m2) {
    const m = meeting(m2[1]); requireAccess(m, me.userId); syncPostprocess(m.meetingId);
    return toPostprocessResponse(postprocess.get(m.meetingId)!);
  }
  m2 = /^\/api\/meetings\/([^/]+)\/postprocess\/retry$/.exec(path);
  if (m2) {
    const m = meeting(m2[1]); requireReviewOwner(m, me.userId);
    const pp = postprocess.get(m.meetingId)!;
    if (pp.status !== "FAILED") return fail(409, "POSTPROCESS_NOT_RETRYABLE");
    pp.status = "WAITING_RECORDING"; pp.stageBaseAt = Date.now() - STAGE_MS; pp.failureCode = null; pp.updatedAt = now(); pp.version++;
    return toPostprocessResponse(pp);
  }

  // ── Manager/Admin recovery + settings는 API 계약만 구현하고 화면은 아직 없다 ──
  m2 = /^\/api\/meetings\/([^/]+)\/force-end$/.exec(path);
  if (m2) {
    const m = meeting(m2[1]);
    if (effectiveProjectRole(m.projectId, me.userId) !== "MANAGER") return fail(403, "PROJECT_MANAGER_FORCE_END_REQUIRED");
    if (m.status !== "IN_PROGRESS") return fail(409, "MEETING_NOT_IN_PROGRESS");
    const e: FieldError[] = []; str(e, b, "reason", 1, 500); check(e);
    m.status = "ENDED"; m.endedAt = now(); m.version++; m.updatedAt = now();
    const pp = postprocess.get(m.meetingId)!; pp.status = "WAITING_EVIDENCE_SNAPSHOT"; pp.stageBaseAt = Date.now(); pp.sourceGeneration = 1; pp.updatedAt = now(); pp.version++;
    const min = minutesStore.get(m.meetingId)!; min.status = "PROCESSING"; min.version++;
    return { meeting: toMeetingResponse(m, me.userId), endOperationId: crypto.randomUUID(), evidenceSnapshotId: crypto.randomUUID(), postprocess: toPostprocessResponse(pp) };
  }
  m2 = /^\/api\/meetings\/([^/]+)\/review-owner-recovery$/.exec(path);
  if (m2) {
    const m = meeting(m2[1]);
    if (effectiveProjectRole(m.projectId, me.userId) !== "MANAGER") return fail(403, "PROJECT_MANAGER_REQUIRED");
    if (!byId(b.targetUserId)) return fail(404, "TARGET_USER_NOT_FOUND");
    if (!isEffectiveProjectMember(m.projectId, b.targetUserId)) return fail(409, "TARGET_NOT_PROJECT_MEMBER");
    const target = myParticipant(m.meetingId, b.targetUserId);
    if (!target || target.recordAccessState !== "GRANTED") return fail(409, "TARGET_RECORD_ACCESS_REQUIRED");
    if (byId(m.reviewOwnerUserId)?.status === "ACTIVE" && m.reviewOwnerUserId !== m.organizerUserId) return fail(409, "REVIEW_OWNER_RECOVERY_NOT_REQUIRED");
    m.reviewOwnerUserId = b.targetUserId; m.version++; m.updatedAt = now();
    return toMeetingResponse(m, me.userId);
  }

  // ── 회사 Admin 전용 복구/설정 경로 (mock.ts가 stepUp 처리 후 위임) ──
  if (key === "GET /api/admin/meetings/recovery") {
    const type = q.type as "FORCE_END" | "REVIEW_OWNER" | undefined;
    const rows: ReturnType<typeof toRecoverySummary>[] = [];
    for (const mt of meetings) {
      if (type !== "REVIEW_OWNER" && mt.status === "IN_PROGRESS") rows.push(toRecoverySummary(mt, "FORCE_END"));
      if (type !== "FORCE_END" && byId(mt.reviewOwnerUserId)?.status !== "ACTIVE") rows.push(toRecoverySummary(mt, "REVIEW_OWNER"));
    }
    const page = offsetPage(rows, q);
    return { items: page.items, page: page.page };
  }
  m2 = /^\/api\/admin\/meetings\/([^/]+)\/force-end$/.exec(path);
  if (m2) {
    const m = meeting(m2[1]);
    if (m.status !== "IN_PROGRESS") return fail(409, "MEETING_NOT_IN_PROGRESS");
    const e: FieldError[] = []; str(e, b, "reason", 1, 500); check(e);
    m.status = "ENDED"; m.endedAt = now(); m.version++; m.updatedAt = now();
    const pp = postprocess.get(m.meetingId)!; pp.status = "WAITING_EVIDENCE_SNAPSHOT"; pp.stageBaseAt = Date.now(); pp.sourceGeneration = 1; pp.updatedAt = now(); pp.version++;
    const min = minutesStore.get(m.meetingId)!; min.status = "PROCESSING"; min.version++;
    return { meeting: toMeetingResponse(m, me.userId), endOperationId: crypto.randomUUID(), evidenceSnapshotId: crypto.randomUUID(), postprocess: toPostprocessResponse(pp) };
  }
  m2 = /^\/api\/admin\/meetings\/([^/]+)\/review-owner-recovery$/.exec(path);
  if (m2) {
    const m = meeting(m2[1]);
    if (!byId(b.targetUserId)) return fail(404, "TARGET_USER_NOT_FOUND");
    if (!isEffectiveProjectMember(m.projectId, b.targetUserId)) return fail(409, "TARGET_NOT_PROJECT_MEMBER");
    m.reviewOwnerUserId = b.targetUserId; m.version++; m.updatedAt = now();
    return toMeetingResponse(m, me.userId);
  }
  if (key === "GET /api/admin/meeting-settings") return { ...meetingSettings };
  if (key === "PUT /api/admin/meeting-settings") {
    if (!["INTERNAL", "CONFIDENTIAL", "PII", "CORE_TRADE_SECRET"].includes(b.defaultSensitivityClassification)) return fail(422, "VALIDATION_FAILED");
    if (b.version !== meetingSettings.version) return fail(409, "VERSION_CONFLICT");
    meetingSettings = { defaultSensitivityClassification: b.defaultSensitivityClassification, updatedByUserId: me.userId, updatedAt: now(), version: meetingSettings.version + 1 };
    return { ...meetingSettings };
  }

  return fail(404, "NOT_FOUND");
}
