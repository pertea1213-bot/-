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

// ───────────── 정본 스킴 사례 3건: 원고 수치와 일치하는가 ─────────────
const all = () => { const db = open(':memory:'); seed.seedAll(db, {}); return db; };
const idOf = (db, code) => db.prepare('SELECT id FROM engagements WHERE request_code=?').get(code).id;
const row = (s) => [s.counts.required, s.counts.input, s.counts.started, s.counts.reserve, s.counts.completed, s.counts.in_progress, s.counts.approved, s.counts.review, s.counts.unconfirmed];

test('학원(제13장): 54 = 42 + 12, 재등록률 42÷54 = 77.78%, 가상 비교 46/54 = 85.19%', () => {
  const db = all(); const id = idOf(db, '13'); const s = engine.snapshot(db, id);
  assert.deepEqual(row(s), [54, 54, 54, 0, 54, 0, 42, 10, 2]);
  assert.equal(s.metrics.fulfilment_rate, 77.78); assert.equal(s.metrics.shortage, 12); assert.ok(s.integrity_ok);
  const r = engine.simulate(db, id, db.prepare('SELECT id FROM scenarios WHERE engagement_id=?').get(id).id);
  assert.equal(r.after.counts.approved, 46); assert.equal(r.after.metrics.fulfilment_rate, 85.19); assert.equal(r.moved, 4);
  assert.equal(engine.costOf(JSON.parse(db.prepare(`SELECT cost FROM interventions WHERE engagement_id=? AND code='A1'`).get(id).cost)).amount, 400000);
  assert.ok(!JSON.stringify(s.items).includes('이름'), '실명 필드 없음(가명 P001 형식)'); assert.match(s.items[0].ref_key, /^P\d{3}$/);
});

test('의류(제18장): 400벌 · 완료율 90% · 승인율 68.89% · 사이즈별 표 · 364/384 분기', () => {
  const db = all(); const id = idOf(db, 'O-601'); const s = engine.snapshot(db, id);
  assert.deepEqual(row(s), [400, 420, 400, 20, 360, 40, 248, 84, 28]);
  assert.equal(s.metrics.completion_rate, 90); assert.equal(s.metrics.approval_rate, 68.89); assert.equal(s.metrics.fulfilment_rate, 62); assert.equal(s.metrics.shortage, 152);
  assert.deepEqual(s.metrics.shortage_parts, { review: 84, unconfirmed: 28, in_progress: 40, reserve: 0 }, '부족 152 = 84 + 28 + 40');
  assert.equal(s.metrics.pool_surplus.reserve, 20, '예비 재단 20은 부족을 메우지 않는 초과분');
  assert.ok(s.warnings.some((w) => w.code === 'REQUIRED_NE_INPUT'), '요구 400 ≠ 입력 420 경고');
  const sz = Object.fromEntries(s.groups.map((g) => [g.code, [g.required, g.approved, g.review, g.unconfirmed, g.in_progress, g.required - g.approved]]));
  assert.deepEqual(sz, { S: [80, 52, 18, 6, 4, 28], M: [160, 100, 36, 12, 12, 60], L: [120, 72, 24, 8, 16, 48], XL: [40, 24, 6, 2, 8, 16] });
  assert.deepEqual(s.groups.map((g) => g.reserve), [4, 8, 6, 2], '예비 재단 사이즈 S4·M8·L6·XL2');
  const sc = db.prepare('SELECT id FROM scenarios WHERE engagement_id=? ORDER BY id').all(id);
  const a = engine.simulate(db, id, sc[0].id), b = engine.simulate(db, id, sc[1].id);
  assert.equal(a.after.counts.approved, 364); assert.deepEqual(a.after.groups.map((g) => g.required - g.approved), [6, 16, 12, 2], '최종 보류 S6·M16·L12·XL2');
  assert.equal(b.after.counts.approved, 384); assert.deepEqual(b.after.groups.map((g) => g.required - g.approved), [2, 8, 6, 0], '예비 포함 잔여 S2·M8·L6·XL0');
  assert.equal(b.after.metrics.shortage, 16);
  const cost = (c) => engine.costOf(JSON.parse(db.prepare('SELECT cost FROM interventions WHERE engagement_id=? AND code=?').get(id, c).cost)).amount;
  assert.equal(cost('A1'), 162000); assert.equal(cost('A4'), 110000);
  assert.equal(engine.snapshot(db, id).counts.approved, 248, '시뮬레이션은 기록을 바꾸지 않는다');
});

test('빵(제16장): 1,200 → 격리 40 → 포장 1,160 = V4 840 + V3 320 → 가용 0, 분기 A 가용 840 · 잔량 140', () => {
  const db = all(); const id = idOf(db, 'O-301'); const s = engine.snapshot(db, id);
  assert.deepEqual(row(s), [700, 1200, 1160, 40, 1160, 0, 0, 840, 320]);
  assert.equal(s.metrics.shortage, 700); assert.equal(s.metrics.surplus, 0); assert.ok(s.integrity_ok);
  assert.deepEqual(Object.fromEntries(s.groups.map((g) => [g.code, g.input])), { V4: 840, V3: 320, Q: 40 });
  assert.equal(s.items.filter((i) => i.bucket === 'reserve').length, 40, '격리 40은 포장 전(예비)');
  assert.ok(!s.items.some((i) => /C\d{3}/.test(i.ref_key)), '상자 ID는 원본이 없어 만들지 않는다');
  const sc = db.prepare('SELECT id,name FROM scenarios WHERE engagement_id=? ORDER BY id').all(id);
  const a = engine.simulate(db, id, sc[0].id), b = engine.simulate(db, id, sc[1].id);
  assert.equal(a.after.counts.approved, 840); assert.equal(a.after.metrics.surplus, 140, '가용 840 − 주문 700 = 잔량 140'); assert.equal(a.after.metrics.shortage, 0);
  assert.equal(a.after.counts.unconfirmed, 320, 'V3 320은 별도 격리 — 승인되지 않는다');
  assert.equal(b.after.counts.approved, 0); assert.equal(b.after.metrics.shortage, 700);
  const c2 = JSON.parse(db.prepare(`SELECT cost FROM interventions WHERE engagement_id=? AND code='A2'`).get(id).cost);
  assert.equal(engine.costOf(c2).amount, 74800, '재표시 320×65 + 3×18,000');
});

test('부족·초과 일반화: 승인이 요구를 넘으면 부족 0 · 초과 표시, 부족 구성은 우선순위 배분', () => {
  const m = engine.metricsOf({ required: 700, input: 1200, started: 1160, reserve: 40, completed: 1160, in_progress: 0, approved: 840, review: 0, unconfirmed: 320 });
  assert.equal(m.shortage, 0); assert.equal(m.surplus, 140); assert.equal(m.fulfilment_rate, 120);
  const h = engine.metricsOf({ required: 45, input: 45, started: 40, reserve: 5, completed: 40, in_progress: 0, approved: 28, review: 8, unconfirmed: 4 });
  assert.deepEqual(h.shortage_parts, { review: 8, unconfirmed: 4, in_progress: 0, reserve: 5 }); assert.equal(h.shortage_unexplained, 0);
  const x = engine.metricsOf({ required: 100, input: 60, started: 60, reserve: 0, completed: 60, in_progress: 0, approved: 40, review: 20, unconfirmed: 0 });
  assert.equal(x.shortage, 60); assert.equal(x.shortage_unexplained, 40, '입력이 요구보다 작아 설명되지 않는 부족은 숨기지 않는다');
});

test('사례별 실습 21개 · 서식 작성 예: 세 사례 모두 필수 칸을 채운다', () => {
  for (const k of ['academy', 'apparel', 'bread']) {
    const p = require(`../content/practices_${k}.json`).practices;
    assert.equal(p.length, 21, k); assert.deepEqual(p.map((x) => x.no), Array.from({ length: 21 }, (_, i) => i + 1));
    assert.ok(p.every((x) => x.title && x.input && x.deliverable), `${k}: 작성 과제의 입력·제출물`);
    assert.ok(p.filter((x) => x.commentary.length).length >= 15, `${k}: 해설 문단`);
    assert.ok(!JSON.stringify(p).match(/식별번호는지|시식별번호지/), `${k}: 일괄 치환 오류`);
  }
  const db = all(); const W = require('../src/worktools');
  for (const code of ['13', 'O-601', 'O-301', 'M-301', 'R-205']) {
    const ex = W.formExamples(db, idOf(db, code), {});
    for (let n = 1; n <= 6; n++) for (const k of [...W.formDefs().common_required, ...W.FORMS[n].extra]) assert.ok(String(ex[n][k] || '').trim(), `${code} 서식 ${n}.${k}`);
  }
});

test('사례 개요 콘텐츠가 모든 어댑터를 덮는다', () => {
  const db = all(); const cs = require('../content/cases.json').cases;
  for (const a of db.prepare('SELECT key FROM adapters').all()) { assert.ok(cs[a.key], a.key); assert.ok(cs[a.key].problem && cs[a.key].populations && cs[a.key].modeling.length, a.key); }
});
