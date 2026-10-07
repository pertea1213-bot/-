'use strict';
/** 현장 컨설팅 작업 도구: 서식 6종 · 진술↔기록 대조 · 일 마감 · 전후 비교 · 최종 보고 · 과업/어댑터 생성 */
const policy = require('./policy');
const engine = require('./engine');
const svc = require('./services');
const { audited } = require('./audit');
const { bad, forbidden, notFound, conflict, normTs, isoNow, jparse, ratio } = require('./util');

const now = (ctx) => isoNow(ctx.clock);
const needActor = (ctx) => { if (!ctx.actor) { const { HttpError } = require('./util'); throw new HttpError(401, '인증이 필요합니다.'); } };
const allow = (ctx, a) => { needActor(ctx); if (!policy.can(ctx.actor.role, a)) throw forbidden(`권한 없음: '${ctx.actor.role}' 역할은 ${a} 을(를) 실행할 수 없습니다.`); };

// ───────────────────────── 현장 서식 6종 ─────────────────────────
const FORMS = {
  1: { name: '문제 정의서', purpose: '범위·부족 수량·근거 근거 자료', extra: ['problem_sentence'], rule: '입사 확인을 교육 완료로 자동 대체하지 않는다' },
  2: { name: '관찰 기록지', purpose: '본 것과 들은 것을 구분', extra: ['observed', 'heard'], rule: '교육 이수와 업무 수행 적격성을 분리한다' },
  3: { name: '자료 계산표', purpose: '수량 관계 계산 확인과 잔차', extra: ['equations', 'residual'], rule: '계정 생성과 실제 권한 부여를 별도 과업으로 기록한다' },
  4: { name: '원인 확인표', purpose: '원인 후보별 증거와 다른 가능성 확인', extra: ['hypotheses', 'disconfirm', 'unexplained'], rule: '업무 배치에는 현업 관리자의 확인이 필요하다' },
  5: { name: '조치 승인서', purpose: '대상·권한·비용·중단 조건·복구 경로', extra: ['target', 'authority', 'cost_assumption', 'stop_condition', 'recovery_path', 'approver'], rule: '개인정보는 최소 항목과 역할별 열람으로 제한한다' },
  6: { name: '현장 시험 인계서', purpose: '전후 비교와 다음 담당', extra: ['unresolved', 'privacy_scope', 'assumptions_limits', 'forbidden_actions', 'approval_history'], rule: '미입사자는 교육·권한 실적에 포함하지 않는다' },
};
const COMMON_REQUIRED = ['scope', 'source_id', 'unit', 'time', 'owner', 'unconfirmed', 'next_action'];
const COMMON_LABEL = { scope: '범위', source_id: '자료 식별번호', unit: '단위', time: '시각(기준 시점)', owner: '담당', unconfirmed: '미확정', next_action: '다음 행동' };

function formDefs() { return { forms: FORMS, editors: policy.FORM_EDITORS, common_required: COMMON_REQUIRED, common_label: COMMON_LABEL, note: '자료가 없다면 0이나 합격으로 바꾸지 않는다 — 미확인으로 적고 담당·기한을 정한다. 보존 제한이 있는 원문은 내부 참조식별번호와 접근권한만 적는다.' }; }

function validateForm(no, fields, status) {
  const f = FORMS[no]; const missing = [];
  if (status === 'complete') {
    for (const k of [...COMMON_REQUIRED, ...f.extra]) if (!String(fields[k] ?? '').trim()) missing.push(k);
  }
  // 근거가 없는데 수치를 '0'이나 '합격'으로 적으면 안 된다
  const warnings = [];
  const src = String(fields.source_id ?? '').trim();
  for (const [k, v] of Object.entries(fields)) {
    if (!src && /^(0|0명|합격|통과|없음)$/.test(String(v).trim()) && !['unconfirmed', 'residual'].includes(k)) warnings.push(`${k}: 자료 식별번호 없이 "${v}"로 적을 수 없습니다. 미확인으로 적으세요.`);
  }
  return { missing, warnings };
}

function saveForm(ctx, engId, no, p) {
  needActor(ctx);
  return audited(ctx, { engagementId: engId, action: 'form.save', subject: `서식 ${no}` }, () => {
    no = Number(no);
    if (!FORMS[no]) throw bad('서식 번호는 1~6');
    if (!policy.canEditForm(ctx.actor.role, no)) throw forbidden(`권한 없음: 서식 ${no}(${FORMS[no].name}) 은(는) ${policy.FORM_EDITORS[no].map((r) => policy.ROLES[r].label).join('·')}만 작성할 수 있습니다.`);
    svc.getEng(ctx, engId);
    const fields = p.fields && typeof p.fields === 'object' ? p.fields : {};
    const status = p.status === 'complete' ? 'complete' : 'draft';
    const v = validateForm(no, fields, status);
    if (v.missing.length) throw bad(`빈칸이 있는 서식은 완료로 표시할 수 없습니다: ${v.missing.join(', ')}`, { missing: v.missing });
    if (v.warnings.length) throw bad(v.warnings[0], { warnings: v.warnings });
    const cur = ctx.db.prepare('SELECT * FROM forms WHERE engagement_id=? AND form_no=?').get(engId, no);
    const t = now(ctx);
    if (cur) {
      if (p.expected_version != null && Number(p.expected_version) !== cur.version) throw conflict('다른 사람이 먼저 수정했습니다. 새로 고침 후 다시 저장하세요.');
      ctx.db.prepare('INSERT INTO form_history (form_id,version,fields,status,updated_by,updated_at) VALUES (?,?,?,?,?,?)').run(cur.id, cur.version, cur.fields, cur.status, cur.updated_by, cur.updated_at);
      ctx.db.prepare('UPDATE forms SET fields=?, status=?, version=version+1, updated_by=?, updated_at=? WHERE id=?').run(JSON.stringify(fields), status, ctx.actor.username, t, cur.id);
      return { form_no: no, version: cur.version + 1, status };
    }
    ctx.db.prepare('INSERT INTO forms (engagement_id,form_no,fields,status,updated_by,updated_at) VALUES (?,?,?,?,?,?)').run(engId, no, JSON.stringify(fields), status, ctx.actor.username, t);
    return { form_no: no, version: 1, status };
  });
}

function getForms(db, engId) {
  const rows = db.prepare('SELECT * FROM forms WHERE engagement_id=? ORDER BY form_no').all(engId);
  return rows.map((r) => ({ form_no: r.form_no, name: FORMS[r.form_no].name, fields: jparse(r.fields, {}), status: r.status, version: r.version, updated_by: r.updated_by, updated_at: r.updated_at }));
}


/**
 * 서식 작성 예. 인사 사례는 원문의 작성 예를 그대로 쓰고, 다른 사례는 그 사례의 실제 수치·원인 후보·조치에서 만든다.
 * 같은 필수 칸(범위·자료 식별번호·단위·시각·담당·미확정·다음 행동)을 모두 채운다.
 */
function formExamples(db, engId, hrExamples) {
  const eng = engine.loadEngagement(db, engId); const ad = eng.adapter;
  if (ad.key === 'hr-onboarding') return hrExamples || {};
  const base = engine.baseline(db, engId); const c = base.counts; const m = base.metrics; const u = ad.unit;
  const role = (r) => (ad.role_labels && ad.role_labels[r]) || r;
  const reqSrc = ad.requirements.map((r) => r.source || r.label);
  const hyps = db.prepare('SELECT * FROM hypotheses WHERE engagement_id=? ORDER BY code').all(engId);
  const iv = db.prepare(`SELECT * FROM interventions WHERE engagement_id=? AND kind<>'smallest' ORDER BY id LIMIT 1`).get(engId);
  const ivRoles = iv ? jparse(iv.required_roles, []).map(role).join(' + ') : '';
  const ivCost = iv ? engine.costOf(jparse(iv.cost, null)) : null;
  const scope = `${ad.request_label || '요청'} ${eng.request_code} / 과업 ${eng.task_code}`;
  const parts = m.shortage_parts;
  const common = (i, owner, next) => ({
    scope, source_id: [`${ad.start_label} 근거 자료`, reqSrc[0], reqSrc[1] || reqSrc[0], reqSrc[2] || reqSrc[0], reqSrc[0], '접근·사유 기록'][i - 1], unit: u, time: `기준 시점 ${eng.basis_date}`, owner,
    unconfirmed: `미확인 ${c.unconfirmed}${u} · 검토 ${c.review}${u}의 원인은 미판정(원인 후보별 증거·다른 가능성 확인 필요)`, next_action: next,
  });
  const ids = base.identities.map((x) => `${x.lhs.value} = ${x.rhs.map((t) => t.value).join(' + ')}`).join(' ; ');
  const surplusNote = c.required !== c.input ? ` 요구 ${c.required} ≠ 입력 ${c.input}이므로 부족은 요구 − 승인으로 계산하고 초과분은 따로 둔다.` : '';
  return {
    1: { ...common(1, '컨설턴트(문제 정의) · 요구 승인 책임자', '자료 요청서 회수 후 관찰 기록지(서식 2) 작성'), problem_sentence: `요구 ${c.required}${u} 중 ${ad.start_label} ${c.started}${u}, 최초 승인 ${c.approved}${u} — 부족 ${m.shortage}${u}(검토 ${parts.review} + 미확인 ${parts.unconfirmed} + 진행 ${parts.in_progress} + 예비 ${parts.reserve}).${surplusNote} ${ad.trap || ''}`.trim() },
    2: { ...common(2, '컨설턴트 · 현장 담당자', '담당자 면담과 원본 대조로 진술과 기록을 분리'), observed: `원본으로 확인한 사실: ${ids}. 각 숫자의 자료 식별번호는 대상·근거 화면에서 확인한다.`, heard: '담당자 진술(“완료했다”, “보냈다” 등)은 원본과 대조하기 전까지 별도 칸에 보존한다. 사후 해석과 섞지 않는다.' },
    3: { ...common(3, '컨설턴트 · FDE(같은 결과 확인)', '개별 대상 키 단위 비교 확인'), unconfirmed: '없음 — 세 식·하위 범주 잔차 0 확인(대상 단위 일치는 별도)', equations: ids, residual: '0 / 0 / 0 — 합계 일치 ≠ 정확: 개별 대상 키와 범주 배정을 따로 확인한다' },
    4: { ...common(4, '컨설턴트 · 해당 업무 책임자(확인)', '원인 후보 × 대상 매트릭스(○△×) 작성'), hypotheses: hyps.length ? hyps.map((h) => `${h.code} ${h.statement}`).join(' · ') : '(아직 없음 — 원인 후보를 2개 이상 먼저 세운다. 원인을 하나로 뭉뚱그리지 않는다)', disconfirm: hyps.length ? hyps.map((h) => `${h.code} ${h.disconfirm_source}`).join(' · ') : '(원인 후보마다 다른 가능성을 확인할 자료를 정한다)', unexplained: `검토 ${c.review} · 미확인 ${c.unconfirmed} 중 어느 원인 후보가 어느 대상을 설명하는지는 미판정이다. 시각의 선후만으로 인과를 확정하지 않는다.` },
    5: { ...common(5, '컨설턴트(제안) · 승인 책임자', '결재 완료 후 현장 병행 시험 1주차 시작'), target: iv ? `${iv.title}` : '(조치를 먼저 제안 — 대상·권한·비용·중단 조건·복구 경로가 모두 있어야 제출된다)', authority: ivRoles || '(승인 역할을 지정 — 컨설턴트·FDE는 승인할 수 없다)', cost_assumption: ivCost ? (ivCost.lines.length ? `가상 ${ivCost.amount.toLocaleString('ko-KR')}원 — 교육용 가정이며 실제 지급액·자동 절감액이 아님` : '비용 수치 없음 — 현장에서 산정') : '(비용 가정을 적는다 — 임금·법정 비용이 아닌 가정임을 명시)', stop_condition: iv ? iv.stop_condition || '' : '(중단 조건을 정한다)', recovery_path: iv ? iv.recovery_path || '' : '(복구 경로를 정한다)', approver: '[업무 책임자 서명]' },
    6: { ...common(6, '컨설턴트 → 다음 담당 책임자', '잔여 건의 담당·기한을 지정하고 보호 지표를 재계산'), unresolved: `검토 ${c.review} · 미확인 ${c.unconfirmed} · 진행 ${c.in_progress} · 예비 ${c.reserve} — 각각 담당·기한 지정 필요`, privacy_scope: (ad.regulations || '내부 식별키만 사용, 열람은 역할별, 보존 기간은 현장 정책·법률 검토').split('. ').slice(0, 2).join('. '), assumptions_limits: '비용·조치 후 수량은 가정이며 실측이 아니다. 사후 비교만으로 새 플랫폼의 인과 효과를 단정하지 않는다.', forbidden_actions: '모델 제안값을 곧바로 실행하지 않는다. 승인 없는 상태 변경·무권한 실행 금지.', approval_history: '조치 결재 이력(처리 기록 탭)과 연결' },
  };
}

// ───────────────────────── 단순 작업표 CRUD ─────────────────────────
const TOOLS = {
  statements: { table: 'statements', cols: ['topic', 'statement', 'speaker', 'record_ref', 'match', 'confirm_note'], req: ['topic', 'statement'], defaults: { match: 'check' } },
  data_requests: { table: 'data_requests', cols: ['name', 'owner', 'format_version', 'access_limit', 'provided'], req: ['name'], defaults: {} },
  dictionary: { table: 'dictionary', cols: ['field', 'definition', 'example', 'version', 'approver'], req: ['field', 'definition'], defaults: { version: 'v1' } },
};
function toolList(db, engId, tool) { const t = TOOLS[tool]; if (!t) throw notFound(); return db.prepare(`SELECT * FROM ${t.table} WHERE engagement_id=? ORDER BY id`).all(engId); }
function toolSave(ctx, engId, tool, id, p) {
  needActor(ctx);
  return audited(ctx, { engagementId: engId, action: `${tool}.${id ? 'update' : 'create'}`, subject: String(id || '') }, () => {
    allow(ctx, 'worktool.edit');
    svc.getEng(ctx, engId);
    const t = TOOLS[tool]; if (!t) throw notFound();
    for (const k of t.req) if (!String(p[k] ?? '').trim()) throw bad(`${k} 은(는) 필수입니다.`);
    for (const c of t.cols) if (typeof p[c] === 'string' && p[c].length > 2000) throw bad(`${c} 이(가) 너무 깁니다(2000자 이하).`);
    if (tool === 'statements' && p.match && !['yes', 'partial', 'check', 'no'].includes(p.match)) throw bad('match 값이 올바르지 않습니다.');
    const vals = t.cols.map((c) => (c === 'provided' ? (p[c] ? 1 : 0) : (p[c] ?? t.defaults[c] ?? null)));
    if (id) {
      const ex = ctx.db.prepare(`SELECT 1 FROM ${t.table} WHERE id=? AND engagement_id=?`).get(id, engId);
      if (!ex) throw notFound();
      ctx.db.prepare(`UPDATE ${t.table} SET ${t.cols.map((c) => `${c}=?`).join(',')} WHERE id=?`).run(...vals, id);
      return { id: Number(id) };
    }
    const info = ctx.db.prepare(`INSERT INTO ${t.table} (engagement_id,${t.cols.join(',')}) VALUES (?,${t.cols.map(() => '?').join(',')})`).run(engId, ...vals);
    return { id: Number(info.lastInsertRowid) };
  });
}
function toolDelete(ctx, engId, tool, id) {
  needActor(ctx);
  return audited(ctx, { engagementId: engId, action: `${tool}.delete`, subject: String(id) }, () => {
    allow(ctx, 'worktool.edit');
    const t = TOOLS[tool]; if (!t) throw notFound();
    const r = ctx.db.prepare(`DELETE FROM ${t.table} WHERE id=? AND engagement_id=?`).run(id, engId);
    if (!r.changes) throw notFound();
    return { id: Number(id), deleted: true };
  });
}

// ───────────────────────── 원인 후보 ─────────────────────────
function hypothesesView(db, engId, snap) {
  const hs = db.prepare('SELECT * FROM hypotheses WHERE engagement_id=? ORDER BY code').all(engId);
  const cov = db.prepare('SELECT c.* FROM hypothesis_coverage c JOIN hypotheses h ON h.id=c.hypothesis_id WHERE h.engagement_id=?').all(engId);
  return hs.map((h) => {
    const mine = cov.filter((c) => c.hypothesis_id === h.id);
    const marks = mine.map((c) => c.mark).filter(Boolean);
    const explainsAll = mine.length >= 2 && mine.every((c) => c.mark === 'full');
    return {
      ...h,
      coverage: mine.map((c) => ({ bucket: c.bucket, mark: c.mark, prompt: c.prompt, note: c.note })),
      suspicious: explainsAll,
      suspicious_msg: explainsAll ? '검토와 미확인을 모두 완전히 설명하는 원인 후보는 오히려 의심한다 — 다른 가능성을 확인할 자료를 다시 보세요.' : null,
      judged: marks.length,
    };
  });
}
function saveHypothesis(ctx, engId, hid, p) {
  needActor(ctx);
  return audited(ctx, { engagementId: engId, action: 'hypothesis.edit', subject: String(hid) }, () => {
    allow(ctx, 'hypothesis.edit');
    const h = ctx.db.prepare('SELECT * FROM hypotheses WHERE id=? AND engagement_id=?').get(hid, engId);
    if (!h) throw notFound();
    if (p.status) {
      if (!['need_evidence', 'supported', 'weakened', 'rejected'].includes(p.status)) throw bad('status 값이 올바르지 않습니다.');
      // 시각이 겹친다는 이유만으로 인과를 확정하지 않는다: supported 는 다른 가능성 확인 메모가 있어야 한다
      if (p.status === 'supported' && !String(p.disconfirm_note || '').trim()) throw bad('"지지됨"으로 바꾸려면 다른 가능성을 확인한 결과(disconfirm_note)를 적어야 합니다. 시각이 겹친다는 이유만으로 인과를 확정하지 않습니다.');
      ctx.db.prepare('UPDATE hypotheses SET status=? WHERE id=?').run(p.status, hid);
    }
    for (const c of p.coverage || []) {
      if (!['review', 'unconfirmed'].includes(c.bucket)) throw bad('bucket 은 review/unconfirmed');
      if (c.mark != null && !['full', 'partial', 'none'].includes(c.mark)) throw bad('mark 는 full/partial/none');
      ctx.db.prepare(`INSERT INTO hypothesis_coverage (hypothesis_id,bucket,mark,note,updated_by) VALUES (?,?,?,?,?)
        ON CONFLICT(hypothesis_id,bucket) DO UPDATE SET mark=excluded.mark, note=excluded.note, updated_by=excluded.updated_by`).run(hid, c.bucket, c.mark ?? null, c.note ?? null, ctx.actor.username);
    }
    return { id: Number(hid) };
  });
}

// ───────────────────────── 현장 시험 운영 ─────────────────────────
function trialWeeks(db, engId) { return db.prepare('SELECT * FROM trial_weeks WHERE engagement_id=? ORDER BY week').all(engId); }
function updateTrialWeek(ctx, engId, week, p) {
  needActor(ctx);
  return audited(ctx, { engagementId: engId, action: 'trial.update', subject: `${week}주` }, () => {
    allow(ctx, 'trial.update');
    const w = ctx.db.prepare('SELECT * FROM trial_weeks WHERE engagement_id=? AND week=?').get(engId, week);
    if (!w) throw notFound();
    if (!['planned', 'running', 'done', 'stopped'].includes(p.status)) throw bad('status 값이 올바르지 않습니다.');
    // 시험 중단과 원상복구 절차가 없으면 현장 시험을 시작하지 않는다
    if (p.status === 'running') {
      const approved = ctx.db.prepare(`SELECT COUNT(*) n FROM interventions WHERE engagement_id=? AND status IN ('APPROVED','IN_EXECUTION','CLOSED') AND stop_condition IS NOT NULL AND recovery_path IS NOT NULL`).get(engId).n;
      if (!approved) throw conflict('중단 조건과 복구 경로가 있는 승인된 조치가 없으면 현장 시험을 시작하지 않습니다.');
      if (week > 1) {
        const prev = ctx.db.prepare('SELECT status FROM trial_weeks WHERE engagement_id=? AND week=?').get(engId, week - 1);
        if (!prev || prev.status !== 'done') throw conflict(`${week - 1}주차가 완료되기 전에는 ${week}주차를 시작할 수 없습니다.`);
      } else {
        const snap = engine.snapshot(ctx.db, engId);
        const q = engine.quality(ctx.db, engId, snap);
        if (q.decision === 'blocked') throw conflict(`데이터 품질 판정이 '시작 불가'입니다: ${q.reasons.join(', ')}`);
      }
    }
    ctx.db.prepare('UPDATE trial_weeks SET status=?, notes=COALESCE(?,notes) WHERE engagement_id=? AND week=?').run(p.status, p.notes ?? null, engId, week);
    return { week, status: p.status };
  });
}

function closeDay(ctx, engId, p) {
  needActor(ctx);
  return audited(ctx, { engagementId: engId, action: 'dayclose', subject: p.day }, () => {
    allow(ctx, 'dayclose');
    svc.getEng(ctx, engId);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.day || ''))) throw bad('day 는 YYYY-MM-DD');
    const snap = engine.snapshot(ctx.db, engId, { basis: p.day });
    const openEx = ctx.db.prepare(`SELECT (SELECT COUNT(*) FROM holds WHERE engagement_id=? AND status='open') + (SELECT COUNT(*) FROM reject_queue WHERE engagement_id=? AND status='open') + (SELECT COUNT(*) FROM re_reviews WHERE engagement_id=? AND status='open') n`).get(engId, engId, engId).n;
    let corr = null;
    if (p.correction_of) {
      corr = ctx.db.prepare('SELECT * FROM daily_closes WHERE id=? AND engagement_id=?').get(p.correction_of, engId);
      if (!corr) throw notFound('정정 대상 마감이 없습니다.');
      if (!String(p.note || '').trim()) throw bad('정정에는 사유(note)가 필요합니다. 이전 마감은 지우지 않고 정정 기록을 더합니다.');
    } else if (ctx.db.prepare('SELECT 1 FROM daily_closes WHERE engagement_id=? AND day=? AND correction_of IS NULL').get(engId, p.day)) {
      throw conflict('이미 마감된 날입니다. 다음 날로 숨기지 말고 정정 기록으로 더하세요(correction_of).');
    }
    if (!snap.integrity_ok) {
      // 임계치를 넘으면 자동 실행을 멈추고 담당자에게 재검토를 배정한다
      const err = conflict('정합성 오류(잔차≠0)가 있어 마감할 수 없습니다. 자동 실행을 멈추고 재검토를 배정했습니다.');
      const at = now(ctx), by = ctx.actor.username;
      err.afterRollback = () => {
        ctx.db.prepare(`UPDATE interventions SET status='STOPPED', updated_at=? WHERE engagement_id=? AND status IN ('IN_EXECUTION','APPROVED')`).run(at, engId);
        ctx.db.prepare(`INSERT INTO re_reviews (engagement_id,subject_type,subject_id,reason,created_at,created_by) VALUES (?,?,?,?,?,?)`).run(engId, 'dayclose', 0, `정합성 오류로 마감 거부 (${p.day})`, at, by);
      };
      throw err;
    }
    const info = ctx.db.prepare(`INSERT INTO daily_closes (engagement_id,day,counts,open_exceptions,burden_minutes,correction_of,note,closed_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(engId, p.day, JSON.stringify(snap.counts), openEx, p.burden_minutes ?? null, corr ? corr.id : null, p.note || null, ctx.actor.username, now(ctx));
    return { id: Number(info.lastInsertRowid), counts: snap.counts, open_exceptions: openEx };
  });
}
const dailyCloses = (db, engId) => db.prepare('SELECT * FROM daily_closes WHERE engagement_id=? ORDER BY day, id').all(engId).map((r) => ({ ...r, counts: jparse(r.counts, {}) }));

/** 전후 비교 — 비교 가능 조건 5가지를 데이터로 확인하고, 인과는 단정하지 않는다 */
function compare(db, engId, p) {
  const a = engine.snapshot(db, engId, { basis: p.before_basis, known: p.before_known });
  const b = engine.snapshot(db, engId, { basis: p.after_basis, known: p.after_known });
  const t = engine.transitions(a, b);
  const conds = [];
  conds.push({ key: 'population', label: '모집단이 같다', ok: a.counts.input === b.counts.input && a.counts.required === b.counts.required, detail: `입력 ${a.counts.input}→${b.counts.input}, 요구 ${a.counts.required}→${b.counts.required}` });
  const days = Math.round((new Date(b.basis) - new Date(a.basis)) / 86400000);
  conds.push({ key: 'period', label: '관측 기간이 같다(비교 구간이 명확하다)', ok: days > 0, detail: `기준 시점 간격 ${days}일` });
  conds.push({ key: 'criteria', label: '승인 기준이 같다(규칙 버전)', ok: a.rule && b.rule && a.rule.version === b.rule.version && JSON.stringify(a.rule.required_keys) === JSON.stringify(b.rule.required_keys), detail: `규칙 v${a.rule ? a.rule.version : '?'} → v${b.rule ? b.rule.version : '?'}` });
  const miss = (s) => (s.counts.started ? ratio(s.counts.unconfirmed, s.counts.started) : null);
  const ma = miss(a), mb = miss(b);
  conds.push({ key: 'missing', label: '누락률이 같다', ok: ma != null && mb != null && ma === mb, detail: `미확인 비율 ${ma ?? '—'}% → ${mb ?? '—'}% (미확인이 줄어든 것이 성과인지, 단지 기록이 채워진 것인지 구분 필요)` });
  conds.push({ key: 'inflow', label: '새 유입과 기존 보류 해소를 분리했다', ok: true, detail: `신규 유입 ${t.new_inflow}건 / 기존 대상의 상태 변경 ${t.moved.length}건` });
  const blockers = [];
  if (p.concurrent_change) blockers.push('동시기에 다른 제도가 바뀌었다');
  if (p.terms_changed) blockers.push('거래 조건이 달라졌다');
  if (p.definition_changed) blockers.push('기준 정의가 중간에 바뀌었다');
  if (p.cannot_recompute) blockers.push('같은 정의로 재계산하지 못했다');
  const comparable = conds.every((c) => c.ok) && !blockers.length;
  return {
    before: { basis: a.basis, counts: a.counts, metrics: a.metrics }, after: { basis: b.basis, counts: b.counts, metrics: b.metrics },
    transitions: { matrix: t.matrix, moved: t.moved.length, conserved: t.conserved, net: t.net },
    conditions: conds, blockers, comparable,
    memo: comparable ? '비교 가능 조건을 충족합니다. 그래도 사후 비교만으로 새 플랫폼의 인과 효과를 단정하지 않습니다.' : `효과를 단정하면 안 됩니다. ${[...conds.filter((c) => !c.ok).map((c) => c.label + ' 불충족'), ...blockers].join('; ')}`,
  };
}

// ───────────────────────── 최종 보고 (8단 순서) ─────────────────────────
function report(db, engId) {
  const eng = engine.loadEngagement(db, engId);
  const snap = engine.snapshot(db, engId);
  const hyps = hypothesesView(db, engId, snap);
  const ivs = db.prepare('SELECT * FROM interventions WHERE engagement_id=? ORDER BY id').all(engId).map((i) => ({ ...i, required_roles: jparse(i.required_roles, []), cost: engine.costOf(jparse(i.cost, null)) }));
  const closes = dailyCloses(db, engId);
  const open = { holds: db.prepare(`SELECT COUNT(*) n FROM holds WHERE engagement_id=? AND status='open'`).get(engId).n, rejects: db.prepare(`SELECT COUNT(*) n FROM reject_queue WHERE engagement_id=? AND status='open'`).get(engId).n, re_reviews: db.prepare(`SELECT COUNT(*) n FROM re_reviews WHERE engagement_id=? AND status='open'`).get(engId).n };
  const base = engine.baseline(db, engId);
  const c = snap.counts, m = snap.metrics;
  const shortGroups = snap.groups.filter((g) => g.required - g.approved > 0).map((g) => ({ name: g.name, required: g.required, approved: g.approved, shortage: g.required - g.approved }));
  const totalCost = ivs.filter((i) => i.cost).reduce((s, i) => s + i.cost.amount, 0);
  const first = closes[0], last = closes[closes.length - 1];
  const bc = base.counts, u = eng.adapter.unit;
  const problem = `${eng.adapter.task_name}: 기준 시점(${eng.basis_date}) 요구 ${bc.required}${u} 중 ${eng.adapter.start_label} ${bc.started}${u}(완료 ${bc.completed}), 최초 승인 ${bc.approved}${u} — 부족 ${base.metrics.shortage}${u}.`;
  return {
    engagement: { request_code: eng.request_code, task_code: eng.task_code, title: eng.title, basis: snap.basis, synthetic: !!eng.synthetic },
    first_page: { baseline: { basis: eng.basis_date, required: bc.required, approved: bc.approved, shortage: base.metrics.shortage }, required: c.required, approved: c.approved, shortage: m.shortage, remaining_by_group: shortGroups, note: '첫 쪽에는 의사결정에 필요한 수량과 잔여 부족만, 행 단위 근거는 부록에 둔다.' },
    sections: [
      { no: 1, title: '문제 문장', body: problem },
      { no: 2, title: '원자료와 수량 관계', baseline_identities: base.identities, identities: snap.identities, rates: { completion: m.completion_rate, approval: m.approval_rate, fulfilment: m.fulfilment_rate }, note: '완료율·승인율·충족률은 분모가 다르다. 분모가 0이면 산출 불가로 표시한다.' },
      { no: 3, title: '대상별 부족', groups: snap.group_metrics.map((g) => ({ name: g.name, required: g.required, approved: g.approved, shortage: g.shortage, parts: g.shortage_parts })) },
      { no: 4, title: '여러 원인 후보', hypotheses: hyps.map((h) => ({ code: h.code, statement: h.statement, status: h.status, support: h.support_source, disconfirm: h.disconfirm_source, suspicious: h.suspicious })) },
      { no: 5, title: '승인된 경로', interventions: ivs.map((i) => ({ code: i.code, title: i.title, status: i.status, required_roles: i.required_roles })) },
      { no: 6, title: '비용 가정', total_assumed_amount: totalCost, disclaimer: '교육용 업무 부담 가정이며 임금·수당·법정 교육비·자동 절감액이 아니다. 근무 일정과 대체 인력을 확인하기 전에는 현금 손실로 환산하지 않는다.', lines: ivs.filter((i) => i.cost).map((i) => ({ code: i.code, amount: i.cost.amount, person_hours: i.cost.person_hours })) },
      { no: 7, title: '현장 시험 전후와 한계', first_close: first ? { day: first.day, counts: first.counts } : null, last_close: last ? { day: last.day, counts: last.counts } : null, note: '사후 비교만으로 새 플랫폼의 인과 효과를 단정하지 않는다. 비교 가능 조건은 /compare 로 확인한다.' },
      { no: 8, title: '담당·기한(미해결)', open, note: '최초 준비 완료 수량과 이후 다시 확인 승인·대외 확정은 별도 표시한다.' },
    ],
    not_claimed: ['근로계약의 유효성', '노동법상 의무 충족 여부', '임금 지급·근로시간 충족', '개인별 건강·평가·보수 정보', '법률·회계·고객 계약 판단'],
    disclaimer: eng.synthetic ? '사례의 회사·사람·수량·비용·기간은 교육을 위해 만든 가상 자료이며 실제 기업의 실행·성과나 검토 완료를 뜻하지 않는다.' : null,
  };
}

// ───────────────────────── 과업·어댑터 생성 ─────────────────────────
function createAdapter(ctx, p) {
  needActor(ctx);
  return audited(ctx, { action: 'adapter.create', subject: p.key }, () => {
    allow(ctx, 'adapter.create');
    for (const k of ['key', 'name', 'industry', 'task_name', 'unit', 'item_label', 'group_label', 'start_label', 'start_owner']) if (!String(p[k] ?? '').trim()) throw bad(`${k} 은(는) 필수입니다.`);
    if (!/^[a-z0-9_-]{2,40}$/.test(p.key)) throw bad('key 는 영소문자·숫자·-_ 2~40자');
    if (!policy.ROLES[p.start_owner]) throw bad('start_owner 역할이 올바르지 않습니다.');
    const reqs = p.requirements;
    if (!Array.isArray(reqs) || reqs.length < 1 || reqs.length > 5) throw bad("'준비'의 요건은 1~5개여야 합니다(권장 3~5).");
    const seen = new Set();
    for (const r of reqs) {
      if (!/^[A-Z][A-Z0-9_]{1,23}$/.test(r.key || '') || r.key === '_START') throw bad(`요건 key 는 영대문자 형식이어야 합니다: ${r.key}`);
      if (seen.has(r.key)) throw bad(`요건 key 중복: ${r.key}`); seen.add(r.key);
      if (!r.label || !policy.ROLES[r.owner]) throw bad(`요건 ${r.key}: label/owner(역할) 필요`);
    }
    if (ctx.db.prepare('SELECT 1 FROM adapters WHERE key=?').get(p.key)) throw conflict('이미 있는 어댑터 key 입니다.');
    const info = ctx.db.prepare(`INSERT INTO adapters (key,name,industry,task_name,unit,item_label,group_label,start_label,start_owner,requirements,role_labels,trap,regulations,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(p.key, p.name, p.industry, p.task_name, p.unit, p.item_label, p.group_label, p.start_label, p.start_owner, JSON.stringify(reqs.map((r) => ({ key: r.key, label: r.label, source: r.source || '', owner: r.owner }))), JSON.stringify(p.role_labels || {}), p.trap || null, p.regulations || null, now(ctx));
    return { id: Number(info.lastInsertRowid), key: p.key };
  });
}

function defaultTrialWeeks(db, engId) {
  const rows = [
    [1, '정의·근거 자료 맞추기', '근거 자료·정의', '빠진 값'],
    [2, '변경·보류 흐름', '실제 적용', '업무 지연'],
    [3, '재확인·배정', '경로·다시 확인', '무권한 승인'],
    [4, '성과·보호 지표 계산 확인', '전후 비교·인계', '기록 부담'],
  ];
  const st = db.prepare('INSERT OR IGNORE INTO trial_weeks (engagement_id,week,focus,verify,protect) VALUES (?,?,?,?,?)');
  for (const r of rows) st.run(engId, ...r);
}

function createEngagement(ctx, p) {
  needActor(ctx);
  return audited(ctx, { action: 'case.create', subject: `${p.request_code}/${p.task_code}` }, () => {
    allow(ctx, 'case.create');
    for (const k of ['request_code', 'task_code', 'title', 'adapter_key', 'basis_date']) if (!String(p[k] ?? '').trim()) throw bad(`${k} 은(는) 필수입니다.`);
    const ad = ctx.db.prepare('SELECT * FROM adapters WHERE key=?').get(p.adapter_key);
    if (!ad) throw bad('어댑터를 찾을 수 없습니다.');
    const adapter = { ...ad, requirements: jparse(ad.requirements, []) };
    if (!Array.isArray(p.groups) || !p.groups.length) throw bad('하위 범주(groups)가 1개 이상 필요합니다.');
    for (const g of p.groups) if (!g.code || !g.name || !Number.isInteger(g.required) || g.required < 0) throw bad('groups 항목은 code/name/required(정수) 필요');
    normTs(p.basis_date);
    const t = now(ctx);
    let id;
    try {
      const info = ctx.db.prepare(`INSERT INTO engagements (request_code,task_code,title,adapter_id,basis_date,synthetic,notes,created_at) VALUES (?,?,?,?,?,?,?,?)`)
        .run(p.request_code, p.task_code, p.title, ad.id, p.basis_date, p.synthetic === false ? 0 : 1, p.notes || null, t);
      id = Number(info.lastInsertRowid);
    } catch (e) { if (/UNIQUE/.test(e.message)) throw conflict('같은 요청·과업 번호가 이미 있습니다.'); throw e; }
    for (const g of p.groups) ctx.db.prepare('INSERT INTO groups (engagement_id,code,name,required) VALUES (?,?,?,?)').run(id, g.code, g.name, g.required);
    ctx.db.prepare(`INSERT INTO rule_versions (engagement_id,version,effective_from,required_keys,note) VALUES (?,?,?,?,?)`).run(id, 1, '1970-01-01T00:00:00.000Z', JSON.stringify(adapter.requirements.map((r) => r.key)), '초기 규칙: 어댑터의 준비 요건 전체');
    defaultTrialWeeks(ctx.db, id);
    return { id };
  });
}

// 규칙 버전 추가 — 과거 기록은 그 시점에 유효한 규칙으로 재평가된다
function addRuleVersion(ctx, engId, p) {
  needActor(ctx);
  return audited(ctx, { engagementId: engId, action: 'rule.add', subject: `v?` }, () => {
    if (!['consultant', 'exec'].includes(ctx.actor.role)) throw forbidden('권한 없음: 판정 규칙은 컨설턴트가 제안하고 경영진이 확정합니다(컨설턴트·경영진만 변경).');
    const eng = svc.getEng(ctx, engId);
    if (!Array.isArray(p.required_keys) || !p.required_keys.length) throw bad('required_keys 필요');
    for (const k of p.required_keys) if (!eng.adapter.requirements.some((r) => r.key === k)) throw bad(`알 수 없는 요건: ${k}`);
    if (!p.effective_from) throw bad('effective_from 필요');
    const ver = ctx.db.prepare('SELECT COALESCE(MAX(version),0)+1 v FROM rule_versions WHERE engagement_id=?').get(engId).v;
    ctx.db.prepare('INSERT INTO rule_versions (engagement_id,version,effective_from,required_keys,note) VALUES (?,?,?,?,?)').run(engId, ver, normTs(p.effective_from, false), JSON.stringify(p.required_keys), p.note || null);
    return { version: ver };
  });
}

module.exports = {
  FORMS, formDefs, formExamples, saveForm, getForms, TOOLS, toolList, toolSave, toolDelete, hypothesesView, saveHypothesis,
  trialWeeks, updateTrialWeek, closeDay, dailyCloses, compare, report, createAdapter, createEngagement, defaultTrialWeeks, addRuleVersion,
};
