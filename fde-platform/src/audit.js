'use strict';
const { sha256, isoNow } = require('./util');

/** 처리 기록: 누가 언제 무엇을 등록·수정·승인했는지. 해시 체인으로 사후 변조를 탐지한다. */
function log(ctx, { engagementId = null, action, subject = null, outcome = 'ok', detail = null }) {
  const { db } = ctx;
  const ts = isoNow(ctx.clock);
  const last = db.prepare('SELECT hash FROM audit ORDER BY id DESC LIMIT 1').get();
  const prev = last ? last.hash : 'GENESIS';
  const actor = ctx.actor || {};
  const d = detail == null ? null : (typeof detail === 'string' ? detail : JSON.stringify(detail));
  const hash = sha256([prev, ts, engagementId, actor.username, actor.role, action, subject, outcome, d].join('|'));
  db.prepare(`INSERT INTO audit (ts, engagement_id, username, role, action, subject, outcome, detail, prev_hash, hash)
              VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(ts, engagementId, actor.username || null, actor.role || null, action, subject, outcome, d, prev, hash);
}

function verifyChain(db) {
  const rows = db.prepare('SELECT * FROM audit ORDER BY id').all();
  let prev = 'GENESIS';
  for (const r of rows) {
    const h = sha256([prev, r.ts, r.engagement_id, r.username, r.role, r.action, r.subject, r.outcome, r.detail].join('|'));
    if (r.prev_hash !== prev || r.hash !== h) return { ok: false, brokenAt: r.id, total: rows.length };
    prev = r.hash;
  }
  return { ok: true, total: rows.length };
}

/**
 * 감사 대상 작업 실행기.
 *  - 성공: 트랜잭션 안에서 'ok' 기록
 *  - 권한 거부(403)·검증 실패·충돌: 롤백 후 'denied'/'error' 기록 (무권한 시도의 흔적을 남긴다)
 */
function audited(ctx, { engagementId = null, action, subject = null }, fn) {
  const { db } = ctx;
  try {
    return db.transaction(() => {
      const out = fn();
      log(ctx, { engagementId, action, subject, outcome: 'ok', detail: out && out.__audit ? out.__audit : null });
      if (out && out.__audit !== undefined) delete out.__audit;
      return out;
    })();
  } catch (e) {
    const status = e && e.status;
    log(ctx, {
      engagementId, action, subject,
      outcome: status === 403 ? 'denied' : 'error',
      detail: { status: status || 500, message: e && e.message },
    });
    // 롤백되면 사라지는 부수 기록(재검토 배정, 자동 중단 등)은 롤백 뒤 별도 트랜잭션으로 남긴다
    if (e && typeof e.afterRollback === 'function') {
      try { db.transaction(() => e.afterRollback())(); } catch (_) { /* 부수 기록 실패가 원 오류를 가리지 않게 한다 */ }
    }
    throw e;
  }
}

module.exports = { log, verifyChain, audited };
