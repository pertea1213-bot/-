'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { open } = require('../src/db');
const seed = require('../src/seed');
const { createApp } = require('../src/app');

let server, base, db, prodServer, prodBase;
const tokens = {};

async function http(method, path, { token, body, raw } = {}) {
  const res = await fetch(`${base}/api${path}`, {
    method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined || raw ? { 'Content-Type': 'application/json' } : {}) },
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await res.json(); } catch (_) { /* 본문 없음 */ }
  return { status: res.status, json };
}
const as = (u) => ({ token: tokens[u] });
const HR = 1;

test.before(async () => {
  db = open(':memory:'); seed.seedAll(db, { demoPassword: 'pw-test' });
  server = createApp({ db, isProd: false, demoPassword: 'pw-test' }).listen(0); base = `http://127.0.0.1:${server.address().port}`;
  const pdb = open(':memory:'); seed.seedAll(pdb, { demoPassword: 'pw-test' });
  prodServer = createApp({ db: pdb, isProd: true, demoPassword: 'pw-test' }).listen(0); prodBase = `http://127.0.0.1:${prodServer.address().port}`;
  for (const u of ['admin', 'consultant1', 'fde1', 'exec1', 'hr1', 'manager1', 'it1', 'it2', 'sec1', 'field1', 'reviewer1', 'learner1']) {
    const r = await http('POST', '/auth/login', { body: { username: u, password: 'pw-test' } });
    assert.equal(r.status, 200, `login ${u}`); tokens[u] = r.json.token;
  }
});
test.after(() => { server.close(); prodServer.close(); });

test('인증: 토큰 없음 401 · 잘못된 비밀번호 401 · 변조된 토큰 401', async () => {
  assert.equal((await http('GET', '/engagements')).status, 401);
  assert.equal((await http('POST', '/auth/login', { body: { username: 'it1', password: 'nope' } })).status, 401);
  const bad = tokens.it1.slice(0, -3) + 'AAA';
  assert.equal((await http('GET', '/engagements', { token: bad })).status, 401);
});

test('로그인 시도 제한(분당 8회) → 429', async () => {
  let last;
  for (let i = 0; i < 10; i++) last = await http('POST', '/auth/login', { body: { username: 'nobody', password: 'x' } });
  assert.equal(last.status, 429);
});

test('운영 모드: 데모 계정 목록·비밀번호 힌트를 공개하지 않는다', async () => {
  const dev = await (await fetch(`${base}/api/auth/demo`)).json();
  const prod = await (await fetch(`${prodBase}/api/auth/demo`)).json();
  assert.ok(dev.users.length > 5); assert.equal(dev.password_hint, 'pw-test');
  assert.equal(prod.users.length, 0); assert.equal(prod.password_hint, null);
});

test('보안 헤더·잘못된 JSON·없는 경로', async () => {
  const r = await fetch(`${base}/api/engagements`, { headers: { Authorization: `Bearer ${tokens.it1}` } });
  assert.match(r.headers.get('content-security-policy'), /script-src 'self'/); assert.equal(r.headers.get('x-content-type-options'), 'nosniff'); assert.equal(r.headers.get('x-powered-by'), null);
  assert.equal((await http('POST', `/engagements/${HR}/holds`, { ...as('manager1'), raw: '{bad' })).status, 400);
  assert.equal((await http('GET', '/nope', as('it1'))).status, 404);
  assert.equal((await http('GET', '/engagements/abc', as('it1'))).status, 400);
  assert.equal((await http('GET', '/engagements/999', as('it1'))).status, 404);
});

test('권한: 역할별 실행 작업 거부 (현장 담당자·교육생·컨설턴트)', async () => {
  const it = (await http('GET', `/engagements/${HR}`, as('it1'))).json.items.find((i) => i.bucket === 'review');
  assert.equal((await http('POST', `/engagements/${HR}/assignments`, { ...as('field1'), body: { item_id: it.id, to_group_code: 'QA', reason: 'x' } })).status, 403);
  assert.equal((await http('POST', `/engagements/${HR}/evidence`, { ...as('learner1'), body: { item_id: it.id, requirement_key: 'ACCOUNT', value: 'verified', source_ref: 'X' } })).status, 403);
  assert.equal((await http('POST', `/engagements/${HR}/evidence`, { ...as('manager1'), body: { item_id: it.id, requirement_key: 'ACCOUNT', value: 'verified', source_ref: 'X' } })).status, 403, '현업 관리자는 계정 근거의 소유자가 아니다(후보 등록도 현장 담당자만)');
  assert.equal((await http('POST', `/admin/external-mode`, { ...as('fde1'), body: { mode: 'fail' } })).status, 403);
  assert.equal((await http('POST', `/tests/run`, { ...as('learner1'), body: {} })).status, 403);
});

test('현장 담당자: 후보로만 등록되고, 본인 입력만 보며, 판정 요약의 자료 번호는 가려진다', async () => {
  const snap = (await http('GET', `/engagements/${HR}`, as('it1'))).json;
  const it = snap.items.find((i) => i.bucket === 'unconfirmed');
  const r = await http('POST', `/engagements/${HR}/evidence`, { ...as('field1'), body: { item_id: it.id, requirement_key: 'TRAINING', value: 'verified', source_ref: 'EDU-FIELD', occurred_at: '2026-10-06' } });
  assert.equal(r.status, 201); assert.equal(r.json.status, 'candidate');
  const after = (await http('GET', `/engagements/${HR}`, as('it1'))).json;
  assert.equal(after.counts.approved, snap.counts.approved, '후보는 판정에 반영되지 않는다');
  const det = (await http('GET', `/engagements/${HR}/items/${it.id}`, as('field1'))).json;
  assert.ok(det.filtered && det.evidence.every((e) => e.recorded_by === 'field1'));
  assert.ok(Object.values(det.item.req).every((v) => v.source_ref === null && v.note === null), '자료 식별번호·메모가 가려짐');
  const full = (await http('GET', `/engagements/${HR}/items/${it.id}`, as('it1'))).json;
  assert.ok(full.evidence.length > det.evidence.length);
  // 소유 역할의 확정 → 반영
  assert.equal((await http('POST', `/engagements/${HR}/evidence/${r.json.id}/confirm`, { ...as('reviewer1'), body: {} })).status, 403);
  assert.equal((await http('POST', `/engagements/${HR}/evidence/${r.json.id}/confirm`, { ...as('manager1'), body: {} })).status, 200);
  assert.equal((await http('GET', `/engagements/${HR}`, as('it1'))).json.counts.approved, snap.counts.approved + 1);
});

test('조치 흐름: 제출 → 승인(두 역할) → 실행 → 결과 기록 → 수량 변경 · 승인만으로는 수량 불변', async () => {
  const iv = (await http('GET', `/engagements/${HR}/interventions`, as('consultant1'))).json;
  const a1 = iv.find((x) => x.code === 'A1');
  const base0 = (await http('GET', `/engagements/${HR}`, as('it1'))).json.counts;
  assert.equal((await http('POST', `/engagements/${HR}/interventions/${a1.id}/start`, { ...as('manager1'), body: {} })).status, 409, '결재 전 실행 금지');
  assert.equal((await http('POST', `/engagements/${HR}/interventions/${a1.id}/submit`, { ...as('consultant1'), body: {} })).status, 200);
  assert.equal((await http('POST', `/engagements/${HR}/interventions/${a1.id}/decide`, { ...as('consultant1'), body: { decision: 'approve' } })).status, 403);
  assert.equal((await http('POST', `/engagements/${HR}/interventions/${a1.id}/decide`, { ...as('it1'), body: { decision: 'approve' } })).json.status, 'SUBMITTED');
  assert.equal((await http('POST', `/engagements/${HR}/interventions/${a1.id}/decide`, { ...as('it2'), body: { decision: 'approve' } })).status, 409, '같은 역할 중복 승인 금지');
  assert.equal((await http('POST', `/engagements/${HR}/interventions/${a1.id}/decide`, { ...as('manager1'), body: { decision: 'approve' } })).json.status, 'APPROVED');
  assert.deepEqual((await http('GET', `/engagements/${HR}`, as('it1'))).json.counts, base0, '승인 ≠ 완료');
  assert.equal((await http('POST', `/engagements/${HR}/interventions/${a1.id}/start`, { ...as('manager1'), body: {} })).json.status, 'IN_EXECUTION');
  const target = (await http('GET', `/engagements/${HR}/interventions`, as('it1'))).json.find((x) => x.code === 'A1').targets[0];
  assert.equal((await http('POST', `/engagements/${HR}/interventions/${a1.id}/outcome`, { ...as('it1'), body: { item_id: target.item_id, outcome: 'verified' } })).status, 400, '자료 식별번호 없는 해결은 거부');
  assert.equal((await http('POST', `/engagements/${HR}/interventions/${a1.id}/outcome`, { ...as('manager1'), body: { item_id: target.item_id, outcome: 'verified', source_ref: 'L1' } })).status, 403, '계정 재확인은 정보 담당만');
  assert.equal((await http('POST', `/engagements/${HR}/interventions/${a1.id}/outcome`, { ...as('it1'), body: { item_id: target.item_id, outcome: 'verified', source_ref: 'LOG-API-1' } })).status, 200);
  const c1 = (await http('GET', `/engagements/${HR}`, as('it1'))).json.counts;
  assert.equal(c1.approved, base0.approved + 1); assert.equal(c1.review, base0.review - 1);
  assert.equal((await http('POST', `/engagements/${HR}/interventions/${a1.id}/close`, { ...as('consultant1'), body: {} })).status, 409, '결과가 없는 대상이 남았으면 종료 불가');
  // 처리 기록: 무권한 시도 포함, 체인 정상
  const aud = (await http('GET', `/engagements/${HR}/audit?outcome=denied`, as('it1'))).json;
  assert.ok(aud.length >= 3 && aud.every((a) => a.outcome === 'denied'));
  assert.equal((await http('GET', '/audit/verify', as('it1'))).json.ok, true);
});

test('승인서 제출은 대상·권한·비용·중단 조건·복구 경로가 모두 있어야 한다', async () => {
  const p = await http('POST', `/engagements/${HR}/interventions`, { ...as('consultant1'), body: { title: '불완전 조치', task_key: 'ACCOUNT', target_bucket: 'review', required_roles: ['it'] } });
  assert.equal(p.status, 201);
  const s = await http('POST', `/engagements/${HR}/interventions/${p.json.id}/submit`, { ...as('consultant1'), body: {} });
  assert.equal(s.status, 400); assert.deepEqual(s.json.missing.sort(), ['비용 가정', '복구 경로', '중단 조건'].sort());
  assert.equal((await http('POST', `/engagements/${HR}/interventions`, { ...as('consultant1'), body: { title: 'x', required_roles: ['consultant'] } })).status, 400, '컨설턴트를 승인 역할로 지정 불가');
});

test('서식: 빈칸 완료 거부 · 근거 없는 0/합격 거부 · 버전·충돌', async () => {
  const f = (await http('GET', `/engagements/${HR}/forms`, as('consultant1'))).json;
  assert.equal(Object.keys(f.forms).length, 6);
  const blank = await http('PUT', `/engagements/${HR}/forms/1`, { ...as('consultant1'), body: { fields: { scope: 'H-701' }, status: 'complete' } });
  assert.equal(blank.status, 400); assert.ok(blank.json.missing.includes('source_id'));
  const zero = await http('PUT', `/engagements/${HR}/forms/1`, { ...as('consultant1'), body: { fields: { scope: 'H-701', unit: '명', problem_sentence: '0' }, status: 'draft' } });
  assert.equal(zero.status, 400, '자료 식별번호 없이 0/합격으로 적을 수 없다');
  const ok = await http('PUT', `/engagements/${HR}/forms/1`, { ...as('consultant1'), body: { fields: f.examples['1'], status: 'complete' } });
  assert.equal(ok.status, 200); assert.equal(ok.json.version, 1);
  assert.equal((await http('PUT', `/engagements/${HR}/forms/1`, { ...as('consultant1'), body: { fields: f.examples['1'], status: 'complete', expected_version: 1 } })).json.version, 2);
  assert.equal((await http('PUT', `/engagements/${HR}/forms/1`, { ...as('consultant1'), body: { fields: f.examples['1'], status: 'complete', expected_version: 1 } })).status, 409, '낡은 버전 저장 거부');
  assert.equal((await http('PUT', `/engagements/${HR}/forms/1`, { ...as('field1'), body: { fields: f.examples['1'], status: 'draft' } })).status, 403, '서식 1은 컨설턴트만');
  assert.equal((await http('GET', `/engagements/${HR}/forms/1/history`, as('it1'))).json.length, 1, '현재 v2 외에 이전 버전 v1 이 이력으로 남는다');
});

test('원인 후보: ‘지지됨’은 다른 가능성 확인 결과가 있어야 하고, 전부 설명하는 후보는 의심 표시', async () => {
  const hs = (await http('GET', `/engagements/${HR}/hypotheses`, as('consultant1'))).json; assert.equal(hs.length, 4);
  assert.equal((await http('PATCH', `/engagements/${HR}/hypotheses/${hs[0].id}`, { ...as('consultant1'), body: { status: 'supported' } })).status, 400);
  assert.equal((await http('PATCH', `/engagements/${HR}/hypotheses/${hs[0].id}`, { ...as('consultant1'), body: { status: 'supported', disconfirm_note: '계정·권한 로그에서 부여 기록 없음 확인, 반증 자료 없음' } })).status, 200);
  await http('PATCH', `/engagements/${HR}/hypotheses/${hs[1].id}`, { ...as('consultant1'), body: { coverage: [{ bucket: 'review', mark: 'full' }, { bucket: 'unconfirmed', mark: 'full' }] } });
  assert.equal((await http('GET', `/engagements/${HR}/hypotheses`, as('consultant1'))).json.find((h) => h.id === hs[1].id).suspicious, true);
  assert.equal((await http('PATCH', `/engagements/${HR}/hypotheses/${hs[2].id}`, { ...as('manager1'), body: { status: 'rejected' } })).status, 403);
});

test('현장 시험: 승인된 조치(중단 조건·복구 경로)가 있어야 시작 · 이전 주차 완료 필요', async () => {
  // 앞선 시험에서 A1 이 이미 승인·실행됨 → 1주차 시작 가능
  assert.equal((await http('PUT', `/engagements/${HR}/trial/2`, { ...as('consultant1'), body: { status: 'running' } })).status, 409, '1주차가 끝나기 전 2주차 불가');
  assert.equal((await http('PUT', `/engagements/${HR}/trial/1`, { ...as('consultant1'), body: { status: 'running' } })).status, 200);
  assert.equal((await http('PUT', `/engagements/${HR}/trial/1`, { ...as('manager1'), body: { status: 'done' } })).status, 403);
  // 승인된 조치가 없는 사례(제조)에서는 시작 불가
  const m = (await http('GET', '/engagements', as('it1'))).json.find((e) => e.request_code === 'M-301').id;
  assert.equal((await http('PUT', `/engagements/${m}/trial/1`, { ...as('consultant1'), body: { status: 'running' } })).status, 409);
});

test('일 마감: 같은 날 재마감 거부 → 정정 기록(사유 필수)으로 · 전후 비교는 단정하지 않는다', async () => {
  const c1 = await http('POST', `/engagements/${HR}/closes`, { ...as('field1'), body: { day: '2026-10-07', burden_minutes: 20 } });
  assert.equal(c1.status, 201);
  assert.equal((await http('POST', `/engagements/${HR}/closes`, { ...as('field1'), body: { day: '2026-10-07' } })).status, 409);
  assert.equal((await http('POST', `/engagements/${HR}/closes`, { ...as('field1'), body: { day: '2026-10-07', correction_of: c1.json.id } })).status, 400, '정정 사유 필수');
  assert.equal((await http('POST', `/engagements/${HR}/closes`, { ...as('field1'), body: { day: '2026-10-07', correction_of: c1.json.id, note: '분 단위 오기' } })).status, 201);
  assert.equal((await http('GET', `/engagements/${HR}/closes`, as('it1'))).json.length, 2);
  const cmp = (await http('POST', `/engagements/${HR}/compare`, { ...as('consultant1'), body: { before_basis: '2026-10-05', before_known: '2026-10-05', after_basis: '2026-10-07', concurrent_change: true } })).json;
  assert.equal(cmp.comparable, false); assert.match(cmp.memo, /단정하면 안 됩니다/);
});

test('보호 지표: 중단 기준은 컨설턴트·경영진만 설정', async () => {
  assert.equal((await http('PUT', `/engagements/${HR}/protection-rules`, { ...as('field1'), body: { delay_max: 5 } })).status, 403);
  assert.equal((await http('PUT', `/engagements/${HR}/protection-rules`, { ...as('consultant1'), body: { delay_max: 5, burden_max: -1 } })).status, 400);
  assert.equal((await http('PUT', `/engagements/${HR}/protection-rules`, { ...as('exec1'), body: { delay_max: 5 } })).status, 200);
});

test('외부 연계: 읽기 단계에서는 요청 불가 · 결재와 외부 수락은 별도', async () => {
  const eng = (await http('GET', '/engagements', as('it1'))).json.find((e) => e.request_code === 'H-701').id;
  const a1 = (await http('GET', `/engagements/${eng}/interventions`, as('it1'))).json.find((x) => x.code === 'A1');
  assert.equal((await http('POST', `/engagements/${eng}/sync`, { ...as('fde1'), body: { subject_type: 'intervention', subject_id: a1.id } })).status, 409);
  await http('POST', `/engagements/${eng}/sync/stage`, { ...as('it1'), body: { stage: 'simulation' } });
  await http('POST', `/engagements/${eng}/sync/stage`, { ...as('it1'), body: { stage: 'manual' } });
  const rq = await http('POST', `/engagements/${eng}/sync`, { ...as('fde1'), body: { subject_type: 'intervention', subject_id: a1.id } });
  assert.equal(rq.status, 201);
  assert.equal((await http('POST', `/engagements/${eng}/sync`, { ...as('fde1'), body: { subject_type: 'intervention', subject_id: a1.id } })).json.duplicate, true, '같은 요청 키는 멱등');
  assert.equal((await http('POST', `/engagements/${eng}/sync/${rq.json.id}/send`, { ...as('fde1'), body: {} })).status, 409, '결재 전 전송 금지');
  assert.equal((await http('POST', `/engagements/${eng}/sync/${rq.json.id}/approve`, { ...as('fde1'), body: {} })).status, 403);
  await http('POST', `/engagements/${eng}/sync/${rq.json.id}/approve`, { ...as('it1'), body: {} });
  await http('POST', '/admin/external-mode', { ...as('admin'), body: { mode: 'fail' } });
  const sent = await http('POST', `/engagements/${eng}/sync/${rq.json.id}/send`, { ...as('fde1'), body: {} });
  assert.equal(sent.json.external_status, 'failed');
  const row = (await http('GET', `/engagements/${eng}/sync`, as('it1'))).json.items[0];
  assert.equal(row.platform_status, 'approved'); assert.equal(row.external_status, 'failed');
});

test('새 업종 이식: 어댑터 → 과업 → 수집 → 같은 코어 규칙으로 판정', async () => {
  const ad = await http('POST', '/adapters', { ...as('consultant1'), body: { key: 'retail-test', name: '유통 — 신규 상품 진열', industry: '도소매·유통', task_name: '진열 확인', unit: '종', item_label: '상품', group_label: '매대', start_label: '입고', start_owner: 'hr', requirements: [{ key: 'INSPECT', label: '검수', source: '검수 기록', owner: 'manager' }, { key: 'PRICE', label: '가격 등록', source: '가격표', owner: 'it' }] } });
  assert.equal(ad.status, 200);
  assert.equal((await http('POST', '/adapters', { ...as('consultant1'), body: { key: 'retail-test', name: 'x', industry: 'x', task_name: 'x', unit: 'x', item_label: 'x', group_label: 'x', start_label: 'x', start_owner: 'hr', requirements: [{ key: 'A1', label: 'a', owner: 'hr' }] } })).status, 409);
  assert.equal((await http('POST', '/adapters', { ...as('manager1'), body: {} })).status, 403);
  const en = await http('POST', '/engagements', { ...as('consultant1'), body: { request_code: 'X-100', task_code: 'XX-001', title: '(가상) 신규 상품 진열', adapter_key: 'retail-test', basis_date: '2026-10-05', groups: [{ code: 'A', name: '매대 A', required: 4 }] } });
  assert.equal(en.status, 201); const id = en.json.id;
  const R = (ref, key, value, ref2) => ({ ref_key: ref, group_code: 'A', requirement_key: key, value, source_ref: ref2, unit: '종', occurred_at: '2026-10-01' });
  const start = await http('POST', `/engagements/${id}/ingest`, { ...as('hr1'), body: { rows: ['S-1', 'S-2', 'S-3'].map((r, i) => R(r, '_START', 'verified', `IN-${i}`)) } });
  assert.equal(start.json.created_items, 3); assert.equal(start.json.applied, 3);
  const mid = (await http('GET', `/engagements/${id}`, as('hr1'))).json;
  assert.equal(mid.counts.in_progress, 3, '착수 직후는 후속 확인 진행 중'); assert.equal(mid.counts.required, 4);
  assert.equal(mid.metrics.shortage, 4);
  await http('POST', `/engagements/${id}/ingest`, { ...as('manager1'), body: { rows: ['S-1', 'S-2', 'S-3'].map((r, i) => R(r, 'INSPECT', 'verified', `QC-${i}`)).map(({ group_code, ...x }) => x) } });
  await http('POST', `/engagements/${id}/ingest`, { ...as('it1'), body: { rows: [{ ...R('S-1', 'PRICE', 'verified', 'PR-1'), group_code: undefined }, { ...R('S-2', 'PRICE', 'unmet', 'PR-2'), group_code: undefined }] } });
  const fin = (await http('GET', `/engagements/${id}`, as('hr1'))).json;
  assert.deepEqual([fin.counts.approved, fin.counts.review, fin.counts.in_progress, fin.counts.reserve], [1, 1, 1, 0]);
  assert.ok(fin.integrity_ok); assert.equal(fin.metrics.shortage, 3);
  assert.equal(fin.adapter.unit, '종');
});

test('입력 방어: SQL 문자열·긴 입력·잘못된 값', async () => {
  const bad = await http('POST', `/engagements/${HR}/evidence`, { ...as('hr1'), body: { ref_key: "x' OR 1=1 --", requirement_key: '_START', value: 'verified', source_ref: 'S' } });
  assert.equal(bad.status, 404);
  const ev = await http('GET', `/engagements/${HR}/evidence?status=' OR '1'='1`, as('it1'));
  assert.equal(ev.status, 200); assert.equal(ev.json.length, 0);
  assert.equal((await http('POST', `/engagements/${HR}/evidence`, { ...as('hr1'), body: { item_id: 1, requirement_key: '_START', value: 'DROP TABLE', source_ref: 'S' } })).status, 400);
  assert.equal((await http('POST', `/engagements/${HR}/ingest`, { ...as('hr1'), body: { rows: [] } })).status, 400);
  assert.equal((await http('GET', `/engagements/${HR}/tools/users`, as('it1'))).status, 404, '허용 목록 밖의 작업표 이름 거부');
  assert.equal((await http('GET', '/content/..%2f..%2fpackage', as('it1'))).status, 404);
  const xss = '<img src=x onerror=alert(1)>';
  const st = await http('POST', `/engagements/${HR}/tools/statements`, { ...as('consultant1'), body: { topic: xss, statement: xss } });
  assert.equal(st.status, 201);
  assert.equal((await http('GET', `/engagements/${HR}/tools/statements`, as('it1'))).json.some((r) => r.topic === xss), true, '값은 그대로 저장되고, 화면은 텍스트 노드로만 그린다');
});

test('학습: 퀴즈 채점(정답 비노출) · 실습 완료는 여섯 칸 모두 필요 · 점검표 저장', async () => {
  const q = (await http('GET', '/content/quiz', as('learner1'))).json;
  assert.equal(q.questions.length, 12); assert.ok(q.questions.every((x) => x.answer === undefined && x.explain === undefined), '정답·해설은 제출 전에 노출되지 않는다');
  assert.equal((await http('POST', '/learn/quiz', { ...as('learner1'), body: { phase: 'pre', answers: [1] } })).status, 400);
  const key = require('../content/quiz.json').questions.map((x) => x.answer);
  const wrong = (await http('POST', '/learn/quiz', { ...as('learner1'), body: { phase: 'pre', answers: Array(12).fill(3) } })).json;
  assert.equal(wrong.score, 0);
  const perfect = (await http('POST', '/learn/quiz', { ...as('learner1'), body: { phase: 'post', answers: key } })).json;
  assert.equal(perfect.score, 12); assert.ok(perfect.results.every((r) => r.correct && r.explain), '제출 뒤에는 해설이 공개된다');
  const lq = (await http('GET', '/learn/progress', as('learner1'))).json.quiz; assert.deepEqual(lq.map((x) => x.phase).sort(), ['post', 'pre']);
  assert.equal((await http('PUT', '/learn/practice/3', { ...as('learner1'), body: { status: 'done', response: JSON.stringify({ q: 'a', e: 'b', c: '', a: 'd', r: 'e', d: 'f' }) } })).status, 400, '빈칸이 있으면 완료 불가');
  assert.equal((await http('PUT', '/learn/practice/3', { ...as('learner1'), body: { status: 'done', response: JSON.stringify({ q: 'a', e: 'b', c: 'c', a: 'd', r: 'e', d: 'f' }), rubric: { numbers: 2 } } })).status, 200);
  assert.equal((await http('PUT', '/learn/practice/22', { ...as('learner1'), body: { status: 'doing' } })).status, 400);
  assert.equal((await http('PUT', '/learn/checklist', { ...as('learner1'), body: { engagement_id: HR, item_key: 'before_scope', checked: true } })).status, 200);
  assert.equal((await http('GET', '/learn/overview', as('learner1'))).status, 403);
  assert.equal((await http('GET', '/learn/overview', as('admin'))).json.find((u) => u.username === 'learner1').practices_done, 1);
});

test('실습 21개·콘텐츠 정합성', async () => {
  const p = (await http('GET', '/content/practices', as('learner1'))).json;
  assert.equal(p.practices.length, 21); assert.deepEqual(p.practices.map((x) => x.no), Array.from({ length: 21 }, (_, i) => i + 1));
  assert.ok(p.practices.every((x) => x.title && x.scene && x.task && x.hypothesis && x.check));
  assert.ok(!p.practices.some((x) => /식별번호는지|시식별번호지|아식별번호텍처/.test([x.scene, x.task, x.calc, x.done, x.check].join(' '))), '원문 일괄 치환 오류가 실습 본문에 남아 있지 않다');
  for (const n of ['course', 'concepts', 'template', 'process', 'tech', 'extras']) assert.equal((await http('GET', `/content/${n}`, as('learner1'))).status, 200, n);
  const ex = (await http('GET', `/engagements/${HR}/forms`, as('it1'))).json.examples;
  for (let i = 1; i <= 6; i++) for (const k of ['scope', 'source_id', 'unit', 'time', 'owner', 'unconfirmed', 'next_action']) assert.ok(ex[i][k], `서식 ${i}.${k}`);
});

test('보고서: 8단 순서와 말하지 않는 것', async () => {
  const r = (await http('GET', `/engagements/${HR}/report`, as('exec1'))).json;
  assert.equal(r.sections.length, 8); assert.deepEqual(r.sections.map((s) => s.no), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(r.first_page.baseline.approved, 28); assert.equal(r.first_page.baseline.shortage, 17);
  assert.ok(r.not_claimed.includes('근로계약의 유효성')); assert.match(r.sections[0].body, /부족 17명/);
  assert.match(r.sections[5].disclaimer, /임금·수당/);
});

test('사례 초기화는 운영자만 · 시드 수치로 복원 · 처리 기록은 보존', async () => {
  const eng = (await http('GET', '/engagements', as('it1'))).json.find((e) => e.request_code === 'H-701').id;
  assert.equal((await http('POST', `/engagements/${eng}/reset`, { ...as('consultant1'), body: {} })).status, 403);
  const before = (await http('GET', '/audit/verify', as('it1'))).json.total;
  const r = await http('POST', `/engagements/${eng}/reset`, { ...as('admin'), body: {} }); assert.equal(r.status, 200);
  const list = (await http('GET', '/engagements', as('it1'))).json; const h = list.find((e) => e.request_code === 'H-701');
  assert.equal(h.counts.approved, 28); assert.equal(h.metrics.shortage, 17);
  assert.ok((await http('GET', '/audit/verify', as('it1'))).json.total >= before, '처리 기록은 초기화로 지워지지 않는다');
  assert.equal((await http('GET', '/audit/verify', as('it1'))).json.ok, true);
});
