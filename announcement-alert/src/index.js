import { readFile } from "node:fs/promises";
import { fetchSource } from "./fetchSource.js";
import { fetchNosaBoard } from "./fetchNosaBoard.js";
import { fetchSbaApi } from "./fetchSbaApi.js";
import { filterItems } from "./filter.js";
import { loadSentIds, saveSentIds, itemKey } from "./state.js";
import { sendDigestEmail } from "./notify.js";

const FETCHERS_BY_TYPE = {
  "nosa-board": fetchNosaBoard,
  "sba-api": fetchSbaApi,
};

async function loadConfig() {
  const raw = await readFile(new URL("../config.json", import.meta.url), "utf-8");
  return JSON.parse(raw);
}

async function collectAll(sources) {
  const enabled = sources.filter((s) => s.enabled !== false);
  const results = await Promise.allSettled(
    enabled.map((s) => (FETCHERS_BY_TYPE[s.type] ?? fetchSource)(s))
  );

  const items = [];
  results.forEach((result, i) => {
    const source = enabled[i];
    if (result.status === "fulfilled") {
      items.push(...result.value);
    } else {
      const causeSuffix = result.reason.cause ? ` (원인: ${result.reason.cause})` : "";
      console.error(`[${source.name}] 수집 실패: ${result.reason.message}${causeSuffix}`);
    }
  });
  return items;
}

async function main() {
  const config = await loadConfig();

  const collected = await collectAll(config.sources);
  console.log(`수집된 공고: ${collected.length}건`);

  const filtered = filterItems(collected, config.filters);
  console.log(`조건에 맞는 공고: ${filtered.length}건`);

  const sentIds = await loadSentIds();
  const newItems = filtered.filter((item) => !sentIds.has(itemKey(item)));
  console.log(`신규(미발송) 공고: ${newItems.length}건`);

  if (newItems.length === 0) {
    console.log("발송할 신규 공고가 없습니다.");
    return;
  }

  await sendDigestEmail(newItems, config);
  console.log(`이메일 발송 완료: ${newItems.length}건`);

  for (const item of newItems) sentIds.add(itemKey(item));
  await saveSentIds(sentIds);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
