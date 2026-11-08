'use strict';
/**
 * 사례 시더 코어. 합계·하위 범주별 표를 정확히 재현하도록 대상별 행(합성 데이터)을 만든다.
 * ⚠ 원문에는 대상별 행이 없다. 대상 식별키·날짜·자료 번호는 원문의 수치를 재현하기 위해 만든 합성 값이다.
 */
const engine = require('../engine');
const { defaultTrialWeeks } = require('../worktools');

const ISO = (d, h = 9) => `${d}T${String(h).padStart(2, '0')}:00:00.000Z`;
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
function lcg(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
function shuffle(arr, rnd) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

/**
 * spec:
 *  adapter, request_code, task_code, title, basis, notes, groups[{code,name,required,counts}]
 *  refPrefix | refFn(x, n, gi)   대상 식별키
 *  shuffle(기본 true), seed
 *  cohortSizes/cohortDates       착수 근거의 발생일(기간 행)
 *  reserveDates                  착수 전 대상의 예정일(없으면 null)
 *  reviewKeys[]                  '검토' 대상에서 미충족(unmet)인 요건
 *  unconfirmedMissing[]          '미확인' 대상에서 근거 없음(missing)인 요건
 *  unconfirmedUnmet[]            '미확인' 대상에서 함께 미충족인 요건(선택)
 *  pendingKeys[]                 '진행' 대상에서 확인 중(pending)인 요건
 *  noteFn(x, key, value)         근거 메모(선택)
 *  srcPrefix                     요건별 자료 번호 접두어
 * 반환 x: { id, ref, g, b, n(전체 순번), bi(칸 안 순번), gi(범주×칸 안 순번), startDay }
 */
function seedCase(db, spec) {
  const ad = engine.loadAdapter(db, db.prepare('SELECT id FROM adapters WHERE key=?').get(spec.adapter).id);
  const keys = ad.requirements.map((r) => r.key);
  const created = '2026-09-01T00:00:00.000Z';
  const eid = Number(db.prepare(`INSERT INTO engagements (request_code,task_code,title,adapter_id,basis_date,synthetic,notes,created_at) VALUES (?,?,?,?,?,1,?,?)`)
    .run(spec.request_code, spec.task_code, spec.title, ad.id, spec.basis, spec.notes || null, created).lastInsertRowid);
  db.prepare(`INSERT INTO rule_versions (engagement_id,version,effective_from,required_keys,note) VALUES (?,?,?,?,?)`).run(eid, 1, '1970-01-01T00:00:00.000Z', JSON.stringify(keys), '초기 규칙: 준비 요건 전체 충족');
  const gid = {};
  for (const g of spec.groups) gid[g.code] = Number(db.prepare('INSERT INTO groups (engagement_id,code,name,required) VALUES (?,?,?,?)').run(eid, g.code, g.name, g.required).lastInsertRowid);

  const list = [];
  for (const g of spec.groups) for (const [b, n] of Object.entries(g.counts)) for (let i = 0; i < n; i++) list.push({ g: g.code, b });
  const order = spec.shuffle === false ? list : shuffle(list, lcg(spec.seed || 7));
  const dist = spec.cohortSizes; let ci = 0, used = 0;
  const reserveDates = spec.reserveDates && spec.reserveDates.length ? spec.reserveDates : [null]; let ri = 0;
  const insI = db.prepare('INSERT INTO items (engagement_id,ref_key,group_id,planned_on,created_at) VALUES (?,?,?,?,?)');
  const insAs = db.prepare('INSERT INTO assignments (engagement_id,item_id,group_id,created_at,created_by) VALUES (?,?,?,?,?)');
  const insE = db.prepare(`INSERT INTO evidence (engagement_id,item_id,requirement_key,value,source_ref,source_version,unit,occurred_at,recorded_at,recorded_by,origin,status,confirmed_at,confirmed_by,note)
    VALUES (?,?,?,?,?,?,?,?,?,?,?, 'confirmed', ?, ?, ?)`);
  const ev = (item, key, value, ref, occ, recDelay, note, ver) => {
    const rec = new Date(new Date(occ).getTime() + recDelay * 3600000).toISOString();
    insE.run(eid, item, key, value, ref, ver || null, ad.unit, occ, rec, 'seed', 'import', rec, 'seed', note || null);
  };
  const in_ = (arr, k) => (arr || []).includes(k);
  const items = []; const bi = {}; const gi = {}; const gcount = {};
  let n = 0;
  for (const x of order) {
    n++;
    bi[x.b] = (bi[x.b] || 0); const gk = `${x.g}|${x.b}`; gi[gk] = (gi[gk] || 0);
    gcount[x.g] = (gcount[x.g] || 0) + 1;
    const ref = spec.refFn ? spec.refFn(x, n, gcount[x.g]) : `${spec.refPrefix}-${String(n).padStart(3, '0')}`;
    const startDay = x.b === 'reserve' ? null : spec.cohortDates[ci];
    const planned = x.b === 'reserve' ? reserveDates[ri++ % reserveDates.length] : null;
    if (x.b !== 'reserve') { used++; if (used >= dist[ci]) { used = 0; ci++; } }
    const id = Number(insI.run(eid, ref, gid[x.g], planned, created).lastInsertRowid);
    insAs.run(eid, id, gid[x.g], created, 'seed');
    const it = { id, ref, g: x.g, b: x.b, n, bi: bi[x.b]++, gi: gi[gk]++, startDay };
    items.push(it);
    if (x.b === 'reserve') continue;
    ev(id, '_START', 'verified', `${spec.srcPrefix._START || spec.refPrefix || 'S'}-S-${String(n).padStart(4, '0')}`, ISO(startDay, 9), 9, `${ad.start_label} 근거`);
    keys.forEach((k, ki) => {
      const day = addDays(startDay, 1 + ki);
      const src = `${spec.srcPrefix[k] || k}-${String(n).padStart(4, '0')}`;
      let v = 'verified', ref2 = src, note = null;
      if (x.b === 'review' && in_(spec.reviewKeys, k)) { v = 'unmet'; ref2 = `NOSET-${String(n).padStart(4, '0')}`; note = '확인 필요(원인 미판정)'; }
      if (x.b === 'unconfirmed' && in_(spec.unconfirmedMissing, k)) { v = 'missing'; ref2 = `UNK-${String(n).padStart(4, '0')}`; note = '근거 불명 — 근거 확인 필요'; }
      if (x.b === 'unconfirmed' && v === 'verified' && in_(spec.unconfirmedUnmet, k)) { v = 'unmet'; ref2 = `NOSET-${String(n).padStart(4, '0')}`; note = '미충족 확인 필요'; }
      if (x.b === 'in_progress' && in_(spec.pendingKeys, k)) { v = 'pending'; note = '확인 진행 중'; }
      if (spec.noteFn) { const o = spec.noteFn(it, k, v); if (o) note = o; }
      ev(id, k, v, ref2, ISO(day, 10), 6, note, v === 'verified' ? 'v1' : null);
    });
  }
  defaultTrialWeeks(db, eid);
  return { eid, items, adapter: ad };
}

// ── 공통 부가 자료 생성기 ──
function addHypotheses(db, eid, list) {
  const hy = db.prepare('INSERT INTO hypotheses (engagement_id,code,statement,support_source,disconfirm_source) VALUES (?,?,?,?,?)');
  const cv = db.prepare('INSERT INTO hypothesis_coverage (hypothesis_id,bucket,prompt) VALUES (?,?,?)');
  for (const h of list) {
    const id = Number(hy.run(eid, h.code, h.statement, h.support, h.disconfirm).lastInsertRowid);
    cv.run(id, 'review', h.q_review || h.q); cv.run(id, 'unconfirmed', h.q_unconfirmed || h.q);
  }
}
function addIntervention(db, eid, items, o) {
  const t = '2026-10-05T10:00:00.000Z';
  const id = Number(db.prepare(`INSERT INTO interventions (engagement_id,code,kind,title,description,target_bucket,task_key,required_roles,cost,stop_condition,recovery_path,proposed_by,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(eid, o.code, o.kind, o.title, o.description || null, o.bucket || null, o.task || null, JSON.stringify(o.roles), o.cost ? JSON.stringify(o.cost) : null, o.stop || null, o.recovery || null, 'consultant1', t, t).lastInsertRowid);
  const targets = o.targets || (o.bucket ? items.filter((x) => x.b === o.bucket) : []);
  for (const it of targets) db.prepare('INSERT OR IGNORE INTO intervention_targets (intervention_id,item_id) VALUES (?,?)').run(id, it.id);
  return id;
}
/** rule(item) → 'resolve' | 'hold' | null(포함하지 않음) */
function addScenario(db, eid, items, name, note, rule) {
  const asm = [];
  for (const x of items) { const r = rule(x); if (r) asm.push({ item_id: x.id, ref_key: x.ref, outcome: r }); }
  db.prepare('INSERT INTO scenarios (engagement_id,name,assumptions,note,created_at) VALUES (?,?,?,?,?)').run(eid, name, JSON.stringify(asm), note, '2026-10-05T10:00:00.000Z');
}
function addGenericTools(db, eid, ad, extra = {}) {
  const dr = db.prepare('INSERT INTO data_requests (engagement_id,name,owner,format_version,access_limit,provided) VALUES (?,?,?,?,?,0)');
  dr.run(eid, `${ad.start_label} 근거 자료`, (ad.role_labels && ad.role_labels[ad.start_owner]) || ad.start_owner, '', '내부 식별키만(실명·연락처 제외)');
  for (const r of ad.requirements) dr.run(eid, r.source || r.label, (ad.role_labels && ad.role_labels[r.owner]) || r.owner, '', '내부 식별키만(실명·연락처 제외)');
  const dc = db.prepare('INSERT INTO dictionary (engagement_id,field,definition,example,version,approver) VALUES (?,?,?,?,?,?)');
  const own = (ad.role_labels && ad.role_labels[ad.start_owner]) || ad.start_owner;
  [['단위', '무엇으로 세는가', ad.unit], ['대상 식별키', `한 ${ad.item_label}을(를) 구별하는 값(실명 아님)`, extra.ref_example || ''], ['하위 범주', `${ad.group_label} 등`, extra.group_example || ''], ['발생 시각', '현실에서 일어난 때', '착수·검사·승인일'], ['기록 시각', '시스템에 입력된 때', '입력 일시'], ['승인자', '상태를 승인한 역할', own], ['근거', '연결된 자료 식별번호', '기록·로그 ID']].forEach((r) => dc.run(eid, r[0], r[1], r[2], 'v1', own));
}

module.exports = { ISO, addDays, lcg, shuffle, seedCase, addHypotheses, addIntervention, addScenario, addGenericTools };
