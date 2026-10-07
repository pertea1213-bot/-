'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const SCHEMA = `
-- ─────────────── ② 업종 어댑터 (단위·상태 정의·근거 자료·책임자·규정) ───────────────
CREATE TABLE IF NOT EXISTS adapters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  industry TEXT NOT NULL,
  task_name TEXT NOT NULL,
  unit TEXT NOT NULL,                 -- 명·건·종·실…
  item_label TEXT NOT NULL,           -- 대상 이름 (사람, 작업지시…)
  group_label TEXT NOT NULL,          -- 하위 범주 이름 (부서, 품목…)
  start_label TEXT NOT NULL,          -- 착수의 업종 언어 (입사 확인…)
  start_owner TEXT NOT NULL,          -- 착수 근거를 쥔 역할
  requirements TEXT NOT NULL,         -- JSON [{key,label,source,owner}]  '준비'의 3~5요건
  role_labels TEXT,                   -- JSON {역할키: 업종에서 쓰는 이름}
  request_label TEXT,                 -- 요청 번호의 이름(인력 준비요청·주문 등)
  trap TEXT,                          -- 완료의 함정
  regulations TEXT,                   -- 규정·민감정보
  created_at TEXT NOT NULL
);

-- ─────────────── ③ 과업 데이터 ───────────────
CREATE TABLE IF NOT EXISTS engagements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_code TEXT NOT NULL,         -- H-701
  task_code TEXT NOT NULL,            -- HR-047
  title TEXT NOT NULL,
  adapter_id INTEGER NOT NULL REFERENCES adapters(id),
  basis_date TEXT NOT NULL,           -- 기준 시점 (날짜)
  synthetic INTEGER NOT NULL DEFAULT 1,
  sync_stage TEXT NOT NULL DEFAULT 'read',   -- read|simulation|manual|limited_live
  protection_rules TEXT NOT NULL DEFAULT '{}',
  notes TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(request_code, task_code)
);

-- 판정 규칙 버전: 기준 시점에 유효한 규칙으로 재평가한다
CREATE TABLE IF NOT EXISTS rule_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  engagement_id INTEGER NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  effective_from TEXT NOT NULL,
  required_keys TEXT NOT NULL,        -- JSON ['TRAINING','ACCOUNT','MANAGER']
  note TEXT,
  UNIQUE(engagement_id, version)
);

CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  engagement_id INTEGER NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  required INTEGER NOT NULL,
  UNIQUE(engagement_id, code)
);

-- 대상(업무 항목). 실명 대신 내부 식별번호만 저장한다 (개인정보 최소 수집)
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  engagement_id INTEGER NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  ref_key TEXT NOT NULL,
  group_id INTEGER REFERENCES groups(id),
  planned_on TEXT,                    -- 예정일 (착수 전 대상의 일정)
  created_at TEXT NOT NULL,
  UNIQUE(engagement_id, ref_key)
);

-- 근거 자료 (추가 전용: UPDATE/DELETE 하지 않고 정정 기록을 더한다)
-- requirement_key '_START' = 착수(입사 확인) 근거
CREATE TABLE IF NOT EXISTS evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  engagement_id INTEGER NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  requirement_key TEXT NOT NULL,
  value TEXT NOT NULL CHECK (value IN ('verified','unmet','pending','missing','delivered')),
  source_ref TEXT,                    -- 자료 식별번호 (없으면 판정 근거가 되지 못함)
  source_version TEXT,
  unit TEXT,
  occurred_at TEXT NOT NULL,          -- 현실에서 일어난 때 (발생 시각)
  recorded_at TEXT NOT NULL,          -- 시스템에 기록된 때 (기록 시각)
  recorded_by TEXT NOT NULL,
  origin TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual','import','ocr_ai')),
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('candidate','confirmed','rejected')),
  confirmed_at TEXT,
  confirmed_by TEXT,
  note TEXT,
  corrects_id INTEGER REFERENCES evidence(id),
  idem_key TEXT
);
CREATE INDEX IF NOT EXISTS idx_evidence_item ON evidence(item_id, requirement_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_evidence_idem ON evidence(engagement_id, idem_key) WHERE idem_key IS NOT NULL;

-- 배정: 한 대상은 한 곳에만 (활성 배정은 하나)
CREATE TABLE IF NOT EXISTS assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  engagement_id INTEGER NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES groups(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','released')),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_assign_active ON assignments(item_id) WHERE status='active';

-- 보류 (낙관적 잠금: 동시에 해제하면 한쪽만 성공)
CREATE TABLE IF NOT EXISTS holds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  engagement_id INTEGER NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','released')),
  version INTEGER NOT NULL DEFAULT 1,
  opened_at TEXT NOT NULL,
  opened_by TEXT NOT NULL,
  released_at TEXT,
  released_by TEXT,
  release_reason TEXT
);
CREATE TABLE IF NOT EXISTS re_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  engagement_id INTEGER NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);

-- 거부 큐: 단위·부서 코드가 틀린 행은 자동 매핑하지 않고 사람이 확인한다
CREATE TABLE IF NOT EXISTS reject_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  engagement_id INTEGER NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  raw TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);

-- ─────────────── 원인 후보 / 조치 / 승인 / 외부 반영 ───────────────
CREATE TABLE IF NOT EXISTS hypotheses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  engagement_id INTEGER NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  statement TEXT NOT NULL,
  support_source TEXT,                -- 지지할 증거
  disconfirm_source TEXT,             -- 다른 가능성을 확인할 자료
  status TEXT NOT NULL DEFAULT 'need_evidence',
  UNIQUE(engagement_id, code)
);
CREATE TABLE IF NOT EXISTS hypothesis_coverage (
  hypothesis_id INTEGER NOT NULL REFERENCES hypotheses(id) ON DELETE CASCADE,
  bucket TEXT NOT NULL,               -- review | unconfirmed
  mark TEXT CHECK (mark IN ('full','partial','none')),
  prompt TEXT,
  note TEXT,
  updated_by TEXT,
  PRIMARY KEY (hypothesis_id, bucket)
);

CREATE TABLE IF NOT EXISTS interventions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  engagement_id INTEGER NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  kind TEXT NOT NULL,                 -- smallest|alt1|alt2|alt3
  title TEXT NOT NULL,
  description TEXT,
  target_bucket TEXT,
  task_key TEXT,                      -- 재확인할 요건 (ACCOUNT / TRAINING / _START)
  required_roles TEXT NOT NULL,       -- JSON
  cost TEXT,                          -- JSON {lines:[{label,qty,hours,rate}], note}
  stop_condition TEXT,
  recovery_path TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','IN_EXECUTION','CLOSED','STOPPED','REJECTED')),
  proposed_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(engagement_id, code)
);
CREATE TABLE IF NOT EXISTS intervention_targets (
  intervention_id INTEGER NOT NULL REFERENCES interventions(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  outcome TEXT,                       -- verified|unmet|missing|null(미실시)
  outcome_evidence_id INTEGER REFERENCES evidence(id),
  outcome_at TEXT,
  outcome_by TEXT,
  PRIMARY KEY (intervention_id, item_id)
);
CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  engagement_id INTEGER NOT NULL,
  subject_type TEXT NOT NULL,         -- intervention|sync|form
  subject_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  username TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approve','reject','stop')),
  comment TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS scenarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  engagement_id INTEGER NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  assumptions TEXT NOT NULL,          -- JSON [{item_id, outcome:'resolve'|'hold'}]
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS external_syncs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  engagement_id INTEGER NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  subject_type TEXT NOT NULL,
  subject_id INTEGER NOT NULL,
  idem_key TEXT NOT NULL,
  payload TEXT NOT NULL,
  platform_status TEXT NOT NULL DEFAULT 'requested',   -- requested|approved|rejected
  external_status TEXT NOT NULL DEFAULT 'not_sent',    -- not_sent|accepted|failed|manual_reconciled
  stage TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  requested_by TEXT NOT NULL,
  approved_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(engagement_id, idem_key)
);
CREATE TABLE IF NOT EXISTS external_ledger (       -- 모의 원천 시스템의 수신 원장
  idem_key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  accepted_at TEXT NOT NULL
);

-- ─────────────── 현장 컨설팅 작업 도구 ───────────────
CREATE TABLE IF NOT EXISTS forms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  engagement_id INTEGER NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  form_no INTEGER NOT NULL CHECK (form_no BETWEEN 1 AND 6),
  fields TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','complete')),
  version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(engagement_id, form_no)
);
CREATE TABLE IF NOT EXISTS form_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  form_id INTEGER NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  fields TEXT NOT NULL,
  status TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS data_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  engagement_id INTEGER NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  name TEXT NOT NULL, owner TEXT, format_version TEXT, access_limit TEXT,
  provided INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS statements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  engagement_id INTEGER NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  topic TEXT NOT NULL, statement TEXT NOT NULL, speaker TEXT,
  record_ref TEXT, match TEXT NOT NULL DEFAULT 'check' CHECK (match IN ('yes','partial','check','no')),
  confirm_note TEXT
);
CREATE TABLE IF NOT EXISTS dictionary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  engagement_id INTEGER NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  field TEXT NOT NULL, definition TEXT NOT NULL, example TEXT,
  version TEXT NOT NULL DEFAULT 'v1', approver TEXT
);
CREATE TABLE IF NOT EXISTS trial_weeks (
  engagement_id INTEGER NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  week INTEGER NOT NULL,
  focus TEXT NOT NULL, verify TEXT NOT NULL, protect TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','running','done','stopped')),
  notes TEXT,
  PRIMARY KEY (engagement_id, week)
);
CREATE TABLE IF NOT EXISTS daily_closes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  engagement_id INTEGER NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  counts TEXT NOT NULL,               -- JSON 스냅샷
  open_exceptions INTEGER NOT NULL,
  burden_minutes INTEGER,
  correction_of INTEGER REFERENCES daily_closes(id),
  note TEXT,
  closed_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- ─────────────── 사용자 · 감사 · 학습 ───────────────
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL,
  pw_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  engagement_id INTEGER,
  username TEXT, role TEXT,
  action TEXT NOT NULL, subject TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('ok','denied','error')),
  detail TEXT,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL, phase TEXT NOT NULL CHECK (phase IN ('pre','post')),
  answers TEXT NOT NULL, score INTEGER NOT NULL, total INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS practice_progress (
  username TEXT NOT NULL, practice_no INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','doing','done')),
  response TEXT, rubric TEXT, updated_at TEXT NOT NULL,
  PRIMARY KEY (username, practice_no)
);
CREATE TABLE IF NOT EXISTS checklist_state (
  username TEXT NOT NULL, engagement_id INTEGER NOT NULL, item_key TEXT NOT NULL,
  checked INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
  PRIMARY KEY (username, engagement_id, item_key)
);
CREATE TABLE IF NOT EXISTS worksheets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL, title TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL
);
`;

function open(file) {
  if (file && file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file || ':memory:');
  if (file && file !== ':memory:') db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

module.exports = { open, SCHEMA };
