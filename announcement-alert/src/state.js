import { readFile, writeFile } from "node:fs/promises";

const STATE_PATH = new URL("../data/sent-ids.json", import.meta.url);
const MAX_TRACKED = 3000;

export async function loadSentIds() {
  try {
    const raw = await readFile(STATE_PATH, "utf-8");
    return new Set(JSON.parse(raw));
  } catch (err) {
    if (err.code === "ENOENT") return new Set();
    throw err;
  }
}

export async function saveSentIds(sentIds) {
  const trimmed = [...sentIds].slice(-MAX_TRACKED);
  await writeFile(STATE_PATH, JSON.stringify(trimmed, null, 2) + "\n");
}

export function itemKey(item) {
  return `${item.source}:${item.id}`;
}
