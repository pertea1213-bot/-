'use strict';
/**
 * 시스템 시험. 각 시험은 새 메모리 DB(HR 사례 H-701)에서 독립적으로 실행한다 — 운영 데이터를 건드리지 않는다.
 *  T1~T14 : 교안 모듈 E '시스템 시험 14개' (수량 관계 T1~T4 · 상태 규칙 T5~T8 · 사고 대응 T9~T14)
 *  A1~A6  : 교안 모듈 E '일부러 망가뜨려 보는 시험 6종'
 *  X1~X6  : 교안이 말하는 원칙(권한 분리·처리 기록·AI 후보·분모 0·보호 지표·규칙 버전)을 코드가 지키는지
 * 실패 주입 후에도 45명·28명·17명 기준선을 복구된 상태에서 다시 계산한다(검수 책임 문단).
 */
const { open } = require('./db');
const seed = require('./seed');
const engine = require('./engine');
const svc = require('./services');
const wt = require('./worktools');
const { verifyChain } = require('./audit');

const CATALOG = [
  { id: 'T1', group: '수량 관계', title: '대상 = 입사 확인 + 미입사', input: '45 = 40 + 5', expect: '잔차 0' },
  { id: 'T2', group: '수량 관계', title: '입사 확인 = 후속 확인 완료 + 진행', input: '40 = 40 + 0', expect: '잔차 0' },
  { id: 'T3', group: '수량 관계', title: '후속 확인 완료 = 준비 + 권한 대기 + 교육 확인 대기', input: '40 = 28 + 8 + 4', expect: '잔차 0' },
  { id: 'T4', group: '수량 관계', title: '부서별 항목 합계', input: '영업·생산·품질 합', expect: '총계와 일치' },
  { id: 'T5', group: '상태 규칙', title: '전달만 있음', input: '계정 통지 전달(적용 근거 없음)', expect: '실제 적용·승인 금지' },
  { id: 'T6', group: '상태 규칙', title: '근거 자료 단위 빠진 값', input: '자료 식별번호 없는 verified', expect: '판단 보류(미확인 유지)' },
  { id: 'T7', group: '상태 규칙', title: '조치 경로 승인', input: 'A1 결재 완료', expect: '다시 확인 전 사용 가능 증가 금지' },
  { id: 'T8', group: '상태 규칙', title: '후속 승인', input: '재확인 결과 기록', expect: '원래 대상의 상태 변경' },
  { id: 'T9', group: '사고 대응', title: '중복 과업 재수집', input: '같은 과업 ID 재전송', expect: '수량 불변' },
  { id: 'T10', group: '사고 대응', title: '부서별 항목 대체', input: '현장 담당자의 배정 변경 시도', expect: '권한 없는 대체 거부' },
  { id: 'T11', group: '사고 대응', title: '과거 효력 정정', input: '지난 기준일의 사실을 오늘 정정', expect: '이력 보존·재판단' },
  { id: 'T12', group: '사고 대응', title: '무권한 해제', input: '현장 담당자의 보류 해제', expect: '거부·처리 기록' },
  { id: 'T13', group: '사고 대응', title: '동시 배정', input: '같은 대상의 배정을 동시에 변경', expect: '한쪽만 성공' },
  { id: 'T14', group: '사고 대응', title: '외부 연계 실패', input: '플랫폼 결재 후 외부 수락 실패', expect: '수동 절차·비교 확인' },
  { id: 'A1', group: '일부러 망가뜨리기', title: '근거 자료 누락', input: '근거 파일이 사라졌는데 화면엔 승인 수치가 남는다', expect: '해당 대상만 미확인으로 내리고 수량 관계 재검사' },
  { id: 'A2', group: '일부러 망가뜨리기', title: '중복 수집', input: '같은 과업이 재시도로 두 번 전달', expect: '과업 ID가 같으면 한 번만 반영' },
  { id: 'A3', group: '일부러 망가뜨리기', title: '후행 정정', input: '지난 기준일의 기록이 오늘 정정', expect: '발생·기록 시각 분리, 과거 결재를 덮지 않음' },
  { id: 'A4', group: '일부러 망가뜨리기', title: '단위·그룹 충돌', input: '단위나 부서 코드가 누락', expect: '자동 매핑 금지, 거부 큐에서 확인' },
  { id: 'A5', group: '일부러 망가뜨리기', title: '동시 승인', input: '두 담당자가 같은 보류를 동시에 해제', expect: '하나만 성공, 다른 쪽은 재검토로 전환' },
  { id: 'A6', group: '일부러 망가뜨리기', title: '외부 반영 실패', input: '플랫폼에선 결재됐지만 원천 시스템엔 미반영', expect: '결재와 외부 수락을 별도 상태로 관리' },
  { id: 'X1', group: '원칙 점검', title: '권한 분리', input: '컨설턴트·제안자·FDE의 조치 승인 시도', expect: '모두 거부' },
  { id: 'X2', group: '원칙 점검', title: '처리 기록 변조 탐지', input: '감사 기록 한 줄을 임의 수정', expect: '해시 체인 불일치 탐지' },
  { id: 'X3', group: '원칙 점검', title: '보호 지표 자동 중단', input: '무권한 승인 1건 주입', expect: '실행 중단 + 재검토 배정' },
  { id: 'X4', group: '원칙 점검', title: 'AI 추출값은 후보', input: 'OCR/AI 값 등록', expect: '확정 전에는 판정 근거 아님' },
  { id: 'X5', group: '원칙 점검', title: '분모 0은 100%가 아니다', input: '착수 0건의 완료율', expect: '산출 불가(null)' },
  { id: 'X6', group: '원칙 점검', title: '규칙 버전 재평가', input: '요건 추가 규칙(v2)', expect: '기준 시점에 유효한 규칙으로 판정' },
  { id: 'X7', group: '원칙 점검', title: '착수 직후 후속 확인', input: '미입사 대상의 입사 확인', expect: '미확인이 아니라 진행 → 요건이 모두 확인돼야 준비' },
];

function makeEnv() {
  const db = open(':memory:');
  seed.seedAll(db, {}); // 시험에는 사용자가 필요 없다(scrypt 비용 회피)
  const id = db.prepare(`SELECT id FROM engagements WHERE request_code='H-701'`).get().id;
  let t = Date.parse('2026-10-06T09:00:00.000Z');
  const clock = () => { t += 60000; return new Date(t); };
  const names = { admin: 'admin', consultant: 'consultant1', fde: 'fde1', exec: 'exec1', hr: 'hr1', manager: 'manager1', it: 'it1', sec: 'sec1', field: 'field1', reviewer: 'reviewer1' };
  const C = (role, username) => ({ db, clock, actor: { role, username: username || names[role] } });
  const snap = (o) => engine.snapshot(db, id, o);
  const pick = (bucket, n = 0, s) => (s || snap()).items.filter((i) => i.bucket === bucket)[n];
  const baseline = () => { const s = snap(); return s.counts.required === 45 && s.counts.started === 40 && s.counts.approved === 28 && s.metrics.shortage === 17; };
  const approveA1 = () => {
    const a1 = db.prepare(`SELECT id FROM interventions WHERE engagement_id=? AND code='A1'`).get(id).id;
    svc.submitIntervention(C('consultant'), id, a1);
    svc.decideIntervention(C('it'), id, a1, { decision: 'approve' });
    svc.decideIntervention(C('manager'), id, a1, { decision: 'approve' });
    return a1;
  };
  const expectThrow = (fn, status) => { try { fn(); } catch (e) { return e.status === status ? e : null; } return null; };
  return { db, id, C, snap, pick, baseline, approveA1, expectThrow, clock };
}

const TESTS = {
  T1: (e, ok) => { const s = e.snap(); const i = s.identities[0]; ok(s.counts.input === 45 && s.counts.started === 40 && s.counts.reserve === 5, `45 = 40 + 5 (실제 ${s.counts.input} = ${s.counts.started} + ${s.counts.reserve})`); ok(i.residual === 0, '잔차 0'); },
  T2: (e, ok) => { const s = e.snap(); const i = s.identities[1]; ok(s.counts.started === 40 && s.counts.completed === 40 && s.counts.in_progress === 0, `40 = ${s.counts.completed} + ${s.counts.in_progress}`); ok(i.residual === 0, '잔차 0'); },
  T3: (e, ok) => { const s = e.snap(); const i = s.identities[2]; ok(s.counts.approved === 28 && s.counts.review === 8 && s.counts.unconfirmed === 4, `40 = ${s.counts.approved} + ${s.counts.review} + ${s.counts.unconfirmed}`); ok(i.residual === 0, '잔차 0'); },
  T4: (e, ok) => {
    const s = e.snap();
    ok(Object.values(s.group_residual).every((r) => r === 0), `부서별 합계 = 총계 (잔차 ${JSON.stringify(s.group_residual)})`);
    ok(s.group_identities.every((g) => g.checks.every((c) => c.residual === 0)), '부서별 세 식 잔차 0');
    ok(s.groups.find((g) => g.code === 'PROD').approved === 12, '생산 준비 12');
  },
  T5: (e, ok) => {
    const it = e.pick('review'); const before = e.snap().counts;
    const r = svc.registerEvidence(e.C('it'), e.id, { item_id: it.id, requirement_key: 'ACCOUNT', value: 'delivered', source_ref: 'NOTICE-1', occurred_at: '2026-10-05' });
    const s = e.snap(); const after = s.items.find((i) => i.id === it.id);
    ok(r.status === 'confirmed', '전달 근거는 기록된다');
    ok(after.bucket === 'review', `전달(delivered)만으로는 준비가 아니다 (현재 ${after.bucket})`);
    ok(s.counts.approved === before.approved, '승인 수량 불변');
  },
  T6: (e, ok) => {
    const it = e.pick('unconfirmed'); const before = e.snap().counts;
    const r = svc.registerEvidence(e.C('manager'), e.id, { item_id: it.id, requirement_key: 'TRAINING', value: 'verified', occurred_at: '2026-10-05' });
    const s = e.snap();
    ok(r.warnings.some((w) => /미확인/.test(w)), '자료 식별번호 없음 경고');
    ok(s.items.find((i) => i.id === it.id).bucket === 'unconfirmed', '자료 식별번호 없는 verified 는 판단 보류(미확인)');
    ok(s.counts.approved === before.approved, '승인 수량 불변');
  },
  T7: (e, ok) => {
    const before = e.snap().counts; const a1 = e.approveA1();
    const iv = svc.loadIntervention(e.C('admin'), e.id, a1); const s = e.snap();
    ok(iv.status === 'APPROVED', `조치 상태 ${iv.status}`);
    ok(s.counts.approved === before.approved && s.counts.review === before.review, `다시 확인 전 사용 가능 수량 증가 금지 (준비 ${before.approved} → ${s.counts.approved})`);
  },
  T8: (e, ok) => {
    const a1 = e.approveA1(); svc.startIntervention(e.C('manager'), e.id, a1);
    const s0 = e.snap(); const tgt = e.pick('review', 0, s0);
    svc.recordOutcome(e.C('it'), e.id, a1, { item_id: tgt.id, outcome: 'verified', source_ref: 'LOG-REV-1', occurred_at: '2026-10-06' });
    const s1 = e.snap(); const tr = engine.transitions(s0, s1);
    ok(tr.moved.length === 1 && tr.moved[0].id === tgt.id && tr.moved[0].from === 'review' && tr.moved[0].to === 'approved', '원래 대상 하나만 검토 → 준비로 이동');
    ok(s1.counts.approved === 29 && s1.counts.review === 7 && s1.counts.completed === 40, `준비 29 · 검토 7 · 완료 40 (실제 ${s1.counts.approved}/${s1.counts.review}/${s1.counts.completed})`);
    ok(tr.new_inflow === 0 && tr.conserved, '신규 유입 0, 이전 칸 차감 = 다음 칸 증가');
  },
  T9: (e, ok) => {
    const it = e.pick('review'); const row = { task_id: 'TASK-9001', ref_key: it.ref_key, requirement_key: 'ACCOUNT', value: 'verified', source_ref: 'LOG-DUP-1', unit: '명', occurred_at: '2026-10-06' };
    const r1 = svc.ingest(e.C('it'), e.id, [row]); const s1 = e.snap();
    const r2 = svc.ingest(e.C('it'), e.id, [row, row]); const s2 = e.snap();
    ok(r1.applied === 1, '첫 수집은 반영');
    ok(r2.applied === 0 && r2.duplicates === 2, `재전송은 반영 0 · 중복 ${r2.duplicates}`);
    ok(JSON.stringify(s1.counts) === JSON.stringify(s2.counts), '수량 불변');
  },
  T10: (e, ok) => {
    const it = e.pick('approved'); const grp = e.snap().items.find((i) => i.id === it.id).group_code;
    const err = e.expectThrow(() => svc.changeAssignment(e.C('field'), e.id, { item_id: it.id, to_group_code: 'QA', reason: '임의 이동' }), 403);
    ok(!!err, '현장 담당자의 배정 변경은 403');
    ok(e.snap().items.find((i) => i.id === it.id).group_code === grp, '대상의 부서 불변');
    ok(e.db.prepare(`SELECT COUNT(*) n FROM audit WHERE outcome='denied' AND action='assignment.change'`).get().n === 1, '거부 기록이 남음');
    svc.changeAssignment(e.C('hr'), e.id, { item_id: it.id, to_group_code: grp === 'QA' ? 'SALES' : 'QA', reason: '배치 변경(권한자)' });
    const s = e.snap(); ok(s.integrity_ok && s.counts.approved === 28, '권한자의 변경 후에도 수량 관계·총계 유지');
  },
  T11: (e, ok) => {
    const it = e.pick('unconfirmed'); const known0 = '2026-10-06T08:00:00.000Z';
    const before = e.snap({ known: known0 });
    const missing = e.db.prepare(`SELECT id FROM evidence WHERE item_id=? AND requirement_key='TRAINING'`).get(it.id);
    svc.registerEvidence(e.C('manager'), e.id, { item_id: it.id, requirement_key: 'TRAINING', value: 'verified', source_ref: 'EDU-LATE-1', occurred_at: '2026-09-10', corrects_id: missing.id, note: '지난 사실의 정정(교육 수료 근거 발견)' });
    const afterOld = e.snap({ known: known0 }); const now = e.snap();
    ok(JSON.stringify(before.counts) === JSON.stringify(afterOld.counts), '이전 기록 시점(known)의 보고서는 그대로 재현된다');
    ok(now.counts.unconfirmed === 3 && now.counts.approved === 29, `현재 시점은 재판단 (미확인 ${now.counts.unconfirmed}, 준비 ${now.counts.approved})`);
    ok(e.db.prepare('SELECT value FROM evidence WHERE id=?').get(missing.id).value === 'missing', '원래 근거(missing)는 삭제·수정되지 않고 보존');
  },
  T12: (e, ok) => {
    const it = e.pick('review'); const h = svc.openHold(e.C('manager'), e.id, { item_id: it.id, reason: '점검 중' });
    const err = e.expectThrow(() => svc.releaseHold(e.C('field'), e.id, h.id, { expected_version: 1, reason: '임의 해제' }), 403);
    ok(!!err, '현장 담당자의 보류 해제는 403');
    ok(e.db.prepare('SELECT status FROM holds WHERE id=?').get(h.id).status === 'open', '보류는 열린 채 유지');
    ok(e.db.prepare(`SELECT COUNT(*) n FROM audit WHERE outcome='denied' AND action='hold.release' AND username='field1'`).get().n === 1, '무권한 시도가 처리 기록에 남음');
  },
  T13: (e, ok) => {
    const it = e.pick('approved'); const a = e.db.prepare(`SELECT id FROM assignments WHERE item_id=? AND status='active'`).get(it.id).id;
    const r1 = svc.changeAssignment(e.C('hr'), e.id, { item_id: it.id, to_group_code: 'QA', reason: '배치 A', expected_assignment_id: a });
    const err = e.expectThrow(() => svc.changeAssignment(e.C('exec'), e.id, { item_id: it.id, to_group_code: 'SALES', reason: '배치 B', expected_assignment_id: a }), 409);
    ok(!!r1 && !!err, '한쪽만 성공, 다른 쪽은 409');
    ok(e.db.prepare(`SELECT COUNT(*) n FROM assignments WHERE item_id=? AND status='active'`).get(it.id).n === 1, '활성 배정은 정확히 하나');
    ok(e.snap().integrity_ok, '수량 관계 유지');
  },
  T14: (e, ok) => syncScenario(e, ok, false),
  A1: (e, ok) => {
    const it = e.pick('approved'); const ev = e.db.prepare(`SELECT id FROM evidence WHERE item_id=? AND requirement_key='ACCOUNT'`).get(it.id);
    const before = e.snap();
    svc.registerEvidence(e.C('it'), e.id, { item_id: it.id, requirement_key: 'ACCOUNT', value: 'missing', source_ref: 'LOG-LOST', occurred_at: '2026-10-06', corrects_id: ev.id, note: '근거 파일 소실' });
    const s = e.snap(); const tr = engine.transitions(before, s);
    ok(s.items.find((i) => i.id === it.id).bucket === 'unconfirmed', '해당 대상만 미확인으로 내려간다');
    ok(tr.moved.length === 1, `다른 대상은 바뀌지 않는다 (이동 ${tr.moved.length}건)`);
    ok(s.integrity_ok && s.counts.approved === 27 && s.counts.unconfirmed === 5, `수량 관계 재검사 통과 (준비 27 · 미확인 5)`);
  },
  A2: (e, ok) => {
    const it = e.pick('review'); const row = { task_id: 'TASK-A2', ref_key: it.ref_key, requirement_key: 'ACCOUNT', value: 'verified', source_ref: 'LOG-A2', unit: '명', occurred_at: '2026-10-06' };
    svc.ingest(e.C('it'), e.id, [row]); const n1 = e.db.prepare('SELECT COUNT(*) n FROM evidence').get().n; const s1 = e.snap();
    for (let i = 0; i < 3; i++) svc.ingest(e.C('it'), e.id, [row]);
    ok(e.db.prepare('SELECT COUNT(*) n FROM evidence').get().n === n1, '재시도 3회에도 근거는 한 건만 존재');
    ok(JSON.stringify(e.snap().counts) === JSON.stringify(s1.counts), '수량 불변');
  },
  A3: (e, ok) => {
    const it = e.pick('unconfirmed'); const known = '2026-10-06T08:00:00.000Z';
    const s1 = e.snap({ basis: '2026-09-30', known });
    const missing = e.db.prepare(`SELECT id FROM evidence WHERE item_id=? AND requirement_key='TRAINING'`).get(it.id);
    svc.registerEvidence(e.C('manager'), e.id, { item_id: it.id, requirement_key: 'TRAINING', value: 'verified', source_ref: 'EDU-A3', occurred_at: '2026-09-25', corrects_id: missing.id, note: '후행 정정' });
    const s2 = e.snap({ basis: '2026-09-30', known });
    ok(JSON.stringify(s1.items.map((i) => i.bucket)) === JSON.stringify(s2.items.map((i) => i.bucket)), '지난 기준일 보고서(basis·known 고정)는 정정 뒤에도 그대로');
    const ev = e.db.prepare('SELECT occurred_at, recorded_at FROM evidence WHERE source_ref=?').get('EDU-A3');
    ok(ev.occurred_at < ev.recorded_at && ev.occurred_at.startsWith('2026-09-25'), '발생 시각(9/25)과 기록 시각(오늘)이 분리 저장');
    ok(e.db.prepare('SELECT COUNT(*) n FROM approvals').get().n === 0, '과거 결재 기록을 건드리지 않음');
  },
  A4: (e, ok) => {
    const before = e.snap().counts; const n0 = e.db.prepare('SELECT COUNT(*) n FROM items').get().n;
    const r = svc.ingest(e.C('hr'), e.id, [
      { ref_key: 'P-900', group_code: 'XX', requirement_key: 'MANAGER', value: 'verified', source_ref: 'S1', unit: '명' },
      { ref_key: 'P-901', group_code: 'PROD', requirement_key: 'MANAGER', value: 'verified', source_ref: 'S2', unit: '건' },
      { ref_key: 'P-902', group_code: 'PROD', requirement_key: 'MANAGER', value: 'verified', source_ref: 'S3' },
    ]);
    ok(r.rejected === 3 && r.applied === 0, `3행 모두 거부 큐 (거부 ${r.rejected})`);
    ok(e.db.prepare('SELECT COUNT(*) n FROM items').get().n === n0, '새 대상이 만들어지지 않음(자동 매핑 금지)');
    ok(e.db.prepare(`SELECT COUNT(*) n FROM reject_queue WHERE status='open'`).get().n === 3, '거부 큐에서 사람이 확인');
    ok(JSON.stringify(e.snap().counts) === JSON.stringify(before), '수량 불변');
  },
  A5: (e, ok) => {
    const it = e.pick('approved'); const h = svc.openHold(e.C('manager'), e.id, { item_id: it.id, reason: '동시 해제 시험' });
    svc.releaseHold(e.C('manager'), e.id, h.id, { expected_version: 1, reason: '확인 완료' });
    const err = e.expectThrow(() => svc.releaseHold(e.C('it'), e.id, h.id, { expected_version: 1, reason: '확인 완료(동시)' }), 409);
    ok(!!err, '두 번째 해제는 409');
    const rr = e.db.prepare(`SELECT * FROM re_reviews WHERE subject_type='hold' AND status='open'`).all();
    ok(rr.length === 1, '실패한 쪽은 재검토로 전환(re_reviews 1건)');
    ok(e.db.prepare('SELECT version FROM holds WHERE id=?').get(h.id).version === 2, '보류 버전은 한 번만 증가');
  },
  A6: (e, ok) => syncScenario(e, ok, true),
  X1: (e, ok) => {
    const a1 = e.db.prepare(`SELECT id FROM interventions WHERE engagement_id=? AND code='A1'`).get(e.id).id;
    svc.submitIntervention(e.C('consultant'), e.id, a1);
    ok(!!e.expectThrow(() => svc.decideIntervention(e.C('consultant'), e.id, a1, { decision: 'approve' }), 403), '컨설턴트는 승인할 수 없다');
    ok(!!e.expectThrow(() => svc.decideIntervention(e.C('fde'), e.id, a1, { decision: 'approve' }), 403), 'FDE 는 승인할 수 없다');
    ok(!!e.expectThrow(() => svc.decideIntervention(e.C('admin'), e.id, a1, { decision: 'approve' }), 403), '운영자(강사)도 승인할 수 없다');
    ok(!!e.expectThrow(() => svc.decideIntervention(e.C('hr'), e.id, a1, { decision: 'approve' }), 403), '필수 역할이 아닌 인사 담당은 A1 을 승인할 수 없다');
    svc.decideIntervention(e.C('it'), e.id, a1, { decision: 'approve' });
    ok(!!e.expectThrow(() => svc.decideIntervention(e.C('it', 'it2'), e.id, a1, { decision: 'approve' }), 409), '같은 역할의 중복 승인은 거부');
    ok(!!e.expectThrow(() => svc.startIntervention(e.C('manager'), e.id, a1), 409), '필수 결재가 끝나기 전에는 실행할 수 없다');
    ok(!!e.expectThrow(() => svc.proposeIntervention(e.C('manager'), e.id, { title: 'x' }), 403), '현업 관리자는 조치를 제안할 수 없다');
    ok(!!e.expectThrow(() => svc.proposeIntervention(e.C('consultant'), e.id, { title: 'x', required_roles: ['consultant'] }), 400), '컨설턴트를 승인 역할로 지정할 수 없다');
  },
  X2: (e, ok) => {
    svc.openHold(e.C('manager'), e.id, { item_id: e.pick('approved').id, reason: '기록 시험' });
    ok(verifyChain(e.db).ok, '정상 상태에서는 해시 체인 일치');
    e.db.prepare(`UPDATE audit SET outcome='denied' WHERE id=(SELECT MIN(id) FROM audit)`).run();
    const v = verifyChain(e.db); ok(!v.ok && v.brokenAt >= 1, `변조 탐지 (끊긴 위치 #${v.brokenAt})`);
  },
  X3: (e, ok) => {
    const a1 = e.approveA1();
    // 무권한 승인 1건 주입: 승인 기록의 역할이 조치의 필수 역할이 아님
    e.db.prepare(`INSERT INTO approvals (engagement_id,subject_type,subject_id,role,username,decision,created_at) VALUES (?,?,?,?,?,?,?)`).run(e.id, 'intervention', a1, 'field', 'rogue', 'approve', '2026-10-06T10:00:00.000Z');
    const pr = engine.protection(e.db, e.id, e.snap());
    ok(pr.stop && pr.breached.includes('unauthorized'), '보호 지표(무권한 승인 > 0)가 중단 신호를 낸다');
    ok(!!e.expectThrow(() => svc.startIntervention(e.C('manager'), e.id, a1), 409), '실행 시작이 거부된다');
    ok(e.db.prepare('SELECT status FROM interventions WHERE id=?').get(a1).status === 'STOPPED', '조치가 STOPPED 로 전환(롤백 후에도 남는 부수 기록)');
    ok(e.db.prepare(`SELECT COUNT(*) n FROM re_reviews WHERE subject_type='protection'`).get().n === 1, '담당자 재검토가 배정됨');
  },
  X4: (e, ok) => {
    const it = e.pick('unconfirmed'); const before = e.snap().counts;
    const r = svc.registerEvidence(e.C('manager'), e.id, { item_id: it.id, requirement_key: 'TRAINING', value: 'verified', source_ref: 'OCR-1', origin: 'ocr_ai', occurred_at: '2026-10-06' });
    ok(r.status === 'candidate', 'AI/OCR 값은 소유 역할이 등록해도 후보');
    ok(e.snap().items.find((i) => i.id === it.id).bucket === 'unconfirmed' && e.snap().counts.approved === before.approved, '후보는 판정에 반영되지 않는다');
    ok(!!e.expectThrow(() => svc.reviewEvidence(e.C('reviewer'), e.id, r.id, 'confirm'), 403), '검토자는 확정할 수 없다');
    ok(!!e.expectThrow(() => svc.reviewEvidence(e.C('fde'), e.id, r.id, 'confirm'), 403), 'FDE 는 확정할 수 없다');
    svc.reviewEvidence(e.C('manager'), e.id, r.id, 'confirm');
    ok(e.snap().items.find((i) => i.id === it.id).bucket === 'approved', '근거 자료 관리자가 확정하면 반영');
  },
  X5: (e, ok) => {
    const m = engine.metricsOf({ required: 10, input: 10, started: 0, reserve: 10, completed: 0, in_progress: 0, approved: 0, review: 0, unconfirmed: 0 });
    ok(m.completion_rate === null && m.approval_rate === null, '분모 0 → 완료율·승인율 null(산출 불가)');
    ok(m.fulfilment_rate === 0 && m.shortage === 10, '충족률 0%, 부족 10');
  },
  X7: (e, ok) => {
    const it = e.pick('reserve'); const before = e.snap().counts;
    svc.registerEvidence(e.C('hr'), e.id, { item_id: it.id, requirement_key: '_START', value: 'verified', source_ref: 'HIRE-X7', occurred_at: '2026-10-06' });
    let s = e.snap(); const b1 = s.items.find((i) => i.id === it.id).bucket;
    ok(b1 === 'in_progress', `입사 확인 직후는 미확인이 아니라 진행 (현재 ${b1})`);
    ok(s.counts.reserve === before.reserve - 1 && s.counts.in_progress === 1 && s.counts.approved === before.approved, '예비 −1 · 진행 +1 · 준비 불변');
    ok(s.integrity_ok, '세 식 잔차 0');
    svc.registerEvidence(e.C('manager'), e.id, { item_id: it.id, requirement_key: 'TRAINING', value: 'verified', source_ref: 'EDU-X7', occurred_at: '2026-10-06' });
    svc.registerEvidence(e.C('manager'), e.id, { item_id: it.id, requirement_key: 'MANAGER', value: 'verified', source_ref: 'MGR-X7', occurred_at: '2026-10-06' });
    ok(e.snap().items.find((i) => i.id === it.id).bucket === 'in_progress', '요건 하나(계정)가 남아 있으면 아직 준비가 아니다');
    svc.registerEvidence(e.C('it'), e.id, { item_id: it.id, requirement_key: 'ACCOUNT', value: 'verified', source_ref: 'LOG-X7', occurred_at: '2026-10-06' });
    s = e.snap(); ok(s.items.find((i) => i.id === it.id).bucket === 'approved' && s.counts.approved === before.approved + 1, '모든 요건이 확인되면 준비');
  },
  X6: (e, ok) => {
    const wt2 = require('./worktools');
    const s0 = e.snap();
    // v2: TRAINING+ACCOUNT 만 요구(현업 확인 제외) — 2026-10-01 부터 유효. 변경 권한: 컨설턴트/경영진
    ok(!!e.expectThrow(() => wt2.addRuleVersion(e.C('manager'), e.id, { required_keys: ['TRAINING'], effective_from: '2026-10-01' }), 403), '현업 관리자는 판정 규칙을 바꿀 수 없다');
    wt2.addRuleVersion(e.C('exec'), e.id, { required_keys: ['TRAINING', 'ACCOUNT', 'MANAGER'], effective_from: '2026-10-01', note: '동일 요건 재확정' });
    const s1 = e.snap({ basis: '2026-09-20' }); const s2 = e.snap({ basis: '2026-10-05' });
    ok(s1.rule.version === 1 && s2.rule.version === 2, `기준 시점별 규칙 버전 (9/20 → v${s1.rule.version}, 10/5 → v${s2.rule.version})`);
    ok(JSON.stringify(s0.counts) === JSON.stringify(s2.counts), '같은 요건이면 판정 동일');
  },
};


/** T14 / A6: 플랫폼 결재 ≠ 외부 수락 */
function syncScenario(e, ok, withRecovery) {
  const a1 = e.approveA1(); svc.startIntervention(e.C('manager'), e.id, a1);
  const tgt = e.pick('review');
  svc.recordOutcome(e.C('it'), e.id, a1, { item_id: tgt.id, outcome: 'verified', source_ref: 'LOG-SYNC-1', occurred_at: '2026-10-06' });
  ok(!!e.expectThrow(() => svc.requestSync(e.C('fde'), e.id, { subject_type: 'intervention', subject_id: a1 }), 409), '읽기 단계에서는 쓰기 연계 요청 불가');
  ok(!!e.expectThrow(() => svc.setSyncStage(e.C('it'), e.id, 'manual'), 409), '단계를 건너뛰어 열 수 없다(읽기 → 시뮬레이션 → 수동 승인 → 제한된 실운영)');
  svc.setSyncStage(e.C('it'), e.id, 'simulation');
  const dry = svc.requestSync(e.C('fde'), e.id, { subject_type: 'intervention', subject_id: a1, idem_key: 'DRY-RUN-1' });
  ok(svc.sendSync(e.C('fde'), e.id, dry.id).dry_run === true && e.db.prepare('SELECT COUNT(*) n FROM external_ledger').get().n === 0, '시뮬레이션 단계는 외부 원장에 쓰지 않는다');
  svc.setSyncStage(e.C('it'), e.id, 'manual');
  const rq = svc.requestSync(e.C('fde'), e.id, { subject_type: 'intervention', subject_id: a1 });
  ok(!!e.expectThrow(() => svc.sendSync(e.C('fde'), e.id, rq.id), 409), '플랫폼 결재(수동 승인) 전에는 전송 불가');
  ok(!!e.expectThrow(() => svc.approveSync(e.C('fde'), e.id, rq.id, 'approve'), 403), 'FDE 는 연계를 승인할 수 없다');
  svc.approveSync(e.C('it'), e.id, rq.id, 'approve');
  e.db.prepare(`INSERT INTO settings (key,value) VALUES ('external_mode','fail') ON CONFLICT(key) DO UPDATE SET value='fail'`).run();
  const before = e.snap().counts;
  const sent = svc.sendSync(e.C('fde'), e.id, rq.id);
  const row = e.db.prepare('SELECT * FROM external_syncs WHERE id=?').get(rq.id);
  ok(sent.external_status === 'failed' && row.platform_status === 'approved', `결재(approved)와 외부 수락(failed)이 별도 상태 (${row.platform_status}/${row.external_status})`);
  ok(JSON.stringify(e.snap().counts) === JSON.stringify(before), '외부 실패가 내부 수량을 바꾸지 않는다');
  if (!withRecovery) {
    svc.reconcileSync(e.C('it'), e.id, rq.id, '원천 시스템 화면과 수동 비교 확인');
    ok(e.db.prepare('SELECT external_status FROM external_syncs WHERE id=?').get(rq.id).external_status === 'manual_reconciled', '수동 절차·비교 확인으로 처리');
  } else {
    e.db.prepare(`UPDATE settings SET value='ok' WHERE key='external_mode'`).run();
    const r2 = svc.sendSync(e.C('fde'), e.id, rq.id); const r3 = svc.sendSync(e.C('fde'), e.id, rq.id);
    ok(r2.external_status === 'accepted' && r3.duplicate === true, '장애 복구 후 재전송은 수락, 반복 전송은 중복으로 무시');
    ok(e.db.prepare('SELECT COUNT(*) n FROM external_ledger').get().n === 1, '외부 원장에는 한 건만 존재');
  }
}

function catalog() { return CATALOG; }

function runAll({ only } = {}) {
  const list = only && only.length ? CATALOG.filter((c) => only.includes(c.id)) : CATALOG;
  const results = [];
  for (const c of list) {
    const checks = []; const started = Date.now(); let error = null;
    let e = null;
    try {
      e = makeEnv();
      const ok = (cond, msg) => { checks.push({ pass: !!cond, msg }); };
      TESTS[c.id](e, ok);
    } catch (err) { error = `${err.status || ''} ${err.message}`.trim(); }
    const real = checks.filter((k) => k.msg);
    results.push({ ...c, pass: !error && real.length > 0 && real.every((k) => k.pass), checks: real, error, ms: Date.now() - started });
    if (e) e.db.close();
  }
  // 기준선 복구 확인: 새 DB 에서 45·40·28·17 이 다시 계산되는가
  const e2 = makeEnv(); const baseline = e2.baseline(); e2.db.close();
  return { total: results.length, passed: results.filter((r) => r.pass).length, failed: results.filter((r) => !r.pass).length, baseline_ok: baseline, results };
}

module.exports = { catalog, runAll, makeEnv, TESTS, CATALOG };
