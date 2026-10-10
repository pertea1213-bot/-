import { h, card, table, note, callout, pill, badge, clear, field, input, select, textarea, actionBtn, toast } from '../ui.js';
import * as api from '../api.js';

const STATUS = { need_evidence: '추가 근거 자료 필요', supported: '지지됨(다른 가능성 확인함)', weakened: '약해짐', rejected: '기각' };
const MARK = { full: ['○', '설명함'], partial: ['△', '일부만'], none: ['×', '설명 못함'] };

export async function render({ S, go }) {
  if (!S.engId) return card('사례가 없습니다');
  const id = S.engId; const d = await S.load(true);
  const can = S.can('consultant', 'reviewer', 'fde');
  const holder = h('div');
  async function draw() {
    const hs = await api.get(`/engagements/${id}/hypotheses`); clear(holder);
    holder.append(
      h('div', { class: 'row sb' }, h('h1', null, '원인 후보'), h('span', { class: 'small muted' }, `${d.engagement.request_code} / ${d.engagement.task_code}`)),
      callout('', h('b', null, '이 화면의 규칙: '), '이유를 하나로 뭉뚱그리지 않고 여러 원인 후보를 세워 다른 가능성을 확인할 자료와 함께 본다. 시각이 겹친다는 이유만으로 인과(사람의 과실)를 확정하지 않는다. 8명과 4명을 모두 설명하는 원인 후보는 오히려 의심한다.'),
      card('원인 후보 × 대상: 누구를 설명하나', table(['원인 후보', `검토(권한 확인 대기) ${d.counts.review}명`, `미확인(교육 확인 대기) ${d.counts.unconfirmed}명`], hs.map((x) => [h('div', null, h('b', null, x.code), ' ', x.statement, x.suspicious ? h('div', { class: 'note danger' }, x.suspicious_msg) : null),
        ...['review', 'unconfirmed'].map((b) => { const c = x.coverage.find((y) => y.bucket === b) || {}; return cell(x, b, c); })])),
        h('div', { class: 'legend', style: 'margin-top:8px' }, Object.values(MARK).map(([a, b]) => h('span', null, h('b', null, a), ` ${b}`))), note('칸 안의 질문과 ○△× 표시 규칙은 수업 활동용이다. 원문에는 원인 후보별 판정이 없다 — 어느 원인 후보가 8명·4명을 설명하는지는 원문도 판정하지 않았다.')),
      h('div', { class: 'grid g2' }, hs.map((x) => hcard(x))),
      card('판정이 필요한 대상', table(['대상', '판정', '근거 상태'], d.items.filter((i) => ['review', 'unconfirmed'].includes(i.bucket)).map((i) => [h('b', { class: 'mono' }, i.ref_key), badge(i.bucket), h('span', { class: 'small' }, Object.entries(i.req).filter(([, v]) => v.value !== 'verified').map(([k, v]) => `${k}: ${v.note || v.value}`).join(' · '))])), h('button', { class: 'btn ghost sm', style: 'margin-top:8px', onclick: () => go('items') }, '대상·근거에서 열어 보기')));
  }
  function cell(x, bucket, c) {
    const cur = c.mark; const note_ = input('text', c.note || '', { placeholder: '확인한 자료·근거', disabled: !can, 'aria-label': '메모' });
    const save = async (mark) => { try { await api.patch(`/engagements/${id}/hypotheses/${x.id}`, { coverage: [{ bucket, mark, note: note_.value }] }); await draw(); } catch (e) { toast(e.message, 'err'); } };
    return h('div', null, h('div', { class: 'small muted' }, c.prompt || ''), h('div', { class: 'row', style: 'margin:4px 0' }, Object.entries(MARK).map(([k, [sym, label]]) => h('button', { class: 'mark', 'aria-pressed': String(cur === k), title: label, disabled: !can, style: cur === k ? 'background:var(--brand);color:var(--brand-ink)' : '', onclick: () => save(cur === k ? null : k) }, sym))), note_,
      can ? h('button', { class: 'btn ghost sm', style: 'margin-top:4px', onclick: () => save(cur ?? null) }, '메모 저장') : null);
  }
  function hcard(x) {
    const st = select(Object.entries(STATUS), x.status, { disabled: !can }); const dn = textarea('', { rows: '2', placeholder: '다른 가능성을 확인한 결과(“지지됨”으로 바꾸려면 필수)', disabled: !can });
    return h('div', { class: 'card', style: 'margin:0' }, h('div', { class: 'row sb' }, h('h3', { style: 'margin:0' }, `${x.code}`), pill(STATUS[x.status], x.status === 'supported' ? 'ok' : 'neutral')), h('p', { style: 'margin-top:6px' }, x.statement),
      h('p', { class: 'small' }, h('b', null, '지지할 증거: '), x.support_source, h('br'), h('b', null, '다른 가능성을 확인할 자료: '), x.disconfirm_source), can ? h('div', null, field('상태', st), field('다른 가능성 확인 메모', dn), actionBtn('상태 저장', async () => { await api.patch(`/engagements/${id}/hypotheses/${x.id}`, { status: st.value, disconfirm_note: dn.value }); toast('저장했습니다.'); await draw(); }, { cls: 'sm' })) : note('컨설턴트·검토자·FDE가 판정합니다.'));
  }
  await draw();
  return holder;
}
