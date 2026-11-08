'use strict';
/**
 * 상태를 바꾸는 모든 작업. 규칙:
 *  - 권한 없는 실행 작업은 거부하고 처리 기록을 남긴다 (audited → 'denied')
 *  - 승인(조치 경로 승인)은 수량을 올리지 않는다. 수량은 확인된 근거(evidence)로만 바뀐다.
 *  - 플랫폼의 결재와 외부 시스템의 수락은 별도 상태.
 */
const policy = require('./policy');
const engine = require('./engine');
const { audited } = require('./audit');
const { HttpError, bad, forbidden, notFound, conflict, normTs, isoNow, jparse, sha256 } = require('./util');

const VALUES = ['verified', 'unmet', 'pending', 'missing', 'delivered'];
const SYNC_STAGES = ['read', 'simulation', 'manual', 'limited_live'];
const SYNC_LIVE_LIMIT = 10;

const now = (ctx) => isoNow(ctx.clock);

function needActor(ctx) { if (!ctx.actor || !ctx.actor.role) throw new HttpError(401, '인증이 필요합니다.'); }
function getEng(ctx, id) {
  const e = engine.loadEngagement(ctx.db, Number(id));
  if (!e) throw notFound('과업을 찾을 수 없습니다.');
  return e;
}
function getItem(ctx, engId, ref) {
  let it = typeof ref === 'number'
    ? ctx.db.prepare('SELECT * FROM items WHERE id=? AND engagement_id=?').get(ref, engId)
    : ctx.db.prepare('SELECT * FROM items WHERE ref_key=? AND engagement_id=?').get(String(ref), engId);
  if (!it && typeof ref !== 'number' && /^\d+$/.test(String(ref))) it = ctx.db.prepare('SELECT * FROM items WHERE id=? AND engagement_id=?').get(Number(ref), engId);
  if (!it) throw notFound(`대상을 찾을 수 없습니다: ${ref}`);
  return it;
}
function checkKey(eng, key) {
  if (key === '_START') return;
  if (!eng.adapter.requirements.some((r) => r.key === key)) throw bad(`알 수 없는 요건입니다: ${key}`);
}
const allow = (ctx, action) => { needActor(ctx); if (!policy.can(ctx.actor.role, action)) throw forbidden(`권한 없음: '${ctx.actor.role}' 역할은 ${action} 을(를) 실행할 수 없습니다.`); };

// ───────────────────────── 근거 자료 ─────────────────────────
function insertEvidence(ctx, eng, p) {
  const t = now(ctx);
  const occurred = normTs(p.occurred_at || t, false);
  const role = ctx.actor.role;
  const isOwner = policy.canConfirmEvidence(role, eng.adapter, p.requirement_key);
  // AI/OCR 추출값 또는 소유 역할이 아닌 등록자의 값은 '후보' — 근거 자료 관리자가 확인하기 전에는 판정 근거가 아니다
  const status = p.origin === 'ocr_ai' || !isOwner ? 'candidate' : 'confirmed';
  const info = ctx.db.prepare(`INSERT INTO evidence (engagement_id,item_id,requirement_key,value,source_ref,source_version,unit,occurred_at,recorded_at,recorded_by,origin,status,confirmed_at,confirmed_by,note,corrects_id,idem_key)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(eng.id, p.item_id, p.requirement_key, p.value, p.source_ref || null, p.source_version || null, p.unit || null, occurred, t, ctx.actor.username,
      p.origin || 'manual', status, status === 'confirmed' ? t : null, status === 'confirmed' ? ctx.actor.username : null, p.note || null, p.corrects_id || null, p.idem_key || null);
  return { id: Number(info.lastInsertRowid), status };
}

/**
 * 착수 근거가 '확인됨'이 되면 아직 근거가 한 건도 없는 요건에 '진행 중(pending)'을 연다.
 * 착수 직후의 대상이 '근거 불명(미확인)'으로 보이지 않고 '확인 진행 중'으로 보이게 하기 위함이다.
 * 실제로 확인되기 전에는 준비로 올라가지 않으며, 이 기록은 시스템이 남긴 것임을 표시한다.
 */
function openFollowups(ctx, eng, itemId, startEvidenceId) {
  const rule = engine.ruleAt(ctx.db, eng.id, '9999-12-31T23:59:59.999Z');
  const keys = rule ? rule.required_keys : eng.adapter.requirements.map((r) => r.key);
  const t = now(ctx); let n = 0;
  // 후속 확인의 발생일은 착수(입사 확인)일이다 — 기록 시각으로 두면 그날 이후의 실제 확인 결과를 가릴 수 있다.
  const occurred = (ctx.db.prepare('SELECT occurred_at FROM evidence WHERE id=?').get(startEvidenceId) || { occurred_at: t }).occurred_at;
  for (const k of keys) {
    if (ctx.db.prepare('SELECT 1 FROM evidence WHERE item_id=? AND requirement_key=?').get(itemId, k)) continue;
    ctx.db.prepare(`INSERT INTO evidence (engagement_id,item_id,requirement_key,value,occurred_at,recorded_at,recorded_by,origin,status,confirmed_at,confirmed_by,note)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(eng.id, itemId, k, 'pending', occurred, t, 'system', 'manual', 'confirmed', t, 'system', '착수 확인 → 후속 확인 시작(시스템)');
    n++;
  }
  return n;
}

function registerEvidence(ctx, engId, p) {
  needActor(ctx);
  return audited(ctx, { engagementId: engId, action: 'evidence.register', subject: `${p.ref_key || p.item_id}/${p.requirement_key}` }, () => {
    const eng = getEng(ctx, engId);
    const item = getItem(ctx, eng.id, p.item_id ?? p.ref_key);
    checkKey(eng, p.requirement_key);
    if (!VALUES.includes(p.value)) throw bad(`근거 값은 ${VALUES.join('/')} 중 하나여야 합니다.`);
    if (!policy.canRegisterEvidence(ctx.actor.role, eng.adapter, p.requirement_key)) {
      throw forbidden(`권한 없음: '${p.requirement_key}' 근거는 ${policy.evidenceOwner(eng.adapter, p.requirement_key)} 또는 현장 담당자(후보 등록)만 등록할 수 있습니다.`);
    }
    if (p.unit && p.unit !== eng.adapter.unit) throw bad(`단위가 다릅니다(${p.unit} ≠ ${eng.adapter.unit}). 자동 매핑하지 않습니다.`);
    if (p.corrects_id) {
      const c = ctx.db.prepare('SELECT * FROM evidence WHERE id=? AND item_id=?').get(p.corrects_id, item.id);
      if (!c) throw bad('정정 대상 근거를 찾을 수 없습니다.');
    }
    const r = insertEvidence(ctx, eng, { ...p, item_id: item.id });
    if (p.requirement_key === '_START' && p.value === 'verified' && p.source_ref && r.status === 'confirmed') openFollowups(ctx, eng, item.id, r.id);
    const warn = [];
    if (p.value === 'verified' && !p.source_ref) warn.push('자료 식별번호가 없어 판정에서는 "미확인"으로 처리됩니다.');
    if (r.status === 'candidate') warn.push('후보로 등록됐습니다. 근거 자료 관리자가 확인하기 전에는 판정 근거가 아닙니다.');
    return { ...r, warnings: warn, __audit: { value: p.value, status: r.status } };
  });
}

function reviewEvidence(ctx, engId, evidenceId, decision, note) {
  needActor(ctx);
  return audited(ctx, { engagementId: engId, action: `evidence.${decision}`, subject: String(evidenceId) }, () => {
    const eng = getEng(ctx, engId);
    const ev = ctx.db.prepare('SELECT * FROM evidence WHERE id=? AND engagement_id=?').get(evidenceId, eng.id);
    if (!ev) throw notFound('근거를 찾을 수 없습니다.');
    if (ev.status !== 'candidate') throw conflict('후보 상태의 근거만 확정/반려할 수 있습니다.');
    const owner = policy.canConfirmEvidence(ctx.actor.role, eng.adapter, ev.requirement_key);
    if (decision === 'confirm') {
      if (!owner) throw forbidden('권한 없음: 이 근거를 확정할 수 있는 역할은 근거 자료 관리자뿐입니다(검토자·컨설턴트·FDE는 확정할 수 없습니다).');
      ctx.db.prepare(`UPDATE evidence SET status='confirmed', confirmed_at=?, confirmed_by=? WHERE id=?`).run(now(ctx), ctx.actor.username, evidenceId);
      if (ev.requirement_key === '_START' && ev.value === 'verified' && ev.source_ref) openFollowups(ctx, eng, ev.item_id, ev.id);
    } else if (decision === 'reject') {
      if (!owner && ctx.actor.role !== 'reviewer') throw forbidden('권한 없음: 반려는 근거 자료 관리자 또는 검토자만 할 수 있습니다.');
      if (!note) throw bad('반려 사유를 적어 주세요(누락 시 보완 요청).');
      ctx.db.prepare(`UPDATE evidence SET status='rejected', confirmed_at=?, confirmed_by=?, note=COALESCE(note||' | ','')||? WHERE id=?`).run(now(ctx), ctx.actor.username, `반려: ${note}`, evidenceId);
    } else throw bad('decision 은 confirm/reject');
    return { id: evidenceId, status: decision === 'confirm' ? 'confirmed' : 'rejected' };
  });
}

/** 일괄 수집: 같은 과업 ID 재전송은 한 번만, 단위·그룹 코드가 틀린 행은 거부 큐로 */
function ingest(ctx, engId, rows) {
  needActor(ctx);
  return audited(ctx, { engagementId: engId, action: 'ingest', subject: `${Array.isArray(rows) ? rows.length : 0}행` }, () => {
    allow(ctx, 'ingest');
    const eng = getEng(ctx, engId);
    if (!Array.isArray(rows) || !rows.length) throw bad('rows 가 비어 있습니다.');
    if (rows.length > 2000) throw bad('한 번에 2000행까지만 수집합니다.');
    const groups = new Map(ctx.db.prepare('SELECT * FROM groups WHERE engagement_id=?').all(eng.id).map((g) => [g.code, g]));
    const res = { applied: 0, duplicates: 0, rejected: 0, candidates: 0, created_items: 0, reject_reasons: [] };
    const reject = (row, reason) => {
      ctx.db.prepare(`INSERT INTO reject_queue (engagement_id, raw, reason, created_at, created_by) VALUES (?,?,?,?,?)`).run(eng.id, JSON.stringify(row).slice(0, 2000), reason, now(ctx), ctx.actor.username);
      res.rejected++; res.reject_reasons.push(reason);
    };
    for (const row of rows) {
      const ref = String(row.ref_key || '').trim();
      if (!ref) { reject(row, '대상 식별키가 없습니다.'); continue; }
      const key = row.requirement_key;
      try { checkKey(eng, key); } catch { reject(row, `알 수 없는 요건: ${key}`); continue; }
      if (!VALUES.includes(row.value)) { reject(row, `근거 값이 올바르지 않습니다: ${row.value}`); continue; }
      if (!row.unit || row.unit !== eng.adapter.unit) { reject(row, `단위 누락/불일치(${row.unit || '없음'} ≠ ${eng.adapter.unit}) — 자동 매핑 금지`); continue; }
      if (!policy.canRegisterEvidence(ctx.actor.role, eng.adapter, key)) { reject(row, `이 역할은 ${key} 근거를 등록할 수 없습니다.`); continue; }
      let item = ctx.db.prepare('SELECT * FROM items WHERE engagement_id=? AND ref_key=?').get(eng.id, ref);
      if (row.group_code != null && row.group_code !== '' && !groups.has(row.group_code)) { reject(row, `하위 범주 코드가 없는 값입니다: ${row.group_code} — 자동 매핑 금지`); continue; }
      if (!item) {
        if (!['hr', 'fde', 'consultant'].includes(ctx.actor.role)) { reject(row, '새 대상은 인사 담당·FDE·컨설턴트만 만들 수 있습니다.'); continue; }
        if (!row.group_code) { reject(row, '새 대상에는 하위 범주 코드가 필요합니다.'); continue; }
        const g = groups.get(row.group_code);
        const info = ctx.db.prepare('INSERT INTO items (engagement_id, ref_key, group_id, planned_on, created_at) VALUES (?,?,?,?,?)').run(eng.id, ref, g.id, row.planned_on || null, now(ctx));
        item = { id: Number(info.lastInsertRowid), group_id: g.id };
        ctx.db.prepare('INSERT INTO assignments (engagement_id,item_id,group_id,created_at,created_by) VALUES (?,?,?,?,?)').run(eng.id, item.id, g.id, now(ctx), ctx.actor.username);
        res.created_items++;
      } else if (row.group_code && groups.get(row.group_code).id !== item.group_id) {
        reject(row, `대상 ${ref} 의 하위 범주가 기존과 다릅니다 — 배정 변경은 별도 실행 작업입니다.`); continue;
      }
      const idem = row.task_id ? String(row.task_id) : sha256([ref, key, row.value, row.source_ref || '', row.occurred_at || ''].join('|')).slice(0, 24);
      const dupe = ctx.db.prepare('SELECT 1 FROM evidence WHERE engagement_id=? AND idem_key=?').get(eng.id, idem);
      if (dupe) { res.duplicates++; continue; }
      const r = insertEvidence(ctx, eng, { item_id: item.id, requirement_key: key, value: row.value, source_ref: row.source_ref, source_version: row.source_version, unit: row.unit, occurred_at: row.occurred_at, note: row.note, origin: row.origin === 'ocr_ai' ? 'ocr_ai' : 'import', idem_key: idem });
      if (key === '_START' && row.value === 'verified' && row.source_ref && r.status === 'confirmed') openFollowups(ctx, eng, item.id, r.id);
      res.applied++; if (r.status === 'candidate') res.candidates++;
    }
    res.__audit = { applied: res.applied, duplicates: res.duplicates, rejected: res.rejected };
    return res;
  });
}

function resolveReject(ctx, engId, rejectId, note) {
  needActor(ctx);
  return audited(ctx, { engagementId: engId, action: 'reject.resolve', subject: String(rejectId) }, () => {
    allow(ctx, 'reject.resolve');
    const r = ctx.db.prepare('SELECT * FROM reject_queue WHERE id=? AND engagement_id=?').get(rejectId, engId);
    if (!r) throw notFound();
    ctx.db.prepare(`UPDATE reject_queue SET status='resolved', reason=reason||' → 처리: '||? WHERE id=?`).run(note || '확인함', rejectId);
    return { id: rejectId, status: 'resolved' };
  });
}

// ───────────────────────── 배정 / 보류 ─────────────────────────
function changeAssignment(ctx, engId, p) {
  needActor(ctx);
  return audited(ctx, { engagementId: engId, action: 'assignment.change', subject: String(p.item_id ?? p.ref_key) }, () => {
    allow(ctx, 'assignment.change');
    const eng = getEng(ctx, engId);
    const item = getItem(ctx, eng.id, p.item_id ?? p.ref_key);
    const to = ctx.db.prepare('SELECT * FROM groups WHERE engagement_id=? AND code=?').get(eng.id, p.to_group_code);
    if (!to) throw bad(`하위 범주 코드가 없습니다: ${p.to_group_code} — 자동 매핑하지 않습니다.`);
    if (!p.reason) throw bad('변경 사유를 적어 주세요.');
    const cur = ctx.db.prepare(`SELECT * FROM assignments WHERE item_id=? AND status='active'`).get(item.id);
    if (p.expected_assignment_id != null && (!cur || cur.id !== Number(p.expected_assignment_id))) {
      throw conflict('동시 배정 충돌: 다른 담당자가 먼저 배정을 변경했습니다. 한쪽만 성공합니다.');
    }
    if (cur) ctx.db.prepare(`UPDATE assignments SET status='released' WHERE id=?`).run(cur.id);
    const info = ctx.db.prepare('INSERT INTO assignments (engagement_id,item_id,group_id,created_at,created_by) VALUES (?,?,?,?,?)').run(eng.id, item.id, to.id, now(ctx), ctx.actor.username);
    ctx.db.prepare('UPDATE items SET group_id=? WHERE id=?').run(to.id, item.id);
    return { assignment_id: Number(info.lastInsertRowid), __audit: { from: cur && cur.group_id, to: to.code, reason: p.reason } };
  });
}

function openHold(ctx, engId, p) {
  needActor(ctx);
  return audited(ctx, { engagementId: engId, action: 'hold.open', subject: String(p.item_id ?? p.ref_key) }, () => {
    allow(ctx, 'hold.open');
    const eng = getEng(ctx, engId);
    const item = getItem(ctx, eng.id, p.item_id ?? p.ref_key);
    if (!p.reason) throw bad('보류 사유가 필요합니다.');
    if (ctx.db.prepare(`SELECT 1 FROM holds WHERE item_id=? AND status='open'`).get(item.id)) throw conflict('이미 열린 보류가 있습니다.');
    const info = ctx.db.prepare('INSERT INTO holds (engagement_id,item_id,reason,opened_at,opened_by) VALUES (?,?,?,?,?)').run(eng.id, item.id, p.reason, now(ctx), ctx.actor.username);
    return { id: Number(info.lastInsertRowid), version: 1 };
  });
}

function releaseHold(ctx, engId, holdId, p) {
  needActor(ctx);
  return audited(ctx, { engagementId: engId, action: 'hold.release', subject: String(holdId) }, () => {
    allow(ctx, 'hold.release');
    const h = ctx.db.prepare('SELECT * FROM holds WHERE id=? AND engagement_id=?').get(holdId, engId);
    if (!h) throw notFound('보류를 찾을 수 없습니다.');
    if (!p.reason) throw bad('해제 사유가 필요합니다.');
    if (h.status !== 'open' || Number(p.expected_version) !== h.version) {
      const err = conflict('동시 해제 충돌: 이미 다른 담당자가 이 보류를 처리했습니다. 한쪽만 성공하며 이쪽은 재검토로 전환됩니다.');
      const actor = ctx.actor.username; const at = now(ctx);
      err.afterRollback = () => ctx.db.prepare(`INSERT INTO re_reviews (engagement_id,subject_type,subject_id,reason,created_at,created_by) VALUES (?,?,?,?,?,?)`)
        .run(engId, 'hold', holdId, '동시 해제 충돌 — 재검토 필요', at, actor);
      throw err;
    }
    ctx.db.prepare(`UPDATE holds SET status='released', version=version+1, released_at=?, released_by=?, release_reason=? WHERE id=?`).run(now(ctx), ctx.actor.username, p.reason, holdId);
    return { id: holdId, status: 'released' };
  });
}

function resolveReReview(ctx, engId, id, note) {
  needActor(ctx);
  return audited(ctx, { engagementId: engId, action: 'rereview.resolve', subject: String(id) }, () => {
    allow(ctx, 'rereview.resolve');
    const r = ctx.db.prepare('SELECT * FROM re_reviews WHERE id=? AND engagement_id=?').get(id, engId);
    if (!r) throw notFound();
    ctx.db.prepare(`UPDATE re_reviews SET status='resolved', reason=reason||' → '||? WHERE id=?`).run(note || '확인함', id);
    return { id, status: 'resolved' };
  });
}

// ───────────────────────── 조치 ─────────────────────────
const INTERVENTION_NEXT = { DRAFT: ['SUBMITTED'], SUBMITTED: ['APPROVED', 'REJECTED'], APPROVED: ['IN_EXECUTION', 'STOPPED'], IN_EXECUTION: ['CLOSED', 'STOPPED'] };

function loadIntervention(ctx, engId, id) {
  const i = ctx.db.prepare('SELECT * FROM interventions WHERE id=? AND engagement_id=?').get(id, engId);
  if (!i) throw notFound('조치를 찾을 수 없습니다.');
  return { ...i, required_roles: jparse(i.required_roles, []), cost: jparse(i.cost, null) };
}

function proposeIntervention(ctx, engId, p) {
  needActor(ctx);
  return audited(ctx, { engagementId: engId, action: 'intervention.propose', subject: p.code || p.title }, () => {
    allow(ctx, 'intervention.propose');
    const eng = getEng(ctx, engId);
    if (!p.title) throw bad('조치 제목이 필요합니다.');
    const roles = Array.isArray(p.required_roles) ? p.required_roles : [];
    for (const r of roles) if (!policy.ROLES[r] || ['consultant', 'fde', 'admin', 'learner'].includes(r)) throw bad(`승인 역할로 쓸 수 없는 역할입니다: ${r} (컨설턴트·FDE·운영자는 승인하지 않습니다)`);
    if (p.task_key) checkKey(eng, p.task_key);
    const code = p.code || `A${ctx.db.prepare('SELECT COUNT(*) n FROM interventions WHERE engagement_id=?').get(eng.id).n}`;
    const t = now(ctx);
    const info = ctx.db.prepare(`INSERT INTO interventions (engagement_id,code,kind,title,description,target_bucket,task_key,required_roles,cost,stop_condition,recovery_path,proposed_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(eng.id, code, p.kind || 'alt1', p.title, p.description || null, p.target_bucket || null, p.task_key || null, JSON.stringify(roles), p.cost ? JSON.stringify(p.cost) : null, p.stop_condition || null, p.recovery_path || null, ctx.actor.username, t, t);
    const id = Number(info.lastInsertRowid);
    let ids = Array.isArray(p.target_item_ids) ? p.target_item_ids : [];
    if (!ids.length && p.target_bucket) {
      const snap = engine.snapshot(ctx.db, eng.id);
      ids = snap.items.filter((i) => i.bucket === p.target_bucket).map((i) => i.id);
    }
    for (const iid of ids) {
      getItem(ctx, eng.id, iid);
      ctx.db.prepare('INSERT OR IGNORE INTO intervention_targets (intervention_id,item_id) VALUES (?,?)').run(id, iid);
    }
    return { id, code, targets: ids.length };
  });
}

function submitIntervention(ctx, engId, id) {
  needActor(ctx);
  return audited(ctx, { engagementId: engId, action: 'intervention.submit', subject: String(id) }, () => {
    allow(ctx, 'intervention.submit');
    const iv = loadIntervention(ctx, engId, id);
    if (iv.status !== 'DRAFT') throw conflict(`DRAFT 상태에서만 제출할 수 있습니다(현재 ${iv.status}).`);
    const targets = ctx.db.prepare('SELECT COUNT(*) n FROM intervention_targets WHERE intervention_id=?').get(id).n;
    // 승인서에 적을 5가지: 대상·권한·비용·중단 조건·복구 경로
    const missing = [];
    if (iv.kind !== 'smallest' && !targets) missing.push('대상');
    if (!iv.required_roles.length) missing.push('권한(승인 역할)');
    if (iv.kind !== 'smallest' && !iv.cost) missing.push('비용 가정');
    if (!iv.stop_condition) missing.push('중단 조건');
    if (!iv.recovery_path) missing.push('복구 경로');
    if (missing.length) throw bad(`승인서에 빠진 항목이 있어 제출할 수 없습니다: ${missing.join(', ')}`, { missing });
    ctx.db.prepare(`UPDATE interventions SET status='SUBMITTED', updated_at=? WHERE id=?`).run(now(ctx), id);
    return { id, status: 'SUBMITTED' };
  });
}

function decideIntervention(ctx, engId, id, p) {
  needActor(ctx);
  return audited(ctx, { engagementId: engId, action: `intervention.${p.decision}`, subject: String(id) }, () => {
    const iv = loadIntervention(ctx, engId, id);
    if (!['approve', 'reject'].includes(p.decision)) throw bad('decision 은 approve/reject');
    if (iv.status !== 'SUBMITTED') throw conflict(`SUBMITTED 상태에서만 결재할 수 있습니다(현재 ${iv.status}).`);
    const role = ctx.actor.role;
    if (!policy.canApproveIntervention(role, iv.required_roles)) throw forbidden(`권한 없음: 이 조치의 승인 권한자는 [${iv.required_roles.map((r) => policy.ROLES[r].label).join(', ')}] 입니다. ${policy.ROLES[role].label}은(는) 승인할 수 없습니다.`);
    if (iv.proposed_by === ctx.actor.username) throw forbidden('제안자는 자신이 제안한 조치를 승인할 수 없습니다.');
    if (ctx.db.prepare(`SELECT 1 FROM approvals WHERE subject_type='intervention' AND subject_id=? AND role=? AND decision='approve'`).get(id, role)) throw conflict('이 역할은 이미 승인했습니다.');
    ctx.db.prepare(`INSERT INTO approvals (engagement_id,subject_type,subject_id,role,username,decision,comment,created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(engId, 'intervention', id, role, ctx.actor.username, p.decision, p.comment || null, now(ctx));
    let status = iv.status;
    if (p.decision === 'reject') status = 'REJECTED';
    else {
      const have = new Set(ctx.db.prepare(`SELECT role FROM approvals WHERE subject_type='intervention' AND subject_id=? AND decision='approve'`).all(id).map((r) => r.role));
      if (iv.required_roles.every((r) => have.has(r))) status = 'APPROVED';
    }
    ctx.db.prepare(`UPDATE interventions SET status=?, updated_at=? WHERE id=?`).run(status, now(ctx), id);
    // 중요: 여기서는 evidence 를 만들지 않는다. 조치 경로 승인만으로 준비 수량이 오르지 않는다.
    return { id, status, pending_roles: iv.required_roles.filter((r) => status === 'SUBMITTED' && !ctx.db.prepare(`SELECT 1 FROM approvals WHERE subject_type='intervention' AND subject_id=? AND role=? AND decision='approve'`).get(id, r)) };
  });
}

/** 중단 기준 초과 시: 실행 중 조치를 멈추고 이 요청도 거부한다. 중단 기록은 롤백 뒤 별도로 남긴다. */
function haltIfBreached(ctx, engId) {
  const snap = engine.snapshot(ctx.db, engId);
  const pr = engine.protection(ctx.db, engId, snap);
  if (!pr.stop) return;
  const err = conflict(`중단 기준 초과(${pr.breached.join(', ')}): 자동 실행을 멈추고 담당자 재검토를 배정했습니다.`);
  const at = now(ctx); const actor = ctx.actor.username;
  err.afterRollback = () => {
    ctx.db.prepare(`UPDATE interventions SET status='STOPPED', updated_at=? WHERE engagement_id=? AND status IN ('IN_EXECUTION','APPROVED')`).run(at, engId);
    ctx.db.prepare(`INSERT INTO re_reviews (engagement_id,subject_type,subject_id,reason,created_at,created_by) VALUES (?,?,?,?,?,?)`).run(engId, 'protection', 0, `자동 중단: ${pr.breached.join(', ')}`, at, actor);
  };
  throw err;
}

function startIntervention(ctx, engId, id) {
  needActor(ctx);
  return audited(ctx, { engagementId: engId, action: 'intervention.start', subject: String(id) }, () => {
    allow(ctx, 'intervention.start');
    haltIfBreached(ctx, engId);
    const iv = loadIntervention(ctx, engId, id);
    if (iv.status !== 'APPROVED') throw conflict(`승인(APPROVED)된 조치만 시작할 수 있습니다(현재 ${iv.status}). 결재 전 실행 금지.`);
    ctx.db.prepare(`UPDATE interventions SET status='IN_EXECUTION', updated_at=? WHERE id=?`).run(now(ctx), id);
    return { id, status: 'IN_EXECUTION' };
  });
}

function recordOutcome(ctx, engId, id, p) {
  needActor(ctx);
  return audited(ctx, { engagementId: engId, action: 'intervention.outcome', subject: `${id}/${p.item_id ?? p.ref_key}` }, () => {
    const eng = getEng(ctx, engId);
    haltIfBreached(ctx, engId);
    const iv = loadIntervention(ctx, engId, id);
    if (iv.status !== 'IN_EXECUTION') throw conflict(`실행 중(IN_EXECUTION)인 조치에만 결과를 기록할 수 있습니다(현재 ${iv.status}).`);
    if (!iv.task_key) throw bad('이 조치에는 재확인할 요건이 지정되지 않았습니다.');
    const item = getItem(ctx, eng.id, p.item_id ?? p.ref_key);
    const tgt = ctx.db.prepare('SELECT * FROM intervention_targets WHERE intervention_id=? AND item_id=?').get(id, item.id);
    if (!tgt) throw bad('이 조치의 대상이 아닌 항목입니다.');
    if (tgt.outcome) throw conflict('이미 결과가 기록된 대상입니다. 정정은 새 근거로 더합니다.');
    if (!['verified', 'unmet', 'missing'].includes(p.outcome)) throw bad('outcome 은 verified/unmet/missing');
    if (!policy.canConfirmEvidence(ctx.actor.role, eng.adapter, iv.task_key)) throw forbidden(`권한 없음: 재확인 결과는 ${policy.ROLES[policy.evidenceOwner(eng.adapter, iv.task_key)].label}만 기록할 수 있습니다.`);
    if (p.outcome === 'verified' && !p.source_ref) throw bad('확인 결과에는 자료 식별번호(근거)가 필요합니다. 없으면 미확인으로 기록하세요.');
    const ev = insertEvidence(ctx, eng, { item_id: item.id, requirement_key: iv.task_key, value: p.outcome, source_ref: p.source_ref, occurred_at: p.occurred_at, note: `조치 ${iv.code} 결과${p.note ? ': ' + p.note : ''}` });
    ctx.db.prepare(`UPDATE intervention_targets SET outcome=?, outcome_evidence_id=?, outcome_at=?, outcome_by=? WHERE intervention_id=? AND item_id=?`).run(p.outcome, ev.id, now(ctx), ctx.actor.username, id, item.id);
    if (iv.task_key === '_START' && p.outcome === 'verified') openFollowups(ctx, eng, item.id, ev.id);
    let hold = null;
    if (p.outcome !== 'verified') {
      if (!ctx.db.prepare(`SELECT 1 FROM holds WHERE item_id=? AND status='open'`).get(item.id)) {
        const h = ctx.db.prepare('INSERT INTO holds (engagement_id,item_id,reason,opened_at,opened_by) VALUES (?,?,?,?,?)').run(eng.id, item.id, `조치 ${iv.code} 후에도 해결되지 않음(${p.outcome})`, now(ctx), ctx.actor.username);
        hold = Number(h.lastInsertRowid);
      }
    }
    return { evidence_id: ev.id, hold_id: hold };
  });
}

function closeIntervention(ctx, engId, id) {
  needActor(ctx);
  return audited(ctx, { engagementId: engId, action: 'intervention.close', subject: String(id) }, () => {
    allow(ctx, 'intervention.close');
    const iv = loadIntervention(ctx, engId, id);
    if (iv.status !== 'IN_EXECUTION') throw conflict('실행 중인 조치만 종료할 수 있습니다.');
    const left = ctx.db.prepare('SELECT COUNT(*) n FROM intervention_targets WHERE intervention_id=? AND outcome IS NULL').get(id).n;
    if (left) throw conflict(`결과가 기록되지 않은 대상이 ${left}건 있습니다. 빈칸이 있는 실행 항목은 완료로 표시하지 않습니다.`);
    ctx.db.prepare(`UPDATE interventions SET status='CLOSED', updated_at=? WHERE id=?`).run(now(ctx), id);
    return { id, status: 'CLOSED' };
  });
}

function stopIntervention(ctx, engId, id, reason) {
  needActor(ctx);
  return audited(ctx, { engagementId: engId, action: 'intervention.stop', subject: String(id) }, () => {
    allow(ctx, 'intervention.stop');
    const iv = loadIntervention(ctx, engId, id);
    if (!['APPROVED', 'IN_EXECUTION'].includes(iv.status)) throw conflict('승인됐거나 실행 중인 조치만 중단할 수 있습니다.');
    if (!reason) throw bad('중단 사유가 필요합니다.');
    ctx.db.prepare(`INSERT INTO approvals (engagement_id,subject_type,subject_id,role,username,decision,comment,created_at) VALUES (?,?,?,?,?,?,?,?)`).run(engId, 'intervention', id, ctx.actor.role, ctx.actor.username, 'stop', reason, now(ctx));
    ctx.db.prepare(`UPDATE interventions SET status='STOPPED', updated_at=? WHERE id=?`).run(now(ctx), id);
    return { id, status: 'STOPPED' };
  });
}

// ───────────────────────── 외부 시스템 쓰기 연계 ─────────────────────────
/** 모의 원천 시스템. mode 가 'fail' 이면 반영에 실패한다. 같은 idem_key 는 한 번만 수락(중복 재전송 방지). */
function externalSend(ctx, idem, payload) {
  const mode = (ctx.db.prepare(`SELECT value FROM settings WHERE key='external_mode'`).get() || { value: 'ok' }).value;
  if (mode === 'fail') return { ok: false, error: '원천 시스템 응답 없음(모의 장애)' };
  const ex = ctx.db.prepare('SELECT 1 FROM external_ledger WHERE idem_key=?').get(idem);
  if (!ex) ctx.db.prepare('INSERT INTO external_ledger (idem_key,payload,accepted_at) VALUES (?,?,?)').run(idem, payload, now(ctx));
  return { ok: true, duplicate: !!ex };
}

function setSyncStage(ctx, engId, stage) {
  needActor(ctx);
  return audited(ctx, { engagementId: engId, action: 'sync.stage', subject: stage }, () => {
    allow(ctx, 'sync.stage');
    const eng = getEng(ctx, engId);
    const a = SYNC_STAGES.indexOf(eng.sync_stage), b = SYNC_STAGES.indexOf(stage);
    if (b < 0) throw bad(`단계는 ${SYNC_STAGES.join(' → ')} 중 하나`);
    if (b > a + 1) throw conflict('쓰기 연계는 읽기 → 시뮬레이션 → 수동 승인 → 제한된 실운영 순서로 한 단계씩 엽니다.');
    ctx.db.prepare('UPDATE engagements SET sync_stage=? WHERE id=?').run(stage, engId);
    return { sync_stage: stage };
  });
}

function requestSync(ctx, engId, p) {
  needActor(ctx);
  return audited(ctx, { engagementId: engId, action: 'sync.request', subject: `${p.subject_type}/${p.subject_id}` }, () => {
    allow(ctx, 'sync.request');
    const eng = getEng(ctx, engId);
    if (eng.sync_stage === 'read') throw conflict('현재 단계는 읽기 전용입니다. 쓰기 연계는 먼저 시뮬레이션 단계를 열어야 합니다.');
    if (p.subject_type !== 'intervention') throw bad('현재는 조치 결과(intervention)만 외부 반영을 요청할 수 있습니다.');
    const iv = loadIntervention(ctx, engId, p.subject_id);
    if (!['IN_EXECUTION', 'CLOSED'].includes(iv.status)) throw conflict('실행·종료된 조치의 결과만 외부 반영을 요청할 수 있습니다.');
    const outcomes = ctx.db.prepare(`SELECT i.ref_key, t.outcome FROM intervention_targets t JOIN items i ON i.id=t.item_id WHERE t.intervention_id=? AND t.outcome IS NOT NULL ORDER BY i.id`).all(iv.id);
    if (!outcomes.length) throw conflict('반영할 결과가 없습니다.');
    if (eng.sync_stage === 'limited_live' && outcomes.length > SYNC_LIVE_LIMIT) throw conflict(`제한된 실운영은 한 번에 ${SYNC_LIVE_LIMIT}건까지입니다(범위를 좁혀 요청).`);
    const idem = p.idem_key || `SYNC-${eng.task_code}-${iv.code}-${sha256(JSON.stringify(outcomes)).slice(0, 10)}`;
    const dup = ctx.db.prepare('SELECT * FROM external_syncs WHERE engagement_id=? AND idem_key=?').get(eng.id, idem);
    if (dup) return { id: dup.id, duplicate: true, platform_status: dup.platform_status, external_status: dup.external_status };
    const t = now(ctx);
    const info = ctx.db.prepare(`INSERT INTO external_syncs (engagement_id,subject_type,subject_id,idem_key,payload,stage,requested_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(eng.id, 'intervention', iv.id, idem, JSON.stringify({ intervention: iv.code, outcomes }), eng.sync_stage, ctx.actor.username, t, t);
    return { id: Number(info.lastInsertRowid), idem_key: idem, stage: eng.sync_stage };
  });
}

function approveSync(ctx, engId, id, decision) {
  needActor(ctx);
  return audited(ctx, { engagementId: engId, action: `sync.${decision}`, subject: String(id) }, () => {
    allow(ctx, 'sync.approve');
    const s = ctx.db.prepare('SELECT * FROM external_syncs WHERE id=? AND engagement_id=?').get(id, engId);
    if (!s) throw notFound();
    if (s.requested_by === ctx.actor.username) throw forbidden('요청자는 자신의 연계 요청을 승인할 수 없습니다.');
    if (s.platform_status !== 'requested') throw conflict('이미 결재된 요청입니다.');
    ctx.db.prepare(`UPDATE external_syncs SET platform_status=?, approved_by=?, updated_at=? WHERE id=?`).run(decision === 'approve' ? 'approved' : 'rejected', ctx.actor.username, now(ctx), id);
    return { id, platform_status: decision === 'approve' ? 'approved' : 'rejected' };
  });
}

function sendSync(ctx, engId, id) {
  needActor(ctx);
  return audited(ctx, { engagementId: engId, action: 'sync.send', subject: String(id) }, () => {
    allow(ctx, 'sync.send');
    const eng = getEng(ctx, engId);
    const s = ctx.db.prepare('SELECT * FROM external_syncs WHERE id=? AND engagement_id=?').get(id, engId);
    if (!s) throw notFound();
    if (eng.sync_stage === 'read') throw conflict('읽기 단계에서는 보낼 수 없습니다.');
    if (eng.sync_stage === 'simulation') {
      // 모의 원자료로 형식만 확인한다. 외부 원장에는 쓰지 않는다.
      return { id, dry_run: true, external_status: s.external_status, message: '시뮬레이션: 페이로드 형식 확인만 했고 외부에는 쓰지 않았습니다.' };
    }
    if (s.platform_status !== 'approved') throw conflict('플랫폼 결재(수동 승인)가 끝나기 전에는 외부로 보낼 수 없습니다.');
    if (s.external_status === 'accepted' || s.external_status === 'manual_reconciled') return { id, external_status: s.external_status, duplicate: true };
    const r = externalSend(ctx, s.idem_key, s.payload);
    const st = r.ok ? 'accepted' : 'failed';
    ctx.db.prepare(`UPDATE external_syncs SET external_status=?, attempts=attempts+1, last_error=?, updated_at=? WHERE id=?`).run(st, r.ok ? null : r.error, now(ctx), id);
    return { id, external_status: st, error: r.error || null, duplicate: !!r.duplicate, note: r.ok ? '외부 시스템이 수락했습니다.' : '플랫폼에서는 결재됐지만 외부에는 반영되지 않았습니다. 별도 상태로 관리하며 수동 절차·비교 확인으로 처리합니다.' };
  });
}

function reconcileSync(ctx, engId, id, note) {
  needActor(ctx);
  return audited(ctx, { engagementId: engId, action: 'sync.reconcile', subject: String(id) }, () => {
    allow(ctx, 'sync.reconcile');
    const s = ctx.db.prepare('SELECT * FROM external_syncs WHERE id=? AND engagement_id=?').get(id, engId);
    if (!s) throw notFound();
    if (s.external_status !== 'failed') throw conflict('실패한 연계만 수동 처리할 수 있습니다.');
    if (!note) throw bad('수동 비교 확인 결과를 적어 주세요.');
    ctx.db.prepare(`UPDATE external_syncs SET external_status='manual_reconciled', last_error=last_error||' | 수동: '||?, updated_at=? WHERE id=?`).run(note, now(ctx), id);
    return { id, external_status: 'manual_reconciled' };
  });
}

module.exports = {
  VALUES, SYNC_STAGES, getEng, getItem, checkKey, insertEvidence,
  registerEvidence, reviewEvidence, ingest, resolveReject,
  changeAssignment, openHold, releaseHold, resolveReReview,
  proposeIntervention, submitIntervention, decideIntervention, startIntervention, recordOutcome, closeIntervention, stopIntervention, loadIntervention,
  setSyncStage, requestSync, approveSync, sendSync, reconcileSync, externalSend, haltIfBreached,
};
