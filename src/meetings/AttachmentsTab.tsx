// 회의 자료(첨부) — FRONTEND_06. 문서 서비스 API라 응답 봉투가 미팅 서비스와 다르고, 권한 오류는 사유를 구분하지 않는 403이다 → 버튼을 미리 숨긴다.
//   · 올리기·기존 문서 연결: 참여 중이고 기록 접근권이 있는 참여자 누구나, 회의가 예정·진행 중일 때만 (끝나는 순간 목록이 고정된다)
//   · 연결 해제: 회의 주최자 + 그 문서를 고칠 수 있는 사람(소유자·편집자). 남이 올린 자료는 주최자도 못 뗀다
//   · 올리면 서버가 자동으로 글자 뽑기(파싱)를 시작한다 → 파일별 processingStatus를 1~3초 간격으로 폴링해 READY/FAILED를 보여 준다
import { useRef, useState } from "react";
import * as doc from "../api/document";
import type { MeetingAttachmentResponse } from "../api/document";
import { errorText } from "../api/errors";
import { Card, ErrorBox, Field, ghostBtn, inputCls, Modal, primaryBtn, Section, Spinner, useLoad } from "../ui/kit";
import { fmtSize, PermissionBadge } from "../documents/shared";
import { AttachmentStatusBadge, ATTACHMENT_BUSY, ATTACHMENT_FAILURE_TEXT } from "./shared";
import type { MeetingCtx } from "./meetingContext";
import { usePoll } from "./usePoll";

function Msg({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return <p className={`text-[12px] font-medium ${msg.ok ? "text-emerald-600" : "text-rose-500"}`}>{msg.text}</p>;
}

function AttachExistingModal({ meetingId, attachedIds, onClose, onAttached }: {
  meetingId: string; attachedIds: Set<string>; onClose: () => void; onAttached: (a: MeetingAttachmentResponse) => void;
}) {
  const { data, loading } = useLoad(() => doc.listDocuments({ status: "ACTIVE", limit: 100 }), []);
  // 연결은 문서 소유자만 할 수 있고, 보관된 문서는 연결할 수 없다.
  const candidates = (data?.items ?? []).filter(d => d.effectivePermission === "OWNER" && d.status === "ACTIVE" && !attachedIds.has(d.documentId));
  const [documentId, setDocumentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setError(null);
    try { onAttached(await doc.attachExistingDocumentToMeeting(meetingId, documentId)); onClose(); }
    catch (e) { setError(errorText(e)); setBusy(false); }
  }
  return (
    <Modal title="기존 문서 병합" onClose={onClose}>
      {loading ? <Spinner /> : candidates.length === 0 ? (
        <p className="text-[12px] text-slate-400 py-4 text-center">병합할 수 있는 문서가 없습니다. 내가 소유한(보관되지 않은) 문서만 회의에 병합할 수 있습니다.</p>
      ) : (
        <Field label="내 문서">
          <select value={documentId} onChange={e => setDocumentId(e.target.value)} className={inputCls}>
            <option value="">선택하세요</option>
            {candidates.map(d => <option key={d.documentId} value={d.documentId}>{d.title}</option>)}
          </select>
        </Field>
      )}
      {error && <p className="text-[12px] text-rose-500 font-medium">{error}</p>}
      <div className="flex gap-2">
        <button onClick={onClose} className={`flex-1 ${ghostBtn}`}>취소</button>
        <button disabled={busy || !documentId} onClick={submit} className={`flex-1 ${primaryBtn}`}>{busy ? "병합 중..." : "병합"}</button>
      </div>
    </Modal>
  );
}

export function UploadAttachmentModal({ meetingId, onClose, onUploaded }: { meetingId: string; onClose: () => void; onUploaded: (a: MeetingAttachmentResponse) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    // 올리기 전에 크기·이름 길이·형식을 먼저 거른다(서버는 50MB 초과나 너무 긴 이름을 413으로 거절한다).
    const bad = doc.validateUploadFile(f);
    setError(bad);
    if (bad) { setFile(null); if (fileRef.current) fileRef.current.value = ""; return; }
    setFile(f);
    if (!title.trim()) setTitle(f.name.replace(/\.[^.]+$/, "").slice(0, doc.UPLOAD_MAX_TITLE));
  }
  async function submit() {
    if (!file) return;
    setBusy(true); setError(null);
    try { onUploaded(await doc.uploadMeetingAttachment(meetingId, file, { title: title.trim() })); onClose(); }
    catch (e) { setError(errorText(e)); setBusy(false); }
  }
  return (
    <Modal title="새 파일을 회의 자료로 업로드" onClose={onClose}>
      <input ref={fileRef} type="file" className="hidden" onChange={pick} />
      <button onClick={() => fileRef.current?.click()} className="w-full py-6 border-2 border-dashed border-slate-200 rounded-xl text-[13px] text-slate-500 hover:border-indigo-300 hover:text-indigo-600 transition-colors">
        {file ? <span className="font-semibold text-slate-700">{file.name} ({fmtSize(file.size)})</span> : "파일을 선택하세요 (최대 50MB)"}
      </button>
      <p className="text-[11px] text-slate-400">AI가 글자를 뽑아 읽을 수 있는 형식은 PDF·Word(.docx)·PowerPoint(.pptx)·텍스트입니다. 이미지·오디오·Excel 등은 올라가지만 AI 근거로는 쓰이지 않습니다. 회의가 끝나면 자료 목록이 고정되어 더 올릴 수 없습니다.</p>
      <Field label="제목"><input value={title} onChange={e => setTitle(e.target.value)} maxLength={doc.UPLOAD_MAX_TITLE} className={inputCls} /></Field>
      {error && <p className="text-[12px] text-rose-500 font-medium">{error}</p>}
      <div className="flex gap-2">
        <button onClick={onClose} disabled={busy} className={`flex-1 ${ghostBtn}`}>취소</button>
        <button disabled={busy || !file || !title.trim()} onClick={submit} className={`flex-1 ${primaryBtn}`}>{busy ? "업로드 중..." : "업로드"}</button>
      </div>
    </Modal>
  );
}

export default function AttachmentsTab({ ctx }: { ctx: MeetingCtx }) {
  const { m, hasAccess, isOrganizer, navigate } = ctx;
  const { data, setData, loading, error, reload } = useLoad(() => doc.listMeetingAttachments(m.meetingId, { limit: 100 }), [m.meetingId]);
  const [modal, setModal] = useState<"existing" | "upload" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const items = data?.items ?? [];
  const anyBusy = items.some(a => a.processingStatus && ATTACHMENT_BUSY.includes(a.processingStatus));
  // 처리 상태가 바뀌는 동안(1~3초)만 목록을 다시 읽는다. 중간 단계(PARSING 등)는 짧아 못 볼 수도 있다.
  usePoll(async () => {
    const page = await doc.listMeetingAttachments(m.meetingId, { limit: 100 });
    setData(page);
  }, 2000, anyBusy, [m.meetingId]);

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  const open = m.status === "SCHEDULED" || m.status === "IN_PROGRESS";
  const canAdd = open && hasAccess;

  async function detach(documentId: string) {
    if (!confirm("이 문서를 회의에서 분리하시겠습니까? (문서 자체는 지워지지 않습니다)")) return;
    setBusy(documentId); setMsg(null);
    try { await doc.detachMeetingAttachment(m.meetingId, documentId); reload(); }
    catch (e) { setMsg({ ok: false, text: errorText(e) }); } finally { setBusy(null); }
  }

  return (
    <div className="max-w-2xl space-y-4">
      {modal === "existing" && <AttachExistingModal meetingId={m.meetingId} attachedIds={new Set(items.map(a => a.documentId))} onClose={() => setModal(null)} onAttached={a => setData(d => d ? { ...d, items: [a, ...d.items] } : d)} />}
      {modal === "upload" && <UploadAttachmentModal meetingId={m.meetingId} onClose={() => setModal(null)} onUploaded={a => setData(d => d ? { ...d, items: [a, ...d.items] } : d)} />}
      <div className="flex items-center justify-between">
        <Section>회의 자료 ({items.length})</Section>
        {canAdd && (
          <div className="flex gap-2">
            <button onClick={() => setModal("existing")} className="text-[11px] text-indigo-500 font-semibold hover:text-indigo-700">+ 기존 문서 병합</button>
            <button onClick={() => setModal("upload")} className="text-[11px] text-indigo-500 font-semibold hover:text-indigo-700">+ 새 파일 업로드</button>
          </div>
        )}
      </div>
      <p className="text-[10px] text-slate-400">이 회의에 병합된 문서는 회의 참가자에게만 보이며, 문서함 전체 목록에는 노출되지 않습니다. 회의가 끝난 뒤 AI는 '근거로 사용 가능' 상태의 자료만 보조 근거로 읽습니다.</p>
      {items.length === 0 ? (
        <Card className="p-8 text-center text-[12px] text-slate-400">아직 병합된 자료가 없습니다.</Card>
      ) : (
        <Card className="divide-y divide-slate-50">
          {items.map(a => (
            <div key={a.attachmentId} className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1 min-w-0 cursor-pointer" onClick={() => navigate("document-detail", { docId: a.documentId, fromMeetingId: m.meetingId })}>
                <p className="text-[13px] font-semibold text-slate-800 truncate hover:text-indigo-600">{a.title}</p>
                <p className="text-[11px] text-slate-400 truncate">{a.originalFilename} · {fmtSize(a.sizeBytes)}</p>
                {a.processingFailureCode && <p className="text-[11px] text-rose-400">{ATTACHMENT_FAILURE_TEXT[a.processingFailureCode] ?? a.processingFailureCode}</p>}
              </div>
              <AttachmentStatusBadge status={a.processingStatus} failureCode={a.processingFailureCode} />
              <PermissionBadge permission={a.effectivePermission} />
              {/* 해제: 주최자이면서 그 문서를 고칠 수 있는 사람(소유자·편집자)에게만 보인다. */}
              {open && isOrganizer && (a.effectivePermission === "OWNER" || a.effectivePermission === "EDITOR") && (
                <button disabled={busy === a.documentId} onClick={() => detach(a.documentId)} className="text-[11px] text-rose-400 font-semibold hover:text-rose-600 disabled:opacity-40">분리</button>
              )}
            </div>
          ))}
        </Card>
      )}
      {!open && <p className="text-[11px] text-slate-400">회의가 끝나거나 취소되면 자료 목록이 고정되어 올리기·연결·분리를 할 수 없습니다.</p>}
      {open && !hasAccess && <p className="text-[11px] text-slate-400">참여 중이고 기록 접근 권한이 있는 참가자만 자료를 올릴 수 있습니다.</p>}
      <Msg msg={msg} />
    </div>
  );
}
