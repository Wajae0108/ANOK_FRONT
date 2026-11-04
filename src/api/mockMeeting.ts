// 미팅 서비스(FRONTEND_00~04 명세) 기준 인메모리 mock.
//  · 채팅: GET /chat/stream 은 실제 ReadableStream 기반 text/event-stream 으로 흉내 낸다(streamMeetingChat). 속도 제한(10개 + 초당 1개)·clientMessageId 중복 방지·동시 스트림 2개 제한을 둔다.
//  · 후처리: 실제 STT/LLM 없이 경과 시간으로 단계를 전진시키고, MINUTES_DRAFT 도달 뒤 **몇 초 지나서야** 후보가 생긴다(명세 10-1: 상태로는 구분되지 않는다).
//    회의록을 고치거나 다시 만들면 이전 후보가 사라지고 새 후보가 뒤늦게 생긴다.
//  · 회의록은 초안(DRAFT)이면 검토 담당자만, 승인(APPROVED) 후에는 기록 접근권이 있는 참가자 누구나 읽는다. 후보는 검토 담당자만 본다.
//  · materialize는 202 PENDING → 조회 시점에 지연을 해소하는 방식으로 비동기를 재현한다(resolveMaterialization).
//  · 보고서: 기본 보고서(hasTemplate:false)는 요청 즉시 SUCCEEDED, 회사 양식 보고서는 PENDING → PROCESSING → SUCCEEDED 로 시간에 따라 진행한다.
import type { RequestOptions } from "./http";
import { byId, check, fail, id, invalid, offsetPage, str, versioned } from "./mockCore";
import type { MockUser } from "./mockCore";
import { emit } from "./mockNotification";
import {
  effectiveProjectRole, isEffectiveProjectMember, isProjectActive, isTaskAssigneeEligible,
  materializeCandidateAsDecision, materializeCandidateAsTask, SEED_PROJECT_IDS,
} from "./mockProject";
import { getMeetingTemplateFile } from "./mockTemplate";
import type {
  CandidateReviewReason, CandidateStatus, CandidateType, MeetingExternalAiPolicy, MeetingSensitivity, MeetingStatus,
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
  participantId: string; meetingId: string; userId: string; meetingRole: "PARTICIPANT" | "VIEWER"; participationStatus: ParticipationStatus; recordAccessState: RecordAccessState;
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
  descriptionOrContent: string | null; assigneeUserId: string | null; dueAt: string | null; reviewReason: CandidateReviewReason | null; sourceGeneration: number;
  materializedResourceId: string | null; failureReasonCode: string | null; attemptCount: number; createdAt: string; updatedAt: string; version: number;
  // materialize는 실제로 Kafka 비동기(202 PENDING → project result consumer가 MATERIALIZED|MATERIALIZATION_FAILED로 갱신)라
  // mock도 요청 시각을 기록해두고 일정 시간 뒤 조회 시점에 지연 해소한다(공개 API 응답에는 포함하지 않음 — toCandidateResponse 참고).
  materializeRequestedAt: number | null; materializedByUserId: string | null;
}
interface Postprocess {
  meetingId: string; status: PostprocessStatus; sourceGeneration: number; stageBaseAt: number; failureCode: string | null; updatedAt: string; version: number;
  regenReadyAt: number | null; rawHardDeleteAt: string | null;
}
interface ReportField { key: string; label: string; kind: string; source: string; columns: string[] | null; options: string[] | null; filled: boolean; value: unknown }
interface Report {
  reportId: string; meetingId: string; templateId: string; status: "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED"; failureCode: string | null;
  requestedAt: string; completedAt: string | null; fields: ReportField[] | null; version: number;
  requestedMs: number; kind: "default" | "template"; pendingFields: ReportField[] | null; analysis: { startedMs: number; hash: string };
}

const now = () => new Date().toISOString();
const U = { wonjae: id(1, 1), gyuchan: id(1, 2), minjun: id(1, 4), dayoung: id(1, 5) };
const SENS_RANK: Record<MeetingSensitivity, number> = { INTERNAL: 0, CONFIDENTIAL: 1, PII: 2, CORE_TRADE_SECRET: 3 };
const STAGE_ORDER: PostprocessStatus[] = ["WAITING_EVIDENCE_SNAPSHOT", "WAITING_RECORDING", "STT_QUEUED", "STT_PROCESSING", "STT_READY", "MINUTES_QUEUED", "MINUTES_PROCESSING", "MINUTES_DRAFT"];
const STAGE_MS = 1200;
const MATERIALIZE_DELAY_MS = 600; // candidate materialize의 202 PENDING → MATERIALIZED|MATERIALIZATION_FAILED 지연 시뮬레이션
const CANDIDATE_DELAY_MS = 1200; // 회의록 초안이 나온 뒤 후보가 뒤늦게 생기는 지연
const REGEN_MS = 1500; // 회의록 재생성 소요
const BLOCK_AT_INDEX = STAGE_ORDER.indexOf("MINUTES_QUEUED"); // 민감 회의는 minutes 생성(외부 AI 필요) 직전에 멈춘다
const RAW_KEEP_MS = 7 * 86400000;
const PASSWORD_MAX_FAILS = 5;
const PASSWORD_WINDOW_MS = 15 * 60 * 1000;
const CHAT_BUCKET = 10; // 한 번에 10개까지, 이후 초당 1개
const CHAT_STREAM_LIMIT = 2;
const TZ_RE = /([zZ]|[+-]\d{2}:?\d{2})$/;

const meetings: Meeting[] = [];
const participants: Participant[] = [];
const chats: ChatMsg[] = [];
const minutesStore = new Map<string, Minutes>();
const candidates: Candidate[] = [];
const postprocess = new Map<string, Postprocess>();
const reports = new Map<string, Report>();
const reportRequests = new Map<string, number>();
const candidateReadyAt = new Map<string, number>(); // meetingId → 이 시각 이후 후보가 생성된다
const candidateGeneration = new Map<string, number>();
let meetingSeq = 0, participantSeq = 0, minutesSeq = 0, candidateSeq = 0;
const chatSequenceOf = new Map<string, number>();
const clientMessageIds = new Map<string, ChatMsg>(); // `${meetingId}:${userId}:${clientMessageId}` → 처음 만든 메시지
const chatBuckets = new Map<string, { tokens: number; at: number }>();
const passwordFails = new Map<string, { count: number; firstAt: number }>();
const chatStreams = new Map<string, number>(); // `${meetingId}:${userId}` → 열린 스트림 수
// 새 회의의 기본 민감도(회사 설정). 설정한 적이 없으면 INTERNAL, version 0.
let meetingSettings = { defaultSensitivityClassification: "INTERNAL" as MeetingSensitivity, updatedByUserId: null as string | null, updatedAt: null as string | null, version: 0 };

type ChatEvent = { type: "message"; msg: ChatMsg } | { type: "close"; reason: string; userId?: string };
const chatSubs = new Map<string, Set<(ev: ChatEvent) => void>>();
function publishChat(meetingId: string, ev: ChatEvent) { for (const cb of chatSubs.get(meetingId) ?? []) cb(ev); }
function closeChat(meetingId: string, reason: string, userId?: string) { publishChat(meetingId, { type: "close", reason, userId }); }

function mkParticipant(meetingId: string, userId: string, meetingRole: "PARTICIPANT" | "VIEWER" = "PARTICIPANT"): Participant {
  return { participantId: id(20, ++participantSeq), meetingId, userId, meetingRole, participationStatus: "ACTIVE", recordAccessState: "GRANTED", sourceProjectMembershipId: null, lastProjectMembershipVersion: null, joinedRelationAt: now(), removedAt: null, recordAccessRevokedAt: null, version: 1 };
}
function newMinutes(meetingId: string): Minutes {
  return { minutesId: id(21, ++minutesSeq), meetingId, status: "NOT_STARTED", content: null, sourceGeneration: 0, transcriptArtifactId: null, transcriptGeneration: null, chatFinalSequence: null, evidenceSnapshotId: null, generatedAt: null, lastEditedBy: null, lastEditedAt: null, approvedBy: null, approvedAt: null, version: 1 };
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
  minutesStore.set(meetingId, newMinutes(meetingId));
  postprocess.set(meetingId, { meetingId, status: "NOT_STARTED", sourceGeneration: 0, stageBaseAt: 0, failureCode: null, updatedAt: scheduled, version: 1, regenReadyAt: null, rawHardDeleteAt: null });
  chatSequenceOf.set(meetingId, 0);
  if (status === "ENDED") {
    const pp = postprocess.get(meetingId)!;
    pp.status = "MINUTES_DRAFT"; pp.stageBaseAt = Date.now() - STAGE_ORDER.length * STAGE_MS; pp.updatedAt = scheduled; pp.rawHardDeleteAt = new Date(Date.now() + RAW_KEEP_MS).toISOString();
    generateDraft(meetingId, 0);
  }
  return m;
}
seedMeeting(SEED_PROJECT_IDS.authRevamp, "인증 시스템 킥오프", U.gyuchan, [U.gyuchan, U.wonjae], "SCHEDULED", "INTERNAL", -60);
seedMeeting(SEED_PROJECT_IDS.aiPipeline, "AI 파이프라인 설계 리뷰", U.wonjae, [U.wonjae, U.gyuchan, U.minjun, U.dayoung], "ENDED", "INTERNAL", 60 * 24);

function meeting(meetingId: string): Meeting { const m = meetings.find(x => x.meetingId === meetingId); if (!m) return fail(404, "MEETING_NOT_FOUND"); return m; }
function myParticipant(meetingId: string, userId: string): Participant | undefined { return participants.find(p => p.meetingId === meetingId && p.userId === userId); }
// 예정·진행 중 회의는 참여(ACTIVE) + 기록 접근권(GRANTED)이 모두 필요하고, 종료·취소된 회의는 기록 접근권(GRANTED)만 있으면 된다(7-1).
function currentAccess(m: Meeting, userId: string): boolean {
  const p = myParticipant(m.meetingId, userId);
  if (!p || p.recordAccessState !== "GRANTED") return false;
  const identity = byId(userId);
  if (!identity || identity.status !== "ACTIVE") return false;
  return m.status === "SCHEDULED" || m.status === "IN_PROGRESS" ? p.participationStatus === "ACTIVE" : true;
}
function requireAccess(m: Meeting, userId: string, revokedCode = "MEETING_RECORD_ACCESS_REVOKED") {
  if (currentAccess(m, userId)) return;
  const p = myParticipant(m.meetingId, userId);
  const closed = m.status === "ENDED" || m.status === "CANCELED";
  return fail(403, closed && p && p.recordAccessState === "REVOKED" ? revokedCode : "MEETING_ACCESS_DENIED");
}
// 프로젝트 멤버가 아닌 열람자(FRONTEND_06): 승인된 회의록·최종 보고서만 볼 수 있다. 멤버인지는 읽을 때마다 확인한다.
function isOutsideViewer(m: Meeting, userId: string): boolean {
  const p = myParticipant(m.meetingId, userId);
  return !!p && p.meetingRole === "VIEWER" && p.participationStatus === "ACTIVE" && !isEffectiveProjectMember(m.projectId, userId);
}
function requireNotOutsideViewer(m: Meeting, userId: string) { if (isOutsideViewer(m, userId)) return fail(403, "MEETING_VIEWER_READ_ONLY"); }
function requireOrganizer(m: Meeting, userId: string) { if (m.organizerUserId !== userId) return fail(403, "MEETING_ORGANIZER_REQUIRED"); }
// 검토 담당자인가(열람자 읽기 경로 판단용).
const isReviewOwnerOf = (m: Meeting, userId: string) => m.reviewOwnerUserId === userId;
function requireReviewOwner(m: Meeting, userId: string) { if (m.reviewOwnerUserId !== userId) return fail(403, "REVIEW_OWNER_REQUIRED"); }
// 종료 후 기록 계열(후처리·회의록·6유형)을 보는 사람: 기록 접근권이 있는 참가자. 접근권이 없으면 존재를 숨기려고 같은 403을 준다.
function requireRecordAccess(m: Meeting, userId: string, code = "MEETING_RECORD_ACCESS_REVOKED") {
  const p = myParticipant(m.meetingId, userId);
  if (!p || p.recordAccessState !== "GRANTED" || byId(userId)?.status !== "ACTIVE") return fail(403, code);
}
// 검토 담당자 부재 추정(퇴사·접근권 회수·참여 상실). 실제 서버는 현재 상태로 판단한다.
function reviewerAbsent(m: Meeting): boolean {
  const p = myParticipant(m.meetingId, m.reviewOwnerUserId);
  return byId(m.reviewOwnerUserId)?.status !== "ACTIVE" || !p || p.recordAccessState !== "GRANTED" || p.participationStatus !== "ACTIVE";
}
function organizerAbsent(m: Meeting): boolean {
  const p = myParticipant(m.meetingId, m.organizerUserId);
  return byId(m.organizerUserId)?.status !== "ACTIVE" || !p || p.recordAccessState !== "GRANTED" || p.participationStatus !== "ACTIVE" || !isEffectiveProjectMember(m.projectId, m.organizerUserId);
}
function aiBlocked(m: Meeting) { return m.sensitivityClassification !== "INTERNAL" || m.externalAiPolicy === "BLOCKED"; }

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
  return { exists: true, hasAccess: currentAccess(m, userId) && !isOutsideViewer(m, userId), controlOpen: m.status === "SCHEDULED" || m.status === "IN_PROGRESS" };
}
// 문서 서비스의 보고서 양식 올리기 권한(검토 담당자, 취소된 회의 제외).
export function getMeetingReviewAccess(meetingId: string, userId: string): { exists: boolean; canceled: boolean; isReviewOwner: boolean } {
  const m = meetings.find(x => x.meetingId === meetingId);
  if (!m) return { exists: false, canceled: false, isReviewOwner: false };
  return { exists: true, canceled: m.status === "CANCELED", isReviewOwner: m.reviewOwnerUserId === userId && currentAccess(m, userId) };
}

// 원본 녹음 합본(FRONTEND_03)의 권한·상태. 실제는 Meeting 서비스가 판단한다. 받을 수 있는 사람: 참여자(열람자는 프로젝트 멤버일 때만)와 프로젝트 담당자.
export function recordingInfo(meetingId: string, userId: string):
  | { kind: "notfound" } | { kind: "forbidden" }
  | { kind: "ok"; title: string; state: "READY" | "NOT_READY" | "UNAVAILABLE"; reasonCode: string | null } {
  const m = meetings.find(x => x.meetingId === meetingId);
  if (!m) return { kind: "notfound" };
  const p = myParticipant(meetingId, userId);
  const isManager = effectiveProjectRole(m.projectId, userId) === "MANAGER";
  const participantOk = !!p && p.participationStatus === "ACTIVE" && p.recordAccessState === "GRANTED" && byId(userId)?.status === "ACTIVE" && !isOutsideViewer(m, userId);
  if (!participantOk && !isManager) return { kind: "forbidden" };
  if (m.status !== "ENDED") return { kind: "ok", title: m.title, state: "NOT_READY", reasonCode: "RECORDING_NOT_READY" };
  syncPostprocess(meetingId);
  const pp = postprocess.get(meetingId)!;
  if (["WAITING_EVIDENCE_SNAPSHOT", "WAITING_RECORDING"].includes(pp.status)) return { kind: "ok", title: m.title, state: "NOT_READY", reasonCode: "RECORDING_NOT_READY" };
  if (pp.failureCode === "RECORDING_FAILED" || pp.status === "SOURCE_EXPIRED" || (pp.rawHardDeleteAt && Date.parse(pp.rawHardDeleteAt) <= Date.now())) return { kind: "ok", title: m.title, state: "UNAVAILABLE", reasonCode: "RECORDING_UNAVAILABLE" };
  return { kind: "ok", title: m.title, state: "READY", reasonCode: null };
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
  return { participantId: p.participantId, meetingId: p.meetingId, userId: p.userId, meetingRole: p.meetingRole, displayName: byId(p.userId)?.displayName ?? null, participationStatus: p.participationStatus, recordAccessState: p.recordAccessState, sourceProjectMembershipId: p.sourceProjectMembershipId, lastProjectMembershipVersion: p.lastProjectMembershipVersion, joinedRelationAt: p.joinedRelationAt, removedAt: p.removedAt, recordAccessRevokedAt: p.recordAccessRevokedAt, version: p.version };
}
function toMinutesResponse(min: Minutes) { return { ...min }; }
// materializeRequestedAt/materializedByUserId는 mock 내부 지연 시뮬레이션용 필드라 공개 DTO엔 포함하지 않는다.
function toCandidateResponse(c: Candidate) {
  return {
    candidateId: c.candidateId, meetingId: c.meetingId, minutesId: c.minutesId, type: c.type, status: c.status, title: c.title,
    descriptionOrContent: c.descriptionOrContent, assigneeUserId: c.assigneeUserId, dueAt: c.dueAt, reviewReason: c.reviewReason, sourceGeneration: c.sourceGeneration,
    materializedResourceId: c.materializedResourceId, failureReasonCode: c.failureReasonCode, attemptCount: c.attemptCount,
    createdAt: c.createdAt, updatedAt: c.updatedAt, version: c.version,
  };
}
// failureCode는 검토 담당자에게만 보인다.
function toPostprocessResponse(p: Postprocess, viewerIsReviewer = true) {
  return { meetingId: p.meetingId, status: p.status, sourceGeneration: p.sourceGeneration, recordingGeneration: null, transcriptPurgeStatus: "RETAINED", rawChatPurgeStatus: "RETAINED", recordingPurgeStatus: "RETAINED", rawHardDeleteAt: p.rawHardDeleteAt, failureCode: viewerIsReviewer ? p.failureCode : null, updatedAt: p.updatedAt, version: p.version };
}
function toRecoverySummary(m: Meeting, type: "FORCE_END" | "REVIEW_OWNER") {
  return {
    meetingId: m.meetingId, projectId: m.projectId, status: m.status, organizerUserId: m.organizerUserId, reviewOwnerUserId: m.reviewOwnerUserId,
    recoveryReasonClass: type === "FORCE_END" ? "STUCK_IN_PROGRESS" : "REVIEW_OWNER_UNAVAILABLE", endOperationState: null as string | null,
    timestamps: { startedAt: m.startedAt, endedAt: m.endedAt, updatedAt: m.updatedAt },
  };
}
const endResponse = (m: Meeting, userId: string) => ({ meeting: toMeetingResponse(m, userId), endOperationId: crypto.randomUUID(), evidenceSnapshotId: crypto.randomUUID(), postprocess: toPostprocessResponse(postprocess.get(m.meetingId)!) });

function addCandidate(meetingId: string, minutesId: string, type: CandidateType, title: string, content: string, assigneeUserId: string | null, dueAt: string | null, generation: number, reviewReason: CandidateReviewReason | null = null): Candidate {
  const c: Candidate = { candidateId: id(22, ++candidateSeq), meetingId, minutesId, type, status: "PROPOSED", title, descriptionOrContent: content, assigneeUserId, dueAt, reviewReason, sourceGeneration: generation, materializedResourceId: null, failureReasonCode: null, attemptCount: 0, createdAt: now(), updatedAt: now(), version: 1, materializeRequestedAt: null, materializedByUserId: null };
  candidates.push(c);
  return c;
}
// 후보는 회의록 초안이 나온 뒤 몇 초 지나서야 생긴다. 조회할 때 시간이 지났으면 그때 만든다(명세 10-1: REVIEWING이어도 후보는 0건일 수 있다).
function maybeGenerateCandidates(meetingId: string) {
  const readyAt = candidateReadyAt.get(meetingId);
  if (readyAt == null || Date.now() < readyAt) return;
  candidateReadyAt.delete(meetingId);
  const m = meeting(meetingId);
  const min = minutesStore.get(meetingId)!;
  if (aiBlocked(m) || (min.status !== "DRAFT" && min.status !== "APPROVED")) return;
  const gen = candidateGeneration.get(meetingId) ?? 1;
  addCandidate(meetingId, min.minutesId, "DECISION", `${m.title} 관련 결정`, "회의에서 논의된 핵심 결정 사항을 검토하고 확정해 주세요.", null, null, gen);
  addCandidate(meetingId, min.minutesId, "TASK", "후속 조치 업무", "회의에서 언급된 후속 작업입니다. 담당자와 마감일을 확인해 주세요.", m.organizerUserId, new Date(Date.now() + 7 * 86400000).toISOString(), gen);
}
// 새 회의록 세대 — 이전 세대의 아직 손보지 않은(PROPOSED·EDITED) 후보는 사라지고, 새 후보는 뒤늦게 생긴다.
function resetCandidates(meetingId: string, delayMs = CANDIDATE_DELAY_MS) {
  for (let i = candidates.length - 1; i >= 0; i--) if (candidates[i].meetingId === meetingId && (candidates[i].status === "PROPOSED" || candidates[i].status === "EDITED")) candidates.splice(i, 1);
  candidateGeneration.set(meetingId, (candidateGeneration.get(meetingId) ?? 0) + 1);
  candidateReadyAt.set(meetingId, Date.now() + delayMs);
}
function generateDraft(meetingId: string, candidateDelayMs = CANDIDATE_DELAY_MS) {
  const min = minutesStore.get(meetingId)!;
  const m = meeting(meetingId);
  const msgs = chats.filter(x => x.meetingId === meetingId);
  const body = msgs.length ? msgs.map(c => `- ${c.text}`).join("\n") : "- (채팅 기록이 없어 회의 제목만으로 생성된 초안입니다)";
  min.content = `## 회의 요약\n\n"${m.title}" 회의 내용을 분석한 AI 초안입니다. 승인 전 내용을 확인해 주세요.\n\n## 주요 논의\n${body}\n\n## 결정 사항 (검토 필요)\n아래 후보를 확인 후 확정해 주세요.\n`;
  min.status = "DRAFT"; min.generatedAt = now(); min.sourceGeneration++; min.version++; min.chatFinalSequence = chatSequenceOf.get(meetingId) ?? 0;
  if (!aiBlocked(m)) resetCandidates(meetingId, candidateDelayMs);
}
function syncPostprocess(meetingId: string) {
  const p = postprocess.get(meetingId)!;
  // 회의록 재생성이 끝났다.
  if (p.regenReadyAt != null && Date.now() >= p.regenReadyAt) {
    p.regenReadyAt = null; generateDraft(meetingId); p.status = "MINUTES_DRAFT"; p.sourceGeneration++; p.updatedAt = now(); p.version++;
    return;
  }
  const resolved: PostprocessStatus[] = ["MINUTES_DRAFT", "REVIEWING", "APPROVED", "AI_EGRESS_BLOCKED", "SOURCE_EXPIRED", "MANUAL_RESOLUTION", "FAILED", "NOT_STARTED"];
  if (resolved.includes(p.status) || p.regenReadyAt != null) return;
  const m = meeting(meetingId);
  const elapsed = Date.now() - p.stageBaseAt;
  const idx = Math.min(Math.floor(elapsed / STAGE_MS), STAGE_ORDER.length - 1);
  const blocked = aiBlocked(m) && idx >= BLOCK_AT_INDEX;
  const target: PostprocessStatus = blocked ? "AI_EGRESS_BLOCKED" : STAGE_ORDER[idx];
  if (target === p.status) return;
  p.status = target; p.updatedAt = now(); p.version++;
  if (target === "AI_EGRESS_BLOCKED") {
    p.failureCode = "AI_EGRESS_BLOCKED";
    const min = minutesStore.get(meetingId)!; min.status = "FAILED"; min.version++;
    emit(m.reviewOwnerUserId, "MEETING_POSTPROCESS_ATTENTION", "MEETING", meetingId, { safeParameters: { reasonCode: "AI_EGRESS_BLOCKED" }, dedupKey: `postprocess-blocked:${meetingId}` });
  } else if (target === "MINUTES_DRAFT") {
    generateDraft(meetingId);
  }
}
function startPostprocess(m: Meeting) {
  const pp = postprocess.get(m.meetingId)!;
  pp.status = "WAITING_EVIDENCE_SNAPSHOT"; pp.stageBaseAt = Date.now(); pp.sourceGeneration = 1; pp.updatedAt = now(); pp.version++;
  pp.rawHardDeleteAt = new Date(Date.now() + RAW_KEEP_MS).toISOString();
  const min = minutesStore.get(m.meetingId)!; min.status = "PROCESSING"; min.version++;
}
// 종료: 채팅 스트림을 닫고(서버가 `close` 이벤트), 후처리를 시작한다.
function finishMeeting(m: Meeting) {
  m.status = "ENDED"; m.endedAt = now(); m.version++; m.updatedAt = now();
  chatSequenceOf.set(m.meetingId, chatSequenceOf.get(m.meetingId) ?? 0);
  startPostprocess(m);
  closeChat(m.meetingId, "MEETING_ENDED");
}

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
    emit(m.reviewOwnerUserId, "CANDIDATE_MATERIALIZATION_FAILED", "MEETING", m.meetingId, { safeParameters: { reasonCode: c.failureReasonCode } });
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

// ───────────────────────── 보고서 ─────────────────────────
const nameOf = (userId: string | null | undefined) => (userId && byId(userId)?.displayName) || "";
const kstDate = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
const CONFIRMED = new Set<CandidateStatus>(["CONFIRMED", "MATERIALIZATION_PENDING", "MATERIALIZED", "MATERIALIZATION_FAILED"]);
const field = (key: string, label: string, kind: string, value: unknown, extra: Partial<ReportField> = {}): ReportField =>
  ({ key, label, kind, source: "SERVER", columns: null, options: null, filled: value != null && !(Array.isArray(value) && value.length === 0) && value !== "", value: value === "" || (Array.isArray(value) && value.length === 0) ? null : value, ...extra });
// 참석자: 참여 중이고 기록 접근권이 있는 사람, 검토 담당자가 맨 앞. 이름이 없는 사람은 빠진다.
function attendeeNames(m: Meeting): string[] {
  const live = participants.filter(p => p.meetingId === m.meetingId && p.participationStatus === "ACTIVE" && p.recordAccessState === "GRANTED");
  const ordered = [...live.filter(p => p.userId === m.reviewOwnerUserId), ...live.filter(p => p.userId !== m.reviewOwnerUserId)];
  return ordered.map(p => nameOf(p.userId)).filter(Boolean).slice(0, 100);
}
// 회의록의 "## 다음 단계" 구역 줄들(F10). 구역이 없으면 비어 있다.
function nextStepLines(content: string | null | undefined): string[] {
  const out: string[] = []; let inSec = false;
  for (const line of (content ?? "").split(/\r?\n/)) {
    if (/^#{1,6}\s*다음\s*단계\s*$/.test(line.trim())) { inSec = true; continue; }
    if (inSec && /^#{1,6}\s/.test(line.trim())) break;
    const t = line.replace(/^\s*[-*•]\s*/, "").trim();
    if (inSec && t) out.push(t);
  }
  return out.slice(0, 50);
}
function buildDefaultReport(m: Meeting, meetingDate: string, opt: { followUp: boolean; nextSteps: boolean } = { followUp: true, nextSteps: false }): ReportField[] {
  const min = minutesStore.get(m.meetingId)!;
  const mine = candidates.filter(c => c.meetingId === m.meetingId && CONFIRMED.has(c.status));
  const decisions = mine.filter(c => c.type === "DECISION").slice(0, 50).map(c => (c.descriptionOrContent ? `${c.title}: ${c.descriptionOrContent}` : c.title));
  const tasks = mine.filter(c => c.type === "TASK").slice(0, 50).map(c => ({ 업무: c.title, 담당자: nameOf(c.assigneeUserId), 기한: c.dueAt ? kstDate(c.dueAt) : "" }));
  const topics = candidateGeneration.has(m.meetingId) ? [m.title] : [];
  return [
    field("F01", "회의 제목", "text", m.title), field("F02", "일시", "date", meetingDate), field("F03", "담당자", "text", nameOf(m.reviewOwnerUserId)),
    field("F04", "참석자", "list", attendeeNames(m)), field("F05", "회의 개요", "long_text", min.content ?? ""), field("F06", "주요 논의 사항", "list", topics),
    field("F07", "결정 사항", "list", decisions),
    ...(opt.followUp ? [field("F08", "실행 항목", "table", tasks.length ? tasks : null, { columns: ["업무", "담당자", "기한"] })] : []),
    ...(opt.nextSteps ? [field("F10", "후속 조치", "list", nextStepLines(min.content))] : []),
  ];
}
function buildTemplateReport(m: Meeting, meetingDate: string): ReportField[] {
  const min = minutesStore.get(m.meetingId)!;
  const tasks = candidates.filter(c => c.meetingId === m.meetingId && c.type === "TASK").slice(0, 3);
  return [
    field("F01", "회의명", "text", m.title), field("F02", "일시", "date", meetingDate), field("F03", "작성자", "text", nameOf(m.reviewOwnerUserId)),
    field("F04", "참석자", "long_text", attendeeNames(m).join(", ")),
    field("F05", "논의 내용", "long_text", (min.content ?? "").replace(/[#>*]/g, "").trim().slice(0, 400) || null, { source: "AI" }),
    field("F06", "업무", "table", tasks.length ? tasks.map((c, i) => ({ 번호: String(i + 1), "업무 내용": c.title, 담당자: nameOf(c.assigneeUserId), 기한: c.dueAt ? kstDate(c.dueAt) : "" })) : null, { source: "AI", columns: ["번호", "업무 내용", "담당자", "기한"] }),
    field("F07", "일정 준수 여부", "choice", null, { source: "AI", options: ["정상", "지연", "위험"] }),
    field("F08", "담당 결재", "signature", null, { source: "HUMAN" }),
  ];
}
// 회사 양식 보고서의 진행: 양식 분석(PENDING) → 보고서 생성(PROCESSING) → 완료. 요청 시각으로부터 경과한 시간으로 흉내 낸다.
function syncReport(meetingId: string): Report | undefined {
  const r = reports.get(meetingId);
  if (!r || r.kind !== "template" || r.status === "SUCCEEDED" || r.status === "FAILED") return r;
  const age = Date.now() - r.requestedMs;
  if (age < 900) r.status = "PENDING";
  else if (age < 1800) r.status = "PROCESSING";
  else { r.status = "SUCCEEDED"; r.fields = r.pendingFields; r.completedAt = now(); }
  if (r.status === "SUCCEEDED") r.version++;
  return r;
}
const toReportResponse = (r: Report) => ({ reportId: r.reportId, meetingId: r.meetingId, templateId: r.templateId, status: r.status, failureCode: r.failureCode, requestedAt: r.requestedAt, completedAt: r.completedAt, fields: r.status === "SUCCEEDED" ? r.fields : null, version: r.version });

// ───────────────────────── 6유형 결과 ─────────────────────────
function buildSemantic(m: Meeting, min: Minutes) {
  maybeGenerateCandidates(m.meetingId);
  const mine = candidates.filter(c => c.meetingId === m.meetingId);
  const first = (min.content ?? "").split("\n").find(l => l.trim() && !l.startsWith("#")) ?? "";
  const informations: any[] = [{ id: "i-problem", caseId: "case-1", type: "PROBLEM", normalizedText: `${m.title}에서 해결할 과제가 논의되었다.`, certainty: "CERTAIN", conditionality: "UNCONDITIONAL", polarity: "AFFIRMATIVE", candidateEligibility: "NOT_ELIGIBLE", evidenceRefs: ["e-1"] }];
  const attributes: any[] = [];
  const candidateLinks: any[] = [];
  mine.forEach((c, i) => {
    const iid = `i-${i + 1}`;
    informations.push({ id: iid, caseId: "case-1", type: c.type === "DECISION" ? "DECISION" : "ACTION_ITEM", normalizedText: c.title, certainty: "CERTAIN", conditionality: "UNCONDITIONAL", polarity: "AFFIRMATIVE", decisionState: c.type === "DECISION" ? "VALID" : null, actionState: c.type === "TASK" ? "ACTIVE" : null, candidateEligibility: "ELIGIBLE", evidenceRefs: ["e-1"] });
    if (c.type === "TASK" && c.assigneeUserId) attributes.push({ id: `a-${i + 1}`, informationId: iid, type: "ASSIGNEE", rawText: nameOf(c.assigneeUserId), normalizedValue: nameOf(c.assigneeUserId), resolvedRef: { userId: c.assigneeUserId }, evidenceRefs: ["e-1"] });
    candidateLinks.push({ candidateIndex: i, informationId: iid, candidateId: c.candidateId });
  });
  return {
    meetingId: m.meetingId, minutesId: min.minutesId, minutesVersion: min.version, sourceGeneration: min.sourceGeneration, isCurrent: !candidateReadyAt.has(m.meetingId),
    semanticSchemaVersion: "1.2", limitedContext: false, generatedAt: min.generatedAt ?? now(), cases: [{ id: "case-1", label: m.title }], informations, attributes, relations: [],
    evidences: [{ id: "e-1", sourceType: min.status === "APPROVED" ? "APPROVED_MINUTES" : "MINUTES_DRAFT", role: "SUPPORT", locatorType: "TEXT_SPAN", locator: { start: 0, end: first.length }, quote: first || null }],
    candidateLinks,
  };
}

// ───────────────────────── 검증 도우미 ─────────────────────────
const rejectUnknown = (e: FieldError[], b: any, allowed: string[]) => { for (const k of Object.keys(b ?? {})) if (!allowed.includes(k)) e.push({ field: k, reason: "NOT_ALLOWED" }); };
function checkTime(e: FieldError[], b: any, name: string) {
  const v = b?.[name];
  if (v === undefined || v === null) return;
  if (typeof v !== "string" || Number.isNaN(Date.parse(v))) e.push({ field: name, reason: "INVALID_FORMAT" });
  else if (!TZ_RE.test(v)) e.push({ field: name, reason: "TIMEZONE_REQUIRED" });
}
function checkText(e: FieldError[], v: unknown, name: string, min: number, max: number, required: boolean) {
  if (v === undefined || v === null || (typeof v === "string" && !v.trim())) { if (required) e.push({ field: name, reason: "REQUIRED" }); return undefined; }
  if (typeof v !== "string") { e.push({ field: name, reason: "INVALID_FORMAT" }); return undefined; }
  const t = v.trim();
  if (t.length < min) e.push({ field: name, reason: "TOO_SHORT" });
  else if (t.length > max) e.push({ field: name, reason: "TOO_LONG" });
  return t;
}

// ───────────────────────── 채팅 스트림 (SSE) ─────────────────────────
function jsonError(status: number, errorCode: string): Response {
  const requestId = crypto.randomUUID();
  return new Response(JSON.stringify({ success: false, message: "요청을 처리할 수 없습니다.", data: null, errorCode, requestId }), { status, headers: { "Content-Type": "application/json", "X-Request-Id": requestId } });
}
export function streamMeetingChat(meetingId: string, afterSequence: number, me: MockUser, signal?: AbortSignal): Response {
  const m = meetings.find(x => x.meetingId === meetingId);
  if (!m) return jsonError(404, "MEETING_NOT_FOUND");
  const p = myParticipant(meetingId, me.userId);
  if (!p || p.participationStatus !== "ACTIVE" || p.recordAccessState !== "GRANTED") return jsonError(403, "MEETING_CHAT_ACCESS_DENIED");
  if (m.status !== "IN_PROGRESS") return jsonError(409, "MEETING_CHAT_CLOSED");
  const streamKey = `${meetingId}:${me.userId}`;
  if ((chatStreams.get(streamKey) ?? 0) >= CHAT_STREAM_LIMIT) return jsonError(429, "RATE_LIMIT_EXCEEDED");
  chatStreams.set(streamKey, (chatStreams.get(streamKey) ?? 0) + 1);

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  let done = false;
  const finish = (controller?: ReadableStreamDefaultController<Uint8Array>) => {
    if (done) return;
    done = true; unsubscribe?.();
    chatStreams.set(streamKey, Math.max(0, (chatStreams.get(streamKey) ?? 1) - 1));
    try { controller?.close(); } catch { /* 이미 닫힘 */ }
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string) => { try { controller.enqueue(encoder.encode(text)); } catch { /* 연결이 이미 닫힌 뒤 */ } };
      send("retry: 3000\n: connected\n\n");
      const replay = chats.filter(c => c.meetingId === meetingId && c.streamSequence > afterSequence).sort((a, b) => a.streamSequence - b.streamSequence);
      for (const c of replay.slice(0, 200)) send(`id: ${c.streamSequence}\nevent: message\ndata: ${JSON.stringify(c)}\n\n`);
      if (replay.length > 200) send(`event: replay-truncated\ndata: ${JSON.stringify({ lastSequence: replay[199].streamSequence })}\n\n`);
      const cb = (ev: ChatEvent) => {
        if (ev.type === "message") send(`id: ${ev.msg.streamSequence}\nevent: message\ndata: ${JSON.stringify(ev.msg)}\n\n`);
        else if (!ev.userId || ev.userId === me.userId) { send(`event: close\ndata: ${JSON.stringify({ reason: ev.reason })}\n\n`); finish(controller); }
      };
      const set = chatSubs.get(meetingId) ?? new Set();
      set.add(cb); chatSubs.set(meetingId, set);
      unsubscribe = () => { set.delete(cb); };
      signal?.addEventListener("abort", () => finish(controller));
    },
    cancel() { finish(); },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

export function routeMeeting(o: RequestOptions, me: MockUser): unknown {
  const b: any = o.body ?? {};
  const path = o.path;
  const key = `${o.method} ${path}`;
  const q = o.query ?? {};

  if (key === "GET /api/meetings") {
    const e: FieldError[] = [];
    for (const f of ["from", "to"] as const) if (q[f] !== undefined && !TZ_RE.test(String(q[f]))) e.push({ field: f, reason: "TIMEZONE_REQUIRED" });
    if (q.status && !["SCHEDULED", "IN_PROGRESS", "ENDED", "CANCELED"].includes(String(q.status))) e.push({ field: "status", reason: "INVALID_ENUM" });
    if (!e.length && q.from && q.to && Date.parse(String(q.from)) > Date.parse(String(q.to))) e.push({ field: "from", reason: "AFTER_TO" });
    check(e);
    const baseOf = (x: Meeting) => new Date(x.scheduledStartAt ?? x.startedAt ?? x.createdAt).getTime();
    const rows = meetings
      .filter(m => currentAccess(m, me.userId) && (isEffectiveProjectMember(m.projectId, me.userId) || myParticipant(m.meetingId, me.userId)?.meetingRole === "VIEWER"))
      .filter(m => !q.projectId || m.projectId === q.projectId)
      .filter(m => !q.status || m.status === q.status)
      .filter(m => (!q.from || baseOf(m) >= Date.parse(String(q.from))) && (!q.to || baseOf(m) <= Date.parse(String(q.to))))
      .sort((a, c) => baseOf(c) - baseOf(a));
    for (const m of rows) syncPostprocess(m.meetingId);
    const page = offsetPage(rows, q);
    return { items: page.items.map(m => toMeetingResponse(m, me.userId)), page: page.page };
  }
  if (key === "POST /api/meetings") {
    const e: FieldError[] = [];
    rejectUnknown(e, b, ["projectId", "title", "description", "scheduledStartAt", "scheduledEndAt", "participantUserIds", "viewerUserIds", "password", "sensitivityClassification", "externalAiPolicy"]);
    if (!b.projectId) e.push({ field: "projectId", reason: "REQUIRED" });
    if (b.sensitivityClassification != null && !(b.sensitivityClassification in SENS_RANK)) e.push({ field: "sensitivityClassification", reason: "INVALID_ENUM" });
    if (b.externalAiPolicy != null && !["INHERIT", "ALLOWED", "BLOCKED"].includes(b.externalAiPolicy)) e.push({ field: "externalAiPolicy", reason: "INVALID_ENUM" });
    checkTime(e, b, "scheduledStartAt"); checkTime(e, b, "scheduledEndAt");
    if (e.length) invalid(...e);
    // 업무 규칙 검사는 첫 번째 위반 하나만 돌려준다: 제목 → 설명 → 일정 순서 → 비밀번호 → 참여자 중복
    const title = checkText(e, b.title, "title", 1, 160, true); check(e);
    const description = checkText(e, b.description, "description", 0, 4000, false); check(e);
    if (b.scheduledStartAt && b.scheduledEndAt && Date.parse(b.scheduledEndAt) < Date.parse(b.scheduledStartAt)) invalid({ field: "scheduledEndAt", reason: "BEFORE_START" });
    if (b.password != null) { if (typeof b.password !== "string" || b.password.length < 4) invalid({ field: "password", reason: "TOO_SHORT" }); if (b.password.length > 128) invalid({ field: "password", reason: "TOO_LONG" }); }
    const rawIds: string[] = Array.isArray(b.participantUserIds) ? b.participantUserIds : [];
    if (new Set(rawIds).size !== rawIds.length) invalid({ field: "participantUserIds", reason: "DUPLICATE" });
    if (!isProjectActive(b.projectId)) { if (!isEffectiveProjectMember(b.projectId, me.userId)) return fail(404, "PROJECT_NOT_FOUND"); return fail(409, "PROJECT_NOT_ACTIVE"); }
    const role = effectiveProjectRole(b.projectId, me.userId);
    if (role !== "MANAGER" && role !== "MEMBER") return fail(403, "PROJECT_MEETING_CREATE_FORBIDDEN");
    // 보낸 순서대로 하나씩: Identity에 없음 404 → 부적격 409. 먼저 걸리는 사람의 코드가 온다.
    for (const uid of rawIds) {
      if (!byId(uid)) return fail(404, "PARTICIPANT_NOT_FOUND");
      if (byId(uid)!.status !== "ACTIVE" || !isEffectiveProjectMember(b.projectId, uid)) return fail(409, "PARTICIPANT_NOT_ELIGIBLE");
    }
    // 처음부터 넣는 열람자는 프로젝트 멤버일 필요가 없다. 같은 회사의 활성 직원이면 된다.
    const viewerIds: string[] = Array.isArray(b.viewerUserIds) ? b.viewerUserIds : [];
    if (new Set(viewerIds).size !== viewerIds.length) invalid({ field: "viewerUserIds", reason: "DUPLICATE" });
    for (const uid of viewerIds) {
      if (!byId(uid)) return fail(404, "PARTICIPANT_NOT_FOUND");
      if (byId(uid)!.status !== "ACTIVE") return fail(409, "PARTICIPANT_NOT_ELIGIBLE");
    }
    const meetingId = id(19, ++meetingSeq);
    const m: Meeting = {
      meetingId, projectId: b.projectId, title: title!, description: description ?? null, organizerUserId: me.userId, reviewOwnerUserId: me.userId,
      status: "SCHEDULED", scheduledStartAt: b.scheduledStartAt ?? null, scheduledEndAt: b.scheduledEndAt ?? null, startedAt: null, endedAt: null,
      // 민감도를 생략하면 회사 기본값(회사 설정)이 들어간다.
      sensitivityClassification: b.sensitivityClassification ?? meetingSettings.defaultSensitivityClassification, externalAiPolicy: b.externalAiPolicy ?? "INHERIT",
      passwordHash: b.password ? b.password : null, createdAt: now(), updatedAt: now(), version: 1,
    };
    meetings.push(m);
    participants.push(mkParticipant(meetingId, me.userId));
    for (const uid of rawIds) if (uid !== me.userId) {
      participants.push(mkParticipant(meetingId, uid));
      emit(uid, "MEETING_PARTICIPANT_ADDED", "MEETING", meetingId, { actorUserId: me.userId, safeParameters: { scheduledAt: m.scheduledStartAt } });
    }
    for (const uid of viewerIds) if (!participants.some(p => p.meetingId === meetingId && p.userId === uid)) {
      participants.push(mkParticipant(meetingId, uid, "VIEWER"));
      emit(uid, "MEETING_PARTICIPANT_ADDED", "MEETING", meetingId, { actorUserId: me.userId, safeParameters: { scheduledAt: m.scheduledStartAt } });
    }
    minutesStore.set(meetingId, newMinutes(meetingId));
    postprocess.set(meetingId, { meetingId, status: "NOT_STARTED", sourceGeneration: 0, stageBaseAt: 0, failureCode: null, updatedAt: now(), version: 1, regenReadyAt: null, rawHardDeleteAt: null });
    chatSequenceOf.set(meetingId, 0);
    return toMeetingResponse(m, me.userId);
  }

  let m2 = /^\/api\/meetings\/([^/]+)$/.exec(path);
  if (m2) {
    const m = meeting(m2[1]);
    if (o.method === "GET") { requireAccess(m, me.userId, "MEETING_RECORD_ACCESS_REVOKED"); syncPostprocess(m.meetingId); return toMeetingResponse(m, me.userId); }
    requireOrganizer(m, me.userId);
    const e: FieldError[] = [];
    rejectUnknown(e, b, ["version", "title", "description", "scheduledStartAt", "scheduledEndAt", "sensitivityClassification", "externalAiPolicy"]);
    if (typeof b.version !== "number") e.push({ field: "version", reason: "REQUIRED" });
    if (b.sensitivityClassification !== undefined && !(b.sensitivityClassification in SENS_RANK)) e.push({ field: "sensitivityClassification", reason: "INVALID_ENUM" });
    if (b.externalAiPolicy !== undefined && !["INHERIT", "ALLOWED", "BLOCKED"].includes(b.externalAiPolicy)) e.push({ field: "externalAiPolicy", reason: "INVALID_ENUM" });
    checkTime(e, b, "scheduledStartAt"); checkTime(e, b, "scheduledEndAt");
    if (e.length) invalid(...e);
    const mutable = ["title", "description", "scheduledStartAt", "scheduledEndAt", "sensitivityClassification", "externalAiPolicy"].filter(f => b[f] !== undefined);
    if (!mutable.length) invalid({ field: "body", reason: "NO_MUTABLE_FIELD" });
    if (b.title !== undefined) { const t = checkText(e, b.title, "title", 1, 160, true); check(e); void t; }
    if (b.description) { checkText(e, b.description, "description", 0, 4000, false); check(e); }
    // version 검사가 상태 검사보다 먼저다(4-3).
    const row = versioned(m, b, "MEETING_NOT_FOUND");
    if (m.status !== "SCHEDULED" && m.status !== "IN_PROGRESS") return fail(409, "MEETING_STATE_NOT_MUTABLE");
    if (m.status === "IN_PROGRESS" && mutable.some(f => f !== "sensitivityClassification")) return fail(409, "MEETING_FIELD_UPDATE_NOT_ALLOWED_IN_PROGRESS");
    if (b.sensitivityClassification && SENS_RANK[b.sensitivityClassification as MeetingSensitivity] < SENS_RANK[m.sensitivityClassification]) return fail(409, "SENSITIVITY_DOWNGRADE_FORBIDDEN");
    // 둘 중 하나만 보내도 저장된 다른 쪽과 비교한다.
    const start = b.scheduledStartAt !== undefined ? b.scheduledStartAt : m.scheduledStartAt;
    const end = b.scheduledEndAt !== undefined ? b.scheduledEndAt : m.scheduledEndAt;
    if (start && end && Date.parse(end) < Date.parse(start)) invalid({ field: "scheduledEndAt", reason: "BEFORE_START" });
    if (b.title !== undefined) row.title = b.title.trim();
    if (b.description !== undefined) row.description = b.description ? String(b.description).trim() || null : null;
    if (b.scheduledStartAt !== undefined) row.scheduledStartAt = b.scheduledStartAt; // 수정 응답은 보낸 표기 그대로 돌려준다(+09:00)
    if (b.scheduledEndAt !== undefined) row.scheduledEndAt = b.scheduledEndAt;
    if (b.sensitivityClassification !== undefined) row.sensitivityClassification = b.sensitivityClassification;
    if (b.externalAiPolicy !== undefined) row.externalAiPolicy = b.externalAiPolicy;
    row.version++; row.updatedAt = now();
    return toMeetingResponse(row, me.userId);
  }

  m2 = /^\/api\/meetings\/([^/]+)\/start$/.exec(path);
  if (m2) {
    const m = meeting(m2[1]); requireOrganizer(m, me.userId);
    const e: FieldError[] = []; rejectUnknown(e, b, ["version", "password"]); if (typeof b.version !== "number") e.push({ field: "version", reason: "REQUIRED" }); check(e);
    if (m.status !== "SCHEDULED") return fail(409, "MEETING_NOT_SCHEDULED");
    const row = versioned(m, b, "MEETING_NOT_FOUND");
    if (!isProjectActive(m.projectId)) return fail(409, "PROJECT_NOT_ACTIVE");
    row.status = "IN_PROGRESS"; row.startedAt = now(); row.version++; row.updatedAt = now();
    return toMeetingResponse(row, me.userId);
  }
  m2 = /^\/api\/meetings\/([^/]+)\/end$/.exec(path);
  if (m2) {
    const m = meeting(m2[1]); requireOrganizer(m, me.userId);
    const e: FieldError[] = []; rejectUnknown(e, b, []); check(e);
    // 같은 사람이 이미 끝낸 회의에 end를 다시 부르면 409가 아니라 처음과 같은 200이다.
    if (m.status === "ENDED") return endResponse(m, me.userId);
    if (m.status !== "IN_PROGRESS") return fail(409, "MEETING_NOT_IN_PROGRESS");
    finishMeeting(m);
    return endResponse(m, me.userId);
  }
  m2 = /^\/api\/meetings\/([^/]+)\/cancel$/.exec(path);
  if (m2) {
    const m = meeting(m2[1]); requireOrganizer(m, me.userId);
    const e: FieldError[] = []; rejectUnknown(e, b, ["version", "reason"]); if (typeof b.version !== "number") e.push({ field: "version", reason: "REQUIRED" });
    if (typeof b.reason === "string" && b.reason.length > 1000) e.push({ field: "reason", reason: "TOO_LONG" }); check(e);
    if (m.status !== "SCHEDULED") return fail(409, "MEETING_NOT_SCHEDULED");
    const row = versioned(m, b, "MEETING_NOT_FOUND");
    row.status = "CANCELED"; row.version++; row.updatedAt = now();
    return toMeetingResponse(row, me.userId);
  }
  m2 = /^\/api\/meetings\/([^/]+)\/organizer$/.exec(path);
  if (m2) {
    const m = meeting(m2[1]); requireOrganizer(m, me.userId);
    const e: FieldError[] = []; rejectUnknown(e, b, ["targetUserId", "version"]); if (!b.targetUserId) e.push({ field: "targetUserId", reason: "REQUIRED" }); if (typeof b.version !== "number") e.push({ field: "version", reason: "REQUIRED" }); check(e);
    if (m.status !== "SCHEDULED") return fail(409, "MEETING_NOT_SCHEDULED");
    const target = byId(b.targetUserId);
    if (!target) return fail(404, "TARGET_USER_NOT_FOUND");
    if (b.targetUserId === m.organizerUserId) return fail(409, "SAME_ORGANIZER");
    if (target.status !== "ACTIVE") return fail(409, "TARGET_USER_INACTIVE");
    if (!isEffectiveProjectMember(m.projectId, b.targetUserId)) return fail(409, "TARGET_NOT_PROJECT_MEMBER");
    const existing = myParticipant(m.meetingId, b.targetUserId);
    if (existing && (existing.participationStatus === "REMOVED" || existing.recordAccessState === "REVOKED")) return fail(409, "PARTICIPANT_ALREADY_REMOVED");
    const row = versioned(m, b, "MEETING_NOT_FOUND");
    row.organizerUserId = b.targetUserId; // 검토 담당자는 바뀌지 않는다
    if (!existing) { participants.push(mkParticipant(m.meetingId, b.targetUserId)); emit(b.targetUserId, "MEETING_PARTICIPANT_ADDED", "MEETING", m.meetingId, { actorUserId: me.userId, safeParameters: { scheduledAt: m.scheduledStartAt } }); }
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
    const e: FieldError[] = []; rejectUnknown(e, b, ["userId", "role"]);
    if (!b.userId) e.push({ field: "userId", reason: "REQUIRED" });
    else if (typeof b.userId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(b.userId)) e.push({ field: "userId", reason: "INVALID_UUID" });
    if (b.role !== undefined && !["PARTICIPANT", "VIEWER"].includes(b.role)) e.push({ field: "role", reason: "INVALID_ENUM" });
    check(e);
    requireOrganizer(m, me.userId);
    const role: "PARTICIPANT" | "VIEWER" = b.role === "VIEWER" ? "VIEWER" : "PARTICIPANT";
    // 열람자는 예정·종료일 때, 일반 참여자는 예정일 때만 추가할 수 있다. 종료 후 PARTICIPANT와 진행 중인 회의는 같은 코드다.
    if (role === "VIEWER" ? m.status !== "SCHEDULED" && m.status !== "ENDED" : m.status !== "SCHEDULED") return fail(409, "MEETING_NOT_SCHEDULED");
    const target = byId(b.userId);
    if (!target) return fail(404, "TARGET_USER_NOT_FOUND");
    if (target.status !== "ACTIVE") return fail(409, "TARGET_USER_INACTIVE");
    // 열람자는 프로젝트 멤버가 아니어도 된다(같은 회사의 활성 직원이면 충분). 일반 참여자는 프로젝트 구성원이어야 한다.
    if (role === "PARTICIPANT" && !isEffectiveProjectMember(m.projectId, b.userId)) return fail(409, "TARGET_NOT_PROJECT_MEMBER");
    const prev = participants.find(p => p.meetingId === m.meetingId && p.userId === b.userId);
    if (prev) {
      // 회수된 열람자를 같은 요청으로 다시 초대하면 같은 행이 다시 활성화된다. 그 밖의 기존 행은 중복이다(한 번 빠진 참여자는 다시 추가할 수 없다).
      if (role === "VIEWER" && prev.meetingRole === "VIEWER" && prev.participationStatus === "REMOVED") {
        prev.participationStatus = "ACTIVE"; prev.recordAccessState = "GRANTED"; prev.removedAt = null; prev.recordAccessRevokedAt = null; prev.joinedRelationAt = now(); prev.version++;
        emit(b.userId, "MEETING_PARTICIPANT_ADDED", "MEETING", m.meetingId, { actorUserId: me.userId, safeParameters: { scheduledAt: m.scheduledStartAt } });
        return toParticipantResponse(prev);
      }
      return fail(409, "PARTICIPANT_ALREADY_EXISTS");
    }
    const p = mkParticipant(m.meetingId, b.userId, role);
    participants.push(p);
    emit(b.userId, "MEETING_PARTICIPANT_ADDED", "MEETING", m.meetingId, { actorUserId: me.userId, safeParameters: { scheduledAt: m.scheduledStartAt } });
    return toParticipantResponse(p);
  }
  m2 = /^\/api\/meetings\/([^/]+)\/participants\/([^/]+)$/.exec(path);
  if (m2 && o.method === "DELETE") {
    const m = meeting(m2[1]); requireOrganizer(m, me.userId);
    if (m2[2] === m.organizerUserId) return fail(409, "ORGANIZER_REMOVE_FORBIDDEN");
    const p = myParticipant(m.meetingId, m2[2]);
    // 종료 후에는 열람자만 회수할 수 있다. 실제로 참석한 사람의 기록은 바꾸지 않는다.
    const endedViewer = m.status === "ENDED" && p?.meetingRole === "VIEWER";
    if (!endedViewer && m.status !== "SCHEDULED" && m.status !== "IN_PROGRESS") return fail(409, "MEETING_STATE_NOT_MUTABLE");
    if (!p) return fail(404, "PARTICIPANT_NOT_FOUND");
    if (p.participationStatus === "REMOVED") return fail(409, "PARTICIPANT_ALREADY_REMOVED");
    // 제거되면 기록 접근권도 함께 회수된다. 진행 중이면 채팅 스트림이 닫히고 음성에서도 쫓겨난다.
    p.participationStatus = "REMOVED"; p.removedAt = now(); p.recordAccessState = "REVOKED"; p.recordAccessRevokedAt = now(); p.version++;
    closeChat(m.meetingId, "PARTICIPANT_REMOVED", p.userId);
    emit(p.userId, "MEETING_PARTICIPATION_REMOVED", "MEETING", m.meetingId, { actorUserId: me.userId });
    return undefined;
  }
  m2 = /^\/api\/meetings\/([^/]+)\/participants\/([^/]+)\/record-access$/.exec(path);
  if (m2) {
    const m = meeting(m2[1]);
    const e: FieldError[] = [];
    rejectUnknown(e, b, ["state", "reason", "version"]);
    if (!["GRANTED", "REVOKED"].includes(b.state)) e.push({ field: "state", reason: b.state === undefined ? "REQUIRED" : "INVALID_ENUM" });
    checkText(e, b.reason, "reason", 1, 1000, true);
    if (typeof b.version !== "number") e.push({ field: "version", reason: "REQUIRED" });
    check(e);
    if (m.organizerUserId !== me.userId && effectiveProjectRole(m.projectId, me.userId) !== "MANAGER") return fail(403, "RECORD_ACCESS_MANAGEMENT_FORBIDDEN");
    if (m.status === "CANCELED") return fail(409, "MEETING_STATE_NOT_MUTABLE");
    const target = myParticipant(m.meetingId, m2[2]);
    if (!target) return fail(404, "PARTICIPANT_NOT_FOUND");
    const row = versioned(target, b, "PARTICIPANT_NOT_FOUND");
    if (row.recordAccessState === b.state) return fail(409, "RECORD_ACCESS_ALREADY_STATE");
    if (b.state === "GRANTED") {
      if (byId(row.userId)?.status !== "ACTIVE") return fail(409, "TARGET_USER_INACTIVE");
      if (!isEffectiveProjectMember(m.projectId, row.userId)) return fail(409, "TARGET_NOT_PROJECT_MEMBER");
    }
    row.recordAccessState = b.state; row.recordAccessRevokedAt = b.state === "REVOKED" ? now() : null; row.version++;
    if (b.state === "REVOKED") closeChat(m.meetingId, "RECORD_ACCESS_REVOKED", row.userId);
    return toParticipantResponse(row);
  }

  // ── Password ──
  m2 = /^\/api\/meetings\/([^/]+)\/password$/.exec(path);
  if (m2) {
    const m = meeting(m2[1]); requireOrganizer(m, me.userId);
    if (m.status !== "SCHEDULED") return fail(409, "MEETING_NOT_SCHEDULED");
    if (o.method === "DELETE") { if (!m.passwordHash) return fail(409, "MEETING_PASSWORD_NOT_SET"); m.passwordHash = null; m.version++; m.updatedAt = now(); return undefined; }
    const e: FieldError[] = []; rejectUnknown(e, b, ["password", "version"]);
    if (typeof b.password !== "string" || !b.password) e.push({ field: "password", reason: "REQUIRED" });
    else if (b.password.length < 4) e.push({ field: "password", reason: "TOO_SHORT" });
    else if (b.password.length > 128) e.push({ field: "password", reason: "TOO_LONG" });
    check(e);
    const row = versioned(m, b, "MEETING_NOT_FOUND");
    row.passwordHash = b.password; row.version++; row.updatedAt = now();
    return undefined;
  }

  // ── LiveKit ──
  m2 = /^\/api\/meetings\/([^/]+)\/livekit-token$/.exec(path);
  if (m2) {
    const m = meeting(m2[1]);
    const e: FieldError[] = []; rejectUnknown(e, b, ["password"]); check(e);
    const p = myParticipant(m.meetingId, me.userId);
    if (p?.meetingRole === "VIEWER" && p.participationStatus === "ACTIVE" && m.status === "IN_PROGRESS") return fail(403, "MEETING_VIEWER_READ_ONLY");
    if (!p || p.participationStatus !== "ACTIVE") return p?.recordAccessState === "REVOKED" ? fail(403, "MEETING_RECORD_ACCESS_REVOKED") : fail(403, "MEETING_JOIN_DENIED");
    if (p.recordAccessState !== "GRANTED") return fail(403, "MEETING_RECORD_ACCESS_REVOKED");
    if (m.status !== "IN_PROGRESS") return fail(409, "MEETING_NOT_IN_PROGRESS");
    if (m.passwordHash && m.organizerUserId !== me.userId) {
      // 같은 사람이 같은 회의에서 15분 안에 5번 틀리면 이후에는 맞는 비밀번호여도 429다. 맞게 입력하면 실패 횟수가 지워진다.
      const k = `${m.meetingId}:${me.userId}`;
      const f = passwordFails.get(k);
      if (f && Date.now() - f.firstAt > PASSWORD_WINDOW_MS) passwordFails.delete(k);
      const cur = passwordFails.get(k);
      if (cur && cur.count >= PASSWORD_MAX_FAILS) return fail(429, "MEETING_PASSWORD_RATE_LIMITED");
      if (b.password !== m.passwordHash) { passwordFails.set(k, { count: (cur?.count ?? 0) + 1, firstAt: cur?.firstAt ?? Date.now() }); return fail(401, "MEETING_PASSWORD_INVALID"); }
      passwordFails.delete(k);
    }
    return { token: `mock-livekit-token.${m.meetingId}.${me.userId}.${Date.now()}`, expiresAt: new Date(Date.now() + 5 * 60000).toISOString(), roomName: `meeting:${m.meetingId}`, participantIdentity: `anok-user:${me.userId}` };
  }

  // ── Chat ──
  m2 = /^\/api\/meetings\/([^/]+)\/chat\/messages$/.exec(path);
  if (m2) {
    const m = meeting(m2[1]);
    const p = myParticipant(m.meetingId, me.userId);
    if (!p || p.participationStatus !== "ACTIVE" || p.recordAccessState !== "GRANTED") return fail(403, "MEETING_CHAT_ACCESS_DENIED");
    // 진행 중에만 읽고 쓴다. 끝나면 이 API로 다시 읽을 수 없다.
    if (m.status !== "IN_PROGRESS") return fail(409, "MEETING_CHAT_CLOSED");
    if (o.method === "GET") {
      const after = Number(q.afterSequence ?? 0);
      const limit = q.limit === undefined ? 50 : Number(q.limit);
      if (!(after >= 0) || !(limit >= 1 && limit <= 100)) invalid({ field: q.limit !== undefined && !(limit >= 1 && limit <= 100) ? "limit" : "afterSequence", reason: "OUT_OF_RANGE" });
      const rows = chats.filter(c => c.meetingId === m.meetingId && c.streamSequence > after).sort((a, c) => a.streamSequence - c.streamSequence);
      const items = rows.slice(0, limit);
      return { items, lastSequence: items.length ? items[items.length - 1].streamSequence : after, hasMore: rows.length > items.length };
    }
    const e: FieldError[] = []; rejectUnknown(e, b, ["text", "clientMessageId"]);
    const text = checkText(e, b.text, "text", 1, 4000, true);
    if (typeof b.text === "string" && /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(b.text)) e.push({ field: "text", reason: "INVALID_CHARACTERS" });
    if (b.clientMessageId !== undefined && !/^[0-9a-f-]{36}$/i.test(String(b.clientMessageId))) e.push({ field: "clientMessageId", reason: "INVALID_UUID" });
    check(e);
    // clientMessageId 재전송: 새로 만들지 않고 처음 그 메시지를 그대로 돌려준다.
    const dedupeKey = b.clientMessageId ? `${m.meetingId}:${me.userId}:${b.clientMessageId}` : null;
    if (dedupeKey && clientMessageIds.has(dedupeKey)) return clientMessageIds.get(dedupeKey);
    // 사용자·회의당 토큰 버킷: 한 번에 10개까지, 이후 초당 1개.
    const bk = `${m.meetingId}:${me.userId}`;
    const bucket = chatBuckets.get(bk) ?? { tokens: CHAT_BUCKET, at: Date.now() };
    bucket.tokens = Math.min(CHAT_BUCKET, bucket.tokens + (Date.now() - bucket.at) / 1000); bucket.at = Date.now();
    if (bucket.tokens < 1) { chatBuckets.set(bk, bucket); return fail(429, "RATE_LIMIT_EXCEEDED"); }
    bucket.tokens -= 1; chatBuckets.set(bk, bucket);
    const seq = (chatSequenceOf.get(m.meetingId) ?? 0) + 1;
    chatSequenceOf.set(m.meetingId, seq);
    const msg: ChatMsg = { messageId: crypto.randomUUID(), meetingId: m.meetingId, senderUserId: me.userId, text: text!, streamSequence: seq, sentAt: now() };
    chats.push(msg);
    if (dedupeKey) clientMessageIds.set(dedupeKey, msg);
    publishChat(m.meetingId, { type: "message", msg });
    return msg;
  }

  // ── Minutes ── (종료된 회의만. 종료 전에는 404)
  m2 = /^\/api\/meetings\/([^/]+)\/minutes$/.exec(path);
  if (m2) {
    const m = meeting(m2[1]);
    if (m.status !== "ENDED") return fail(404, "MEETING_MINUTES_NOT_FOUND");
    syncPostprocess(m.meetingId);
    const min = minutesStore.get(m.meetingId)!;
    if (o.method === "GET") {
      requireRecordAccess(m, me.userId, "MEETING_MINUTES_ACCESS_DENIED");
      if (!myParticipant(m.meetingId, me.userId) || myParticipant(m.meetingId, me.userId)!.recordAccessState !== "GRANTED") return fail(403, "MEETING_RECORD_ACCESS_REVOKED");
      // 프로젝트 멤버가 아닌 열람자는 승인된 회의록만, 5개 필드(minutesId·meetingId·status·content·approvedAt)로 본다. 초안은 404.
      if (isOutsideViewer(m, me.userId)) {
        if (min.status !== "APPROVED") return fail(404, "MEETING_MINUTES_NOT_FOUND");
        return { minutesId: min.minutesId, meetingId: min.meetingId, status: min.status, content: min.content, approvedAt: min.approvedAt };
      }
      // 초안(DRAFT)과 생성 중·실패는 검토 담당자만, 승인(APPROVED) 후에는 기록 접근권이 있는 참가자 누구나.
      if (min.status !== "APPROVED" && m.reviewOwnerUserId !== me.userId) return fail(403, "MEETING_MINUTES_ACCESS_DENIED");
      return toMinutesResponse(min);
    }
    requireReviewOwner(m, me.userId);
    const e: FieldError[] = []; rejectUnknown(e, b, ["content", "version"]);
    checkText(e, b.content, "content", 1, 100000, true);
    if (typeof b.version !== "number") e.push({ field: "version", reason: "REQUIRED" });
    check(e);
    const row = versioned(min, b, "MEETING_MINUTES_NOT_FOUND");
    if (min.status !== "DRAFT") return fail(409, "MINUTES_NOT_DRAFT");
    if (candidates.some(c => c.meetingId === m.meetingId && c.status === "CONFIRMED")) return fail(409, "CONFIRMED_CANDIDATE_EXISTS");
    const changed = row.content !== b.content;
    row.content = b.content; row.lastEditedBy = me.userId; row.lastEditedAt = now(); row.version++;
    // 본문이 바뀌면 후보가 다시 만들어진다(손본 후보도 사라진다). 본문이 같으면 후보는 그대로다.
    if (changed && !aiBlocked(m)) resetCandidates(m.meetingId);
    return toMinutesResponse(row);
  }
  m2 = /^\/api\/meetings\/([^/]+)\/minutes\/approve$/.exec(path);
  if (m2) {
    const m = meeting(m2[1]);
    if (m.status !== "ENDED") return fail(404, "MEETING_MINUTES_NOT_FOUND");
    requireReviewOwner(m, me.userId);
    const e: FieldError[] = []; rejectUnknown(e, b, ["version"]); if (typeof b.version !== "number") e.push({ field: "version", reason: "REQUIRED" }); check(e);
    syncPostprocess(m.meetingId);
    const min = minutesStore.get(m.meetingId)!;
    const row = versioned(min, b, "MEETING_MINUTES_NOT_FOUND");
    if (min.status !== "DRAFT") return fail(409, "MINUTES_NOT_DRAFT");
    row.status = "APPROVED"; row.approvedBy = me.userId; row.approvedAt = now(); row.version++;
    const pp = postprocess.get(m.meetingId)!; pp.status = "APPROVED"; pp.updatedAt = now(); pp.version++;
    for (const p of participants.filter(x => x.meetingId === m.meetingId && x.participationStatus === "ACTIVE" && x.recordAccessState === "GRANTED"))
      emit(p.userId, "MEETING_MINUTES_APPROVED", "MEETING_MINUTES", row.minutesId, { secondaryResourceType: "MEETING", secondaryResourceId: m.meetingId, actorUserId: me.userId });
    return toMinutesResponse(row);
  }
  m2 = /^\/api\/meetings\/([^/]+)\/minutes\/regenerate$/.exec(path);
  if (m2) {
    const m = meeting(m2[1]);
    if (m.status !== "ENDED") return fail(404, "MEETING_MINUTES_NOT_FOUND");
    requireReviewOwner(m, me.userId);
    const e: FieldError[] = []; rejectUnknown(e, b, ["reason"]); if (typeof b.reason === "string" && b.reason.length > 1000) e.push({ field: "reason", reason: "TOO_LONG" }); check(e);
    syncPostprocess(m.meetingId);
    const min = minutesStore.get(m.meetingId)!;
    if (min.status === "APPROVED") return fail(409, "MINUTES_APPROVED");
    if (min.status !== "DRAFT" && min.status !== "FAILED") return fail(409, "MINUTES_REGENERATION_NOT_ALLOWED");
    if (aiBlocked(m)) return fail(409, "MINUTES_REGENERATION_NOT_ALLOWED");
    // 곧바로 PROCESSING이 되고 content는 null이 된다. 끝나면 DRAFT, 이어서 후보가 새로 만들어진다.
    min.status = "PROCESSING"; min.content = null; min.version++;
    resetCandidates(m.meetingId, REGEN_MS + CANDIDATE_DELAY_MS);
    const pp = postprocess.get(m.meetingId)!; pp.status = "MINUTES_QUEUED"; pp.regenReadyAt = Date.now() + REGEN_MS; pp.failureCode = null; pp.updatedAt = now(); pp.version++;
    return toPostprocessResponse(pp);
  }

  // ── 6유형 결과 ──
  m2 = /^\/api\/meetings\/([^/]+)\/semantic-result$/.exec(path);
  if (m2) {
    const m = meeting(m2[1]);
    if (m.status !== "ENDED") return fail(404, "MEETING_MINUTES_NOT_FOUND");
    syncPostprocess(m.meetingId);
    requireRecordAccess(m, me.userId, "MEETING_MINUTES_ACCESS_DENIED");
    requireNotOutsideViewer(m, me.userId);
    const min = minutesStore.get(m.meetingId)!;
    if (min.status !== "APPROVED" && m.reviewOwnerUserId !== me.userId) return fail(403, "MEETING_MINUTES_ACCESS_DENIED");
    if (min.status !== "DRAFT" && min.status !== "APPROVED") return null; // AI 차단 회의 등은 200 + null
    return buildSemantic(m, min);
  }

  // ── 원본 녹음 합본 확인(FRONTEND_03) ── 서버 스위치가 꺼져 있으면 404 ROUTE_NOT_FOUND지만 mock은 켜져 있다고 본다. 화자 수·크기·길이는 주지 않는다.
  m2 = /^\/api\/meetings\/([^/]+)\/recording-download\/availability$/.exec(path);
  if (m2) {
    const info = recordingInfo(m2[1], me.userId);
    if (info.kind === "notfound") return fail(404, "MEETING_NOT_FOUND");
    if (info.kind === "forbidden") return fail(403, "RECORDING_DOWNLOAD_FORBIDDEN");
    return info.state === "READY" ? { state: "READY", mediaType: "audio/mpeg", fileExtension: "mp3" } : { state: info.state, reasonCode: info.reasonCode };
  }

  // ── 전사문(STT 원문) ── 실제 서버는 TRANSCRIPT_VIEW_ENABLED가 켜져야 하고(꺼져 있으면 404 ROUTE_NOT_FOUND), 참여자(열람 전용 제외)와
  // 프로젝트 MANAGER만 읽는다. mock은 기록 접근권이 있는 참여자를 읽을 수 있는 사람으로 본다. 화자는 확정하지 않는다(TRACK_ONLY).
  m2 = /^\/api\/meetings\/([^/]+)\/transcript$/.exec(path);
  if (m2) {
    const m = meeting(m2[1]);
    if (m.status !== "ENDED") return fail(409, "MEETING_NOT_ENDED");
    requireRecordAccess(m, me.userId, "TRANSCRIPT_FORBIDDEN");
    if (isOutsideViewer(m, me.userId)) return fail(403, "TRANSCRIPT_FORBIDDEN");
    syncPostprocess(m.meetingId);
    const pp = postprocess.get(m.meetingId)!;
    if (!["STT_READY", "MINUTES_QUEUED", "MINUTES_PROCESSING", "MINUTES_DRAFT", "REVIEWING", "APPROVED"].includes(pp.status)) return fail(409, "TRANSCRIPT_NOT_READY");
    const speakers = participants.filter(p => p.meetingId === m.meetingId && p.participationStatus === "ACTIVE").slice(0, 3);
    const lines = ["안녕하세요. 오늘 베타 서비스 출시 준비 상황을 점검하겠습니다.", "회의 생성과 참여자 추가 API는 구현이 끝났고 자료 첨부는 연동 테스트 중입니다.", "커스텀 보고서 표 구조 문제는 이번 주 안에 확인해 보겠습니다."];
    return {
      meetingId: m.meetingId, transcriptId: `tr-${m.meetingId}`, language: "ko", recordingCompleteness: "COMPLETE", createdAt: now(), speakerIdentity: "TRACK_ONLY",
      segments: speakers.map((p, i) => ({ sequence: i, text: lines[i % lines.length], speakerLabel: `음성 트랙 ${i + 1}`, trackPublisherUserId: p.userId, speakerBasis: "UNKNOWN", startMs: null, endMs: null, timePrecision: "FILE_ONLY" })),
    };
  }

  // ── Candidates ── (검토 담당자만. 승인 후에도 일반 참가자는 못 본다)
  m2 = /^\/api\/meetings\/([^/]+)\/candidates$/.exec(path);
  if (m2) {
    const m = meeting(m2[1]);
    if (m.status !== "ENDED") return fail(404, "MEETING_MINUTES_NOT_FOUND");
    requireNotOutsideViewer(m, me.userId);
    requireReviewOwner(m, me.userId); syncPostprocess(m.meetingId); maybeGenerateCandidates(m.meetingId);
    for (const c of candidates) if (c.meetingId === m.meetingId) resolveMaterialization(c);
    const rows = candidates.filter(c => c.meetingId === m.meetingId && (!q.type || c.type === q.type) && (!q.status || c.status === q.status));
    const page = offsetPage(rows, q);
    return { items: page.items.map(toCandidateResponse), page: page.page };
  }
  m2 = /^\/api\/meetings\/([^/]+)\/candidates\/([^/]+)$/.exec(path);
  if (m2) {
    const m = meeting(m2[1]); requireReviewOwner(m, me.userId);
    const c = findCandidate(m.meetingId, m2[2]);
    const e: FieldError[] = [];
    rejectUnknown(e, b, ["title", "descriptionOrContent", "assigneeUserId", "dueAt", "version"]);
    const title = checkText(e, b.title, "title", 1, 300, true);
    if (typeof b.descriptionOrContent === "string" && b.descriptionOrContent.length > 10000) e.push({ field: "descriptionOrContent", reason: "TOO_LONG" });
    if (c.type === "DECISION") {
      if (!b.descriptionOrContent || !String(b.descriptionOrContent).trim()) e.push({ field: "descriptionOrContent", reason: "REQUIRED" });
      if (b.assigneeUserId !== undefined && b.assigneeUserId !== null) e.push({ field: "assigneeUserId", reason: "NOT_ALLOWED" });
      if (b.dueAt !== undefined && b.dueAt !== null) e.push({ field: "dueAt", reason: "NOT_ALLOWED" });
    } else checkTime(e, b, "dueAt");
    if (typeof b.version !== "number") e.push({ field: "version", reason: "REQUIRED" });
    check(e);
    if (c.status !== "PROPOSED" && c.status !== "EDITED" && c.status !== "MATERIALIZATION_FAILED") return fail(409, "CANDIDATE_NOT_EDITABLE");
    const row = versioned(c, b, "CANDIDATE_NOT_FOUND");
    // PUT은 전체 교체다: 보내지 않은 내용·담당자·마감은 null로 지워진다.
    row.title = title!; row.descriptionOrContent = b.descriptionOrContent ? String(b.descriptionOrContent).trim() : null;
    row.assigneeUserId = c.type === "TASK" ? (b.assigneeUserId ?? null) : null;
    row.dueAt = c.type === "TASK" ? (b.dueAt ?? null) : null;
    row.status = "EDITED"; row.failureReasonCode = null; row.version++; row.updatedAt = now();
    return toCandidateResponse(row);
  }
  m2 = /^\/api\/meetings\/([^/]+)\/candidates\/([^/]+)\/confirm$/.exec(path);
  if (m2) {
    const m = meeting(m2[1]); requireReviewOwner(m, me.userId);
    const min = minutesStore.get(m.meetingId)!;
    if (min.status !== "APPROVED") return fail(409, "MINUTES_NOT_APPROVED");
    const c = findCandidate(m.meetingId, m2[2]);
    if (c.status !== "PROPOSED" && c.status !== "EDITED") return fail(409, "CANDIDATE_NOT_CONFIRMABLE");
    if (!isProjectActive(m.projectId)) return fail(409, "PROJECT_NOT_ACTIVE");
    if (c.type === "TASK" && c.assigneeUserId && (byId(c.assigneeUserId)?.status !== "ACTIVE" || !isTaskAssigneeEligible(m.projectId, c.assigneeUserId))) return fail(409, "ASSIGNEE_INVALID");
    const row = versioned(c, b, "CANDIDATE_NOT_FOUND");
    row.status = "CONFIRMED"; row.version++; row.updatedAt = now();
    return toCandidateResponse(row);
  }
  m2 = /^\/api\/meetings\/([^/]+)\/candidates\/([^/]+)\/reject$/.exec(path);
  if (m2) {
    const m = meeting(m2[1]); requireReviewOwner(m, me.userId);
    const c = findCandidate(m.meetingId, m2[2]);
    if (!["PROPOSED", "EDITED", "CONFIRMED", "MATERIALIZATION_FAILED"].includes(c.status)) return fail(409, "CANDIDATE_NOT_REJECTABLE");
    const row = versioned(c, b, "CANDIDATE_NOT_FOUND");
    row.status = "REJECTED"; row.version++; row.updatedAt = now();
    return toCandidateResponse(row);
  }
  m2 = /^\/api\/meetings\/([^/]+)\/candidates\/([^/]+)\/materialize$/.exec(path);
  if (m2) {
    const m = meeting(m2[1]); requireReviewOwner(m, me.userId);
    const min = minutesStore.get(m.meetingId)!;
    if (min.status !== "APPROVED") return fail(409, "CANDIDATE_NOT_CONFIRMED");
    const c = findCandidate(m.meetingId, m2[2]);
    if (c.status === "MATERIALIZATION_PENDING") return fail(409, "CANDIDATE_NOT_CONFIRMED"); // 처리 중 중복 반영 방지
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
    const m = meeting(m2[1]);
    requireRecordAccess(m, me.userId);
    requireNotOutsideViewer(m, me.userId);
    if (m.status !== "ENDED") return fail(404, "POSTPROCESS_NOT_FOUND");
    syncPostprocess(m.meetingId);
    return toPostprocessResponse(postprocess.get(m.meetingId)!, m.reviewOwnerUserId === me.userId);
  }
  m2 = /^\/api\/meetings\/([^/]+)\/postprocess\/retry$/.exec(path);
  if (m2) {
    const m = meeting(m2[1]);
    if (m.status !== "ENDED") return fail(404, "MEETING_MINUTES_NOT_FOUND");
    requireReviewOwner(m, me.userId);
    const e: FieldError[] = []; rejectUnknown(e, b, ["stage", "reason"]);
    if (b.stage !== undefined && !["STT", "MINUTES", "CANDIDATES"].includes(b.stage)) e.push({ field: "stage", reason: "INVALID_ENUM" }); check(e);
    syncPostprocess(m.meetingId);
    const pp = postprocess.get(m.meetingId)!;
    if (pp.status !== "FAILED" && pp.status !== "AI_EGRESS_BLOCKED") return fail(409, "POSTPROCESS_NOT_RETRYABLE");
    // 막힌 회의는 재시도를 받아들이지만 곧 다시 AI_EGRESS_BLOCKED로 돌아온다(종료 후에는 민감도를 바꿀 수 없다).
    pp.status = pp.status === "AI_EGRESS_BLOCKED" ? "MINUTES_QUEUED" : "WAITING_RECORDING"; pp.stageBaseAt = Date.now() - (pp.status === "MINUTES_QUEUED" ? BLOCK_AT_INDEX * STAGE_MS : STAGE_MS);
    pp.failureCode = null; pp.updatedAt = now(); pp.version++;
    return toPostprocessResponse(pp);
  }

  // ── 보고서 ──
  m2 = /^\/api\/meetings\/([^/]+)\/custom-report$/.exec(path);
  if (m2) {
    const m = meeting(m2[1]);
    // 열람자는 최종 보고서(회의록 승인 뒤에 만든 것)만 읽는다. 없거나 최종이 아니면 data:null(오류 아님). 접근이 회수되면 403.
    if (o.method === "GET" && !isReviewOwnerOf(m, me.userId) && myParticipant(m.meetingId, me.userId)?.meetingRole === "VIEWER") {
      if (!currentAccess(m, me.userId)) return fail(403, "REVIEW_OWNER_REQUIRED");
      const r = syncReport(m.meetingId); const min = minutesStore.get(m.meetingId);
      const isFinal = !!r && r.status === "SUCCEEDED" && min?.status === "APPROVED" && !!min.approvedAt && Date.parse(r.requestedAt) >= Date.parse(min.approvedAt);
      return isFinal ? toReportResponse(r!) : null;
    }
    requireReviewOwner(m, me.userId);
    if (o.method === "GET") { const r = syncReport(m.meetingId); return r ? toReportResponse(r) : null; }
    // 본문은 { hasTemplate, meetingDate }뿐이다. 담당자·참석자 이름은 서버가 채우므로 author/participants는 400 NOT_ALLOWED.
    const e: FieldError[] = [];
    rejectUnknown(e, b, ["hasTemplate", "meetingDate", "includeFollowUpActions", "includeNextSteps"]);
    if (b.hasTemplate === undefined) e.push({ field: "hasTemplate", reason: "REQUIRED" }); else if (b.hasTemplate === null) e.push({ field: "hasTemplate", reason: "INVALID_FORMAT" });
    // 두 선택은 기본 보고서 전용이고 진짜 boolean만 받는다(null → INVALID_TYPE, "false"·0·1 → INVALID_FORMAT, 회사 양식과 함께 → NOT_ALLOWED).
    for (const k of ["includeFollowUpActions", "includeNextSteps"]) {
      if (!(k in b)) continue;
      if (b.hasTemplate === true || b.hasTemplate === "true" || b.hasTemplate === 1) e.push({ field: k, reason: "NOT_ALLOWED" });
      else if (b[k] === null) e.push({ field: k, reason: "INVALID_TYPE" });
      else if (typeof b[k] !== "boolean") e.push({ field: k, reason: "INVALID_FORMAT" });
    }
    if (b.meetingDate === undefined) e.push({ field: "meetingDate", reason: "REQUIRED" });
    else if (typeof b.meetingDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.meetingDate) || Number.isNaN(Date.parse(b.meetingDate))) e.push({ field: "meetingDate", reason: "INVALID" });
    check(e);
    syncPostprocess(m.meetingId);
    const prior = syncReport(m.meetingId);
    const hasTemplate = b.hasTemplate === true || b.hasTemplate === "true" || b.hasTemplate === 1;
    const min = minutesStore.get(m.meetingId)!;
    const reportId = crypto.randomUUID();
    const count = (reportRequests.get(m.meetingId) ?? 0) + 1;
    if (!hasTemplate) {
      if (m.status !== "ENDED") return fail(409, "MEETING_NOT_ENDED");
      if (min.status !== "DRAFT" && min.status !== "APPROVED") return fail(409, "MINUTES_NOT_READY");
      if (prior && prior.kind === "template" && (prior.status === "PENDING" || prior.status === "PROCESSING")) return fail(409, "CUSTOM_REPORT_IN_PROGRESS");
      maybeGenerateCandidates(m.meetingId);
      reportRequests.set(m.meetingId, count);
      const r: Report = { reportId, meetingId: m.meetingId, templateId: id(23, 1), status: "SUCCEEDED", failureCode: null, requestedAt: now(), completedAt: now(), fields: buildDefaultReport(m, b.meetingDate, { followUp: b.includeFollowUpActions !== false, nextSteps: b.includeNextSteps === true }), version: count, requestedMs: Date.now(), kind: "default", pendingFields: null, analysis: { startedMs: 0, hash: "" } };
      reports.set(m.meetingId, r);
      return toReportResponse(r);
    }
    // 회사 양식 보고서: 양식 확인 → 회의 종료 → 전사문 준비 → 진행 중인 보고서가 없을 것
    const tpl = getMeetingTemplateFile(m.meetingId);
    if (!tpl) return fail(404, "TEMPLATE_NOT_FOUND");
    if (tpl.sizeBytes > 10 * 1024 * 1024) return fail(400, "TEMPLATE_TOO_LARGE");
    if (m.status !== "ENDED") return fail(409, "MEETING_NOT_ENDED");
    const ppNow = postprocess.get(m.meetingId)!;
    if (["WAITING_EVIDENCE_SNAPSHOT", "WAITING_RECORDING", "STT_QUEUED", "STT_PROCESSING"].includes(ppNow.status) || ppNow.failureCode === "RECORDING_FAILED") return fail(409, "TRANSCRIPT_NOT_READY");
    if (prior && (prior.status === "PENDING" || prior.status === "PROCESSING")) return fail(409, "CUSTOM_REPORT_IN_PROGRESS");
    reportRequests.set(m.meetingId, count);
    const blocked = aiBlocked(m);
    const r: Report = {
      reportId, meetingId: m.meetingId, templateId: tpl.templateId, status: blocked ? "FAILED" : "PENDING", failureCode: blocked ? "AI_EGRESS_BLOCKED" : null,
      requestedAt: now(), completedAt: blocked ? now() : null, fields: null, version: count, requestedMs: Date.now(), kind: "template",
      pendingFields: blocked ? null : buildTemplateReport(m, b.meetingDate), analysis: { startedMs: Date.now(), hash: tpl.sha256 },
    };
    reports.set(m.meetingId, r);
    return toReportResponse(r);
  }
  m2 = /^\/api\/meetings\/([^/]+)\/template$/.exec(path);
  if (m2) {
    const m = meeting(m2[1]); requireReviewOwner(m, me.userId);
    const r = syncReport(m.meetingId);
    const tpl = getMeetingTemplateFile(m.meetingId);
    if (!r || !tpl) return null; // 보고서를 한 번도 요청하지 않았으면 null
    const done = r.status === "SUCCEEDED" || r.status === "PROCESSING";
    return {
      meetingId: m.meetingId, templateId: tpl.templateId, mimeType: tpl.mimeType, byteSize: tpl.sizeBytes, analysisStatus: r.status === "FAILED" ? "FAILED" : done ? "SUCCEEDED" : "PROCESSING",
      failureCode: r.status === "FAILED" ? r.failureCode : null,
      schema: done ? { fields: (r.pendingFields ?? []).map(f => ({ key: f.key, label: f.label, kind: f.kind, source: f.source, serverBinding: null, columns: f.columns, options: f.options })) } : null,
      updatedAt: now(), version: r.version,
    };
  }

  // ── 프로젝트 담당자 복구 (강제 종료 · 검토 담당자 교체) ──
  m2 = /^\/api\/meetings\/([^/]+)\/force-end$/.exec(path);
  if (m2) {
    const m = meeting(m2[1]);
    const e: FieldError[] = []; rejectUnknown(e, b, ["reason"]); checkText(e, b.reason, "reason", 1, 1000, true); check(e);
    const p = myParticipant(m.meetingId, me.userId);
    if (effectiveProjectRole(m.projectId, me.userId) !== "MANAGER" || !p || p.participationStatus !== "ACTIVE" || p.recordAccessState !== "GRANTED") return fail(403, "PROJECT_MANAGER_FORCE_END_REQUIRED");
    if (m.status !== "IN_PROGRESS") return fail(409, "MEETING_NOT_IN_PROGRESS");
    if (m.organizerUserId === me.userId || !organizerAbsent(m)) return fail(409, "FORCE_END_NOT_REQUIRED");
    finishMeeting(m);
    return endResponse(m, me.userId);
  }
  m2 = /^\/api\/meetings\/([^/]+)\/review-owner-recovery$/.exec(path);
  if (m2) {
    const m = meeting(m2[1]);
    const e: FieldError[] = []; rejectUnknown(e, b, ["targetUserId", "reason"]); if (!b.targetUserId) e.push({ field: "targetUserId", reason: "REQUIRED" }); checkText(e, b.reason, "reason", 1, 1000, true); check(e);
    if (effectiveProjectRole(m.projectId, me.userId) !== "MANAGER") return fail(403, "PROJECT_MANAGER_REQUIRED");
    const mine = myParticipant(m.meetingId, me.userId);
    if (!mine || mine.recordAccessState !== "GRANTED") return fail(403, "MEETING_RECORD_ACCESS_REQUIRED");
    const target = byId(b.targetUserId);
    if (!target) return fail(404, "TARGET_USER_NOT_FOUND");
    if (m.status !== "ENDED" || !reviewerAbsent(m)) return fail(409, "REVIEW_OWNER_RECOVERY_NOT_REQUIRED");
    if (target.status !== "ACTIVE" || !isEffectiveProjectMember(m.projectId, b.targetUserId)) return fail(409, "TARGET_NOT_PROJECT_MEMBER");
    const tp = myParticipant(m.meetingId, b.targetUserId);
    if (!tp || tp.recordAccessState !== "GRANTED" || tp.participationStatus !== "ACTIVE") return fail(409, "TARGET_RECORD_ACCESS_REQUIRED");
    m.reviewOwnerUserId = b.targetUserId; m.version++; m.updatedAt = now();
    return toMeetingResponse(m, me.userId);
  }

  // ── 회사 Admin 전용 복구/설정 경로 (mock.ts가 stepUp 처리 후 위임) ──
  if (key === "GET /api/admin/meetings/recovery") {
    const type = q.type as "FORCE_END" | "REVIEW_OWNER" | undefined;
    if (type !== undefined && type !== "FORCE_END" && type !== "REVIEW_OWNER") invalid({ field: "type", reason: "INVALID_ENUM" });
    const rows: ReturnType<typeof toRecoverySummary>[] = [];
    for (const mt of meetings) {
      if (type !== "REVIEW_OWNER" && mt.status === "IN_PROGRESS" && organizerAbsent(mt)) rows.push(toRecoverySummary(mt, "FORCE_END"));
      if (type !== "FORCE_END" && mt.status === "ENDED" && reviewerAbsent(mt)) rows.push(toRecoverySummary(mt, "REVIEW_OWNER"));
    }
    const page = offsetPage(rows, q);
    return { items: page.items, page: page.page };
  }
  m2 = /^\/api\/admin\/meetings\/([^/]+)\/force-end$/.exec(path);
  if (m2) {
    const m = meeting(m2[1]);
    const e: FieldError[] = []; rejectUnknown(e, b, ["reason"]); checkText(e, b.reason, "reason", 1, 1000, true); check(e);
    if (m.status !== "IN_PROGRESS") return fail(409, "MEETING_NOT_IN_PROGRESS");
    finishMeeting(m);
    // 관리자는 참가자가 아니라 my… 값이 null이다.
    const r = endResponse(m, me.userId);
    return { ...r, meeting: { ...r.meeting, myParticipationStatus: null, myRecordAccessState: null } };
  }
  m2 = /^\/api\/admin\/meetings\/([^/]+)\/review-owner-recovery$/.exec(path);
  if (m2) {
    const m = meeting(m2[1]);
    const e: FieldError[] = []; rejectUnknown(e, b, ["targetUserId", "reason"]); if (!b.targetUserId) e.push({ field: "targetUserId", reason: "REQUIRED" }); checkText(e, b.reason, "reason", 1, 1000, true); check(e);
    if (!byId(b.targetUserId)) return fail(404, "TARGET_USER_NOT_FOUND");
    if (m.status !== "ENDED" || !reviewerAbsent(m)) return fail(409, "REVIEW_OWNER_RECOVERY_NOT_REQUIRED");
    if (!isEffectiveProjectMember(m.projectId, b.targetUserId)) return fail(409, "TARGET_NOT_PROJECT_MEMBER");
    m.reviewOwnerUserId = b.targetUserId; m.version++; m.updatedAt = now();
    return { ...toMeetingResponse(m, me.userId), myParticipationStatus: null, myRecordAccessState: null };
  }
  if (key === "GET /api/admin/meeting-settings") return { ...meetingSettings };
  if (key === "PUT /api/admin/meeting-settings") {
    if (!(b.defaultSensitivityClassification in SENS_RANK)) invalid({ field: "defaultSensitivityClassification", reason: "INVALID_ENUM" });
    if (typeof b.version !== "number") invalid({ field: "version", reason: "REQUIRED" });
    if (b.version !== meetingSettings.version) return fail(409, "VERSION_CONFLICT");
    meetingSettings = { defaultSensitivityClassification: b.defaultSensitivityClassification, updatedByUserId: me.userId, updatedAt: now(), version: meetingSettings.version + 1 };
    return { ...meetingSettings };
  }

  return fail(404, "ROUTE_NOT_FOUND");
}
