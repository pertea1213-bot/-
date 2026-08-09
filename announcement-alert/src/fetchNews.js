const OUTLET_DOMAINS = {
  "중앙일보": "joongang.co.kr",
  "조선일보": "chosun.com",
  "한겨레": "hani.co.kr",
  "경향신문": "khan.co.kr",
};

function extractTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  if (!match) return "";
  return match[1]
    .replace(/^<!\[CDATA\[/, "")
    .replace(/\]\]>$/, "")
    .trim();
}

function parseRssItems(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml))) {
    const block = match[1];
    items.push({
      title: extractTag(block, "title"),
      link: extractTag(block, "link"),
      pubDate: extractTag(block, "pubDate"),
    });
  }
  return items;
}

async function fetchOne(keyword, outletName, domain) {
  const q = encodeURIComponent(`${keyword} site:${domain}`);
  const url = `https://news.google.com/rss/search?q=${q}&hl=ko&gl=KR&ceid=KR:ko`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const xml = await res.text();
  return parseRssItems(xml)
    .slice(0, 5)
    .map((item) => ({
      title: item.title.replace(new RegExp(`\\s*-\\s*${outletName}$`), ""),
      org: outletName,
      url: item.link,
      pubDate: item.pubDate,
    }));
}

// Google News RSS는 댓글 수/조회수를 제공하지 않으므로, 여러 키워드에 동시에 걸리는
// 기사일수록(=여러 주제에 걸친 비중 있는 기사) 우선순위를 높게, 그다음 최신순으로 정렬합니다.
export async function fetchNewsItems(newsConfig = {}) {
  const keywords = newsConfig.keywords ?? [];
  const outletNames = newsConfig.outlets ?? Object.keys(OUTLET_DOMAINS);
  const count = newsConfig.count ?? 10;

  const queries = [];
  for (const keyword of keywords) {
    for (const outletName of outletNames) {
      const domain = OUTLET_DOMAINS[outletName];
      if (domain) queries.push({ keyword, outletName, domain });
    }
  }

  const results = await Promise.allSettled(
    queries.map(({ keyword, outletName, domain }) => fetchOne(keyword, outletName, domain))
  );

  const byLink = new Map();
  results.forEach((result, i) => {
    const { keyword, outletName } = queries[i];
    if (result.status !== "fulfilled") {
      console.error(`[news] ${outletName}/${keyword} 수집 실패: ${result.reason.message}`);
      return;
    }
    for (const item of result.value) {
      const existing = byLink.get(item.url);
      if (existing) {
        existing.matchCount += 1;
      } else {
        byLink.set(item.url, { ...item, matchCount: 1 });
      }
    }
  });

  return [...byLink.values()]
    .sort((a, b) => {
      if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
      return new Date(b.pubDate) - new Date(a.pubDate);
    })
    .slice(0, count);
}
