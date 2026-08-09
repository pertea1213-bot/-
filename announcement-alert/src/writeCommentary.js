const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_AUTHOR = "이호정 경영지도사";
const DEFAULT_STANCE = "한국 중소기업과 소상공인에 대한 적극적인 지원이 필요하다";

export async function writeCommentary(headlines, commentaryConfig = {}) {
  const { ANTHROPIC_API_KEY } = process.env;
  if (!ANTHROPIC_API_KEY || headlines.length === 0) return null;

  const author = commentaryConfig.author ?? DEFAULT_AUTHOR;
  const stance = commentaryConfig.stance ?? DEFAULT_STANCE;
  const model = commentaryConfig.model ?? DEFAULT_MODEL;

  const headlineList = headlines
    .map((item, i) => `${i + 1}. [${item.org}] ${item.title}`)
    .join("\n");

  const prompt = `다음은 오늘 주요 일간지 경제면 헤드라인입니다.

${headlineList}

위 헤드라인들을 참고해서 "${author}" 명의로 실리는 짧은 논평(200~300자 내외, 한국어)을 작성해줘.
논조: ${stance}.
형식: 헤드라인을 그대로 인용하지 말고 자연스러운 논평 문장으로 쓰고, 마지막 줄에 "- ${author}"로 서명해줘.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 600,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Anthropic API 요청 실패: HTTP ${res.status}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text?.trim() || null;
}
