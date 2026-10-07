import { h, card, table, note, callout, pill, kpi, stackBar, legend, equation, groupBars, pct, n, BUCKET_NAME, roleName } from '../ui.js';

export async function render({ S, go }) {
  if (!S.engId) return card('사례가 없습니다', note('‘범용 템플릿 → 새 과업 만들기’에서 과업을 만들어 보세요.'));
  const d = await S.load(true);
  const ad = d.adapter, u = ad.unit; const c = d.counts, m = d.metrics, b = d.baseline;
  const proc = await S.content('process');
  const delta = (cur, base) => (cur === base ? '기준선과 같음' : `기준선 ${base} → ${cur > base ? '+' : ''}${cur - base}`);
  const alerts = [];
  if (!d.integrity_ok) alerts.push(callout('danger', h('b', null, '정합성 오류: '), '세 식 또는 하위 범주 합계에 잔차가 있습니다. 결과를 보고하기 전에 불일치 행을 추적하세요.'));
  if (d.protection.stop) alerts.push(callout('danger', h('b', null, '중단 기준 초과: '), `${d.protection.breached.join(', ')} — 자동 실행을 멈추고 담당자 재검토를 배정합니다.`));
  d.warnings.forEach((w) => alerts.push(callout('warn', w.msg || `${w.code} ${w.item || ''}`)));
  const open = d.open;
  return h('div', null,
    h('div', { class: 'row sb' }, h('div', null, h('h1', null, d.engagement.title), h('div', { class: 'muted small' }, `인력 준비요청 ${d.engagement.request_code} / 과업 ${d.engagement.task_code} · 업종 어댑터: ${ad.name} · 단위: ${u}`)),
      h('div', { class: 'row' }, d.engagement.synthetic ? pill('교육용 가상 자료', 'neutral') : null, pill(`기준 시점(보고서) ${d.basis_date}`, 'neutral'), pill(`현재 판정 ${d.basis.slice(0, 10)}`, 'ok'))),
    ...alerts,
    card('첫 줄: 대상 · 승인 · 검토 · 미확인 · 진행 · 부족',
      h('div', { class: 'kpis' },
        kpi('요구(정원 승인)', c.required, '', `${ad.start_label} ${c.started} · 예비 ${c.reserve}`),
        kpi('준비(승인)', c.approved, 'k-approved', delta(c.approved, b.counts.approved)),
        kpi('검토', c.review, 'k-review', delta(c.review, b.counts.review)),
        kpi('미확인', c.unconfirmed, 'k-unconfirmed', delta(c.unconfirmed, b.counts.unconfirmed)),
        kpi('진행', c.in_progress, 'k-in_progress', delta(c.in_progress, b.counts.in_progress)),
        kpi('예비(미착수)', c.reserve, 'k-reserve', delta(c.reserve, b.counts.reserve)),
        kpi('부족', m.shortage, 'k-shortage', `기준선 ${b.metrics.shortage}`)),
      h('div', { style: 'margin-top:14px' }, stackBar(c, c.required), h('div', { style: 'margin-top:6px' }, legend())),
      note(`부족 ${m.shortage}${u} = 검토 ${m.shortage_parts.review} + 미확인 ${m.shortage_parts.unconfirmed} + 진행 ${m.shortage_parts.in_progress} + 예비 ${m.shortage_parts.reserve}${m.shortage_unexplained ? ` + 설명되지 않는 차이 ${m.shortage_unexplained}(요구 ≠ 입력)` : ''}. 원문의 ‘검토·미확인·진행의 합’에는 예비(미입사)가 빠져 있어 이 분해를 쓴다.`)),
    h('div', { class: 'grid g2' },
      card('숫자는 세 번 맞춰 본다', d.identities.map(equation), note('세 식이 맞아도 ‘누가 어느 칸에 있는가’가 바뀌면 틀린 결과다. 합계 일치 ≠ 정확 — 하위 범주·개별 대상 키까지 확인한다(대상·근거 화면).', 'warn')),
      card('“완료 100%”의 함정 — 세 가지 비율', table(['지표', '계산', '값', '뜻'], [
        ['완료율', `${c.completed} ÷ ${c.started}`, h('b', null, pct(m.completion_rate)), '끝났다고 보고된 비율 — 쓸 수 있다는 뜻이 아니다'],
        ['승인율', `${c.approved} ÷ ${c.completed}`, h('b', null, pct(m.approval_rate)), '끝난 것 중 교육·권한·현업 확인을 모두 마친 비율'],
        ['요구 충족률', `${c.approved} ÷ ${c.required}`, h('b', null, pct(m.fulfilment_rate)), '경영진이 궁금한 숫자(애초 요구 대비)']]), note('분모가 0이면 임의로 100%라고 적지 않는다.'),
        h('div', { class: 'small muted' }, `기준선(${d.basis_date}): 완료율 ${pct(b.metrics.completion_rate)} · 승인율 ${pct(b.metrics.approval_rate)} · 충족률 ${pct(b.metrics.fulfilment_rate)}`))),
    card(`${ad.group_label}별로 보면`,
      h('div', { class: 'grid g2' }, groupBars(d.groups), table([ad.group_label, '요구', '준비', '검토', '미확인', '진행', '예비', '부족', '준비율'],
        [...d.group_metrics.map((g) => { const gr = d.groups.find((x) => x.code === g.code); return [h('b', null, g.name), gr.required, gr.approved, gr.review, gr.unconfirmed, gr.in_progress, gr.reserve, h('b', null, g.shortage), pct(g.fulfilment_rate)]; }),
          { cls: 'total', cells: ['합계', c.required, c.approved, c.review, c.unconfirmed, c.in_progress, c.reserve, m.shortage, pct(m.fulfilment_rate)] }], { num: [1, 2, 3, 4, 5, 6, 7, 8] })),
      note('부서 규모가 작아 해석에 한계가 있다(소규모 그룹의 1명 차이는 큰 비율 차이로 보인다). 타 부서 여유로 바로 메우지 않는다 — 직무·근무지·시프트가 다르면 대체 불가.')),
    h('div', { class: 'grid g2' },
      card(`‘준비’의 정의 — ${ad.name}`, h('ol', null, ad.requirements.map((r) => h('li', null, h('b', null, r.label), ` — 근거: ${r.source} · 확정 책임자: ${roleName(S.meta, r.owner, ad)}`))),
        note('판정 우선순위: 진행(확인 중) → 미확인(근거 없음/불명/식별번호 없음) → 검토(미충족·열린 보류·배정 이상) → 준비. 한 대상은 정확히 한 칸에만 들어간다.'), ad.trap ? callout('warn', ad.trap) : null),
      card('열린 일감', table(['항목', '건수', ''], [
        ['후보 근거(확인 대기)', open.candidates, h('button', { class: 'btn ghost sm', onclick: () => go('items') }, '열기')],
        ['거부 큐(수집 거부)', open.rejects, h('button', { class: 'btn ghost sm', onclick: () => go('items') }, '열기')],
        ['열린 보류', open.holds, h('button', { class: 'btn ghost sm', onclick: () => go('action') }, '열기')],
        ['재검토(충돌·자동 중단)', open.re_reviews, h('button', { class: 'btn ghost sm', onclick: () => go('action') }, '열기')]]),
        h('div', { class: 'row', style: 'margin-top:10px' }, pill(`데이터 품질: ${d.quality.decision_label}`, d.quality.decision === 'blocked' ? 'bad' : d.quality.decision === 'ready' ? 'ok' : 'neutral'),
          h('button', { class: 'btn ghost sm', onclick: () => go('process') }, '품질 5축 보기')))),
    card('이 숫자가 말하는 것 · 말하지 않는 것', h('div', { class: 'grid g2' },
      h('div', null, h('h4', null, '말하는 것'), h('ul', { class: 'small' }, proc.limits.says.map((x) => h('li', null, '○ ', x)))),
      h('div', null, h('h4', null, '말하지 않는 것'), h('ul', { class: 'small' }, proc.limits.not_says.map((x) => h('li', null, '− ', x))))), note(proc.limits.note)));
}
