const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'pm.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    client TEXT,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'planning',
    start_date TEXT,
    end_date TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    assignee TEXT,
    priority TEXT NOT NULL DEFAULT 'medium',
    status TEXT NOT NULL DEFAULT 'todo',
    due_date TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);

  CREATE TABLE IF NOT EXISTS milestones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    due_date TEXT,
    completed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_milestones_project ON milestones(project_id);

  CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    biz_reg_no TEXT,
    ceo_name TEXT,
    industry TEXT,
    region TEXT,
    address TEXT,
    employee_count INTEGER,
    founded_date TEXT,
    contact_name TEXT,
    contact_phone TEXT,
    contact_email TEXT,
    memo TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_biz_reg_no
    ON companies(biz_reg_no) WHERE biz_reg_no IS NOT NULL;

  CREATE TABLE IF NOT EXISTS surveys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    -- 작성정보
    survey_method TEXT,
    survey_channel TEXT,
    survey_date TEXT,
    contact_dept_position TEXT,
    contact_phone TEXT,

    -- 기업개요
    company_name TEXT NOT NULL,
    biz_reg_no TEXT,
    ceo_name TEXT,
    emp_office INTEGER,
    emp_tech INTEGER,
    emp_production INTEGER,
    emp_other INTEGER,
    marketing_dept_yn TEXT,
    marketing_headcount INTEGER,
    main_product TEXT,
    revenue_million REAL,
    revenue_ratio REAL,
    main_tech TEXT,

    -- 기술개요 및 종합의견
    tech_overview_opinion TEXT,

    -- 자료확인
    docs_checked TEXT,

    -- 반복/구조화 섹션 (JSON 직렬화)
    business_status TEXT,
    owner_info TEXT,
    executives TEXT,
    mgmt_capability TEXT,
    rnd_org TEXT,
    tech_staff TEXT,
    tech_staff_mgmt TEXT,
    ip_rights TEXT,
    certifications TEXT,
    awards TEXT,
    tech_dev_results TEXT,
    production TEXT,
    investment TEXT,
    clients TEXT,
    marketing_capability TEXT,
    tech_competitiveness TEXT,
    market_status TEXT,
    product_advantage TEXT,

    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_surveys_company_name ON surveys(company_name);
  CREATE INDEX IF NOT EXISTS idx_surveys_biz_reg_no ON surveys(biz_reg_no);

  CREATE TABLE IF NOT EXISTS survey_attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    survey_id INTEGER NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_survey_attachments_survey ON survey_attachments(survey_id);
`);

module.exports = db;
