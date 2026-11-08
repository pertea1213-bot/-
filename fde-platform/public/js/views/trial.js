import { h, card, table, note, callout, pill, badge, clear, field, input, select, textarea, actionBtn, toast, tabs, kpi, equation, pct, won, fmtTs, n, BUCKET_NAME } from '../ui.js';
import * as api from '../api.js';

export async function render({ S, go }) {
  if (!S.engId) return card('사례가 없습니다');
  const id = S.engId; let d = await S.load(true); const ad = d.adapter;
  const P = await S.content('process');
  let tab = 'weeks';
  const holder = h('div'); const body = h('div');
  const T = [{ key: 'weeks', label: '4주 병행 시험' }, { key: 'protect', label: '보호 지표·중단 기준' }, { key: 'daily', label: '일별 운영 마감' }, { key: 'compare', label: '전후 비교' }, { key: 'report', label: '최종 보고서·인계' }];
  const reload = async () => { S.invalidate(); d = await S.load(true); await draw(); };

  const views = {
    weeks: async () => {
      const ws = await api.get(`/engagements/${id}/trial`);
      const ST = { planned: ['예정', 'neutral'], running: ['진행 중', 'ok'], done: ['완료', 'ok'], stopped: ['중단', 'bad'] };
      return h('div', null,
        callout('warn', '기존 방식과 새 화면을 병행한다. 시험 중단과 원상복구 절차(중단 조건·복구 경로가 있는 승인된 조치)가 없으면 현장 시험을 시작하지 않는다. 사후 비교만으로 새로운 플랫폼의 인과 효과를 단정하지 않는다.'),
        card('4주 현장 병행 시험 로드맵', h('div', { class: 'grid g4' }, ws.map((w) => h('div', { class: 'card', style: 'margin:0;box-shadow:none' },
          h('div', { class: 'row sb' }, h('h3', { style: 'margin:0' }, `${w.week}주`), pill(ST[w.status][0], ST[w.status][1])), h('p', { class: 'small' }, w.focus),
          h('div', { class: 'tiny muted' }, '핵심 검증'), h('div', { class: 'small' }, w.verify), h('div', { class: 'tiny muted', style: 'margin-top:4px' }, '보호 지표(나빠지면 중단)'), h('div', { class: 'small' }, h('b', null, w.protect)),
          S.can('consultant') ? h('div', { class: 'row', style: 'margin-top:8px' }, w.status === 'planned' ? actionBtn('시작', async () => { await api.put(`/engagements/${id}/trial/${w.week}`, { status: 'running' }); await reload(); }, { cls: 'sm' }) : null, w.status === 'running' ? [actionBtn('완료', async () => { await api.put(`/engagements/${id}/trial/${w.week}`, { status: 'done' }); await reload(); }, { cls: 'sm' }), actionBtn('중단', async () => { await api.put(`/engagements/${id}/trial/${w.week}`, { status: 'stopped' }); await reload(); }, { cls: 'danger sm' })] : null) : null))),
          note('1주차 시작 조건: 데이터 품질 판정이 ‘시작 불가’가 아니고, 중단 조건·복구 경로가 있는 승인된 조치가 있어야 한다. 이전 주차가 완료되어야 다음 주차를 시작한다.')),
        card('데이터 품질 판정', pill(d.quality.decision_label, d.quality.decision === 'blocked' ? 'bad' : d.quality.decision === 'ready' ? 'ok' : 'neutral'), d.quality.reasons.length ? h('ul', { class: 'small' }, d.quality.reasons.map((r) => h('li', null, r))) : null));
    },
    protect: async () => {
      const pr = d.protection; const lim = {}; const canEdit = S.can('consultant', 'exec');
      const ctl = (k, label) => { const i = input('number', pr.metrics.find((m) => m.key === { missing_max: 'missing', delay_max: 'delay', unauthorized_max: 'unauthorized', burden_max: 'burden' }[k]).limit ?? '', { min: '0', placeholder: '미설정', disabled: !canEdit, 'aria-label': label }); lim[k] = i; return field(label, i); };
      return h('div', null,
        card('보호 지표', h('div', { class: 'grid g4' }, pr.metrics.map((m) => { const bad = m.limit != null && m.value != null && m.value > m.limit; return h('div', { class: `callout ${bad ? 'danger' : ''}`, style: 'margin:0' }, h('b', null, m.label), h('div', { style: 'font-size:1.6rem;font-weight:700' }, m.value == null ? '—' : `${m.value}${m.unit}`), h('div', { class: 'small' }, m.def), h('div', { class: 'tiny muted' }, `경고 신호: ${m.hint}`), m.extra ? h('div', { class: 'tiny' }, m.extra) : null, h('div', { class: 'small', style: 'margin-top:4px' }, m.limit == null ? '중단 기준: 미설정(현장이 정한다)' : `중단 기준: ${m.limit}${m.unit} 초과 시`)); }),
          pr.stop ? callout('danger', h('b', null, '중단 신호: '), `${pr.breached.join(', ')} — 자동 실행을 멈추고 재검토를 배정합니다.`) : null), note(pr.rule_note)),
        card('중단 기준 정하기', note('중단 기준은 현장이 정한다. 설정하지 않은 지표는 경고만 하고 중단하지 않는다. 기본값은 무권한 승인 > 0.'),
          h('div', { class: 'field-row' }, ctl('missing_max', '빠진 값(%) 초과 시 중단'), ctl('delay_max', '업무 지연(열린 보류 건) 초과 시 중단'), ctl('unauthorized_max', '무권한 승인(건) 초과 시 중단'), ctl('burden_max', '기록 부담(분) 초과 시 중단')),
          canEdit ? actionBtn('중단 기준 저장', async () => { await api.put(`/engagements/${id}/protection-rules`, Object.fromEntries(Object.entries(lim).map(([k, el]) => [k, el.value]))); toast('저장했습니다.'); await reload(); }) : note('컨설턴트·경영진만 변경합니다.')),
        card('보호 지표 정의', table(['지표', '정의', '경고 신호'], P.protection.map((x) => [x.name, x.def, x.warn]))));
    },
    daily: async () => {
      const cl = await api.get(`/engagements/${id}/closes`);
      const day = input('date', new Date().toISOString().slice(0, 10)); const bm = input('number', '', { min: '0', placeholder: '분' }); const nt = input('text', '', { placeholder: '메모(정정은 사유 필수)' });
      const corr = select([['', '(새 마감)'], ...cl.filter((c) => !c.correction_of).map((c) => [String(c.id), `${c.day} 마감 정정`])], '');
      return h('div', null,
        card('일별 운영 마감과 예외 통제', h('div', { class: 'pipeline' }, P.daily.map((x) => h('div', { class: 'step' }, h('b', null, `${x.n}. ${x.name}`), x.desc))), note(P.daily_note)),
        card('마감 기록', cl.length ? table(['일', '준비', '검토', '미확인', '예비', '미해결 예외', '기록 부담(분)', '구분', '메모', '마감자'], cl.map((c) => [c.day, c.counts.approved, c.counts.review, c.counts.unconfirmed, c.counts.reserve, c.open_exceptions, c.burden_minutes ?? '—', c.correction_of ? pill(`정정(#${c.correction_of})`, 'neutral') : pill(c.id === cl[0].id ? '기준선' : '마감', 'ok'), c.note || '', c.closed_by]), { num: [1, 2, 3, 4, 5, 6] }) : h('p', { class: 'muted small' }, '첫날에 근거 자료·기준선을 고정합니다. 아직 마감 기록이 없습니다.'),
          S.can('field', 'consultant', 'fde') ? h('div', { style: 'margin-top:12px' }, h('div', { class: 'field-row' }, field('마감일', day), field('기록 부담(분)', bm), field('정정 대상', corr), field('메모', nt)), actionBtn('마감', async () => { await api.post(`/engagements/${id}/closes`, { day: day.value, burden_minutes: bm.value === '' ? undefined : Number(bm.value), note: nt.value || undefined, correction_of: corr.value ? Number(corr.value) : undefined }); toast('마감했습니다.'); await reload(); }), note('이미 마감된 날은 다음 날로 숨기지 않고 정정 기록으로 더합니다. 정합성(잔차 0)이 깨지면 마감이 거부되고 자동 실행이 멈춥니다.')) : note('현장 담당자·컨설턴트·FDE가 마감합니다.')));
    },
    compare: async () => {
      const cl = await api.get(`/engagements/${id}/closes`);
      const b1 = input('date', d.basis_date); const b2 = input('date', new Date().toISOString().slice(0, 10)); const out = h('div');
      const flags = { concurrent_change: '동시기에 다른 제도가 바뀌었다', terms_changed: '거래 조건이 달라졌다', definition_changed: '기준 정의가 중간에 바뀌었다', cannot_recompute: '같은 정의로 재계산하지 못했다' };
      const cks = Object.entries(flags).map(([k, l]) => [k, h('input', { type: 'checkbox' }), l]);
      const run = async () => {
        const body = { before_basis: b1.value, before_known: b1.value, after_basis: b2.value }; cks.forEach(([k, el]) => { body[k] = el.checked; });
        const r = await api.post(`/engagements/${id}/compare`, body); clear(out);
        out.append(card('전후 비교 결과', callout(r.comparable ? '' : 'warn', h('b', null, r.comparable ? '비교 가능 조건 충족. ' : '효과를 단정하면 안 됩니다. '), r.memo),
          h('div', { class: 'grid g2' }, h('div', null, h('h4', null, `이전 ${r.before.basis.slice(0, 10)}`), h('div', { class: 'kpis' }, kpi('준비', r.before.counts.approved, 'k-approved'), kpi('부족', r.before.metrics.shortage, 'k-shortage')), h('div', { class: 'small' }, `충족률 ${pct(r.before.metrics.fulfilment_rate)}`)),
            h('div', null, h('h4', null, `이후 ${r.after.basis.slice(0, 10)}`), h('div', { class: 'kpis' }, kpi('준비', r.after.counts.approved, 'k-approved'), kpi('부족', r.after.metrics.shortage, 'k-shortage')), h('div', { class: 'small' }, `충족률 ${pct(r.after.metrics.fulfilment_rate)}`))),
          h('h4', { style: 'margin-top:12px' }, '비교가 가능한 조건'), table(['조건', '충족', '내용'], r.conditions.map((c) => [c.label, h('span', { class: c.ok ? 'pass' : 'fail' }, c.ok ? '✓' : '✗'), c.detail])),
          h('p', { class: 'small' }, `상태 이동 ${r.transitions.moved}건 · 보존식 ${r.transitions.conserved ? '일치' : '불일치'}`), note('수치 옆에 비교 가능성 메모를 함께 적는다. 사후 비교만으로 새 플랫폼의 인과 효과를 단정하지 않는다.', 'warn')));
      };
      await run();
      return h('div', null,
        h('div', { class: 'grid g2' }, card('비교가 가능한 조건', h('ul', { class: 'small' }, P.comparable.yes.map((x) => h('li', null, '✓ ', x)))), card('효과를 단정하면 안 되는 경우', h('ul', { class: 'small' }, P.comparable.no.map((x) => h('li', null, '✗ ', x))))),
        card('전후 비교 설정', h('div', { class: 'field-row' }, field('이전(기준일)', b1), field('이후(기준일)', b2)), h('label', null, '해당하면 체크'), cks.map(([k, el, l]) => h('label', { class: 'check', style: 'font-weight:400;margin:0' }, el, l)), actionBtn('비교', run)), out);
    },
    report: async () => {
      const r = await api.get(`/engagements/${id}/report`);
      const sec = (s) => {
        const c = [];
        if (s.body) c.push(h('p', null, s.body));
        if (s.identities) c.push(h('div', null, h('div', { class: 'small muted' }, '현재'), s.identities.map(equation), s.baseline_identities ? [h('div', { class: 'small muted' }, '기준선'), s.baseline_identities.map(equation)] : null), h('p', { class: 'small' }, `완료율 ${pct(s.rates.completion)} · 승인율 ${pct(s.rates.approval)} · 충족률 ${pct(s.rates.fulfilment)}`));
        if (s.groups) c.push(table(['범주', '요구', '준비', '부족', '구성(검토·미확인·진행·예비)'], s.groups.map((g) => [g.name, g.required, g.approved, g.shortage, `${g.parts.review}·${g.parts.unconfirmed}·${g.parts.in_progress}·${g.parts.reserve}`]), { num: [1, 2, 3] }));
        if (s.hypotheses) c.push(table(['후보', '진술', '상태', '다른 가능성 확인 자료'], s.hypotheses.map((x) => [x.code, x.statement, x.status === 'need_evidence' ? '추가 근거 자료 필요' : x.status, x.disconfirm])));
        if (s.interventions) c.push(table(['조치', '제목', '상태', '승인 역할'], s.interventions.map((x) => [x.code, x.title, x.status, x.required_roles.join('·')])));
        if (s.lines) c.push(h('p', null, `비용 가정 합계 ${won(s.total_assumed_amount)}`), table(['조치', '금액(가정)', '인시'], s.lines.map((l) => [l.code, won(l.amount), l.person_hours])));
        if (s.disclaimer) c.push(note(s.disclaimer, 'warn'));
        if (s.first_close !== undefined) c.push(h('p', { class: 'small' }, `첫 마감 ${s.first_close ? `${s.first_close.day} (준비 ${s.first_close.counts.approved})` : '없음'} → 마지막 마감 ${s.last_close ? `${s.last_close.day} (준비 ${s.last_close.counts.approved})` : '없음'}`));
        if (s.open) c.push(h('p', { class: 'small' }, `열린 보류 ${s.open.holds} · 거부 큐 ${s.open.rejects} · 재검토 ${s.open.re_reviews}`));
        if (s.note) c.push(note(s.note));
        return h('div', { class: 'card', style: 'box-shadow:none' }, h('h3', null, `${s.no}. ${s.title}`), c);
      };
      const f = r.first_page;
      return h('div', null,
        h('div', { class: 'row no-print' }, h('button', { class: 'btn', onclick: () => window.print() }, '인쇄 / PDF 저장')),
        card(`${r.engagement.title}`, h('p', { class: 'muted small' }, `${r.engagement.request_code} / ${r.engagement.task_code} · 기준 시점 ${r.engagement.basis}`),
          h('div', { class: 'kpis' }, kpi(`기준선 요구(${f.baseline.basis})`, f.baseline.required), kpi('기준선 준비', f.baseline.approved, 'k-approved'), kpi('기준선 부족', f.baseline.shortage, 'k-shortage'), kpi('현재 준비', f.approved, 'k-approved', `요구 ${f.required}`), kpi('현재 부족', f.shortage, 'k-shortage')),
          f.remaining_by_group.length ? h('p', { class: 'small' }, '잔여 부족: ', f.remaining_by_group.map((g) => `${g.name} ${g.shortage}`).join(' · ')) : null, note(f.note)),
        ...r.sections.map(sec),
        card('이 보고서가 말하지 않는 것', h('ul', { class: 'small' }, r.not_claimed.map((x) => h('li', null, '− ', x))), note('노무 판단은 공인노무사와 인사 책임자가, 법률·회계·고객 계약은 해당 업무 책임자가 별도로 확인한다.')),
        card('현장 시험 인계서 점검 (서식 6)', table(['항목', '확인 내용'], P.handoff_check.map((x) => [h('b', null, x.name), x.desc])), h('button', { class: 'btn ghost no-print', onclick: () => { location.hash = '#/forms?no=6'; } }, '서식 6 작성')),
        r.disclaimer ? note(r.disclaimer, 'warn') : null);
    },
  };
  async function draw() { clear(body); body.append(await views[tab]()); }
  const mount = () => { clear(holder); holder.append(h('div', { class: 'row sb' }, h('h1', null, '현장 시험·보고'), h('span', { class: 'small muted' }, `${d.engagement.request_code} / ${d.engagement.task_code}`)), tabs(T, tab, (k) => { tab = k; mount(); }), body); draw(); };
  mount();
  return holder;
}
