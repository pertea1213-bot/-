'use strict';
/**
 * 시드: 업종 어댑터 3종 + 사용자 + 사례 3건.
 *  - HR 사례(H-701 / HR-047): 교안·원문의 수치(45→40→28, 부서별 표, 8·4·5, 조치 가정 14명 이동)와 정확히 일치.
 *  - 제조(30건)·외식(18명): 교안 모듈 B의 가상 예시.
 * ⚠ 원문에는 대상별 행 데이터가 없다. 대상별 행(P-001…)·날짜·자료 번호는 합계·부서별 표를 재현하도록 만든 *합성 데이터*다.
 */
const { hashPassword } = require('../util');
const core = require('./core');
const cases = require('./cases');
const { seedCase, addHypotheses, addIntervention, addScenario } = core;

const ADAPTERS = [
  {
    key: 'hr-onboarding', name: '인사·조직 — 신규 입사자 배치 준비', industry: '인사·조직', task_name: '입사·배치 확인 과업', unit: '명', request_label: '인력 준비요청',
    item_label: '사람', group_label: '부서', start_label: '입사 확인', start_owner: 'hr',
    requirements: [
      { key: 'TRAINING', label: '직무 교육 수료·평가', source: '교육 수료·평가', owner: 'manager' },
      { key: 'ACCOUNT', label: '계정·접근권한 활성화', source: '계정·권한 로그', owner: 'it' },
      { key: 'MANAGER', label: '현업 관리자 준비 확인', source: '현업 준비 확인', owner: 'manager' },
    ],
    role_labels: {},
    trap: '입사 확인 ≠ 교육·권한 완료. 계정 생성 통지 ≠ 접근 활성화.',
    regulations: '개인정보는 최소 필드와 역할별 열람으로 제한. 입사·교육·권한 처리 기록의 목적·접근권한·보존 기간은 현장 정책과 법률 검토로 정한다. 노무 판단은 공인노무사와 인사 책임자의 별도 검토.',
  },
  {
    key: 'mfg-workorder', name: '제조 — 작업지시 투입', industry: '제조', task_name: '작업지시 투입 확인', unit: '건', request_label: '작업지시 요청',
    item_label: '작업지시', group_label: '생산 라인', start_label: '투입 착수', start_owner: 'manager',
    requirements: [
      { key: 'MATERIAL', label: '자재 입고', source: '입고 기록', owner: 'manager' },
      { key: 'EQUIPMENT', label: '설비 점검', source: '설비 점검표', owner: 'it' },
      { key: 'INSPECTION', label: '검사 통과', source: '검사성적서', owner: 'sec' },
    ],
    role_labels: { manager: '생산 관리자', it: '설비 보전 담당', sec: '품질 검사 담당', hr: '생산 계획 담당' },
    trap: '생산 완료 ≠ 출하 가능.', regulations: '품질·안전 규정은 해당 전문가가 확인한다.',
  },
  {
    key: 'restaurant-open', name: '외식·카페 — 점포 오픈 인력', industry: '외식·카페', task_name: '점포 오픈 인력 준비', unit: '명', request_label: '오픈 요청',
    item_label: '직원', group_label: '파트', start_label: '근무 확정', start_owner: 'hr',
    requirements: [
      { key: 'RECIPE', label: '레시피 교육', source: '교육 기록', owner: 'manager' },
      { key: 'HYGIENE', label: '위생 교육', source: '위생 점검표', owner: 'sec' },
      { key: 'POS', label: '주문 시스템 권한', source: '권한 로그', owner: 'it' },
    ],
    role_labels: { manager: '점장', sec: '위생 책임자', it: '시스템 담당', hr: '인사 담당' },
    trap: '교육 완료 ≠ 기준 충족.', regulations: '위생 관련 법정 교육·점검은 해당 전문가가 확인한다.',
  },
];

const USERS = [
  ['admin', '운영자(강사)', 'admin'], ['consultant1', '컨설턴트 A', 'consultant'], ['consultant2', '컨설턴트 B', 'consultant'],
  ['fde1', 'FDE A', 'fde'], ['exec1', '경영진 A', 'exec'], ['hr1', '인사 담당 A', 'hr'], ['manager1', '현업 관리자 A', 'manager'], ['manager2', '현업 관리자 B', 'manager'],
  ['it1', '정보 담당 A', 'it'], ['it2', '정보 담당 B', 'it'], ['sec1', '노무·보안 담당 A', 'sec'], ['field1', '현장 담당자 A', 'field'], ['field2', '현장 담당자 B', 'field'],
  ['reviewer1', '검토자 A', 'reviewer'], ['learner1', '교육생 A', 'learner'], ['learner2', '교육생 B', 'learner'],
];

function seedBase(db, { demoPassword, now = new Date() } = {}) {
  const t = now.toISOString();
  const insA = db.prepare(`INSERT OR IGNORE INTO adapters (key,name,industry,task_name,unit,item_label,group_label,start_label,start_owner,requirements,role_labels,request_label,trap,regulations,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const a of [...ADAPTERS, ...cases.ADAPTERS]) insA.run(a.key, a.name, a.industry, a.task_name, a.unit, a.item_label, a.group_label, a.start_label, a.start_owner, JSON.stringify(a.requirements), JSON.stringify(a.role_labels), a.request_label || '요청', a.trap, a.regulations, t);
  if (demoPassword) {
    const insU = db.prepare('INSERT OR IGNORE INTO users (username,display_name,role,pw_hash,created_at) VALUES (?,?,?,?,?)');
    for (const [u, n, r] of USERS) insU.run(u, n, r, hashPassword(demoPassword), t);
  }
}

function seedHr(db) {
  const { eid, items } = seedCase(db, {
    adapter: 'hr-onboarding', request_code: 'H-701', task_code: 'HR-047', title: '가상 제조회사 신규 입사자 배치 준비 (인력 준비요청 H-701)',
    basis: '2026-10-05', refPrefix: 'P', seed: 20260701,
    notes: '교육용 가상 사례. 부서별 필요 인원 45명(영업16·생산20·품질9) 중 40명 입사, 28명 최초 준비.',
    groups: [
      { code: 'SALES', name: '영업', required: 16, counts: { approved: 10, review: 3, unconfirmed: 1, in_progress: 0, reserve: 2 } },
      { code: 'PROD', name: '생산', required: 20, counts: { approved: 12, review: 4, unconfirmed: 2, in_progress: 0, reserve: 2 } },
      { code: 'QA', name: '품질', required: 9, counts: { approved: 6, review: 1, unconfirmed: 1, in_progress: 0, reserve: 1 } },
    ],
    cohortSizes: [4, 3, 3, 4, 3, 4, 3, 4, 3, 3, 3, 3],
    cohortDates: ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-21', '2026-09-22'],
    reserveDates: ['2026-10-12', '2026-10-12', '2026-10-12', '2026-10-19', '2026-10-19'],
    reviewKeys: ['ACCOUNT'], unconfirmedMissing: ['TRAINING'], pendingKeys: ['MANAGER'],
    srcPrefix: { _START: 'P', TRAINING: 'EDU', ACCOUNT: 'LOG', MANAGER: 'MGR' },
    noteFn: (x, k, v) => (v === 'unmet' ? '접근 미설정 사유 확인 필요(원인 미판정)' : v === 'missing' ? '이수 불명 자료 — 근거 확인 필요' : null),
  });
  const R = (code, kind, title, desc, bucket, task, roles, cost, stop, rec) => {
    const info = db.prepare(`INSERT INTO interventions (engagement_id,code,kind,title,description,target_bucket,task_key,required_roles,cost,stop_condition,recovery_path,proposed_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(eid, code, kind, title, desc, bucket, task, JSON.stringify(roles), cost ? JSON.stringify(cost) : null, stop, rec, 'consultant1', '2026-10-05T10:00:00.000Z', '2026-10-05T10:00:00.000Z');
    const id = Number(info.lastInsertRowid);
    if (bucket) for (const it of items.filter((x) => x.b === bucket)) db.prepare('INSERT INTO intervention_targets (intervention_id,item_id) VALUES (?,?)').run(id, it.id);
    return id;
  };
  R('A0', 'smallest', '입사·교육·접근권한·현업 확인을 별도 처리 단계로 승인', '가장 작은 조치. "완료"와 "준비"를 분리해 보고 체계에 반영한다. 대상: 4가지 확인 단계 전체. 원문에 비용 수치 없음.', null, null, ['exec', 'hr'], null, '근거 없는 승인이 1건이라도 확인되면 중단', '변경 전 처리 단계 정의로 복원');
  R('A1', 'alt1', '접근권한 확인 대기 8명의 계정 근거 재확인', '계정 근거 8건을 재확인한다. 정보 담당 확인 + 현업 관리자 승인.', 'review', 'ACCOUNT', ['it', 'manager'],
    { lines: [{ label: '계정 점검 8건 × 15분', qty: 8, minutes: 15, rate: 25000 }], note: '교육용 업무 부담 가정(2인시 × 25,000원)' },
    '무권한 승인이 1건이라도 확인되면 즉시 중단', '변경 전 상태 이력으로 복원, 외부 전달은 수동 비교 확인');
  R('A2', 'alt2', '교육 확인 대기 4명의 직무 교육을 개별 재평가', '직무 교육 개별 재평가. 비용 가정은 재교육 3명 기준이며 대상 4명 전체 비용이 아니다(가정).', 'unconfirmed', 'TRAINING', ['manager', 'hr'],
    { lines: [{ label: '교육 재실시 3명 × 2시간', qty: 3, hours: 2, rate: 25000 }], note: '교육용 업무 부담 가정(6인시 × 25,000원). 승인 역할은 원문에 명시되지 않아 가정.' },
    '재평가 근거 없이 수료 처리되면 중단', '재평가 전 수료 상태로 복원');
  R('A3', 'alt3', '미입사 5명 — 추가 확보·일정 변경(입사 일정 확인)', '입사 일정을 확인한다. 미입사자는 교육·권한 실적에 포함하지 않는다. 비용은 원문에 없음 — 현장에서 산정.', 'reserve', '_START', ['hr'],
    { lines: [], note: '원문에 비용 수치 없음 — 현장에서 산정' }, '입사 사실 근거 없이 착수 처리되면 중단', '예정 상태(예비)로 복원');

  // 가정 시나리오(교안 모듈 D): 부서별 준비 16/17/9 = 42. 생산 잔여 3명 = 계정 1·교육 1·미입사 1.
  const asm = [];
  const take = (grp, bucket, n, outcome) => items.filter((x) => x.g === grp && x.b === bucket).forEach((x, i) => asm.push({ item_id: x.id, ref_key: x.ref, outcome: i < n ? outcome : 'hold' }));
  take('SALES', 'review', 3, 'resolve'); take('SALES', 'unconfirmed', 1, 'resolve'); take('SALES', 'reserve', 2, 'resolve');
  take('PROD', 'review', 3, 'resolve'); take('PROD', 'unconfirmed', 1, 'resolve'); take('PROD', 'reserve', 1, 'resolve');
  take('QA', 'review', 1, 'resolve'); take('QA', 'unconfirmed', 1, 'resolve'); take('QA', 'reserve', 1, 'resolve');
  db.prepare('INSERT INTO scenarios (engagement_id,name,assumptions,note,created_at) VALUES (?,?,?,?,?)').run(eid, '조치 후 가정 분기 (7+3+4 = 14명 이동)', JSON.stringify(asm),
    '원문의 교육용 가정: 접근 8→7준비+1보류, 교육 4→3준비+1보류, 미입사 5→4입사·준비+1미입사. 현장 시험 결과가 아니며 7·3·4명이 이동한다는 근거 자료는 제시되지 않았다.', '2026-10-05T10:00:00.000Z');

  const hy = db.prepare('INSERT INTO hypotheses (engagement_id,code,statement,support_source,disconfirm_source) VALUES (?,?,?,?,?)');
  const cv = db.prepare('INSERT INTO hypothesis_coverage (hypothesis_id,bucket,prompt) VALUES (?,?,?)');
  [
    ['H1', '교육 이수는 기록됐지만 직무 권한 부여가 누락됐다', '정원·배치 승인', '계정·권한 로그', '권한 부여 기록이 로그에 있나?', '교육 기록은 남아 있나?'],
    ['H2', '계정 생성 통지와 실제 접근 활성화가 다르다', '입사 예정·서류', '접근 미설정 사유', '통지 시각과 활성화 시각 비교', '접근 문제와 관련이 있나?'],
    ['H3', '교육 미완료와 근거 자료 누락이 섞여 있다', '입사 사실 근거 자료', '교육 이수 불명 자료', '교육 이수 근거가 비어 있나?', '미완료인가, 기록 누락인가?'],
    ['H4', '배치 부서와 채용 승인 범위가 달라졌다', '교육 수료·평가', '현업 준비 확인', '배치 부서가 바뀌었나?', '채용 승인 범위와 맞나?'],
  ].forEach(([c, s, a, b, p1, p2]) => { const id = Number(hy.run(eid, c, s, a, b).lastInsertRowid); cv.run(id, 'review', p1); cv.run(id, 'unconfirmed', p2); });

  const dr = db.prepare('INSERT INTO data_requests (engagement_id,name,owner,format_version,access_limit,provided) VALUES (?,?,?,?,?,?)');
  [['정원 승인서', '경영진', '', '내부 식별번호만', 0], ['입사 예정·서류', '인사 담당', '', '실명 제외', 0], ['입사 사실 근거 자료', '인사 담당', '', '실명 제외', 0], ['교육 수료·평가', '현업 관리자', '', '평가 점수 제외(수료 여부만)', 0], ['계정·권한 로그', '정보 담당', '', '계정 ID 대신 참조키', 0]].forEach((r) => dr.run(eid, ...r));
  const st = db.prepare('INSERT INTO statements (engagement_id,topic,statement,speaker,record_ref,match,confirm_note) VALUES (?,?,?,?,?,?,?)');
  st.run(eid, '‘40명 완료’', '입사 40명은 모두 완료됐다', '대표', '입사 사실 근거 자료', 'partial', '완료의 정의 확인(입사 확인 ≠ 준비)');
  st.run(eid, '‘교육은 다 했다’', '교육은 모두 마쳤다', '현업 관리자', '교육 수료·평가', 'check', '이수 불명 4명');
  st.run(eid, '‘계정은 보냈다’', '계정 생성 메일을 보냈다', '정보 담당', '계정·권한 로그', 'check', '접근 미설정 8명');
  const dc = db.prepare('INSERT INTO dictionary (engagement_id,field,definition,example,version,approver) VALUES (?,?,?,?,?,?)');
  [['단위', '무엇으로 세는가', '명', '정보 담당'], ['대상 식별키', '한 대상을 구별하는 값(실명 아님)', 'P-001', '인사 담당'], ['하위 범주', '부서·품목·구역 등', '영업·생산·품질', '경영진'], ['발생 시각', '현실에서 일어난 때', '입사일', '인사 담당'], ['기록 시각', '시스템에 입력된 때', '입력 일시', '정보 담당'], ['승인자', '상태를 승인한 역할', '현업 관리자', '경영진'], ['근거', '연결된 자료 식별번호', '로그 ID', '정보 담당']].forEach((r) => dc.run(eid, r[0], r[1], r[2], 'v1', r[3]));
  return eid;
}

function seedMfg(db) {
  return seedCase(db, {
    adapter: 'mfg-workorder', request_code: 'M-301', task_code: 'MF-012', title: '(가상 예시) 제조 — 작업지시 30건 투입', basis: '2026-10-05', refPrefix: 'W', seed: 31,
    notes: '교안 모듈 B 가상 예시 ①. 입력 30 = 착수 26 + 예비 4 / 착수 26 = 완료 24 + 진행 2 / 완료 24 = 승인 18 + 검토 4 + 미확인 2.',
    groups: [
      { code: 'LA', name: '라인 A', required: 12, counts: { approved: 8, review: 2, unconfirmed: 1, in_progress: 1, reserve: 0 } },
      { code: 'LB', name: '라인 B', required: 10, counts: { approved: 6, review: 1, unconfirmed: 1, in_progress: 1, reserve: 1 } },
      { code: 'LC', name: '라인 C', required: 8, counts: { approved: 4, review: 1, unconfirmed: 0, in_progress: 0, reserve: 3 } },
    ],
    cohortSizes: [5, 5, 5, 5, 6], cohortDates: ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-28'], reserveDates: ['2026-10-12', '2026-10-13'],
    reviewKeys: ['EQUIPMENT'], unconfirmedMissing: ['INSPECTION'], pendingKeys: ['MATERIAL'], srcPrefix: { _START: 'W', MATERIAL: 'RCV', EQUIPMENT: 'EQP', INSPECTION: 'QC' },
  }).eid;
}
function seedRestaurant(db) {
  return seedCase(db, {
    adapter: 'restaurant-open', request_code: 'R-205', task_code: 'RS-003', title: '(가상 예시) 외식 — 점포 오픈 인력 18명', basis: '2026-10-05', refPrefix: 'E', seed: 18,
    notes: '교안 모듈 B 가상 예시 ②. 입력 18 = 착수 16 + 예비 2 / 착수 16 = 완료 16 + 진행 0 / 완료 16 = 승인 11 + 검토 3 + 미확인 2.',
    groups: [
      { code: 'HALL', name: '홀', required: 9, counts: { approved: 6, review: 2, unconfirmed: 0, in_progress: 0, reserve: 1 } },
      { code: 'KITCHEN', name: '주방', required: 9, counts: { approved: 5, review: 1, unconfirmed: 2, in_progress: 0, reserve: 1 } },
    ],
    cohortSizes: [4, 4, 4, 4], cohortDates: ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24'], reserveDates: ['2026-10-12'],
    reviewKeys: ['POS'], unconfirmedMissing: ['HYGIENE'], pendingKeys: ['RECIPE'], srcPrefix: { _START: 'E', RECIPE: 'RCP', HYGIENE: 'HYG', POS: 'POS' },
  }).eid;
}

// 순서가 의미 있다(HR 이 1번 과업). 키가 정수형('13')이면 객체는 항상 맨 앞으로 열거하므로 배열을 쓴다.
const CASES = [
  ['H-701', () => module.exports.seedHr], ['M-301', () => module.exports.seedMfg], ['R-205', () => module.exports.seedRestaurant],
  ['13', () => cases.seedAcademy], ['O-601', () => cases.seedApparel], ['O-301', () => cases.seedBread],
];
const seederFor = (code) => { const c = CASES.find(([k]) => k === code); return c ? c[1]() : null; };

/** only: ['H-701'] 처럼 일부 사례만 만든다(시험 속도용). 한 트랜잭션으로 처리해 첫 기동도 빠르다. */
function seedAll(db, opts = {}) {
  db.transaction(() => {
    seedBase(db, opts);
    if (!db.prepare('SELECT 1 FROM engagements').get()) {
      for (const [code, get] of CASES) if (!opts.only || opts.only.includes(code)) get()(db);
    }
  })();
}

/** 한 사례를 초기 상태로 되돌린다(데모/교육용). 처리 기록(audit)은 보존한다. */
function resetCase(db, engagementId) {
  const e = db.prepare('SELECT * FROM engagements WHERE id=?').get(engagementId);
  if (!e) return null;
  db.transaction(() => {
    db.prepare(`DELETE FROM approvals WHERE engagement_id=?`).run(engagementId);
    db.prepare(`DELETE FROM re_reviews WHERE engagement_id=?`).run(engagementId);
    db.prepare(`DELETE FROM checklist_state WHERE engagement_id=?`).run(engagementId);
    db.prepare(`DELETE FROM external_ledger`).run();
    db.prepare('DELETE FROM engagements WHERE id=?').run(engagementId);
    const fn = seederFor(e.request_code);
    if (!fn) throw new Error('이 과업은 초기화 시드가 없습니다(직접 만든 과업).');
    fn(db);
  })();
  return db.prepare('SELECT id FROM engagements WHERE request_code=?').get(e.request_code).id;
}

module.exports = { seedAll, seedBase, seedHr, seedMfg, seedRestaurant, seedAcademy: cases.seedAcademy, seedApparel: cases.seedApparel, seedBread: cases.seedBread, seedCase, resetCase, ADAPTERS, USERS };
