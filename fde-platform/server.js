'use strict';
const path = require('path');
const { open } = require('./src/db');
const seed = require('./src/seed');
const { createApp } = require('./src/app');

const isProd = process.env.NODE_ENV === 'production';
// 운영 모드에서는 알려진 기본 비밀번호로 계정을 만들지 않는다(fail closed).
const demoPassword = process.env.DEMO_PASSWORD || (isProd ? null : 'fde-demo-1234');
if (isProd && !demoPassword) {
  console.error('운영 모드(NODE_ENV=production)에서는 DEMO_PASSWORD 환경변수를 반드시 설정해야 합니다.');
  process.exit(1);
}

const dbFile = process.env.FDE_DB_PATH || path.join(__dirname, 'data', 'fde.db');
const db = open(dbFile);
seed.seedAll(db, { demoPassword });

const PORT = Number(process.env.PORT) || 5100;
createApp({ db, isProd, demoPassword }).listen(PORT, process.env.HOST || '0.0.0.0', () => {
  console.log(`온톨로지·FDE 플랫폼 http://localhost:${PORT}  (db: ${dbFile})`);
  if (!isProd) console.log(`데모 계정 비밀번호(개발 모드): ${demoPassword}  — 계정: admin, consultant1, fde1, exec1, hr1, manager1, it1, sec1, field1, reviewer1, learner1`);
});
