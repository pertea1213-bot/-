// API 클라이언트. 실패는 ApiError 로 던지고 화면이 사용자에게 사유를 보여 준다.
let token = null;
try { token = sessionStorage.getItem('fde_token'); } catch (_) { /* 저장소 차단 시 메모리만 사용 */ }

export class ApiError extends Error {
  constructor(status, message, data) { super(message); this.status = status; this.data = data || {}; }
}
export function setToken(t) {
  token = t;
  try { if (t) sessionStorage.setItem('fde_token', t); else sessionStorage.removeItem('fde_token'); } catch (_) { /* noop */ }
}
export const hasToken = () => !!token;

async function call(method, path, body) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try { res = await fetch(`/api${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined }); }
  catch (_) { throw new ApiError(0, '서버에 연결할 수 없습니다.'); }
  let data = null;
  try { data = await res.json(); } catch (_) { /* 본문 없음 */ }
  if (res.status === 401 && token) { window.dispatchEvent(new CustomEvent('auth-lost')); }
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || `요청 실패(${res.status})`, data);
  return data;
}
export const get = (p) => call('GET', p);
export const post = (p, b = {}) => call('POST', p, b);
export const put = (p, b = {}) => call('PUT', p, b);
export const patch = (p, b = {}) => call('PATCH', p, b);
export const del = (p) => call('DELETE', p);
