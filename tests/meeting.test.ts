// Meeting(04) 서비스 시나리오: 생명주기/채팅/LiveKit/후처리/회의록/후보 확정/참가자/조직자 이전/민감도/관리자 복구.
// postprocess가 STAGE_MS(1200ms) x 8단계로 실제 시간 경과를 흉내 내므로 이 파일은 기본 5s보다 긴 타임아웃이 필요하다.
import { describe, it, expect } from "vitest";
import * as idn from "../src/api/identity";
import * as mtg from "../src/api/meeting";
import * as prj from "../src/api/project";
import { tokenStore } from "../src/api/tokenStore";
import { code, createScenario, loginAdmin, loginAs, loginSmart, sleep, userIdByEmailAdmin } from "./helpers";

describe("Meeting(04) 시나리오", () => {
  it("회의 생명주기/채팅/후처리/회의록/후보 확정/참가자/민감도/관리자 복구가 명세대로 동작한다", async () => {
    const scenario = createScenario();
    const { ok } = scenario;

    await loginAdmin("insung@anok.io");
    const wonjaeId = await userIdByEmailAdmin("wonjae@anok.io");
    const gyuchanId = await userIdByEmailAdmin("gyuchan@anok.io");
    const minjunId = await userIdByEmailAdmin("minjun@anok.io");
    const dayoungId = await userIdByEmailAdmin("dayoung@anok.io");
    const jihyunId = await userIdByEmailAdmin("jihyun@anok.io");
    void dayoungId;

    // ── 시드 확인 ──
    await loginAs("wonjae@anok.io");
    const seedList = await mtg.listMeetings();
    ok("시드 회의 2건 접근 가능", seedList.page.total === 2);
    const scheduledSeed = seedList.items.find((m: any) => m.status === "SCHEDULED")!;
    const endedSeed = seedList.items.find((m: any) => m.status === "ENDED")!;
    ok("ENDED 시드는 postprocessStatus MINUTES_DRAFT로 이미 생성됨", endedSeed.postprocessStatus === "MINUTES_DRAFT");

    // ── 새 회의 생성(aiPipeline, wonjae가 MANAGER) ──
    const myProjects = await prj.listProjects();
    const aiProject = myProjects.items.find((p: any) => p.name === "AI 회의록 파이프라인")!;
    const created = await mtg.createMeeting({ projectId: aiProject.projectId, title: "스프린트 회고", participantUserIds: [gyuchanId, minjunId], sensitivityClassification: "INTERNAL" });
    ok("회의 생성 → organizer=reviewOwner=본인, SCHEDULED", created.organizerUserId === wonjaeId && created.reviewOwnerUserId === wonjaeId && created.status === "SCHEDULED");
    ok("생성자는 자동으로 참가자", (await mtg.listMeetingParticipants(created.meetingId)).items.some((p: any) => p.userId === wonjaeId));

    ok("프로젝트 비멤버를 참여자로 지정 → 409", (await code(mtg.createMeeting({ projectId: aiProject.projectId, title: "x", participantUserIds: [jihyunId] }))) === "409 PARTICIPANT_NOT_ELIGIBLE");

    const updated = await mtg.updateMeeting(created.meetingId, { title: "스프린트 회고 (9월)", version: created.version });
    ok("회의 메타데이터 수정", updated.title === "스프린트 회고 (9월)");

    // ── 시작 → IN_PROGRESS ──
    const started = await mtg.startMeeting(created.meetingId, { version: updated.version });
    ok("회의 시작", started.status === "IN_PROGRESS" && !!started.startedAt);
    ok("IN_PROGRESS 중 제목 수정 금지", (await code(mtg.updateMeeting(created.meetingId, { title: "x", version: started.version }))) === "409 MEETING_FIELD_UPDATE_NOT_ALLOWED_IN_PROGRESS");

    // ── 채팅 ──
    await mtg.sendChatMessage(created.meetingId, "안녕하세요, 회고 시작합니다.");
    await loginAs("gyuchan@anok.io");
    ok("SCHEDULED 회의에는 채팅 불가", (await code(mtg.sendChatMessage(scheduledSeed.meetingId, "hi"))) === "409 MEETING_CHAT_CLOSED");
    await mtg.sendChatMessage(created.meetingId, "네 시작하시죠.");
    await loginAs("wonjae@anok.io");
    const replay = await mtg.listChatMessages(created.meetingId);
    ok("채팅 replay 2건, streamSequence 순서대로", replay.items.length === 2 && replay.items[0].streamSequence === 1 && replay.items[1].streamSequence === 2);

    // ── LiveKit 토큰(권한 검증만) ──
    const lk = await mtg.issueLiveKitToken(created.meetingId);
    ok("LiveKit 토큰 발급(가짜)", !!lk.token && lk.roomName.includes(created.meetingId));
    await loginSmart("dayoung@anok.io");
    ok("참가자 아닌 사용자는 LiveKit 토큰 거부", (await code(mtg.issueLiveKitToken(created.meetingId))) === "403 MEETING_JOIN_DENIED");
    await loginAs("wonjae@anok.io");

    // ── 종료 → postprocess 파이프라인 ──
    const ended = await mtg.endMeeting(created.meetingId);
    ok("종료 → ENDED + postprocess 시작", ended.meeting.status === "ENDED" && ended.postprocess.status === "WAITING_EVIDENCE_SNAPSHOT");
    ok("종료된 회의에 채팅 불가", (await code(mtg.sendChatMessage(created.meetingId, "x"))) === "409 MEETING_CHAT_CLOSED");

    let pp = await mtg.getMeetingPostprocess(created.meetingId);
    const t0 = Date.now();
    while (pp.status !== "MINUTES_DRAFT" && Date.now() - t0 < 15000) { await sleep(500); pp = await mtg.getMeetingPostprocess(created.meetingId); }
    ok("postprocess가 MINUTES_DRAFT까지 자동 전진", pp.status === "MINUTES_DRAFT");

    const draftMinutes = await mtg.getMeetingMinutes(created.meetingId);
    ok("초안 회의록 생성(채팅 내용 반영)", draftMinutes.status === "DRAFT" && draftMinutes.content!.includes("안녕하세요"));

    const draftCandidates = await mtg.listMeetingCandidates(created.meetingId);
    ok("결정/업무 후보 2건 자동 생성", draftCandidates.page.total === 2 && draftCandidates.items.some((c: any) => c.type === "DECISION") && draftCandidates.items.some((c: any) => c.type === "TASK"));
    const decisionCand = draftCandidates.items.find((c: any) => c.type === "DECISION")!;
    const taskCand = draftCandidates.items.find((c: any) => c.type === "TASK")!;

    // ── 승인 전에는 confirm 불가 ──
    ok("회의록 승인 전 후보 확정 불가", (await code(mtg.confirmMeetingCandidate(created.meetingId, decisionCand.candidateId, decisionCand.version))) === "409 MINUTES_NOT_APPROVED");

    await loginAs("gyuchan@anok.io");
    ok("reviewOwner 아니면 회의록 수정/승인 불가", (await code(mtg.approveMeetingMinutes(created.meetingId, draftMinutes.version))) === "403 REVIEW_OWNER_REQUIRED");
    await loginAs("wonjae@anok.io");

    const editedMinutes = await mtg.updateMeetingMinutes(created.meetingId, { content: draftMinutes.content + "\n\n(reviewOwner 보완)", version: draftMinutes.version });
    ok("reviewOwner가 초안 보완", editedMinutes.content!.includes("보완") && editedMinutes.status === "DRAFT");

    const approved = await mtg.approveMeetingMinutes(created.meetingId, editedMinutes.version);
    ok("회의록 승인", approved.status === "APPROVED" && !!approved.approvedAt);
    ok("이미 승인된 회의록 재승인 불가", (await code(mtg.approveMeetingMinutes(created.meetingId, approved.version))) === "409 MINUTES_NOT_DRAFT");

    // ── 후보 편집 → 확정 → materialize ──
    const editedTask = await mtg.updateMeetingCandidate(created.meetingId, taskCand.candidateId, { title: "회고 후속 조치: 액션 아이템 정리", assigneeUserId: gyuchanId, version: taskCand.version });
    ok("업무 후보 편집(담당자 변경) → EDITED", editedTask.status === "EDITED" && editedTask.assigneeUserId === gyuchanId);

    const confirmedDecision = await mtg.confirmMeetingCandidate(created.meetingId, decisionCand.candidateId, decisionCand.version);
    ok("결정 후보 확정", confirmedDecision.status === "CONFIRMED");
    const confirmedTask = await mtg.confirmMeetingCandidate(created.meetingId, editedTask.candidateId, editedTask.version);
    ok("업무 후보 확정", confirmedTask.status === "CONFIRMED");

    // materialize는 202 + MATERIALIZATION_PENDING을 먼저 돌려주고, 실제 Task/Decision 생성은
    // project result consumer가 비동기로 반영한다(mock은 조회 시점에 지연을 해소한다 — mockMeeting.ts resolveMaterialization).
    async function pollCandidate(meetingId: string, candidateId: string, timeoutMs = 5000) {
      let c = (await mtg.listMeetingCandidates(meetingId, { limit: 100 })).items.find((x: any) => x.candidateId === candidateId)!;
      const t0 = Date.now();
      while (c.status === "MATERIALIZATION_PENDING" && Date.now() - t0 < timeoutMs) {
        await sleep(150);
        c = (await mtg.listMeetingCandidates(meetingId, { limit: 100 })).items.find((x: any) => x.candidateId === candidateId)!;
      }
      return c;
    }

    const materializingDecision = await mtg.materializeMeetingCandidate(created.meetingId, confirmedDecision.candidateId, confirmedDecision.version);
    ok("결정 후보 materialize 응답은 즉시 PENDING(202)", materializingDecision.status === "MATERIALIZATION_PENDING");
    ok("PENDING 중 중복 확정 시도 → 409(재요청 아님)", (await code(mtg.materializeMeetingCandidate(created.meetingId, materializingDecision.candidateId, materializingDecision.version))) === "409 CANDIDATE_NOT_CONFIRMED");
    const materializedDecision = await pollCandidate(created.meetingId, materializingDecision.candidateId);
    ok("결정 후보 → 폴링으로 확인한 최종 상태는 실제 Decision 생성", materializedDecision.status === "MATERIALIZED" && !!materializedDecision.materializedResourceId);

    const materializingTask = await mtg.materializeMeetingCandidate(created.meetingId, confirmedTask.candidateId, confirmedTask.version);
    ok("업무 후보 materialize 응답도 즉시 PENDING(202)", materializingTask.status === "MATERIALIZATION_PENDING");
    const materializedTask = await pollCandidate(created.meetingId, materializingTask.candidateId);
    ok("업무 후보 → 폴링으로 확인한 최종 상태는 실제 Task 생성(변경된 담당자로)", materializedTask.status === "MATERIALIZED" && !!materializedTask.materializedResourceId);
    ok("이미 MATERIALIZED된 후보 재확정 → 409 ALREADY_MATERIALIZED", (await code(mtg.materializeMeetingCandidate(created.meetingId, materializedDecision.candidateId, materializedDecision.version))) === "409 ALREADY_MATERIALIZED");

    const projDecisions = await prj.listDecisions(aiProject.projectId);
    const projTasks = await prj.listTasks(aiProject.projectId);
    ok("프로젝트 결정 목록에 반영", projDecisions.items.some((d: any) => d.decisionId === materializedDecision.materializedResourceId && d.sourceMeetingId === created.meetingId));
    ok("프로젝트 업무 목록에 반영(담당자=gyuchan)", projTasks.items.some((t: any) => t.taskId === materializedTask.materializedResourceId && t.assigneeUserId === gyuchanId));
    ok("결정 후보에서 Decision이 중복 생성되지 않음(정확히 1건)", projDecisions.items.filter((d: any) => d.sourceCandidateId === materializedDecision.candidateId).length === 1);
    ok("업무 후보에서 Task가 중복 생성되지 않음(정확히 1건)", projTasks.items.filter((t: any) => t.sourceCandidateId === materializedTask.candidateId).length === 1);

    // ── 비동기 실패 경로: PENDING으로 처리되는 사이 담당자가 프로젝트에서 제외되는 race를 재현 ──
    // (요청 형식에 테스트 전용 필드를 넣지 않고, 실제로 일어날 수 있는 조건 — 담당자 부적격화 — 으로 실패를 유도한다.)
    const raceMeeting = await mtg.createMeeting({ projectId: aiProject.projectId, title: "비동기 실패 경로 테스트", participantUserIds: [minjunId] });
    await mtg.startMeeting(raceMeeting.meetingId, { version: raceMeeting.version });
    await mtg.sendChatMessage(raceMeeting.meetingId, "실패 경로 테스트 메시지");
    await mtg.endMeeting(raceMeeting.meetingId);
    let ppRace = await mtg.getMeetingPostprocess(raceMeeting.meetingId);
    const tRace0 = Date.now();
    while (ppRace.status !== "MINUTES_DRAFT" && Date.now() - tRace0 < 15000) { await sleep(400); ppRace = await mtg.getMeetingPostprocess(raceMeeting.meetingId); }
    const raceMinutes = await mtg.getMeetingMinutes(raceMeeting.meetingId);
    await mtg.approveMeetingMinutes(raceMeeting.meetingId, raceMinutes.version);
    const raceTaskSeed = (await mtg.listMeetingCandidates(raceMeeting.meetingId)).items.find((c: any) => c.type === "TASK")!;
    const raceTaskAssigned = await mtg.updateMeetingCandidate(raceMeeting.meetingId, raceTaskSeed.candidateId, { title: raceTaskSeed.title, assigneeUserId: minjunId, version: raceTaskSeed.version });
    const raceConfirmed = await mtg.confirmMeetingCandidate(raceMeeting.meetingId, raceTaskAssigned.candidateId, raceTaskAssigned.version);
    const raceMaterializing = await mtg.materializeMeetingCandidate(raceMeeting.meetingId, raceConfirmed.candidateId, raceConfirmed.version);
    ok("race 시나리오: materialize도 즉시 PENDING", raceMaterializing.status === "MATERIALIZATION_PENDING");

    const minjunMembership = (await prj.listProjectMembers(aiProject.projectId)).items.find((m: any) => m.userId === minjunId)!;
    await prj.removeProjectMember(aiProject.projectId, minjunMembership.membershipId); // PENDING 해소 전에 담당자 자격을 잃게 만든다

    const raceFailed = await pollCandidate(raceMeeting.meetingId, raceMaterializing.candidateId);
    ok("[핵심] 처리 중 담당자가 부적격해지면 PENDING → MATERIALIZATION_FAILED로 전환", raceFailed.status === "MATERIALIZATION_FAILED" && raceFailed.failureReasonCode === "ASSIGNEE_INVALID");
    ok("실패해도 프로젝트에 Task가 생성되지 않음", (await prj.listTasks(aiProject.projectId)).items.filter((t: any) => t.sourceCandidateId === raceFailed.candidateId).length === 0);
    ok("담당자가 여전히 부적격이면 재시도도 동기적으로 거부", (await code(mtg.materializeMeetingCandidate(raceMeeting.meetingId, raceFailed.candidateId, raceFailed.version))) === "409 ASSIGNEE_INVALID");

    await prj.addProjectMember(aiProject.projectId, { userId: minjunId, role: "MEMBER" }); // 담당자 자격 복구
    const raceRetrying = await mtg.materializeMeetingCandidate(raceMeeting.meetingId, raceFailed.candidateId, raceFailed.version);
    ok("자격 복구 후 재시도는 다시 PENDING으로 수락됨", raceRetrying.status === "MATERIALIZATION_PENDING" && raceRetrying.attemptCount === raceFailed.attemptCount + 1);
    const raceRecovered = await pollCandidate(raceMeeting.meetingId, raceRetrying.candidateId);
    ok("재시도 성공 → MATERIALIZED, 실제 Task 정확히 1건 생성", raceRecovered.status === "MATERIALIZED" && (await prj.listTasks(aiProject.projectId)).items.filter((t: any) => t.sourceCandidateId === raceRecovered.candidateId).length === 1);

    // ── 참가자 관리 ──
    const parts = await mtg.listMeetingParticipants(created.meetingId);
    const minjunPart = parts.items.find((p: any) => p.userId === minjunId);
    ok("종료된 회의에는 참가자 추가 불가", (await code(mtg.addMeetingParticipant(created.meetingId, jihyunId))) === "409 MEETING_NOT_SCHEDULED");
    ok("organizer 본인 제거 금지", (await code(mtg.removeMeetingParticipant(created.meetingId, wonjaeId))) === "409 ORGANIZER_REMOVE_FORBIDDEN");
    await mtg.removeMeetingParticipant(created.meetingId, minjunId);
    const partsAfter = await mtg.listMeetingParticipants(created.meetingId);
    ok("참가자 제거 반영", partsAfter.items.find((p: any) => p.userId === minjunId)!.participationStatus === "REMOVED");

    const revoked = await mtg.updateMeetingRecordAccess(created.meetingId, gyuchanId, { state: "REVOKED", reason: "보안 검토", version: parts.items.find((p: any) => p.userId === gyuchanId)!.version });
    ok("기록 접근 회수", revoked.recordAccessState === "REVOKED");
    ok("동일 상태로 재요청 → 409", (await code(mtg.updateMeetingRecordAccess(created.meetingId, gyuchanId, { state: "REVOKED", reason: "x", version: revoked.version }))) === "409 RECORD_ACCESS_ALREADY_STATE");
    void minjunPart;

    // ── 조직자 이전 (새 SCHEDULED 회의로 테스트) ──
    const created2 = await mtg.createMeeting({ projectId: aiProject.projectId, title: "설계 리뷰", participantUserIds: [gyuchanId] });
    await mtg.setMeetingPassword(created2.meetingId, { password: "sprint2026", version: created2.version });
    const withPassword = await mtg.getMeeting(created2.meetingId);
    await mtg.transferMeetingOrganizer(created2.meetingId, { targetUserId: gyuchanId, version: withPassword.version });
    const afterTransfer = await mtg.getMeeting(created2.meetingId);
    ok("조직자 이전(reviewOwner는 그대로 유지)", afterTransfer.organizerUserId === gyuchanId && afterTransfer.reviewOwnerUserId === wonjaeId);

    // ── 비밀번호 보호(비-조직자 참가자에게만 요구) ──
    await loginAs("gyuchan@anok.io");
    const started2 = await mtg.startMeeting(created2.meetingId, { version: afterTransfer.version });
    await loginAs("wonjae@anok.io");
    ok("비-조직자는 비밀번호 틀리면 LiveKit 토큰 거부", (await code(mtg.issueLiveKitToken(created2.meetingId, "wrong"))) === "401 MEETING_PASSWORD_INVALID");
    const lk2 = await mtg.issueLiveKitToken(created2.meetingId, "sprint2026");
    ok("올바른 비밀번호로 LiveKit 토큰 발급", !!lk2.token);

    // ── 민감 회의 → AI_EGRESS_BLOCKED ──
    const sensitive = await mtg.createMeeting({ projectId: aiProject.projectId, title: "고객 PII 논의", sensitivityClassification: "PII" });
    ok("민감도 강등 금지", (await code(mtg.updateMeeting(sensitive.meetingId, { sensitivityClassification: "INTERNAL", version: sensitive.version }))) === "409 SENSITIVITY_DOWNGRADE_FORBIDDEN");
    const sensStarted = await mtg.startMeeting(sensitive.meetingId, { version: sensitive.version });
    await mtg.sendChatMessage(sensitive.meetingId, "민감 정보 논의");
    await mtg.endMeeting(sensitive.meetingId);
    let ppSens = await mtg.getMeetingPostprocess(sensitive.meetingId);
    const t1 = Date.now();
    while (!["AI_EGRESS_BLOCKED", "MINUTES_DRAFT"].includes(ppSens.status) && Date.now() - t1 < 15000) { await sleep(500); ppSens = await mtg.getMeetingPostprocess(sensitive.meetingId); }
    ok("민감 회의는 외부 AI 전송 차단으로 멈춤", ppSens.status === "AI_EGRESS_BLOCKED");
    const sensMinutes = await mtg.getMeetingMinutes(sensitive.meetingId);
    ok("차단 시 회의록 상태 FAILED", sensMinutes.status === "FAILED");
    void sensStarted;

    // ── 재생성 / 재시도 ──
    ok("승인된 회의록은 재생성 금지", (await code(mtg.regenerateMeetingMinutes(created.meetingId))) === "409 MINUTES_APPROVED");
    ok("실패 상태 아니면 재시도 불가", (await code(mtg.retryMeetingPostprocess(created.meetingId))) === "409 POSTPROCESS_NOT_RETRYABLE");
    const regenerated = await mtg.regenerateMeetingMinutes(endedSeed.meetingId);
    ok("미승인 회의록은 재생성 가능(초안 다시 생성)", regenerated.status === "MINUTES_DRAFT");

    // ── 관리자 복구/설정 (화면 없음 — API 계약만 검증) ──
    await loginAdmin("insung@anok.io");
    ok("관리자 회의 설정 변경도 step-up 필요", (await code(mtg.updateMeetingSettings({ defaultSensitivityClassification: "CONFIDENTIAL", version: 1 }))) === "403 STEP_UP_REQUIRED");
    const ch = await idn.createStepUpChallenge();
    const su = await idn.completeStepUp({ challengeToken: ch.challengeToken, password: "AnokDemo!2026", code: "123456" });
    tokenStore.set(su.accessToken);
    const settings = await mtg.getMeetingSettings();
    ok("회의 설정 기본값 조회", settings.defaultSensitivityClassification === "INTERNAL");
    const settingsUpdated = await mtg.updateMeetingSettings({ defaultSensitivityClassification: "CONFIDENTIAL", version: settings.version });
    ok("회의 설정 변경", settingsUpdated.defaultSensitivityClassification === "CONFIDENTIAL");
    const recoveryQueue = await mtg.listMeetingRecoveryQueue();
    ok("복구 큐 조회 가능", Array.isArray(recoveryQueue.items));
    const forceEnded = await mtg.adminForceEndMeeting(started2.meetingId, "관리자 강제 종료");
    ok("관리자 강제 종료", forceEnded.meeting.status === "ENDED");

    expect(scenario.fail, scenario.summary()).toBe(0);
  }, 60000);
});
