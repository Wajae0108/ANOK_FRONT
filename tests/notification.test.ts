// Notification(05) 서비스 시나리오: SSE 스트림/DB Inbox/읽음 처리/cursor 페이지네이션/수신자 격리.
import { describe, it, expect } from "vitest";
import * as doc from "../src/api/document";
import * as idn from "../src/api/identity";
import * as mtg from "../src/api/meeting";
import * as ntf from "../src/api/notification";
import * as prj from "../src/api/project";
import { code, createScenario, loginAdmin, loginAs, loginSmart, sleep, userIdByEmailAdmin } from "./helpers";

describe("Notification(05) 시나리오", () => {
  it("SSE 실시간 수신/DB Inbox/읽음 처리/페이지네이션/수신자 격리가 명세대로 동작한다", async () => {
    const scenario = createScenario();
    const { ok } = scenario;

    await loginAdmin("insung@anok.io");
    const wonjaeId = await userIdByEmailAdmin("wonjae@anok.io");
    const gyuchanId = await userIdByEmailAdmin("gyuchan@anok.io");
    const minjunId = await userIdByEmailAdmin("minjun@anok.io");
    const jihyunId = await userIdByEmailAdmin("jihyun@anok.io");
    void jihyunId;
    const allAdminUsers = (await idn.listAdminUsers({ limit: 100 })).items as any[];
    const emailOf = (userId: string) => allAdminUsers.find(u => u.userId === userId)?.email as string | undefined;

    // ── SSE 실시간 스트림: gyuchan으로 연결해두고 이후 이벤트들이 실시간으로 도착하는지 확인 ──
    await loginSmart("gyuchan@anok.io");
    const received: any[] = [];
    const streamHandle = ntf.streamNotifications((e: any) => received.push(e), (e: any) => console.error("stream error", e));
    await sleep(150); // 연결 수립 대기

    // ── wonjae: aiPipeline 프로젝트 MANAGER → gyuchan에게 업무 배정 ──
    await loginAs("wonjae@anok.io");
    const before = await ntf.getUnreadCount();
    const myProjects = await prj.listProjects();
    const aiProject = myProjects.items.find((p: any) => p.name === "AI 회의록 파이프라인")!;
    const task = await prj.createTask(aiProject.projectId, { title: "알림 테스트 업무", assigneeUserId: gyuchanId });
    await sleep(50);

    await loginSmart("gyuchan@anok.io");
    const afterAssign = await ntf.getUnreadCount();
    ok("업무 배정 시 unreadCount 증가", afterAssign.unreadCount === before.unreadCount + 1);
    const inbox1 = await ntf.listNotifications({ limit: 20 });
    const assignedNotif = inbox1.items.find((n: any) => n.notificationType === "TASK_ASSIGNED" && n.resourceId === task.taskId);
    ok("TASK_ASSIGNED 알림 생성 확인(secondary=PROJECT)", !!assignedNotif && assignedNotif.secondaryResourceType === "PROJECT" && assignedNotif.secondaryResourceId === aiProject.projectId && assignedNotif.read === false);

    // 재배정(다른 담당자로 변경) → 이전 담당자(gyuchan)에게 TASK_UNASSIGNED
    await loginAs("wonjae@anok.io");
    await prj.updateTaskAssignee(aiProject.projectId, task.taskId, { assigneeUserId: minjunId, version: task.version });
    await sleep(50);
    await loginSmart("gyuchan@anok.io");
    const inbox2 = await ntf.listNotifications({ limit: 20, type: "TASK_UNASSIGNED" });
    ok("담당자 변경 시 이전 담당자에게 TASK_UNASSIGNED", inbox2.items.some((n: any) => n.resourceId === task.taskId));

    // ── 프로젝트 멤버 추가: wonjae가 jihyun을 aiPipeline에 멤버로 추가 ──
    await loginAs("wonjae@anok.io");
    await prj.addProjectMember(aiProject.projectId, { userId: jihyunId, role: "MEMBER" });
    await sleep(50);
    await loginSmart("jihyun@anok.io");
    const jihyunInbox = await ntf.listNotifications({ limit: 5 });
    ok("프로젝트 멤버 추가 알림(PROJECT_MEMBER_ADDED)", jihyunInbox.items.some((n: any) => n.notificationType === "PROJECT_MEMBER_ADDED" && n.resourceId === aiProject.projectId));

    // ── 회의 참가자 추가/제거 ──
    await loginAs("wonjae@anok.io");
    const meetingCreated = await mtg.createMeeting({ projectId: aiProject.projectId, title: "알림 테스트 회의", participantUserIds: [gyuchanId] });
    await sleep(50);
    await loginSmart("gyuchan@anok.io");
    const gyuchanInboxMeeting = await ntf.listNotifications({ limit: 5, type: "MEETING_PARTICIPANT_ADDED" });
    ok("회의 참가자 추가 알림(MEETING_PARTICIPANT_ADDED)", gyuchanInboxMeeting.items.some((n: any) => n.resourceId === meetingCreated.meetingId));

    await loginAs("wonjae@anok.io");
    await mtg.removeMeetingParticipant(meetingCreated.meetingId, gyuchanId);
    await sleep(50);
    await loginSmart("gyuchan@anok.io");
    const gyuchanInboxRemoved = await ntf.listNotifications({ limit: 5, type: "MEETING_PARTICIPATION_REMOVED" });
    ok("회의 참가자 제거 알림(MEETING_PARTICIPATION_REMOVED)", gyuchanInboxRemoved.items.some((n: any) => n.resourceId === meetingCreated.meetingId));

    // ── 회의록 승인 → 참가자 전원(승인자 제외)에게 MEETING_MINUTES_APPROVED ──
    await loginAs("wonjae@anok.io");
    const seedList = await mtg.listMeetings();
    const endedSeed = seedList.items.find((m: any) => m.status === "ENDED")!;
    let pp = await mtg.getMeetingPostprocess(endedSeed.meetingId);
    const t0 = Date.now();
    while (pp.status !== "MINUTES_DRAFT" && Date.now() - t0 < 15000) { await sleep(300); pp = await mtg.getMeetingPostprocess(endedSeed.meetingId); }
    const draftMinutes = await mtg.getMeetingMinutes(endedSeed.meetingId);
    if (draftMinutes.status === "DRAFT") {
      await mtg.approveMeetingMinutes(endedSeed.meetingId, draftMinutes.version);
      await sleep(50);
      const parts = await mtg.listMeetingParticipants(endedSeed.meetingId, { participationStatus: "ACTIVE" });
      const otherParticipant = parts.items.find((p: any) => p.userId !== wonjaeId);
      if (otherParticipant) {
        await loginSmart(emailOf(otherParticipant.userId) ?? "gyuchan@anok.io");
        const inboxApproved = await ntf.listNotifications({ limit: 20, type: "MEETING_MINUTES_APPROVED" });
        ok("회의록 승인 시 참가자에게 MEETING_MINUTES_APPROVED(승인자 본인 제외)", inboxApproved.items.some((n: any) => n.secondaryResourceId === endedSeed.meetingId));
      } else ok("회의록 승인 알림 대상 참가자 존재", false);
    } else ok("회의록 승인 시나리오 준비(DRAFT 상태 도달)", false);

    // ── 문서 소유권 이전 ──
    await loginAs("gyuchan@anok.io");
    const docs = await doc.listDocuments();
    const apiSpec = docs.items.find((d: any) => d.title === "API 명세서 v2.1.pdf");
    if (apiSpec && apiSpec.effectivePermission === "OWNER") {
      const transferred = await doc.transferDocumentOwner(apiSpec.documentId, { targetUserId: wonjaeId, version: apiSpec.version });
      ok("소유권 이전 성공", transferred.ownerUserId === wonjaeId);
      await sleep(50);
      await loginAs("wonjae@anok.io");
      const wonjaeInbox = await ntf.listNotifications({ limit: 5, type: "DOCUMENT_OWNERSHIP_TRANSFERRED" });
      ok("문서 소유권 이전 알림(DOCUMENT_OWNERSHIP_TRANSFERRED)", wonjaeInbox.items.some((n: any) => n.resourceId === apiSpec.documentId));
    } else ok("문서 소유권 이전 시나리오 준비", false);

    // ── 읽음 처리 ──
    await loginSmart("gyuchan@anok.io");
    const gInbox = await ntf.listNotifications({ limit: 20 });
    ok("gyuchan 알림 목록에 항목 존재", gInbox.items.length > 0);
    const firstUnread = gInbox.items.find((n: any) => !n.read);
    if (firstUnread) {
      const readResult = await ntf.setNotificationReadState(firstUnread.notificationId, true);
      ok("단건 읽음 처리", readResult.read === true && !!readResult.readAt);
      const readAgain = await ntf.setNotificationReadState(firstUnread.notificationId, true);
      ok("동일 상태 재요청도 안전(반복 가능)", readAgain.read === true);
    } else ok("단건 읽음 처리 대상 존재", false);

    ok("다른 사용자 알림 ID로 읽음 처리 시도 → 404", (await code(ntf.setNotificationReadState(crypto.randomUUID(), true))) === "404 NOTIFICATION_NOT_FOUND");

    const beforeAll = await ntf.getUnreadCount();
    const markAll = await ntf.markAllNotificationsRead();
    ok("read-all → updatedCount가 이전 unread 수와 일치", markAll.updatedCount === beforeAll.unreadCount);
    const afterAll = await ntf.getUnreadCount();
    ok("read-all 이후 unreadCount=0", afterAll.unreadCount === 0);
    const markAllAgain = await ntf.markAllNotificationsRead();
    ok("read-all 재호출은 안전(updatedCount=0)", markAllAgain.updatedCount === 0);

    // ── cursor pagination ──
    const page1 = await ntf.listNotifications({ limit: 2 });
    ok("cursor 페이지네이션: limit 준수", page1.items.length <= 2);
    if (page1.page.hasNext && page1.page.nextCursor) {
      const page2 = await ntf.listNotifications({ limit: 2, cursor: page1.page.nextCursor });
      const overlap = page2.items.some((n: any) => page1.items.some((p: any) => p.notificationId === n.notificationId));
      ok("다음 페이지는 이전 페이지와 중복 없음", !overlap);
    } else ok("페이지가 1개뿐이라 다음 페이지 검증 생략(자연 통과)", true);
    ok("잘못된 cursor → 400 INVALID_CURSOR", (await code(ntf.listNotifications({ cursor: "not-a-valid-cursor!!" }))) === "400 INVALID_CURSOR");

    // ── 격리: 다른 사용자 알림을 볼 수 없음(전부 recipient 스코프) ──
    await loginAs("wonjae@anok.io");
    const wonjaeInboxFinal = await ntf.listNotifications({ limit: 100 });
    ok("자신에게 온 알림만 보임(TASK_ASSIGNED가 wonjae 목록엔 없음 - 본인이 배정한 것)", !wonjaeInboxFinal.items.some((n: any) => n.notificationType === "TASK_ASSIGNED" && n.resourceId === task.taskId));

    streamHandle.stop();
    await sleep(50);
    ok("SSE로 실시간 이벤트 최소 1건 수신", received.length > 0);
    ok("SSE 이벤트에 회의록 승인/업무 배정 등 notificationType 포함", received.some((e: any) => typeof e.notificationType === "string"));

    expect(scenario.fail, scenario.summary()).toBe(0);
  }, 60000);
});
