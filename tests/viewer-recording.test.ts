// FRONTEND_03(원본 녹음 합본 MP3)·FRONTEND_06(종료 후 열람자 초대·회수) 화면 규칙과 mock 서버 시나리오.
//  · 순수 규칙: 녹음 상태/오류 문구, 열람자 판단·버튼 조건·초대 오류 문구
//  · mock 시나리오: 종료된 회의에서 프로젝트 멤버가 아닌 열람자(오지현)와 멤버인 열람자(한승우)의 가시성, 초대·회수·재초대, 녹음 합본 권한
import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api/errors";
import * as mtg from "../src/api/meeting";
import type { MeetingParticipantResponse } from "../src/api/meeting";
import * as idn from "../src/api/identity";
import { recordingDownloadError, recordingUiFromAvailability, recordingUiFromError } from "../src/meetings/recordingView";
import { canInviteViewer, canReinviteViewer, canRevokeViewer, isOutsideViewer, myMeetingRole, viewerInviteErrorText, viewerInviteExclude } from "../src/meetings/viewerAccess";
import { code, createScenario, loginAs } from "./helpers";

const part = (userId: string, o: Partial<MeetingParticipantResponse> = {}): MeetingParticipantResponse =>
  ({ participantId: `p-${userId}`, meetingId: "m", userId, meetingRole: "PARTICIPANT", participationStatus: "ACTIVE", recordAccessState: "GRANTED", joinedRelationAt: "2026-10-19T00:00:00Z", version: 1, ...o });

describe("녹음 합본 화면 규칙", () => {
  it("availability 상태 → 화면", () => {
    expect(recordingUiFromAvailability({ state: "READY", mediaType: "audio/mpeg", fileExtension: "mp3" }).kind).toBe("ready");
    expect(recordingUiFromAvailability({ state: "NOT_READY", reasonCode: "RECORDING_NOT_READY" })).toMatchObject({ kind: "notice", tone: "wait", recheck: true });
    expect(recordingUiFromAvailability({ state: "UNAVAILABLE", reasonCode: "RECORDING_UNAVAILABLE" })).toMatchObject({ kind: "notice", tone: "off", recheck: false });
    expect(recordingUiFromAvailability({ state: "UNAVAILABLE", reasonCode: "RECORDING_DOWNLOAD_TOO_LARGE" })).toMatchObject({ kind: "notice", tone: "off" });
  });
  it("기능이 꺼져 있거나(404 ROUTE_NOT_FOUND) 권한이 없으면(403) 카드를 그리지 않는다", () => {
    expect(recordingUiFromError({ status: 404, errorCode: "ROUTE_NOT_FOUND" }).kind).toBe("hidden");
    expect(recordingUiFromError({ status: 403, errorCode: "RECORDING_DOWNLOAD_FORBIDDEN" }).kind).toBe("hidden");
    expect(recordingUiFromError({ status: 403, errorCode: "ANY" }).kind).toBe("hidden");
    expect(recordingUiFromError({ status: 500, errorCode: "X" })).toMatchObject({ kind: "notice", recheck: true });
  });
  it("받기 오류는 errorCode로 나누고, 다시 해도 소용없는 것은 재시도를 막는다", () => {
    const t = (c: string, s = 409) => recordingDownloadError({ status: s, errorCode: c });
    expect(t("RECORDING_UNAVAILABLE", 404).retry).toBe(false);
    expect(t("RECORDING_DOWNLOAD_TOO_LARGE", 413).retry).toBe(false);
    expect(t("RECORDING_DOWNLOAD_FORBIDDEN", 403)).toEqual({ text: "권한이 없습니다.", retry: false });
    expect(t("RECORDING_NOT_READY").retry).toBe(true);
    expect(t("RECORDING_DOWNLOAD_BUSY", 429).retry).toBe(true);
    expect(t("RECORDING_DOWNLOAD_TIMEOUT", 504).retry).toBe(true);
    expect(t("RECORDING_DOWNLOAD_INCOMPLETE", 0).text).toContain("끝까지");
    expect(t("WHATEVER", 500).retry).toBe(true);
    expect(t("WHATEVER", 400).retry).toBe(false);
  });
});

describe("열람자 화면 규칙", () => {
  const items = [part("org", { meetingRole: "PARTICIPANT" }), part("v1", { meetingRole: "VIEWER" }), part("v2", { meetingRole: "VIEWER", participationStatus: "REMOVED", recordAccessState: "REVOKED" }), part("gone", { participationStatus: "REMOVED" })];
  it("내 역할은 참가자 목록의 내 행으로 안다(회수된 행은 현재 역할이 아니다)", () => {
    expect(myMeetingRole(items, "v1")).toBe("VIEWER");
    expect(myMeetingRole(items, "org")).toBe("PARTICIPANT");
    expect(myMeetingRole(items, "v2")).toBeNull();
    expect(myMeetingRole(items, "nobody")).toBeNull();
    expect(myMeetingRole([part("old")].map(p => ({ ...p, meetingRole: undefined })), "old")).toBe("PARTICIPANT"); // 필드가 없으면 일반 참여자
  });
  it("프로젝트 멤버가 아닌 열람자만 '바깥 열람자'다 — 프로젝트를 아직 못 읽었으면 판단하지 않는다", () => {
    expect(isOutsideViewer("VIEWER", true, false)).toBe(true);
    expect(isOutsideViewer("VIEWER", true, true)).toBe(false);
    expect(isOutsideViewer("VIEWER", false, false)).toBe(false);
    expect(isOutsideViewer("PARTICIPANT", true, false)).toBe(false);
    expect(isOutsideViewer(null, true, false)).toBe(false);
  });
  it("초대는 주최자만 예정·종료일 때, 회수는 종료 후 열람자 행만, 재초대는 회수된 열람자만", () => {
    expect(canInviteViewer({ status: "ENDED" }, true)).toBe(true);
    expect(canInviteViewer({ status: "SCHEDULED" }, true)).toBe(true);
    expect(canInviteViewer({ status: "IN_PROGRESS" }, true)).toBe(false);
    expect(canInviteViewer({ status: "CANCELED" }, true)).toBe(false);
    expect(canInviteViewer({ status: "ENDED" }, false)).toBe(false);
    expect(canRevokeViewer({ status: "ENDED" }, true, items[1])).toBe(true);
    expect(canRevokeViewer({ status: "ENDED" }, true, items[0])).toBe(false); // 실제 참석자는 409
    expect(canRevokeViewer({ status: "ENDED" }, false, items[1])).toBe(false);
    expect(canRevokeViewer({ status: "ENDED" }, true, items[2])).toBe(false);
    expect(canReinviteViewer({ status: "ENDED" }, true, items[2])).toBe(true);
    expect(canReinviteViewer({ status: "ENDED" }, true, items[3])).toBe(false);
  });
  it("초대 대상에서는 활성 참가자와 빠진 일반 참여자를 빼고, 회수된 열람자는 남긴다", () => {
    const ex = viewerInviteExclude(items);
    expect(ex.has("org")).toBe(true); expect(ex.has("v1")).toBe(true); expect(ex.has("gone")).toBe(true);
    expect(ex.has("v2")).toBe(false);
  });
  it("초대·회수 오류 문구", () => {
    const t = (c: string) => viewerInviteErrorText({ status: 409, errorCode: c });
    expect(t("TARGET_USER_INACTIVE")).toBe("비활성 사용자입니다.");
    expect(t("PARTICIPANT_ALREADY_EXISTS")).toBe("이미 추가된 사람입니다.");
    expect(t("MEETING_NOT_SCHEDULED")).toBe("지금은 추가할 수 없는 회의 상태입니다.");
    expect(t("MEETING_STATE_NOT_MUTABLE")).toContain("참석한");
    expect(t("UNKNOWN")).toBeNull();
  });
});

describe("열람자·녹음 합본 mock 시나리오", () => {
  it("종료된 회의에서 초대·가시성·회수·재초대·녹음 권한이 명세대로 동작한다", async () => {
    const { ok, summary, failures } = createScenario();
    const fail = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e instanceof ApiError ? e : null; } };

    const org = (await (async () => { await loginAs("wonjae@anok.io"); return idn.getOrganization(); })()).users;
    const idOf = (name: string) => org.find(u => u.displayName === name)!.userId;
    const gyuchan = idOf("김규찬"), jihyun = idOf("오지현"), seungwoo = idOf("한승우"), insung = idOf("박인성");

    // 시드: 종료된 회의 'AI 파이프라인 설계 리뷰' — 주최자·검토자 이원재, 참석자 김규찬·박민준·최다영, 초안 회의록
    const meeting = (await mtg.listMeetings({ status: "ENDED" })).items.find(x => x.title === "AI 파이프라인 설계 리뷰")!;
    const mid = meeting.meetingId;

    // ── 초대 검증 ──
    ok("종료 후 PARTICIPANT → 409 MEETING_NOT_SCHEDULED", (await code(mtg.addMeetingParticipant(mid, seungwoo))) === "409 MEETING_NOT_SCHEDULED");
    ok("종료 후 role 생략(기본 PARTICIPANT)도 같은 409", (await code(mtg.addMeetingParticipant(mid, jihyun))) === "409 MEETING_NOT_SCHEDULED");
    ok("role 값 오류 → INVALID_ENUM", (await fail(mtg.addMeetingParticipant(mid, jihyun, "OWNER" as never)))?.fieldErrors?.[0]?.reason === "INVALID_ENUM");
    ok("userId 형식 오류 → INVALID_UUID", (await fail(mtg.addMeetingParticipant(mid, "abc", "VIEWER")))?.fieldErrors?.[0]?.reason === "INVALID_UUID");
    ok("이미 참석자인 사람 → 409 PARTICIPANT_ALREADY_EXISTS", (await code(mtg.addMeetingParticipant(mid, gyuchan, "VIEWER"))) === "409 PARTICIPANT_ALREADY_EXISTS");
    ok("없는 사용자 → 404 TARGET_USER_NOT_FOUND", (await code(mtg.addMeetingParticipant(mid, "00000000-0000-4000-8000-000000000000", "VIEWER"))) === "404 TARGET_USER_NOT_FOUND");

    // 열람자 초대: 프로젝트 멤버가 아닌 오지현(바깥 열람자), 멤버인 한승우(멤버 열람자)
    const outsider = await mtg.addMeetingParticipant(mid, jihyun, "VIEWER");
    ok("바깥 열람자 초대 → VIEWER/ACTIVE/GRANTED, 이름 포함", outsider.meetingRole === "VIEWER" && outsider.participationStatus === "ACTIVE" && outsider.recordAccessState === "GRANTED" && outsider.displayName === "오지현");
    ok("같은 사람을 다시 초대 → 409 PARTICIPANT_ALREADY_EXISTS", (await code(mtg.addMeetingParticipant(mid, jihyun, "VIEWER"))) === "409 PARTICIPANT_ALREADY_EXISTS");
    await mtg.addMeetingParticipant(mid, seungwoo, "VIEWER");
    const list = (await mtg.listMeetingParticipants(mid, { limit: 100 })).items;
    ok("참가자 목록에서 열람자의 meetingRole이 VIEWER", list.find(p => p.userId === jihyun)?.meetingRole === "VIEWER" && list.find(p => p.userId === gyuchan)?.meetingRole === "PARTICIPANT");

    // 주최자가 아니면 초대 불가
    await loginAs("gyuchan@anok.io");
    ok("주최자가 아닌 참석자 초대 → 403 MEETING_ORGANIZER_REQUIRED", (await code(mtg.addMeetingParticipant(mid, insung, "VIEWER"))) === "403 MEETING_ORGANIZER_REQUIRED");

    // ── 승인 전: 바깥 열람자는 초안 회의록을 못 본다 ──
    await loginAs("jihyun@anok.io");
    ok("열람자의 회의 목록에 그 회의가 나타난다", (await mtg.listMeetings()).items.some(x => x.meetingId === mid));
    ok("회의 상세 200", (await code(mtg.getMeeting(mid))) === "OK");
    ok("승인 전 회의록 → 404 MEETING_MINUTES_NOT_FOUND", (await code(mtg.getMeetingMinutes(mid))) === "404 MEETING_MINUTES_NOT_FOUND");
    ok("최종 보고서가 없으면 data:null(오류 아님)", (await mtg.getMeetingCustomReport(mid)) === null);

    // 검토 담당자가 승인 → 최종 보고서 만들기
    await loginAs("wonjae@anok.io");
    const draft = await mtg.getMeetingMinutes(mid);
    await mtg.approveMeetingMinutes(mid, draft.version);
    const rep = await mtg.requestMeetingCustomReport(mid, { hasTemplate: false, meetingDate: "2026-10-20", includeFollowUpActions: true, includeNextSteps: false });
    ok("승인 뒤 기본 보고서 완료", rep?.status === "SUCCEEDED");

    // ── 승인 후: 바깥 열람자 ──
    await loginAs("jihyun@anok.io");
    const mn = (await mtg.getMeetingMinutes(mid)) as unknown as Record<string, unknown>;
    ok("승인된 회의록은 5개 필드만", mn.status === "APPROVED" && Object.keys(mn).sort().join(",") === "approvedAt,content,meetingId,minutesId,status");
    const fr = await mtg.getMeetingCustomReport(mid);
    ok("최종 보고서를 읽는다", fr?.status === "SUCCEEDED" && (fr.fields?.length ?? 0) > 0);
    ok("후보 → 403 MEETING_VIEWER_READ_ONLY", (await code(mtg.listMeetingCandidates(mid))) === "403 MEETING_VIEWER_READ_ONLY");
    ok("AI 분석 → 403 MEETING_VIEWER_READ_ONLY", (await code(mtg.getMeetingSemanticResult(mid))) === "403 MEETING_VIEWER_READ_ONLY");
    ok("후처리 상태 → 403 MEETING_VIEWER_READ_ONLY", (await code(mtg.getMeetingPostprocess(mid))) === "403 MEETING_VIEWER_READ_ONLY");
    ok("보고서 만들기 → 403 REVIEW_OWNER_REQUIRED", (await code(mtg.requestMeetingCustomReport(mid, { hasTemplate: false, meetingDate: "2026-10-20" }))) === "403 REVIEW_OWNER_REQUIRED");
    ok("전사문 → 403", (await code(mtg.getMeetingTranscript(mid))) === "403 TRANSCRIPT_FORBIDDEN");
    ok("녹음 확인 → 403 RECORDING_DOWNLOAD_FORBIDDEN", (await code(mtg.getRecordingAvailability(mid))) === "403 RECORDING_DOWNLOAD_FORBIDDEN");
    ok("녹음 받기 → 403 RECORDING_DOWNLOAD_FORBIDDEN", (await code(mtg.downloadRecording(mid))) === "403 RECORDING_DOWNLOAD_FORBIDDEN");
    ok("열람자는 다른 사람을 초대 못 한다", (await code(mtg.addMeetingParticipant(mid, insung, "VIEWER"))) === "403 MEETING_ORGANIZER_REQUIRED");

    // 프로젝트 멤버인 열람자는 녹음을 받을 수 없다(열람 전용 참여자 규칙): 멤버 열람자도 참여자가 아니므로 서버 규칙을 따른다 — 여기서는 바깥 열람자와 다르게 후보 API가 막히지 않는 것만 본다.
    await loginAs("seungwoo@anok.io");
    ok("멤버인 열람자: 회의 상세 200, 후처리 상태 200(바깥 열람자와 다르다)", (await code(mtg.getMeeting(mid))) === "OK" && (await code(mtg.getMeetingPostprocess(mid))) === "OK");

    // ── 녹음 합본: 참석자는 받는다 ──
    await loginAs("gyuchan@anok.io");
    const av = await mtg.getRecordingAvailability(mid);
    ok("참석자: availability READY, 형식만 알려 준다", av.state === "READY" && av.mediaType === "audio/mpeg" && av.fileExtension === "mp3" && Object.keys(av).sort().join(",") === "fileExtension,mediaType,state");
    const dl = await mtg.downloadRecording(mid);
    ok("받은 파일: audio/mpeg, 이름은 '<제목>_녹음.mp3', 내용 있음", dl.blob.size > 0 && dl.filename === "AI 파이프라인 설계 리뷰_녹음.mp3" && dl.blob.type.startsWith("audio/"), `${dl.filename} ${dl.blob.type} ${dl.blob.size}`);

    // ── 회수 ──
    await loginAs("wonjae@anok.io");
    ok("종료 후 실제 참석자 제거 → 409 MEETING_STATE_NOT_MUTABLE", (await code(mtg.removeMeetingParticipant(mid, gyuchan))) === "409 MEETING_STATE_NOT_MUTABLE");
    ok("주최자 제거 → 409 ORGANIZER_REMOVE_FORBIDDEN", (await code(mtg.removeMeetingParticipant(mid, meeting.organizerUserId))) === "409 ORGANIZER_REMOVE_FORBIDDEN");
    ok("열람자 회수 → 204", (await code(mtg.removeMeetingParticipant(mid, jihyun))) === "OK");
    ok("이미 회수된 사람 → 409 PARTICIPANT_ALREADY_REMOVED", (await code(mtg.removeMeetingParticipant(mid, jihyun))) === "409 PARTICIPANT_ALREADY_REMOVED");
    const after = (await mtg.listMeetingParticipants(mid, { limit: 100 })).items.find(p => p.userId === jihyun)!;
    ok("회수된 행: REMOVED/REVOKED, version 증가", after.participationStatus === "REMOVED" && after.recordAccessState === "REVOKED" && after.version === 2);

    await loginAs("jihyun@anok.io");
    ok("회수 직후 회의 상세 403", (await code(mtg.getMeeting(mid))).startsWith("403"));
    ok("회수 직후 회의록 403", (await code(mtg.getMeetingMinutes(mid))).startsWith("403"));
    ok("회수 직후 보고서 403", (await code(mtg.getMeetingCustomReport(mid))).startsWith("403"));
    ok("회수 직후 목록에서 사라진다", !(await mtg.listMeetings()).items.some(x => x.meetingId === mid));

    // ── 재초대: 같은 행이 다시 활성화된다 ──
    await loginAs("wonjae@anok.io");
    const again = await mtg.addMeetingParticipant(mid, jihyun, "VIEWER");
    ok("재초대 → 같은 participantId, ACTIVE/GRANTED, version 3", again.participantId === outsider.participantId && again.participationStatus === "ACTIVE" && again.recordAccessState === "GRANTED" && again.version === 3);
    await loginAs("jihyun@anok.io");
    ok("재초대 뒤 회의록·보고서가 다시 열린다", (await code(mtg.getMeetingMinutes(mid))) === "OK" && (await mtg.getMeetingCustomReport(mid)) !== null);

    // ── 회의를 만들 때 열람자 지정 ──
    await loginAs("wonjae@anok.io");
    const projectId = meeting.projectId;
    const created = await mtg.createMeeting({ projectId, title: "열람자가 처음부터 있는 회의", participantUserIds: [gyuchan], viewerUserIds: [jihyun] });
    const cp = (await mtg.listMeetingParticipants(created.meetingId, { limit: 100 })).items;
    ok("생성 시 viewerUserIds → 그 사람은 VIEWER, 나머지는 PARTICIPANT", cp.find(p => p.userId === jihyun)?.meetingRole === "VIEWER" && cp.find(p => p.userId === gyuchan)?.meetingRole === "PARTICIPANT");
    ok("viewerUserIds 중복 → DUPLICATE", (await fail(mtg.createMeeting({ projectId, title: "중복", viewerUserIds: [jihyun, jihyun] })))?.fieldErrors?.[0]?.reason === "DUPLICATE");

    // 예정 회의에서도 열람자를 뺄 수 있다(시작 전 DELETE)
    ok("예정 회의에서 열람자 제거 → 204", (await code(mtg.removeMeetingParticipant(created.meetingId, jihyun))) === "OK");
    // 진행 중에는 열람자를 추가할 수 없다
    await mtg.startMeeting(created.meetingId, { version: (await mtg.getMeeting(created.meetingId)).version });
    ok("진행 중인 회의에 열람자 추가 → 409 MEETING_NOT_SCHEDULED", (await code(mtg.addMeetingParticipant(created.meetingId, insung, "VIEWER"))) === "409 MEETING_NOT_SCHEDULED");

    expect(failures, summary()).toEqual([]);
  });
});
