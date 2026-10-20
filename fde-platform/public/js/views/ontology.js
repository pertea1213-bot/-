import { h, card, table, note, callout, pill, clear, field, input, textarea, actionBtn, toast, tabs, roleName } from '../ui.js';
import * as api from '../api.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (t, a, ...k) => { const e = document.createElementNS(NS, t); for (const [x, y] of Object.entries(a || {})) e.setAttribute(x, y); k.flat().forEach((c) => e.append(c instanceof Node ? c : document.createTextNode(String(c)))); return e; };
const POS = { engagement: [90, 50], group: [330, 50], item: [330, 150], assignment: [90, 150], hold: [570, 150], evidence: [150, 255], hypothesis: [570, 255], intervention: [330, 360], approval: [90, 360], sync: [570, 360], audit: [330, 455] };
const LAYER = { task: 'var(--brand)', evidence: 'var(--in_progress)', judgement: 'var(--review)', action: 'var(--unconfirmed)', record: 'var(--reserve)' };

function diagram(o) {
  const svg = el('svg', { viewBox: '0 0 680 500', width: '100%', role: 'img', 'aria-label': '업무 항목과 연결 관계 그림', class: 'graph' },
    el('defs', {}, el('marker', { id: 'arr', viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' }, el('path', { d: 'M0 0L10 5L0 10z', fill: 'currentColor' }))));
  for (const l of o.links) {
    const [x1, y1] = POS[l.from], [x2, y2] = POS[l.to]; const dx = x2 - x1, dy = y2 - y1; const len = Math.hypot(dx, dy) || 1;
    const ax = Math.abs(dx) > Math.abs(dy) ? [Math.sign(dx) * 62, 0] : [0, Math.sign(dy) * 22]; const bx = Math.abs(dx) > Math.abs(dy) ? [-Math.sign(dx) * 62, 0] : [0, -Math.sign(dy) * 22];
    svg.append(el('line', { x1: x1 + ax[0], y1: y1 + ax[1], x2: x2 + bx[0], y2: y2 + bx[1], class: 'edge', style: `color:var(--ink-3)${l.temporal ? ';stroke-dasharray:5 3' : ''}` }),
      el('text', { x: (x1 + x2) / 2 + (dx === 0 ? 6 : 0), y: (y1 + y2) / 2 - (dx === 0 ? 0 : 5), 'text-anchor': dx === 0 ? 'start' : 'middle', style: 'font-size:10px;fill:var(--ink-3)' }, l.label));
  }
  for (const ob of o.objects) { const [x, y] = POS[ob.key];
    svg.append(el('rect', { x: x - 62, y: y - 22, width: 124, height: 44, rx: 9, class: 'node', style: `stroke:${LAYER[ob.layer]}` }), el('text', { x, y: y - 3, 'text-anchor': 'middle', style: 'font-weight:600' }, ob.label), el('text', { x, y: y + 13, 'text-anchor': 'middle', style: 'font-size:10px;fill:var(--ink-3)' }, `${ob.count}건${ob.append_only ? ' · 추가 전용' : ''}`)); }
  return svg;
}

export async function render({ S }) {
  if (!S.engId) return card('사례가 없습니다');
  const id = S.engId; const o = await api.get(`/engagements/${id}/ontology`); const tech = await S.content('tech'); const d = await S.load();
  let tab = 'map';
  const holder = h('div'); const body = h('div');
  const T = [{ key: 'map', label: '업무 항목·연결 관계' }, { key: 'actions', label: '실행 작업·권한' }, { key: 'layers', label: '5개 층' }, { key: 'roles', label: '역할·근거 자료' }];
  const views = {
    map: () => h('div', null,
      callout('', '대상을 먼저 정하고, 대상의 연결과 근거 자료를 남긴 뒤, 그 위에서 확인·승인 작업을 실행합니다. 현재 상태는 빠르게 확인하기 위한 요약이고, 과거 승인과 정정은 지울 수 없는 기록으로 남습니다.'),
      card('이 과업의 업무 구조도 (실제 건수)', diagram(o), h('div', { class: 'legend', style: 'margin-top:8px' }, [['과업·대상', 'task'], ['근거', 'evidence'], ['판단', 'judgement'], ['조치·연계', 'action'], ['기록', 'record']].map(([l, k]) => h('span', null, h('i', { style: `background:${LAYER[k]}` }), l)), h('span', null, '┄ 점선: 유효기간(시간)이 있는 관계')), note('고유 키와 관계의 유효기간을 반드시 저장한다. 근거(evidence)·결재(approvals)·처리 기록(audit)은 추가 전용이다.')),
      card('업무 항목(Object)', table(['업무 항목', '쉬운 말', '속성', '건수', '이력'], o.objects.map((x) => [h('b', null, x.label), x.easy, h('span', { class: 'mono tiny' }, x.props.join(', ')), x.count, x.append_only ? pill('추가 전용', 'ok') : '수정 가능']), { num: [3] })),
      card('연결 관계(Relationship)', table(['관계', '이름', '다중도', '유효기간'], o.links.map((l) => [`${label(o, l.from)} → ${label(o, l.to)}`, l.label, l.card, l.temporal ? '있음' : '—']))),
      card('불변 규칙', h('ol', null, o.rules.map((r) => h('li', null, r))))),
    actions: () => h('div', null,
      callout('warn', '제안은 플랫폼, 승인은 담당자, 실행은 업무 시스템. 권한 없는 실행 작업은 거부하고 처리 기록을 남깁니다.'),
      card('실행 작업(Action) — 누가 · 언제 · 무엇이 바뀌고 · 무엇은 안 되는가', table(['실행 작업', '실행 가능한 역할', '선행 조건', '결과', '하지 않는 것'], o.actions.map((a) => [h('div', null, h('b', null, a.label), h('div', { class: 'tiny mono muted' }, a.key)), a.roles, h('ul', { class: 'small', style: 'margin:0;padding-left:16px' }, a.pre.map((x) => h('li', null, x))), h('ul', { class: 'small', style: 'margin:0;padding-left:16px' }, a.post.map((x) => h('li', null, x))), h('span', { class: 'small' }, a.never.join(' · ') || '—')]))),
      card('역할별 화면 동선', table(tech.role_screens.cols, tech.role_screens.rows))),
    layers: () => h('div', null,
      card('시스템은 5개 층으로 나눈다', h('div', { class: 'pipeline', style: 'flex-direction:column' }, o.layers.map((l) => h('div', { class: 'step' }, h('b', null, `${['①', '②', '③', '④', '⑤'][l.n - 1]} ${l.name}`), l.desc, h('div', { class: 'tiny muted' }, `구현 위치: ${l.where}`)))), h('p', { style: 'margin-top:10px' }, h('b', null, '단골 사고 5가지: '), tech.common_incidents.join(' · ')), note('5층 구조와 단골 사고 5가지는 원문 ‘아키텍처 범위’다. 구현 설계 검토용 요구사항이며 실제 배포·구축 기록이 아니다.')),
      card('자료 형식 통일: 원천 → 후보 → 오류 예방', table(tech.normalize.cols, tech.normalize.rows))),
    roles: () => card('업무 항목 설계표: 역할 → 근거 자료 → 연결', table(tech.design_table.cols, tech.design_table.rows), note('이 플랫폼에서 근거를 확정할 수 있는 역할은 업종 어댑터가 정합니다:'),
      table(['요건', '근거 자료', '확정 책임자'], [[d.adapter.start_label + ' (착수)', '—', roleName(S.meta, d.adapter.start_owner, d.adapter)], ...d.adapter.requirements.map((r) => [r.label, r.source, roleName(S.meta, r.owner, d.adapter)])])),
  };
  const mount = () => { clear(holder); holder.append(h('div', { class: 'row sb' }, h('h1', null, '업무 구조도(온톨로지)'), h('span', { class: 'small muted' }, `${d.engagement.request_code} / ${d.engagement.task_code}`)), tabs(T, tab, (k) => { tab = k; mount(); }), views[tab]()); };
  mount();
  return holder;
}
const label = (o, k) => (o.objects.find((x) => x.key === k) || {}).label || k;

export async function renderTech({ S, go }) {
  const t = await S.content('tech'); const holder = h('div');
  const cells = t.requirement_cells; const vals = Object.fromEntries(cells.map((c) => [c, input('text', '')]));
  const out = h('pre', { class: 'mono small', style: 'white-space:pre-wrap;background:var(--surface-2);padding:10px;border-radius:8px' });
  const gen = () => { out.textContent = `# 요구사항 (FDE 시험 인계)\n${cells.map((c) => `- ${c}: ${vals[c].value || '(빈칸 — 완료로 표시하지 않음)'}`).join('\n')}`; };
  cells.forEach((c) => vals[c].addEventListener('input', gen)); gen();
  const where = { ontology: 'ontology', ingest: 'items', periods: 'analysis', gates: 'analysis', hypotheses: 'hyp', dashboard: 'dash', tests: 'tests' };
  holder.append(h('h1', null, '기술 설계 1~8단계'), callout('', t.intro),
    ...t.eight.map((s) => h('details', { class: 'card', open: s.no <= 1 }, h('summary', { style: 'cursor:pointer;font-weight:600' }, `기술 ${String(s.no).padStart(2, '0')} · ${s.name}`),
      h('div', { class: 'grid g2', style: 'margin-top:8px' }, h('div', null, callout('', h('b', null, '확인 기준: '), s.criterion), callout('warn', h('b', null, '설계 검토: '), s.review)), h('div', null, h('p', { class: 'small' }, s.impl), h('button', { class: 'btn ghost sm', onclick: () => go(where[s.where] || 'dash') }, '플랫폼에서 보기 →'))),
      note('근거 자료 누락과 후기 입력이 생길 때 임시 상태를 유지할 수 있는지, 사용자가 어떤 수치를 보고 실제 행동을 할지 함께 검토한다. 업무 항목 관계가 정확해도 업무 승인 조건이 틀리면 자동 실행 작업을 열지 않는다.'))),
    card('요구사항 번역: 현장 한 문장 → 7칸', note('FDE가 시험할 수 있는 요구로 바꿉니다. 예: “계정 생성 메일을 보냈다고 접근할 수 있는 것은 아니다”'), h('div', { class: 'field-row' }, cells.map((c) => field(c, vals[c]))), out, h('button', { class: 'btn ghost sm', onclick: () => { navigator.clipboard && navigator.clipboard.writeText(out.textContent).then(() => toast('복사했습니다.')); } }, '복사')),
    h('div', { class: 'grid g2' }, card('지표 정의서: 분자·분모·제외·시점', table(t.metric_defs.cols, t.metric_defs.rows), note(t.metric_defs.check)), card('변환 대조표 예시 (3행)', table(t.conversion.cols, t.conversion.rows), note(t.conversion.note))),
    card('외부 시스템 쓰기 연계: 4단계로 연다', h('div', { class: 'pipeline' }, t.sync_stages.map((s) => h('div', { class: 'step' }, h('b', null, `${s.n}. ${s.name}`), s.desc))), note(t.sync_rule)),
    h('div', { class: 'grid g2' }, card('판정 회의에서 던지는 질문 5가지', h('ol', null, t.judgement_questions.map((q) => h('li', null, q)))), card('검수 책임: 누가 무엇을 확인하나', table(['누가', '확인'], t.review_duty.map((r) => [r.who, r.does])), note(t.review_duty_note))),
    card('개발자·FDE에게 인계할 업무 명세에 반드시 들어갈 것', h('ul', null, t.handoff_must.map((x) => h('li', null, x)))));
  return holder;
}
