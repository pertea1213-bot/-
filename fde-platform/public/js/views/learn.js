import { h, card, table, note, callout, pill, clear, field, input, select, textarea, actionBtn, toast, tabs, fmtTs } from '../ui.js';
import * as api from '../api.js';

const FLOW = [['q', '현장 질문'], ['e', '근거 자료'], ['c', '계산·판단'], ['a', '다른 가능성 확인'], ['r', '행동·책임'], ['d', '완료 기준']];
const LINK = { 1: ['process', '9단계 · 진술↔기록'], 2: ['process', '자료 사전'], 3: ['analysis', '기간 행 합계'], 4: ['action', '조치·승인'], 5: ['trial', '전후 비교'], 6: ['forms', '서식 6종'], 7: ['analysis', '상태 이동'], 8: ['ontology', '역할별 동선'], 9: ['template', '업종 이식'], 10: ['analysis', '기간 행 합계'], 11: ['items', '근거 타임라인'], 12: ['tech', '변환 대조표'], 13: ['tech', '지표 정의서'], 14: ['action', '시뮬레이션'], 15: ['trial', '일별 마감'], 16: ['trial', '최종 보고서'], 17: ['tech', '요구사항 7칸'], 18: ['process', '품질 5축'], 19: ['tests', '인계·시험'], 20: ['wrap', '루브릭'], 21: ['wrap', '한 장 점검표'] };

export async function renderPractice({ S, go }) {
  const P = await S.content('practices'); const prog = await api.get('/learn/progress');
  const byNo = Object.fromEntries(prog.practices.map((p) => [p.practice_no, p]));
  const R = (await S.content('extras')).rubric;
  let cur = Number((location.hash.match(/no=(\d+)/) || [])[1]) || 1;
  const holder = h('div'); const detail = h('div');
  const ST = { todo: ['미착수', 'neutral'], doing: ['작성 중', 'neutral'], done: ['완료', 'ok'] };
  const list = () => h('div', { class: 'card' }, h('div', { class: 'row sb' }, h('h3', { style: 'margin:0' }, `컨설팅 실습 ${P.practices.length}개`), pill(`${prog.practices.filter((p) => p.status === 'done').length}/21 완료`, 'ok')),
    h('div', { class: 'steps', style: 'grid-template-columns:repeat(7,1fr);margin-top:10px' }, P.practices.map((p) => { const st = (byNo[p.no] || {}).status || 'todo'; return h('button', { 'aria-current': p.no === cur ? 'step' : null, title: p.title, style: st === 'done' ? 'border-color:var(--ok)' : '', onclick: () => { cur = p.no; mount(); } }, h('b', null, p.no), ST[st][0]); })));
  function mount() {
    clear(holder);
    holder.append(h('h1', null, '컨설팅 실습 21'), callout('', '한 과업을 같은 21개 순서로 반복합니다. 각 실습에서 ', h('b', null, FLOW.map((x) => x[1]).join(' → ')), '를 제출하고, 정답 숫자만 맞춘 제출물은 통과시키지 않습니다.'), list(), detail);
    drawDetail();
  }
  function drawDetail() {
    clear(detail);
    const p = P.practices.find((x) => x.no === cur); const mine = byNo[cur] || {}; let saved = {}; try { saved = JSON.parse(mine.response || '{}') || {}; } catch (_) { saved = { q: mine.response || '' }; }
    const els = Object.fromEntries(FLOW.map(([k, l]) => [k, textarea(saved[k] || '', { rows: '2', 'aria-label': l })]));
    const rub = mine.rubric || {}; const rsel = Object.fromEntries(R.rows.map((r) => [r.key, select([['', '(자가 평가)'], ['0', `미흡 — ${r.levels[0]}`], ['1', `충족 — ${r.levels[1]}`], ['2', `우수 — ${r.levels[2]}`]], rub[r.key] != null ? String(rub[r.key]) : '')]));
    const save = async (status) => { await api.put(`/learn/practice/${cur}`, { status, response: JSON.stringify(Object.fromEntries(FLOW.map(([k]) => [k, els[k].value]))), rubric: Object.fromEntries(Object.entries(rsel).filter(([, s]) => s.value !== '').map(([k, s]) => [k, Number(s.value)])) }); toast(status === 'done' ? '완료로 표시했습니다.' : '저장했습니다.'); const np = await api.get('/learn/progress'); prog.practices = np.practices; Object.keys(byNo).forEach((k) => delete byNo[k]); np.practices.forEach((x) => { byNo[x.practice_no] = x; }); mount(); };
    const [route, label] = LINK[cur] || ['dash', '현황'];
    detail.append(card(`실습 ${p.no} · ${p.title}`,
      h('div', { class: 'grid g2' },
        h('div', null, h('h4', null, '현장 적용 장면'), h('p', null, `인력 준비요청 H-701 / 입사·배치 확인 과업 HR-047에서 ${p.scene}`), h('h4', null, '작성 과제'), h('p', null, p.task), p.hypothesis ? callout('warn', h('b', null, '시험할 다른 가능성 확인 원인 후보: '), `“${p.hypothesis}”`) : null),
        h('div', null, h('h4', null, '계산과 검토'), h('p', { class: 'small' }, p.calc), h('h4', null, '다른 가능성과 완료 판단'), h('p', { class: 'small' }, p.done), callout('', h('b', null, '확인 기준: '), p.check))),
      note(`${P.common.unit_rule} ${P.common.privacy}`), note(P.common.closing),
      h('div', { class: 'row' }, h('button', { class: 'btn ghost sm', onclick: () => go(route) }, `플랫폼에서 해 보기: ${label} →`), (byNo[cur] ? pill(ST[byNo[cur].status][0], ST[byNo[cur].status][1]) : pill('미착수')))),
      card('내 제출 — 여섯 칸', FLOW.map(([k, l]) => field(l, els[k])), h('h4', { style: 'margin-top:12px' }, '루브릭 자가 평가'), h('div', { class: 'grid g3' }, R.rows.map((r) => field(r.name, rsel[r.key]))), note(R.note),
        h('div', { class: 'row' }, actionBtn('임시 저장', () => save('doing'), { cls: 'ghost' }), actionBtn('완료로 표시', () => save('done')), note('빈칸이 있는 실습은 완료로 표시되지 않습니다.'))),
      h('p', { class: 'tiny muted' }, P.common.source_note));
  }
  mount();
  return holder;
}

export async function renderQuiz({ S }) {
  const Q = await S.content('quiz'); const prog = await api.get('/learn/progress');
  let phase = prog.quiz.some((q) => q.phase === 'pre') ? 'post' : 'pre';
  const holder = h('div'); const body = h('div');
  const picks = Array(Q.questions.length).fill(null);
  function form() {
    clear(body);
    body.append(...Q.questions.map((q, qi) => card(`${q.id}. ${q.topic}`, h('p', null, q.q), ...q.options.map((o, oi) => h('label', { class: 'opt' }, h('input', { type: 'radio', name: `q${qi}`, onchange: () => { picks[qi] = oi; } }), o))),
    ), actionBtn(`${phase === 'pre' ? '사전' : '사후'} 확인 문제 제출`, async () => {
      if (picks.some((p) => p === null)) throw new Error('모든 문항에 답해 주세요.');
      const r = await api.post('/learn/quiz', { phase, answers: picks }); result(r);
    }));
  }
  function result(r) {
    clear(body);
    body.append(card(`${phase === 'pre' ? '사전' : '사후'} 결과: ${r.score} / ${r.total}`, callout(r.score === r.total ? '' : 'warn', r.score >= 10 ? '핵심을 잘 잡았습니다.' : r.score >= 7 ? '기본은 갖췄습니다. 틀린 문항의 해설을 확인하세요.' : '모듈 A→C를 먼저 보세요. 틀린 문항의 해설이 출발점입니다.')),
      ...r.results.map((x, i) => { const q = Q.questions[i]; return card(`${q.id}. ${q.topic} ${x.correct ? '✓' : '✗'}`, h('p', null, q.q), ...q.options.map((o, oi) => h('div', { class: `opt ${oi === x.answer ? 'right' : oi === x.picked ? 'wrong' : ''}` }, `${oi === x.answer ? '✓ ' : oi === x.picked ? '✗ ' : ''}${o}`)), note(x.explain)); }),
      h('button', { class: 'btn ghost', onclick: () => { picks.fill(null); form(); } }, '다시 풀기'));
  }
  const mount = () => { clear(holder); holder.append(h('h1', null, '확인 문제'), callout('', Q.note), h('div', { class: 'row', style: 'margin-bottom:12px' }, ['pre', 'post'].map((p) => h('button', { class: `btn ${phase === p ? '' : 'ghost'}`, onclick: () => { phase = p; picks.fill(null); mount(); } }, p === 'pre' ? '사전' : '사후')), h('span', { class: 'small muted' }, prog.quiz.length ? `내 기록: ${prog.quiz.slice(0, 4).map((q) => `${q.phase === 'pre' ? '사전' : '사후'} ${q.score}/${q.total}`).join(' · ')}` : '아직 응시 기록이 없습니다.')), body); form(); };
  mount();
  let ov = null; if (S.can('admin', 'consultant')) { const rows = await api.get('/learn/overview'); ov = card('교육생 현황 (강사·컨설턴트)', table(['교육생', '실습 완료', '사전', '사후', '향상'], rows.map((r) => [r.display_name, `${r.practices_done}/21`, r.pre ? `${r.pre.score}/${r.pre.total}` : '—', r.post ? `${r.post.score}/${r.post.total}` : '—', r.pre && r.post ? `${r.post.score - r.pre.score >= 0 ? '+' : ''}${r.post.score - r.pre.score}` : '—']))); }
  return h('div', null, holder, ov);
}

export async function renderWrap({ S, go }) {
  const E = await S.content('extras'); const C = await S.content('course'); const prog = await api.get('/learn/progress');
  const eid = S.engId; const chk = new Set(prog.checklist.filter((c) => c.engagement_id === eid && c.checked).map((c) => c.item_key));
  const total = E.checklist.length; const cnt = h('span', { class: 'badge b-neutral' }, `${chk.size}/${total}`);
  const phases = [...new Set(E.checklist.map((c) => c.phase))];
  let tab = 'check'; const holder = h('div'); const body = h('div');
  const T = [{ key: 'check', label: '한 장 점검표' }, { key: 'mistakes', label: '자주 하는 실수 10' }, { key: 'faq', label: 'FAQ·참고자료' }, { key: 'rubric', label: '루브릭·실습 평가' }, { key: 'notes', label: '자료 정합성 메모' }];
  const views = {
    check: () => card('현장에 들고 가는 한 장 점검표', h('div', { class: 'row sb' }, h('span', { class: 'small muted' }, '사례별로 저장됩니다.'), cnt), h('div', { class: 'grid g3' }, phases.map((ph) => h('div', null, h('h3', null, ph), E.checklist.filter((c) => c.phase === ph).map((c) => h('label', { class: 'check', style: 'font-weight:400;margin:0' }, h('input', { type: 'checkbox', checked: chk.has(c.key), onchange: async (e) => { try { await api.put('/learn/checklist', { engagement_id: eid, item_key: c.key, checked: e.target.checked }); e.target.checked ? chk.add(c.key) : chk.delete(c.key); cnt.textContent = `${chk.size}/${total}`; } catch (x) { toast(x.message, 'err'); e.target.checked = !e.target.checked; } } }), c.text))))), callout('warn', E.checklist_rule)),
    mistakes: () => card('자주 하는 실수 10가지', h('div', { class: 'grid g2' }, E.mistakes.map((m, i) => h('div', { class: 'callout warn', style: 'margin:0' }, h('b', null, `${i + 1}. ${m.name}`), h('div', { class: 'small' }, m.desc)))), note('열 가지는 원문의 현장 확인·반례·시험 문구를 강사가 요약했다.')),
    faq: () => h('div', null, card('경영지도사가 자주 묻는 질문', table(['질문', '답'], E.faq.map((f) => [f.q, f.a]))), card('과정 핵심 5가지', h('ol', null, C.five_points.map((x) => h('li', null, x)))), card('토론 질문', h('ul', null, C.discussion.map((x) => h('li', null, x)))), card('참고자료와 공개 근거', table(['자료', '주소·키워드', '용도'], E.references.map((r) => [r.name, r.url, r.use])), note(E.references_note)), card(C.closing.headline, h('p', null, h('b', null, C.closing.flow)), h('p', { class: 'muted' }, C.closing.tail))),
    rubric: () => h('div', null, card('평가 루브릭', table(E.rubric.cols, E.rubric.rows.map((r) => [h('b', null, r.name), ...r.levels])), note(E.rubric.note)), card('실습: 한 과업을 직접 같은 결과 확인해 보기', h('ol', null, E.hands_on.map((x) => h('li', null, x))), note('정답 숫자만 맞춘 제출물은 통과시키지 않는다.', 'warn'))),
    notes: () => card('자료 정합성 메모 — 교안·원문·데이터에서 발견한 것', table(['구분', '항목', '내용'], E.source_notes.map((x) => [pill(x.kind), h('b', null, x.title), x.text])), note(E.canonical_scheme.disclaimer, 'warn')),
  };
  const mount = () => { clear(holder); holder.append(h('h1', null, '점검표·FAQ·루브릭'), tabs(T, tab, (k) => { tab = k; mount(); }), views[tab]()); };
  mount();
  return holder;
}
