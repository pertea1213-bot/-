'use strict';
/**
 * 정본 스킴 사례 3건: 학원(제13장) · 의류 소공인(제18장) · 빵 제조(제16장).
 * 모든 수치는 원고의 값이며, 대상별 행·날짜·자료 번호만 합성이다.
 */
const { seedCase, addHypotheses, addIntervention, addScenario, addGenericTools } = require('./core');

const pad = (n, w = 3) => String(n).padStart(w, '0');

const ADAPTERS = [
  {
    key: 'academy-renewal', name: '학원 — 재등록 운영 개선', industry: '학원', task_name: '재등록 확정 확인', unit: '명',
    item_label: '재등록 대상 학생(가명)', group_label: '과정', start_label: '재등록 판단 개시', start_owner: 'hr', request_label: '원고 장',
    requirements: [
      { key: 'CONTRACT', label: '다음 기간 계약 확인', source: '수강 계약', owner: 'exec' },
      { key: 'PAYMENT', label: '결제 확인', source: '수납 원본', owner: 'it' },
    ],
    role_labels: { exec: '원장', hr: '상담 담당(원장 겸직)', it: '수납 담당(원장 겸직)', manager: '강사', sec: '개인정보 책임(원장)', field: '강사(출결 입력)', reviewer: '검토자(외부 전문가)' },
    trap: '재등록 의향·상담 ≠ 계약·결제 확정. 정상 수료 6명은 재등록 대상(분모)에서 제외한다.',
    regulations: '이름·보호자 연락처·성적·민감한 상담 메모는 원자료에 넣지 않는다(가명 ID만). 개인정보 처리 근거와 권한은 실제 구축에서 별도 확인한다. 성적·상담 기록을 재등록 예측 점수로 쓰지 않는다.',
  },
  {
    key: 'apparel-order', name: '의류 소공인 — 사양·사이즈별 납품', industry: '의류 소공인', task_name: '사이즈별 납품 가능량 확인', unit: '벌',
    item_label: '재단 세트(셔츠 한 벌)', group_label: '사이즈', start_label: '봉제 착수', start_owner: 'manager', request_label: '주문',
    requirements: [
      { key: 'SPEC', label: 'R3 사양 적용·준비 확인', source: '사양서·견본·묶음 라벨', owner: 'manager' },
      { key: 'MEASURE', label: '측정·검사 승인(R3 197~203mm)', source: '측정값·검사 기록', owner: 'sec' },
      { key: 'ALLOC', label: '사이즈별 주문 배정(미배정 확인)', source: '주문 품목행·배정 기록', owner: 'hr' },
    ],
    role_labels: { exec: '대표(수주 담당 겸)', manager: '생산 책임자', sec: '검사 책임자', hr: '출하 담당', it: '기록·설비 담당', field: '공정 작업자', reviewer: '검토자' },
    trap: '봉제 완료 360벌 ≠ 납품 가능 248벌. 전체 승인 합계로 사이즈별 부족을 상쇄하지 않는다. 예비 재단 20세트는 완제품도 가용 재고도 아니다.',
    regulations: '작업자 평가·임금·근무시간은 이번 진단의 기본 입력이 아니다. 고객 사양은 컨설턴트나 개발자가 임의 변경하지 않는다. 변경 승인 범위·비용 책임은 수주 담당이 원문으로 확인한다.',
  },
  {
    key: 'bread-labeling', name: '빵 제조 — 표시·출하 적합성', industry: '빵 제조(식품)', task_name: '승인된 출하 가용량 확인', unit: '개',
    item_label: '포장 완제품', group_label: '표시 구분', start_label: '생산 기록', start_owner: 'manager', request_label: '주문',
    requirements: [
      { key: 'QC', label: '검사 합격', source: '검사·격리 기록', owner: 'reviewer' },
      { key: 'LABEL', label: '표시 버전 승인본 일치', source: '포장 설비 기록·롤 교체 기록', owner: 'it' },
      { key: 'RELEASE', label: '상자 매핑 확인·품질 책임자 출하 해제', source: '상자 스캔·해제 승인 기록', owner: 'sec' },
    ],
    role_labels: { manager: '생산 책임자', reviewer: '검사 담당', it: '포장 설비 담당', sec: '품질 책임자', exec: '영업 책임자', hr: '자재·포장 담당', field: '창고 담당' },
    trap: '표시 버전 확인 ≠ 안전·검사 승인. 합계 일치(840+320=1,160)는 상자별 식별이나 표시 적합성을 증명하지 않는다. 주문이 있다고 보류 재고를 가용으로 계산하지 않는다.',
    regulations: '라벨 V3의 법적 적합성은 표시 승인 기록과 품질 책임자의 검토 없이 자동 판정하지 않는다. 식품 표시·안전 규정은 해당 전문가가 확인한다. 작업자 개인정보는 훈련 데이터에서 제외한다.',
  },
];

// ───────────────────────── 학원 ─────────────────────────
function seedAcademy(db) {
  const { eid, items, adapter } = seedCase(db, {
    adapter: 'academy-renewal', request_code: '13', task_code: 'AC-047', title: '(가상) 초등 고학년 수학 학원 — 재등록 운영 개선 (제13장)',
    basis: '2026-10-05', seed: 1301, srcPrefix: { _START: 'AC', CONTRACT: 'CT', PAYMENT: 'PY' },
    notes: '교육용 가상 사례. 현 등록생 60명 중 정상 수료 6명을 제외한 다음 기간 재등록 판단 대상 54명 = 확정 42 + 미확정 12. 원고에 요청 번호가 없어 장 번호를 요청 번호로 쓴다.',
    refFn: (x, n) => `P${pad(n)}`,
    groups: [{ code: 'MATH', name: '초등 고학년 수학(다음 기간 재등록 대상)', required: 54, counts: { approved: 42, review: 10, unconfirmed: 2, in_progress: 0, reserve: 0 } }],
    cohortSizes: [14, 14, 13, 13], cohortDates: ['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28'], reserveDates: [],
    reviewKeys: ['CONTRACT', 'PAYMENT'], unconfirmedMissing: ['CONTRACT'], unconfirmedUnmet: ['PAYMENT'],
  });
  // 원장 기록 사유 12명: 일정 5 · 가격 3 · 수업 만족 2 · 미확인 2 (확인된 인과 원인 분포가 아니다)
  // 일정 충돌 이벤트: 미등록자 7명(일정 5 + 가격 2) · 재등록자 5명
  const non = items.filter((x) => x.b === 'review').concat(items.filter((x) => x.b === 'unconfirmed'));
  const reasons = [...Array(5).fill('일정'), ...Array(3).fill('가격'), ...Array(2).fill('수업 만족'), ...Array(2).fill('미확인')];
  const conflictIdx = new Set([0, 1, 2, 3, 4, 5, 6]);
  const upd = db.prepare(`UPDATE evidence SET note=? WHERE item_id=? AND requirement_key='CONTRACT'`);
  non.forEach((x, i) => upd.run(`원장 기록 사유: ${reasons[i]}${conflictIdx.has(i) ? ' · 일정 충돌 이벤트 관찰' : ''} (확인된 인과 원인 아님)`, x.id));
  items.filter((x) => x.b === 'approved').slice(0, 5).forEach((x) => upd.run('재등록 확정 · 일정 충돌 이벤트 관찰', x.id));
  const conflicted = non.filter((_, i) => conflictIdx.has(i));

  addHypotheses(db, eid, [
    { code: 'H1', statement: '시간표 충돌과 대안 부족이 재등록 결정에 기여했다', support: '변경 전후 시간표, 제안·거절 시각', disconfirm: '같은 시간표라도 재등록한 학생이 있다', q: '대안 시간대를 실제 제시했나?' },
    { code: 'H2', statement: '출결 입력이 누락됐다', support: '강사 수기 출석부, 입실 기록', disconfirm: '수업 취소·대체 수업 기록', q: '원본과 정정 이력을 찾을 수 있나?' },
    { code: 'H3', statement: '수강료·교재비 부담이 있었다', support: '가격 고지·문의 코드', disconfirm: '가격과 무관한 명시적 사유', q: '수강료가 바뀐 시점은?' },
    { code: 'H4', statement: '과정 만족·학습 목표가 달라졌다', support: '상담 요청·수업 피드백', disconfirm: '정상 수료 또는 타 과정 이동', q: '민감한 평가 내용을 요구할 필요가 있나?' },
  ]);
  const stop = '정원 초과·수업 질 저하·오발송·권한 오류 시 중단';
  addIntervention(db, eid, items, { code: 'A0', kind: 'smallest', title: '미확정 대상의 상태 확인과 가능한 일정 대안을 정해 기록', description: '첫 제한 시험 후보. 기록 개선의 승인과 가격·품질·고객 응대 변경의 승인을 구분한다.', roles: ['exec'], stop, recovery: '기존 재등록 안내 절차로 복귀' });
  addIntervention(db, eid, items, {
    code: 'A1', kind: 'alt1', title: '일정 충돌이 기록된 재등록 대상에게 주 1회 운영 가능한 보강·대체 수업 선택지를 안내', description: '새 반을 무작정 만들거나 자동 할인 메시지를 보내지 않는다. 강사의 실제 가용 시간과 기존 학생의 수업 질을 먼저 확인한다. 응답 없으면 과잉 연락 중지.',
    bucket: 'review', task: 'CONTRACT', targets: conflicted.filter((x) => x.b === 'review'), roles: ['exec', 'manager'],
    cost: { lines: [{ label: '강사 추가 시간', qty: 1, amount: 240000 }, { label: '절차 정리', qty: 1, amount: 120000 }, { label: '안내 업무', qty: 1, amount: 40000 }], note: '시험 운영비 400,000원(가상). 확정 4명 증가의 비교상 금액 640,000원을 빼면 240,000원이라는 계산은 시뮬레이션일 뿐 사업 성과가 아니다.' },
    stop, recovery: '잘못 승인한 안내의 영향 범위를 확인하고 원래 운영 절차로 복귀',
  });
  const four = new Set(conflicted.slice(0, 4).map((x) => x.id));
  addScenario(db, eid, items, '가상 비교: 일정 충돌 7명 중 4명 재등록 확정 (42 → 46, 85.19%)',
    '교육용 가상 비교. 다른 학생군·기간·강사·시험 일정이므로 이 차이를 조치 효과로 단정하지 않는다(원고: 7.41%포인트 차이는 관찰값).',
    (x) => (conflicted.some((c) => c.id === x.id) ? (four.has(x.id) ? 'resolve' : 'hold') : null));
  addGenericTools(db, eid, adapter, { ref_example: 'P001', group_example: '초등 고학년 수학' });
  return eid;
}

// ───────────────────────── 의류 소공인 ─────────────────────────
// 사이즈별 최초 상태(원고 표): 주문 / 승인 / R2 판단 / 측정 미확인 / 봉제 재공 / 예비 재단
const SIZES = [
  { code: 'S', name: 'S', required: 80, counts: { approved: 52, review: 18, unconfirmed: 6, in_progress: 4, reserve: 4 } },
  { code: 'M', name: 'M', required: 160, counts: { approved: 100, review: 36, unconfirmed: 12, in_progress: 12, reserve: 8 } },
  { code: 'L', name: 'L', required: 120, counts: { approved: 72, review: 24, unconfirmed: 8, in_progress: 16, reserve: 6 } },
  { code: 'XL', name: 'XL', required: 40, counts: { approved: 24, review: 6, unconfirmed: 2, in_progress: 8, reserve: 2 } },
];
// 추가 처리 후 사이즈별 최종 보류(원고: S6·M16·L12·XL2 = 36). 칸별 배분은 합성 가정이다.
const HOLD = {
  S: { review_path: 3, review_retest: 1, unconfirmed: 1, in_progress: 1 },
  M: { review_path: 11, review_retest: 3, unconfirmed: 1, in_progress: 1 },
  L: { review_path: 10, review_retest: 0, unconfirmed: 1, in_progress: 1 },
  XL: { review_path: 0, review_retest: 0, unconfirmed: 1, in_progress: 1 },
};
function seedApparel(db) {
  const days = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'];
  const { eid, items, adapter } = seedCase(db, {
    adapter: 'apparel-order', request_code: 'O-601', task_code: 'AP-047', title: '(가상) 주문형 셔츠 소공인 — 사양 변경·사이즈별 납품 (제18장)',
    basis: '2026-10-05', seed: 1801, shuffle: true, srcPrefix: { _START: 'A047', SPEC: 'SP', MEASURE: 'QM', ALLOC: 'AL' },
    notes: '교육용 가상 사례. 주문 O-601 400벌(S80·M160·L120·XL40), 작업 A-047 재단 세트 420 = 봉제 착수 400 + 예비 20. 최초 승인 248 · R2 재작업 판단 84 · 측정 미확인 28 · 봉제 재공 40.',
    refFn: (x, n, gi) => `A047-${x.g}-${pad(gi)}`,
    groups: SIZES, cohortSizes: [80, 80, 80, 80, 80], cohortDates: days, reserveDates: [],
    reviewKeys: ['SPEC'], unconfirmedMissing: ['MEASURE'], pendingKeys: ['MEASURE'],
    noteFn: (x, k, v) => (x.b === 'review' && k === 'SPEC' ? 'R2 적용 확인 — 재작업 판단 대상(원인은 H1~H5 미판정)' : x.b === 'unconfirmed' && k === 'MEASURE' ? '측정 기록 미확인(값·기준·담당자 확인 필요)' : x.b === 'in_progress' && k === 'MEASURE' ? '봉제 재공 — 검사 전' : null),
  });
  // 칸 안 순서(gi)로 최종 보류 대상을 정한다
  const holdOf = (x) => {
    const h = HOLD[x.g];
    if (x.b === 'review') return x.gi < h.review_path ? 'path' : x.gi < h.review_path + h.review_retest ? 'retest' : null;
    if (x.b === 'unconfirmed') return x.gi < h.unconfirmed ? 'hold' : null;
    if (x.b === 'in_progress') return x.gi < h.in_progress ? 'hold' : null;
    return null;
  };
  const pathHeld = new Set(items.filter((x) => holdOf(x) === 'path').map((x) => x.id));

  addHypotheses(db, eid, [
    { code: 'H1', statement: '사양 변경 전환 절차 — 전달·응답은 있으나 준비 확인이 없거나 적용 범위가 불명확했다', support: '승인 범위·확인·착수 기록(전달 09:35, 응답 10:05, R2 부착 09:40~10:20)', disconfirm: '실제 준비 확인이 있으면 재검토', q: '파일 전달·응답 이후 작업대·견본·진행 묶음의 실제 적용을 확인했나?' },
    { code: 'H2', statement: '구견본(R2)이 작업대·진행 묶음에 잔류했다', support: '당시 작업대·묶음·작업 기록', disconfirm: 'R3 기준으로 작업한 증거가 있으면 다른 가능성 확인', q: '각 묶음의 사용 사양·견본·착수·전환 시각은?' },
    { code: 'H3', statement: '측정 기준(기준점·단위·방법) 불일치로 28벌을 판정하지 못했다', support: '검사자별 기준점·단위 차이', disconfirm: '측정 원본·방법·기기를 맞춰 재측정', q: '기준점(앞목점→주머니 상단)·단위(mm)가 같은가?' },
    { code: 'H4', statement: '설비·치구·작업 조건에서 실제 봉제 위치 오차가 발생했다', support: 'R3 준비 상태에서도 위치 오차 반복', disconfirm: '구사양 적용이 주원인이면 분리', q: '동일 기준에서도 오차가 있나? 공정·견본·측정·시험 확인' },
    { code: 'H5', statement: '상태·사이즈 기록의 지연 또는 잘못된 연결이다', support: '실물 상태와 원천·화면 차이', disconfirm: '원천 자체도 불명확하면 설명 부족', q: '묶음·검사·수신 처리 기록으로 ID·수신·정정을 통제했나?' },
  ]);
  const stop = '잘못된 사양 허용·연계 실패 시 수동 확인으로 복귀';
  addIntervention(db, eid, items, { code: 'A0', kind: 'smallest', title: '사양 변경을 작업 묶음에 연결하고, 주머니 부착 착수 전에 해당 공정의 준비 확인을 기록', description: '첫 현장 시험 조치. 제품 1종·공정 1개·상태 변경 기록에 좁혀 적용한다. 파일을 읽었다는 확인은 준비 조건 하나이며 실제 견본·사양·진행 묶음까지 확인해야 착수가 허용된다.', roles: ['exec', 'manager'], stop, recovery: '수동 확인(기존 절차)으로 복귀, 적용한 규칙 버전과 기간은 보존' });
  addIntervention(db, eid, items, {
    code: 'A1', kind: 'alt1', title: '재작업 경로 승인 — 84벌 중 60벌만 승인(24벌은 경로 판단 보류)', description: '재작업 60벌 승인과 56벌 검사 통과는 다른 업무 기록이다. 재작업 지시를 받은 60벌을 바로 납품 가용으로 만들지 않는다. 정상품과 재작업품의 신규 생산량을 합산하지 않는다.',
    bucket: 'review', task: 'SPEC', targets: items.filter((x) => x.b === 'review' && !pathHeld.has(x.id)), roles: ['manager', 'sec'],
    cost: { lines: [{ label: '부자재 60벌 × 600원', qty: 60, amount: 36000 }, { label: '손질 5인시 × 18,000원', qty: 1, hours: 5, rate: 18000 }, { label: '재측정·검사 2인시 × 18,000원', qty: 1, hours: 2, rate: 18000 }], note: '재작업 모의비용 162,000원(가상). 승인 56벌당 약 2,893원이라는 지표는 60벌의 작업비를 56벌 통과 결과로 나눈 가정이며 기존 제조원가를 포함하지 않는다.' },
    stop, recovery: '재작업 전 상태 이력을 보존하고 재검사 승인 전까지 납품 가용에 넣지 않는다',
  });
  addIntervention(db, eid, items, { code: 'A2', kind: 'alt2', title: '측정 미확인 28벌 — 기준을 맞춘 재측정', description: '재측정 2인시는 A1 비용에 포함되어 있다. 재측정에서 24벌이 승인되는 분기는 초기 미확정의 처리 결과이지 H3가 모든 28벌의 원인이었다는 증명이 아니다.', bucket: 'unconfirmed', task: 'MEASURE', roles: ['sec'], cost: { lines: [], note: '재측정·검사 2인시는 A1 비용에 포함(원고)' }, stop, recovery: '측정값 원본·방법·기기를 보존하고 판정은 보류로 복귀' });
  addIntervention(db, eid, items, { code: 'A3', kind: 'alt2', title: '봉제 재공 40벌 — 완료·검사 확인', description: '이미 400벌에 포함된 재공 40벌과 예비 20세트를 중복 추가하지 않는다.', bucket: 'in_progress', task: 'MEASURE', roles: ['manager', 'sec'], cost: { lines: [], note: '원고에 비용 수치 없음 — 현장에서 산정' }, stop, recovery: '재공 상태로 복귀' });
  addIntervention(db, eid, items, { code: 'A4', kind: 'alt3', title: '예비 재단 20세트 추가 생산 검토(사이즈 S4·M8·L6·XL2)', description: '예비 세트의 사이즈·원단·공정능력·고객 기준을 확인한 뒤 기존 부족을 어느 정도 해소하는지 계산한다. 한 사이즈의 예비를 다른 사이즈로 전환할 수 있다고 가정하지 않는다.', bucket: 'reserve', task: '_START', roles: ['manager', 'exec'], cost: { lines: [{ label: '추가 봉제·마무리 변동비 20벌 × 3,500원', qty: 20, amount: 70000 }, { label: '세팅·검사', qty: 1, amount: 40000 }], note: '가상 비용 110,000원(원고 가정)' }, stop, recovery: '예비 재단 보관 상태로 복귀' });

  addScenario(db, eid, items, '추가 처리 후: 승인 364벌 · 최종 보류 36벌 (248+56+24+36)',
    '교육용 가상 분기. 재작업 84 중 60 경로 승인(24 보류) → 56 재검사 승인(4 보류), 측정 미확인 28 → 24 승인(4 보류), 재공 40 → 36 승인(4 보류). 사이즈별 보류 S6·M16·L12·XL2. 칸별 배분은 합성 가정이다. 실제 납품은 고객의 부분 납품 승인과 출하·수령 기록으로 별도 확인한다.',
    (x) => (x.b === 'reserve' || x.b === 'approved' ? null : holdOf(x) ? 'hold' : 'resolve'));
  addScenario(db, eid, items, '예비 재단 포함: 조건부 승인 384벌 · 잔여 부족 16벌 (S2·M8·L6·XL0)',
    '예비 20세트(S4·M8·L6·XL2)가 모두 적합하게 생산·검사·승인된다는 가정. 예비세트가 최종 36벌 부족을 모두 해결하지 못한다.',
    (x) => (x.b === 'approved' ? null : x.b === 'reserve' ? 'resolve' : holdOf(x) ? 'hold' : 'resolve'));
  addGenericTools(db, eid, adapter, { ref_example: 'A047-M-012', group_example: 'S·M·L·XL' });
  return eid;
}

// ───────────────────────── 빵 제조 ─────────────────────────
function seedBread(db) {
  const { eid, items, adapter } = seedCase(db, {
    adapter: 'bread-labeling', request_code: 'O-301', task_code: 'BR-047', title: '(가상) 크림빵 제조 — 표시·출하 적합성 (제16장, 배치 B-047)',
    basis: '2026-10-05', shuffle: false, srcPrefix: { _START: 'PD', QC: 'Q', LABEL: 'P', RELEASE: 'RL' },
    notes: '교육용 가상 사례. 생산 1,200개 = 포장 대상 1,160 + 검사 불합격 격리 40. 포장 1,160 = 표시 V4 840 + 구버전 V3 320. 상자 스캔이 불완전해 1,160개 전체 출하 보류(가용 0). 주문 O-301 700개. 원고의 상자 환산 58상자(상자당 20개)와 상자 ID는 원본이 없어 대상으로 만들지 않았다.',
    refFn: (x, n, gi) => `B047-${x.g}-${pad(gi)}`,
    groups: [
      { code: 'V4', name: '표시 V4 기록분 (주문 O-301 700개의 공급원)', required: 700, counts: { approved: 0, review: 840, unconfirmed: 0, in_progress: 0, reserve: 0 } },
      { code: 'V3', name: '구버전 V3 기록분 (상자 위치 미확정)', required: 0, counts: { approved: 0, review: 0, unconfirmed: 320, in_progress: 0, reserve: 0 } },
      { code: 'Q', name: '검사 불합격 격리분 (포장 전)', required: 0, counts: { approved: 0, review: 0, unconfirmed: 0, in_progress: 0, reserve: 40 } },
    ],
    cohortSizes: [1160], cohortDates: ['2026-09-30'], reserveDates: [],
    reviewKeys: ['RELEASE'], unconfirmedMissing: ['LABEL'], unconfirmedUnmet: ['RELEASE'],
    noteFn: (x, k, v) => (x.b === 'review' && k === 'RELEASE' ? '상자 매핑 미확정 · 해제 미승인(전체 보류)' : x.b === 'unconfirmed' && k === 'LABEL' ? '구버전 V3 사용 기록 — 상자 위치·적합성 근거 불명' : null),
  });
  addHypotheses(db, eid, [
    { code: 'A', statement: '구버전 라벨 롤이 승인품 보관대에 혼입됐다', support: 'L3가 승인 보관대에 놓인 시점 기록과 교체 실물(입고·반납·보관대 사진·롤 바코드)', disconfirm: '해당 시각 보관대에 L3가 없고 다른 위치에서 정상 반출', q: '혼입이 밝혀져도 스캔 결측 원인까지 입증된 것은 아니다 — 상자 매핑은?' },
    { code: 'B', statement: '승인 버전은 바뀌었지만 포장 설비 설정이 갱신되지 않았다', support: 'M-V4 유효 이후에도 설비가 V3를 허용한 설정·실행 처리 기록', disconfirm: '설비는 V4를 요구했고 작업자가 별도로 수동 인쇄', q: '승인 문서 시각과 설비 변경 처리 기록은 어긋나는가?' },
    { code: 'C', statement: '롤 교체 기록 또는 스캔 인터페이스의 시각·ID 연결이 틀렸다', support: '원본은 V4인데 인터페이스가 다른 롤이나 시각에 연결', disconfirm: '상자 실물과 장비 로컬 기록 모두 V3 사용을 확인', q: '설비 원본·수기 교대 기록·실물 상자를 대조했나? 장비 처리 기록이 없으면 보류' },
  ]);
  const stop = '무단 출하 해제 또는 근거 손실 발견 시 신규 자동 처리를 중단';
  addIntervention(db, eid, items, { code: 'A0', kind: 'smallest', title: '포장 시작·롤 교체 때 승인 버전 스캔 확인을 의무화하고, 누락되면 완료 신호가 출하 가용으로 이어지지 않게 한다', description: '한 설비의 크림빵 포장 개시·교체 업무 기록에 한정한 시험. 품질 책임자가 적합성·재표시·해제를, 생산 책임자가 작업 절차를, 영업 책임자가 납기 안내를 승인한다.', roles: ['sec', 'manager', 'it'], stop, recovery: '품질 책임자 승인 하에 기존 수기 출하 확인 절차로 복귀(데이터 삭제 아님, 규칙 버전·기간 보존)' });
  addIntervention(db, eid, items, { code: 'A1', kind: 'alt1', title: '분기 A: V4 840개 부분 해제 (상자 실사 후 품질 책임자 승인)', description: '독립 실사로 V4 840개(상자 C001~C042)를 식별하고 품질 책임자가 승인한 시각 이후에만 가용으로 바꾼다. 16:40 해제를 15:30 과거 가용에 소급하지 않는다. 가용 840 − 주문 700 = 잔여 140.', bucket: 'review', task: 'RELEASE', roles: ['sec'], cost: { lines: [], note: '비용 단가가 없으므로 금액을 꾸며 넣지 않는다 — 재표시 시간당 인건비 C·검수 시간 T·추가 운송비 D·폐기 원가 U는 비워 둔다(원고)' }, stop, recovery: '해제 취소 시 전체 보류(가용 0)로 복귀' });
  addIntervention(db, eid, items, { code: 'A2', kind: 'alt2', title: 'V3 320개: 재표시 가능성 검토 (품질 책임자가 먼저 검토)', description: '재표시 가능성은 비용 계산으로 결정하지 않는다. 폐기 분기의 관리상 원가는 320 × 750 = 240,000원(가정).', bucket: 'unconfirmed', task: 'LABEL', roles: ['sec'], cost: { lines: [{ label: '단위 포장·라벨 320개 × 65원', qty: 320, amount: 20800 }, { label: '작업 2시간 + 검수 1시간 × 18,000원', qty: 1, hours: 3, rate: 18000 }], note: '재표시 비용 74,800원(가정). 폐기 분기 240,000원과 비교하되 품질 승인 없이 비용이 낮다는 이유로 해제를 추천하지 않는다.' }, stop, recovery: '재표시 전 격리 상태로 복귀' });
  const v4 = new Set(items.filter((x) => x.g === 'V4').map((x) => x.id));
  addScenario(db, eid, items, '분기 A: V4 840개 해제 승인 → 가용 840 · 주문 700 배정 후 잔여 140 (V3 320은 별도 격리)',
    '교육용 가정. 독립 실사에서 C001~C042 42상자가 V4 840개, C043~C058 16상자가 V3 320개로 확인되고 품질 책임자가 승인한다. 실제 품질 판정이 아니다.',
    (x) => (v4.has(x.id) ? 'resolve' : null));
  addScenario(db, eid, items, '분기 B: 상자 매핑 근거 불충분 → 가용 0개 · 보류 1,160개 유지', '교육용 가정. 변화 없음.', () => null);
  addGenericTools(db, eid, adapter, { ref_example: 'B047-V4-001', group_example: 'V4·V3·격리' });
  return eid;
}

module.exports = { ADAPTERS, seedAcademy, seedApparel, seedBread };
