'use strict';
const fs = require('fs');
const path = require('path');
const express = require('express');
const engine = require('./engine');
const svc = require('./services');
const wt = require('./worktools');
const policy = require('./policy');
const ontology = require('./ontology');
const auth = require('./auth');
const { audited, verifyChain } = require('./audit');
const { HttpError, bad, forbidden, notFound, jparse, isoNow } = require('./util');
const seed = require('./seed');

const CONTENT_DIR = path.join(__dirname, '..', 'content');
const CONTENT = ['course', 'concepts', 'template', 'process', 'tech', 'practices', 'quiz', 'extras'];
const contentCache = new Map();
function content(name) {
  if (!CONTENT.includes(name)) throw notFound('콘텐츠가 없습니다.');
  if (!contentCache.has(name)) contentCache.set(name, JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, `${name}.json`), 'utf8')));
  return contentCache.get(name);
}

/** 현장 담당자는 본인이 입력한 근거만 본다 — 판정 요약의 자료 식별번호·메모도 가린다(역할별 열람 최소화). */
function redactFor(role, snap) {
  if (role !== 'field') return snap;
  const strip = (i) => ({ ...i, req: Object.fromEntries(Object.entries(i.req).map(([k, v]) => [k, { value: v.value, reason: v.reason, source_ref: null, ev_id: null, occurred_at: null, note: null }])) });
  return { ...snap, items: snap.items.map(strip), redacted: true };
}

function createApi(db, { clock, isProd = false, demoPassword = null } = {}) {
  const api = express.Router();
  const ctx = (req) => ({ db, clock, actor: req.actor });
  const wrap = (fn) => (req, res, next) => { try { const r = fn(req, res); if (r !== undefined) res.json(r); } catch (e) { next(e); } };
  const E = (req) => { const n = Number(req.params.id); if (!Number.isInteger(n) || n < 1) throw bad('과업 번호가 올바르지 않습니다.'); return n; };
  const N = (v, name) => { const n = Number(v); if (!Number.isInteger(n) || n < 1) throw bad(`${name} 가 올바르지 않습니다.`); return n; };
  const need = (req, a) => { if (!policy.can(req.actor.role, a)) throw forbidden(`권한 없음: ${a}`); };
  const exists = (id) => { if (!db.prepare('SELECT 1 FROM engagements WHERE id=?').get(id)) throw notFound('과업을 찾을 수 없습니다.'); };

  // ───────────── 공개: 로그인 · 메타 ─────────────
  api.post('/auth/login', wrap((req) => auth.login(db, req.ip, req.body && req.body.username, req.body && req.body.password)));
  api.get('/auth/demo', wrap(() => ({
    users: isProd && !process.env.EXPOSE_DEMO_USERS ? [] : db.prepare('SELECT username, display_name, role FROM users WHERE active=1 ORDER BY id').all().map((u) => ({ ...u, role_label: policy.ROLES[u.role].label })),
    password_hint: !isProd && demoPassword ? demoPassword : null,
    note: isProd ? '운영 모드: 데모 계정 비밀번호는 환경변수 DEMO_PASSWORD 로 설정된 값입니다.' : '개발 모드: 데모 계정은 모두 같은 비밀번호를 씁니다.',
  })));

  api.use(auth.authMiddleware(db));

  api.get('/auth/me', wrap((req) => ({ ...req.actor, role_label: policy.ROLES[req.actor.role].label, role_desc: policy.ROLES[req.actor.role].desc })));
  api.get('/meta', wrap(() => ({
    roles: policy.ROLES, buckets: engine.BUCKET_LABEL,
    adapters: db.prepare('SELECT id,key,name,industry,task_name,unit,item_label,group_label,start_label,start_owner,requirements,role_labels,trap,regulations FROM adapters ORDER BY id').all()
      .map((a) => ({ ...a, requirements: jparse(a.requirements, []), role_labels: jparse(a.role_labels, {}) })),
    forms: wt.formDefs(), sync_stages: svc.SYNC_STAGES,
  })));
  api.post('/adapters', wrap((req) => wt.createAdapter(ctx(req), req.body || {})));

  // ───────────── 과업 목록 · 생성 ─────────────
  api.get('/engagements', wrap(() => db.prepare('SELECT id FROM engagements ORDER BY id').all().map(({ id }) => {
    const s = engine.snapshot(db, id);
    return { id, ...s.engagement, basis: s.basis, counts: s.counts, metrics: s.metrics, integrity_ok: s.integrity_ok };
  })));
  api.post('/engagements', wrap((req, res) => { res.status(201); return wt.createEngagement(ctx(req), req.body || {}); }));

  // ───────────── 판정 스냅샷 · 분석 ─────────────
  api.get('/engagements/:id', wrap((req) => {
    const id = E(req); exists(id);
    const snap = engine.snapshot(db, id, { basis: req.query.basis, known: req.query.known });
    const eng = engine.loadEngagement(db, id);
    const base = engine.baseline(db, id);
    const open = (t, extra = '') => db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE engagement_id=? ${extra}`).get(id).n;
    return {
      ...redactFor(req.actor.role, snap), adapter: { ...eng.adapter }, sync_stage: eng.sync_stage, notes: eng.notes, basis_date: eng.basis_date,
      baseline: { basis: base.basis, counts: base.counts, metrics: base.metrics, groups: base.groups, group_metrics: base.group_metrics },
      open: { candidates: open('evidence', `AND status='candidate'`), rejects: open('reject_queue', `AND status='open'`), re_reviews: open('re_reviews', `AND status='open'`), holds: open('holds', `AND status='open'`) },
      quality: engine.quality(db, id, snap), protection: engine.protection(db, id, snap),
    };
  }));
  api.get('/engagements/:id/items/:itemId', wrap((req) => {
    const id = E(req); exists(id);
    const snap = engine.snapshot(db, id, { basis: req.query.basis, known: req.query.known });
    const item = redactFor(req.actor.role, snap).items.find((i) => i.id === N(req.params.itemId, 'itemId'));
    if (!item) throw notFound('대상을 찾을 수 없습니다.');
    const eng = engine.loadEngagement(db, id);
    let ev = db.prepare('SELECT * FROM evidence WHERE item_id=? ORDER BY occurred_at, id').all(item.id);
    // 현장 담당자는 본인이 입력한 근거만 본다 (역할별 열람 최소화)
    if (req.actor.role === 'field') ev = ev.filter((e) => e.recorded_by === req.actor.username);
    const role = req.actor.role;
    const keys = ['_START', ...eng.adapter.requirements.map((r) => r.key)];
    return {
      item, evidence: ev, filtered: role === 'field',
      holds: db.prepare('SELECT * FROM holds WHERE item_id=? ORDER BY id').all(item.id),
      assignments: db.prepare('SELECT a.*, g.code group_code, g.name group_name FROM assignments a JOIN groups g ON g.id=a.group_id WHERE a.item_id=? ORDER BY a.id').all(item.id),
      can: {
        register: keys.filter((k) => policy.canRegisterEvidence(role, eng.adapter, k)),
        confirm: keys.filter((k) => policy.canConfirmEvidence(role, eng.adapter, k)),
        hold: policy.can(role, 'hold.open'), reassign: policy.can(role, 'assignment.change'),
      },
    };
  }));
  api.get('/engagements/:id/transitions', wrap((req) => {
    const id = E(req); exists(id); const q = req.query;
    return engine.transitions(engine.snapshot(db, id, { basis: q.from_basis, known: q.from_known }), engine.snapshot(db, id, { basis: q.to_basis, known: q.to_known }));
  }));
  api.get('/engagements/:id/periods', wrap((req) => { const id = E(req); exists(id); return engine.periodRows(engine.snapshot(db, id, { basis: req.query.basis, known: req.query.known })); }));
  api.post('/engagements/:id/periods/validate', wrap((req) => {
    const id = E(req); exists(id);
    const rows = req.body && req.body.rows;
    if (!Array.isArray(rows) || rows.length > 500) throw bad('rows 는 500행 이하의 배열이어야 합니다.');
    return engine.validatePeriodRows(rows, engine.snapshot(db, id, { basis: req.body.basis, known: req.body.known }));
  }));
  api.get('/engagements/:id/quality', wrap((req) => { const id = E(req); exists(id); return engine.quality(db, id, engine.snapshot(db, id)); }));
  api.get('/engagements/:id/protection', wrap((req) => { const id = E(req); exists(id); return engine.protection(db, id, engine.snapshot(db, id)); }));
  api.put('/engagements/:id/protection-rules', wrap((req) => {
    const id = E(req); exists(id);
    return audited(ctx(req), { engagementId: id, action: 'protection.rules', subject: String(id) }, () => {
      if (!['consultant', 'exec'].includes(req.actor.role)) throw forbidden('권한 없음: 중단 기준은 컨설턴트와 경영진이 현장과 함께 정합니다.');
      const b = req.body || {}; const out = {};
      for (const k of ['missing_max', 'delay_max', 'unauthorized_max', 'burden_max']) {
        if (b[k] === null || b[k] === undefined || b[k] === '') continue;
        const n = Number(b[k]); if (!Number.isFinite(n) || n < 0) throw bad(`${k} 는 0 이상의 숫자`);
        out[k] = n;
      }
      db.prepare('UPDATE engagements SET protection_rules=? WHERE id=?').run(JSON.stringify(out), id);
      return { protection_rules: out };
    });
  }));
  api.post('/engagements/:id/rules', wrap((req) => { const id = E(req); exists(id); return wt.addRuleVersion(ctx(req), id, req.body || {}); }));
  api.get('/engagements/:id/rules', wrap((req) => { const id = E(req); exists(id); return db.prepare('SELECT * FROM rule_versions WHERE engagement_id=? ORDER BY version').all(id).map((r) => ({ ...r, required_keys: jparse(r.required_keys, []) })); }));
  api.get('/engagements/:id/ontology', wrap((req) => { const id = E(req); exists(id); return ontology.describe(db, id); }));
  api.get('/engagements/:id/report', wrap((req) => { const id = E(req); exists(id); return wt.report(db, id); }));
  api.post('/engagements/:id/compare', wrap((req) => { const id = E(req); exists(id); return wt.compare(db, id, req.body || {}); }));
  api.post('/engagements/:id/reset', wrap((req) => {
    const id = E(req); exists(id);
    return audited(ctx(req), { engagementId: id, action: 'case.reset', subject: String(id) }, () => {
      need(req, 'case.reset');
      const nid = seed.resetCase(db, id);
      return { id: nid };
    });
  }));

  // ───────────── 근거 · 수집 · 거부 큐 ─────────────
  api.get('/engagements/:id/evidence', wrap((req) => {
    const id = E(req); exists(id);
    const st = req.query.status;
    let rows = db.prepare(`SELECT e.*, i.ref_key FROM evidence e JOIN items i ON i.id=e.item_id WHERE e.engagement_id=? ${st ? 'AND e.status=?' : ''} ORDER BY e.id DESC LIMIT 500`).all(...(st ? [id, st] : [id]));
    if (req.actor.role === 'field') rows = rows.filter((e) => e.recorded_by === req.actor.username);
    return rows;
  }));
  api.post('/engagements/:id/evidence', wrap((req, res) => { const id = E(req); exists(id); res.status(201); return svc.registerEvidence(ctx(req), id, req.body || {}); }));
  api.post('/engagements/:id/evidence/:eid/:decision', wrap((req) => {
    const id = E(req); exists(id);
    if (!['confirm', 'reject'].includes(req.params.decision)) throw notFound();
    return svc.reviewEvidence(ctx(req), id, N(req.params.eid, 'eid'), req.params.decision, req.body && req.body.note);
  }));
  api.post('/engagements/:id/ingest', wrap((req) => { const id = E(req); exists(id); return svc.ingest(ctx(req), id, req.body && req.body.rows); }));
  api.get('/engagements/:id/reject-queue', wrap((req) => { const id = E(req); exists(id); return db.prepare('SELECT * FROM reject_queue WHERE engagement_id=? ORDER BY id DESC LIMIT 200').all(id); }));
  api.post('/engagements/:id/reject-queue/:rid/resolve', wrap((req) => { const id = E(req); exists(id); return svc.resolveReject(ctx(req), id, N(req.params.rid, 'rid'), req.body && req.body.note); }));

  // ───────────── 배정 · 보류 · 재검토 ─────────────
  api.post('/engagements/:id/assignments', wrap((req) => { const id = E(req); exists(id); return svc.changeAssignment(ctx(req), id, req.body || {}); }));
  api.get('/engagements/:id/holds', wrap((req) => { const id = E(req); exists(id); return db.prepare(`SELECT h.*, i.ref_key FROM holds h JOIN items i ON i.id=h.item_id WHERE h.engagement_id=? ORDER BY h.id DESC`).all(id); }));
  api.post('/engagements/:id/holds', wrap((req, res) => { const id = E(req); exists(id); res.status(201); return svc.openHold(ctx(req), id, req.body || {}); }));
  api.post('/engagements/:id/holds/:hid/release', wrap((req) => { const id = E(req); exists(id); return svc.releaseHold(ctx(req), id, N(req.params.hid, 'hid'), req.body || {}); }));
  api.get('/engagements/:id/re-reviews', wrap((req) => { const id = E(req); exists(id); return db.prepare('SELECT * FROM re_reviews WHERE engagement_id=? ORDER BY id DESC').all(id); }));
  api.post('/engagements/:id/re-reviews/:rid/resolve', wrap((req) => { const id = E(req); exists(id); return svc.resolveReReview(ctx(req), id, N(req.params.rid, 'rid'), req.body && req.body.note); }));

  // ───────────── 원인 후보 ─────────────
  api.get('/engagements/:id/hypotheses', wrap((req) => { const id = E(req); exists(id); return wt.hypothesesView(db, id); }));
  api.patch('/engagements/:id/hypotheses/:hid', wrap((req) => { const id = E(req); exists(id); return wt.saveHypothesis(ctx(req), id, N(req.params.hid, 'hid'), req.body || {}); }));

  // ───────────── 조치 · 시나리오 ─────────────
  api.get('/engagements/:id/interventions', wrap((req) => {
    const id = E(req); exists(id);
    return db.prepare('SELECT * FROM interventions WHERE engagement_id=? ORDER BY id').all(id).map((i) => ({
      ...i, required_roles: jparse(i.required_roles, []), cost: jparse(i.cost, null), cost_calc: engine.costOf(jparse(i.cost, null)),
      targets: db.prepare(`SELECT t.*, it.ref_key FROM intervention_targets t JOIN items it ON it.id=t.item_id WHERE t.intervention_id=? ORDER BY it.id`).all(i.id),
      approvals: db.prepare(`SELECT role, username, decision, comment, created_at FROM approvals WHERE subject_type='intervention' AND subject_id=? ORDER BY id`).all(i.id),
    }));
  }));
  api.post('/engagements/:id/interventions', wrap((req, res) => { const id = E(req); exists(id); res.status(201); return svc.proposeIntervention(ctx(req), id, req.body || {}); }));
  const IV = (name, fn) => api.post(`/engagements/:id/interventions/:iid/${name}`, wrap((req) => { const id = E(req); exists(id); return fn(ctx(req), id, N(req.params.iid, 'iid'), req.body || {}); }));
  IV('submit', (c, id, iid) => svc.submitIntervention(c, id, iid));
  IV('decide', (c, id, iid, b) => svc.decideIntervention(c, id, iid, b));
  IV('start', (c, id, iid) => svc.startIntervention(c, id, iid));
  IV('outcome', (c, id, iid, b) => svc.recordOutcome(c, id, iid, b));
  IV('close', (c, id, iid) => svc.closeIntervention(c, id, iid));
  IV('stop', (c, id, iid, b) => svc.stopIntervention(c, id, iid, b.reason));
  api.get('/engagements/:id/scenarios', wrap((req) => { const id = E(req); exists(id); return db.prepare('SELECT id,name,note,assumptions FROM scenarios WHERE engagement_id=?').all(id).map((s) => ({ id: s.id, name: s.name, note: s.note, assumptions: jparse(s.assumptions, []) })); }));
  api.get('/engagements/:id/scenarios/:sid/simulate', wrap((req) => { const id = E(req); exists(id); const r = engine.simulate(db, id, N(req.params.sid, 'sid')); if (!r) throw notFound('시나리오를 찾을 수 없습니다.'); return r; }));

  // ───────────── 외부 시스템 쓰기 연계 ─────────────
  api.get('/engagements/:id/sync', wrap((req) => { const id = E(req); exists(id); return { stage: engine.loadEngagement(db, id).sync_stage, stages: svc.SYNC_STAGES, items: db.prepare('SELECT * FROM external_syncs WHERE engagement_id=? ORDER BY id DESC').all(id).map((s) => ({ ...s, payload: jparse(s.payload, {}) })), external_mode: (db.prepare(`SELECT value FROM settings WHERE key='external_mode'`).get() || { value: 'ok' }).value }; }));
  api.post('/engagements/:id/sync/stage', wrap((req) => { const id = E(req); exists(id); return svc.setSyncStage(ctx(req), id, req.body && req.body.stage); }));
  api.post('/engagements/:id/sync', wrap((req, res) => { const id = E(req); exists(id); res.status(201); return svc.requestSync(ctx(req), id, req.body || {}); }));
  api.post('/engagements/:id/sync/:sid/approve', wrap((req) => { const id = E(req); exists(id); return svc.approveSync(ctx(req), id, N(req.params.sid, 'sid'), 'approve'); }));
  api.post('/engagements/:id/sync/:sid/reject', wrap((req) => { const id = E(req); exists(id); return svc.approveSync(ctx(req), id, N(req.params.sid, 'sid'), 'reject'); }));
  api.post('/engagements/:id/sync/:sid/send', wrap((req) => { const id = E(req); exists(id); return svc.sendSync(ctx(req), id, N(req.params.sid, 'sid')); }));
  api.post('/engagements/:id/sync/:sid/reconcile', wrap((req) => { const id = E(req); exists(id); return svc.reconcileSync(ctx(req), id, N(req.params.sid, 'sid'), req.body && req.body.note); }));
  api.post('/admin/external-mode', wrap((req) => {
    if (req.actor.role !== 'admin') throw forbidden('권한 없음: 모의 장애 주입은 운영자(강사)만 할 수 있습니다.');
    const mode = req.body && req.body.mode;
    if (!['ok', 'fail'].includes(mode)) throw bad('mode 는 ok/fail');
    db.prepare(`INSERT INTO settings (key,value) VALUES ('external_mode',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(mode);
    return { external_mode: mode };
  }));

  // ───────────── 서식 · 작업표 · 현장 시험 ─────────────
  api.get('/engagements/:id/forms', wrap((req) => { const id = E(req); exists(id); return { ...wt.formDefs(), saved: wt.getForms(db, id), examples: content('extras').form_examples || {} }; }));
  api.put('/engagements/:id/forms/:no', wrap((req) => { const id = E(req); exists(id); return wt.saveForm(ctx(req), id, N(req.params.no, 'no'), req.body || {}); }));
  api.get('/engagements/:id/forms/:no/history', wrap((req) => { const id = E(req); exists(id); const f = db.prepare('SELECT id FROM forms WHERE engagement_id=? AND form_no=?').get(id, N(req.params.no, 'no')); return f ? db.prepare('SELECT version,fields,status,updated_by,updated_at FROM form_history WHERE form_id=? ORDER BY version DESC').all(f.id).map((r) => ({ ...r, fields: jparse(r.fields, {}) })) : []; }));
  api.get('/engagements/:id/tools/:tool', wrap((req) => { const id = E(req); exists(id); return wt.toolList(db, id, req.params.tool); }));
  api.post('/engagements/:id/tools/:tool', wrap((req, res) => { const id = E(req); exists(id); res.status(201); return wt.toolSave(ctx(req), id, req.params.tool, null, req.body || {}); }));
  api.put('/engagements/:id/tools/:tool/:rid', wrap((req) => { const id = E(req); exists(id); return wt.toolSave(ctx(req), id, req.params.tool, N(req.params.rid, 'rid'), req.body || {}); }));
  api.delete('/engagements/:id/tools/:tool/:rid', wrap((req) => { const id = E(req); exists(id); return wt.toolDelete(ctx(req), id, req.params.tool, N(req.params.rid, 'rid')); }));
  api.get('/engagements/:id/trial', wrap((req) => { const id = E(req); exists(id); return wt.trialWeeks(db, id); }));
  api.put('/engagements/:id/trial/:week', wrap((req) => { const id = E(req); exists(id); return wt.updateTrialWeek(ctx(req), id, N(req.params.week, 'week'), req.body || {}); }));
  api.get('/engagements/:id/closes', wrap((req) => { const id = E(req); exists(id); return wt.dailyCloses(db, id); }));
  api.post('/engagements/:id/closes', wrap((req, res) => { const id = E(req); exists(id); res.status(201); return wt.closeDay(ctx(req), id, req.body || {}); }));

  // ───────────── 처리 기록 ─────────────
  api.get('/engagements/:id/audit', wrap((req) => {
    const id = E(req); exists(id);
    const lim = Math.min(Number(req.query.limit) || 100, 500);
    const o = req.query.outcome;
    return db.prepare(`SELECT id,ts,username,role,action,subject,outcome,detail FROM audit WHERE engagement_id=? ${o ? 'AND outcome=?' : ''} ORDER BY id DESC LIMIT ?`).all(...(o ? [id, o, lim] : [id, lim])).map((r) => ({ ...r, detail: jparse(r.detail, r.detail) }));
  }));
  api.get('/audit/verify', wrap(() => verifyChain(db)));

  // ───────────── 시스템 시험 (격리된 사본에서 실행) ─────────────
  api.get('/tests/catalog', wrap(() => require('./systemTests').catalog()));
  api.post('/tests/run', wrap((req) => { need(req, 'tests.run'); return require('./systemTests').runAll({ only: req.body && req.body.only }); }));

  // ───────────── 교육 콘텐츠 · 학습 진행 ─────────────
  api.get('/content/:name', wrap((req) => {
    const c = content(req.params.name);
    if (req.params.name === 'quiz') return { ...c, questions: c.questions.map(({ answer, explain, ...q }) => q) };
    return c;
  }));
  api.post('/learn/quiz', wrap((req) => {
    const { phase, answers } = req.body || {};
    if (!['pre', 'post'].includes(phase)) throw bad('phase 는 pre/post');
    const qs = content('quiz').questions;
    if (!Array.isArray(answers) || answers.length !== qs.length) throw bad(`answers 는 ${qs.length}개 필요`);
    const res = qs.map((q, i) => ({ id: q.id, picked: answers[i], correct: answers[i] === q.answer, answer: q.answer, explain: q.explain }));
    const score = res.filter((r) => r.correct).length;
    db.prepare('INSERT INTO quiz_attempts (username,phase,answers,score,total,created_at) VALUES (?,?,?,?,?,?)').run(req.actor.username, phase, JSON.stringify(answers), score, qs.length, isoNow(clock));
    return { score, total: qs.length, results: res };
  }));
  api.get('/learn/progress', wrap((req) => ({
    quiz: db.prepare('SELECT phase,score,total,created_at FROM quiz_attempts WHERE username=? ORDER BY id DESC LIMIT 20').all(req.actor.username),
    practices: db.prepare('SELECT practice_no,status,response,rubric,updated_at FROM practice_progress WHERE username=?').all(req.actor.username).map((p) => ({ ...p, rubric: jparse(p.rubric, null) })),
    checklist: db.prepare('SELECT engagement_id,item_key,checked FROM checklist_state WHERE username=?').all(req.actor.username),
    worksheets: db.prepare('SELECT id,title,data,updated_at FROM worksheets WHERE username=? ORDER BY id DESC').all(req.actor.username).map((w) => ({ ...w, data: jparse(w.data, {}) })),
  })));
  api.put('/learn/practice/:no', wrap((req) => {
    const no = N(req.params.no, 'no'); if (no > 21) throw bad('실습 번호는 1~21');
    const b = req.body || {};
    if (!['todo', 'doing', 'done'].includes(b.status)) throw bad('status 는 todo/doing/done');
    // 실습 20·21: 빈칸이 있는 실행 항목은 완료로 표시하지 않는다 (여섯 칸 구조로 제출하면 여섯 칸 모두 필요)
    if (b.status === 'done') {
      const parsed = jparse(b.response, null);
      const keys = ['q', 'e', 'c', 'a', 'r', 'd'];
      const ok = parsed && typeof parsed === 'object' ? keys.every((k) => String(parsed[k] || '').trim()) : !!String(b.response || '').trim();
      if (!ok) throw bad('빈칸이 있는 실습은 완료로 표시할 수 없습니다. 현장 질문·근거 자료·계산·판단·다른 가능성 확인·행동·책임·완료 기준을 모두 작성하세요.');
    }
    if (String(b.response || '').length > 20000) throw bad('제출 내용이 너무 깁니다(2만 자 이하).');
    db.prepare(`INSERT INTO practice_progress (username,practice_no,status,response,rubric,updated_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(username,practice_no) DO UPDATE SET status=excluded.status, response=excluded.response, rubric=excluded.rubric, updated_at=excluded.updated_at`)
      .run(req.actor.username, no, b.status, b.response || '', b.rubric ? JSON.stringify(b.rubric) : null, isoNow(clock));
    return { practice_no: no, status: b.status };
  }));
  api.put('/learn/checklist', wrap((req) => {
    const b = req.body || {}; const eid = N(b.engagement_id, 'engagement_id'); exists(eid);
    if (!/^[a-z0-9_.-]{1,40}$/.test(String(b.item_key || ''))) throw bad('item_key 가 올바르지 않습니다.');
    db.prepare(`INSERT INTO checklist_state (username,engagement_id,item_key,checked,updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(username,engagement_id,item_key) DO UPDATE SET checked=excluded.checked, updated_at=excluded.updated_at`).run(req.actor.username, eid, b.item_key, b.checked ? 1 : 0, isoNow(clock));
    return { ok: true };
  }));
  api.post('/learn/worksheets', wrap((req, res) => {
    const b = req.body || {}; if (!String(b.title || '').trim()) throw bad('제목이 필요합니다.');
    const data = JSON.stringify(b.data || {}); if (data.length > 50000) throw bad('워크시트가 너무 큽니다.');
    res.status(201);
    if (b.id) {
      const r = db.prepare('UPDATE worksheets SET title=?, data=?, updated_at=? WHERE id=? AND username=?').run(b.title, data, isoNow(clock), N(b.id, 'id'), req.actor.username);
      if (!r.changes) throw notFound(); return { id: b.id };
    }
    return { id: Number(db.prepare('INSERT INTO worksheets (username,title,data,updated_at) VALUES (?,?,?,?)').run(req.actor.username, b.title, data, isoNow(clock)).lastInsertRowid) };
  }));
  api.delete('/learn/worksheets/:id', wrap((req) => { const r = db.prepare('DELETE FROM worksheets WHERE id=? AND username=?').run(N(req.params.id, 'id'), req.actor.username); if (!r.changes) throw notFound(); return { deleted: true }; }));
  api.get('/learn/overview', wrap((req) => {
    if (!['admin', 'consultant'].includes(req.actor.role)) throw forbidden('권한 없음: 강사·컨설턴트만 전체 학습 현황을 볼 수 있습니다.');
    const users = db.prepare(`SELECT username, display_name FROM users WHERE role='learner' ORDER BY id`).all();
    return users.map((u) => ({
      ...u,
      practices_done: db.prepare(`SELECT COUNT(*) n FROM practice_progress WHERE username=? AND status='done'`).get(u.username).n,
      pre: db.prepare(`SELECT score,total FROM quiz_attempts WHERE username=? AND phase='pre' ORDER BY id DESC LIMIT 1`).get(u.username) || null,
      post: db.prepare(`SELECT score,total FROM quiz_attempts WHERE username=? AND phase='post' ORDER BY id DESC LIMIT 1`).get(u.username) || null,
    }));
  }));

  api.use((req, res) => res.status(404).json({ error: '없는 API 입니다.' }));
  api.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err instanceof HttpError) {
      const { afterRollback, ...extra } = err.extra || {};
      return res.status(err.status).json({ error: err.message, ...extra });
    }
    const m = (err && err.message) || '';
    if (/UNIQUE constraint/i.test(m)) return res.status(409).json({ error: '충돌: 같은 항목이 이미 있습니다.' });
    if (/NOT NULL constraint|CHECK constraint|FOREIGN KEY constraint/i.test(m)) return res.status(400).json({ error: '요청 값이 올바르지 않습니다(필수 값 누락 또는 허용되지 않는 값).' });
    console.error(err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  });
  return api;
}

module.exports = { createApi, content };
