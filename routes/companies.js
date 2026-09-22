const express = require('express');
const db = require('../lib/db');
const { requireAdmin } = require('../lib/auth');

const router = express.Router();
router.use(requireAdmin);

function normalizeBizRegNo(raw) {
  const digits = String(raw).replace(/[^0-9]/g, '');
  if (!digits) return null;
  if (digits.length !== 10) return { error: true };
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

function serialize(row) {
  return {
    id: row.id,
    name: row.name,
    bizRegNo: row.biz_reg_no,
    ceoName: row.ceo_name,
    industry: row.industry,
    region: row.region,
    address: row.address,
    employeeCount: row.employee_count,
    foundedDate: row.founded_date,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    contactEmail: row.contact_email,
    memo: row.memo,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function readPayload(body, existing) {
  const { name, bizRegNo, ceoName, industry, region, address, employeeCount, foundedDate, contactName, contactPhone, contactEmail, memo } = body || {};

  let nextBizRegNo = existing ? existing.biz_reg_no : null;
  if (bizRegNo !== undefined) {
    if (!bizRegNo || !String(bizRegNo).trim()) {
      nextBizRegNo = null;
    } else {
      const normalized = normalizeBizRegNo(bizRegNo);
      if (!normalized || normalized.error) return { error: '사업자등록번호는 숫자 10자리로 입력해주세요.' };
      nextBizRegNo = normalized;
    }
  }

  let nextEmployeeCount = existing ? existing.employee_count : null;
  if (employeeCount !== undefined) {
    if (employeeCount === '' || employeeCount === null) {
      nextEmployeeCount = null;
    } else {
      const n = Number(employeeCount);
      if (!Number.isInteger(n) || n < 0) return { error: '직원수는 0 이상의 정수로 입력해주세요.' };
      nextEmployeeCount = n;
    }
  }

  return {
    values: {
      name: name !== undefined ? String(name).trim() : existing.name,
      biz_reg_no: nextBizRegNo,
      ceo_name: ceoName !== undefined ? (ceoName ? String(ceoName).trim() : null) : existing.ceo_name,
      industry: industry !== undefined ? (industry ? String(industry).trim() : null) : existing.industry,
      region: region !== undefined ? (region ? String(region).trim() : null) : existing.region,
      address: address !== undefined ? (address ? String(address).trim() : null) : existing.address,
      employee_count: nextEmployeeCount,
      founded_date: foundedDate !== undefined ? (foundedDate || null) : existing.founded_date,
      contact_name: contactName !== undefined ? (contactName ? String(contactName).trim() : null) : existing.contact_name,
      contact_phone: contactPhone !== undefined ? (contactPhone ? String(contactPhone).trim() : null) : existing.contact_phone,
      contact_email: contactEmail !== undefined ? (contactEmail ? String(contactEmail).trim() : null) : existing.contact_email,
      memo: memo !== undefined ? (memo ? String(memo).trim() : null) : existing.memo,
    },
  };
}

// GET /api/companies?q=검색어
router.get('/', (req, res) => {
  const q = req.query.q ? String(req.query.q).trim() : '';
  let rows;
  if (q) {
    const like = `%${q}%`;
    rows = db.prepare(`
      SELECT * FROM companies
      WHERE name LIKE ? OR biz_reg_no LIKE ? OR ceo_name LIKE ? OR industry LIKE ?
      ORDER BY updated_at DESC
    `).all(like, like, like, like);
  } else {
    rows = db.prepare('SELECT * FROM companies ORDER BY updated_at DESC').all();
  }
  res.json({ companies: rows.map(serialize) });
});

// POST /api/companies
router.post('/', (req, res) => {
  const { name } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: '기업명을 입력해주세요.' });

  const parsed = readPayload(req.body, { name: '', biz_reg_no: null, ceo_name: null, industry: null, region: null, address: null, employee_count: null, founded_date: null, contact_name: null, contact_phone: null, contact_email: null, memo: null });
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const v = parsed.values;

  try {
    const info = db.prepare(`
      INSERT INTO companies (name, biz_reg_no, ceo_name, industry, region, address, employee_count, founded_date, contact_name, contact_phone, contact_email, memo)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(v.name, v.biz_reg_no, v.ceo_name, v.industry, v.region, v.address, v.employee_count, v.founded_date, v.contact_name, v.contact_phone, v.contact_email, v.memo);
    const row = db.prepare('SELECT * FROM companies WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(serialize(row));
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: '이미 등록된 사업자등록번호입니다.' });
    }
    throw err;
  }
});

// GET /api/companies/:id
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '기업 정보를 찾을 수 없습니다.' });
  res.json(serialize(row));
});

// PATCH /api/companies/:id
router.patch('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: '기업 정보를 찾을 수 없습니다.' });

  const parsed = readPayload(req.body, existing);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const v = parsed.values;
  if (!v.name) return res.status(400).json({ error: '기업명을 입력해주세요.' });

  try {
    db.prepare(`
      UPDATE companies SET name = ?, biz_reg_no = ?, ceo_name = ?, industry = ?, region = ?, address = ?,
        employee_count = ?, founded_date = ?, contact_name = ?, contact_phone = ?, contact_email = ?, memo = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(v.name, v.biz_reg_no, v.ceo_name, v.industry, v.region, v.address, v.employee_count, v.founded_date, v.contact_name, v.contact_phone, v.contact_email, v.memo, existing.id);
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: '이미 등록된 사업자등록번호입니다.' });
    }
    throw err;
  }

  const updated = db.prepare('SELECT * FROM companies WHERE id = ?').get(existing.id);
  res.json(serialize(updated));
});

// DELETE /api/companies/:id
router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM companies WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: '기업 정보를 찾을 수 없습니다.' });
  res.status(204).end();
});

module.exports = router;
