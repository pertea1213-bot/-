function daysUntil(dateStr) {
  const parsed = new Date(dateStr.replace(/\./g, "-"));
  if (Number.isNaN(parsed.getTime())) return null;
  const diffMs = parsed.setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0);
  return Math.round(diffMs / 86_400_000);
}

export function filterItems(items, filters) {
  const keywords = filters.keywords ?? [];
  const excludeKeywords = filters.excludeKeywords ?? [];
  const regions = filters.regions ?? [];
  const maxDays = filters.maxDaysUntilDeadline;

  return items.filter((item) => {
    // 정규화된 필드(title/org)뿐 아니라 원본 응답(raw)까지 통째로 검색 대상에 넣는 이유:
    // bizinfo처럼 raw에만 있는 필드(지역명 등)와, title처럼 정규화된 필드만 있고 raw에는
    // 없는 소스(nosa 등)를 모두 놓치지 않기 위함.
    const haystack = JSON.stringify(item).toLowerCase();

    if (excludeKeywords.some((k) => haystack.includes(k.toLowerCase()))) {
      return false;
    }
    // alwaysInclude 소스(예: 노사발전재단)는 단일 기관 전용 소스라 주제/지역 필터를
    // 적용하지 않고 전부 통과시킵니다. excludeKeywords와 마감 필터는 그대로 적용됩니다.
    if (!item.alwaysInclude) {
      if (keywords.length > 0 && !keywords.some((k) => haystack.includes(k.toLowerCase()))) {
        return false;
      }
      if (regions.length > 0 && !regions.some((r) => haystack.includes(r.toLowerCase()))) {
        return false;
      }
    }
    if (maxDays != null && item.deadline) {
      const remaining = daysUntil(item.deadline);
      if (remaining != null && remaining > maxDays) return false;
    }
    return true;
  });
}
