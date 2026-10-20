// UI 헬퍼. 모든 동적 텍스트는 DOM 텍스트 노드로 들어가므로 innerHTML 을 쓰지 않는다(XSS 방지).
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'open') el[k] = !!v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  add(el, kids);
  return el;
}
function add(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const $ = (sel, root = document) => root.querySelector(sel);

export const BUCKETS = ['approved', 'review', 'unconfirmed', 'in_progress', 'reserve'];
export const BUCKET_NAME = { approved: '준비(승인)', review: '검토', unconfirmed: '미확인', in_progress: '진행', reserve: '예비' };
export const VALUE_NAME = { verified: '확인됨', unmet: '미충족', pending: '진행 중', missing: '근거 없음/불명', delivered: '전달됨(미적용)' };
export const STATUS_NAME = { DRAFT: '초안', SUBMITTED: '결재 요청', APPROVED: '승인됨(미실행)', IN_EXECUTION: '실행 중', CLOSED: '종료', STOPPED: '중단', REJECTED: '반려' };

export const pct = (v) => (v == null ? '산출 불가(분모 0)' : `${v.toFixed(2)}%`);
export const n = (v) => (v == null ? '—' : Number(v).toLocaleString('ko-KR'));
export const won = (v) => `${Number(v || 0).toLocaleString('ko-KR')}원`;
export const fmtTs = (s) => (s ? String(s).replace('T', ' ').slice(0, 16) : '—');
export const fmtDay = (s) => (s ? String(s).slice(0, 10) : '—');

export const badge = (bucket, text) => h('span', { class: `badge b-${bucket}` }, text || BUCKET_NAME[bucket] || bucket);
export const pill = (text, kind = 'neutral') => h('span', { class: `badge b-${kind}` }, text);

/** 부서별/전체 스택 막대 */
export function stackBar(counts, total) {
  const t = total || BUCKETS.reduce((s, b) => s + (counts[b] || 0), 0) || 1;
  return h('div', { class: 'bar', role: 'img', 'aria-label': BUCKETS.map((b) => `${BUCKET_NAME[b]} ${counts[b] || 0}`).join(', ') },
    BUCKETS.map((b) => (counts[b] ? h('span', { class: `s-${b}`, style: `width:${(counts[b] / t) * 100}%`, title: `${BUCKET_NAME[b]} ${counts[b]}` }) : null)));
}
export function legend() {
  const colors = { approved: 'var(--approved)', review: 'var(--review)', unconfirmed: 'var(--unconfirmed)', in_progress: 'var(--in_progress)', reserve: 'var(--reserve)' };
  return h('div', { class: 'legend' }, BUCKETS.map((b) => h('span', null, h('i', { style: `background:${colors[b]}` }), BUCKET_NAME[b])));
}

export function table(cols, rows, opts = {}) {
  const head = h('tr', null, cols.map((c, i) => h('th', { class: opts.num && opts.num.includes(i) ? 'num' : '' }, c)));
  const body = rows.map((r) => {
    const cells = Array.isArray(r) ? r : r.cells;
    const tr = h('tr', { class: [r.cls, r.onclick ? 'clickable' : ''].filter(Boolean).join(' '), onclick: r.onclick, tabindex: r.onclick ? '0' : null, onkeydown: r.onclick ? (e) => { if (e.key === 'Enter') r.onclick(); } : null },
      cells.map((c, i) => h('td', { class: opts.num && opts.num.includes(i) ? 'num' : '' }, c)));
    return tr;
  });
  return h('div', { class: 'tablewrap' }, h('table', null, h('thead', null, head), h('tbody', null, body)));
}

export function card(title, ...kids) { return h('section', { class: 'card' }, title ? h('h2', null, title) : null, ...kids); }
export const note = (t, kind = '') => h('p', { class: `note ${kind}` }, t);
export const callout = (kind, ...kids) => h('div', { class: `callout ${kind || ''}` }, ...kids);
export const small = (t) => h('span', { class: 'muted small' }, t);

/** 세 계산 확인식 한 줄 */
export function equation(id) {
  const ok = id.residual === 0;
  const parts = [h('span', { class: 'term' }, id.lhs.label, ' ', h('b', null, n(id.lhs.value))), '=' ];
  id.rhs.forEach((t, i) => { if (i) parts.push('+'); parts.push(h('span', { class: 'term' }, t.label, ' ', h('b', null, n(t.value)))); });
  parts.push(h('span', { class: `resid ${ok ? 'ok' : 'bad'}` }, ok ? '잔차 0 ✓ 일치' : `잔차 ${id.residual} ✗ 불일치`));
  return h('div', { class: 'eq' }, parts);
}

export function kpi(label, value, cls = '', sub = '') {
  return h('div', { class: `kpi ${cls}` }, h('div', { class: 'v' }, n(value)), h('div', { class: 'l' }, label), sub ? h('div', { class: 'd' }, sub) : null);
}

export function tabs(items, active, onChange) {
  return h('div', { class: 'tabs', role: 'tablist' }, items.map((it) => h('button', { role: 'tab', 'aria-selected': String(it.key === active), onclick: () => onChange(it.key) }, it.label)));
}

let toastTimer = null;
export function toast(msg, kind = '') {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = h('div', { class: `toast ${kind}`, role: 'status' }, msg);
  document.body.append(t);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), kind === 'err' ? 6500 : 3200);
}

export function drawer(title, body, onClose) {
  const close = () => { scrim.remove(); dr.remove(); document.removeEventListener('keydown', esc); if (onClose) onClose(); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  const scrim = h('div', { class: 'scrim', onclick: close });
  const dr = h('aside', { class: 'drawer', role: 'dialog', 'aria-label': title }, h('div', { class: 'row sb' }, h('h2', null, title), h('button', { class: 'btn ghost sm', onclick: close, 'aria-label': '닫기' }, '닫기 ✕')), body);
  document.body.append(scrim, dr); document.addEventListener('keydown', esc);
  dr.querySelector('button')?.focus();
  return { close, body: dr };
}

export function confirmBox(msg) { return window.confirm(msg); }

/** 폼 입력: 라벨 + 입력 요소. 값은 getter 로 읽는다. */
export function field(label, el, hint, required) {
  const id = `f${Math.random().toString(36).slice(2, 9)}`;
  el.id = id;
  return h('div', null, h('label', { for: id, class: required ? 'req' : '' }, label), el, hint ? h('div', { class: 'tiny muted' }, hint) : null);
}
export const input = (type = 'text', value = '', attrs = {}) => h('input', { type, value, ...attrs });
export const textarea = (value = '', attrs = {}) => h('textarea', { ...attrs }, value);
export function select(options, value, attrs = {}) {
  return h('select', attrs, options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return h('option', { value: v, selected: v === value }, l); }));
}

/** 실행 작업 버튼: 진행 중 중복 클릭 방지 + 오류 토스트 */
export function actionBtn(label, fn, opts = {}) {
  const b = h('button', { class: `btn ${opts.cls || ''}`, title: opts.title }, label);
  b.addEventListener('click', async () => {
    if (opts.confirm && !window.confirm(opts.confirm)) return;
    b.disabled = true;
    try { await fn(); } catch (e) { toast(e.message || '실패했습니다.', 'err'); } finally { b.disabled = false; }
  });
  return b;
}

/** 간단한 SVG 막대(부서별 요구 vs 준비) */
export function groupBars(groups, key = 'approved') {
  const tot = (g) => Math.max(g.required, g.input || 0, g[key] || 0);
  const max = Math.max(...groups.map(tot), 1);
  return h('div', null, groups.map((g) => {
    const gap = g.required - g[key];
    return h('div', { style: 'margin:8px 0' },
      h('div', { class: 'row sb small' }, h('b', null, g.name), h('span', { class: 'muted' }, `요구 ${g.required} · 준비 ${g[key]} · ${gap >= 0 ? `부족 ${gap}` : `초과 ${-gap}`}`)),
      h('div', { style: `width:${(tot(g) / max) * 100}%` }, stackBar(g, tot(g))));
  }));
}

export const roleName = (meta, role, adapter) => (adapter && adapter.role_labels && adapter.role_labels[role]) || (meta.roles[role] && meta.roles[role].label) || role;
