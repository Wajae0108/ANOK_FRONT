// 원본 녹음 합본(MP3) 받기 — FRONTEND_03. 종료된 회의에서 사람별 녹음을 회의 시간에 맞춰 하나로 합친 MP3를 내려받는다.
//  · 화면에 들어올 때 availability만 조회한다(가볍다). 파일 받기(download)는 사용자가 버튼을 눌렀을 때만 부른다 — 자동 호출·미리 받기 없음.
//  · 서버가 파일을 다 만든 뒤에야 응답이 시작되므로 누른 뒤 수십 초 걸릴 수 있다 → "처리 중" 표시와 취소 버튼, 중복 클릭 방지.
//  · 화자 수·파일 크기·길이·삭제 시각은 보여 주지 않는다(서버가 일부러 주지 않는 값).
//  · 서버에서 기능이 꺼져 있거나(404 ROUTE_NOT_FOUND) 받을 수 있는 사람이 아니면(403) 카드를 아예 그리지 않는다.
import { useEffect, useRef, useState } from "react";
import * as api from "../api/meeting";
import { ApiError } from "../api/errors";
import { Card, ghostBtn, primaryBtn, Section } from "../ui/kit";
import { saveBlob } from "./download";
import { recordingDownloadError, recordingUiFromAvailability, recordingUiFromError } from "./recordingView";
import type { RecordingUi } from "./recordingView";

type Phase = "idle" | "processing" | "done" | "failed";

export default function RecordingDownload({ meetingId }: { meetingId: string }) {
  const [ui, setUi] = useState<RecordingUi | null>(null); // null = 확인 중(CHECKING)
  const [phase, setPhase] = useState<Phase>("idle");
  const [msg, setMsg] = useState<{ ok: boolean; text: string; retry?: boolean } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const aliveRef = useRef(true);

  async function check() {
    setUi(null);
    try { if (aliveRef.current) setUi(recordingUiFromAvailability(await api.getRecordingAvailability(meetingId))); }
    catch (e) { if (aliveRef.current) setUi(recordingUiFromError(e instanceof ApiError ? e : { status: 0, errorCode: "NETWORK_ERROR" })); }
  }
  useEffect(() => {
    aliveRef.current = true;
    void check();
    return () => { aliveRef.current = false; abortRef.current?.abort(); };
  }, [meetingId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function download() {
    if (phase === "processing") return; // 한 번 누르는 동안 중복 클릭을 막는다
    const ac = new AbortController(); abortRef.current = ac;
    setPhase("processing"); setMsg(null);
    try {
      const r = await api.downloadRecording(meetingId, ac.signal);
      if (ac.signal.aborted) return;
      saveBlob(r.blob, r.filename);
      setPhase("done"); setMsg({ ok: true, text: `'${r.filename}' 파일을 내려받았습니다.` });
    } catch (e) {
      if (ac.signal.aborted) { setPhase("idle"); setMsg({ ok: false, text: "내려받기를 취소했습니다." }); return; }
      const t = recordingDownloadError(e instanceof ApiError ? e : { status: 0, errorCode: "NETWORK_ERROR" });
      setPhase("failed"); setMsg({ ok: false, text: t.text, retry: t.retry });
      // READY였는데 그 사이 상태가 바뀐 경우(삭제 시작 등) — 상태를 다시 읽어 버튼을 맞춘다. 같은 요청을 자동으로 반복하지는 않는다.
      if (e instanceof ApiError && ["RECORDING_UNAVAILABLE", "RECORDING_NOT_READY", "RECORDING_DOWNLOAD_TOO_LARGE"].includes(e.errorCode)) void check();
    } finally { if (abortRef.current === ac) abortRef.current = null; }
  }
  function cancel() { abortRef.current?.abort(); }

  if (ui?.kind === "hidden") return null;
  const processing = phase === "processing";

  return (
    <Card className="p-5 space-y-2">
      <Section>원본 녹음 받기</Section>
      <p className="text-[12px] text-slate-400 leading-relaxed">사람별로 따로 저장된 녹음을 회의 시간에 맞춰 하나로 합친 MP3 파일입니다. 누를 때마다 새로 만들며 서버에 저장되지 않습니다. 음성 글자(회의록·STT)가 아닙니다.</p>
      {ui === null && <p className="text-[12px] text-slate-400">녹음 상태를 확인하는 중...</p>}
      {ui?.kind === "notice" && (
        <div className="flex flex-wrap items-center gap-3">
          <p className={`text-[12px] ${ui.tone === "wait" ? "text-amber-600" : "text-slate-500"}`}>{ui.text}</p>
          {ui.recheck && <button onClick={() => void check()} className="text-[11px] font-semibold text-indigo-500 hover:text-indigo-700">다시 확인</button>}
        </div>
      )}
      {ui?.kind === "ready" && (
        <div className="flex flex-wrap items-center gap-2">
          <button disabled={processing} onClick={() => void download()} className={primaryBtn}>{processing ? "파일 만드는 중..." : phase === "failed" ? "다시 받기" : "녹음 받기 (MP3)"}</button>
          {processing && <button onClick={cancel} className={ghostBtn}>취소</button>}
        </div>
      )}
      {processing && <p className="text-[11px] text-slate-400">긴 회의는 수십 초 걸릴 수 있습니다. 창을 닫지 말고 기다리거나 취소할 수 있습니다.</p>}
      {msg && <p className={`text-[12px] font-medium ${msg.ok ? "text-emerald-600" : "text-rose-500"}`}>{msg.text}</p>}
    </Card>
  );
}
