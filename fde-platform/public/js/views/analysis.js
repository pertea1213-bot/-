import { h, card, table, note, callout, pill, badge, clear, field, input, textarea, actionBtn, toast, equation, tabs, kpi, stackBar, legend, pct, n, fmtTs, BUCKETS, BUCKET_NAME } from '../ui.js';
import * as api from '../api.js';

export async function render({ S }) {
  if (!S.engId) return card('사례가 없습니다');
  const id = S.engId; const d = await S.load(true);
  let tab = 'time';
  const holder = h('div'); const body = h('div');
  const T = [{ key: 'time', label: '이중 시간축(과거 재구성)' }, { key: 'moves', label: '상태 이동 비교 확인' }, { key: 'periods', label: '기간 행 합계(14행)' }, { key: 'gates', label: '준비 판정 5조건' }];
  const draw = async () => { clear(body); body.append(await views[tab]()); };
  const views = {
    time: async () => {
      const bd = input('date', d.basis_date); const kd = input('date', d.basis_date); const out = h('div');
      const run = async () => {
        const r = await api.get(`/engagements/${id}?basis=${bd.value}&known=${kd.value}`); clear(out);
        out.append(h('div', { class: 'grid g2' },
          card(`과거 재구성: 발생 ≤ ${bd.value}, 기록 ≤ ${kd.value}`, h('div', { class: 'kpis' }, kpi('준비', r.counts.approved, 'k-approved'), kpi('검토', r.counts.review, 'k-review'), kpi('미확인', r.counts.unconfirmed, 'k-unconfirmed'), kpi('예비', r.counts.reserve, 'k-reserve'), kpi('부족', r.metrics.shortage, 'k-shortage')), r.identities.map(equation)),
          card('현재(라이브)', h('div', { class: 'kpis' }, kpi('준비', d.counts.approved, 'k-approved'), kpi('검토', d.counts.review, 'k-review'), kpi('미확인', d.counts.unconfirmed, 'k-unconfirmed'), kpi('예비', d.counts.reserve, 'k-reserve'), kpi('부족', d.metrics.shortage, 'k-shortage')), d.identities.map(equation))));
      };
      const late = await api.get(`/engagements/${id}/evidence`);
      const lateRows = late.filter((e) => e.occurred_at.slice(0, 10) < e.recorded_at.slice(0, 10) && e.recorded_by !== 'seed').slice(0, 12);
      return h('div', null,
        callout('', h('b', null, '왜 시간축이 둘인가: '), '발생 시각(현실에서 일어난 때)과 기록 시각(시스템에 입력된 때)을 분리해 저장합니다. 그래서 “지난 기준일의 보고서”를 후행 입력·정정이 덮어쓰지 않고 그대로 다시 만들 수 있고(발생 ≤ basis, 기록 ≤ known), 늦게 찾은 근거는 과거를 덮는 대신 정정 기록으로 더해집니다.'),
        card('시점 되돌리기', h('div', { class: 'field-row' }, field('발생 기준 시점(basis)', bd), field('기록 기준 시점(known)', kd), h('div', { style: 'align-self:end' }, actionBtn('이 시점으로 재구성', run))),
          h('div', { class: 'row' }, h('button', { class: 'btn ghost sm', onclick: () => { bd.value = d.basis_date; kd.value = d.basis_date; run(); } }, `기준선 재현(${d.basis_date})`), h('button', { class: 'btn ghost sm', onclick: () => { const t = new Date().toISOString().slice(0, 10); bd.value = t; kd.value = t; run(); } }, '오늘')),
          note('기준선 재현은 보고서 기준일에 그날까지 기록된 지식만으로 계산한 값입니다(원문: 45 · 40 · 28 · 17).')), out,
        card('기준일 뒤에 기록된 과거 사건', lateRows.length ? table(['대상', '요건', '발생', '기록', '기록자'], lateRows.map((e) => [e.ref_key, e.requirement_key, fmtTs(e.occurred_at), fmtTs(e.recorded_at), e.recorded_by])) : h('p', { class: 'muted small' }, '아직 없습니다. 대상·근거 화면에서 과거 일자로 근거를 등록(정정)해 보세요 — 위에서 기준선을 재현하면 그 정정이 과거 보고서를 바꾸지 않음을 확인할 수 있습니다.')));
    },
    moves: async () => {
      const fb = input('date', d.basis_date), fk = input('date', d.basis_date), tb = input('date', new Date().toISOString().slice(0, 10)); const out = h('div');
      const run = async () => {
        const t = await api.get(`/engagements/${id}/transitions?from_basis=${fb.value}&from_known=${fk.value}&to_basis=${tb.value}`); clear(out);
        out.append(card('상태 이동 요약', h('div', { class: 'kpis' }, kpi('이동한 대상', t.moved.length), kpi('신규 유입', t.new_inflow), kpi('보존식', t.conserved ? 1 : 0, t.conserved ? 'k-approved' : 'k-unconfirmed', t.conserved ? '일치' : '불일치')),
          h('p', null, t.note), table(['칸', '이전', '− 나감', '+ 들어옴', '+ 신규', '이후', '잔차'], t.check.map((c) => [BUCKET_NAME[c.bucket], c.before, c.out, c.in, c.new, c.after, h('span', { class: c.residual === 0 ? 'pass' : 'fail' }, c.residual)]), { num: [1, 2, 3, 4, 5, 6] }), note('이전 칸 차감과 다음 칸 증가를 같은 대상 키로 비교 확인한다. 같은 이동을 신규 유입으로 또 더하지 않는다.')),
          card('이동한 대상', t.moved.length ? table(['대상', '범주', '이전', '이후'], t.moved.map((m) => [h('b', { class: 'mono' }, m.ref_key), m.group, badge(m.from), badge(m.to)])) : h('p', { class: 'muted small' }, '이동이 없습니다. 조치를 실행해 결과를 기록하면 여기에 나타납니다.')));
      };
      await run();
      return h('div', null, card('비교 구간', h('div', { class: 'field-row' }, field('이전 발생 기준', fb), field('이전 기록 기준', fk), field('이후 발생 기준', tb), h('div', { style: 'align-self:end' }, actionBtn('비교', run)))), out);
    },
    periods: async () => {
      const p = await api.get(`/engagements/${id}/periods`); const out = h('div');
      const sample = () => {
        const rows = p.rows.map((r) => ({ period_id: r.period_id, ...r.counts }));
        const bad = { ...rows[1], approved: rows[1].approved + 1 }; // 잔차
        return JSON.stringify([...rows.slice(0, 6), rows[0], { ...rows[2], period_id: 'RECHECK-1', kind: 'recheck' }, bad, ...rows.slice(2, 6).filter((_, i) => i !== 0 && i !== 1)].map((r) => ({ period_id: r.period_id, kind: r.kind, input: r.input, started: r.started, reserve: r.reserve, completed: r.completed, in_progress: r.in_progress, approved: r.approved, review: r.review, unconfirmed: r.unconfirmed })), null, 1);
      };
      const ta = textarea(JSON.stringify(p.rows.map((r) => ({ period_id: r.period_id, input: r.counts.input, started: r.counts.started, reserve: r.counts.reserve, completed: r.counts.completed, in_progress: r.counts.in_progress, approved: r.counts.approved, review: r.counts.review, unconfirmed: r.counts.unconfirmed })), null, 1), { rows: '8', class: 'mono', 'aria-label': '기간 행 JSON' });
      return h('div', null,
        callout('', `${p.row_count}개 서로 다른 기간 행을 각 기준 시점에 한 번씩 합계 계산합니다. 반복 특정 시점 기록과 조치 후 다시 확인을 신규 입력으로 중복 합산하지 않습니다.`),
        card(`착수일(예비는 예정일)별 ${p.row_count}개 기간 행`, table(['자료 식별번호', '기간', '입력', '착수', '예비', '완료', '진행', '승인', '검토', '미확인', '세 식'], p.rows.map((r) => [h('span', { class: 'mono' }, r.period_id), r.start, r.counts.input, r.counts.started, r.counts.reserve, r.counts.completed, r.counts.in_progress, r.counts.approved, r.counts.review, r.counts.unconfirmed, h('span', { class: r.ok ? 'pass' : 'fail' }, r.ok ? '✓' : '✗')]).concat([{ cls: 'total', cells: ['합계', '', p.total.input, p.total.started, p.total.reserve, p.total.completed, p.total.in_progress, p.total.approved, p.total.review, p.total.unconfirmed, h('span', { class: p.matches_snapshot ? 'pass' : 'fail' }, p.matches_snapshot ? '= 스냅샷' : '≠ 스냅샷')] }]), { num: [2, 3, 4, 5, 6, 7, 8, 9] }),
          note('행마다 세 식을 확인한 뒤 합산한다. 합계만 맞추고 불일치 행을 숨기지 않는다.')),
        card('붙여넣은 기간 행 검증 (실습 3·10)', note('외부에서 받은 기간 행을 붙여 넣으면 행별 잔차·자료 식별번호 중복·재확인 기록(kind:"recheck")·총계 불일치를 찾아 줍니다.'), ta,
          h('div', { class: 'row' }, actionBtn('검증', async () => {
            let rows; try { rows = JSON.parse(ta.value); } catch { throw new Error('JSON 형식이 올바르지 않습니다.'); }
            const r = await api.post(`/engagements/${id}/periods/validate`, { rows }); clear(out);
            out.append(callout(r.matches && !r.issues.length ? '' : 'warn', `사용 ${r.used_rows}행 · 제외 ${r.excluded_rows}행 · 총계 ${r.matches ? '일치' : '불일치'}`), r.issues.length ? h('ul', { class: 'small' }, r.issues.map((i) => h('li', null, h('b', null, i.code), ' ', i.msg))) : h('p', { class: 'pass' }, '문제가 없습니다.'));
          }), h('button', { class: 'btn ghost', onclick: () => { ta.value = sample(); } }, '결함이 든 예시 채우기')), out));
    },
    gates: async () => {
      const ok = d.items.filter((i) => i.bucket === 'approved'); const no = d.items.filter((i) => i.bucket !== 'reserve' && i.bucket !== 'approved');
      const by = {}; no.forEach((i) => { const k = i.reasons.join(', ') || i.bucket; (by[k] = by[k] || []).push(i.ref_key); });
      return h('div', null,
        card('준비 가능 인력 판단 기준: 실행 가능 수량', h('div', { class: 'pipeline' }, [['완료', d.counts.completed], ['① 하위 대상 일치', '부서·키가 맞음'], ['② 유효 규칙', '현재 규칙 버전'], ['③ 근거 자료 증거', '근거 연결'], ['④ 현재 위치', '이동 중 아님·보류 없음'], ['⑤ 중복 배정 없음', '다른 배정 없음'], ['최초 승인', d.counts.approved]].map(([a, b], i) => h('div', { class: `step ${i === 0 || i === 6 ? 'on' : ''}` }, h('b', null, a), String(b)))), note(`다섯 조건을 모두 통과해야 승인 · 통과하지 못한 ${no.length}명 = 검토 ${d.counts.review} + 미확인 ${d.counts.unconfirmed}${d.counts.in_progress ? ` + 진행 ${d.counts.in_progress}` : ''}. 단순한 ‘완료 ${d.counts.completed}’와 다른 숫자다 — 완료는 상태가 끝난 것이고 승인은 쓸 수 있는 것이다.`)),
        card('통과하지 못한 대상의 사유', table(['사유', '건수', '대상'], Object.entries(by).map(([k, v]) => [k, v.length, h('span', { class: 'tiny mono' }, v.join(' '))]))),
        note(`현재 규칙 v${d.rule ? d.rule.version : '—'} · 요건 ${d.rule ? d.rule.required_keys.join(', ') : '없음'} (기준 시점에 유효한 규칙으로 판정)`));
    },
  };
  const mount = () => { clear(holder); holder.append(h('h1', null, '수량 확인·분석'), tabs(T, tab, (k) => { tab = k; mount(); }), body); draw(); };
  mount();
  return holder;
}
