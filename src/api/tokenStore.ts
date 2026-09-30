// Access JWT는 메모리에만 보관한다(localStorage 금지, Architecture v6 §0.7).
let accessToken: string | null = null;

export const tokenStore = {
  get: () => accessToken,
  set: (t: string | null) => { accessToken = t; },
};
