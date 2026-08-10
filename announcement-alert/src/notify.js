import { readFile } from "node:fs/promises";
import path from "node:path";
import nodemailer from "nodemailer";
import { groupByCategory } from "./categorize.js";
import { getIssueNumber } from "./issueNumber.js";

const BRAND_COLOR = "#1a4b8c";

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatIssueDate(date = new Date()) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const week = Math.ceil(date.getDate() / 7);
  return `${year}년 ${month}월 ${week}주차`;
}

function renderBanner(subjectPrefix, tagline, bannerSubtitle, issueNumber) {
  const taglineHtml = tagline
    ? `<div style="font-size:13px;color:#a9c2e8;margin-bottom:8px;">${escapeHtml(tagline)}</div>`
    : "";
  const subtitleHtml = bannerSubtitle
    ? `<div style="font-size:13px;color:#dbe4f2;line-height:1.6;margin-top:12px;">${escapeHtml(bannerSubtitle)}</div>`
    : "";

  return `
    <table style="width:100%;border-collapse:collapse;margin-bottom:8px;">
      <tr>
        <td style="font-weight:700;font-size:14px;color:#1a1a1a;">${escapeHtml(subjectPrefix)}</td>
        <td style="text-align:right;color:#888;font-size:12px;">
          ${escapeHtml(formatIssueDate())} · VOL. ${issueNumber}
        </td>
      </tr>
    </table>
    <div style="background:${BRAND_COLOR};border-radius:8px;padding:32px 28px;margin-bottom:8px;">
      ${taglineHtml}
      <div style="font-size:24px;font-weight:800;color:#fff;line-height:1.3;">${escapeHtml(subjectPrefix)}</div>
      ${subtitleHtml}
    </div>`;
}

function renderSectionHeader(title) {
  return `
    <div style="border-top:3px solid ${BRAND_COLOR};padding:10px 0 8px;margin:28px 0 4px;">
      <span style="display:inline-block;width:6px;height:14px;background:${BRAND_COLOR};margin-right:6px;vertical-align:middle;"></span>
      <span style="font-weight:700;font-size:15px;color:#1a1a1a;vertical-align:middle;">${escapeHtml(title)}</span>
    </div>`;
}

function renderCommentarySection(commentary) {
  if (!commentary) return "";
  return `
    <div style="background:#f4f7fb;border-left:4px solid ${BRAND_COLOR};border-radius:6px;padding:16px;margin-bottom:8px;">
      <div style="font-size:12px;color:${BRAND_COLOR};font-weight:600;margin-bottom:8px;">오늘의 논평</div>
      <div style="white-space:pre-line;color:#333;font-size:14px;line-height:1.7;">${escapeHtml(commentary)}</div>
    </div>`;
}

function renderNewsRow(item) {
  const dateLabel = item.pubDate ? new Date(item.pubDate).toLocaleDateString("ko-KR") : "";
  const source = `${item.org}${dateLabel ? ` · ${dateLabel}` : ""}`;
  return `
    <div style="padding:14px 0;border-bottom:1px solid #eee;">
      <a href="${escapeHtml(item.url)}" style="color:#1a1a1a;text-decoration:none;font-weight:700;font-size:15px;">${escapeHtml(item.title)}</a>
      <div style="color:#999;font-size:12px;margin:6px 0 10px;">&lt;출처 : ${escapeHtml(source)}&gt;</div>
      <a href="${escapeHtml(item.url)}" style="display:inline-block;background:${BRAND_COLOR};color:#fff;font-size:12px;font-weight:600;text-decoration:none;padding:6px 14px;border-radius:16px;">+ 자세히 보기</a>
    </div>`;
}

function renderNewsSection(newsItems) {
  return `
    ${renderSectionHeader("정책 뉴스")}
    ${newsItems.map(renderNewsRow).join("")}`;
}

function renderAnnouncementRow(item) {
  return `
    <tr>
      <td style="padding:10px 4px;border-bottom:1px solid #eee;font-size:14px;">
        <a href="${escapeHtml(item.url)}" style="color:#1a1a1a;text-decoration:none;">${escapeHtml(item.title)}</a>
        <div style="color:#999;font-size:12px;margin-top:2px;">${escapeHtml(item.org)}</div>
      </td>
      <td style="padding:10px 4px;border-bottom:1px solid #eee;font-size:12px;color:#999;text-align:right;white-space:nowrap;vertical-align:top;">${item.deadline ? `- ${escapeHtml(item.deadline)}` : ""}</td>
    </tr>`;
}

function renderCategorySection(categoryName, items) {
  return `
    ${renderSectionHeader(`${categoryName} (${items.length})`)}
    <table style="width:100%;border-collapse:collapse;">${items.map(renderAnnouncementRow).join("")}</table>`;
}

function renderFooter(signatureImagePath, footerConfig) {
  const signature = signatureImagePath
    ? `
      <hr style="border:none;border-top:1px solid #ddd;margin:32px 0 16px;"/>
      <img src="cid:notifySignature" alt="" style="max-width:100%;display:block;"/>`
    : "";

  if (!footerConfig) return signature;

  const { companyName, address } = footerConfig;
  const year = new Date().getFullYear();

  return `
    ${signature}
    <div style="background:#2b2b2b;color:#fff;border-radius:8px;padding:20px;margin-top:24px;">
      <div style="font-weight:700;font-size:14px;margin-bottom:6px;">${escapeHtml(companyName)}</div>
      <div style="color:#bbb;font-size:12px;">${escapeHtml(address)}</div>
      <div style="color:#888;font-size:11px;margin-top:8px;">COPYRIGHT © ${year} ${escapeHtml(companyName)}. ALL RIGHT RESERVED</div>
    </div>
    <div style="text-align:center;color:#999;font-size:11px;margin-top:16px;line-height:1.6;">
      본 메일은 수신 동의하신 분께 발송되었습니다.<br/>
      더 이상 받고 싶지 않으시면 이 메일에 회신(수신거부)해주세요.
    </div>`;
}

function renderHtml(items, newsItems, commentary, config, issueNumber) {
  const { subjectPrefix, tagline, bannerSubtitle, signatureImagePath, footer } = config.notify;

  const fallbackLabel = config.notify.uncategorizedLabel ?? "기타";
  const groups = groupByCategory(items, config.categories ?? [], fallbackLabel);
  const announcementSections = groups
    .map(([categoryName, groupItems]) => renderCategorySection(categoryName, groupItems))
    .join("");

  const newsSection = newsItems.length > 0 ? renderNewsSection(newsItems) : "";

  return `
    <div style="font-family:sans-serif;max-width:640px;margin:0 auto;">
      ${renderBanner(subjectPrefix, tagline, bannerSubtitle, issueNumber)}
      ${renderCommentarySection(commentary)}
      ${newsSection}
      ${announcementSections}
      ${renderFooter(signatureImagePath, footer)}
    </div>`;
}

export async function sendDigestEmail(items, newsItems, commentary, config, { isTest = false } = {}) {
  const { GMAIL_USER, GMAIL_APP_PASSWORD, NOTIFY_TO } = process.env;

  if (!GMAIL_USER || !GMAIL_APP_PASSWORD || !NOTIFY_TO) {
    throw new Error(
      "GMAIL_USER / GMAIL_APP_PASSWORD / NOTIFY_TO 환경 변수가 필요합니다. announcement-alert/README.md를 참고하세요."
    );
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });

  const { signatureImagePath } = config.notify;
  const attachments = [];
  if (signatureImagePath) {
    const fileUrl = new URL(`../${signatureImagePath}`, import.meta.url);
    const content = await readFile(fileUrl);
    attachments.push({ filename: path.basename(signatureImagePath), content, cid: "notifySignature" });
  }

  const issueNumber = await getIssueNumber({ increment: !isTest });

  // NOTIFY_TO에 쉼표로 여러 이메일을 넣으면("a@x.com,b@y.com") nodemailer가 알아서
  // 여러 명 모두에게 보냅니다.
  await transporter.sendMail({
    from: GMAIL_USER,
    to: NOTIFY_TO,
    subject: `${config.notify.subjectPrefix} VOL.${issueNumber} (신규 공고 ${items.length}건)`,
    html: renderHtml(items, newsItems, commentary, config, issueNumber),
    attachments,
  });
}
