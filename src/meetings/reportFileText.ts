// 양식 업로드·보고서 파일 내려받기 오류를 사용자가 알아들을 문구로 바꾼다. 근거: 양식기능_PDF_Word_전체정리 2.2(업로드 거절)·2.7(오류 코드 표).
// 코드 → 문구만 다루는 순수 함수라 화면과 분리해 시험한다.

export interface CodedError { status: number; errorCode: string }

/** GET /custom-report/file 실패 문구. 알 수 없는 코드는 일반 문구. */
export function reportFileErrorText(e: CodedError): string {
  switch (e.errorCode) {
    case "REPORT_FORM_NOT_PDF":
      return "PNG·JPG로 올린 양식은 양식 파일로 채워 내려받을 수 없습니다(PDF·Word 양식만 가능). 아래 '정리본'으로 받아 주세요.";
    case "REPORT_FORM_UNREADABLE":
      return "이 양식에는 값을 안전하게 넣을 수 없습니다. 다시 요청해도 같은 결과이니 다른 양식을 올려 주세요. 아래 '정리본'으로는 받을 수 있습니다.";
    case "REPORT_FORM_LAYOUT_UNKNOWN":
      return "양식의 칸 위치 정보가 없거나 양식과 맞지 않습니다. 다시 요청해도 안 되니 양식을 다시 올린 뒤 보고서를 다시 요청해 주세요.";
    case "TEMPLATE_CONTENT_GONE":
      return "양식이 바뀌었거나 지워졌습니다. 양식을 다시 올리고 보고서를 다시 요청해 주세요.";
    case "REPORT_NOT_READY":
      return "보고서가 아직 완성되지 않았거나 만드는 동안 바뀌었습니다. 잠시 뒤 다시 시도해 주세요.";
    case "CUSTOM_REPORT_NOT_FOUND":
      return "받을 수 있는 보고서가 아직 없습니다. 보고서를 먼저 만들어 주세요.";
    case "REPORT_PDF_UNAVAILABLE":
      return "양식 파일을 만드는 서버에 문제가 있습니다. 잠시 뒤 다시 시도하고, 계속되면 관리자에게 알려 주세요. 아래 '정리본'으로는 받을 수 있습니다.";
    case "TEMPLATE_SOURCE_UNAVAILABLE":
      return "양식 저장소에 일시적으로 접근할 수 없습니다. 잠시 뒤 다시 시도해 주세요.";
    case "ROUTE_NOT_FOUND":
    case "NOT_FOUND":
      return "서버에서 양식 파일 내려받기 기능이 꺼져 있거나 아직 제공되지 않습니다. 아래 '정리본'으로 받을 수 있습니다.";
    case "NETWORK_ERROR":
      return "네트워크 오류로 파일을 받지 못했습니다. 연결을 확인하고 다시 시도해 주세요.";
  }
  if (e.status === 404) return "서버에서 양식 파일 내려받기 기능이 꺼져 있거나 아직 제공되지 않습니다. 아래 '정리본'으로 받을 수 있습니다.";
  if (e.status === 403) return "보고서를 받을 권한이 없습니다.";
  if (e.status === 503) return "서버가 일시적으로 불안정합니다. 잠시 뒤 다시 시도해 주세요.";
  return "양식 파일을 받지 못했습니다. 잠시 뒤 다시 시도해 주세요.";
}

/** PDF 파일이 200으로 왔을 때 일부 값이 빠지거나 잘렸으면 알릴 문구(없으면 null). */
export function pdfPartialNotice(unplaced: number, cut: number): string | null {
  if (!(unplaced > 0) && !(cut > 0)) return null;
  const parts = [unplaced > 0 && `양식에 넣지 못한 값 ${unplaced}개`, cut > 0 && `칸보다 길어 잘린 값 ${cut}개`].filter(Boolean).join(", ");
  return `일부 값이 빠지거나 잘렸습니다 (${parts}). 파일을 열어 확인해 주세요.`;
}

/** PUT /minutes-template 실패 문구(2.2). 코드가 없으면 서버 메시지를 쓰도록 null. */
export function templateUploadErrorText(e: CodedError): string | null {
  switch (e.errorCode) {
    case "FILE_TYPE_NOT_ALLOWED":
      return "올릴 수 없는 파일입니다. PNG·JPG·PDF만 가능하고, 서버가 허용하면 Word(.docx)도 가능합니다. Word는 변경 추적·편집 제한·매크로가 없는 일반 .docx로 저장해서 올려 주세요(HWP는 PDF로 변환).";
    case "FILE_SECURITY_BLOCKED":
      return "보안 규칙에 걸려 올릴 수 없는 파일입니다. 다른 파일로 바꿔 올려 주세요.";
    case "MINUTES_TEMPLATE_TOO_LARGE":
      return "양식 파일이 너무 큽니다(10MB 이하). 더 작은 파일로 올려 주세요.";
    case "MEETING_ATTACHMENT_FORBIDDEN":
      return "양식은 이 회의의 검토 담당자만 올릴 수 있습니다.";
    case "FILE_VALIDATION_UNAVAILABLE":
      return "파일 검사 서비스가 일시적으로 불안정합니다. 잠시 뒤 다시 올려 주세요.";
  }
  if (e.status === 413) return "양식 파일이 너무 큽니다(10MB 이하). 더 작은 파일로 올려 주세요.";
  return null;
}
