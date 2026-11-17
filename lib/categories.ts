export const EXPENSE_CATEGORIES = [
  "식비",
  "교통",
  "쇼핑",
  "문화",
  "기타",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export function normalizeCategory(value: unknown): ExpenseCategory {
  if (typeof value !== "string") return "기타";
  const trimmed = value.trim();
  return (EXPENSE_CATEGORIES as readonly string[]).includes(trimmed)
    ? (trimmed as ExpenseCategory)
    : "기타";
}

export function categorizeByKeywords(description: string): ExpenseCategory {
  const text = description.trim();

  if (
    /점심|저녁|아침|식사|식비|커피|카페|스타벅스|배달|치킨|피자|밥|음식|식당|분식|편의점|마트|장보|간식|음료/.test(
      text,
    )
  ) {
    return "식비";
  }
  if (
    /택시|버스|지하철|교통|주유|주차|기차|KTX|비행|항공|대리|킥보드|따릉이/.test(
      text,
    )
  ) {
    return "교통";
  }
  if (/쇼핑|옷|의류|화장품|쿠팡|배송|백화점|아울렛|신발|잡화/.test(text)) {
    return "쇼핑";
  }
  if (
    /문화|영화|게임|구독|넷플|유튜브|공연|책|취미|여행|숙소|호텔/.test(text)
  ) {
    return "문화";
  }

  return "기타";
}
