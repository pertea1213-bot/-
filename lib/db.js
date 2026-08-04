const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'schedule.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT,
    consulting_type TEXT NOT NULL,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    memo TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_active_slot
    ON appointments(date, time)
    WHERE status != 'cancelled';

  CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(date);
  CREATE INDEX IF NOT EXISTS idx_appointments_phone ON appointments(phone);

  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    business_start TEXT NOT NULL DEFAULT '09:00',
    business_end TEXT NOT NULL DEFAULT '18:00',
    slot_minutes INTEGER NOT NULL DEFAULT 60,
    lunch_start TEXT DEFAULT '12:00',
    lunch_end TEXT DEFAULT '13:00',
    closed_weekdays TEXT NOT NULL DEFAULT '[0,6]',
    consulting_types TEXT NOT NULL DEFAULT '["초기 상담","후속 상담","전략 컨설팅","기타"]'
  );

  INSERT OR IGNORE INTO settings (id) VALUES (1);
`);

module.exports = db;
