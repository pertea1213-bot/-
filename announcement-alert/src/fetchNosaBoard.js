import { parse } from "node-html-parser";

const LIST_URL = "https://www.nosa.or.kr/board/list.brd";

export async function fetchNosaBoard(source) {
  const requestUrl = `${LIST_URL}?boardId=${source.boardId}`;
  const res = await fetch(requestUrl, { headers: { "User-Agent": "Mozilla/5.0" } });

  if (!res.ok) {
    throw new Error(`[${source.name}] 요청 실패: HTTP ${res.status}`);
  }

  const html = await res.text();
  const root = parse(html);
  const rows = root.querySelectorAll("table.sub_table_2 tbody tr");

  return rows
    .map((row) => {
      const link = row.querySelector(".txt_title a");
      const onclick = link?.getAttribute("onclick") ?? "";
      const match = onclick.match(/readBulletin\('([^']+)','([^']+)'\)/);
      const bltnNo = match?.[2] ?? "";

      return {
        source: source.name,
        id: bltnNo,
        title: link?.text.trim() ?? "(제목 없음)",
        org: source.label,
        alwaysInclude: source.alwaysInclude === true,
        deadline: row.querySelector(".table_day")?.text.trim() ?? "",
        // 상세 페이지는 onclick(JS)으로만 열리고 실제 view URL을 아직 확인하지 못해
        // 목록 페이지로 링크합니다. 필요하면 나중에 확인해서 바꿀 수 있습니다.
        url: requestUrl,
        raw: { boardId: source.boardId, bltnNo, writer: row.querySelector(".table_writer")?.text.trim() ?? "" },
      };
    })
    .filter((item) => item.id);
}
