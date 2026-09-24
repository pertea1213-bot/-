const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const db = require('../lib/db');
const { requireAdmin } = require('../lib/auth');
const { buildWorkbook } = require('../lib/surveyExcel');
const { buildSurveyPdf, PDFDocument } = require('../lib/surveyPdf');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', 'data', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = ALLOWED_MIME[file.mimetype] || '';
      cb(null, `${Date.now()}-${crypto.randomBytes(10).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 10, fieldSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME[file.mimetype]) return cb(new Error('허용되지 않는 파일 형식입니다. (jpg/png/webp/pdf만 가능)'));
    cb(null, true);
  },
});

// --- 공개 제출 엔드포인트 간단 rate limit (IP당 시간당 N회) ---
const submitLog = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX = 10;

function checkRateLimit(ip) {
  const now = Date.now();
  const arr = (submitLog.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (arr.length >= RATE_LIMIT_MAX) {
    submitLog.set(ip, arr);
    return false;
  }
  arr.push(now);
  submitLog.set(ip, arr);
  return true;
}

function parseJSON(raw, fallback) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  try {
    const v = JSON.parse(raw);
    return v === null ? fallback : v;
  } catch {
    return fallback;
  }
}

function toNum(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toInt(v) {
  const n = toNum(v);
  return n === null ? null : Math.round(n);
}

function normalizeBizRegNo(raw) {
  if (!raw) return { value: null };
  const digits = String(raw).replace(/[^0-9]/g, '');
  if (!digits) return { value: null };
  if (digits.length !== 10) return { error: true };
  return { value: `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}` };
}

function cleanupFiles(req) {
  if (!req.files) return;
  Object.values(req.files).forEach((arr) => {
    arr.forEach((f) => {
      fs.unlink(f.path, () => {});
    });
  });
}

function sanitizeOriginalName(name) {
  return String(name || 'file').replace(/[\r\n"]/g, '').slice(0, 200);
}

function serialize(row) {
  return {
    id: row.id,
    surveyMethod: row.survey_method,
    surveyChannel: row.survey_channel,
    surveyDate: row.survey_date,
    contactDeptPosition: row.contact_dept_position,
    contactPhone: row.contact_phone,
    companyName: row.company_name,
    bizRegNo: row.biz_reg_no,
    ceoName: row.ceo_name,
    empOffice: row.emp_office,
    empTech: row.emp_tech,
    empProduction: row.emp_production,
    empOther: row.emp_other,
    marketingDeptYn: row.marketing_dept_yn,
    marketingHeadcount: row.marketing_headcount,
    mainProduct: row.main_product,
    revenueMillion: row.revenue_million,
    revenueRatio: row.revenue_ratio,
    mainTech: row.main_tech,
    techOverviewOpinion: row.tech_overview_opinion,
    docsChecked: parseJSON(row.docs_checked, []),
    businessStatus: parseJSON(row.business_status, []),
    ownerInfo: parseJSON(row.owner_info, {}),
    executives: parseJSON(row.executives, []),
    mgmtCapability: parseJSON(row.mgmt_capability, {}),
    rndOrg: parseJSON(row.rnd_org, {}),
    techStaff: parseJSON(row.tech_staff, []),
    techStaffMgmt: parseJSON(row.tech_staff_mgmt, {}),
    ipRights: parseJSON(row.ip_rights, {}),
    certifications: parseJSON(row.certifications, []),
    awards: parseJSON(row.awards, []),
    techDevResults: parseJSON(row.tech_dev_results, {}),
    production: parseJSON(row.production, {}),
    investment: parseJSON(row.investment, {}),
    clients: parseJSON(row.clients, []),
    marketingCapability: parseJSON(row.marketing_capability, {}),
    techCompetitiveness: parseJSON(row.tech_competitiveness, {}),
    marketStatus: parseJSON(row.market_status, {}),
    productAdvantage: parseJSON(row.product_advantage, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeAttachment(row) {
  return {
    id: row.id,
    surveyId: row.survey_id,
    category: row.category,
    originalName: row.original_name,
    mimeType: row.mime_type,
    size: row.size,
    createdAt: row.created_at,
  };
}

function getAttachments(surveyId) {
  return db.prepare('SELECT * FROM survey_attachments WHERE survey_id = ? ORDER BY id ASC').all(surveyId);
}

// POST /api/surveys — 공개 제출 (로그인 불필요)
router.post('/', (req, res) => {
  upload.fields([
    { name: 'productImages', maxCount: 5 },
    { name: 'rndFiles', maxCount: 5 },
  ])(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || '파일 업로드 중 오류가 발생했습니다.' });
    handleSubmit(req, res);
  });
});

function handleSubmit(req, res) {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';

  // 허니팟: 봇이 채운 경우 성공한 것처럼 응답하되 저장하지 않음
  if (req.body.website) {
    cleanupFiles(req);
    return res.status(201).json({ id: 0, companyName: req.body.companyName || '' });
  }

  if (!checkRateLimit(ip)) {
    cleanupFiles(req);
    return res.status(429).json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' });
  }

  const body = req.body || {};
  if (!body.companyName || !String(body.companyName).trim()) {
    cleanupFiles(req);
    return res.status(400).json({ error: '업체명을 입력해주세요.' });
  }

  const bizRegNo = normalizeBizRegNo(body.bizRegNo);
  if (bizRegNo.error) {
    cleanupFiles(req);
    return res.status(400).json({ error: '사업자등록번호는 숫자 10자리로 입력해주세요.' });
  }

  const values = {
    survey_method: body.surveyMethod || null,
    survey_channel: body.surveyChannel || null,
    survey_date: body.surveyDate || null,
    contact_dept_position: body.contactDeptPosition || null,
    contact_phone: body.contactPhone || null,
    company_name: String(body.companyName).trim(),
    biz_reg_no: bizRegNo.value,
    ceo_name: body.ceoName || null,
    emp_office: toInt(body.empOffice),
    emp_tech: toInt(body.empTech),
    emp_production: toInt(body.empProduction),
    emp_other: toInt(body.empOther),
    marketing_dept_yn: body.marketingDeptYn || null,
    marketing_headcount: toInt(body.marketingHeadcount),
    main_product: body.mainProduct || null,
    revenue_million: toNum(body.revenueMillion),
    revenue_ratio: toNum(body.revenueRatio),
    main_tech: body.mainTech || null,
    tech_overview_opinion: body.techOverviewOpinion || null,
    docs_checked: JSON.stringify(parseJSON(body.docsChecked, [])),
    business_status: JSON.stringify(parseJSON(body.businessStatus, [])),
    owner_info: JSON.stringify(parseJSON(body.ownerInfo, {})),
    executives: JSON.stringify(parseJSON(body.executives, [])),
    mgmt_capability: JSON.stringify(parseJSON(body.mgmtCapability, {})),
    rnd_org: JSON.stringify(parseJSON(body.rndOrg, {})),
    tech_staff: JSON.stringify(parseJSON(body.techStaff, [])),
    tech_staff_mgmt: JSON.stringify(parseJSON(body.techStaffMgmt, {})),
    ip_rights: JSON.stringify(parseJSON(body.ipRights, {})),
    certifications: JSON.stringify(parseJSON(body.certifications, [])),
    awards: JSON.stringify(parseJSON(body.awards, [])),
    tech_dev_results: JSON.stringify(parseJSON(body.techDevResults, {})),
    production: JSON.stringify(parseJSON(body.production, {})),
    investment: JSON.stringify(parseJSON(body.investment, {})),
    clients: JSON.stringify(parseJSON(body.clients, [])),
    marketing_capability: JSON.stringify(parseJSON(body.marketingCapability, {})),
    tech_competitiveness: JSON.stringify(parseJSON(body.techCompetitiveness, {})),
    market_status: JSON.stringify(parseJSON(body.marketStatus, {})),
    product_advantage: JSON.stringify(parseJSON(body.productAdvantage, {})),
  };

  const cols = Object.keys(values);
  const info = db.prepare(`
    INSERT INTO surveys (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
  `).run(...cols.map((c) => values[c]));

  const surveyId = info.lastInsertRowid;

  const insertAttachment = db.prepare(`
    INSERT INTO survey_attachments (survey_id, category, original_name, stored_name, mime_type, size)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const files = req.files || {};
  (files.productImages || []).forEach((f) => {
    insertAttachment.run(surveyId, 'product_image', sanitizeOriginalName(f.originalname), f.filename, f.mimetype, f.size);
  });
  (files.rndFiles || []).forEach((f) => {
    insertAttachment.run(surveyId, 'rnd_result', sanitizeOriginalName(f.originalname), f.filename, f.mimetype, f.size);
  });

  res.status(201).json({ id: surveyId, companyName: values.company_name });
}

// GET /api/surveys/summary — 대시보드 통계 (admin)
router.get('/summary', requireAdmin, (req, res) => {
  const total = db.prepare('SELECT COUNT(*) AS n FROM surveys').get().n;
  const employees = db.prepare(`
    SELECT COALESCE(SUM(COALESCE(emp_office,0)+COALESCE(emp_tech,0)+COALESCE(emp_production,0)+COALESCE(emp_other,0)),0) AS n
    FROM surveys
  `).get().n;
  const avgRevenue = db.prepare('SELECT AVG(revenue_million) AS n FROM surveys WHERE revenue_million IS NOT NULL').get().n;
  const recent = db.prepare(`SELECT COUNT(*) AS n FROM surveys WHERE created_at >= datetime('now', '-7 days')`).get().n;
  const marketingYes = db.prepare(`SELECT COUNT(*) AS n FROM surveys WHERE marketing_dept_yn = 'Y'`).get().n;
  res.json({
    totalCompanies: total,
    totalEmployees: employees,
    avgRevenueMillion: avgRevenue ? Math.round(avgRevenue * 10) / 10 : null,
    submissionsLast7Days: recent,
    marketingDeptYesCount: marketingYes,
  });
});

// GET /api/surveys/export/excel (admin)
router.get('/export/excel', requireAdmin, async (req, res) => {
  const rows = db.prepare('SELECT * FROM surveys ORDER BY created_at DESC').all().map(serialize);
  const workbook = buildWorkbook(rows);
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="company-surveys-${stamp}.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
});

// GET /api/surveys/:id/export/pdf (admin)
router.get('/:id/export/pdf', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM surveys WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '기업 정보를 찾을 수 없습니다.' });
  const survey = serialize(row);
  const attachmentRows = getAttachments(row.id).map((a) => ({
    category: a.category,
    filePath: path.join(UPLOAD_DIR, a.stored_name),
  }));

  const doc = new PDFDocument({ size: 'A4', margin: 42, bufferPages: true });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="survey-${row.id}.pdf"`);
  doc.pipe(res);
  buildSurveyPdf(doc, survey, attachmentRows);
  doc.end();
});

// GET /api/surveys — 목록 (admin)
router.get('/', requireAdmin, (req, res) => {
  const q = req.query.q ? String(req.query.q).trim() : '';
  let rows;
  if (q) {
    const like = `%${q}%`;
    rows = db.prepare(`
      SELECT * FROM surveys WHERE company_name LIKE ? OR biz_reg_no LIKE ? OR ceo_name LIKE ?
      ORDER BY created_at DESC
    `).all(like, like, like);
  } else {
    rows = db.prepare('SELECT * FROM surveys ORDER BY created_at DESC').all();
  }
  const surveyIds = rows.map((r) => r.id);
  const counts = {};
  if (surveyIds.length) {
    const placeholders = surveyIds.map(() => '?').join(',');
    db.prepare(`SELECT survey_id, COUNT(*) AS n FROM survey_attachments WHERE survey_id IN (${placeholders}) GROUP BY survey_id`)
      .all(...surveyIds).forEach((r) => { counts[r.survey_id] = r.n; });
  }
  res.json({ surveys: rows.map((r) => ({ ...serialize(r), attachmentCount: counts[r.id] || 0 })) });
});

// GET /api/surveys/attachments/:id/file (admin)
router.get('/attachments/:id/file', requireAdmin, (req, res) => {
  const att = db.prepare('SELECT * FROM survey_attachments WHERE id = ?').get(req.params.id);
  if (!att) return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
  const filePath = path.join(UPLOAD_DIR, att.stored_name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
  res.setHeader('Content-Type', att.mime_type);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(sanitizeOriginalName(att.original_name))}"`);
  fs.createReadStream(filePath).pipe(res);
});

// GET /api/surveys/:id (admin)
router.get('/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM surveys WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '기업 정보를 찾을 수 없습니다.' });
  const attachments = getAttachments(row.id).map(serializeAttachment);
  res.json({ ...serialize(row), attachments });
});

// DELETE /api/surveys/:id (admin)
router.delete('/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM surveys WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '기업 정보를 찾을 수 없습니다.' });
  const attachments = getAttachments(row.id);
  db.prepare('DELETE FROM surveys WHERE id = ?').run(row.id);
  attachments.forEach((a) => {
    fs.unlink(path.join(UPLOAD_DIR, a.stored_name), () => {});
  });
  res.status(204).end();
});

module.exports = router;
