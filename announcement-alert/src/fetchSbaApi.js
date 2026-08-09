const API_URL = "https://www.sba.seoul.kr/Pages/Main.aspx/GetData";

export async function fetchSbaApi(source) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: JSON.stringify({ param: { P_TYPE: "ALL", P_ORDER: "END", P_HASHTAG: "" } }),
  });

  if (!res.ok) {
    throw new Error(`[${source.name}] 요청 실패: HTTP ${res.status}`);
  }

  const body = await res.json();
  const contents = body?.d?.contents;

  if (!Array.isArray(contents)) {
    throw new Error(`[${source.name}] 응답에서 contents 배열을 찾지 못했습니다. SBA가 API 구조를 바꿨을 수 있습니다.`);
  }

  return contents.map((raw) => {
    const start = raw.new_dt_mig_sdate ?? "";
    const end = raw.new_dt_mig_edate ?? "";

    return {
      source: source.name,
      id: raw.recordId ?? `${raw.new_name ?? ""}-${start}`,
      title: raw.new_name ?? "(제목 없음)",
      org: raw.new_txt_mig_org_nm || source.label,
      alwaysInclude: source.alwaysInclude === true,
      deadline: start && end ? `${start} ~ ${end}` : start || end || "",
      // 상세 페이지로 이어지는 URL 필드(new_txt_mig_req_url 등)가 응답에서 비어있어
      // 홈페이지로 링크합니다.
      url: "https://www.sba.seoul.kr/",
      raw,
    };
  });
}
