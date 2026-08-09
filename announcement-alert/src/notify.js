import { readFile } from "node:fs/promises";
import path from "node:path";
import nodemailer from "nodemailer";
import { groupByCategory } from "./categorize.js";

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderHtml(items, config) {
  const { subjectPrefix, introText, photoPath } = config.notify;

  const intro = introText
    ? `<p style="white-space:pre-line;color:#333;">${escapeHtml(introText)}</p>`
    : "";

  const photo = photoPath
    ? `<img src="cid:notifyPhoto" alt="" style="max-width:200px;border-radius:8px;display:block;margin:0 0 16px;"/>`
    : "";

  const fallbackLabel = config.notify.uncategorizedLabel ?? "기타";
  const groups = groupByCategory(items, config.categories ?? [], fallbackLabel);

  const sections = groups
    .map(([categoryName, groupItems]) => {
      const rows = groupItems
        .map(
          (item) => `
            <tr>
              <td style="padding:8px 12px;border-bottom:1px solid #ddd;">
                <a href="${escapeHtml(item.url)}" style="color:#1a4b8c;text-decoration:none;font-weight:600;">${escapeHtml(item.title)}</a><br/>
                <span style="color:#666;font-size:13px;">${escapeHtml(item.org)}${item.deadline ? ` · ${escapeHtml(item.deadline)}` : ""}</span>
              </td>
            </tr>`
        )
        .join("");

      return `
        <h3 style="margin:20px 0 4px;color:#1a4b8c;">${escapeHtml(categoryName)} (${groupItems.length})</h3>
        <table style="width:100%;border-collapse:collapse;">${rows}</table>`;
    })
    .join("");

  return `
    <div style="font-family:sans-serif;max-width:640px;margin:0 auto;">
      ${photo}
      ${intro}
      <h2>${escapeHtml(subjectPrefix)} 신규 사업공고 ${items.length}건</h2>
      ${sections}
    </div>`;
}

export async function sendDigestEmail(items, config) {
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

  const { photoPath } = config.notify;
  const attachments = [];
  if (photoPath) {
    const fileUrl = new URL(`../${photoPath}`, import.meta.url);
    const content = await readFile(fileUrl);
    attachments.push({ filename: path.basename(photoPath), content, cid: "notifyPhoto" });
  }

  // NOTIFY_TO에 쉼표로 여러 이메일을 넣으면("a@x.com,b@y.com") nodemailer가 알아서
  // 여러 명 모두에게 보냅니다.
  await transporter.sendMail({
    from: GMAIL_USER,
    to: NOTIFY_TO,
    subject: `${config.notify.subjectPrefix} 신규 공고 ${items.length}건`,
    html: renderHtml(items, config),
    attachments,
  });
}
