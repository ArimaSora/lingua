#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { finished } from "node:stream/promises";

// 下载 EFLLex 词表并转换为 lingua 可用的 lemma→CEFR 映射。
// EFLLex（Dürlich & François 2018）以 CC BY-NC-SA 4.0 发布，词表数据不随本仓库分发。
// 用法：node scripts/download-efllex.mjs [--data-dir ./data]

const DOWNLOAD_URL = "https://cental.uclouvain.be/cefrlex/efllex/download/EFLLex_with_NLP4J.tsv";
const EXPECTED_SHA256 = "d046ce406ce1dbe23292b2d7e0a18e36c6d2f490b7e09edf3173ca8b5f019645";
const LEVELS = ["A1", "A2", "B1", "B2", "C1"];

function parseArgs() {
  const args = process.argv.slice(2);
  const dataDirFlag = args.find((_, i) => args[i - 1] === "--data-dir");
  return { dataDir: dataDirFlag ?? "./data" };
}

async function download(url, dest) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`下载失败：${response.status} ${response.statusText}（${url}）`);
  }
  mkdirSync(dirname(dest), { recursive: true });
  const file = createWriteStream(dest);
  await finished(response.body.pipe(file));
}

function parseTsv(tsv) {
  const lines = tsv.trim().split("\n");
  const header = lines[0].split("\t");
  const levelColumns = LEVELS.map((level) => `level_freq@${level.toLowerCase()}`);
  const wordIndex = header.indexOf("word");
  if (wordIndex === -1) throw new Error("TSV 缺少 word 列");
  const levelIndices = levelColumns.map((col) => {
    const idx = header.indexOf(col);
    if (idx === -1) throw new Error(`TSV 缺少 ${col} 列`);
    return idx;
  });

  const map = new Map();
  for (let i = 1; i < lines.length; i += 1) {
    const cells = lines[i].split("\t");
    const word = cells[wordIndex];
    if (!word) continue;
    // 取首个非零频率的最低级别。
    let level = null;
    for (let li = 0; li < LEVELS.length; li += 1) {
      const value = cells[levelIndices[li]];
      if (value && Number(value) > 0) {
        level = LEVELS[li];
        break;
      }
    }
    if (!level) continue;
    // 同一 lemma 若出现多 POS，取最低级别。
    const existing = map.get(word);
    if (!existing || LEVELS.indexOf(level) < LEVELS.indexOf(existing)) {
      map.set(word, level);
    }
  }
  return Object.fromEntries(map);
}

async function main() {
  const { dataDir } = parseArgs();
  const tsvPath = join(dataDir, "EFLLex_with_NLP4J.tsv");
  const jsonPath = join(dataDir, "efllex.json");

  if (!existsSync(tsvPath)) {
    console.log(`正在下载 EFLLex 到 ${tsvPath}…`);
    await download(DOWNLOAD_URL, tsvPath);
  } else {
    console.log(`已存在 ${tsvPath}，跳过下载。`);
  }

  const actualSha256 = createHash("sha256").update(readFileSync(tsvPath)).digest("hex");
  if (actualSha256 !== EXPECTED_SHA256) {
    console.warn(`SHA-256 不匹配：预期 ${EXPECTED_SHA256}，实际 ${actualSha256}`);
    console.warn("文件可能已被官方更新，请人工核对后继续。");
  } else {
    console.log("SHA-256 校验通过。");
  }

  console.log("正在解析 TSV…");
  const entries = parseTsv(readFileSync(tsvPath, "utf8"));
  console.log(`共 ${Object.keys(entries).length} 个 lemma。`);

  mkdirSync(dataDir, { recursive: true });
  writeFileSync(jsonPath, JSON.stringify(entries, null, 2));
  console.log(`已输出 ${jsonPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
