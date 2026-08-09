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
    // raw 응답 전체를 검색 대상으로 삼는 이유: bizinfo API의 실제 지역 필드명이
    // 확인되지 않았으므로, 응답 어디에 있든 "서울"/"경기" 같은 지역명을 놓치지 않기 위함.
    const haystack = JSON.stringify(item.raw ?? item).toLowerCase();

    if (keywords.length > 0 && !keywords.some((k) => haystack.includes(k.toLowerCase()))) {
      return false;
    }
    if (excludeKeywords.some((k) => haystack.includes(k.toLowerCase()))) {
      return false;
    }
    if (regions.length > 0 && !regions.some((r) => haystack.includes(r.toLowerCase()))) {
      return false;
    }
    if (maxDays != null && item.deadline) {
      const remaining = daysUntil(item.deadline);
      if (remaining != null && remaining > maxDays) return false;
    }
    return true;
  });
}
