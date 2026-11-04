// 회의 상세: 개요 / 참가자 / 채팅 / 자료 / 회의록·후보. 탭별 구현은 같은 폴더의 파일들이고, 이 화면은 그 위의 공통 상태를 쥔다.
//   · 회의 상세를 5초마다 다시 읽는다(예정·진행 중). 시작·종료·권한 변경은 알림이 없어서 참가자 화면은 폴링으로 알아챈다(14-1 #9).
//   · 채팅은 SSE 스트림 하나를 이 화면이 쥐고 채팅 탭과 회의방 오버레이가 같이 쓴다(같은 사용자는 회의당 동시 2개까지).
//   · 버튼은 회의 상태·내 역할(주최자·검토 담당자·참가자·프로젝트 역할)로 미리 켜고 끈다(FRONTEND_00 6절).
import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "../api/meeting";
import type { MeetingResponse } from "../api/meeting";
import * as prj from "../api/project";
import { ApiError, errorText } from "../api/errors";
import { useAuth } from "../auth/AuthProvider";
import { Button, ErrorBox, Spinner, Tabs, useLoad } from "../ui/kit";
import { ArrowLeftIcon } from "../ui/icons";
import { useOrgUsers } from "../projects/shared";
import { MeetingStatusBadge, SensitivityBadge } from "./shared";
import type { MeetingCtx } from "./meetingContext";
import { useMeetingChat } from "./useMeetingChat";
import { usePoll } from "./usePoll";
import ChatView from "./ChatView";
import OverviewTab from "./OverviewTab";
import ParticipantsTab from "./ParticipantsTab";
import AttachmentsTab, { UploadAttachmentModal } from "./AttachmentsTab";
import DocumentPeekModal from "./DocumentPeekModal";
import { formatDocShare } from "./docShare";
import type { MeetingAttachmentResponse } from "../api/document";
import MinutesTab from "./MinutesTab";
import ViewerMinutesTab from "./ViewerMinutesTab";
import { isOutsideViewer, myMeetingRole } from "./viewerAccess";
import VoiceRoom from "./VoiceRoom";

type Tab = "개요" | "참가자" | "채팅" | "자료" | "회의록·후보";
const TABS: Tab[] = ["개요", "참가자", "채팅", "자료", "회의록·후보"];
// 프로젝트 멤버가 아닌 열람자는 승인된 회의록·최종 보고서만 본다 — 참가자·채팅·자료 탭은 서버가 403이라 그리지 않는다(FRONTEND_06).
const OUTSIDE_VIEWER_TABS: Tab[] = ["개요", "회의록·후보"];
const LOST_ACCESS_CODES = new Set(["MEETING_ACCESS_DENIED", "MEETING_RECORD_ACCESS_REVOKED", "MEETING_NOT_FOUND"]);

function MeetingBody({ meeting: m, setMeeting, navigate }: { meeting: MeetingResponse; setMeeting: React.Dispatch<React.SetStateAction<MeetingResponse | null>>; navigate: (s: any, ctx?: any) => void }) {
  const { me } = useAuth();
  const { nameOf, users } = useOrgUsers();
  const [tab, setTab] = useState<Tab>("개요");
  const [lostAccess, setLostAccess] = useState<string | null>(null);
  const partsLoad = useLoad(() => api.listMeetingParticipants(m.meetingId, { limit: 100 }).catch(() => null), [m.meetingId]);
  const projectLoad = useLoad(() => prj.getProject(m.projectId).catch(() => null), [m.projectId]);

  // ── 회의 상세 갱신 ──
  const refreshMeeting = useCallback(async () => {
    try {
      const next = await api.getMeeting(m.meetingId);
      // 바뀐 게 없으면 같은 객체를 유지해 화면(편집 중인 입력 등)을 불필요하게 다시 그리지 않는다.
      setMeeting(prev => (prev && prev.version === next.version && prev.status === next.status && prev.postprocessStatus === next.postprocessStatus
        && prev.myParticipationStatus === next.myParticipationStatus && prev.myRecordAccessState === next.myRecordAccessState && prev.reviewOwnerUserId === next.reviewOwnerUserId ? prev : next));
      return next;
    } catch (e) {
      if (e instanceof ApiError && LOST_ACCESS_CODES.has(e.errorCode)) setLostAccess(errorText(e));
      return null;
    }
  }, [m.meetingId, setMeeting]);
  usePoll(refreshMeeting, 5000, (m.status === "SCHEDULED" || m.status === "IN_PROGRESS") && !lostAccess, [m.meetingId]);

  const isOrganizer = m.organizerUserId === me?.userId;
  const isReviewOwner = m.reviewOwnerUserId === me?.userId;
  const hasAccess = m.myParticipationStatus === "ACTIVE" && m.myRecordAccessState === "GRANTED";
  // 회의 상세에는 내 역할이 없어서 참가자 목록의 내 행으로 알아낸다. 프로젝트 멤버인지도 응답에 없어서 프로젝트 조회가 되는지로 판단한다.
  const myRole = myMeetingRole(partsLoad.data?.items ?? [], me?.userId);
  const isViewer = myRole === "VIEWER";
  const outsideViewer = isOutsideViewer(myRole, !projectLoad.loading, !!projectLoad.data);
  const tabs = outsideViewer ? OUTSIDE_VIEWER_TABS : TABS;
  const shownTab: Tab = tabs.includes(tab) ? tab : "개요";

  // ── 채팅 ──
  const chat = useMeetingChat(m, () => { void refreshMeeting(); partsLoad.reload(); });

  // ── 채팅에서 문서 공유 ──
  // 업로드가 끝나면 채팅에 문서 링크 메시지를 올리고, 링크를 누르면 회의방(음성)을 떠나지 않고 미리보기 창이 뜬다.
  const [uploadOpen, setUploadOpen] = useState(false);
  const [peekDocId, setPeekDocId] = useState<string | null>(null);
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  async function shareUploaded(a: MeetingAttachmentResponse) {
    setUploadOpen(false); setShareNotice(null);
    // 문서는 이미 회의 자료로 올라갔다. 채팅 알림만 실패해도(속도 제한 등) 자료 탭에서 볼 수 있으니 안내만 한다.
    if (!(await chat.send(formatDocShare(a.title, a.documentId)))) setShareNotice("문서는 올라갔지만 채팅에 링크를 남기지 못했습니다. '자료' 탭에서 확인할 수 있습니다.");
  }
  const canShareDoc = m.status === "IN_PROGRESS" && hasAccess && !isViewer;

  // ── 음성 회의방 ──
  const [roomToken, setRoomToken] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const joinPassword = useRef<string | undefined>(undefined); // 재접속용으로 메모리에만 쥔다(저장·로그 금지)
  // 회의가 끝나거나 내 참여·기록 접근권이 사라지면 방에서 나온다.
  useEffect(() => { if (m.status !== "IN_PROGRESS" || !hasAccess) { setRoomToken(null); joinPassword.current = undefined; } }, [m.status, hasAccess]);

  async function joinRoom(password?: string) {
    setJoining(true); setJoinError(null);
    try {
      const r = await api.issueLiveKitToken(m.meetingId, password);
      joinPassword.current = password;
      setRoomToken(r.token);
    } catch (e) {
      // 401 MEETING_PASSWORD_INVALID는 로그아웃이 아니다 — 비밀번호만 다시 입력한다.
      setJoinError(errorText(e));
      if (e instanceof ApiError && ["MEETING_NOT_IN_PROGRESS", "MEETING_END_PREPARING", "MEETING_RECORD_ACCESS_REVOKED", "MEETING_JOIN_DENIED"].includes(e.errorCode)) void refreshMeeting();
    } finally { setJoining(false); }
  }
  async function rejoin(): Promise<string | null> {
    try { setRoomToken((await api.issueLiveKitToken(m.meetingId, joinPassword.current)).token); return null; }
    catch (e) { return errorText(e); }
  }

  const ctx: MeetingCtx = {
    m, myUserId: me?.userId, isOrganizer, isReviewOwner, hasAccess,
    projectRole: projectLoad.data?.myRole ?? null, isViewer, isOutsideViewer: outsideViewer,
    orgUsers: users.map(u => ({ userId: u.userId, displayName: u.displayName })),
    nameOf, isKnownUser: id => !!id && users.some(u => u.userId === id),
    participants: partsLoad.data?.items ?? [], reloadParticipants: partsLoad.reload,
    setMeeting: next => setMeeting(next), refreshMeeting, navigate,
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-white">
      <div className="shrink-0 bg-white px-8 pt-5">
        <button onClick={() => navigate("meetings")} className="inline-flex items-center gap-1.5 text-[12px] font-medium text-slate-400 hover:text-slate-700 mb-2 rounded focus-visible:outline-2 focus-visible:outline-indigo-500"><ArrowLeftIcon size={13} />회의</button>
        <div className="flex items-center gap-3 mb-3">
          <h2 className="text-[20px] font-extrabold text-slate-900 tracking-tight break-words min-w-0">{m.title}</h2>
          <MeetingStatusBadge status={m.status} />
          <SensitivityBadge level={m.sensitivityClassification} />
        </div>
        {lostAccess && (
          <div className="mb-3 flex items-center justify-between gap-3 bg-rose-50 border border-rose-100 rounded-xl px-4 py-2.5">
            <p className="text-[12px] text-rose-600 font-medium">{lostAccess}</p>
            <Button size="sm" variant="secondary" onClick={() => navigate("meetings")}>목록으로</Button>
          </div>
        )}
        <Tabs<Tab> label="회의 메뉴" value={shownTab} onChange={setTab} items={tabs.map(t => ({ value: t, label: t }))} />
      </div>
      <div className="flex-1 overflow-y-auto px-8 py-6 bg-slate-50/40">
        {shownTab === "개요" && <OverviewTab ctx={ctx} joinRoom={joinRoom} joining={joining} joinError={joinError} roomOpen={!!roomToken} />}
        {shownTab === "참가자" && <ParticipantsTab ctx={ctx} />}
        {shownTab === "채팅" && (
          <div className="max-w-2xl h-full flex flex-col">
            {canShareDoc && (
              <div className="shrink-0 flex items-center justify-between pb-2">
                <p className="text-[11px] text-slate-400">문서를 올리면 채팅에 링크가 올라가 모두가 바로 열 수 있습니다.</p>
                <button onClick={() => setUploadOpen(true)} className="text-[11px] text-indigo-500 font-semibold hover:text-indigo-700">+ 문서 업로드</button>
              </div>
            )}
            {shareNotice && <p className="shrink-0 text-[11px] text-amber-600 pb-2">{shareNotice}</p>}
            <ChatView m={m} chat={chat} myUserId={me?.userId} nameOf={nameOf} variant="tab" onOpenDoc={setPeekDocId} />
          </div>
        )}
        {shownTab === "자료" && <AttachmentsTab ctx={ctx} />}
        {shownTab === "회의록·후보" && (outsideViewer ? <ViewerMinutesTab ctx={ctx} /> : <MinutesTab ctx={ctx} />)}
      </div>
      {roomToken && <VoiceRoom m={m} token={roomToken} myUserId={me?.userId} participants={ctx.participants} nameOf={nameOf} chat={chat}
        onLeave={() => { setRoomToken(null); joinPassword.current = undefined; }} onRejoin={rejoin}
        onOpenDoc={setPeekDocId} onUploadDoc={() => setUploadOpen(true)} />}
      {/* 업로드 창과 미리보기 창은 회의방(z-300) 위에 떠야 하므로 회의방보다 나중에, 더 높은 층으로 그린다. */}
      {uploadOpen && <div className="relative z-[350]"><UploadAttachmentModal meetingId={m.meetingId} onClose={() => setUploadOpen(false)} onUploaded={shareUploaded} /></div>}
      {peekDocId && <DocumentPeekModal documentId={peekDocId} onClose={() => setPeekDocId(null)}
        onOpenDetail={roomToken ? undefined : id => { setPeekDocId(null); navigate("document-detail", { docId: id, fromMeetingId: m.meetingId }); }} />}
    </div>
  );
}

export default function MeetingDetailScreen({ meetingId, navigate }: { meetingId: string; navigate: (s: any, ctx?: any) => void }) {
  const { data: meeting, setData: setMeeting, loading, error, reload } = useLoad(() => api.getMeeting(meetingId), [meetingId]);
  if (loading && !meeting) return <Spinner text="회의 정보를 불러오는 중..." />;
  if (error && !meeting) return <ErrorBox message={error} onRetry={reload} />;
  if (!meeting) return null;
  return <MeetingBody key={meetingId} meeting={meeting} setMeeting={setMeeting} navigate={navigate} />;
}
