// FRONTEND_00~04 명세(2026-10-11) 기준 회의 서비스 시나리오:
//  · 보고서 요청 본문({ hasTemplate, meetingDate }만 — author/participants는 400), 기본 보고서(즉시 SUCCEEDED)·회사 양식 보고서(PENDING → SUCCEEDED), 양식 올리기
//  · 회의록/후보/6유형 결과의 역할별 가시성(초안은 검토 담당자만, 후보는 승인 후에도 검토 담당자만)
//  · 채팅 clientMessageId 중복 방지·속도 제한·SSE 스트림(close 이벤트), 비밀번호 5회 제한과 401이 로그아웃(토큰 갱신)을 일으키지 않는 것
//  · 회의 생성·수정 검증 사유, 회사 기본 민감도, 자료 처리 상태
import { describe, it, expect } from "vitest";
import { ApiError } from "../src/api/errors";
import * as doc from "../src/api/document";
import * as mtg from "../src/api/meeting";
import * as prj from "../src/api/project";
import { isTokenFailure, request } from "../src/api/http";
import { openMeetingChatStream, parseSseChunk } from "../src/api/chatStream";
import { tokenStore } from "../src/api/tokenStore";
import { code, createScenario, loginAdmin, loginAs, makeFile, sleep, stepUpAdmin, userIdByEmailAdmin } from "./helpers";

async function until<T>(fn: () => Promise<T>, done: (v: T) => boolean, timeoutMs = 15000, stepMs = 300) {
  const t0 = Date.now();
  let v = await fn();
  while (!done(v) && Date.now() - t0 < timeoutMs) { await sleep(stepMs); v = await fn(); }
  return v;
}
// 에러의 fieldErrors까지 보려고 ApiError를 그대로 돌려준다.
async function fail(p: Promise<unknown>): Promise<ApiError | null> {
  try { await p; return null; } catch (e) { return e instanceof ApiError ? e : null; }
}
const png = (name: string, extra = "") => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), extra], name, { type: "image/png" });

describe("공통 규칙 단위", () => {
  it("401은 토큰 문제일 때만 갱신 대상이고, SSE 청크는 주석·재시도 줄을 이벤트로 보지 않는다", () => {
    expect(isTokenFailure(401, "TOKEN_INVALID")).toBe(true);
    expect(isTokenFailure(401, "UNAUTHORIZED")).toBe(true);
    expect(isTokenFailure(401, "MEETING_PASSWORD_INVALID")).toBe(false);
    expect(isTokenFailure(401, "INVALID_CREDENTIALS")).toBe(false);
    expect(isTokenFailure(403, "TOKEN_INVALID")).toBe(false);
    expect(parseSseChunk("retry: 3000\n: connected")).toBeNull();
    expect(parseSseChunk(": heartbeat")).toBeNull();
    expect(parseSseChunk('id: 7\nevent: message\ndata: {"a":1}')).toEqual({ event: "message", id: "7", data: '{"a":1}' });
    expect(parseSseChunk('event: close\ndata: {"reason":"MEETING_ENDED"}')?.event).toBe("close");
  });
});

describe("회의 서비스 명세 시나리오", () => {
  it("보고서·역할별 가시성·채팅·비밀번호·검증이 명세대로 동작한다", async () => {
    const scenario = createScenario();
    const { ok } = scenario;

    await loginAdmin("insung@anok.io");
    const wonjaeId = await userIdByEmailAdmin("wonjae@anok.io");
    const gyuchanId = await userIdByEmailAdmin("gyuchan@anok.io");
    const minjunId = await userIdByEmailAdmin("minjun@anok.io");
    const jihyunId = await userIdByEmailAdmin("jihyun@anok.io");

    await loginAs("wonjae@anok.io");
    const aiProject = (await prj.listProjects()).items.find((p: any) => p.name === "AI 회의록 파이프라인")!;
    const projectId = aiProject.projectId;

    // ── 회의 생성 검증(①) ──
    const bad = async (body: Record<string, unknown>) => (await fail(request({ method: "POST", path: "/api/meetings", body: { projectId, title: "검증", ...body }, auth: "bearer", idempotent: true })))?.fieldErrors?.[0];
    ok("제목 161자 → TOO_LONG", (await bad({ title: "가".repeat(161) }))?.reason === "TOO_LONG");
    ok("주최자를 보내면 NOT_ALLOWED", (await bad({ organizerUserId: gyuchanId }))?.reason === "NOT_ALLOWED");
    ok("참여자 중복 → DUPLICATE", (await bad({ participantUserIds: [gyuchanId, gyuchanId] }))?.reason === "DUPLICATE");
    ok("종료가 시작보다 이르면 BEFORE_START", (await bad({ scheduledStartAt: "2026-10-20T10:00:00+09:00", scheduledEndAt: "2026-10-20T09:00:00+09:00" }))?.reason === "BEFORE_START");
    ok("시간대 없는 일정 → TIMEZONE_REQUIRED", (await bad({ scheduledStartAt: "2026-10-20T10:00:00" }))?.reason === "TIMEZONE_REQUIRED");
    ok("비밀번호 3자 → TOO_SHORT", (await bad({ password: "abc" }))?.reason === "TOO_SHORT");
    ok("프로젝트 구성원이 아닌 참여자 → 409 PARTICIPANT_NOT_ELIGIBLE", (await code(mtg.createMeeting({ projectId, title: "x", participantUserIds: [jihyunId] }))) === "409 PARTICIPANT_NOT_ELIGIBLE");

    // ── 회사 기본 민감도: 생략하면 회사 설정이 들어간다(5절) ──
    const plain = await mtg.createMeeting({ projectId, title: "기본 민감도" });
    ok("설정 전 기본값은 INTERNAL, AI 정책은 INHERIT", plain.sensitivityClassification === "INTERNAL" && plain.externalAiPolicy === "INHERIT");
    await loginAdmin("insung@anok.io"); await stepUpAdmin();
    const s0 = await mtg.getMeetingSettings();
    ok("회의 설정을 바꾼 적이 없으면 version 0", s0.version === 0 && s0.updatedByUserId === null);
    await mtg.updateMeetingSettings({ defaultSensitivityClassification: "CONFIDENTIAL", version: s0.version });
    await loginAs("wonjae@anok.io");
    const confidential = await mtg.createMeeting({ projectId, title: "회사 기본값을 따르는 회의" });
    ok("민감도를 생략하면 회사 기본값(CONFIDENTIAL)이 적용된다", confidential.sensitivityClassification === "CONFIDENTIAL");
    await loginAdmin("insung@anok.io"); await stepUpAdmin();
    await mtg.updateMeetingSettings({ defaultSensitivityClassification: "INTERNAL", version: (await mtg.getMeetingSettings()).version });
    await loginAs("wonjae@anok.io");

    // ── 수정 검증(7-3) ──
    const m1 = await mtg.createMeeting({ projectId, title: "명세 시나리오 회의", description: "설명", participantUserIds: [gyuchanId, minjunId], password: "sprint2026", scheduledStartAt: "2026-10-20T10:00:00+09:00", scheduledEndAt: "2026-10-20T11:00:00+09:00" });
    ok("생성 응답은 보낸 시각 표기 그대로(+09:00)", m1.scheduledStartAt === "2026-10-20T10:00:00+09:00");
    ok("passwordProtected만 오고 비밀번호는 안 온다", m1.passwordProtected === true && !("password" in m1));
    const upd = await fail(request({ method: "PUT", path: `/api/meetings/${m1.meetingId}`, body: { version: m1.version }, auth: "bearer" }));
    ok("바꿀 필드가 없으면 NO_MUTABLE_FIELD", upd?.fieldErrors?.[0]?.reason === "NO_MUTABLE_FIELD");
    ok("제목을 null로 보내면 REQUIRED", (await fail(request({ method: "PUT", path: `/api/meetings/${m1.meetingId}`, body: { version: m1.version, title: null }, auth: "bearer" })))?.fieldErrors?.[0]?.reason === "REQUIRED");
    const m1b = await mtg.updateMeeting(m1.meetingId, { description: "수정된 설명", externalAiPolicy: "ALLOWED", version: m1.version });
    ok("보낸 필드만 바뀌고 나머지는 유지된다", m1b.description === "수정된 설명" && m1b.title === "명세 시나리오 회의" && m1b.externalAiPolicy === "ALLOWED");
    ok("비밀번호를 설정·해제하면 회의 version이 올라간다(204라 다시 읽어야 한다)", await (async () => {
      await mtg.setMeetingPassword(m1.meetingId, { password: "newpass1", version: m1b.version });
      const after = await mtg.getMeeting(m1.meetingId);
      await mtg.removeMeetingPassword(m1.meetingId);
      const after2 = await mtg.getMeeting(m1.meetingId);
      return after.version === m1b.version + 1 && after2.version === after.version + 1 && !after2.passwordProtected;
    })());
    let cur = await mtg.getMeeting(m1.meetingId);
    await mtg.setMeetingPassword(m1.meetingId, { password: "sprint2026", version: cur.version });
    cur = await mtg.getMeeting(m1.meetingId);

    // ── 시작 · 채팅 · 비밀번호 ──
    const started = await mtg.startMeeting(m1.meetingId, { version: cur.version });
    ok("시작", started.status === "IN_PROGRESS");
    ok("진행 중 제목 수정 → 409", (await code(mtg.updateMeeting(m1.meetingId, { title: "x", version: started.version }))) === "409 MEETING_FIELD_UPDATE_NOT_ALLOWED_IN_PROGRESS");
    ok("version 검사가 상태 검사보다 먼저다", (await code(mtg.updateMeeting(m1.meetingId, { title: "x", version: started.version + 9 }))) === "409 VERSION_CONFLICT");

    // clientMessageId 중복 방지
    const cid = crypto.randomUUID();
    const c1 = await mtg.sendChatMessage(m1.meetingId, "첫 메시지", cid);
    const c2 = await mtg.sendChatMessage(m1.meetingId, "첫 메시지", cid);
    ok("같은 clientMessageId는 처음 메시지를 그대로 돌려준다", c1.messageId === c2.messageId && c1.streamSequence === c2.streamSequence);
    ok("중복 메시지가 생기지 않는다", (await mtg.listChatMessages(m1.meetingId)).items.length === 1);
    ok("공백만 있으면 REQUIRED", (await fail(mtg.sendChatMessage(m1.meetingId, "   ")))?.fieldErrors?.[0]?.reason === "REQUIRED");
    ok("4001자 → TOO_LONG", (await fail(mtg.sendChatMessage(m1.meetingId, "가".repeat(4001))))?.fieldErrors?.[0]?.reason === "TOO_LONG");
    // 속도 제한: 한 번에 10개까지
    const burst = await Promise.allSettled(Array.from({ length: 14 }, (_, i) => mtg.sendChatMessage(m1.meetingId, `연타 ${i}`)));
    const limited = burst.filter(r => r.status === "rejected" && (r.reason as ApiError).errorCode === "RATE_LIMIT_EXCEEDED" && (r.reason as ApiError).status === 429).length;
    ok("연타하면 429 RATE_LIMIT_EXCEEDED", limited >= 3 && burst.filter(r => r.status === "fulfilled").length <= 10);

    // 비밀번호: 틀린 비밀번호의 401은 토큰 문제가 아니라서 갱신(로그아웃)을 일으키지 않는다. 5회 틀리면 맞아도 429.
    await loginAs("gyuchan@anok.io");
    const tokenBefore = tokenStore.get();
    ok("비밀번호가 틀리면 401 MEETING_PASSWORD_INVALID", (await code(mtg.issueLiveKitToken(m1.meetingId, "wrong"))) === "401 MEETING_PASSWORD_INVALID");
    ok("[핵심] 그 401이 토큰 갱신을 일으키지 않는다", tokenStore.get() === tokenBefore);
    for (let i = 0; i < 4; i++) await code(mtg.issueLiveKitToken(m1.meetingId, "wrong"));
    ok("5회 실패 뒤에는 맞는 비밀번호도 429 MEETING_PASSWORD_RATE_LIMITED", (await code(mtg.issueLiveKitToken(m1.meetingId, "sprint2026"))) === "429 MEETING_PASSWORD_RATE_LIMITED");
    await loginAs("minjun@anok.io");
    const lk = await mtg.issueLiveKitToken(m1.meetingId, "sprint2026");
    ok("접속 토큰: 수명 5분, identity는 anok-user:<userId>", lk.participantIdentity === `anok-user:${minjunId}` && lk.roomName.startsWith("meeting:") && new Date(lk.expiresAt).getTime() - Date.now() < 5 * 60000 + 2000);
    await loginAs("wonjae@anok.io");
    ok("주최자는 비밀번호 없이 입장", !!(await mtg.issueLiveKitToken(m1.meetingId)).token);

    // 강제 종료는 주최자가 부재일 때만(9-2)
    ok("주최자 본인(매니저)의 강제 종료 → 409 FORCE_END_NOT_REQUIRED", (await code(mtg.forceEndMeeting(m1.meetingId, "테스트"))) === "409 FORCE_END_NOT_REQUIRED");
    await loginAs("gyuchan@anok.io");
    ok("매니저가 아니면 강제 종료 403", (await code(mtg.forceEndMeeting(m1.meetingId, "테스트"))) === "403 PROJECT_MANAGER_FORCE_END_REQUIRED");

    // ── 종료 → 후처리 ──
    await loginAs("wonjae@anok.io");
    const ended = await mtg.endMeeting(m1.meetingId);
    ok("종료", ended.meeting.status === "ENDED");
    const again = await mtg.endMeeting(m1.meetingId);
    ok("이미 끝낸 회의에 end를 다시 불러도 같은 200이다", again.meeting.status === "ENDED");
    ok("종료 전용 필드를 보내면 400", (await code(request({ method: "POST", path: `/api/meetings/${m1.meetingId}/end`, body: { reason: "x" }, auth: "bearer", idempotent: true }))) === "400 VALIDATION_ERROR");
    ok("종료 후 채팅은 읽기도 409 MEETING_CHAT_CLOSED", (await code(mtg.listChatMessages(m1.meetingId))) === "409 MEETING_CHAT_CLOSED");

    ok("회의록이 아직 없으면 기본 보고서 → 409 MINUTES_NOT_READY", (await code(mtg.requestMeetingCustomReport(m1.meetingId, { hasTemplate: false, meetingDate: "2026-10-20" }))) === "409 MINUTES_NOT_READY");
    ok("양식을 올리기 전 회사 양식 보고서 → 404 TEMPLATE_NOT_FOUND", (await code(mtg.requestMeetingCustomReport(m1.meetingId, { hasTemplate: true, meetingDate: "2026-10-20" }))) === "404 TEMPLATE_NOT_FOUND");

    await until(() => mtg.getMeetingPostprocess(m1.meetingId), p => p.status === "MINUTES_DRAFT");
    const candidates0 = await mtg.listMeetingCandidates(m1.meetingId);
    ok("REVIEWING/초안이어도 후보는 아직 0건일 수 있다", candidates0.page.total === 0);

    // ── 역할별 가시성 ──
    await loginAs("gyuchan@anok.io");
    ok("일반 참가자: 회의록 초안은 403 MEETING_MINUTES_ACCESS_DENIED", (await code(mtg.getMeetingMinutes(m1.meetingId))) === "403 MEETING_MINUTES_ACCESS_DENIED");
    ok("일반 참가자: 후보는 403 REVIEW_OWNER_REQUIRED", (await code(mtg.listMeetingCandidates(m1.meetingId))) === "403 REVIEW_OWNER_REQUIRED");
    ok("일반 참가자: 6유형 결과(초안)도 403", (await code(mtg.getMeetingSemanticResult(m1.meetingId))) === "403 MEETING_MINUTES_ACCESS_DENIED");
    ok("일반 참가자: 보고서 요청 403", (await code(mtg.requestMeetingCustomReport(m1.meetingId, { hasTemplate: false, meetingDate: "2026-10-20" }))) === "403 REVIEW_OWNER_REQUIRED");
    const ppOther = await mtg.getMeetingPostprocess(m1.meetingId);
    ok("후처리 상태는 보이지만 failureCode는 검토 담당자에게만", ppOther.status === "MINUTES_DRAFT" && ppOther.failureCode === null && !!ppOther.rawHardDeleteAt);

    await loginAs("wonjae@anok.io");
    const draft = await mtg.getMeetingMinutes(m1.meetingId);
    ok("검토 담당자는 초안을 본다", draft.status === "DRAFT" && !!draft.content);
    const sem = await until(() => mtg.getMeetingSemanticResult(m1.meetingId), r => !!r?.isCurrent);
    ok("6유형 결과: 정보·근거·후보 연결", !!sem && sem.informations.length > 0 && sem.evidences.length > 0 && sem.candidateLinks.every((l: any) => !!l.candidateId));

    // ── 기본 보고서(③): 요청 즉시 완성, 담당자·참석자는 서버가 채운다 ──
    const date = "2026-10-20";
    const noExtra = await fail(request({ method: "POST", path: `/api/meetings/${m1.meetingId}/custom-report`, body: { hasTemplate: false, meetingDate: date, author: "홍길동", participants: ["a"] }, auth: "bearer", idempotent: true }));
    ok("author·participants를 보내면 400 NOT_ALLOWED", noExtra?.status === 400 && (noExtra.fieldErrors ?? []).map(f => f.field).sort().join() === "author,participants" && noExtra.fieldErrors!.every(f => f.reason === "NOT_ALLOWED"));
    ok("meetingDate 형식 오류 → INVALID", (await fail(request({ method: "POST", path: `/api/meetings/${m1.meetingId}/custom-report`, body: { hasTemplate: false, meetingDate: "20/10/2026" }, auth: "bearer", idempotent: true })))?.fieldErrors?.[0]?.reason === "INVALID");
    ok("요청한 적이 없으면 GET은 200 + null", (await mtg.getMeetingCustomReport(m1.meetingId)) === null);
    const r1 = (await mtg.requestMeetingCustomReport(m1.meetingId, { hasTemplate: false, meetingDate: date }))!;
    ok("기본 보고서는 요청 응답이 이미 SUCCEEDED + 8칸", r1.status === "SUCCEEDED" && r1.fields?.length === 8 && r1.fields.map(f => f.key).join() === "F01,F02,F03,F04,F05,F06,F07,F08");
    const byKey = (r: typeof r1, k: string) => r.fields!.find(f => f.key === k)!;
    ok("F02 일시는 보낸 meetingDate, F03 담당자는 검토 담당자 이름", byKey(r1, "F02").value === date && byKey(r1, "F03").value === "이원재");
    ok("F04 참석자는 검토 담당자가 맨 앞", Array.isArray(byKey(r1, "F04").value) && (byKey(r1, "F04").value as string[])[0] === "이원재" && (byKey(r1, "F04").value as string[]).length === 3);
    ok("F05 회의 개요는 회의록 본문 전체", byKey(r1, "F05").value === draft.content);
    ok("후보를 확정하기 전에는 F07·F08이 비어 있다(오류 아님)", !byKey(r1, "F07").filled && byKey(r1, "F07").value === null && !byKey(r1, "F08").filled);
    ok("GET은 요청 응답과 같은 보고서", (await mtg.getMeetingCustomReport(m1.meetingId))?.reportId === r1.reportId);

    // ── 회의록 승인 → 후보 확정 → 최신으로 다시 만들기(새 키) ──
    const approved = await mtg.approveMeetingMinutes(m1.meetingId, draft.version);
    ok("승인", approved.status === "APPROVED");
    const cands = await until(() => mtg.listMeetingCandidates(m1.meetingId), p => p.page.total > 0);
    ok("후보는 승인 뒤에도 몇 초 뒤에 나타난다", cands.page.total === 2);
    const task = cands.items.find((c: any) => c.type === "TASK")!;
    const decision = cands.items.find((c: any) => c.type === "DECISION")!;
    const decisionBad = await fail(request({ method: "PUT", path: `/api/meetings/${m1.meetingId}/candidates/${decision.candidateId}`, body: { title: decision.title, descriptionOrContent: "내용", assigneeUserId: wonjaeId, version: decision.version }, auth: "bearer" }));
    ok("DECISION에 담당자를 넣으면 NOT_ALLOWED", decisionBad?.fieldErrors?.[0]?.field === "assigneeUserId" && decisionBad.fieldErrors[0].reason === "NOT_ALLOWED");
    const decisionNoContent = await fail(mtg.updateMeetingCandidate(m1.meetingId, decision.candidateId, { title: decision.title, descriptionOrContent: null, version: decision.version }));
    ok("DECISION 내용이 없으면 REQUIRED", decisionNoContent?.fieldErrors?.[0]?.reason === "REQUIRED");
    // PUT은 전체 교체 — 보내지 않은 마감은 지워진다.
    const editedTask = await mtg.updateMeetingCandidate(m1.meetingId, task.candidateId, { title: "수정한 업무", assigneeUserId: gyuchanId, version: task.version });
    ok("PUT은 전체 교체: 보내지 않은 마감·설명이 지워진다", editedTask.status === "EDITED" && editedTask.dueAt === null && editedTask.descriptionOrContent === null);
    const confirmedTask = await mtg.confirmMeetingCandidate(m1.meetingId, editedTask.candidateId, editedTask.version);
    const confirmedDecision = await mtg.confirmMeetingCandidate(m1.meetingId, decision.candidateId, decision.version);
    ok("확정", confirmedTask.status === "CONFIRMED" && confirmedDecision.status === "CONFIRMED");
    ok("확정한 업무는 반려 가능(CONFIRMED)", (await mtg.rejectMeetingCandidate(m1.meetingId, confirmedTask.candidateId, { version: confirmedTask.version })).status === "REJECTED");

    const r2 = (await mtg.requestMeetingCustomReport(m1.meetingId, { hasTemplate: false, meetingDate: date }))!;
    ok("다시 요청하면 새 reportId, version(요청 횟수) 증가", r2.reportId !== r1.reportId && r2.version === r1.version + 1);
    ok("확정한 결정만 F07에 들어간다(제목: 내용)", byKey(r2, "F07").filled && (byKey(r2, "F07").value as string[]).length === 1 && (byKey(r2, "F07").value as string[])[0].startsWith(decision.title));
    ok("반려한 업무는 F08에 들어가지 않는다", !byKey(r2, "F08").filled);

    await loginAs("gyuchan@anok.io");
    ok("승인 뒤에는 일반 참가자도 회의록을 본다", (await mtg.getMeetingMinutes(m1.meetingId)).status === "APPROVED");
    ok("승인 뒤에도 후보는 못 본다", (await code(mtg.listMeetingCandidates(m1.meetingId))) === "403 REVIEW_OWNER_REQUIRED");
    ok("승인 뒤에는 6유형 결과도 본다", !!(await mtg.getMeetingSemanticResult(m1.meetingId)));

    // ── 회사 양식 보고서(④) + 양식 올리기(⑤) ──
    await loginAs("wonjae@anok.io");
    ok("양식이 없으면 GET /template은 null", (await mtg.getMeetingTemplate(m1.meetingId)) === null);
    ok("PNG·JPG·PDF가 아니면 400 FILE_TYPE_NOT_ALLOWED", (await code(doc.uploadMeetingMinutesTemplate(m1.meetingId, makeFile("form.png", "not an image")))) === "400 FILE_TYPE_NOT_ALLOWED");
    ok("빈 파일은 400 FILE_TYPE_NOT_ALLOWED", (await code(doc.uploadMeetingMinutesTemplate(m1.meetingId, makeFile("empty.png", "")))) === "400 FILE_TYPE_NOT_ALLOWED");
    const t1 = await doc.uploadMeetingMinutesTemplate(m1.meetingId, png("form.png", "v1"));
    ok("양식 올리기: 내용으로 형식을 판단", t1.mimeType === "image/png" && t1.meetingId === m1.meetingId && t1.sizeBytes > 0);
    const t1b = await doc.uploadMeetingMinutesTemplate(m1.meetingId, png("renamed.png", "v1"));
    ok("같은 내용을 다시 올리면 같은 templateId와 처음 파일 이름", t1b.templateId === t1.templateId && t1b.filename === "form.png");
    await loginAs("gyuchan@anok.io");
    ok("검토 담당자가 아니면 양식 올리기 403(사유 구분 없음)", (await code(doc.uploadMeetingMinutesTemplate(m1.meetingId, png("x.png", "z")))) === "403 MEETING_ATTACHMENT_FORBIDDEN");
    await loginAs("wonjae@anok.io");
    const t2 = (await mtg.requestMeetingCustomReport(m1.meetingId, { hasTemplate: true, meetingDate: date }))!;
    ok("회사 양식 보고서는 접수(PENDING)·fields 없음", t2.status === "PENDING" && t2.fields === null && t2.templateId === t1.templateId);
    ok("만드는 동안 다시 요청하면 409 CUSTOM_REPORT_IN_PROGRESS", (await code(mtg.requestMeetingCustomReport(m1.meetingId, { hasTemplate: true, meetingDate: date }))) === "409 CUSTOM_REPORT_IN_PROGRESS");
    ok("기본 보고서 요청도 진행 중에는 막힌다", (await code(mtg.requestMeetingCustomReport(m1.meetingId, { hasTemplate: false, meetingDate: date }))) === "409 CUSTOM_REPORT_IN_PROGRESS");
    const seen = new Set<string>();
    const done = await until(async () => { const r = await mtg.getMeetingCustomReport(m1.meetingId); if (r) seen.add(r.status); return r; }, r => r?.status === "SUCCEEDED" || r?.status === "FAILED", 10000, 250);
    ok("폴링하면 SUCCEEDED + 양식 칸(kind·source)이 온다", done?.status === "SUCCEEDED" && done.fields!.some(f => f.kind === "table" && f.columns?.length === 4) && done.fields!.some(f => f.kind === "signature" && f.source === "HUMAN" && !f.filled));
    ok("중간 상태(PENDING/PROCESSING)를 거친다", seen.has("PENDING") || seen.has("PROCESSING"));
    const tState = await mtg.getMeetingTemplate(m1.meetingId);
    ok("양식 분석 조회: SUCCEEDED + schema", tState?.analysisStatus === "SUCCEEDED" && (tState.schema?.fields.length ?? 0) > 0);

    // ── 자료 처리 상태(⑥) — 새 회의(예정)에서 ──
    const m2 = await mtg.createMeeting({ projectId, title: "자료 처리 상태" });
    const okFile = await doc.uploadMeetingAttachment(m2.meetingId, makeFile("agenda.txt", "안건"), { title: "안건" });
    const imgFile = await doc.uploadMeetingAttachment(m2.meetingId, makeFile("photo.png", "x", "image/png"), { title: "사진" });
    ok("올린 직후 처리 상태는 QUEUED", okFile.processingStatus === "QUEUED" && imgFile.processingStatus === "QUEUED");
    const procs = await until(() => doc.listMeetingAttachments(m2.meetingId), p => p.items.every(a => a.processingStatus === "READY" || a.processingStatus === "FAILED"), 6000, 300);
    const txt = procs.items.find(a => a.documentId === okFile.documentId)!;
    const img = procs.items.find(a => a.documentId === imgFile.documentId)!;
    ok("텍스트는 READY, 이미지는 FAILED + NOT_SUPPORTED", txt.processingStatus === "READY" && !("processingFailureCode" in txt && txt.processingFailureCode) && img.processingStatus === "FAILED" && img.processingFailureCode === "NOT_SUPPORTED");
    ok("업로드 전 검사: 50MB 초과·긴 이름·압축 파일", doc.validateUploadFile(new File([new Uint8Array(1)], "a.zip")) !== null && doc.validateUploadFile(new File([new Uint8Array(1)], "가".repeat(101) + ".txt")) !== null && doc.validateUploadFile(makeFile("ok.txt", "x")) === null);

    // ── 참가자 제거 → 진행 중 채팅 스트림에 close(PARTICIPANT_REMOVED)가 간다 ──
    const m3 = await mtg.createMeeting({ projectId, title: "스트림", participantUserIds: [gyuchanId] });
    await mtg.startMeeting(m3.meetingId, { version: m3.version });
    let lastSeq = 0; const got: string[] = []; let closedReason: string | null = null;
    const stream = openMeetingChatStream(m3.meetingId, () => lastSeq, { onMessage: x => { got.push(x.text); lastSeq = x.streamSequence; }, onClosed: r => { closedReason = r; } });
    await sleep(500);
    await loginAs("gyuchan@anok.io");
    let gyuchanClosed: string | null = null;
    const stream2 = openMeetingChatStream(m3.meetingId, () => 0, { onMessage: () => {}, onClosed: r => { gyuchanClosed = r; } });
    await sleep(300);
    await mtg.sendChatMessage(m3.meetingId, "스트림으로 받는 메시지");
    await sleep(500);
    ok("SSE로 새 메시지를 실시간 수신", got.includes("스트림으로 받는 메시지") && lastSeq === 1);
    ok("같은 사용자가 같은 회의에서 3번째 스트림은 429", await (async () => {
      let fatal: ApiError | null = null; let retried = false;
      const s3 = openMeetingChatStream(m3.meetingId, () => 0, { onMessage: () => {}, onFatal: e => { fatal = e; }, onRetry: () => { retried = true; } });
      const s4 = openMeetingChatStream(m3.meetingId, () => 0, { onMessage: () => {}, onFatal: e => { fatal = e; }, onRetry: () => { retried = true; } });
      await sleep(500); s3.stop(); s4.stop();
      return fatal === null && retried; // 429는 치명적이지 않아 잠시 뒤 재시도한다
    })());
    await loginAs("wonjae@anok.io");
    await mtg.removeMeetingParticipant(m3.meetingId, gyuchanId);
    await sleep(400);
    ok("제거된 사람의 스트림만 PARTICIPANT_REMOVED로 닫힌다", gyuchanClosed === "PARTICIPANT_REMOVED" && closedReason === null);
    ok("제거된 사람은 더 이상 채팅을 쓸 수 없다", (await (async () => { await loginAs("gyuchan@anok.io"); return code(mtg.sendChatMessage(m3.meetingId, "x")); })()) === "403 MEETING_CHAT_ACCESS_DENIED");
    await loginAs("wonjae@anok.io");
    await mtg.endMeeting(m3.meetingId);
    await sleep(400);
    ok("회의가 끝나면 남은 스트림에 close(MEETING_ENDED)", closedReason === "MEETING_ENDED");
    stream.stop(); stream2.stop();
    let fatalAfter: ApiError | null = null;
    const s5 = openMeetingChatStream(m3.meetingId, () => 0, { onMessage: () => {}, onFatal: e => { fatalAfter = e; } });
    await sleep(400); s5.stop();
    ok("끝난 회의의 스트림은 409 MEETING_CHAT_CLOSED로 열리지 않고 재접속도 하지 않는다", (fatalAfter as ApiError | null)?.errorCode === "MEETING_CHAT_CLOSED");

    // ── 기록 접근권 회수: 종료된 회의의 상세·후처리가 막힌다 ──
    const parts = await mtg.listMeetingParticipants(m1.meetingId);
    const gp = parts.items.find((p: any) => p.userId === gyuchanId)!;
    const revoked = await mtg.updateMeetingRecordAccess(m1.meetingId, gyuchanId, { state: "REVOKED", reason: "보안 검토", version: gp.version });
    ok("기록 접근권 회수", revoked.recordAccessState === "REVOKED" && revoked.participationStatus === "ACTIVE");
    await loginAs("gyuchan@anok.io");
    ok("종료된 회의 상세 → 403 MEETING_RECORD_ACCESS_REVOKED", (await code(mtg.getMeeting(m1.meetingId))) === "403 MEETING_RECORD_ACCESS_REVOKED");
    ok("후처리도 403 MEETING_RECORD_ACCESS_REVOKED", (await code(mtg.getMeetingPostprocess(m1.meetingId))) === "403 MEETING_RECORD_ACCESS_REVOKED");
    ok("목록에서도 사라진다", !(await mtg.listMeetings({ projectId })).items.some((m: any) => m.meetingId === m1.meetingId));

    expect(scenario.fail, scenario.summary()).toBe(0);
  }, 120000);
});
