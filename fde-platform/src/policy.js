'use strict';
/**
 * 역할·권한 정책.
 * 원칙(교안 모듈 D/E): 자료 확인, 개선 승인, 시스템 변경의 책임을 한 사람에게 모두 몰아주지 않는다.
 *  - 제안은 컨설턴트/플랫폼, 승인은 업무 책임자, 실행은 업무 시스템.
 *  - 컨설턴트·FDE·운영자(admin)는 조치를 승인하지 못한다 (권한 밖의 승인 금지).
 */
const ROLES = {
  admin: { label: '강사·운영자', desc: '과정·사용자·데모 초기화 관리. 업무 승인 권한은 없다.' },
  consultant: { label: '컨설턴트', desc: '문제 정의·원인 후보·조치 제안·서식 작성. 승인은 하지 않는다.' },
  fde: { label: 'FDE(현장 실행형 엔지니어)', desc: '자료 연결·화면·시험 구현. 전 구간 로그와 같은 결과 확인 검사.' },
  exec: { label: '경영진', desc: '인력 요구와 배치 범위 결정.' },
  hr: { label: '인사 담당', desc: '입사·서류·배치 근거 자료.' },
  manager: { label: '현업 관리자', desc: '직무 교육과 업무 준비 확인.' },
  it: { label: '정보 담당', desc: '시스템 접근권한(계정·권한 처리 기록).' },
  sec: { label: '노무·보안 담당', desc: '개인정보·근로 조건 확인.' },
  field: { label: '현장 담당자', desc: '본인 입력 근거 자료 등록(후보로 등록, 확인은 근거 자료 관리자).' },
  reviewer: { label: '검토자', desc: '예외·보류 목록 확인, 근거 부족 시 반려.' },
  learner: { label: '교육생', desc: '교안·실습·평가. 업무 데이터는 읽기만 가능.' },
};

/** 어느 역할이 어느 요건의 근거를 확정할 수 있는가는 업종 어댑터가 정한다. 여기서는 일반 규칙만. */
const STATIC = {
  'case.create': ['consultant', 'admin'],
  'adapter.create': ['consultant', 'admin'],
  'case.reset': ['admin'],
  'ingest': ['fde', 'consultant', 'hr', 'manager', 'it', 'field'],
  'assignment.change': ['exec', 'hr'],
  'hold.open': ['manager', 'it', 'hr', 'reviewer'],
  'hold.release': ['manager', 'it', 'hr', 'exec'],
  'rereview.resolve': ['reviewer', 'manager', 'it', 'hr', 'exec'],
  'reject.resolve': ['fde', 'hr', 'manager', 'it'],
  'intervention.propose': ['consultant'],
  'intervention.submit': ['consultant'],
  'intervention.stop': ['exec', 'sec', 'reviewer', 'manager', 'it', 'hr'],
  'intervention.start': ['manager', 'it', 'hr', 'field'],
  'intervention.close': ['consultant', 'manager', 'it', 'hr'],
  'sync.request': ['fde', 'it'],
  'sync.approve': ['it', 'exec'],
  'sync.stage': ['it', 'exec'],
  'sync.send': ['fde', 'it'],
  'sync.reconcile': ['it', 'hr', 'manager'],
  'hypothesis.edit': ['consultant', 'reviewer', 'fde'],
  'worktool.edit': ['consultant', 'fde', 'field'],
  'trial.update': ['consultant'],
  'dayclose': ['field', 'consultant', 'fde'],
  'tests.run': ['fde', 'consultant', 'admin'],
  'users.manage': ['admin'],
};

const FORM_EDITORS = {
  1: ['consultant'], 2: ['consultant', 'field'], 3: ['consultant', 'fde'],
  4: ['consultant', 'reviewer'], 5: ['consultant'], 6: ['consultant', 'fde'],
};

function can(role, action) {
  const list = STATIC[action];
  return !!list && list.includes(role);
}
function canEditForm(role, no) { return (FORM_EDITORS[no] || []).includes(role); }

/** 요건 근거를 확정할 수 있는 역할(업종 어댑터 기준) */
function evidenceOwner(adapter, requirementKey) {
  if (requirementKey === '_START') return adapter.start_owner;
  const r = adapter.requirements.find((x) => x.key === requirementKey);
  return r ? r.owner : null;
}
function canRegisterEvidence(role, adapter, key) {
  return role === 'field' || role === evidenceOwner(adapter, key);
}
function canConfirmEvidence(role, adapter, key) { return role === evidenceOwner(adapter, key); }

/** 조치 승인: 필수 역할 중 하나여야 하며, 제안자·컨설턴트·FDE·운영자는 불가 */
function canApproveIntervention(role, requiredRoles) {
  if (['consultant', 'fde', 'admin', 'learner'].includes(role)) return false;
  return requiredRoles.includes(role);
}

module.exports = { ROLES, can, canEditForm, evidenceOwner, canRegisterEvidence, canConfirmEvidence, canApproveIntervention, STATIC, FORM_EDITORS };
