const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');

const FONT_REGULAR = require.resolve('@fontsource/noto-sans-kr/files/noto-sans-kr-korean-400-normal.woff2');
const FONT_BOLD = require.resolve('@fontsource/noto-sans-kr/files/noto-sans-kr-korean-700-normal.woff2');

const MARGIN = 42;
const PAGE_BOTTOM = 792 - MARGIN; // A4-ish (pdfkit default letter; we set size below)

function yn(v) {
  if (v === 'Y' || v === true) return 'Y';
  if (v === 'N' || v === false) return 'N';
  return v || '-';
}

function fmt(v) {
  if (v === undefined || v === null || v === '') return '-';
  return String(v);
}

function ensureSpace(doc, needed) {
  if (doc.y + needed > doc.page.height - MARGIN) {
    doc.addPage();
  }
}

function h1(doc, text) {
  doc.font('kr-bold').fontSize(18).fillColor('#1a202c').text(text, { align: 'center' });
  doc.moveDown(0.6);
}

function h2(doc, text) {
  ensureSpace(doc, 40);
  doc.moveDown(0.5);
  doc.font('kr-bold').fontSize(12.5).fillColor('#2b6cb0').text(text);
  const underlineY = doc.y + 2;
  doc.moveTo(MARGIN, underlineY).lineTo(doc.page.width - MARGIN, underlineY).strokeColor('#90cdf4').lineWidth(1.5).stroke();
  doc.fillColor('#1a202c');
  doc.moveDown(0.7);
}

function h3(doc, text) {
  ensureSpace(doc, 20);
  doc.font('kr-bold').fontSize(10.5).fillColor('#2d3748').text(text);
  doc.fillColor('#1a202c');
  doc.moveDown(0.2);
}

// pairs: array of [label, value] tuples; an empty/absent second tuple in a
// row is allowed (e.g. [pairA, null] or an odd-length array) to end a row early.
function kv(doc, pairs) {
  const colWidth = (doc.page.width - MARGIN * 2) / 2;
  const valueWidth = colWidth - 100;
  for (let i = 0; i < pairs.length; i += 2) {
    const p1 = pairs[i];
    const p2raw = pairs[i + 1];
    const p2 = Array.isArray(p2raw) && p2raw.length === 2 ? p2raw : null;

    doc.font('kr').fontSize(9.5);
    const height1 = doc.heightOfString(fmt(p1[1]), { width: valueWidth });
    const height2 = p2 ? doc.heightOfString(fmt(p2[1]), { width: valueWidth }) : 0;
    const rowHeight = Math.max(height1, height2, 13) + 5;

    ensureSpace(doc, rowHeight);
    const y = doc.y;
    doc.font('kr-bold').fillColor('#4a5568').text(p1[0], MARGIN, y, { width: 90 });
    doc.font('kr').fillColor('#1a202c').text(fmt(p1[1]), MARGIN + 92, y, { width: valueWidth });
    if (p2) {
      doc.font('kr-bold').fillColor('#4a5568').text(p2[0], MARGIN + colWidth, y, { width: 90 });
      doc.font('kr').fillColor('#1a202c').text(fmt(p2[1]), MARGIN + colWidth + 92, y, { width: valueWidth });
    }
    doc.y = y + rowHeight;
  }
  doc.moveDown(0.3);
}

function paragraph(doc, text) {
  const width = doc.page.width - MARGIN * 2;
  const content = fmt(text) === '-' ? '입력된 내용이 없습니다.' : fmt(text);
  doc.font('kr').fontSize(9.5);
  const h = doc.heightOfString(content, { width });
  ensureSpace(doc, h + 6);
  doc.fillColor('#1a202c').text(content, { width });
  doc.moveDown(0.4);
}

function rowsList(doc, columns, rows) {
  if (!rows || !rows.length) {
    ensureSpace(doc, 16);
    doc.font('kr').fontSize(9).fillColor('#a0aec0').text('입력된 항목이 없습니다.');
    doc.moveDown(0.3);
    return;
  }
  const width = doc.page.width - MARGIN * 2;
  rows.forEach((row, idx) => {
    const line = `${idx + 1}. ${columns.map(([label, key]) => `${label}: ${fmt(row[key])}`).join('   |   ')}`;
    doc.font('kr').fontSize(9);
    const h = doc.heightOfString(line, { width });
    ensureSpace(doc, h + 5);
    doc.fillColor('#1a202c').text(line, { width });
    doc.moveDown(0.15);
  });
  doc.moveDown(0.3);
}

function buildSurveyPdf(doc, survey, attachments) {
  doc.registerFont('kr', FONT_REGULAR);
  doc.registerFont('kr-bold', FONT_BOLD);

  h1(doc, '기업조사표');
  doc.font('kr').fontSize(9).fillColor('#718096').text(`생성일시: ${new Date().toLocaleString('ko-KR')}`, { align: 'center' });
  doc.moveDown(1);

  h2(doc, '작성정보 / 기업개요');
  kv(doc, [
    ['조사방식', survey.surveyMethod], ['조사방법', survey.surveyChannel],
    ['조사일', survey.surveyDate], ['담당자 부서/직위', survey.contactDeptPosition],
    ['담당자 연락처', survey.contactPhone],
  ]);
  kv(doc, [
    ['업체명', survey.companyName], ['사업자등록번호', survey.bizRegNo],
    ['대표자명', survey.ceoName],
    ['사무직', survey.empOffice], ['기술직', survey.empTech],
    ['생산직', survey.empProduction], ['기타', survey.empOther],
    ['마케팅 전담부서', yn(survey.marketingDeptYn)], ['마케팅 전담인력수', survey.marketingHeadcount],
    ['매출액(백만원)', survey.revenueMillion], ['매출비중(%)', survey.revenueRatio],
    ['주요제품/상품/서비스', survey.mainProduct], ['주요기술', survey.mainTech],
  ]);

  h3(doc, '기술개요 및 종합의견');
  paragraph(doc, survey.techOverviewOpinion);

  h3(doc, '주요 사업현황');
  rowsList(doc, [['제품/서비스', 'product'], ['매출액', 'revenue'], ['매출비중(%)', 'ratio'], ['주요기술', 'tech']], survey.businessStatus);

  h3(doc, '확인 자료');
  paragraph(doc, (survey.docsChecked || []).join(', '));

  h2(doc, '1. 경영주 및 경영진 현황');
  const owner = survey.ownerInfo || {};
  kv(doc, [
    ['경영주 성명', owner.name], ['생년월일', owner.birthDate],
    ['경영형태', owner.mgmtType], ['졸업년도', owner.gradYear],
    ['최종학력', owner.eduLevel], ['전공', owner.major],
    ['보유자격증', owner.cert], ['취득년도', owner.certYear],
  ]);
  h3(doc, '경영주 주요경력');
  rowsList(doc, [['기간', 'period'], ['근무처', 'company'], ['업종', 'industry'], ['담당업무', 'duty'], ['최종직위', 'position']], owner.careers);

  h3(doc, '경영진');
  rowsList(doc, [['성명', 'name'], ['직위', 'position'], ['담당업무', 'duty'], ['대표자와관계', 'relation'], ['학력', 'eduLevel'], ['동업종경력(년)', 'careerYears']], survey.executives);

  const mc = survey.mgmtCapability || {};
  h3(doc, '기술경영 관리능력 / 신뢰성');
  paragraph(doc, [
    mc.planningNote && `경영기획: ${mc.planningNote}`,
    mc.infoCollect && `정보수집능력: ${mc.infoCollect}`,
    mc.techStrategy && `기술전략: ${mc.techStrategy}`,
    mc.commercializeResult && `사업화실적: ${mc.commercializeResult}`,
    mc.entrepreneurship && `기업가정신: ${mc.entrepreneurship}`,
  ].filter(Boolean).join('\n'));

  h2(doc, '2. 기술개발 환경 및 실적');
  const rnd = survey.rndOrg || {};
  kv(doc, [['연구개발조직', (rnd.types || []).join(', ')], ['인정일', rnd.recognizedDate]]);
  h3(doc, '기술인력 정보');
  rowsList(doc, [['성명', 'name'], ['소속부서', 'dept'], ['담당업무', 'duty'], ['최종학력', 'eduLevel'], ['동업종경력', 'careerYears']], survey.techStaff);

  h3(doc, '지식재산권 보유현황');
  const ip = survey.ipRights || {};
  rowsList(doc, [['구분', 'type'], ['출원(등록)번호', 'appRegNo'], ['명칭', 'name'], ['권리자', 'holder']], ip.rows);

  h3(doc, '인증 / 수상');
  rowsList(doc, [['인증명', 'name'], ['인증번호', 'no'], ['유효기간', 'validity']], survey.certifications);
  rowsList(doc, [['수상명', 'name'], ['수상기관', 'org'], ['수상일자', 'date']], survey.awards);

  const tdr = survey.techDevResults || {};
  h3(doc, '기술개발 실적');
  kv(doc, [
    ['기술개발 실적(건)', tdr.devCount], ['상용화 실적(건)', tdr.commercializeCount],
    ['제품 상용화 실적(건)', tdr.productCommercializeCount], ['수상 실적(건)', tdr.awardCount],
    ['인증 실적(건)', tdr.certCount],
  ]);
  paragraph(doc, [tdr.devDesc, tdr.commercializeDesc, tdr.productDesc, tdr.awardDesc, tdr.certDesc].filter(Boolean).join('\n'));

  h2(doc, '3. 생산 및 사업 현황');
  const prod = survey.production || {};
  const ratio = prod.ratio || {};
  kv(doc, [
    ['자체생산비율(%)', ratio.self], ['외주생산비율(%)', ratio.outsource],
    ['주문생산비율(%)', ratio.order], ['시장생산비율(%)', ratio.market],
  ]);
  h3(doc, '생산시설');
  rowsList(doc, [['시설명', 'name'], ['규격', 'spec'], ['주요용도', 'usage']], prod.facilities);
  h3(doc, '외주업체');
  rowsList(doc, [['업체명', 'name'], ['비고', 'note']], (prod.outsource || {}).vendors);

  const inv = survey.investment || {};
  h3(doc, '투자계획 및 자본조달');
  kv(doc, [['상용화 구분', inv.commercializationStage]]);
  rowsList(doc, [['조달방법', 'method'], ['기조달액', 'funded'], ['추가조달예정액', 'planned']], inv.rows);

  h3(doc, '판매처');
  rowsList(doc, [['판매처명', 'name'], ['사업자등록번호', 'bizRegNo'], ['비중(%)', 'ratio'], ['거래기간', 'period']], survey.clients);

  const mkt = survey.marketingCapability || {};
  h3(doc, '마케팅 역량');
  paragraph(doc, mkt.note);

  h2(doc, '4. 기술경쟁력');
  const tc = survey.techCompetitiveness || {};
  kv(doc, [
    ['핵심기술명', tc.coreTechName], ['혁신성', tc.innovation],
    ['기술수명주기', tc.lifecycle], ['차별성', tc.differentiation],
  ]);
  const ms = survey.marketStatus || {};
  h3(doc, '시장현황');
  kv(doc, [['목표시장', ms.targetMarket], ['경쟁업체', ms.competitors], ['시장집중도', ms.concentration], ['관련 정부정책', ms.govPolicy]]);
  const pa = survey.productAdvantage || {};
  h3(doc, '제품우위성');
  kv(doc, [
    ['자체상표비중(%)', pa.ownBrandRatio], ['보유브랜드', pa.brand],
    ['영업망보유', pa.salesNetwork], ['원가경쟁력', pa.costCompetitiveness],
  ]);

  const productImages = (attachments || []).filter((a) => a.category === 'product_image');
  if (productImages.length) {
    h2(doc, '제품 이미지');
    let x = MARGIN;
    let rowTop = doc.y;
    const imgSize = 140;
    productImages.forEach((att, idx) => {
      if (x + imgSize > doc.page.width - MARGIN) {
        x = MARGIN;
        rowTop += imgSize + 20;
      }
      if (rowTop + imgSize > doc.page.height - MARGIN) {
        doc.addPage();
        rowTop = doc.y;
        x = MARGIN;
      }
      try {
        doc.image(att.filePath, x, rowTop, { fit: [imgSize, imgSize] });
      } catch (e) { /* skip unreadable image */ }
      x += imgSize + 16;
    });
    doc.y = rowTop + imgSize + 20;
  }
}

module.exports = { buildSurveyPdf, PDFDocument };
