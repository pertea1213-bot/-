'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runAll, CATALOG } = require('../src/systemTests');
const { open } = require('../src/db');
const seed = require('../src/seed');
const engine = require('../src/engine');

// 교안·원문의 수치와 정확히 일치하는가 (시드 검증)
test('HR 사례 시드가 원문 수치와 일치한다 (45→40→28, 부족 17)', () => {
  const db = open(':memory:'); seed.seedAll(db, {});
  const s = engine.snapshot(db, db.prepare(`SELECT id FROM engagements WHERE request_code='H-701'`).get().id);
  assert.deepEqual(
    { required: s.counts.required, input: s.counts.input, started: s.counts.started, reserve: s.counts.reserve, completed: s.counts.completed, in_progress: s.counts.in_progress, approved: s.counts.approved, review: s.counts.review, unconfirmed: s.counts.unconfirmed },
    { required: 45, input: 45, started: 40, reserve: 5, completed: 40, in_progress: 0, approved: 28, review: 8, unconfirmed: 4 });
  assert.equal(s.metrics.completion_rate, 100); assert.equal(s.metrics.approval_rate, 70); assert.equal(s.metrics.fulfilment_rate, 62.22); assert.equal(s.metrics.shortage, 17);
  assert.equal(s.metrics.shortage_unexplained, 0);
  const byG = Object.fromEntries(s.groups.map((g) => [g.code, [g.required, g.approved, g.review, g.unconfirmed, g.in_progress, g.reserve]]));
  assert.deepEqual(byG, { SALES: [16, 10, 3, 1, 0, 2], PROD: [20, 12, 4, 2, 0, 2], QA: [9, 6, 1, 1, 0, 1] });
  assert.ok(s.integrity_ok);
  assert.equal(engine.periodRows(s).row_count, 14);
  assert.ok(engine.periodRows(s).matches_snapshot);
});

test('모듈 B 가상 예시(제조 30건·외식 18명)가 교안 수치와 일치한다', () => {
  const db = open(':memory:'); seed.seedAll(db, {});
  const get = (c) => engine.snapshot(db, db.prepare('SELECT id FROM engagements WHERE request_code=?').get(c).id);
  const m = get('M-301'); assert.deepEqual([m.counts.approved, m.counts.review, m.counts.unconfirmed, m.counts.in_progress, m.counts.reserve, m.metrics.shortage], [18, 4, 2, 2, 4, 12]);
  assert.equal(m.metrics.completion_rate, 92.31); assert.equal(m.metrics.approval_rate, 75); assert.equal(m.metrics.fulfilment_rate, 60);
  const r = get('R-205'); assert.deepEqual([r.counts.approved, r.counts.review, r.counts.unconfirmed, r.counts.in_progress, r.counts.reserve, r.metrics.shortage], [11, 3, 2, 0, 2, 7]);
  assert.equal(r.metrics.completion_rate, 100); assert.equal(r.metrics.approval_rate, 68.75); assert.equal(r.metrics.fulfilment_rate, 61.11);
});

test('가정 시나리오: 14명 이동 → 영업16·생산17·품질9 = 42, 잔여 3은 모두 생산', () => {
  const db = open(':memory:'); seed.seedAll(db, {});
  const id = db.prepare(`SELECT id FROM engagements WHERE request_code='H-701'`).get().id;
  const r = engine.simulate(db, id, db.prepare('SELECT id FROM scenarios WHERE engagement_id=?').get(id).id);
  assert.equal(r.moved, 14); assert.equal(r.after.counts.approved, 42);
  assert.deepEqual(Object.fromEntries(r.after.groups.map((g) => [g.code, g.approved])), { SALES: 16, PROD: 17, QA: 9 });
  assert.deepEqual(r.remaining.map((x) => x.group).sort(), ['PROD', 'PROD', 'PROD']);
  assert.deepEqual(r.remaining.map((x) => x.bucket).sort(), ['reserve', 'review', 'unconfirmed']);
  // 시뮬레이션은 기록을 바꾸지 않는다
  assert.equal(engine.snapshot(db, id).counts.approved, 28);
});

test('조치 비용 가정: 50,000 + 150,000 = 200,000원(가정)', () => {
  const db = open(':memory:'); seed.seedAll(db, {});
  const cost = (c) => engine.costOf(JSON.parse(db.prepare('SELECT cost FROM interventions WHERE code=?').get(c).cost));
  assert.equal(cost('A1').amount, 50000); assert.equal(cost('A1').person_hours, 2);
  assert.equal(cost('A2').amount, 150000); assert.equal(cost('A2').person_hours, 6);
  assert.equal(cost('A1').assumption, true);
});

test('분모 0은 100%가 되지 않는다', () => {
  const m = engine.metricsOf({ required: 5, input: 5, started: 0, reserve: 5, completed: 0, in_progress: 0, approved: 0, review: 0, unconfirmed: 0 });
  assert.equal(m.completion_rate, null); assert.equal(m.approval_rate, null); assert.equal(m.fulfilment_rate, 0);
});

test('교안의 시스템 시험 T1~T14 · 인수 시험 A1~A6 · 원칙 점검 X1~X7 이 모두 통과한다', () => {
  const r = runAll();
  const failed = r.results.filter((x) => !x.pass).map((x) => `${x.id}: ${x.error || x.checks.filter((c) => !c.pass).map((c) => c.msg).join(' / ')}`);
  assert.deepEqual(failed, []);
  assert.equal(r.total, CATALOG.length);
  assert.ok(r.baseline_ok, '실패 주입 뒤에도 기준선 45·28·17 이 복구된 상태에서 재계산된다');
});
