'use strict';
/**
 * 판정 엔진 — 플랫폼의 핵심.
 * 교안의 불변 규칙을 코드로 강제한다.
 *  1. 한 대상은 한 칸에만 (상태 배타성)         → classifyItem 은 하나의 bucket 만 돌려준다
 *  2. 근거 자료가 없으면 '합격/0'이 아니라 '미확인'  → resolveRequirement
 *  3. 전달·수신·적용·승인은 다른 처리 단계         → value 'delivered' 는 '적용'이 아니다
 *  4. AI/OCR 추출값은 후보                         → status 'candidate' 는 판정에서 제외
 *  5. 발생 시각과 기록 시각을 분리 (이중 시간축)    → basis(발생) / known(기록) 로 과거 재구성
 *  6. 분모 0 은 임의로 100% 로 바꾸지 않는다       → ratio() → null
 *  7. 세 계산 확인식 + 하위 범주 합계               → identities / group sums
 */
const { normTs, jparse, ratio } = require('./util');

const BUCKETS = ['approved', 'review', 'unconfirmed', 'in_progress', 'reserve'];
const BUCKET_LABEL = {
  approved: '준비(승인)', review: '검토(권한 확인 대기)', unconfirmed: '미확인(근거 불명)',
  in_progress: '진행', reserve: '예비(미착수)',
};

function loadAdapter(db, id) {
  const a = db.prepare('SELECT * FROM adapters WHERE id=?').get(id);
  if (!a) return null;
  return { ...a, requirements: jparse(a.requirements, []), role_labels: jparse(a.role_labels, {}) };
}
function loadEngagement(db, id) {
  const e = db.prepare('SELECT * FROM engagements WHERE id=?').get(id);
  if (!e) return null;
  return { ...e, protection_rules: jparse(e.protection_rules, {}), adapter: loadAdapter(db, e.adapter_id) };
}

/** 기준 시점에 유효한 규칙 버전 */
function ruleAt(db, engagementId, basisIso) {
  const r = db.prepare(
    `SELECT * FROM rule_versions WHERE engagement_id=? AND effective_from<=? ORDER BY effective_from DESC, version DESC LIMIT 1`
  ).get(engagementId, basisIso);
  if (!r) return null;
  return { version: r.version, effective_from: r.effective_from, required_keys: jparse(r.required_keys, []), note: r.note };
}

/**
 * 보이는 근거 중 (item,key)별 유효한 한 건을 고른다.
 *  - known(기록 시각) 이전에 기록·확정된 것만, basis(발생 시각) 이전에 일어난 것만
 *  - 정정(corrects_id)이 보이면 정정 대상은 제외
 *  - 후보(candidate)·반려(rejected)는 판정 근거가 아니다
 */
function buildEvidenceIndex(rows, basisIso, knownIso) {
  const visible = rows.filter((e) =>
    e.status === 'confirmed' && e.recorded_at <= knownIso && (e.confirmed_at || e.recorded_at) <= knownIso);
  const superseded = new Set(visible.filter((e) => e.corrects_id && e.occurred_at <= basisIso).map((e) => e.corrects_id));
  const idx = new Map(); // `${item}|${key}` → 최선의 근거
  for (const e of visible) {
    if (superseded.has(e.id) || e.occurred_at > basisIso) continue;
    const k = `${e.item_id}|${e.requirement_key}`;
    const cur = idx.get(k);
    // 발생은 '일' 단위로 비교한다(현장 입력은 날짜만 적는 경우가 많다). 같은 날이면 나중에 기록된 것이 우선.
    const ed = e.occurred_at.slice(0, 10), cd = cur ? cur.occurred_at.slice(0, 10) : '';
    if (!cur || ed > cd || (ed === cd && (e.recorded_at > cur.recorded_at || (e.recorded_at === cur.recorded_at && e.id > cur.id)))) {
      idx.set(k, e);
    }
  }
  return idx;
}

/** 요건 하나의 판정값. 근거가 없거나 자료 식별번호가 없으면 'missing'. */
function resolveRequirement(ev) {
  if (!ev) return { value: 'missing', reason: 'NO_EVIDENCE', ev: null };
  if (ev.value === 'verified') {
    if (!ev.source_ref) return { value: 'missing', reason: 'UNTRACEABLE', ev };
    return { value: 'verified', reason: null, ev };
  }
  if (ev.value === 'delivered') return { value: 'unmet', reason: 'DELIVERED_ONLY', ev };
  return { value: ev.value, reason: ev.value === 'missing' ? 'EXPLICIT_UNKNOWN' : null, ev };
}

/**
 * 한 대상을 한 칸으로 분류한다.
 * 우선순위: 진행(pending) > 미확인(missing) > 검토(unmet|게이트 실패) > 준비.
 * overrides: 모의계산용 (실제 기록을 바꾸지 않는다)
 */
function classifyItem({ item, idx, requiredKeys, assignments, holds, ov }) {
  const reasons = [];
  const startEv = idx.get(`${item.id}|_START`);
  let started = !!(startEv && startEv.value === 'verified' && startEv.source_ref);
  if (startEv && startEv.value === 'verified' && !startEv.source_ref) reasons.push('START_UNTRACEABLE');
  if (ov && ov.started) started = true;

  const req = {};
  for (const k of requiredKeys) {
    let r = resolveRequirement(idx.get(`${item.id}|${k}`));
    if (ov && ov.reqs && ov.reqs[k]) r = { value: ov.reqs[k], reason: 'SIMULATED', ev: r.ev };
    req[k] = { value: r.value, reason: r.reason, source_ref: r.ev ? r.ev.source_ref : null, ev_id: r.ev ? r.ev.id : null, occurred_at: r.ev ? r.ev.occurred_at : null, note: r.ev ? r.ev.note : null };
  }

  const active = assignments.filter((a) => a.item_id === item.id && a.status === 'active');
  const openHold = holds.find((h) => h.item_id === item.id && h.status === 'open');
  const gates = {
    group_match: active.length === 1 && active[0].group_id === item.group_id,
    evidence_linked: requiredKeys.every((k) => req[k].reason !== 'NO_EVIDENCE' && req[k].reason !== 'UNTRACEABLE'),
    position_ok: !openHold,
    no_duplicate: active.length <= 1,
    rule_valid: requiredKeys.length > 0,
  };

  if (!started) return { bucket: 'reserve', reasons, req, gates, started: false };

  const vals = requiredKeys.map((k) => req[k].value);
  if (vals.includes('pending')) return { bucket: 'in_progress', reasons: [...reasons, 'FOLLOWUP_PENDING'], req, gates, started: true };
  if (vals.includes('missing')) {
    for (const k of requiredKeys) if (req[k].value === 'missing') reasons.push(`MISSING:${k}`);
    return { bucket: 'unconfirmed', reasons, req, gates, started: true };
  }
  if (vals.includes('unmet')) for (const k of requiredKeys) if (req[k].value === 'unmet') reasons.push(`UNMET:${k}`);
  if (!gates.group_match) reasons.push('GATE:group_match');
  if (!gates.position_ok) reasons.push('GATE:open_hold');
  if (!gates.no_duplicate) reasons.push('GATE:duplicate_assignment');
  if (!gates.rule_valid) reasons.push('GATE:no_rule');
  if (reasons.some((r) => r.startsWith('UNMET') || r.startsWith('GATE'))) return { bucket: 'review', reasons, req, gates, started: true };
  return { bucket: 'approved', reasons, req, gates, started: true };
}

const emptyCounts = () => ({ approved: 0, review: 0, unconfirmed: 0, in_progress: 0, reserve: 0 });

/** 세 계산 확인식 (잔차 0 이어야 한다) */
function identitiesOf(c) {
  const input = c.input, started = c.started, completed = c.completed;
  return [
    { id: 'input', label: '① 입력 = 착수 + 예비', lhs: { label: '입력', value: input }, rhs: [{ label: '착수', value: started }, { label: '예비', value: c.reserve }], residual: input - (started + c.reserve) },
    { id: 'started', label: '② 착수 = 완료 + 진행', lhs: { label: '착수', value: started }, rhs: [{ label: '완료', value: completed }, { label: '진행', value: c.in_progress }], residual: started - (completed + c.in_progress) },
    { id: 'completed', label: '③ 완료 = 승인 + 검토 + 미확인', lhs: { label: '완료', value: completed }, rhs: [{ label: '승인', value: c.approved }, { label: '검토', value: c.review }, { label: '미확인', value: c.unconfirmed }], residual: completed - (c.approved + c.review + c.unconfirmed) },
  ];
}

function finalizeCounts(b, required) {
  const started = b.approved + b.review + b.unconfirmed + b.in_progress;
  const completed = b.approved + b.review + b.unconfirmed;
  return { required, input: started + b.reserve, started, reserve: b.reserve, completed, in_progress: b.in_progress, approved: b.approved, review: b.review, unconfirmed: b.unconfirmed };
}

function metricsOf(c) {
  const shortage = c.required - c.approved;
  const parts = { review: c.review, unconfirmed: c.unconfirmed, in_progress: c.in_progress, reserve: c.reserve };
  const explained = parts.review + parts.unconfirmed + parts.in_progress + parts.reserve;
  return {
    completion_rate: ratio(c.completed, c.started),   // 완료 ÷ 착수
    approval_rate: ratio(c.approved, c.completed),    // 승인 ÷ 완료
    fulfilment_rate: ratio(c.approved, c.required),   // 승인 ÷ 요구
    shortage, shortage_parts: parts,
    shortage_unexplained: shortage - explained,       // 요구 ≠ 입력이면 0이 아닐 수 있다 — 숨기지 않는다
  };
}

/**
 * 스냅샷. basis=발생 기준 시점, known=어느 시점까지 기록된 지식으로 볼 것인가.
 * 과거 보고서는 (basis, known) 을 고정하면 후행 입력·정정이 있어도 그대로 재현된다.
 */
function snapshot(db, engagementId, opts = {}) {
  const eng = loadEngagement(db, engagementId);
  if (!eng) return null;
  // 라이브 기본값은 '오늘'. 과업의 basis_date 는 보고서 기준선(baseline) 재현용이다.
  const basis = normTs(opts.basis || (opts.now || new Date()).toISOString().slice(0, 10));
  const known = opts.known ? normTs(opts.known) : '9999-12-31T23:59:59.999Z';
  const rule = ruleAt(db, engagementId, basis);
  const groups = db.prepare('SELECT * FROM groups WHERE engagement_id=? ORDER BY id').all(engagementId);
  const items = db.prepare('SELECT * FROM items WHERE engagement_id=? ORDER BY id').all(engagementId);
  const evRows = db.prepare('SELECT * FROM evidence WHERE engagement_id=?').all(engagementId);
  const assignments = db.prepare('SELECT * FROM assignments WHERE engagement_id=?').all(engagementId);
  const holds = db.prepare('SELECT * FROM holds WHERE engagement_id=?').all(engagementId).filter((h) => h.opened_at <= known && (h.status === 'open' || (h.released_at && h.released_at > known)));
  // known 이전 시점 재구성: 이미 해제됐어도 known 시점엔 열려 있던 보류는 열린 것으로 본다
  const holdsAsOf = holds.map((h) => ({ ...h, status: 'open' }));
  const idx = buildEvidenceIndex(evRows, basis, known);
  const requiredKeys = rule ? rule.required_keys : [];
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const ovMap = opts.overrides || null;

  const out = [];
  const warnings = [];
  const bucketsAll = emptyCounts();
  const byGroup = {};
  for (const g of groups) byGroup[g.code] = { code: g.code, name: g.name, required: g.required, b: emptyCounts() };

  for (const it of items) {
    const c = classifyItem({ item: it, idx, requiredKeys, assignments, holds: holdsAsOf, ov: ovMap ? ovMap[it.id] : null });
    const g = groupById.get(it.group_id);
    const startEv = idx.get(`${it.id}|_START`);
    out.push({
      id: it.id, ref_key: it.ref_key, group_code: g ? g.code : null, group_name: g ? g.name : null,
      planned_on: it.planned_on, started_on: c.started && startEv ? startEv.occurred_at.slice(0, 10) : null,
      bucket: c.bucket, reasons: c.reasons, req: c.req, gates: c.gates,
    });
    bucketsAll[c.bucket]++;
    if (g) byGroup[g.code].b[c.bucket]++; else warnings.push({ code: 'NO_GROUP', item: it.ref_key });
    if (c.reasons.includes('START_UNTRACEABLE')) warnings.push({ code: 'START_UNTRACEABLE', item: it.ref_key, msg: '착수 근거에 자료 식별번호가 없어 예비로 둡니다.' });
  }
  if (!rule) warnings.push({ code: 'NO_RULE', msg: '기준 시점에 유효한 판정 규칙이 없어 승인할 수 없습니다.' });

  const required = groups.reduce((s, g) => s + g.required, 0);
  const counts = finalizeCounts(bucketsAll, required);
  const groupRows = Object.values(byGroup).map((g) => ({ code: g.code, name: g.name, ...finalizeCounts(g.b, g.required) }));

  // 하위 범주 합계 = 총계 (T4)
  const sumKeys = ['required', 'input', 'started', 'reserve', 'completed', 'in_progress', 'approved', 'review', 'unconfirmed'];
  const groupSum = {};
  for (const k of sumKeys) groupSum[k] = groupRows.reduce((s, g) => s + g[k], 0);
  const groupResidual = {};
  for (const k of sumKeys) groupResidual[k] = counts[k] - groupSum[k];

  // 한 대상이 두 칸에 들어가지 않는지 (유일성)
  const seen = new Set(); const dup = [];
  for (const it of out) { if (seen.has(it.ref_key)) dup.push(it.ref_key); seen.add(it.ref_key); }

  if (counts.required !== counts.input) warnings.push({ code: 'REQUIRED_NE_INPUT', msg: `요구 ${counts.required} ≠ 입력 ${counts.input}: 정원 승인 범위와 입력 대상이 다릅니다.` });

  return {
    engagement: { id: eng.id, request_code: eng.request_code, task_code: eng.task_code, title: eng.title, synthetic: !!eng.synthetic, sync_stage: eng.sync_stage, adapter_key: eng.adapter.key },
    basis, known: opts.known ? known : null, rule,
    items: out, counts, groups: groupRows,
    identities: identitiesOf(counts),
    group_identities: groupRows.map((g) => ({ code: g.code, name: g.name, checks: identitiesOf(g) })),
    group_residual: groupResidual,
    duplicate_keys: dup,
    metrics: metricsOf(counts),
    group_metrics: groupRows.map((g) => ({ code: g.code, name: g.name, ...metricsOf(g) })),
    warnings,
    integrity_ok: identitiesOf(counts).every((i) => i.residual === 0) && Object.values(groupResidual).every((r) => r === 0) && dup.length === 0,
  };
}

/** 보고서 기준선: 과업의 기준 시점에 그날까지 기록된 지식만으로 재구성한다(후행 입력·정정이 덮어쓰지 않는다). */
function baseline(db, engagementId) {
  const eng = loadEngagement(db, engagementId);
  return snapshot(db, engagementId, { basis: eng.basis_date, known: eng.basis_date });
}

/** 두 스냅샷 사이의 상태 이동. 이전 칸 차감과 다음 칸 증가가 같은 대상을 가리키는지 확인 (비교 확인 ②③). */
function transitions(a, b) {
  const A = new Map(a.items.map((i) => [i.id, i])), B = new Map(b.items.map((i) => [i.id, i]));
  const matrix = {}; const moved = []; let newInflow = 0; const newItems = [];
  for (const [id, ib] of B) {
    const ia = A.get(id);
    if (!ia) { newInflow++; newItems.push(ib.ref_key); continue; }
    if (ia.bucket !== ib.bucket) {
      const k = `${ia.bucket}>${ib.bucket}`;
      matrix[k] = (matrix[k] || 0) + 1;
      moved.push({ id, ref_key: ib.ref_key, group: ib.group_code, from: ia.bucket, to: ib.bucket });
    }
  }
  const removed = [...A.keys()].filter((id) => !B.has(id)).length;
  const net = {}; for (const bk of BUCKETS) net[bk] = b.counts[bk] - a.counts[bk];
  const outflow = {}, inflow = {};
  for (const m of moved) { outflow[m.from] = (outflow[m.from] || 0) + 1; inflow[m.to] = (inflow[m.to] || 0) + 1; }
  // 칸별 보존식: 이전 − 나간 수 + 들어온 수 + 신규 유입 = 이후
  const newByBucket = {}; for (const [id, ib] of B) if (!A.has(id)) newByBucket[ib.bucket] = (newByBucket[ib.bucket] || 0) + 1;
  const check = BUCKETS.map((bk) => ({ bucket: bk, before: a.counts[bk], out: outflow[bk] || 0, in: inflow[bk] || 0, new: newByBucket[bk] || 0, after: b.counts[bk],
    residual: a.counts[bk] - (outflow[bk] || 0) + (inflow[bk] || 0) + (newByBucket[bk] || 0) - b.counts[bk] }));
  const approvedMoves = moved.filter((m) => m.to === 'approved').length;
  return {
    from: { basis: a.basis, known: a.known, counts: a.counts }, to: { basis: b.basis, known: b.known, counts: b.counts },
    matrix, moved, net, check, new_inflow: newInflow, new_items: newItems, removed,
    conserved: check.every((c) => c.residual === 0),
    note: `준비로 이동한 ${approvedMoves}명은 신규 유입이 아니라 기존 대상의 상태 변경이다.`,
  };
}

/** 기간(착수일/예정일) 행 — 행마다 세 식을 확인한 뒤 합산. 같은 대상의 재확인은 새 과업으로 더하지 않는다. */
function periodRows(snap) {
  const rows = new Map();
  for (const it of snap.items) {
    const key = it.started_on || it.planned_on || 'unscheduled';
    if (!rows.has(key)) rows.set(key, { period_id: `PR-${key}`, start: key, end: key, b: emptyCounts() });
    rows.get(key).b[it.bucket]++;
  }
  const list = [...rows.values()].sort((x, y) => x.start.localeCompare(y.start)).map((r) => {
    const c = finalizeCounts(r.b, 0);
    const ids = identitiesOf(c);
    return { period_id: r.period_id, start: r.start, end: r.end, counts: c, residual: ids.map((i) => i.residual), ok: ids.every((i) => i.residual === 0) };
  });
  const total = emptyCounts();
  for (const r of list) for (const bk of BUCKETS) total[bk] += r.counts[bk];
  const tc = finalizeCounts(total, snap.counts.required);
  return {
    rows: list, total: tc,
    matches_snapshot: BUCKETS.every((bk) => tc[bk] === snap.counts[bk]),
    row_count: list.length,
  };
}

/**
 * 외부에서 붙여 넣은 기간 행 검증 (실습 3·10).
 * - 행별 세 식 잔차
 * - 같은 자료 식별번호(period_id) 중복 → 한 번만 합산
 * - kind='recheck'(재확인/주간 특정 시점 기록)은 신규 수량으로 더하지 않는다
 * - 합계가 기준 스냅샷과 일치하는가
 */
function validatePeriodRows(rows, snap) {
  const seen = new Set(); const used = []; const issues = []; const excluded = [];
  for (const r of rows) {
    const pid = String(r.period_id || '').trim();
    if (!pid) { issues.push({ code: 'NO_ID', msg: '자료 식별번호가 없는 행은 합산하지 않습니다.', row: r }); excluded.push(r); continue; }
    if (seen.has(pid)) { issues.push({ code: 'DUP_ID', msg: `자료 식별번호 ${pid} 중복 — 한 번만 합산합니다.`, row: r }); excluded.push(r); continue; }
    seen.add(pid);
    if (String(r.kind || '').toLowerCase() === 'recheck') { issues.push({ code: 'RECHECK', msg: `${pid}: 재확인 기록은 신규 수량이 아닙니다.`, row: r }); excluded.push(r); continue; }
    const c = { input: +r.input || 0, started: +r.started || 0, reserve: +r.reserve || 0, completed: +r.completed || 0, in_progress: +r.in_progress || 0, approved: +r.approved || 0, review: +r.review || 0, unconfirmed: +r.unconfirmed || 0 };
    const ids = identitiesOf(c);
    const bad = ids.filter((i) => i.residual !== 0);
    if (bad.length) issues.push({ code: 'RESIDUAL', msg: `${pid}: ${bad.map((b) => `${b.label} 잔차 ${b.residual}`).join(', ')}`, row: r });
    used.push({ ...r, counts: c, ok: bad.length === 0 });
  }
  const sum = {}; for (const k of ['input', 'started', 'reserve', 'completed', 'in_progress', 'approved', 'review', 'unconfirmed']) sum[k] = used.reduce((s, r) => s + r.counts[k], 0);
  const diff = {}; for (const k of Object.keys(sum)) diff[k] = sum[k] - snap.counts[k];
  const matches = Object.values(diff).every((d) => d === 0);
  if (!matches) issues.push({ code: 'TOTAL_MISMATCH', msg: '합계가 기준 스냅샷과 다릅니다. 불일치 행을 숨기지 말고 추적하세요.', diff });
  return { used_rows: used.length, excluded_rows: excluded.length, sum, diff, matches, issues };
}

/** 데이터 품질 5축 + 현장 시험 시작 판정 (실습 18). 빠진 값을 지워 통과율을 높이지 않는다. */
function quality(db, engagementId, snap) {
  const evRows = db.prepare('SELECT * FROM evidence WHERE engagement_id=?').all(engagementId);
  const started = snap.items.filter((i) => i.bucket !== 'reserve');
  const keys = snap.rule ? snap.rule.required_keys : [];
  const cells = started.length * keys.length;
  const missingCells = started.reduce((s, i) => s + keys.filter((k) => i.req[k].value === 'missing').length, 0);
  const untraceable = started.reduce((s, i) => s + keys.filter((k) => i.req[k].reason === 'UNTRACEABLE').length, 0);
  const verifiedCells = started.reduce((s, i) => s + keys.filter((k) => i.req[k].value === 'verified').length, 0);
  const tracedVerified = verifiedCells; // verified 는 정의상 자료 식별번호가 있다
  const baseEnd = normTs(loadEngagement(db, engagementId).basis_date);
  const lateRecords = evRows.filter((e) => e.status === 'confirmed' && e.occurred_at <= baseEnd && e.recorded_at > baseEnd).length;
  const axes = [
    { key: 'completeness', label: '완전성', q: '빠진 값이 없는가', value: cells ? Math.round((1 - missingCells / cells) * 10000) / 100 : null, detail: `빠진 값 ${missingCells}/${cells}칸 (삭제하지 않고 미확인으로 유지)`, pass: missingCells === 0, soft: true },
    { key: 'uniqueness', label: '유일성', q: '중복 키가 없는가', value: snap.duplicate_keys.length === 0 ? 100 : 0, detail: snap.duplicate_keys.length ? `중복 ${snap.duplicate_keys.join(', ')}` : '중복 키 없음', pass: snap.duplicate_keys.length === 0 },
    { key: 'consistency', label: '정합성', q: '합계·상태가 맞는가', value: snap.integrity_ok ? 100 : 0, detail: snap.integrity_ok ? '세 식·하위 범주 잔차 0' : '잔차가 있습니다', pass: snap.integrity_ok },
    { key: 'timeliness', label: '적시성', q: '기준 시점에 맞는가', value: lateRecords === 0 ? 100 : 0, detail: lateRecords ? `기준일 뒤에 기록된 과거 사건 ${lateRecords}건 — 기준선 보고서에는 반영하지 않고(known 고정), 현재 판정에만 반영` : '기준일 뒤에 기록된 과거 사건 없음', pass: true, soft: true },
    { key: 'traceability', label: '추적성', q: '근거 자료까지 거슬러 가는가', value: verifiedCells + untraceable ? Math.round((tracedVerified / (verifiedCells + untraceable)) * 10000) / 100 : null, detail: `자료 식별번호 없는 판정 ${untraceable}건`, pass: untraceable === 0 },
  ];
  const hardFail = axes.filter((a) => !a.pass && !a.soft);
  const softWarn = axes.filter((a) => !a.pass && a.soft);
  const decision = hardFail.length ? 'blocked' : (softWarn.length ? 'conditional' : 'ready');
  const reasons = [...hardFail.map((a) => `${a.label} 미충족`), ...softWarn.map((a) => `${a.label}: ${a.detail}`)];
  return {
    axes, decision, reasons,
    decision_label: { blocked: '시작 불가', conditional: '조건부 시작 (미확인 유지·담당 지정 필요)', ready: '시작 가능' }[decision],
    rule: '정합성·유일성·추적성이 깨지면 시작할 수 없다. 완전성은 빠진 값을 지우지 않고 미확인으로 두며 담당·기한을 정해 조건부로 시작한다.',
  };
}

/** 보호 지표 (빠진 값 · 업무 지연 · 무권한 승인 · 기록 부담) 와 중단 판정 */
function protection(db, engagementId, snap) {
  const eng = loadEngagement(db, engagementId);
  const started = snap.counts.started;
  const keys = snap.rule ? snap.rule.required_keys : [];
  const missingItems = snap.items.filter((i) => i.bucket === 'unconfirmed').length;
  const openHolds = db.prepare(`SELECT COUNT(*) n FROM holds WHERE engagement_id=? AND status='open'`).get(engagementId).n;
  // 무권한 승인: 승인 기록의 역할이 해당 조치의 필수 역할이 아닌 건 (정합성 점검)
  const bad = db.prepare(`SELECT a.id, a.role, i.required_roles FROM approvals a JOIN interventions i ON i.id=a.subject_id
                          WHERE a.engagement_id=? AND a.subject_type='intervention' AND a.decision='approve'`).all(engagementId)
    .filter((r) => !jparse(r.required_roles, []).includes(r.role)).length;
  const denied = db.prepare(`SELECT COUNT(*) n FROM audit WHERE engagement_id=? AND outcome='denied'`).get(engagementId).n;
  const burdens = db.prepare(`SELECT day, burden_minutes FROM daily_closes WHERE engagement_id=? AND burden_minutes IS NOT NULL ORDER BY day`).all(engagementId);
  const rules = eng.protection_rules || {};
  const metrics = [
    { key: 'missing', label: '빠진 값', def: '근거 자료 없는 수치 비율 (미확인 ÷ 착수)', value: started ? Math.round((missingItems / started) * 10000) / 100 : null, unit: '%', limit: rules.missing_max ?? null, hint: '증가 추세' },
    { key: 'delay', label: '업무 지연', def: '보류로 늦어진 배치 건수 (열린 보류)', value: openHolds, unit: '건', limit: rules.delay_max ?? null, hint: '2주 연속 증가' },
    { key: 'unauthorized', label: '무권한 승인', def: '권한 없는 승인 건수 (승인 기록 정합성 점검)', value: bad, unit: '건', limit: rules.unauthorized_max ?? 0, hint: '1건 발생', extra: `차단된 무권한 시도 ${denied}건(처리 기록)` },
    { key: 'burden', label: '기록 부담', def: '입력에 쓰는 시간(일 마감 보고, 분)', value: burdens.length ? burdens[burdens.length - 1].burden_minutes : null, unit: '분', limit: rules.burden_max ?? null, hint: '현장 불만 증가' },
  ];
  const breached = metrics.filter((m) => m.limit != null && m.value != null && m.value > m.limit);
  return { metrics, breached: breached.map((m) => m.key), stop: breached.length > 0, rule_note: '중단 기준은 현장이 정한다. 설정하지 않은 지표는 경고만 하고 중단하지 않는다(기본값은 무권한 승인 > 0).' };
}

/** 비용 가정 계산 (교육용 업무 부담 가정 — 임금·수당·법정 교육비·자동 절감액이 아니다) */
function costOf(cost) {
  if (!cost || !Array.isArray(cost.lines)) return null;
  const lines = cost.lines.map((l) => {
    const hours = (Number(l.qty) || 0) * (l.minutes != null ? Number(l.minutes) / 60 : Number(l.hours) || 0);
    return { ...l, person_hours: Math.round(hours * 100) / 100, amount: Math.round(hours * (Number(l.rate) || 0)) };
  });
  return { lines, person_hours: lines.reduce((s, l) => s + l.person_hours, 0), amount: lines.reduce((s, l) => s + l.amount, 0), assumption: true, disclaimer: '교육용 업무 부담 가정입니다. 직원에게 실제 지급할 임금·수당, 법정 교육 비용 또는 자동 절감액이 아닙니다.' };
}

/** 가정 시나리오 모의계산 (실측 아님, 기록을 바꾸지 않는다) */
function simulate(db, engagementId, scenarioId, opts = {}) {
  const sc = db.prepare('SELECT * FROM scenarios WHERE id=? AND engagement_id=?').get(scenarioId, engagementId);
  if (!sc) return null;
  const assumptions = jparse(sc.assumptions, []);
  const before = snapshot(db, engagementId, opts);
  const keys = before.rule ? before.rule.required_keys : [];
  const ov = {};
  for (const a of assumptions) {
    if (a.outcome !== 'resolve') continue;
    const o = { started: true, reqs: {} };
    for (const k of keys) o.reqs[k] = 'verified';
    ov[a.item_id] = o;
  }
  const after = snapshot(db, engagementId, { ...opts, overrides: ov });
  const t = transitions(before, after);
  const remaining = after.items.filter((i) => i.bucket !== 'approved').map((i) => ({ ref_key: i.ref_key, group: i.group_code, bucket: i.bucket }));
  return {
    scenario: { id: sc.id, name: sc.name, note: sc.note, assumptions: assumptions.length },
    label: '가정 — 현장 시험 결과가 아니며, 이 수량은 실제 기록·완료·대외 사용 가능 수량에 반영되지 않는다.',
    before: { counts: before.counts, groups: before.groups, metrics: before.metrics },
    after: { counts: after.counts, groups: after.groups, metrics: after.metrics },
    moved: t.moved.length, matrix: t.matrix, remaining,
    note: `이동 합계 ${t.moved.length}명은 신규 채용 ${t.moved.length}건이 아니라 기존 대상의 상태 변경이다.`,
  };
}

module.exports = {
  BUCKETS, BUCKET_LABEL, loadEngagement, loadAdapter, ruleAt, buildEvidenceIndex, resolveRequirement, classifyItem,
  snapshot, baseline, transitions, periodRows, validatePeriodRows, quality, protection, costOf, simulate, identitiesOf, metricsOf, finalizeCounts, emptyCounts,
};
