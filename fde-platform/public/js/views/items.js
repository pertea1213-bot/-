import { h, card, table, note, callout, pill, badge, clear, drawer, field, input, select, textarea, actionBtn, toast, BUCKETS, BUCKET_NAME, VALUE_NAME, fmtTs, fmtDay, roleName, tabs } from '../ui.js';
import * as api from '../api.js';

export async function render({ S }) {
  if (!S.engId) return card('사례가 없습니다');
  const id = S.engId;
  let d = await S.load(true);
  const ad = d.adapter; const reqs = d.rule ? d.rule.required_keys : [];
  const keyLabel = (k) => (k === '_START' ? ad.start_label : (ad.requirements.find((r) => r.key === k) || {}).label || k);
  const f = { bucket: 'all', group: 'all', q: '', limit: 200 };
  const listEl = h('div'); const side = h('div');
  const iconOf = (v) => ({ verified: ['✓', 'ok'], unmet: ['△', 'review'], pending: ['…', 'in_progress'], missing: ['?', 'unconfirmed'] }[v] || ['·', 'reserve']);

  const redraw = () => {
    clear(listEl);
    const rows = d.items.filter((i) => (f.bucket === 'all' || i.bucket === f.bucket) && (f.group === 'all' || i.group_code === f.group) && (!f.q || i.ref_key.toLowerCase().includes(f.q.toLowerCase())));
    const shown = rows.slice(0, f.limit);
    listEl.append(table(['대상', ad.group_label, '판정', ...reqs.map(keyLabel), '일자', '사유'],
      shown.map((i) => ({
        onclick: () => openItem(i.id),
        cells: [h('b', { class: 'mono' }, i.ref_key), i.group_name, badge(i.bucket),
          ...reqs.map((k) => { if (i.bucket === 'reserve') return h('span', { class: 'muted', title: '착수 전 — 요건 판정 대상이 아님' }, '·'); const v = i.req[k]; const [ic, kind] = iconOf(v.value); return h('span', { title: `${keyLabel(k)}: ${VALUE_NAME[v.value] || v.value}${v.source_ref ? ` (${v.source_ref})` : ''}`, class: `badge ${kind === 'ok' ? 'b-ok' : `b-${kind}`}` }, ic); }),
          i.started_on ? `${ad.start_label} ${i.started_on}` : (i.planned_on ? `예정 ${i.planned_on}` : '—'), h('span', { class: 'tiny muted' }, i.reasons.map(reasonText).join(' · '))],
      }))));
    if (rows.length > shown.length) listEl.append(h('div', { class: 'row', style: 'margin-top:8px' }, h('span', { class: 'small muted' }, `${rows.length}건 중 ${shown.length}건 표시`), h('button', { class: 'btn ghost sm', onclick: () => { f.limit += 400; redraw(); } }, '더 보기'), h('button', { class: 'btn ghost sm', onclick: () => { f.limit = rows.length; redraw(); } }, '모두 보기')));
    listEl.append(h('p', { class: 'tiny muted' }, `${rows.length}건 · ✓ 확인됨 · △ 미충족 · … 진행 중 · ? 근거 없음/불명 — 행을 눌러 근거·이력·실행 작업을 엽니다.`));
  };
  const reasonText = (r) => ({ 'FOLLOWUP_PENDING': '확인 진행 중', 'START_UNTRACEABLE': '착수 근거 식별번호 없음', 'GATE:open_hold': '열린 보류', 'GATE:group_match': '범주 불일치', 'GATE:duplicate_assignment': '중복 배정', 'GATE:no_rule': '유효 규칙 없음' }[r] || (r.startsWith('MISSING:') ? `근거 없음: ${keyLabel(r.slice(8))}` : r.startsWith('UNMET:') ? `미충족: ${keyLabel(r.slice(6))}` : r));

  async function openItem(itemId) {
    const det = await api.get(`/engagements/${id}/items/${itemId}`);
    const it = det.item; const body = h('div');
    const openHold = det.holds.find((x) => x.status === 'open');
    body.append(h('div', { class: 'row' }, badge(it.bucket), pill(it.group_name), it.reasons.length ? h('span', { class: 'small muted' }, it.reasons.map(reasonText).join(' · ')) : null),
      h('h3', { style: 'margin-top:14px' }, '판정 5조건(게이트)'),
      h('div', { class: 'row small' }, ['group_match:하위 대상 일치', 'rule_valid:유효 규칙', 'evidence_linked:근거 자료 증거', 'position_ok:현재 위치(보류 없음)', 'no_duplicate:중복 배정 없음'].map((s) => { const [k, l] = s.split(':'); return pill(`${it.gates[k] ? '✓' : '✗'} ${l}`, it.gates[k] ? 'ok' : 'bad'); })),
      h('h3', { style: 'margin-top:14px' }, `‘준비’ 요건 (${reqs.length})`),
      table(['요건', '판정값', '자료 식별번호', '발생', '메모'], reqs.map((k) => { const v = it.req[k]; return [keyLabel(k), pill(VALUE_NAME[v.value] || v.value, v.value === 'verified' ? 'ok' : v.value === 'missing' ? 'bad' : 'neutral'), v.source_ref || '—', fmtDay(v.occurred_at), v.note || (v.reason === 'UNTRACEABLE' ? '자료 식별번호 없음 → 미확인' : v.reason === 'DELIVERED_ONLY' ? '전달됨 ≠ 적용' : '')]; })),
      h('h3', { style: 'margin-top:14px' }, '근거 타임라인 (추가 전용 — 수정·삭제 없음)'),
      det.filtered ? note('현장 담당자는 본인이 입력한 근거만 봅니다(역할별 열람 최소화).') : null,
      h('div', { class: 'timeline' }, det.evidence.length ? det.evidence.map((e) => h('div', { class: `ev ${e.value}` },
        h('div', null, h('b', null, keyLabel(e.requirement_key)), ' ', pill(VALUE_NAME[e.value], e.value === 'verified' ? 'ok' : 'neutral'), ' ', e.status !== 'confirmed' ? pill(e.status === 'candidate' ? '후보(확정 전)' : '반려', e.status === 'candidate' ? 'bad' : 'neutral') : null, e.origin === 'ocr_ai' ? pill('AI/OCR 추출', 'neutral') : null, e.corrects_id ? pill(`정정(#${e.corrects_id})`, 'neutral') : null),
        h('div', { class: 'tiny muted' }, `발생 ${fmtTs(e.occurred_at)} · 기록 ${fmtTs(e.recorded_at)} · ${e.recorded_by}${e.source_ref ? ` · 자료 ${e.source_ref}` : ' · 자료 식별번호 없음'}`), e.note ? h('div', { class: 'small' }, e.note) : null,
        e.status === 'candidate' && det.can.confirm.includes(e.requirement_key) ? h('div', { class: 'row' }, actionBtn('확정', async () => { await api.post(`/engagements/${id}/evidence/${e.id}/confirm`); toast('확정했습니다.'); await refresh(itemId); }, { cls: 'sm' }), actionBtn('반려', async () => { const r = window.prompt('반려 사유(필수)'); if (!r) return; await api.post(`/engagements/${id}/evidence/${e.id}/reject`, { note: r }); await refresh(itemId); }, { cls: 'ghost sm' })) : null)) : h('p', { class: 'muted small' }, '기록된 근거가 없습니다 — 근거가 없으면 0도 승인도 아닌 미확인입니다.')),
      h('h3', { style: 'margin-top:14px' }, '배정·보류'),
      table(['배정', '상태', '일시'], det.assignments.map((a) => [`${a.group_name}`, a.status === 'active' ? pill('활성', 'ok') : '해제', fmtTs(a.created_at)])),
      det.holds.length ? table(['보류', '상태', '사유'], det.holds.map((x) => [`#${x.id} v${x.version}`, x.status === 'open' ? pill('열림', 'bad') : '해제', x.reason])) : null);
    // 실행 작업(역할별)
    const acts = h('div'); body.append(h('h3', { style: 'margin-top:14px' }, '실행 작업'), acts);
    if (det.can.register.length) {
      const key = select(det.can.register.map((k) => [k, keyLabel(k)]), det.can.register[0]); const val = select([['verified', '확인됨(verified)'], ['unmet', '미충족(unmet)'], ['pending', '진행 중(pending)'], ['missing', '근거 없음/불명(missing)'], ['delivered', '전달됨(delivered) — 적용 아님']], 'verified');
      const src = input('text', '', { placeholder: '예: LOG-123' }); const occ = input('date', new Date().toISOString().slice(0, 10)); const nt = input('text', ''); const ai = h('input', { type: 'checkbox' }); const corr = h('input', { type: 'checkbox' });
      acts.append(h('div', { class: 'callout' }, h('b', null, '근거 등록'), ' ', h('span', { class: 'small muted' }, det.can.confirm.length ? '(소유 역할이므로 바로 확정됩니다)' : '(후보로 등록됩니다 — 근거 자료 관리자가 확정해야 판정에 반영)'),
        h('div', { class: 'field-row' }, field('요건', key), field('값', val), field('자료 식별번호', src, '없으면 verified 라도 미확인으로 판정'), field('발생 일자', occ)), field('메모', nt),
        h('label', { class: 'check', style: 'font-weight:400' }, ai, 'AI/OCR 추출값(항상 후보)'),
        h('label', { class: 'check', style: 'font-weight:400' }, corr, '이 요건의 최신 근거를 정정(기존 기록은 보존)'),
        actionBtn('근거 등록', async () => {
          let corrects_id; if (corr.checked) { const last = det.evidence.filter((e) => e.requirement_key === key.value && e.status === 'confirmed').pop(); corrects_id = last && last.id; }
          const r = await api.post(`/engagements/${id}/evidence`, { item_id: it.id, requirement_key: key.value, value: val.value, source_ref: src.value || undefined, occurred_at: occ.value, note: nt.value || undefined, origin: ai.checked ? 'ocr_ai' : 'manual', corrects_id });
          toast(r.warnings && r.warnings.length ? r.warnings[0] : '등록했습니다.'); await refresh(itemId);
        })));
    } else acts.append(note(`이 역할(${roleName(S.meta, S.role(), ad)})은 근거를 등록할 수 없습니다.`));
    if (det.can.hold && !openHold) { const rs = input('text', '', { placeholder: '보류 사유' }); acts.append(h('div', { class: 'row' }, rs, actionBtn('보류 열기', async () => { await api.post(`/engagements/${id}/holds`, { item_id: it.id, reason: rs.value }); toast('보류를 열었습니다.'); await refresh(itemId); }, { cls: 'ghost' }))); }
    if (openHold) { const rs = input('text', '', { placeholder: '해제 사유' }); acts.append(h('div', { class: 'row' }, rs, actionBtn('보류 해제', async () => { await api.post(`/engagements/${id}/holds/${openHold.id}/release`, { expected_version: openHold.version, reason: rs.value }); toast('보류를 해제했습니다.'); await refresh(itemId); }, { cls: 'ghost' }))); }
    if (det.can.reassign) {
      const g = select(d.groups.map((x) => [x.code, x.name]), it.group_code); const rs = input('text', '', { placeholder: '변경 사유' }); const cur = det.assignments.find((a) => a.status === 'active');
      acts.append(h('div', { class: 'row' }, g, rs, actionBtn(`${ad.group_label} 변경`, async () => { await api.post(`/engagements/${id}/assignments`, { item_id: it.id, to_group_code: g.value, reason: rs.value, expected_assignment_id: cur && cur.id }); toast('배정을 바꿨습니다.'); await refresh(itemId); }, { cls: 'ghost' })));
    } else acts.append(note(`배정 변경 권한이 없습니다. 시도하면 거부되고 처리 기록에 남습니다(T10).`));
    if (dr) dr.close(); dr = drawer(`${it.ref_key} · ${it.group_name}`, body, () => { dr = null; });
  }
  let dr = null;
  async function refresh(itemId) { S.invalidate(); d = await S.load(true); redraw(); if (itemId) await openItem(itemId); await drawQueues(); }

  const bucketBtns = h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: (e) => { f.bucket = 'all'; f.limit = 200; mark(e.currentTarget); redraw(); } }, `전체 ${d.items.length}`),
    BUCKETS.map((b) => h('button', { class: 'btn ghost sm', onclick: (e) => { f.bucket = b; f.limit = 200; mark(e.currentTarget); redraw(); } }, `${BUCKET_NAME[b]} ${d.counts[b]}`)));
  const mark = (btn) => { bucketBtns.querySelectorAll('button').forEach((x) => x.classList.add('ghost')); btn.classList.remove('ghost'); };
  const grp = select([['all', `${ad.group_label} 전체`], ...d.groups.map((g) => [g.code, g.name])], 'all'); grp.addEventListener('change', () => { f.group = grp.value; redraw(); });
  const q = input('text', '', { placeholder: '대상 식별키 검색 (예: P-007)', 'aria-label': '검색' }); q.addEventListener('input', () => { f.q = q.value; redraw(); });
  redraw();

  const queues = h('div');
  async function drawQueues() {
    clear(queues);
    const [cand, rej, rr] = await Promise.all([api.get(`/engagements/${id}/evidence?status=candidate`), api.get(`/engagements/${id}/reject-queue`), api.get(`/engagements/${id}/re-reviews`)]);
    queues.append(h('div', { class: 'grid g3' },
      card(`후보 근거 ${cand.length}건`, cand.length ? table(['대상', '요건', '값', ''], cand.slice(0, 8).map((e) => [e.ref_key, keyLabel(e.requirement_key), VALUE_NAME[e.value], h('button', { class: 'btn ghost sm', onclick: () => openItem(e.item_id) }, '열기')])) : h('p', { class: 'muted small' }, '없습니다. AI/OCR 값이나 현장 담당자가 등록한 값은 여기서 확정을 기다립니다.')),
      card(`거부 큐 ${rej.filter((x) => x.status === 'open').length}건`, rej.length ? table(['사유', ''], rej.slice(0, 8).map((x) => [h('span', { class: 'small' }, x.reason), x.status === 'open' ? actionBtn('확인', async () => { await api.post(`/engagements/${id}/reject-queue/${x.id}/resolve`, { note: '사람이 확인함' }); await refresh(); }, { cls: 'ghost sm' }) : pill('처리됨')])) : h('p', { class: 'muted small' }, '단위·범주 코드가 틀린 행은 자동 매핑하지 않고 여기로 모입니다.')),
      card(`재검토 ${rr.filter((x) => x.status === 'open').length}건`, rr.length ? table(['사유', ''], rr.slice(0, 8).map((x) => [h('span', { class: 'small' }, `${x.subject_type}: ${x.reason}`), x.status === 'open' ? actionBtn('확인', async () => { await api.post(`/engagements/${id}/re-reviews/${x.id}/resolve`, { note: '확인함' }); await refresh(); }, { cls: 'ghost sm' }) : pill('처리됨')])) : h('p', { class: 'muted small' }, '동시 해제 충돌·자동 중단 시 재검토가 배정됩니다.'))));
  }
  await drawQueues();

  const csv = textarea(`ref_key,group_code,requirement_key,value,source_ref,unit,occurred_at,task_id\n`, { rows: '5', 'aria-label': 'CSV 붙여넣기' });
  const res = h('div');
  const ingestCard = card('일괄 수집 (CSV 붙여넣기)', note('같은 과업 ID(task_id)의 재전송은 한 번만 반영됩니다. 단위·범주 코드가 틀린 행은 거부 큐로 갑니다(자동 매핑 금지). 새 대상은 인사 담당·FDE·컨설턴트만 만들 수 있고, 근거는 요건 소유 역할이 아니면 후보로 들어갑니다.'), csv,
    h('div', { class: 'row' }, actionBtn('수집 실행', async () => {
      const lines = csv.value.split('\n').map((l) => l.trim()).filter(Boolean); const head = lines[0].split(',').map((x) => x.trim());
      const rows = lines.slice(1).map((l) => { const c = l.split(',').map((x) => x.trim()); return Object.fromEntries(head.map((k, i) => [k, c[i] === '' ? undefined : c[i]])); });
      const r = await api.post(`/engagements/${id}/ingest`, { rows });
      clear(res); res.append(callout(r.rejected ? 'warn' : '', `반영 ${r.applied} · 중복 ${r.duplicates} · 거부 ${r.rejected} · 후보 ${r.candidates} · 새 대상 ${r.created_items}`), r.reject_reasons.length ? h('ul', { class: 'small' }, [...new Set(r.reject_reasons)].map((x) => h('li', null, x))) : null);
      await refresh();
    }), h('button', { class: 'btn ghost', onclick: () => { const it = d.items.find((i) => i.bucket === 'review'); csv.value = `ref_key,group_code,requirement_key,value,source_ref,unit,occurred_at,task_id\n${it ? it.ref_key : 'P-001'},,${reqs[1] || reqs[0]},verified,LOG-DEMO-1,${ad.unit},${new Date().toISOString().slice(0, 10)},TASK-DEMO-1\n${it ? it.ref_key : 'P-001'},,${reqs[1] || reqs[0]},verified,LOG-DEMO-1,${ad.unit},${new Date().toISOString().slice(0, 10)},TASK-DEMO-1\nP-900,XX,${reqs[0]},verified,S1,${ad.unit},,\nP-901,${d.groups[0].code},${reqs[0]},verified,S2,건,,`; } }, '예시 채우기 (중복·잘못된 행 포함)')), res);

  return h('div', null,
    h('div', { class: 'row sb' }, h('h1', null, '대상·근거'), h('span', { class: 'small muted' }, `${d.engagement.request_code} / ${d.engagement.task_code} · 실명 없이 내부 식별키만 사용`)),
    card('대상 목록 — 한 대상은 한 칸', h('div', { class: 'row', style: 'margin-bottom:10px' }, bucketBtns, grp, q), listEl),
    queues, ingestCard);
}
