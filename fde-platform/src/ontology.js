'use strict';
/** 업무 구조도(온톨로지) 기술서: 업무 항목(Object) · 연결 관계(Link) · 실행 작업(Action) · 권한 · 이력 — 실제 코드의 정책과 같은 출처에서 만든다. */
const policy = require('./policy');

const count = (db, sql, ...a) => db.prepare(sql).get(...a).n;

function describe(db, engId) {
  const c = {
    engagement: 1,
    group: count(db, 'SELECT COUNT(*) n FROM groups WHERE engagement_id=?', engId),
    item: count(db, 'SELECT COUNT(*) n FROM items WHERE engagement_id=?', engId),
    evidence: count(db, 'SELECT COUNT(*) n FROM evidence WHERE engagement_id=?', engId),
    assignment: count(db, 'SELECT COUNT(*) n FROM assignments WHERE engagement_id=?', engId),
    hold: count(db, 'SELECT COUNT(*) n FROM holds WHERE engagement_id=?', engId),
    hypothesis: count(db, 'SELECT COUNT(*) n FROM hypotheses WHERE engagement_id=?', engId),
    intervention: count(db, 'SELECT COUNT(*) n FROM interventions WHERE engagement_id=?', engId),
    approval: count(db, 'SELECT COUNT(*) n FROM approvals WHERE engagement_id=?', engId),
    sync: count(db, 'SELECT COUNT(*) n FROM external_syncs WHERE engagement_id=?', engId),
    audit: count(db, 'SELECT COUNT(*) n FROM audit WHERE engagement_id=?', engId),
  };
  const objects = [
    { key: 'engagement', label: '컨설팅 과업', easy: '요청·과업 번호', props: ['request_code', 'task_code', 'basis_date', 'adapter', 'rule_version'], count: c.engagement, layer: 'task' },
    { key: 'group', label: '하위 범주', easy: '부서·품목·라인', props: ['code', 'name', 'required'], count: c.group, layer: 'task' },
    { key: 'item', label: '대상', easy: '사람·작업지시·직원(내부 식별키만)', props: ['ref_key', 'group', 'planned_on'], count: c.item, layer: 'task' },
    { key: 'evidence', label: '근거 자료', easy: '자료 식별번호·발생/기록 시각·상태(후보/확정)', props: ['requirement_key', 'value', 'source_ref', 'occurred_at', 'recorded_at', 'status', 'corrects_id'], count: c.evidence, layer: 'evidence', append_only: true },
    { key: 'assignment', label: '배정', easy: '대상이 어느 범주에 속하는가(활성은 하나)', props: ['item', 'group', 'status'], count: c.assignment, layer: 'task' },
    { key: 'hold', label: '보류', easy: '자동 승인 불가 표시(낙관적 잠금)', props: ['reason', 'status', 'version'], count: c.hold, layer: 'judgement' },
    { key: 'hypothesis', label: '원인 후보', easy: '지지할 증거 + 다른 가능성을 확인할 자료', props: ['code', 'statement', 'support_source', 'disconfirm_source', 'status'], count: c.hypothesis, layer: 'judgement' },
    { key: 'intervention', label: '조치', easy: '대상·권한·비용·중단 조건·복구 경로', props: ['code', 'kind', 'required_roles', 'cost', 'stop_condition', 'recovery_path', 'status'], count: c.intervention, layer: 'action' },
    { key: 'approval', label: '결재', easy: '누가 어떤 역할로 승인·반려·중단했는가', props: ['role', 'username', 'decision', 'created_at'], count: c.approval, layer: 'action', append_only: true },
    { key: 'sync', label: '외부 반영', easy: '플랫폼 결재와 외부 수락은 별도 상태', props: ['platform_status', 'external_status', 'stage', 'idem_key'], count: c.sync, layer: 'action' },
    { key: 'audit', label: '처리 기록', easy: '해시 체인으로 변조 탐지', props: ['ts', 'username', 'role', 'action', 'outcome', 'hash'], count: c.audit, layer: 'record', append_only: true },
  ];
  const links = [
    { from: 'engagement', to: 'group', label: '범위(요구 인원)', card: '1:N' },
    { from: 'group', to: 'item', label: '배치', card: '1:N', temporal: true },
    { from: 'item', to: 'evidence', label: '근거 보유', card: '1:N', temporal: true },
    { from: 'item', to: 'assignment', label: '배정 이력', card: '1:N', temporal: true },
    { from: 'item', to: 'hold', label: '보류', card: '1:N' },
    { from: 'hypothesis', to: 'item', label: '설명 대상(검토·미확인)', card: 'N:M' },
    { from: 'intervention', to: 'item', label: '조치 대상', card: 'N:M' },
    { from: 'intervention', to: 'approval', label: '결재', card: '1:N' },
    { from: 'intervention', to: 'evidence', label: '결과가 새 근거를 만든다', card: '1:N' },
    { from: 'intervention', to: 'sync', label: '외부 반영 요청', card: '1:N' },
    { from: 'intervention', to: 'audit', label: '모든 실행 작업이 기록된다', card: '1:N' },
  ];
  const A = (key, label, roles, pre, post, never) => ({ key, label, roles, pre, post, never });
  const owners = 'ㅤ';
  const actions = [
    A('evidence.register', '근거 등록', '요건 소유 역할(확정) · 현장 담당자(후보)', ['요건·단위·값이 올바르다', 'AI/OCR 값은 항상 후보'], ['근거가 추가된다(수정·삭제 없음)', '판정은 엔진이 다시 계산'], ['자료 식별번호 없는 verified 를 준비로 인정'],),
    A('evidence.confirm', '후보 확정', '요건 소유 역할만', ['후보 상태'], ['후보 → 확정'], ['컨설턴트·FDE·검토자의 확정']),
    A('evidence.reject', '후보 반려', '요건 소유 역할 · 검토자', ['반려 사유 필수'], ['후보 → 반려'], []),
    A('ingest', '일괄 수집', policy.STATIC.ingest.map((r) => policy.ROLES[r].label).join('·'), ['같은 과업 ID 재전송은 한 번만', '단위·범주 코드 오류는 거부 큐'], ['근거 추가 / 새 대상 생성'], ['자동 매핑']),
    A('assignment.change', '배정 변경', policy.STATIC['assignment.change'].map((r) => policy.ROLES[r].label).join('·'), ['사유 필수', '기대 배정 ID 일치(동시 배정 한쪽만 성공)'], ['이전 배정 해제 + 새 배정'], ['권한 없는 대체']),
    A('hold.open', '보류 열기', policy.STATIC['hold.open'].map((r) => policy.ROLES[r].label).join('·'), ['열린 보류가 없다'], ['대상이 검토로 이동'], []),
    A('hold.release', '보류 해제', policy.STATIC['hold.release'].map((r) => policy.ROLES[r].label).join('·'), ['기대 버전 일치', '사유 필수'], ['대상 재판정'], ['동시 해제 두 건 모두 성공']),
    A('intervention.propose', '조치 제안', '컨설턴트', ['승인 역할에 컨설턴트·FDE·운영자 불가'], ['DRAFT'], ['스스로 승인']),
    A('intervention.submit', '승인서 제출', '컨설턴트', ['대상·권한·비용·중단 조건·복구 경로가 모두 있다'], ['DRAFT → SUBMITTED'], ['빈칸 있는 제출']),
    A('intervention.approve', '결재(승인)', '조치의 필수 역할(제안자 제외)', ['SUBMITTED', '역할별 1회'], ['모든 필수 역할 승인 시 APPROVED'], ['수량 증가(승인 ≠ 완료)']),
    A('intervention.start', '실행 시작', policy.STATIC['intervention.start'].map((r) => policy.ROLES[r].label).join('·'), ['APPROVED', '중단 기준 미초과'], ['IN_EXECUTION'], ['결재 전 실행']),
    A('intervention.outcome', '결과 기록', '재확인할 요건의 소유 역할', ['IN_EXECUTION', 'verified 는 자료 식별번호 필수'], ['새 근거 생성 → 원래 대상의 상태 변경', '해결 안 되면 보류'], ['근거 없는 완료']),
    A('intervention.close', '조치 종료', '컨설턴트·소유 역할', ['모든 대상에 결과 기록'], ['CLOSED'], ['빈칸 있는 종료']),
    A('sync.request', '외부 반영 요청', '정보 담당 · FDE', ['읽기 단계 이후', '제한된 실운영은 건수 제한'], ['요청'], []),
    A('sync.approve', '수동 승인', '정보 담당 · 경영진(요청자 제외)', ['요청됨'], ['플랫폼 결재(external 은 별도)'], []),
    A('sync.send', '외부로 전송', '정보 담당 · FDE', ['플랫폼 결재 완료', '시뮬레이션 단계는 모의만'], ['external: accepted | failed'], ['중복 전송(같은 idem_key 1회)']),
    A('form.save', '서식 저장', '서식별 작성자', ['완료 표시는 필수 7칸 + 서식별 칸 모두 작성'], ['버전 증가·이력 보존'], ['빈칸 완료 / 근거 없는 0·합격']),
    A('dayclose', '일 마감', '현장 담당자·컨설턴트·FDE', ['정합성(잔차 0)'], ['스냅샷 저장'], ['덮어쓰기(정정은 새 기록)']),
  ];
  const layers = [
    { n: 1, key: 'source', name: '원천 수집층', desc: '정원 승인서·입사·교육·계정 로그를 읽기 전용으로 수집', where: 'ingest · 거부 큐' },
    { n: 2, key: 'normalize', name: '자료 형식 통일·근거 자료 보존층', desc: '원천 ID·파일 버전·시각·단위를 함께 저장. OCR·AI 추출은 후보', where: 'evidence(추가 전용) · 변환 대조표' },
    { n: 3, key: 'ontology', name: '업무 항목·관계·과업층', desc: '요구·사람·증거·판정을 연결. 과거는 변경 불가 기록으로', where: 'engine.snapshot · 이중 시간축' },
    { n: 4, key: 'screen', name: '검토·실행 작업 화면', desc: '첫 줄에 대상·승인·검토·미확인·부족. 클릭하면 근거 자료·담당·다음 조치', where: 'public/ 화면' },
    { n: 5, key: 'writeback', name: '외부 반영·처리 기록', desc: '쓰기 연계는 별도 수용 시험. 무권한 실행 작업은 거부하고 로그', where: 'external_syncs · audit' },
  ];
  return { objects, links, actions, layers, rules: [
    '한 대상은 한 칸에만 들어간다(상태 배타성)',
    '근거가 없으면 0이나 합격이 아니라 미확인',
    '전달 ≠ 수신 ≠ 적용 ≠ 승인',
    '조치 경로 승인은 수량을 올리지 않는다 — 확인된 근거만 수량을 바꾼다',
    '발생 시각과 기록 시각을 분리하고, 과거 보고서는 후행 입력으로 덮어쓰지 않는다',
    '제안은 플랫폼, 승인은 담당자, 실행은 업무 시스템',
  ] };
}

module.exports = { describe };
