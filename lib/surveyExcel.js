const ExcelJS = require('exceljs');

function autoWidth(sheet) {
  sheet.columns.forEach((col) => {
    let max = 10;
    col.eachCell({ includeEmpty: true }, (cell) => {
      const len = cell.value ? String(cell.value).length : 0;
      if (len > max) max = len;
    });
    col.width = Math.min(max + 2, 50);
  });
}

function headerRow(sheet, headers) {
  const row = sheet.addRow(headers);
  row.font = { bold: true };
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
  });
}

// surveys: array of parsed survey objects (as returned by serialize())
function buildWorkbook(surveys) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '기업정보 플랫폼';
  workbook.created = new Date();

  const list = workbook.addWorksheet('기업목록');
  list.columns = [
    { header: 'ID' }, { header: '업체명' }, { header: '사업자등록번호' }, { header: '대표자명' },
    { header: '사무직' }, { header: '기술직' }, { header: '생산직' }, { header: '기타' }, { header: '합계' },
    { header: '마케팅전담부서' }, { header: '마케팅인력수' }, { header: '주요제품/서비스' },
    { header: '매출액(백만원)' }, { header: '매출비중(%)' }, { header: '주요기술' },
    { header: '조사방식' }, { header: '조사방법' }, { header: '조사일' }, { header: '담당자연락처' },
    { header: '등록일시' },
  ];
  headerRow(list, list.columns.map((c) => c.header));
  surveys.forEach((s) => {
    const total = [s.empOffice, s.empTech, s.empProduction, s.empOther].reduce((a, b) => a + (Number(b) || 0), 0);
    list.addRow([
      s.id, s.companyName, s.bizRegNo, s.ceoName,
      s.empOffice, s.empTech, s.empProduction, s.empOther, total,
      s.marketingDeptYn, s.marketingHeadcount, s.mainProduct,
      s.revenueMillion, s.revenueRatio, s.mainTech,
      s.surveyMethod, s.surveyChannel, s.surveyDate, s.contactPhone,
      s.createdAt,
    ]);
  });
  autoWidth(list);

  const exec = workbook.addWorksheet('경영진');
  headerRow(exec, ['기업ID', '업체명', '성명', '직위', '담당업무', '대표자와관계', '최종학력', '전공', '동업종경력(년)', '인정자격증', '주요경력']);
  surveys.forEach((s) => {
    (s.executives || []).forEach((e) => {
      exec.addRow([s.id, s.companyName, e.name, e.position, e.duty, e.relation, e.eduLevel, e.major, e.careerYears, e.cert, e.mainCareer]);
    });
  });
  autoWidth(exec);

  const staff = workbook.addWorksheet('기술인력');
  headerRow(staff, ['기업ID', '업체명', '순번', '성명', '소속부서', '담당업무', '최종학력', '전공', '자격증명', '자격증취득일', '동업종경력']);
  surveys.forEach((s) => {
    (s.techStaff || []).forEach((t) => {
      staff.addRow([s.id, s.companyName, t.no, t.name, t.dept, t.duty, t.eduLevel, t.major, t.cert, t.certDate, t.careerYears]);
    });
  });
  autoWidth(staff);

  const ip = workbook.addWorksheet('지식재산권');
  headerRow(ip, ['기업ID', '업체명', '구분', '출원(등록)번호', '명칭', '권리자']);
  surveys.forEach((s) => {
    ((s.ipRights && s.ipRights.rows) || []).forEach((r) => {
      ip.addRow([s.id, s.companyName, r.type, r.appRegNo, r.name, r.holder]);
    });
  });
  autoWidth(ip);

  const cert = workbook.addWorksheet('인증');
  headerRow(cert, ['기업ID', '업체명', '인증명', '인증번호', '유효기간']);
  surveys.forEach((s) => {
    (s.certifications || []).forEach((c) => {
      cert.addRow([s.id, s.companyName, c.name, c.no, c.validity]);
    });
  });
  autoWidth(cert);

  const award = workbook.addWorksheet('수상');
  headerRow(award, ['기업ID', '업체명', '수상명', '수상기관', '수상일자']);
  surveys.forEach((s) => {
    (s.awards || []).forEach((a) => {
      award.addRow([s.id, s.companyName, a.name, a.org, a.date]);
    });
  });
  autoWidth(award);

  const clients = workbook.addWorksheet('판매처');
  headerRow(clients, ['기업ID', '업체명', '판매처명', '사업자등록번호', '비중(%)', '거래기간', '비고']);
  surveys.forEach((s) => {
    (s.clients || []).forEach((c) => {
      clients.addRow([s.id, s.companyName, c.name, c.bizRegNo, c.ratio, c.period, c.note]);
    });
  });
  autoWidth(clients);

  const invest = workbook.addWorksheet('투자계획');
  headerRow(invest, ['기업ID', '업체명', '조달방법', '기조달액', '추가조달예정액']);
  surveys.forEach((s) => {
    ((s.investment && s.investment.rows) || []).forEach((r) => {
      invest.addRow([s.id, s.companyName, r.method, r.funded, r.planned]);
    });
  });
  autoWidth(invest);

  return workbook;
}

module.exports = { buildWorkbook };
