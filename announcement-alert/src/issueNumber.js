import { readFile, writeFile } from "node:fs/promises";

const PATH = new URL("../data/issue-number.json", import.meta.url);

export async function getIssueNumber({ increment }) {
  let number = 0;
  try {
    const raw = await readFile(PATH, "utf-8");
    number = JSON.parse(raw).number ?? 0;
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }

  if (increment) {
    number += 1;
    await writeFile(PATH, JSON.stringify({ number }, null, 2) + "\n");
  }

  return number || 1;
}
