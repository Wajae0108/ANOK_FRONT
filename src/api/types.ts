// Anok_API_Common_Response_Spec_v4_FINAL 기준 공통 Wire 타입

export interface FieldError {
  field: string;
  reason: string;
}

export interface ApiSuccessBody<T> {
  success: true;
  message: string;
  data: T;
  errorCode: null;
}

export interface ApiFailureBody {
  success: false;
  message: string;
  data: null;
  errorCode: string;
  requestId: string;
  fieldErrors?: FieldError[];
}

export interface OffsetPage<T> {
  items: T[];
  page: { offset: number; limit: number; total: number };
}

export interface CursorPage<T> {
  items: T[];
  page: { limit: number; nextCursor: string | null; hasNext: boolean };
}

export type Uuid = string;
export type Rfc3339 = string;
