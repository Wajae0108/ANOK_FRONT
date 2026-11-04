// 프로젝트 멤버가 아닌 "열람자"의 회의록 화면 — FRONTEND_06. 볼 수 있는 것은 승인된 회의록과 최종 보고서뿐이다.
//  · 후보·AI 분석·후처리 상태·전사문·자료·녹음은 서버가 403이므로 아예 부르지 않고 그리지 않는다.
//  · 승인 전 회의록은 404 MEETING_MINUTES_NOT_FOUND → "아직 승인된 회의록이 없습니다". 최종 보고서가 없으면 data:null → "보고서가 아직 준비되지 않았습니다"(오류 아님).
//  · 403은 코드로 문구를 나누지 않고 "접근할 수 없습니다"로 통일한다(회수된 직후 API마다 코드가 다르다).
import { useState } from "react";
import * as api from "../api/meeting";
import type { MeetingMinutesResponse } from "../api/meeting";
import { ApiError, errorText } from "../api/errors";
import { Card, ErrorBox, Section, Spinner, useLoad } from "../ui/kit";
import Markdown from "../ui/Markdown";
import { FieldValue, isDefaultReport, ReportDownload } from "./ReportPanel";
import { copyText, safeFileName, saveText } from "./download";
import { fmtDateTime, kstDateInput } from "./shared";
import { isNoAccess, NO_ACCESS_TEXT } from "./viewerAccess";
import type { MeetingCtx } from "./meetingContext";

type Loaded<T> = { kind: "ok"; value: T } | { kind: "none" } | { kind: "denied" } | { kind: "error"; text: string };

async function load<T>(fn: () => Promise<T | null>): Promise<Loaded<T>> {
  try { const v = await fn(); return v == null ? { kind: "none" } : { kind: "ok", value: v }; }
  catch (e) {
    if (e instanceof ApiError) {
      if (e.errorCode === "MEETING_MINUTES_NOT_FOUND") return { kind: "none" };
      if (isNoAccess(e)) return { kind: "denied" };
    }
    return { kind: "error", text: errorText(e) };
  }
}

export default function ViewerMinutesTab({ ctx }: { ctx: MeetingCtx }) {
  const { m } = ctx;
  const minutes = useLoad(() => load<MeetingMinutesResponse>(() => api.getMeetingMinutes(m.meetingId)), [m.meetingId]);
  const report = useLoad(() => load(() => api.getMeetingCustomReport(m.meetingId)), [m.meetingId]);
  const [copied, setCopied] = useState(false);

  if (minutes.loading && !minutes.data) return <Spinner text="불러오는 중..." />;
  const mn = minutes.data, rp = report.data;
  if (mn?.kind === "denied" || rp?.kind === "denied") {
    return <div className="max-w-2xl"><ErrorBox message={NO_ACCESS_TEXT} onRetry={() => { minutes.reload(); report.reload(); }} /></div>;
  }

  return (
    <div className="max-w-2xl space-y-4">
      <p className="text-[12px] text-slate-500 bg-white border border-slate-100 rounded-xl px-4 py-3 leading-relaxed">
        이 회의의 <b>열람자</b>로 초대되어 <b>승인된 회의록</b>과 <b>최종 보고서</b>만 볼 수 있습니다. 회의 자료와 프로젝트 자료, 원본 녹음은 볼 수 없습니다.
      </p>

      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <Section>회의록</Section>
          {mn?.kind === "ok" && mn.value.content && (
            <div className="flex items-center gap-3">
              <button onClick={async () => { setCopied(await copyText(mn.value.content ?? "")); setTimeout(() => setCopied(false), 1500); }} className="text-[11px] text-indigo-500 font-semibold hover:text-indigo-700">{copied ? "복사됨" : "복사"}</button>
              <button onClick={() => saveText(mn.value.content ?? "", `${safeFileName(m.title, "회의록")}_회의록.md`, "text/markdown")} className="text-[11px] text-indigo-500 font-semibold hover:text-indigo-700">내려받기</button>
            </div>
          )}
        </div>
        {mn?.kind === "ok" ? (
          <>
            {mn.value.approvedAt && <p className="text-[11px] text-slate-400">승인 {fmtDateTime(mn.value.approvedAt)}</p>}
            <div className="text-[13px] text-slate-700 leading-relaxed"><Markdown source={mn.value.content ?? ""} /></div>
          </>
        ) : mn?.kind === "error" ? <ErrorBox message={mn.text} onRetry={minutes.reload} />
          : <p className="text-[12px] text-slate-400 py-4 text-center">아직 승인된 회의록이 없습니다. 승인되면 여기에 나타납니다.</p>}
      </Card>

      <Card className="p-5 space-y-3">
        <Section>최종 보고서</Section>
        {report.loading && !rp ? <Spinner text="불러오는 중..." />
          : rp?.kind === "error" ? <ErrorBox message={rp.text} onRetry={report.reload} />
          : rp?.kind === "ok" && rp.value.status === "SUCCEEDED" && rp.value.fields ? (
            <div className="space-y-3">
              <p className="text-[11px] text-slate-400">완료 {fmtDateTime(rp.value.completedAt)}</p>
              <ReportDownload meetingId={m.meetingId} fields={rp.value.fields} templateMime={null} isDefault={isDefaultReport(rp.value.fields)}
                meta={{ title: `${m.title} 회의 보고서`, meetingDate: kstDateInput(m.startedAt ?? m.scheduledStartAt ?? m.endedAt), completedAt: rp.value.completedAt ? fmtDateTime(rp.value.completedAt) : null }} />
              {rp.value.fields.map(f => (
                <div key={f.key}>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">{f.label}</p>
                  <div className="text-[13px] text-slate-700 leading-relaxed"><FieldValue f={f} markdown={isDefaultReport(rp.value.fields) && f.key === "F05"} /></div>
                </div>
              ))}
            </div>
          ) : <p className="text-[12px] text-slate-400 py-4 text-center">보고서가 아직 준비되지 않았습니다.</p>}
      </Card>
    </div>
  );
}
