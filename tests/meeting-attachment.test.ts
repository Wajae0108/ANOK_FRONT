// Meeting(04) ↔ Document(03) 연동: 회의에 기존 문서 병합/새 파일 업로드/분리, 회의 비참가자 접근 차단.
import { describe, it, expect } from "vitest";
import * as doc from "../src/api/document";
import * as mtg from "../src/api/meeting";
import * as prj from "../src/api/project";
import { code, createScenario, loginAdmin, loginAs, makeFile, userIdByEmailAdmin } from "./helpers";

describe("Meeting 자료(첨부 문서) 시나리오", () => {
  it("기존 문서 병합/새 파일 업로드/분리와 회의 참가자 스코프 접근 제어가 명세대로 동작한다", async () => {
    const scenario = createScenario();
    const { ok } = scenario;

    await loginAdmin("insung@anok.io");
    const gyuchanId = await userIdByEmailAdmin("gyuchan@anok.io");
    const minjunId = await userIdByEmailAdmin("minjun@anok.io");
    void minjunId;

    // ── 준비: wonjae가 MANAGER인 프로젝트에 새 회의 생성, gyuchan만 참가자로 초대 ──
    // (minjun은 이 프로젝트 멤버지만 이 회의엔 미참가 → "회의 비참가자" 시나리오에 사용)
    await loginAs("wonjae@anok.io");
    const myProjects = await prj.listProjects();
    const aiProject = myProjects.items.find((p: any) => p.name === "AI 회의록 파이프라인")!;
    const meeting = await mtg.createMeeting({ projectId: aiProject.projectId, title: "자료 병합 테스트 회의", participantUserIds: [gyuchanId] });
    ok("회의 생성(SCHEDULED)", meeting.status === "SCHEDULED");

    const myDoc = await doc.uploadDocument(makeFile("설계초안.txt", "hello"), { title: "설계초안" });
    ok("문서 업로드 → OWNER", myDoc.effectivePermission === "OWNER");

    // ── 기존 문서 병합(ATTACH_EXISTING) — SCHEDULED 단계에서도 control OPEN ──
    ok("SCHEDULED 상태에서도 자료 병합 가능", (await code(doc.attachExistingDocumentToMeeting(meeting.meetingId, myDoc.documentId))) === "OK");
    const list1 = await doc.listMeetingAttachments(meeting.meetingId);
    ok("병합된 문서가 회의 자료 목록에 노출", list1.items.length === 1 && list1.items[0].documentId === myDoc.documentId);

    const myList = await doc.listDocuments();
    ok("소유자 본인의 문서함에는 정상 노출(OWNER 기준)", myList.items.some((d: any) => d.documentId === myDoc.documentId));

    ok("존재하지 않는 회의에 병합 시도 → 404", (await code(doc.attachExistingDocumentToMeeting("00000000-0000-0000-0000-000000000000", myDoc.documentId))) === "404 MEETING_NOT_FOUND");

    // ── 회의 참가자(gyuchan) — MEETING_INHERITED로 문서 상세는 열람 가능하지만 문서함 전체 목록엔 안 뜸 ──
    await loginAs("gyuchan@anok.io");
    const gyuchanList = await doc.listDocuments();
    ok("[핵심] 회의에 병합된 문서는 참가자의 문서함 전체 목록에도 노출되지 않음", !gyuchanList.items.some((d: any) => d.documentId === myDoc.documentId));
    const viewed = await doc.getDocument(myDoc.documentId);
    ok("회의 참가자는 병합 문서 상세를 직접 링크로 열람 가능(VIEWER, MEETING_INHERITED)", viewed.effectivePermission === "VIEWER" && viewed.permissionSource === "MEETING_INHERITED");
    ok("회의 참가자는 회의 자료 목록도 조회 가능", (await doc.listMeetingAttachments(meeting.meetingId)).items.length === 1);
    ok("참가자는 OWNER가 아니므로 기존 문서 재병합 시도 시 403", (await code(doc.attachExistingDocumentToMeeting(meeting.meetingId, myDoc.documentId))) === "403 DOCUMENT_OWNER_REQUIRED");

    // ── 비참가자(minjun) — 회의도, 병합 문서도 전혀 접근 불가 ──
    await loginAs("minjun@anok.io");
    ok("[핵심] 회의 비참가자는 병합 문서를 아예 열람할 수 없음", (await code(doc.getDocument(myDoc.documentId))) === "403 DOCUMENT_ACCESS_DENIED");
    ok("[핵심] 회의 비참가자는 회의 자료 목록 자체를 조회할 수 없음", (await code(doc.listMeetingAttachments(meeting.meetingId))) === "403 MEETING_DOCUMENT_ACCESS_DENIED");
    ok("비참가자의 문서함 전체 목록에도 당연히 노출 안 됨", !(await doc.listDocuments()).items.some((d: any) => d.documentId === myDoc.documentId));

    // ── 새 파일을 회의 자료로 직접 업로드(ATTACH_NEW) ──
    await loginAs("wonjae@anok.io");
    const uploaded = await doc.uploadMeetingAttachment(meeting.meetingId, makeFile("회의자료.txt", "agenda"), { title: "회의 안건" });
    ok("새 파일을 회의 자료로 업로드", uploaded.title === "회의 안건");
    ok("회의 자료 목록 2건", (await doc.listMeetingAttachments(meeting.meetingId)).items.length === 2);

    // ── 분리(DETACH) ──
    await doc.detachMeetingAttachment(meeting.meetingId, myDoc.documentId);
    ok("분리 후 회의 자료 목록 1건", (await doc.listMeetingAttachments(meeting.meetingId)).items.length === 1);
    await loginAs("gyuchan@anok.io");
    ok("분리된 문서는 더 이상 회의 참가자에게도 안 보임", (await code(doc.getDocument(myDoc.documentId))) === "403 DOCUMENT_ACCESS_DENIED");

    // ── 회의 종료 → control FROZEN ──
    await loginAs("wonjae@anok.io");
    const started = await mtg.startMeeting(meeting.meetingId, { version: meeting.version });
    await mtg.endMeeting(meeting.meetingId);
    ok("회의 종료 후 자료 추가 시도 → 409 FROZEN", (await code(doc.attachExistingDocumentToMeeting(meeting.meetingId, myDoc.documentId))) === "409 MEETING_EVIDENCE_FROZEN");
    ok("회의 종료 후 자료 분리 시도 → 409 FROZEN", (await code(doc.detachMeetingAttachment(meeting.meetingId, uploaded.documentId))) === "409 MEETING_EVIDENCE_FROZEN");
    ok("종료 후에도 기존 자료 목록 조회는 가능", (await doc.listMeetingAttachments(meeting.meetingId)).items.length === 1);
    void started;

    expect(scenario.fail, scenario.summary()).toBe(0);
  });
});
