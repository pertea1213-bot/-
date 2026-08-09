function resolveEnvPlaceholders(value) {
  if (typeof value !== "string") return value;
  return value.replace(/\$\{([A-Z_]+)\}/g, (_, name) => process.env[name] ?? "");
}

function getByPath(obj, path) {
  if (!path) return obj;
  return path.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

export async function fetchSource(source) {
  const params = new URLSearchParams();
  for (const [key, rawValue] of Object.entries(source.query ?? {})) {
    params.set(key, resolveEnvPlaceholders(rawValue));
  }

  const requestUrl = `${source.url}?${params.toString()}`;
  const res = await fetch(requestUrl, { headers: { Accept: "application/json" } });

  if (!res.ok) {
    throw new Error(`[${source.name}] 요청 실패: HTTP ${res.status}`);
  }

  const body = await res.json();
  const rawItems = getByPath(body, source.itemsPath);

  if (!Array.isArray(rawItems)) {
    throw new Error(
      `[${source.name}] 응답에서 목록을 찾지 못했습니다. config.json의 itemsPath("${source.itemsPath}")가 실제 응답 구조와 맞는지 확인하세요.`
    );
  }

  const f = source.fields;
  return rawItems.map((raw) => ({
    source: source.name,
    id: String(raw[f.id] ?? ""),
    title: raw[f.title] ?? "(제목 없음)",
    org: raw[f.org] ?? "",
    deadline: raw[f.deadline] ?? "",
    url: raw[f.url] ?? "",
  }));
}
