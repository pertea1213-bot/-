import { h, card, table, note, callout, pill, clear, field, input, select, textarea, actionBtn, toast, tabs, fmtTs, roleName, won } from '../ui.js';
import * as api from '../api.js';

const EXTRA_LABEL = {
  problem_sentence: '문제 문장(한 문장으로)', observed: '본 것(기록으로 확인한 것)', heard: '들은 것(진술 · 사후 해석은 다른 칸)', equations: '세 계산 확인식', residual: '잔차와 불일치 행',
  hypotheses: '원인 후보', disconfirm: '다른 가능성을 확인할 자료', unexplained: '설명하지 못한 대상',
  target: '대상', authority: '권한(결재)', cost_assumption: '비용 가정', stop_condition: '중단 조건', recovery_path: '복구 경로', approver: '승인자',
  unresolved: '미해결 건(담당·기한)', privacy_scope: '권한과 개인정보 범위', assumptions_limits: '가정과 한계', forbidden_actions: '금지 실행 작업', approval_history: '승인 이력',
};
const LONG = new Set(['problem_sentence', 'observed', 'heard', 'equations', 'residual', 'hypotheses', 'disconfirm', 'unexplained', 'target', 'cost_assumption', 'stop_condition', 'recovery_path', 'unresolved', 'privacy_scope', 'assumptions_limits', 'forbidden_actions', 'approval_history']);

export async function render({ S, go }) {
  if (!S.engId) return card('사례가 없습니다');
  const id = S.engId; const d = await S.load(true); const ad = d.adapter;
  const F = await api.get(`/engagements/${id}/forms`);
  let no = Number((location.hash.match(/no=(\d)/) || [])[1]) || 1;
  const holder = h('div'); const body = h('div');
  const T = Object.entries(F.forms).map(([k, v]) => ({ key: k, label: `서식 ${k} ${v.name}` }));
  const canEdit = (F.editors[no] || []).includes(S.role());

  async function draw() {
    clear(body);
    const def = F.forms[no]; const saved = F.saved.find((x) => x.form_no === no); const vals = { ...(saved ? saved.fields : {}) };
    const editable = (F.editors[no] || []).includes(S.role());
    const els = {}; const errBox = h('div');
    const mk = (k) => { const long = LONG.has(k); const el = long ? textarea(vals[k] || '', { rows: '2', disabled: !editable }) : input('text', vals[k] || '', { disabled: !editable }); els[k] = el; return field(F.common_label[k] || EXTRA_LABEL[k] || k, el, null, true); };
    const common = F.common_required.map(mk); const extra = def.extra.map(mk);
    const read = () => Object.fromEntries(Object.entries(els).map(([k, el]) => [k, el.value]));
    const save = async (status) => {
      errBox.textContent = '';
      Object.values(els).forEach((el) => { el.style.borderColor = ''; });
      try {
        const r = await api.put(`/engagements/${id}/forms/${no}`, { fields: read(), status, expected_version: saved ? saved.version : undefined });
        toast(`저장했습니다 (v${r.version}, ${status === 'complete' ? '완료' : '초안'}).`); F.saved = (await api.get(`/engagements/${id}/forms`)).saved; await draw();
      } catch (e) {
        const miss = (e.data && e.data.missing) || []; miss.forEach((k) => { if (els[k]) els[k].style.borderColor = 'var(--danger)'; });
        errBox.append(callout('danger', h('b', null, '완료로 저장할 수 없습니다. '), e.message)); throw e;
      }
    };
    const hist = saved ? await api.get(`/engagements/${id}/forms/${no}/history`) : [];
    body.append(
      callout('', h('b', null, `서식 ${no} ${def.name}`), ' — ', def.purpose, h('div', { class: 'small', style: 'margin-top:4px' }, `현장 규칙: ${def.rule}`)),
      saved ? h('p', { class: 'small muted' }, `v${saved.version} · ${saved.status === 'complete' ? '완료' : '초안'} · ${saved.updated_by} · ${fmtTs(saved.updated_at)}`) : h('p', { class: 'small muted' }, '아직 저장된 서식이 없습니다.'),
      editable ? null : callout('warn', `서식 ${no}은(는) ${F.editors[no].map((r) => roleName(S.meta, r)).join('·')}만 작성할 수 있습니다. 이 역할은 읽기만 가능합니다.`),
      h('div', { class: 'card' }, h('h3', null, '필수 칸: 범위 · 자료 식별번호 · 단위 · 시각 · 담당 · 미확정 · 다음 행동'), h('div', { class: 'field-row' }, common), h('h3', { style: 'margin-top:12px' }, `이 서식의 칸`), extra, errBox,
        note(F.note),
        editable ? h('div', { class: 'row' },
          h('button', { class: 'btn ghost', onclick: () => { const ex = (F.examples || {})[String(no)]; if (!ex) return toast('작성 예가 없습니다.'); Object.entries(ex).forEach(([k, v]) => { if (els[k]) els[k].value = v; }); toast('작성 예(가상)를 채웠습니다. 현장 자료로 다시 채우세요.'); } }, '작성 예 불러오기(HR 사례)'),
          h('button', { class: 'btn ghost', onclick: () => { els.scope.value = `${d.engagement.request_code} / ${d.engagement.task_code}`; els.unit.value = ad.unit; els.time.value = `기준 시점 ${d.basis_date}`; } }, '사례 값으로 범위·단위·시각 채우기'),
          no === 5 ? await ivPicker(S, id, els, ad) : null,
          actionBtn('초안 저장', () => save('draft').catch(() => {}), { cls: 'ghost' }), actionBtn('완료로 저장', () => save('complete').catch(() => {}))) : null),
      hist.length ? card('이전 버전', table(['버전', '상태', '작성자', '시각'], hist.map((x) => [`v${x.version}`, x.status, x.updated_by, fmtTs(x.updated_at)])), note('서식은 덮어쓰지 않고 이전 버전을 이력으로 보존합니다.')) : null);
  }
  const mount = () => { clear(holder); holder.append(h('div', { class: 'row sb' }, h('h1', null, '현장 서식 6종: 문제에서 인계까지'), h('span', { class: 'small muted' }, `${d.engagement.request_code} / ${d.engagement.task_code}`)), callout('', '자료가 없다면 0이나 ‘합격’이 아니라 ‘미확인’으로 적는다. 빈칸이 있는 서식은 완료로 저장되지 않는다. 보존 제한이 있는 원문은 내부 참조식별번호와 접근권한만 적는다.'),
    tabs(T, String(no), (k) => { no = Number(k); location.hash = `#/forms?no=${no}`; mount(); }), body); draw(); };
  mount();
  return holder;
}

async function ivPicker(S, id, els, ad) {
  const ivs = await api.get(`/engagements/${id}/interventions`);
  const sel = select([['', '조치에서 불러오기…'], ...ivs.map((i) => [String(i.id), `${i.code} ${i.title}`])], '');
  sel.addEventListener('change', () => {
    const iv = ivs.find((i) => String(i.id) === sel.value); if (!iv) return;
    els.target.value = `${iv.title}${iv.targets.length ? ` (${iv.targets.length}${ad.unit})` : ''}`;
    els.authority.value = iv.required_roles.map((r) => roleName(S.meta, r, ad)).join(' + ');
    els.cost_assumption.value = iv.cost_calc && iv.cost_calc.lines.length ? `가상 ${won(iv.cost_calc.amount)} (${iv.cost_calc.lines.map((l) => l.label).join(', ')}) — 교육용 업무 부담 가정이며 임금·법정 교육비·자동 절감액이 아님` : (iv.cost && iv.cost.note) || '원문에 비용 수치 없음';
    els.stop_condition.value = iv.stop_condition || ''; els.recovery_path.value = iv.recovery_path || '';
  });
  return sel;
}
