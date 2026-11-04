// 회의 음성 원문(STT 전사문) — 음성 인식이 글로 옮긴 그대로. 회의록(AI 요약)과 달리 고치거나 줄이지 않은 문장이다.
// 서버는 원본 녹음을 받을 수 있는 사람만 읽게 하고(참여자·프로젝트 MANAGER), 기능이 꺼져 있으면 404다 → 그런 경우 카드를 보이지 않는다.
// 화자는 확정하지 않는다: 트랙(마이크) 단위로 묶어 보여 주고, 트랙을 올린 사람은 "마이크 주인"으로만 표시한다.
import { useEffect, useState } from "react";
import * as api from "../api/meeting";
import type { MeetingTranscriptResponse } from "../api/meeting";
import { ApiError } from "../api/errors";
import { Card, ghostBtn, Section, Spinner } from "../ui/kit";
import { copyText, safeFileName, saveText } from "./download";
import { fmtMs, groupByTrack, transcriptErrorState, transcriptText, trackTitle } from "./transcriptView";
import type { TranscriptState } from "./transcriptView";

const COLLAPSED_CHARS = 900;

export default function TranscriptPanel({ meetingId, meetingTitle, ready, nameOf }: {
  meetingId: string; meetingTitle: string;
  /** 음성 인식이 끝났는가(후처리 상태). 그 전에는 요청하지 않는다. */
  ready: boolean;
  nameOf: (id?: string | null) => string;
}) {
  const [data, setData] = useState<MeetingTranscriptResponse | null>(null);
  const [state, setState] = useState<TranscriptState>({ kind: "loading" });
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);

  async function load() {
    setState({ kind: "loading" });
    try { setData(await api.getMeetingTranscript(meetingId)); setState({ kind: "ready" }); }
    catch (e) { setState(transcriptErrorState(e instanceof ApiError ? { status: e.status, errorCode: e.errorCode } : { status: 0, errorCode: "NETWORK_ERROR" })); }
  }
  // 회의가 바뀌거나 음성 인식이 끝나는 순간 한 번 읽는다(폴링하지 않는다).
  useEffect(() => { setData(null); if (ready) void load(); else setState({ kind: "hidden" }); }, [meetingId, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state.kind === "hidden") return null;
  const groups = data ? groupByTrack(data.segments) : [];
  const full = data ? transcriptText(groups, nameOf) : "";
  const long = full.length > COLLAPSED_CHARS;

  return (
    <Card className="p-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Section>음성 원문 (STT)</Section>
        {state.kind === "ready" && data && data.segments.length > 0 && (
          <div className="flex items-center gap-3">
            <button onClick={async () => { setCopied((await copyText(full)) ? "ok" : "fail"); setTimeout(() => setCopied(null), 2000); }}
              className="text-[11px] font-semibold text-indigo-500 hover:text-indigo-700">{copied === "ok" ? "복사했습니다" : copied === "fail" ? "복사하지 못했습니다" : "복사"}</button>
            <button onClick={() => saveText(full, `${safeFileName(meetingTitle, "회의")} 음성 원문.txt`)} className="text-[11px] font-semibold text-indigo-500 hover:text-indigo-700">.txt로 내려받기</button>
          </div>
        )}
      </div>
      <p className="text-[11px] text-slate-400 leading-relaxed">음성 인식이 들린 그대로 글로 옮긴 문장입니다. 고치거나 요약하지 않아서 <b>오인식이 있을 수 있습니다</b>. 누가 말했는지는 가려내지 않고, 음성 트랙(마이크) 단위로 묶어 보여 줍니다. 한 기기를 여럿이 쓰면 한 트랙에 섞여 있습니다.</p>

      {state.kind === "loading" && <Spinner text="음성 원문을 불러오는 중..." />}
      {state.kind === "notice" && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-[12px] text-slate-500">{state.text}</p>
          {state.retry && <button onClick={() => void load()} className={ghostBtn}>다시 시도</button>}
        </div>
      )}
      {state.kind === "ready" && data && (data.segments.length === 0
        ? <p className="text-[12px] text-slate-400">인식된 말이 없습니다.</p>
        : (
          <div className="space-y-3">
            <div className={!open && long ? "max-h-56 overflow-hidden relative" : ""}>
              <div className="space-y-4">
                {groups.map(g => (
                  <div key={g.key}>
                    <p className="text-[11px] font-bold text-slate-500 mb-1">{trackTitle(g, nameOf)}</p>
                    <div className="space-y-1.5">
                      {g.segments.map(s => (
                        <p key={s.sequence} className="text-[13px] text-slate-700 leading-relaxed whitespace-pre-wrap break-words">
                          {s.startMs != null && <span className="mr-2 text-[11px] tabular-nums text-slate-400">{fmtMs(s.startMs)}</span>}{s.text}
                        </p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {!open && long && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-white" />}
            </div>
            {long && <button onClick={() => setOpen(o => !o)} className="text-[11px] font-semibold text-indigo-500 hover:text-indigo-700">{open ? "접기" : "전체 보기"}</button>}
          </div>
        ))}
    </Card>
  );
}
