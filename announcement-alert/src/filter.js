function daysUntil(dateStr) {
  const parsed = new Date(dateStr.replace(/\./g, "-"));
  if (Number.isNaN(parsed.getTime())) return null;
  const diffMs = parsed.setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0);
  return Math.round(diffMs / 86_400_000);
}

export function filterItems(items, filters) {
  const keywords = filters.keywords ?? [];
  const excludeKeywords = filters.excludeKeywords ?? [];
  const maxDays = filters.maxDaysUntilDeadline;

  return items.filter((item) => {
    const haystack = `${item.title} ${item.org}`.toLowerCase();

    if (keywords.length > 0 && !keywords.some((k) => haystack.includes(k.toLowerCase()))) {
      return false;
    }
    if (excludeKeywords.some((k) => haystack.includes(k.toLowerCase()))) {
      return false;
    }
    if (maxDays != null && item.deadline) {
      const remaining = daysUntil(item.deadline);
      if (remaining != null && remaining > maxDays) return false;
    }
    return true;
  });
}
