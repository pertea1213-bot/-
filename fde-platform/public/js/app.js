import { h, clear, toast, select, field, input, n } from './ui.js';
import * as api from './api.js';

import * as course from './views/course.js';
import * as template from './views/template.js';
import * as dash from './views/dash.js';
import * as items from './views/items.js';
import * as process from './views/process.js';
import * as analysis from './views/analysis.js';
import * as hyp from './views/hyp.js';
import * as action from './views/action.js';
import * as trial from './views/trial.js';
import * as forms from './views/forms.js';
import * as ontology from './views/ontology.js';
import * as tests from './views/tests.js';
import * as learn from './views/learn.js';

const NAV = [
  { group: '학습', items: [
    ['course', '과정 안내', course.render], ['concepts', '온톨로지·FDE 개념', course.renderConcepts], ['template', '범용 템플릿·업종 어댑터', template.render],
  ] },
  { group: '사례 컨설팅', case: true, items: [
    ['dash', '과업 현황', dash.render, true], ['items', '대상·근거', items.render, true], ['process', '현장 컨설팅 9단계', process.render, true], ['analysis', '수량 확인·분석', analysis.render, true],
    ['hyp', '원인 후보', hyp.render, true], ['action', '조치·승인·외부 연계', action.render, true], ['trial', '현장 시험·보고', trial.render, true], ['forms', '현장 서식 6종', forms.render, true],
  ] },
  { group: '구현·시험', items: [
    ['ontology', '업무 구조도(온톨로지)', ontology.render, true], ['tech', '기술 설계 1~8단계', ontology.renderTech, true], ['tests', '시스템 시험', tests.render], ['audit', '처리 기록', tests.renderAudit, true],
  ] },
  { group: '실습·평가', items: [
    ['practice', '컨설팅 실습 21', learn.renderPractice, true], ['quiz', '확인 문제', learn.renderQuiz], ['wrap', '점검표·FAQ·루브릭', learn.renderWrap, true],
  ] },
];
const ROUTES = Object.fromEntries(NAV.flatMap((g) => g.items.map(([key, label, fn, needsCase]) => [key, { label, fn, needsCase: !!needsCase }])));

export const S = {
  user: null, meta: null, engs: [], engId: null, _cache: new Map(), navOpen: false,
  eng() { return this.engs.find((e) => e.id === this.engId) || null; },
  /** 과업 상세(스냅샷·기준선·품질·보호 지표). 변경 후 invalidate() */
  async load(force = false) {
    const k = `case:${this.engId}`;
    if (force || !this._cache.has(k)) this._cache.set(k, await api.get(`/engagements/${this.engId}`));
    return this._cache.get(k);
  },
  invalidate() { this._cache.clear(); },
  async content(name) {
    const k = `content:${name}`;
    if (!this._cache.has(k)) this._cache.set(k, await api.get(`/content/${name}`));
    return this._cache.get(k);
  },
  role() { return this.user && this.user.role; },
  can(...roles) { return roles.includes(this.role()); },
  async refreshList() { this.engs = await api.get('/engagements'); if (!this.engs.find((e) => e.id === this.engId)) this.engId = this.engs[0] ? this.engs[0].id : null; },
};
export const go = (route) => { location.hash = `#/${route}`; };
export const rerender = () => draw();

function savePref(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* 선택 저장 실패는 무시 */ } }
function readPref(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }

const app = document.getElementById('app');

async function boot() {
  window.addEventListener('hashchange', () => { S.navOpen = false; draw(); });
  window.addEventListener('auth-lost', () => { api.setToken(null); S.user = null; S.invalidate(); renderLogin('세션이 만료되었습니다. 다시 로그인하세요.'); });
  if (api.hasToken()) {
    try {
      S.user = await api.get('/auth/me');
      await afterLogin();
      return draw();
    } catch (_) { api.setToken(null); }
  }
  renderLogin();
}

async function afterLogin() {
  S.meta = await api.get('/meta');
  await S.refreshList();
  const saved = Number(readPref('fde_eng'));
  if (S.engs.find((e) => e.id === saved)) S.engId = saved;
}

async function renderLogin(msg) {
  clear(app);
  let demo = { users: [], password_hint: null, note: '' };
  try { demo = await api.get('/auth/demo'); } catch (_) { /* 서버 미연결 */ }
  const u = input('text', demo.users[0] ? demo.users[0].username : '', { autocomplete: 'username' });
  const p = input('password', demo.password_hint || '', { autocomplete: 'current-password' });
  const err = h('div', { class: 'note danger', role: 'alert' }, msg || '');
  const pick = h('div', { class: 'userpick' }, demo.users.map((x) => h('button', { type: 'button', 'aria-pressed': 'false', onclick: (e) => { u.value = x.username; pick.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', 'false')); e.currentTarget.setAttribute('aria-pressed', 'true'); } }, `${x.role_label} · ${x.username}`)));
  const submit = async (e) => {
    e.preventDefault(); err.textContent = '';
    try {
      const r = await api.post('/auth/login', { username: u.value.trim(), password: p.value });
      api.setToken(r.token); S.user = await api.get('/auth/me'); await afterLogin(); draw();
    } catch (ex) { err.textContent = ex.message; }
  };
  app.append(h('div', { class: 'login' },
    h('div', { class: 'hero', style: 'padding:20px 22px' }, h('h1', null, '온톨로지·FDE 플랫폼'), h('div', null, '업무 구조도로 연결하고, 현장에서 실행하다'),
      h('div', { class: 'nums' }, [['45', '요구'], ['40', '입사'], ['28', '준비']].map(([a, b]) => h('div', null, h('b', null, a), h('span', null, b))))),
    h('form', { class: 'card', onsubmit: submit },
      h('h2', null, '로그인'),
      h('p', { class: 'small muted' }, '역할마다 할 수 있는 실행 작업이 다릅니다. 같은 사례를 여러 역할로 체험해 보세요.'),
      field('역할 선택(데모 계정)', pick), field('아이디', u, null, true), field('비밀번호', p, demo.password_hint ? `개발 모드 데모 비밀번호: ${demo.password_hint}` : demo.note, true),
      err, h('div', { style: 'margin-top:12px' }, h('button', { class: 'btn', type: 'submit' }, '로그인')),
      h('p', { class: 'note' }, '사례의 회사·사람·수량·비용·기간은 교육을 위해 만든 가상 자료이며 실제 기업의 실행·성과나 검토 완료를 뜻하지 않습니다.'))));
}

function logout() { api.setToken(null); S.user = null; S.invalidate(); renderLogin(); }

function currentRoute() {
  const m = location.hash.match(/^#\/([a-z]+)/);
  return m && ROUTES[m[1]] ? m[1] : 'course';
}

async function draw() {
  if (!S.user) return;
  const route = currentRoute(); const R = ROUTES[route];
  clear(app);
  const roleLabel = (S.meta.roles[S.user.role] || {}).label || S.user.role;
  const nav = h('nav', { class: 'nav', 'aria-label': '주 메뉴' }, NAV.map((g) => h('div', null, h('h6', null, g.group),
    g.items.map(([key, label]) => h('a', { href: `#/${key}`, 'aria-current': key === route ? 'page' : null }, label)))));
  const side = h('aside', { class: `side ${S.navOpen ? 'open' : ''}` },
    h('div', { class: 'brand' }, h('span', { class: 'logo', 'aria-hidden': 'true' }, '◎'), h('div', null, '온톨로지·FDE', h('small', null, '업무 구조도 · 현장 실행 · 교육'))), nav,
    h('p', { class: 'tiny muted', style: 'padding:14px 8px 0' }, '모든 사업장·인원·수치는 교육용 가상 자료입니다.'));
  const sel = select(S.engs.map((e) => [String(e.id), `${e.request_code} / ${e.task_code} · ${e.title.slice(0, 26)}`]), String(S.engId), { 'aria-label': '사례 선택', style: 'max-width:340px' });
  sel.addEventListener('change', () => { S.engId = Number(sel.value); savePref('fde_eng', S.engId); S.invalidate(); draw(); });
  const top = h('header', { class: 'topbar' },
    h('button', { class: 'btn ghost menu-btn sm', 'aria-label': '메뉴 열기', onclick: () => { S.navOpen = !S.navOpen; side.classList.toggle('open', S.navOpen); } }, '☰'),
    h('strong', null, R.label), h('span', { class: 'grow' }),
    R.needsCase || NAV.find((g) => g.case && g.items.some((i) => i[0] === route)) ? h('label', { class: 'row small', style: 'margin:0;font-weight:400' }, '사례', sel) : null,
    h('span', { class: 'badge b-neutral', title: S.meta.roles[S.user.role].desc }, `${roleLabel} · ${S.user.username}`),
    h('button', { class: 'btn ghost sm', onclick: logout }, '로그아웃'));
  const main = h('main', { class: 'main', id: 'main' }, top, h('div', { class: 'content' }, h('p', { class: 'muted' }, '불러오는 중…')));
  app.append(h('div', { class: 'shell' }, side, main));
  const holder = main.querySelector('.content');
  try {
    const node = await R.fn({ S, go, rerender, h });
    clear(holder); holder.append(node);
    window.scrollTo(0, 0);
  } catch (e) {
    clear(holder);
    holder.append(h('div', { class: 'callout danger' }, h('b', null, '화면을 불러오지 못했습니다. '), e.message || String(e)));
    console.error(e);
  }
}

boot();
