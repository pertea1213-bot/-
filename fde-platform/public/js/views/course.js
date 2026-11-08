import { h, card, table, note, callout, pill, tabs, clear, field, textarea, input, actionBtn, toast } from '../ui.js';
import * as api from '../api.js';

export async function render({ S, go }) {
  const c = await S.content('course');
  const prog = await api.get('/learn/progress').catch(() => ({ practices: [], quiz: [] }));
  const done = prog.practices.filter((p) => p.status === 'done').length;
  const diag = c.prediagnostic.map(() => false);
  const diagOut = h('div', { class: 'callout' }, '체크하면 점수가 나옵니다.');
  const upd = () => { const y = diag.filter(Boolean).length; diagOut.textContent = `${y} / ${diag.length} — ${y >= 7 ? '단단합니다. 모듈 D·E에서 더 깊이.' : y >= 4 ? '기본기는 있습니다. 모듈 C의 계산·승인 흐름을 중점적으로.' : '모듈 A→C 순서로 차근차근 시작하세요.'}`; };
  return h('div', null,
    h('section', { class: 'hero' }, h('div', { class: 'small', style: 'opacity:.85' }, c.audience), h('h1', null, c.title), h('div', null, c.tagline),
      h('div', { class: 'nums' }, c.hook.numbers.map((x) => h('div', null, h('b', null, x.n), h('span', null, x.label)))),
      h('div', { style: 'margin-top:12px;font-weight:600' }, c.hook.headline)),
    h('div', { class: 'grid g2' },
      card('교육 개요', h('p', null, h('b', null, '목표: '), c.goal), h('p', null, h('b', null, '과정 산출물: '), c.outputs.join(' · ')), note(c.schedule_note)),
      card('내 진행 현황', h('div', { class: 'row' }, pill(`실습 ${done}/21 완료`, done === 21 ? 'ok' : 'neutral'),
        ...['pre', 'post'].map((ph) => { const q = prog.quiz.find((x) => x.phase === ph); return pill(`${ph === 'pre' ? '사전' : '사후'} ${q ? `${q.score}/${q.total}` : '미응시'}`, q ? 'ok' : 'neutral'); })),
        h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'btn', onclick: () => go('dash') }, '사례로 바로 시작 →'), h('button', { class: 'btn ghost', onclick: () => go('quiz') }, '사전 확인 문제'), h('button', { class: 'btn ghost', onclick: () => go('practice') }, '실습 21'))))
    ,
    card('마치면 할 수 있는 8가지', h('div', { class: 'grid g4' }, c.outcomes.map((o, i) => h('div', { class: 'callout', style: 'margin:0' }, h('b', null, `${i + 1}. ${o.title}`), h('div', { class: 'small' }, o.desc))))),
    card(`모듈 구조 — 총 ${c.total_hours}시간 (2일 과정 표준안)`, h('div', { class: 'grid g3' }, c.modules.map((m) => h('div', { class: 'card', style: 'margin:0;box-shadow:none' },
      h('div', { class: 'row sb' }, h('h3', { style: 'margin:0' }, `${m.key} · ${m.name}`), pill(`${m.hours}h`)), h('p', { class: 'small muted' }, m.summary),
      h('ul', { class: 'small', style: 'padding-left:18px;margin:6px 0' }, m.topics.map((t) => h('li', null, t)))))), note(c.total_note)),
    card('표준 시간표(안)', table(['일차', '시간', '내용', '방식'], c.timetable.map((r) => [r.day, r.time, r.content, r.mode])), note('시간표는 강사 설계 예시이며 실제 교육 일정은 추후 안내됩니다.')),
    card('3층 템플릿 구조 — 이 플랫폼이 코드로 구현한 구조', h('div', { class: 'grid g3' }, c.three_layers.map((l) => h('div', { class: 'callout', style: 'margin:0' }, h('b', null, `${['①', '②', '③'][l.n - 1]} ${l.name}`), h('div', { class: 'small' }, l.desc), h('div', { class: 'tiny muted', style: 'margin-top:6px' }, `바꾸는 빈도: ${l.freq}`), h('div', { class: 'tiny', style: 'margin-top:2px' }, `플랫폼: ${l.in_platform}`)))), note('바꾸는 빈도: ③ 매 과업 → ② 업종마다 한 번 → ① 거의 바꾸지 않는다')),
    card('사전 진단: 내 컨설팅은 얼마나 단단한가', c.prediagnostic.map((d, i) => h('label', { class: 'check', style: 'font-weight:400;margin:0' }, h('input', { type: 'checkbox', onchange: (e) => { diag[i] = e.target.checked; upd(); } }), h('span', null, d.q, ' ', h('span', { class: 'tiny muted' }, `(모듈 ${d.module})`)))), diagOut),
    card('읽는 법', h('ul', { class: 'small' }, c.reading_rules.map((r) => h('li', null, r))), h('div', { class: 'row' }, c.legend.map((l) => h('span', { class: `badge b-${l.color}` }, l.label)))));
}

export async function renderConcepts({ S }) {
  const c = await S.content('concepts');
  let tab = 'why';
  const holder = h('div');
  const T = [{ key: 'why', label: '왜 배우나' }, { key: 'ontology', label: '온톨로지(업무 구조도)' }, { key: 'fde', label: 'FDE' }, { key: 'words', label: '쉬운 말 사전' }, { key: 'src', label: '출처·검증 상태' }];
  const draw = () => {
    clear(holder);
    holder.append(tabs(T, tab, (k) => { tab = k; draw(); }));
    holder.append(tab === 'why' ? why() : tab === 'ontology' ? onto() : tab === 'fde' ? fde() : tab === 'words' ? words() : src());
  };
  const why = () => h('div', null,
    callout('', c.intro),
    h('div', { class: 'grid g2' },
      card('경영지도사가 온톨로지를 배워야 하는 이유', c.why_ontology.map((x) => h('p', null, h('b', null, x.title), h('br'), x.desc)), note(c.why_ontology_note, 'warn')),
      card('경영지도사가 FDE 방식을 배워야 하는 이유', h('div', { class: 'pipeline' }, c.why_fde.map((x) => h('div', { class: `step ${x.n === 3 ? 'on' : ''}` }, h('b', null, `${x.n} ${x.name}`), x.desc))), c.why_fde_points.map((x) => h('p', { style: 'margin-top:10px' }, h('b', null, x.title), h('br'), x.desc)), note(c.why_fde_note, 'warn'))),
    card('세 가지 신호(정황 근거)', h('div', { class: 'grid g3' }, c.signals.map((s) => h('div', { class: 'callout', style: 'margin:0' }, h('b', null, s.title), h('div', { class: 'small' }, s.desc)))), note(c.signals_note, 'warn')));
  const onto = () => h('div', null,
    callout('', c.ontology_def),
    card('온톨로지의 세 요소', h('div', { class: 'grid g3' }, c.triad.map((t) => h('div', { class: 'callout', style: 'margin:0' }, h('b', null, `${t.ko} (${t.key})`), h('div', { class: 'small' }, t.desc), h('div', { class: 'tiny muted', style: 'margin-top:6px' }, `사례: ${t.example}`))))),
    card('노드와 엣지로 된 그래프', graph(c.graph), note(c.graph.note)),
    h('div', { class: 'grid g2' },
      card('단일 작업 단계 vs 연결된 경로', h('h4', null, '단일 단계만 볼 때'), h('ul', { class: 'small' }, c.single_vs_path.single.map((x) => h('li', null, x))), h('h4', null, '관계로 연결했을 때'), h('ul', { class: 'small' }, c.single_vs_path.path.map((x) => h('li', null, x))), h('div', { class: 'pipeline' }, c.single_vs_path.case_path.map((x, i) => h('div', { class: 'step' }, h('b', null, `${i + 1}`), x)))),
      card('운영 루프: 온톨로지 × AI 에이전트 × FDE', h('div', { class: 'pipeline' }, c.loop.steps.map((x, i) => h('div', { class: 'step' }, h('b', null, `${i + 1}`), x))), note(c.loop.fde_role), callout('warn', h('b', null, c.loop.rule)))),
    h('div', { class: 'grid g2' },
      card('그래프가 해 주는 것', h('ul', { class: 'small' }, c.does.map((x) => h('li', null, '✓ ', x)))),
      card('그래프가 해 주지 않는 것', h('ul', { class: 'small' }, c.does_not.map((x) => h('li', null, '✗ ', x))))),
    card('엑셀 · 관계형 DB · 온톨로지', table(c.compare.cols, c.compare.rows), note(c.compare.note)),
    card('온톨로지의 구성요소 6가지', h('div', { class: 'grid g3' }, c.six_components.map((x) => h('div', { class: 'callout', style: 'margin:0' }, h('b', null, x.name), h('div', { class: 'small muted' }, x.ex)))), note(c.six_components_note)),
    card('오해 5가지와 사실', table(['흔한 오해', '사실'], c.misconceptions.map((m) => [m.myth, m.fact]))));
  const fde = () => h('div', null,
    callout('', c.fde_def),
    h('div', { class: 'grid g3' }, c.fde_points.map((p) => card(p.title, p.desc))), note(c.fde_note, 'warn'),
    card('같은 직함, 다른 업무: FDE의 다섯 유형', table(['유형', '특징', '글에서 든 예'], c.fde_types), note(c.fde_types_note)),
    card('컨설턴트 · 솔루션 아키텍트 · FDE 비교', table(c.roles_compare.cols, c.roles_compare.rows), note(c.roles_compare.note)),
    card('3자 협업 모델 — 이 플랫폼의 권한 설계의 근거', h('div', { class: 'grid g3' }, c.triangle.map((t) => h('div', { class: 'callout', style: 'margin:0' }, h('b', null, t.role), h('div', { class: 'small' }, t.who), h('div', { class: 'small' }, `하는 일: ${t.does}`), h('div', { class: 'tiny muted' }, `흐름: ${t.arrow}`)))), callout('warn', h('b', null, '원칙: '), c.triangle_principle)),
    card('번역: 현장 한 문장을 요구사항 7칸으로', h('p', null, '현장 문장: ', h('b', null, `“${c.translation.sentence}”`)), table(['칸', '예시'], c.translation.cells.map((x) => [x.cell, x.example])), note(c.translation.note)),
    card('공개 사례로 배우는 적용 원리', h('ul', null, c.public_cases.items.map((x) => h('li', null, h('b', null, x.name), ' — ', x.desc))), note(c.public_cases.note, 'warn')));
  const words = () => card('쉬운 말 사전 (전문용어 → 이 교안에서 주로 쓰는 말)', table(['전문용어', '이 장에서 주로 쓰는 말', '뜻'], c.glossary.map((g) => [g.tech, h('b', null, g.easy), g.mean])));
  const src = () => card('출처와 검증 상태', table(['출처', '용도', '검증 상태'], c.sources.map((s) => [s.name, s.use, s.status])), note('검증 상태는 이 교안 작성 시점 기준이다. 미대조 출처는 강의 전에 원문을 확인한다.', 'warn'));
  draw();
  return holder;
}

function graph(g) {
  const W = 640, H = 190; const NS = 'http://www.w3.org/2000/svg';
  const el = (t, a, ...k) => { const e = document.createElementNS(NS, t); for (const [x, y] of Object.entries(a || {})) e.setAttribute(x, y); k.flat().forEach((c) => e.append(c instanceof Node ? c : document.createTextNode(String(c)))); return e; };
  const pos = { 고객: [70, 50], 주문: [250, 50], '승인 담당자': [440, 50], 재고: [250, 140], 설비: [440, 140] };
  const edges = [['고객', '주문', '생성'], ['주문', '승인 담당자', '승인 요청'], ['주문', '재고', '소요'], ['재고', '설비', '배정']];
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': '고객→주문→승인 담당자, 주문→재고→설비 그래프', class: 'graph' },
    el('defs', {}, el('marker', { id: 'arr', viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' }, el('path', { d: 'M0 0L10 5L0 10z', fill: 'currentColor' }))));
  for (const [a, b, l] of edges) {
    const [x1, y1] = pos[a], [x2, y2] = pos[b];
    const dx = x2 - x1, dy = y2 - y1; const len = Math.hypot(dx, dy) || 1;
    svg.append(el('line', { x1: x1 + (dx / len) * 52, y1: y1 + (dy / len) * 18, x2: x2 - (dx / len) * 52, y2: y2 - (dy / len) * 18, class: 'edge', style: 'color:var(--ink-3)' }), el('text', { x: (x1 + x2) / 2 + (dy ? 8 : 0), y: (y1 + y2) / 2 - (dy ? 0 : 6), 'text-anchor': 'middle', style: 'font-size:11px;fill:var(--ink-3)' }, l));
  }
  for (const [k, [x, y]] of Object.entries(pos)) svg.append(el('rect', { x: x - 48, y: y - 18, width: 96, height: 36, rx: 8, class: 'node' }), el('text', { x, y: y + 4, 'text-anchor': 'middle' }, k));
  return svg;
}
