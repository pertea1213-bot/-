import { readFile } from "node:fs/promises";
import path from "node:path";
import nodemailer from "nodemailer";
import { groupByCategory } from "./categorize.js";
import { getIssueNumber } from "./issueNumber.js";

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

function chunkPairs(items) {
  const pairs = [];
  for (let i = 0; i < items.length; i += 2) {
    pairs.push([items[i], items[i + 1]]);
  }
  return pairs;
}

function renderCard(item) {
  if (!item) {
    return `<td style="width:50%;padding:6px;border:none;"></td>`;
  }
  return `
    <td style="width:50%;padding:6px;vertical-align:top;">
      <div style="border:1px solid #ddd;border-radius:6px;padding:12px;height:100%;">
        <a href="${escapeHtml(item.url)}" style="color:#1a4b8c;text-decoration:none;font-weight:600;font-size:14px;">${escapeHtml(item.title)}</a><br/>
        <span style="color:#666;font-size:12px;">${escapeHtml(item.org)}${item.deadline ? ` · ${escapeHtml(item.deadline)}` : ""}</span>
      </div>
    </td>`;
}

function renderCategorySection(categoryName, items) {
  const rows = chunkPairs(items)
    .map(([left, right]) => `<tr>${renderCard(left)}${renderCard(right)}</tr>`)
    .join("");

  return `
    <h3 style="margin:24px 0 8px;color:#1a4b8c;border-left:4px solid #1a4b8c;padding-left:8px;">${escapeHtml(categoryName)} (${items.length})</h3>
    <table style="width:100%;border-collapse:collapse;table-layout:fixed;">${rows}</table>`;
}

function renderHtml(items, config, issueNumber) {
  const { subjectPrefix, signatureImagePath } = config.notify;

  const header = `
    <div style="text-align:right;color:#888;font-size:13px;margin-bottom:16px;">
      ${escapeHtml(formatIssueDate())}<br/>
      <span style="font-weight:600;">VOL. ${issueNumber}</span>
    </div>`;

  const fallbackLabel = config.notify.uncategorizedLabel ?? "기타";
  const groups = groupByCategory(items, config.categories ?? [], fallbackLabel);
  const sections = groups
    .map(([categoryName, groupItems]) => renderCategorySection(categoryName, groupItems))
    .join("");

  const footer = signatureImagePath
    ? `
      <hr style="border:none;border-top:1px solid #ddd;margin:32px 0 16px;"/>
      <img src="cid:notifySignature" alt="" style="max-width:100%;display:block;"/>`
    : "";

  return `
    <div style="font-family:sans-serif;max-width:640px;margin:0 auto;">
      ${header}
      <h2 style="margin:0 0 16px;">${escapeHtml(subjectPrefix)}</h2>
      ${sections}
      ${footer}
    </div>`;
}

export async function sendDigestEmail(items, config, { isTest = false } = {}) {
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
    html: renderHtml(items, config, issueNumber),
    attachments,
  });
}
