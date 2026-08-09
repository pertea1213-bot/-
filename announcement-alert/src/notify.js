import nodemailer from "nodemailer";

function renderHtml(items, subjectPrefix) {
  const rows = items
    .map(
      (item) => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #ddd;">
            <a href="${item.url}" style="color:#1a4b8c;text-decoration:none;font-weight:600;">${item.title}</a><br/>
            <span style="color:#666;font-size:13px;">${item.org}${item.deadline ? ` · ${item.deadline}` : ""}</span>
          </td>
        </tr>`
    )
    .join("");

  return `
    <div style="font-family:sans-serif;max-width:640px;margin:0 auto;">
      <h2>${subjectPrefix} 신규 사업공고 ${items.length}건</h2>
      <table style="width:100%;border-collapse:collapse;">${rows}</table>
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

  await transporter.sendMail({
    from: GMAIL_USER,
    to: NOTIFY_TO,
    subject: `${config.notify.subjectPrefix} 신규 공고 ${items.length}건`,
    html: renderHtml(items, config.notify.subjectPrefix),
  });
}
