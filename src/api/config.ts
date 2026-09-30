// VITE_API_BASE_URL(예: https://api.anok.example)이 없으면 명세 형태로 응답하는 mock 어댑터를 사용한다.
const raw = import.meta.env.VITE_API_BASE_URL as string | undefined;

export const API_BASE_URL = raw ? raw.replace(/\/+$/, "") : "";
export const USE_MOCK = API_BASE_URL === "";
