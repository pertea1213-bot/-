import { h, card, table, note, callout, pill, badge, clear, field, input, select, textarea, actionBtn, toast, tabs, kpi, stackBar, legend, pct, n, won, fmtTs, STATUS_NAME, BUCKET_NAME, roleName, groupBars } from '../ui.js';
import * as api from '../api.js';

export async function render({ S, go }) {
  if (!S.engId) return card('사례가 없습니다');
  const id = S.engId; let d = await S.load(true); const ad = d.adapter;
  const proc = await S.content('process');
  let tab = 'iv';
  const holder = h('div'); const body = h('div');
  const T = [{ key: 'iv', label: '조치 후보·승인' }, { key: 'sim', label: '시뮬레이션·비용 가정' }, { key: 'holds', label: '보류·재검토' }, { key: 'sync', label: '외부 시스템 연계' }];
  const rn = (r) => roleName(S.meta, r, ad);
  const reload = async () => { S.invalidate(); d = await S.load(true); await draw(); };

  const views = {
    iv: async () => {
      const ivs = await api.get(`/engagements/${id}/interventions`);
      const keyLabel = (k) => (k === '_START' ? ad.start_label : (ad.requirements.find((r) => r.key === k) || {}).label || k);
      const list = ivs.map((iv) => {
        const approved = new Set(iv.approvals.filter((a) => a.decision === 'approve').map((a) => a.role));
        const doneN = iv.targets.filter((t) => t.outcome).length;
        const acts = h('div', { class: 'row', style: 'margin-top:10px' });
        if (iv.status === 'DRAFT' && S.can('consultant')) acts.append(actionBtn('승인서 제출', async () => { await api.post(`/engagements/${id}/interventions/${iv.id}/submit`); toast('결재를 요청했습니다.'); await reload(); }));
        if (iv.status === 'SUBMITTED') {
          const cm = input('text', '', { placeholder: '의견(선택)', style: 'max-width:240px' });
          if (iv.required_roles.includes(S.role()) && !approved.has(S.role())) acts.append(cm, actionBtn('승인', async () => { const r = await api.post(`/engagements/${id}/interventions/${iv.id}/decide`, { decision: 'approve', comment: cm.value }); toast(r.status === 'APPROVED' ? '모든 필수 승인이 끝났습니다. (수량은 아직 그대로입니다)' : '승인했습니다. 다른 역할의 승인을 기다립니다.'); await reload(); }), actionBtn('반려', async () => { await api.post(`/engagements/${id}/interventions/${iv.id}/decide`, { decision: 'reject', comment: cm.value }); await reload(); }, { cls: 'ghost' }));
          else acts.append(h('span', { class: 'small muted' }, iv.required_roles.includes(S.role()) ? '이 역할은 이미 승인했습니다.' : `승인 권한 없음 — ${iv.required_roles.map(rn).join('·')}이(가) 결재합니다.`), actionBtn('(체험) 권한 없이 승인 시도', async () => { await api.post(`/engagements/${id}/interventions/${iv.id}/decide`, { decision: 'approve' }); }, { cls: 'ghost sm', title: '거부되고 처리 기록에 남습니다' }));
        }
        if (iv.status === 'APPROVED') acts.append(actionBtn('실행 시작', async () => { await api.post(`/engagements/${id}/interventions/${iv.id}/start`); toast('실행을 시작했습니다.'); await reload(); }), h('span', { class: 'small muted' }, '승인 ≠ 완료 — 확인된 근거가 생겨야 수량이 바뀝니다.'));
        if (iv.status === 'IN_EXECUTION') acts.append(actionBtn('조치 종료', async () => { await api.post(`/engagements/${id}/interventions/${iv.id}/close`); toast('종료했습니다.'); await reload(); }, { cls: 'ghost' }), h('span', { class: 'small muted' }, `결과 기록 ${doneN}/${iv.targets.length}`));
        if (['APPROVED', 'IN_EXECUTION'].includes(iv.status) && S.can('exec', 'sec', 'reviewer', 'manager', 'it', 'hr')) acts.append(actionBtn('중단', async () => { const r = window.prompt('중단 사유(필수)'); if (!r) return; await api.post(`/engagements/${id}/interventions/${iv.id}/stop`, { reason: r }); await reload(); }, { cls: 'danger sm' }));
        const targets = iv.targets.length ? h('details', { open: iv.status === 'IN_EXECUTION' }, h('summary', { class: 'small' }, `대상 ${iv.targets.length} (${iv.target_bucket ? BUCKET_NAME[iv.target_bucket] : ''})`),
          table(['대상', '결과', iv.status === 'IN_EXECUTION' ? '결과 기록' : ''], iv.targets.map((t) => {
            let rec = '';
            if (iv.status === 'IN_EXECUTION' && !t.outcome) { const oc = select([['verified', '해결(확인됨)'], ['unmet', '해결 안 됨 → 보류'], ['missing', '근거 없음 → 보류']], 'verified'); const sr = input('text', '', { placeholder: '자료 식별번호', style: 'max-width:140px' }); rec = h('div', { class: 'row' }, oc, sr, actionBtn('기록', async () => { await api.post(`/engagements/${id}/interventions/${iv.id}/outcome`, { item_id: t.item_id, outcome: oc.value, source_ref: sr.value || undefined }); toast('결과를 기록했습니다.'); await reload(); }, { cls: 'sm' })); }
            return [h('b', { class: 'mono' }, t.ref_key), t.outcome ? pill(t.outcome === 'verified' ? '해결' : '보류', t.outcome === 'verified' ? 'ok' : 'bad') : pill('미실시'), rec]; }))) : null;
        return h('div', { class: 'card', style: 'margin-bottom:12px' },
          h('div', { class: 'row sb' }, h('h3', { style: 'margin:0' }, `${iv.code} · ${iv.title}`), pill(STATUS_NAME[iv.status] || iv.status, iv.status === 'APPROVED' || iv.status === 'CLOSED' ? 'ok' : iv.status === 'STOPPED' || iv.status === 'REJECTED' ? 'bad' : 'neutral')),
          h('p', { class: 'small' }, iv.description),
          h('div', { class: 'grid g2' },
            h('div', null, h('h4', null, '승인서에 적을 5가지'), table(['항목', '내용'], [['대상', iv.targets.length ? `${iv.targets.length}${ad.unit}${iv.task_key ? ` · ${keyLabel(iv.task_key)} 재확인` : ''}` : '전체 단계(구조 변경)'], ['권한(결재)', iv.required_roles.map((r) => `${rn(r)} ${approved.has(r) ? '✓' : '○'}`).join(' + ')], ['비용', iv.cost_calc ? (iv.cost_calc.lines.length ? `가상 ${won(iv.cost_calc.amount)}` : (iv.cost.note || '—')) : '원문에 비용 수치 없음'], ['중단 조건', iv.stop_condition || h('span', { class: 'fail' }, '비어 있음')], ['복구 경로', iv.recovery_path || h('span', { class: 'fail' }, '비어 있음')]])),
            iv.cost_calc && iv.cost_calc.lines.length ? h('div', null, h('h4', null, '비용 가정(교육용 업무 부담)'), table(['항목', '인시', '금액'], iv.cost_calc.lines.map((l) => [l.label, l.person_hours, won(l.amount)]), { num: [1, 2] }), note(iv.cost_calc.disclaimer, 'warn'), iv.cost.note ? note(iv.cost.note) : null) : h('div', null, iv.cost && iv.cost.note ? note(iv.cost.note) : null)),
          targets, acts);
      });
      return h('div', null,
        callout('warn', h('b', null, '승인 ≠ 완료. '), `조치 경로 승인만으로 실제 완료·대외 사용 가능 수량을 올리지 않습니다(T7). 지금 준비 ${d.counts.approved}${ad.unit} — 승인 뒤에도 재확인 결과(근거)가 기록되기 전에는 그대로입니다.`),
        h('h3', null, '조치 후보 — 작은 것부터'), ...list, S.can('consultant') ? newIv(S, id, d, ad, reload) : note('새 조치는 컨설턴트가 제안합니다. 컨설턴트·FDE·운영자는 승인할 수 없습니다.'),
        card('결재 이력', await approvalsTable(id, ivs)));
    },
    sim: async () => {
      const [scs, ivs] = await Promise.all([api.get(`/engagements/${id}/scenarios`), api.get(`/engagements/${id}/interventions`)]);
      const out = h('div');
      const run = async (sid) => {
        const r = await api.get(`/engagements/${id}/scenarios/${sid}/simulate`); clear(out);
        out.append(card('시뮬레이션 결과 (가정)', callout('warn', r.label),
          h('div', { class: 'grid g2' }, h('div', null, h('h4', null, '최초(현재)'), groupBars(r.before.groups), stackBar(r.before.counts, r.before.counts.required)), h('div', null, h('h4', null, '조치 후(가정)'), groupBars(r.after.groups), stackBar(r.after.counts, r.after.counts.required))), legend(),
          h('div', { class: 'kpis', style: 'margin-top:12px' }, kpi('이동 합계', r.moved), kpi('준비(가정)', r.after.counts.approved, 'k-approved', `최초 ${r.before.counts.approved}`), kpi('잔여 부족', r.after.metrics.shortage, 'k-shortage', `최초 ${r.before.metrics.shortage}`)),
          note(r.note), table(['이동', '인원'], Object.entries(r.matrix).map(([k, v]) => [k.split('>').map((b) => BUCKET_NAME[b]).join(' → '), v]), { num: [1] }),
          h('h4', { style: 'margin-top:12px' }, '남은 대상'), table([ad.item_label ? `${ad.item_label}` : '대상', ad.group_label, '현재 칸'], r.remaining.map((x) => [h('b', { class: 'mono' }, x.ref_key), x.group, badge(x.bucket)])), note('타 부서 여유로 바로 메우지 않는다 — 직무·근무지·시프트가 다르면 대체 불가. 잔여 대상이 모두 확인되어야 한다.')));
      };
      const costIv = ivs.filter((i) => i.cost_calc && i.cost_calc.lines.length); const total = costIv.reduce((s, i) => s + i.cost_calc.amount, 0);
      return h('div', null,
        card('가정 시나리오', scs.map((s) => h('div', { class: 'callout', style: 'margin:0 0 8px' }, h('b', null, s.name), h('div', { class: 'small' }, s.note), h('div', { style: 'margin-top:6px' }, actionBtn('시뮬레이션 실행', () => run(s.id))))), out),
        card('조치 3경로 시뮬레이션', table(['경로', '승인권', '소요 시간', '조건부 성공량', '실패 시 복구'], proc.paths.map((p) => [p.name, p.authority, h('input', { type: 'text', 'aria-label': '소요 시간', placeholder: '직접 입력' }), p.gain, h('input', { type: 'text', 'aria-label': '실패 시 복구', placeholder: '직접 입력' })])), note(proc.paths_note)),
        card('비용은 ‘가정’이다', total ? h('div', null, h('div', { class: 'bar' }, costIv.map((i, k) => h('span', { style: `width:${(i.cost_calc.amount / total) * 100}%;background:${k ? 'var(--in_progress)' : 'var(--approved)'}`, title: `${i.code} ${won(i.cost_calc.amount)}` }))), h('p', null, costIv.map((i) => `${i.code} ${won(i.cost_calc.amount)} (${Math.round((i.cost_calc.amount / total) * 100)}%)`).join(' + '), ' = ', h('b', null, won(total)), ' (가정)')) : null, note(proc.money.note, 'warn')));
    },
    holds: async () => {
      const [hs, rr] = await Promise.all([api.get(`/engagements/${id}/holds`), api.get(`/engagements/${id}/re-reviews`)]);
      return h('div', null,
        card('보류 (낙관적 잠금 — 동시에 해제하면 한쪽만 성공)', hs.length ? table(['대상', '상태', '버전', '사유', '열린 시각', ''], hs.map((x) => [h('b', { class: 'mono' }, x.ref_key), x.status === 'open' ? pill('열림', 'bad') : pill('해제'), x.version, x.reason, fmtTs(x.opened_at), x.status === 'open' && S.can('manager', 'it', 'hr', 'exec') ? actionBtn('해제', async () => { const r = window.prompt('해제 사유'); if (!r) return; await api.post(`/engagements/${id}/holds/${x.id}/release`, { expected_version: x.version, reason: r }); toast('해제했습니다.'); await reload(); }, { cls: 'ghost sm' }) : ''])) : h('p', { class: 'muted small' }, '열린 보류가 없습니다. 조치 후에도 해결되지 않은 대상은 자동으로 보류가 열립니다.')),
        card('재검토 배정', rr.length ? table(['유형', '사유', '상태', ''], rr.map((x) => [x.subject_type, x.reason, x.status === 'open' ? pill('열림', 'bad') : pill('처리됨'), x.status === 'open' && S.can('reviewer', 'manager', 'it', 'hr', 'exec') ? actionBtn('처리', async () => { await api.post(`/engagements/${id}/re-reviews/${x.id}/resolve`, { note: '확인함' }); await reload(); }, { cls: 'ghost sm' }) : ''])) : h('p', { class: 'muted small' }, '없습니다.')));
    },
    sync: async () => {
      const [sy, ivs] = await Promise.all([api.get(`/engagements/${id}/sync`), api.get(`/engagements/${id}/interventions`)]);
      const tech = await S.content('tech'); const cur = sy.stages.indexOf(sy.stage);
      const reqable = ivs.filter((i) => ['IN_EXECUTION', 'CLOSED'].includes(i.status) && i.targets.some((t) => t.outcome));
      const PS = { requested: '요청됨', approved: '결재됨', rejected: '반려' };
      const ES = { not_sent: '미전송', accepted: '수락', failed: '실패', manual_reconciled: '수동 처리' };
      const stageCtl = [];
      if (S.can('it', 'exec')) {
        if (cur > 0) stageCtl.push(actionBtn('한 단계 낮추기', async () => { await api.post(`/engagements/${id}/sync/stage`, { stage: sy.stages[cur - 1] }); await reload(); }, { cls: 'ghost' }));
        if (cur < 3) stageCtl.push(actionBtn(`다음 단계 열기 → ${tech.sync_stages[cur + 1].name}`, async () => { await api.post(`/engagements/${id}/sync/stage`, { stage: sy.stages[cur + 1] }); await reload(); }));
      } else stageCtl.push(note('단계 변경은 정보 담당·경영진이 합니다.'));
      const failToggle = S.role() === 'admin' ? h('div', { class: 'row', style: 'margin-top:10px' },
        h('span', { class: 'small' }, `모의 원천 시스템: ${sy.external_mode === 'fail' ? '장애' : '정상'}`),
        actionBtn(sy.external_mode === 'fail' ? '장애 해제' : '모의 장애 주입', async () => { await api.post('/admin/external-mode', { mode: sy.external_mode === 'fail' ? 'ok' : 'fail' }); await reload(); }, { cls: 'ghost sm' })) : null;
      const rowActions = (s) => {
        const acts = [];
        if (s.platform_status === 'requested' && S.can('it', 'exec')) acts.push(actionBtn('결재', async () => { await api.post(`/engagements/${id}/sync/${s.id}/approve`); await reload(); }, { cls: 'sm' }));
        if (S.can('fde', 'it')) acts.push(actionBtn('전송', async () => { const r = await api.post(`/engagements/${id}/sync/${s.id}/send`); toast(r.message || r.note || r.external_status); await reload(); }, { cls: 'ghost sm' }));
        if (s.external_status === 'failed' && S.can('it', 'hr', 'manager')) acts.push(actionBtn('수동 비교 확인', async () => { const r = window.prompt('수동 비교 확인 결과'); if (!r) return; await api.post(`/engagements/${id}/sync/${s.id}/reconcile`, { note: r }); await reload(); }, { cls: 'ghost sm' }));
        return h('div', { class: 'row' }, acts);
      };
      const reqBtns = reqable.length && S.can('fde', 'it')
        ? h('div', { class: 'row' }, reqable.map((i) => actionBtn(`${i.code} 결과 반영 요청`, async () => { const r = await api.post(`/engagements/${id}/sync`, { subject_type: 'intervention', subject_id: i.id }); toast(r.duplicate ? '이미 같은 요청이 있습니다(멱등).' : '요청했습니다.'); await reload(); }, { cls: 'ghost' })))
        : note('결과가 기록된 조치가 있고, FDE·정보 담당일 때 요청할 수 있습니다. 읽기 단계에서는 요청할 수 없습니다.');
      const syncTable = table(['요청', '단계', '플랫폼 결재', '외부 수락', '시도', '오류', ''], sy.items.map((s) => [
        h('span', { class: 'mono small' }, s.idem_key), s.stage,
        pill(PS[s.platform_status], s.platform_status === 'approved' ? 'ok' : 'neutral'),
        pill(ES[s.external_status], ['accepted', 'manual_reconciled'].includes(s.external_status) ? 'ok' : s.external_status === 'failed' ? 'bad' : 'neutral'),
        s.attempts, h('span', { class: 'tiny' }, s.last_error || ''), rowActions(s)]));
      return h('div', null,
        callout('', tech.sync_rule, ' 외부 시스템 쓰기 연계는 읽기·시뮬레이션·수동 승인·제한된 실운영의 순서로 단계적으로 검수한다.'),
        card('연계 단계: 4단계로 연다',
          h('div', { class: 'pipeline' }, tech.sync_stages.map((s, i) => h('div', { class: `step ${i === cur ? 'on' : ''}` }, h('b', null, `${s.n}. ${s.name}`), s.desc))),
          h('div', { class: 'row', style: 'margin-top:10px' }, stageCtl), failToggle),
        card('반영 요청', reqBtns, syncTable,
          note('플랫폼의 결재와 외부 시스템의 수락은 별도 상태입니다. 요청자는 자신의 요청을 결재할 수 없고, 같은 요청 키(멱등)는 한 번만 외부에 반영됩니다.')));
    },
  };
  async function draw() { clear(body); body.append(await views[tab]()); }
  const mount = () => { clear(holder); holder.append(h('div', { class: 'row sb' }, h('h1', null, '조치·승인·외부 연계'), h('span', { class: 'small muted' }, `${d.engagement.request_code} / ${d.engagement.task_code} · 현재 준비 ${d.counts.approved}/${d.counts.required}`)), tabs(T, tab, (k) => { tab = k; mount(); }), body); draw(); };
  mount();
  return holder;
}

async function approvalsTable(id, ivs) {
  const rows = ivs.flatMap((iv) => iv.approvals.map((a) => [iv.code, a.role, a.username, a.decision === 'approve' ? pill('승인', 'ok') : a.decision === 'reject' ? pill('반려', 'bad') : pill('중단', 'bad'), a.comment || '', fmtTs(a.created_at)]));
  return rows.length ? table(['조치', '역할', '결재자', '결정', '의견', '시각'], rows) : h('p', { class: 'muted small' }, '아직 결재 기록이 없습니다.');
}

function newIv(S, id, d, ad, reload) {
  const t = input('text', '', { placeholder: '조치 제목' }); const desc = textarea('', { rows: '2' });
  const bucket = select([['', '(대상 없음)'], ['review', '검토'], ['unconfirmed', '미확인'], ['in_progress', '진행'], ['reserve', '예비']], 'review');
  const key = select([['', '(없음)'], ['_START', ad.start_label], ...ad.requirements.map((r) => [r.key, r.label])], ad.requirements[1] ? ad.requirements[1].key : '');
  const roles = Object.entries(S.meta.roles).filter(([r]) => !['consultant', 'fde', 'admin', 'learner'].includes(r));
  const chk = roles.map(([r, v]) => [r, h('input', { type: 'checkbox', checked: ['it', 'manager'].includes(r) })]);
  const qty = input('number', '8', { min: '0' }); const mins = input('number', '15', { min: '0' }); const rate = input('number', '25000', { min: '0' });
  const stop = input('text', '', { placeholder: '예: 무권한 승인이 1건이라도 확인되면 즉시 중단' }); const rec = input('text', '', { placeholder: '예: 변경 전 상태 이력으로 복원' });
  return card('새 조치 제안', note('승인서에는 대상·권한·비용·중단 조건·복구 경로가 모두 있어야 제출됩니다. 승인 역할에 컨설턴트·FDE·운영자는 지정할 수 없습니다.'),
    h('div', { class: 'field-row' }, field('제목', t, null, true), field('대상 칸', bucket), field('재확인할 요건', key)), field('설명', desc),
    h('label', null, '승인 역할(권한)'), h('div', { class: 'row' }, chk.map(([r, el]) => h('label', { class: 'row', style: 'font-weight:400;margin:0' }, el, S.meta.roles[r].label))),
    h('div', { class: 'field-row' }, field('비용: 건수', qty), field('건당 분', mins), field('시간비(원/시간, 가정)', rate)), h('div', { class: 'field-row' }, field('중단 조건', stop, null, true), field('복구 경로', rec, null, true)),
    actionBtn('조치 초안 만들기', async () => {
      await api.post(`/engagements/${id}/interventions`, { title: t.value, description: desc.value, kind: 'alt1', target_bucket: bucket.value || undefined, task_key: key.value || undefined, required_roles: chk.filter(([, el]) => el.checked).map(([r]) => r), cost: { lines: [{ label: `${t.value} ${qty.value}건 × ${mins.value}분`, qty: Number(qty.value), minutes: Number(mins.value), rate: Number(rate.value) }], note: '교육용 업무 부담 가정' }, stop_condition: stop.value, recovery_path: rec.value });
      toast('초안을 만들었습니다. 제출하면 결재가 시작됩니다.'); await reload();
    }));
}
