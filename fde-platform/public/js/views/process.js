import { h, card, table, note, callout, pill, clear, field, input, select, textarea, actionBtn, toast, equation, pct, kpi } from '../ui.js';
import * as api from '../api.js';

export async function render({ S, go }) {
  if (!S.engId) return card('사례가 없습니다');
  const P = await S.content('process');
  const d = await S.load(true);
  const id = S.engId;
  const hash = Number((location.hash.match(/step=(\d)/) || [])[1]);
  let cur = Number.isInteger(hash) ? hash : 0;
  const holder = h('div'); const detail = h('div');
  const can = S.can('consultant', 'fde', 'field');
  const group = (no) => P.groups.find((g) => g.steps.includes(no));

  const stepper = () => h('div', { class: 'steps', role: 'tablist' }, P.steps.map((s) => h('button', { role: 'tab', 'aria-current': s.no === cur ? 'step' : null, onclick: () => { cur = s.no; drawStep(); stepBar(); } }, h('b', null, s.no), s.short)));
  const bar = h('div'); const stepBar = () => { clear(bar); bar.append(stepper()); };
  stepBar();

  async function drawStep() {
    clear(detail);
    const s = P.steps[cur]; const g = group(cur);
    detail.append(h('div', { class: 'card' },
      h('div', { class: 'row sb' }, h('h2', { style: 'margin:0' }, `${s.no} ${s.name}`), h('span', { class: 'row' }, pill(g.name), s.form ? pill(`서식 ${s.form}`, 'ok') : null)),
      h('div', { class: 'grid g2', style: 'margin-top:12px' },
        h('div', null, h('h4', null, '핵심 질문'), h('p', null, s.question), h('h4', null, '근거 자료'), h('p', null, s.evidence), h('h4', null, '산출물'), h('p', null, s.deliverable)),
        h('div', null, callout('danger', h('b', null, '함정: '), s.trap), callout('', h('b', null, '확인 기준: '), s.criterion), callout('warn', h('b', null, '현장 규칙: '), s.field_rule))),
      h('p', { class: 'small' }, h('b', null, '다른 가능성: '), `“${s.alt}”라는 설명이 맞더라도 그 하나로 모든 권한 확인 대기·교육 확인 대기를 묶지 않는다.`),
      note(P.step_footer),
      h('div', { class: 'row' }, P.six_keep.map((x) => pill(x))),
      s.form ? h('div', { style: 'margin-top:10px' }, h('button', { class: 'btn', onclick: () => { location.hash = `#/forms?no=${s.form}`; } }, `서식 ${s.form} 작성하기 →`)) : null));
    detail.append(await tool(s));
  }

  async function tool(s) {
    switch (s.tool) {
      case 'requests': return crud({ S, id, tool: 'data_requests', title: '자료 요청서 템플릿', cols: [['name', '자료'], ['owner', '관리자'], ['format_version', '형식·버전'], ['access_limit', '접근 제한'], ['provided', '제공 여부', 'bool']], can, note: P.data_request_note });
      case 'statements': return h('div', null, crud({ S, id, tool: 'statements', title: '진술 ↔ 기록 대조표', cols: [['topic', '항목'], ['statement', '진술'], ['speaker', '누가'], ['record_ref', '기록(자료 식별번호)'], ['match', '일치?', 'match'], ['confirm_note', '책임자 확인']], can, note: '진술과 기록이 다르면 둘 다 보존하고, 기준이 지금도 적용되는지 책임자에게 확인한다.' }),
        card('면담 질문 은행: 역할별 핵심 질문', table(['역할', '핵심 질문'], P.interview_bank.map((x) => [x.role, x.q])), note(P.interview_note)),
        card('인사 담당자의 현장 질문', h('ul', null, P.hr_questions.map((q) => h('li', null, q)))));
      case 'flows': return h('div', null,
        card('정상 흐름과 예외 흐름', h('h4', null, '정상'), h('div', { class: 'pipeline' }, P.flows.normal.map((x, i) => h('div', { class: 'step' }, h('b', null, i + 1), x))), h('h4', { style: 'margin-top:12px' }, '예외'), h('div', { class: 'pipeline' }, P.flows.exception.map((x, i) => h('div', { class: 'step on' }, h('b', null, i + 1), x))), callout('warn', P.flows.core)),
        card('근거 자료가 없으면 ‘합격’이 아니다', h('ol', null, P.no_evidence_rule.map((x) => h('li', null, x))), note('이 규칙은 코드로 강제된다: 자료 식별번호 없는 verified 는 미확인으로 판정, AI/OCR 값은 후보(T6, X4).')));
      case 'dictionary': return h('div', null, crud({ S, id, tool: 'dictionary', title: '자료 사전 템플릿 (일곱 필드)', cols: [['field', '필드'], ['definition', '정의'], ['example', '예시'], ['version', '사전 버전'], ['approver', '승인자']], can, note: '사전 버전과 승인자 없이 기존 자료를 일괄 변환하지 않는다.' }), qualityCard(d, P));
      case 'numbers': return h('div', null, card('분석 기준 마련과 수량 확인', d.identities.map(equation), h('div', { class: 'grid g3' }, [['완료율', d.metrics.completion_rate, `${d.counts.completed} ÷ ${d.counts.started}`], ['승인율', d.metrics.approval_rate, `${d.counts.approved} ÷ ${d.counts.completed}`], ['충족률', d.metrics.fulfilment_rate, `${d.counts.approved} ÷ ${d.counts.required}`]].map(([l, v, c]) => h('div', { class: 'callout', style: 'margin:0' }, h('b', null, l), h('div', null, h('b', { style: 'font-size:1.4rem' }, pct(v))), h('div', { class: 'small muted' }, c)))),
        h('div', { style: 'margin-top:10px' }, h('button', { class: 'btn', onclick: () => go('analysis') }, '수량 확인·분석 화면으로 →'))),
        card('비교 확인 5단계: 상태 이동 계산 확인', h('div', { class: 'pipeline' }, P.compare_five.map((x) => h('div', { class: 'step' }, h('b', null, `${x.n}. ${x.name}`), x.desc)))),
        card('합계가 맞아도 결론이 바뀌는 다른 가능성 확인 사례', h('div', { class: 'grid g4' }, P.sum_traps.map((x) => h('div', { class: 'callout warn', style: 'margin:0' }, h('b', null, x.name), h('div', { class: 'small' }, x.desc))))));
      case 'hypotheses': return card('원인 후보 × 대상', h('p', null, '원인 후보 4개와 ○△× 매트릭스는 ‘원인 후보’ 화면에서 작업합니다. 시각이 겹친다는 이유만으로 인과를 확정하지 않으며, “지지됨”으로 바꾸려면 다른 가능성 확인 결과가 필요합니다.'), h('button', { class: 'btn', onclick: () => go('hyp') }, '원인 후보 화면으로 →'));
      case 'interventions': return card('조치 후보와 승인', h('p', null, '조치 후보 3가지(가장 작은 조치·대안 1·대안 2)와 시뮬레이션, 승인서(대상·권한·비용·중단 조건·복구 경로)는 ‘조치·승인·외부 연계’에서 다룹니다. 조치 경로 승인만으로 준비 수량을 올리지 않습니다(T7).'), h('button', { class: 'btn', onclick: () => go('action') }, '조치·승인 화면으로 →'));
      case 'trial': return card('현장 병행 시험', h('p', null, '4주 로드맵·일별 마감·보호 지표·전후 비교의 해석 한계는 ‘현장 시험·보고’에서 다룹니다.'), h('button', { class: 'btn', onclick: () => go('trial') }, '현장 시험 화면으로 →'));
      default: return card('결과 보고와 확산', h('p', null, '최종 보고서(8단 순서)와 현장 시험 인계서(서식 6) 점검은 ‘현장 시험·보고’에서 다룹니다.'), h('button', { class: 'btn', onclick: () => go('trial') }, '보고서 보기 →'));
    }
  }

  holder.append(
    h('div', { class: 'row sb' }, h('h1', null, '현장 컨설팅 9단계'), h('span', { class: 'small muted' }, `${d.engagement.request_code} / ${d.engagement.task_code}`)),
    d.adapter.key !== 'hr-onboarding' ? callout('warn', h('b', null, '안내: '), `이 화면의 9단계 문구(핵심 질문·근거 자료·함정·다른 가능성)는 인사 사례(교안·원문 제20장) 기준의 예시입니다. ‘${d.adapter.name}’ 사례의 단계별 본문은 원고 제1부를 참고하세요. 이 사례의 문제 문장·모집단·원인 후보·조치는 ‘과업 현황’의 사례 개요와 ‘원인 후보’·‘조치’ 화면에 있습니다.`) : null,
    callout('', P.intro), h('div', { class: 'grid g3' }, P.three_lessons.map((l) => h('div', { class: 'callout', style: 'margin:0' }, h('b', null, l.title), h('div', { class: 'small' }, l.desc)))),
    h('div', { class: 'card', style: 'margin-top:16px' }, h('div', { class: 'row', style: 'margin-bottom:8px' }, P.groups.map((g) => pill(g.name))), bar, note(P.ready_def), callout('', h('b', null, P.one_line))),
    detail);
  await drawStep();
  return holder;
}

function qualityCard(d, P) {
  const q = d.quality;
  return card('데이터 품질 5축과 현장 시험 시작 판정', h('div', { class: 'grid g5' }, q.axes.map((a) => h('div', { class: `callout ${a.pass ? '' : (a.soft ? 'warn' : 'danger')}`, style: 'margin:0' }, h('b', null, `${a.label} ${a.pass ? '✓' : '✗'}`), h('div', { class: 'tiny muted' }, a.q), h('div', { class: 'small', style: 'margin-top:4px' }, a.value == null ? '—' : `${a.value}%`), h('div', { class: 'tiny' }, a.detail)))),
    h('div', { class: 'row', style: 'margin-top:10px' }, h('b', null, '현장 시험 개시 판정:'), pill(q.decision_label, q.decision === 'blocked' ? 'bad' : q.decision === 'ready' ? 'ok' : 'neutral')),
    q.reasons.length ? h('ul', { class: 'small' }, q.reasons.map((r) => h('li', null, r))) : null, note(q.rule), note('빠진 값을 삭제해 통과율을 높이지 않는다 — 미확인으로 유지하고 담당·기한을 정한다.', 'warn'));
}

/** 단순 작업표 CRUD (자료 요청서·진술 대조표·자료 사전) */
function crud({ S, id, tool, title, cols, can, note: nt }) {
  const wrap = h('div'); const body = h('div');
  const MATCH = { yes: '일치', partial: '부분', check: '확인 필요', no: '불일치' };
  async function load() {
    const rows = await api.get(`/engagements/${id}/tools/${tool}`); clear(body);
    body.append(table([...cols.map((c) => c[1]), ''], rows.map((r) => [...cols.map(([k, , t]) => (t === 'bool' ? (can ? h('input', { type: 'checkbox', checked: !!r[k], onchange: async (e) => { try { await api.put(`/engagements/${id}/tools/${tool}/${r.id}`, { ...r, [k]: e.target.checked }); } catch (x) { toast(x.message, 'err'); e.target.checked = !e.target.checked; } }, 'aria-label': r.name }) : (r[k] ? '✓' : '—')) : t === 'match' ? pill(MATCH[r[k]] || r[k], r[k] === 'yes' ? 'ok' : r[k] === 'no' ? 'bad' : 'neutral') : r[k] || '—')),
      can ? actionBtn('삭제', async () => { await api.del(`/engagements/${id}/tools/${tool}/${r.id}`); await load(); }, { cls: 'ghost sm', confirm: '삭제할까요?' }) : ''])));
    if (!rows.length) body.append(h('p', { class: 'muted small' }, '비어 있습니다.'));
  }
  const inputs = cols.map(([k, l, t]) => [k, t === 'bool' ? h('input', { type: 'checkbox' }) : t === 'match' ? select(Object.entries(MATCH), 'check') : input('text', '', { 'aria-label': l })]);
  const form = can ? h('div', { class: 'field-row', style: 'margin-top:10px' }, inputs.map(([k, el], i) => field(cols[i][1], el)), h('div', { style: 'align-self:end' }, actionBtn('추가', async () => {
    const b = Object.fromEntries(inputs.map(([k, el]) => [k, el.type === 'checkbox' ? el.checked : el.value]));
    await api.post(`/engagements/${id}/tools/${tool}`, b); inputs.forEach(([, el]) => { if (el.type !== 'checkbox' && el.tagName !== 'SELECT') el.value = ''; }); await load();
  }))) : note('이 역할은 읽기만 가능합니다(컨설턴트·FDE·현장 담당자가 작성).');
  wrap.append(card(title, body, form, nt ? note(nt) : null));
  load();
  return wrap;
}
