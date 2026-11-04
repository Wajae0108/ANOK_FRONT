// 보고서(검토 담당자 전용) — FRONTEND_03(기본 보고서) · 04(회사 양식 보고서) · 05(양식 올리기).
// 두 보고서는 같은 리소스(POST·GET /custom-report)를 쓰고 "가장 최근 요청" 하나만 남는다. 요청 본문은 { hasTemplate, meetingDate }뿐이다.
//   · 기본 보고서(hasTemplate:false): 서버가 회의록·확정한 후보를 8칸으로 옮겨 담는다. AI를 부르지 않고 202 응답이 이미 완성본이라 폴링하지 않는다.
//   · 회사 양식 보고서(hasTemplate:true): 202(PENDING) 접수 → 3~5초 폴링 → SUCCEEDED/FAILED. 양식 파일은 문서 서비스에 먼저 올린다.
// 보고서 값은 AI가 만들었거나 사용자가 입력한 것이므로 일반 텍스트로 출력한다. 회의 개요(F05)만 회의록 Markdown이라 안전한 렌더러를 쓴다.
import { useEffect, useRef, useState } from "react";
import * as api from "../api/meeting";
import type { CustomReportResponse, MeetingResponse, ReportFieldResponse } from "../api/meeting";
import * as doc from "../api/document";
import type { MeetingMinutesTemplateResponse } from "../api/document";
import { ApiError, errorText, fieldErrorMap } from "../api/errors";
import { Card, Field, ghostBtn, inputCls, primaryBtn, Section } from "../ui/kit";
import Markdown from "../ui/Markdown";
import { fmtSize } from "../documents/shared";
import { fmtDateTime, kstDateInput } from "./shared";
import { printHtml, safeFileName, saveBlob } from "./download";
import { DOCX_MIME, formatForTemplate, reportDocxBytes, reportHtml, reportSections } from "./reportExport";
import type { ExportFormat, ReportMeta } from "./reportExport";
import { pdfPartialNotice, reportFileErrorText, templateUploadErrorText } from "./reportFileText";

const DEFAULT_REPORT_MIME = "application/x-anok-default-report"; // 서버가 기본 보고서(양식 파일 없음)에 붙이는 양식 종류
const POLL_MS = 4000;
const SLOW_AFTER_MS = 5 * 60 * 1000;

const STATUS_LABEL: Record<api.CustomReportStatus, string> = { PENDING: "양식 분석 중", PROCESSING: "보고서 생성 중", SUCCEEDED: "완료", FAILED: "실패" };
const STATUS_CLS: Record<api.CustomReportStatus, string> = {
  PENDING: "bg-amber-50 text-amber-600", PROCESSING: "bg-amber-50 text-amber-600", SUCCEEDED: "bg-emerald-50 text-emerald-600", FAILED: "bg-rose-50 text-rose-600",
};

// 4절 6-1: 실패 사유별 문구. 알 수 없는 코드는 일반 문구로 처리한다.
const FAILURE_TEXT: Record<string, string> = {
  TEMPLATE_UNSUPPORTED_FORMAT: "양식 파일을 열 수 없습니다. 다른 파일(PDF·Word·PNG·JPG)을 올린 뒤 다시 요청해 주세요.",
  TEMPLATE_TOO_LARGE: "양식 파일이 너무 큽니다. 더 작은 파일로 다시 올려 주세요.",
  TEMPLATE_ANALYSIS_FAILED: "양식 분석에 실패했습니다. 다시 요청해 보시고, 반복되면 양식을 바꿔 주세요.",
  CUSTOM_REPORT_FAILED: "보고서 생성에 실패했습니다. 다시 요청해 주세요.",
  AI_EGRESS_BLOCKED: "회사 AI 설정 또는 회의 민감도 때문에 AI를 사용할 수 없습니다. 다시 요청해도 같은 결과이니 관리자 설정을 확인해 주세요.",
  STRUCTURED_OUTPUT_INVALID: "AI 결과의 형식이 올바르지 않았습니다. 다시 요청해 주세요.",
  PROVIDER_UNAVAILABLE: "AI 서비스가 일시적으로 불안정합니다. 잠시 후 다시 요청해 주세요.",
  SOURCE_EXPIRED: "원본 보관 기한이 지나 보고서를 만들 수 없습니다.",
};
const failureText = (code?: string | null) => (code && FAILURE_TEXT[code]) || "보고서를 만들지 못했습니다. 다시 요청해 주세요.";
// 재요청해도 결과가 같은 실패 — 재요청 버튼 대신 안내만 한다.
const NOT_RETRYABLE = new Set(["AI_EGRESS_BLOCKED", "SOURCE_EXPIRED"]);

// 기본 보고서는 모든 칸이 서버가 채운 칸(SERVER)이다. 응답에 양식 종류 표시가 없어 이것으로 구분한다. F10(후속 조치)도 기본 보고서 칸이다.
export function isDefaultReport(fields?: ReportFieldResponse[] | null): boolean {
  return !!fields?.length && fields.every(f => f.source === "SERVER" && /^F\d\d$/.test(f.key));
}

export function FieldValue({ f, markdown = false }: { f: ReportFieldResponse; markdown?: boolean }) {
  if (f.kind === "signature") return <span className="text-slate-400">서명·결재 칸 — 직접 작성하는 칸입니다.</span>;
  if (!f.filled || f.value == null) {
    return <span className="text-slate-400">{f.source === "HUMAN" ? "사람이 채우는 칸입니다." : "근거를 찾지 못했거나 아직 채워지지 않았습니다."}</span>;
  }
  const v = f.value;
  if (f.kind === "list" && Array.isArray(v)) {
    return <ul className="list-disc pl-5 space-y-0.5">{v.map((x, i) => <li key={i}>{String(x)}</li>)}</ul>;
  }
  if (f.kind === "table" && Array.isArray(v)) {
    const cols = f.columns ?? [];
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-[12px] border border-slate-100">
          <thead><tr className="bg-slate-50">{cols.map(c => <th key={c} className="text-left font-semibold text-slate-500 px-2 py-1 border-b border-slate-100">{c}</th>)}</tr></thead>
          <tbody>
            {(v as Record<string, string>[]).map((row, i) => (
              <tr key={i}>{cols.map(c => <td key={c} className="px-2 py-1 border-b border-slate-50 align-top">{row?.[c] == null ? "" : String(row[c])}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (f.kind === "choice") {
    return (
      <div className="flex flex-wrap gap-1.5">
        {(f.options ?? []).map(o => (
          <span key={o} className={`text-[11px] px-2 py-0.5 rounded-full border ${o === v ? "bg-indigo-50 border-indigo-200 text-indigo-600 font-bold" : "border-slate-200 text-slate-400"}`}>{o}</span>
        ))}
      </div>
    );
  }
  if (markdown && typeof v === "string") return <Markdown source={v} />;
  return <span className="whitespace-pre-wrap">{String(v)}</span>;
}

// 회의 개요(F05)는 회의록 본문 전체라 길 수 있다 — 접기/펼치기.
function CollapsibleField({ f, markdown }: { f: ReportFieldResponse; markdown: boolean }) {
  const [open, setOpen] = useState(false);
  const long = typeof f.value === "string" && f.value.length > 600;
  return (
    <div>
      <div className={!open && long ? "max-h-40 overflow-hidden" : ""}><FieldValue f={f} markdown={markdown} /></div>
      {long && <button onClick={() => setOpen(o => !o)} className="mt-1 text-[11px] font-semibold text-indigo-500 hover:text-indigo-700">{open ? "접기" : "전체 보기"}</button>}
    </div>
  );
}

// 보고서 내려받기. 두 가지가 있다.
//  ① 양식 파일(서버): 올린 양식의 빈 칸에 보고서 값을 채운 파일. 양식이 PDF면 PDF, Word면 Word로 온다(원본 양식은 안 바뀐다).
//     GET /custom-report/file을 fetch로 받아 Blob으로 저장한다(Authorization 헤더가 필요해 링크로는 못 받는다). 파일 이름은 filename*를 쓴다.
//     PNG·JPG 양식은 파일로 채울 수 없다(409 REPORT_FORM_NOT_PDF).
//  ② 정리본(화면에서 생성): 양식 위에 채우지 않고 양식의 칸 순서대로 정리한 문서(PDF·Word). 서버 기능이 꺼져 있거나 양식 파일을 못 받을 때,
//     PNG·JPG 양식, 기본 보고서(양식 없음)에 쓴다. PDF는 브라우저 인쇄 창의 "PDF로 저장"을 쓴다.
export function ReportDownload({ meetingId, fields, meta, templateMime, isDefault }: {
  meetingId: string; fields: ReportFieldResponse[]; meta: ReportMeta; templateMime: string | null; isDefault: boolean;
}) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [filledUrl, setFilledUrl] = useState<string | null>(null); // 정리본 PDF를 눌렀을 때 화면에 띄우는, 양식으로 채운 PDF(Blob 주소)
  useEffect(() => () => { if (filledUrl) URL.revokeObjectURL(filledUrl); }, [filledUrl]);
  const formFormat: ExportFormat | null = isDefault ? null : formatForTemplate(templateMime);
  const isImageForm = !isDefault && !!templateMime && formFormat == null;
  const sections = () => reportSections(fields);

  async function downloadFilled() {
    setMsg(null); setBusy(true);
    try {
      const r = await api.downloadCustomReportFile(meetingId);
      saveBlob(r.blob, r.filename);
      const partial = pdfPartialNotice(r.unplaced, r.cut);
      setMsg({ ok: !partial, text: partial ?? `'${r.filename}' 파일을 내려받았습니다.` });
    } catch (e) {
      setMsg({ ok: false, text: reportFileErrorText(e instanceof ApiError ? { status: e.status, errorCode: e.errorCode } : { status: 0, errorCode: "NETWORK_ERROR" }) });
    } finally { setBusy(false); }
  }
  async function summaryPdf() {
    setMsg(null);
    if (formFormat === "pdf") {  // 양식이 PDF면 정리본 PDF도 서버가 양식에 채워 만든 그 PDF를 화면에 보여 준다. 못 받으면 아래 인쇄 방식으로 넘어간다.
      setBusy(true);
      try {
        const r = await api.downloadCustomReportFile(meetingId);
        if ((r.blob.type || "").toLowerCase().includes("pdf")) {
          setFilledUrl(URL.createObjectURL(r.blob));
          const partial = pdfPartialNotice(r.unplaced, r.cut);
          if (partial) setMsg({ ok: false, text: partial });
          return;
        }
      } catch { /* 아래 인쇄 방식으로 */ } finally { setBusy(false); }
    }
    try { await printHtml(reportHtml(meta, sections())); }
    catch { setMsg({ ok: false, text: "인쇄 창을 열지 못했습니다. 브라우저의 팝업·인쇄 차단을 확인해 주세요." }); }
  }
  function summaryWord() {
    setMsg(null);
    try { saveBlob(new Blob([reportDocxBytes(meta, sections()) as BlobPart], { type: DOCX_MIME }), `${safeFileName(meta.title, "보고서")}.docx`); }
    catch { setMsg({ ok: false, text: "Word 파일을 만들지 못했습니다." }); }
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-100 p-3">
      {formFormat && (
        <div className="space-y-1.5">
          <button disabled={busy} onClick={() => void downloadFilled()} className={primaryBtn}>
            {busy ? "파일 만드는 중..." : `양식 파일로 내려받기 (${formFormat === "pdf" ? "PDF" : "Word"})`}
          </button>
          <p className="text-[11px] text-slate-400 leading-relaxed">올린 양식의 빈 칸에 값을 채운 {formFormat === "pdf" ? "PDF" : "Word"} 파일입니다. 원본 양식은 바뀌지 않고, 사람이 직접 쓰는 칸은 비어 있습니다.</p>
        </div>
      )}
      {isImageForm && <p className="text-[11px] text-amber-600">PNG·JPG로 올린 양식은 양식 파일로 채워 내려받을 수 없습니다(PDF·Word 양식만 가능). 아래 정리본으로 받아 주세요.</p>}
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] font-semibold text-slate-500">정리본</span>
          <button disabled={busy} onClick={() => void summaryPdf()} className={ghostBtn}>PDF</button>
          <button onClick={summaryWord} className={ghostBtn}>Word(.docx)</button>
        </div>
        <p className="text-[11px] text-slate-400 leading-relaxed">양식 위에 채우지 않고 양식의 칸 순서대로 정리한 문서입니다. 기본 보고서나 양식 파일을 받을 수 없을 때 쓰세요. {formFormat === "pdf" ? "PDF를 누르면 양식으로 채운 PDF가 아래에 열립니다." : <>PDF는 열리는 인쇄 창에서 <b>대상: PDF로 저장</b>을 고르세요.</>}</p>
      </div>
      {filledUrl && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-[12px] font-semibold text-slate-500">양식으로 채운 PDF</p>
            <button onClick={() => setFilledUrl(null)} className="text-[12px] font-semibold text-slate-400 hover:text-slate-600">닫기</button>
          </div>
          <iframe title="양식으로 채운 보고서 PDF" src={`${filledUrl}#navpanes=0&view=FitH`} className="w-full h-[820px] rounded-xl border border-slate-200 bg-white" />
        </div>
      )}
      {msg && <p className={`text-[12px] font-medium ${msg.ok ? "text-emerald-600" : "text-rose-500"}`}>{msg.text}</p>}
    </div>
  );
}

// 양식 파일(PDF·Word(.docx, 서버가 허용할 때)·PNG·JPG, 10MB 이하) 올리기 — 검토 담당자가 회의를 만든 직후(예정 상태)부터 취소 전까지 언제든 할 수 있다.
// 같은 내용을 다시 올리면 같은 templateId가 돌아오고, 올리기만으로는 분석이 시작되지 않는다(보고서를 요청할 때 시작).
export function TemplateUploader({ meetingId, disabled, onUploaded }: { meetingId: string; disabled?: boolean; onUploaded?: (t: MeetingMinutesTemplateResponse) => void }) {
  const [template, setTemplate] = useState<MeetingMinutesTemplateResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setMsg(null);
    if (file.size === 0) { setMsg({ ok: false, text: "빈 파일은 올릴 수 없습니다." }); return; }
    // 서버는 약 55~60MB를 넘으면 응답 없이 연결을 끊으므로(네트워크 오류로 보인다) 10MB를 프론트에서 먼저 막는다.
    if (file.size > doc.MINUTES_TEMPLATE_MAX_BYTES) { setMsg({ ok: false, text: "양식 파일은 10MB 이하여야 합니다." }); return; }
    setBusy(true);
    try {
      const t = await doc.uploadMeetingMinutesTemplate(meetingId, file);
      setTemplate(t); onUploaded?.(t);
      setMsg({ ok: true, text: "양식을 올렸습니다." });
    } catch (e) {
      // 거절 사유별 안내(양식기능 전체정리 2.2): 형식·보안 규칙·크기·권한·검사 서비스. 모르는 코드는 서버 메시지.
      setMsg({ ok: false, text: (e instanceof ApiError ? templateUploadErrorText({ status: e.status, errorCode: e.errorCode }) : null) ?? errorText(e) });
    } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" accept={doc.MINUTES_TEMPLATE_ACCEPT} className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
        <button disabled={busy || disabled} onClick={() => fileRef.current?.click()} className={ghostBtn}>{busy ? "올리는 중..." : template ? "양식 바꾸기" : "양식 올리기"}</button>
        {template && <span className="text-[12px] text-slate-600">{template.filename} · {fmtSize(template.sizeBytes)} · {fmtDateTime(template.uploadedAt)}</span>}
      </div>
      {msg && <p className={`text-[12px] font-medium ${msg.ok ? "text-emerald-600" : "text-rose-500"}`}>{msg.text}</p>}
    </div>
  );
}

export default function ReportPanel({ m, minutesReady, latestChangeAt }: {
  m: MeetingResponse;
  /** 회의록이 DRAFT/APPROVED로 만들어져 있는가 — 기본 보고서의 조건(없으면 409 MINUTES_NOT_READY). */
  minutesReady: boolean;
  /** 회의록 수정·승인 또는 후보 수정·확정 중 가장 최근 시각. 보고서가 이보다 오래됐으면 "다시 만들기"를 권한다. */
  latestChangeAt?: string | null;
}) {
  const [report, setReport] = useState<CustomReportResponse | null | undefined>(undefined); // undefined=불러오는 중
  const [featureOff, setFeatureOff] = useState(false); // 404 ROUTE_NOT_FOUND = 서버에서 기능이 꺼져 있음
  const [meetingDate, setMeetingDate] = useState(() => kstDateInput(m.startedAt ?? m.scheduledStartAt ?? m.endedAt));
  const [busy, setBusy] = useState<"default" | "template" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  // 기본 보고서에 후속 업무를 넣을지 — 만들기 전에 고른다. 명세(FRONTEND_01 8절)대로 둘 다 해제로 시작하고, 요청마다 true/false를 명시해서 보낸다.
  const [includeFollowUp, setIncludeFollowUp] = useState(false);
  const [includeNextSteps, setIncludeNextSteps] = useState(false);

  async function load() {
    try { setReport(await api.getMeetingCustomReport(m.meetingId)); }
    catch (e) {
      if (e instanceof ApiError && e.errorCode === "ROUTE_NOT_FOUND") setFeatureOff(true);
      else if (report === undefined) { setReport(null); setMsg({ ok: false, text: errorText(e) }); }
      // 폴링 중 일시 오류는 조용히 다음 주기에 다시 시도한다.
    }
  }
  useEffect(() => { void load(); }, [m.meetingId]); // eslint-disable-line react-hooks/exhaustive-deps

  // 올린 양식의 형식(PDF/이미지/…)을 알아 두었다가 내려받기 버튼의 기본 형식을 정한다. 양식이 없거나 못 읽으면 선호 없음.
  const [templateMime, setTemplateMime] = useState<string | null>(null);
  useEffect(() => {
    if (report?.status !== "SUCCEEDED") return;
    let alive = true;
    // GET /template은 보고서를 요청하기 전에는 null이므로(양식 분석이 요청과 함께 시작된다), 업로드 응답에서 알게 된 형식을 null로 덮어쓰지 않는다.
    api.getMeetingTemplate(m.meetingId).then(t => { if (alive && t?.mimeType) setTemplateMime(t.mimeType); }).catch(() => { /* 업로드 때 알게 된 형식을 유지 */ });
    return () => { alive = false; };
  }, [m.meetingId, report?.status, report?.reportId]);

  const inFlight = report?.status === "PENDING" || report?.status === "PROCESSING";
  useEffect(() => {
    if (!inFlight) return;
    const iv = setInterval(() => { void load(); }, POLL_MS);
    return () => clearInterval(iv);
  }, [m.meetingId, inFlight]); // eslint-disable-line react-hooks/exhaustive-deps

  if (featureOff) return null;

  async function request(hasTemplate: boolean) {
    setMsg(null); setFieldErr({});
    if (!/^\d{4}-\d{2}-\d{2}$/.test(meetingDate)) { setFieldErr({ meetingDate: "날짜를 선택해 주세요" }); return; }
    setBusy(hasTemplate ? "template" : "default");
    try {
      // request()가 호출마다 새 Idempotency-Key를 만든다 — "최신으로 다시 만들기"는 새 키여야 새 보고서가 만들어진다.
      const r = await api.requestMeetingCustomReport(m.meetingId, { hasTemplate, meetingDate, includeFollowUpActions: includeFollowUp, includeNextSteps });
      setReport(r);
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) }); setFieldErr(fieldErrorMap(e));
      // 이미 생성 중이면 진행 중인 작업을 보여준다.
      if (e instanceof ApiError && e.errorCode === "CUSTOM_REPORT_IN_PROGRESS") void load();
    } finally { setBusy(null); }
  }

  const slow = inFlight && report && Date.now() - new Date(report.requestedAt).getTime() > SLOW_AFTER_MS;
  const failed = report?.status === "FAILED";
  // 기본 보고서는 8칸 모두 서버가 채운 칸(SERVER)이다. 응답에 양식 종류 표시가 없어 이것으로 구분한다.
  // 기본 보고서는 모든 칸이 서버가 채운 칸이라는 모양으로 구분하는데, 회사 양식 분석이 "서버 칸 하나"만 돌려줘도 같은 모양이 된다(양식 파일 버튼이 사라진다).
  // 서버가 알려 주는 양식 종류(기본 보고서의 양식은 application/x-anok-default-report)를 알고 있으면 그것이 우선이다.
  const isDefault = isDefaultReport(report?.fields) && (templateMime == null || templateMime === DEFAULT_REPORT_MIME);
  const stale = report?.status === "SUCCEEDED" && !!latestChangeAt && new Date(latestChangeAt).getTime() > new Date(report.completedAt ?? report.requestedAt).getTime();
  const emptyDecisions = isDefault && (report?.fields ?? []).some(f => (f.key === "F07" || f.key === "F08") && !f.filled);

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <Section>보고서</Section>
        {report && <span className={`inline-flex text-[10px] font-bold px-2.5 py-0.5 rounded-full ${STATUS_CLS[report.status]}`}>{STATUS_LABEL[report.status]}</span>}
      </div>

      <Field label="회의 일시 (보고서에 들어갈 날짜)" error={fieldErr.meetingDate}>
        <input type="date" value={meetingDate} onChange={e => setMeetingDate(e.target.value)} className={`${inputCls} max-w-[200px]`} />
      </Field>
      <p className="text-[11px] text-slate-400">담당자와 참석자 이름은 서버가 채웁니다. 참석자는 현재 참여 중이고 기록 접근 권한이 있는 사람이며 검토 담당자가 맨 앞에 옵니다.</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="border border-slate-100 rounded-xl p-3 space-y-2">
          <p className="text-[12px] font-bold text-slate-700">기본 보고서</p>
          <p className="text-[11px] text-slate-400 leading-relaxed">회의록과 <b>확정한 후보</b>를 8칸으로 옮겨 담습니다. AI를 쓰지 않고 바로 완성됩니다.</p>
          <div className="space-y-1.5 rounded-lg bg-slate-50 px-3 py-2">
            <p className="text-[11px] font-semibold text-slate-500">후속 업무 (만들기 전에 선택)</p>
            <p className="text-[10px] text-slate-400 leading-relaxed">고른 내용은 이 보고서에만 적용됩니다. 참석자·열람자에게는 회의록 승인 뒤에 만든 보고서만 보입니다. 후속 조치를 고치려면 회의록의 '다음 단계'를 고친 뒤 다시 만드세요.</p>
            <label className="flex items-start gap-2 text-[12px] text-slate-600 cursor-pointer">
              <input type="checkbox" className="mt-0.5" checked={includeFollowUp} disabled={busy !== null || inFlight} onChange={e => setIncludeFollowUp(e.target.checked)} />
              <span><b>실행 항목</b> 포함 <span className="text-slate-400">— 확정한 업무 후보를 업무·담당자·기한 표로</span></span>
            </label>
            <label className="flex items-start gap-2 text-[12px] text-slate-600 cursor-pointer">
              <input type="checkbox" className="mt-0.5" checked={includeNextSteps} disabled={busy !== null || inFlight} onChange={e => setIncludeNextSteps(e.target.checked)} />
              <span><b>후속 조치(다음 단계)</b> 포함 <span className="text-slate-400">— 회의록의 '다음 단계' 구역</span></span>
            </label>
          </div>
          <button disabled={busy !== null || inFlight || !minutesReady} onClick={() => request(false)} className={primaryBtn}>
            {busy === "default" ? "만드는 중..." : report?.status === "SUCCEEDED" && isDefault ? "최신으로 다시 만들기" : "기본 보고서 만들기"}
          </button>
          {!minutesReady && <p className="text-[11px] text-amber-600">회의록이 만들어진 뒤에 요청할 수 있습니다.</p>}
        </div>
        <div className="border border-slate-100 rounded-xl p-3 space-y-2">
          <p className="text-[12px] font-bold text-slate-700">회사 양식 보고서</p>
          <p className="text-[11px] text-slate-400 leading-relaxed">회사 회의록 양식(PDF·Word(.docx)·PNG·JPG, 10MB 이하)을 AI가 읽어 칸을 채웁니다. PDF·Word 양식은 채운 파일로 내려받을 수 있습니다. Word는 서버 설정이 켜져 있을 때만 올라갑니다. 다시 올리면 새 양식으로 바뀝니다.</p>
          <TemplateUploader meetingId={m.meetingId} disabled={busy !== null || inFlight} onUploaded={t => setTemplateMime(t.mimeType)} />
          <button disabled={busy !== null || inFlight} onClick={() => request(true)} className={ghostBtn}>
            {busy === "template" ? "요청 중..." : failed ? "다시 요청" : report?.status === "SUCCEEDED" && !isDefault ? "다시 만들기" : "양식으로 만들기"}
          </button>
        </div>
      </div>

      {inFlight && <span className="flex items-center gap-1.5 text-[12px] text-amber-600"><span className="w-3 h-3 border-2 border-amber-300 border-t-amber-600 rounded-full animate-spin" />{STATUS_LABEL[report!.status]}... (3~5초마다 확인합니다)</span>}
      {slow && <p className="text-[12px] text-amber-600">평소보다 오래 걸리고 있습니다. 1시간이 지나도 끝나지 않으면 실패로 처리되니 그때 다시 요청해 주세요.</p>}
      {failed && <p className="text-[12px] text-rose-500 font-medium">{failureText(report?.failureCode)}{NOT_RETRYABLE.has(report?.failureCode ?? "") && " (다시 요청해도 같은 결과입니다)"}</p>}
      {msg && <p className={`text-[12px] font-medium ${msg.ok ? "text-emerald-600" : "text-rose-500"}`}>{msg.text}</p>}

      {report?.status === "SUCCEEDED" && report.fields && (
        <div className="space-y-3 pt-3 border-t border-slate-50">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="text-[11px] text-slate-400">{isDefault ? "요청한 시점의 복사본입니다." : "AI가 만든 초안입니다."} 완료 {fmtDateTime(report.completedAt)}</p>
            {stale && <p className="text-[11px] font-semibold text-amber-600">그 뒤에 회의록·후보가 바뀌었습니다. 최신으로 다시 만들어 주세요.</p>}
          </div>
          {emptyDecisions && <p className="text-[12px] text-amber-600 bg-amber-50 rounded-xl px-3 py-2">'결정 사항'·'실행 항목'은 <b>확정한 후보</b>만 들어갑니다. 후보를 확정한 뒤 최신으로 다시 만들어 주세요.</p>}
          <ReportDownload meetingId={m.meetingId} fields={report.fields} templateMime={templateMime} isDefault={isDefault}
            meta={{ title: `${m.title} 회의 보고서`, meetingDate, completedAt: report.completedAt ? fmtDateTime(report.completedAt) : null }} />
          {report.fields.map(f => (
            <div key={f.key}>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">{f.label}</p>
              <div className="text-[13px] text-slate-700 leading-relaxed"><CollapsibleField f={f} markdown={isDefault && f.key === "F05"} /></div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
