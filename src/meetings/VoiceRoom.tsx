// 음성 회의방 — 접속 토큰(POST /livekit-token)으로 브라우저가 LiveKit에 직접 접속한다(VITE_LIVEKIT_URL).
// 서버가 발급하는 토큰은 오디오 발행·구독만 허용하므로 카메라·화면 공유는 제공하지 않는다. 토큰 수명은 5분이라 방에 들어가는 순간에만 쓰고,
// 끊겼다 다시 접속할 때는 새 토큰을 받는다(onRejoin). mock 모드(VITE_API_BASE_URL 없음)는 토큰이 가짜라 LiveKit에 접속하지 않고 로컬 음량 감지만 한다.
import { useEffect, useRef, useState } from "react";
import { ConnectionState, Room, RoomEvent, Track } from "livekit-client";
import { USE_MOCK } from "../api/config";
import type { MeetingParticipantResponse, MeetingResponse } from "../api/meeting";
import { Avatar } from "../ui/kit";
import ChatView from "./ChatView";
import type { MeetingChat } from "./useMeetingChat";

const LIVEKIT_URL = (import.meta.env.VITE_LIVEKIT_URL as string | undefined) ?? "";
const PARTICIPANT_IDENTITY_PREFIX = "anok-user:"; // meeting-service의 participantIdentity 규칙(`anok-user:<userId>`)
const userIdOf = (identity: string) => identity.startsWith(PARTICIPANT_IDENTITY_PREFIX) ? identity.slice(PARTICIPANT_IDENTITY_PREFIX.length) : identity;

function MicIcon({ on }: { on: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="11" rx="3" /><path d="M5 10a7 7 0 0 0 14 0" /><line x1="12" y1="19" x2="12" y2="22" />
      {!on && <line x1="3" y1="3" x2="21" y2="21" />}
    </svg>
  );
}
function CamIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 8l-6 4 6 4V8z" /><rect x="2" y="6" width="14" height="12" rx="2" /><line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function micErrorText(e: unknown) {
  const name = e instanceof DOMException ? e.name : "";
  return name === "NotAllowedError" ? "마이크 권한이 거부되었습니다." : name === "NotFoundError" ? "사용 가능한 마이크 장치가 없습니다." : "마이크에 연결할 수 없습니다.";
}

// mock 모드: 마이크가 켜져 있는 동안 실제 오디오 트랙을 붙잡아 볼륨(RMS)으로 발화 여부만 로컬 판정한다. 전송·녹음은 하지 않는다.
function useMicLevel(active: boolean, onError: (msg: string) => void) {
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    if (!active) { setSpeaking(false); return; }
    let alive = true;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let raf = 0;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!alive) { stream.getTracks().forEach(t => t.stop()); return; }
        ctx = new AudioContext();
        if (ctx.state === "suspended") await ctx.resume();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser); // destination엔 연결하지 않음 — 스피커로 되먹임되지 않게
        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          if (!alive) return;
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
          setSpeaking(Math.sqrt(sum / data.length) > 0.05);
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch (e) {
        if (alive) onError(micErrorText(e));
      }
    })();
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach(t => t.stop());
      if (ctx && ctx.state !== "closed") ctx.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  return speaking;
}

export default function VoiceRoom({ m, token, myUserId, participants, nameOf, chat, onLeave, onRejoin, onOpenDoc, onUploadDoc }: {
  m: MeetingResponse; token: string; myUserId?: string; participants: MeetingParticipantResponse[];
  nameOf: (id?: string | null) => string; chat: MeetingChat; onLeave: () => void;
  /** 채팅에 공유된 문서를 연다(미리보기 창은 상위 화면이 회의방 위에 띄운다). */
  onOpenDoc: (documentId: string) => void;
  /** 문서 업로드 창을 연다. 업로드가 끝나면 상위가 채팅에 문서 링크를 올린다. */
  onUploadDoc: () => void;
  /** 새 접속 토큰을 받아 token을 바꾼다. 실패하면 사유 문구를 돌려준다. */
  onRejoin: () => Promise<string | null>;
}) {
  const [micOn, setMicOn] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [conn, setConn] = useState<"connecting" | "connected" | "failed">(USE_MOCK ? "connected" : "connecting");
  const [connError, setConnError] = useState<string | null>(null);
  const [rejoining, setRejoining] = useState(false);
  const [speakingIds, setSpeakingIds] = useState<Set<string>>(new Set());
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());
  const roomRef = useRef<Room | null>(null);
  const audioHost = useRef<HTMLDivElement>(null);
  const localSpeaking = useMicLevel(USE_MOCK && micOn, msgText => { setMicError(msgText); setMicOn(false); });
  const tiles = participants.filter(p => p.participationStatus === "ACTIVE");

  useEffect(() => {
    if (USE_MOCK) return;
    if (!LIVEKIT_URL) { setConn("failed"); setConnError("VITE_LIVEKIT_URL이 설정되지 않았습니다."); return; }
    setConn("connecting"); setConnError(null);
    // 음성 분리(voiceIsolation)는 LiveKit 기본값이 true라 켜져 있었다. 녹음에 잡음이 끼는 원인 후보라 끄고 비교한다(나머지 처리는 유지).
    const room = new Room({
      adaptiveStream: false,
      dynacast: false,
      audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, voiceIsolation: false },
    });
    roomRef.current = room;
    let alive = true;
    const syncOnline = () => setOnlineIds(new Set([room.localParticipant.identity, ...Array.from(room.remoteParticipants.values(), p => p.identity)].map(userIdOf)));
    room
      .on(RoomEvent.ParticipantConnected, syncOnline)
      .on(RoomEvent.ParticipantDisconnected, syncOnline)
      .on(RoomEvent.ActiveSpeakersChanged, speakers => setSpeakingIds(new Set(speakers.map(p => userIdOf(p.identity)))))
      .on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
        if (track.kind !== Track.Kind.Audio) return;
        const el = track.attach();
        el.dataset.identity = participant.identity;
        audioHost.current?.appendChild(el);
      })
      .on(RoomEvent.TrackUnsubscribed, track => { track.detach().forEach(el => el.remove()); })
      .on(RoomEvent.Disconnected, () => {
        if (!alive) return;
        setConn("failed"); setConnError("회의 연결이 끊어졌습니다. 다시 연결할 수 있습니다."); setMicOn(false);
      });
    (async () => {
      try {
        await room.connect(LIVEKIT_URL, token);
        if (!alive) { room.disconnect(); return; }
        syncOnline();
        setConn("connected");
        await room.startAudio(); // 브라우저 자동재생 정책: 사용자 클릭(회의 참가) 직후라 허용된다
      } catch {
        if (!alive) return;
        setConn("failed"); setConnError("회의 서버에 연결할 수 없습니다. 다시 연결해 보세요.");
      }
    })();
    return () => { alive = false; room.removeAllListeners(); room.disconnect(); roomRef.current = null; };
  }, [token]);

  async function toggleMic() {
    setMicError(null);
    const next = !micOn;
    if (USE_MOCK) { setMicOn(next); return; }
    const room = roomRef.current;
    if (!room || room.state !== ConnectionState.Connected) return;
    try { await room.localParticipant.setMicrophoneEnabled(next); setMicOn(next); }
    catch (e) { setMicError(micErrorText(e)); setMicOn(false); }
  }

  async function rejoin() {
    setRejoining(true);
    const err = await onRejoin();
    setRejoining(false);
    if (err) { setConn("failed"); setConnError(err); }
  }

  return (
    <div className="fixed inset-0 z-[300] bg-slate-900 flex flex-col">
      <div className="shrink-0 flex items-center justify-between px-5 py-3">
        <div>
          <p className="text-[13px] font-bold text-white">{m.title}</p>
          <p className={`text-[11px] ${conn === "failed" ? "text-rose-400" : "text-slate-400"}`}>
            {USE_MOCK ? "mock 모드 — 마이크 음량만 로컬에서 감지합니다(다른 참가자에게 전송되지 않음)"
              : conn === "connecting" ? "회의 서버에 연결 중..."
              : conn === "failed" ? connError
              : "음성 전용 회의 · 연결됨"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {conn === "failed" && !USE_MOCK && <button disabled={rejoining} onClick={rejoin} className="text-[12px] text-indigo-300 hover:text-white font-semibold disabled:opacity-50">{rejoining ? "연결 중..." : "다시 연결"}</button>}
          <button onClick={onLeave} className="text-[12px] text-slate-300 hover:text-white font-semibold">닫기</button>
        </div>
      </div>
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-y-auto px-5 pb-3">
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>
            {tiles.map(p => {
              const isMe = p.userId === myUserId;
              const isSpeaking = USE_MOCK ? isMe && micOn && localSpeaking : speakingIds.has(p.userId);
              const online = USE_MOCK ? isMe : onlineIds.has(p.userId);
              return (
                <div key={p.participantId} className={`aspect-video bg-slate-800 rounded-2xl flex flex-col items-center justify-center gap-2 relative transition-all ${isSpeaking ? "ring-4 ring-emerald-400" : ""} ${online ? "" : "opacity-50"}`}>
                  <Avatar name={nameOf(p.userId)} seed={p.userId} size={56} />
                  <p className="text-[12px] text-slate-200 font-semibold">{nameOf(p.userId)}{isMe && " (나)"}</p>
                  {!online && <span className="absolute top-2 right-2 text-[10px] text-slate-400">미접속</span>}
                  {isMe && !micOn && (
                    <span className="absolute bottom-2 left-2 w-6 h-6 rounded-full bg-rose-500/90 flex items-center justify-center text-white"><MicIcon on={false} /></span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <ChatView m={m} chat={chat} myUserId={myUserId} nameOf={nameOf} variant="panel" onOpenDoc={onOpenDoc}
          header={
            <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <p className="text-[13px] font-bold text-slate-800">채팅</p>
              {m.status === "IN_PROGRESS" && <button onClick={onUploadDoc} className="text-[11px] text-indigo-500 font-semibold hover:text-indigo-700">문서 업로드</button>}
            </div>
          } />
      </div>
      <div className="shrink-0 flex flex-col items-center gap-1.5 py-4">
        <div className="flex items-center justify-center gap-3">
          <button disabled={conn !== "connected"} onClick={toggleMic} aria-label={micOn ? "마이크 끄기" : "마이크 켜기"} className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors disabled:opacity-40 ${micOn ? "bg-slate-700 text-white hover:bg-slate-600" : "bg-rose-500 text-white hover:bg-rose-600"}`}><MicIcon on={micOn} /></button>
          <button disabled title="음성 전용 회의입니다" className="w-11 h-11 rounded-full flex items-center justify-center bg-slate-700 text-slate-400 opacity-40 cursor-not-allowed"><CamIcon /></button>
          <button onClick={onLeave} className="px-5 h-11 rounded-full bg-rose-600 hover:bg-rose-700 text-white text-[13px] font-bold">나가기</button>
        </div>
        {micError && <p className="text-[11px] text-rose-400 font-medium">{micError}</p>}
      </div>
      <div ref={audioHost} className="hidden" />
      <p className="text-center text-[10px] text-slate-500 pb-3">음성 전용 회의입니다. 카메라는 사용할 수 없습니다. 녹음이 하나도 없으면 회의록을 만들 수 없으니 발언할 때는 마이크를 켜 주세요.</p>
    </div>
  );
}
