import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const root = resolve("D:/shatou-handbook");
const outDir = resolve(root, ".test-build");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

execFileSync(
  "C:/Users/cosima/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe",
  [
    resolve(root, "node_modules/typescript/bin/tsc"),
    resolve(root, "src/lib/matchParser.ts"),
    "--target",
    "ES2020",
    "--module",
    "CommonJS",
    "--moduleResolution",
    "Node",
    "--skipLibCheck",
    "--outDir",
    outDir
  ],
  { cwd: root, stdio: "inherit" }
);

const require = createRequire(import.meta.url);
const { parseMatchLines, mergeMatchResults, normalizeEventName } = require(resolve(outDir, "matchParser.js"));

const shashaText = `2025.1.1兵超女团亚军🥈
2025.2.8WTT 新加坡大满贯女双亚军🥈
2025.2.8WTT 新加坡大满贯女单冠军🏆
2025.5.24多哈世乒赛混双冠军🏆
2025.5.25多哈世乒赛女单冠军🏆`;

const datouText = `2025.1.1兵超男团冠军🏆
2025.2.8WTT 新加坡大满贯男双冠军🏆
2025.2.8WTT 新加坡大满贯男单四强④
2025.5.24多哈世乒赛混双冠军🏆
2025.5.25多哈世乒赛男单冠军🏆`;

const shashaRaw = parseMatchLines(shashaText, "shasha");
const datouRaw = parseMatchLines(datouText, "datou");

assert.equal(shashaRaw.length, 5);
assert.equal(datouRaw.length, 5);
assert.deepEqual(shashaRaw[1], {
  date: "2025-02-08",
  eventName: "WTT新加坡大满贯",
  athlete: "shasha",
  category: "女双",
  result: "亚军"
});
assert.equal(normalizeEventName("新加坡大满贯"), "WTT新加坡大满贯");
assert.equal(normalizeEventName("WTT 新加坡大满贯"), "WTT新加坡大满贯");

const records = mergeMatchResults([...shashaRaw, ...datouRaw]);
assert.equal(records.length, 3);

const bingchao = records.find((record) => record.eventName === "兵超");
assert.ok(bingchao);
assert.equal(bingchao.eventDate, "2025-01-01");
assert.equal(bingchao.shashaTeamResult, "亚军");
assert.equal(bingchao.datouTeamResult, "冠军");

const singapore = records.find((record) => record.eventName === "WTT新加坡大满贯");
assert.ok(singapore);
assert.equal(singapore.eventDate, "2025-02-08");
assert.equal(singapore.shashaSinglesResult, "冠军");
assert.equal(singapore.shashaDoublesResult, "亚军");
assert.equal(singapore.datouSinglesResult, "四强");
assert.equal(singapore.datouDoublesResult, "冠军");
assert.deepEqual(singapore.conflicts, []);

const doha = records.find((record) => record.eventName === "多哈世乒赛");
assert.ok(doha);
assert.equal(doha.eventDate, "2025-05-25");
assert.equal(doha.shashaSinglesResult, "冠军");
assert.equal(doha.datouSinglesResult, "冠军");
assert.equal(doha.mixedDoublesResult, "冠军");
assert.deepEqual(doha.conflicts, []);

const conflictRecords = mergeMatchResults([
  { date: "2025-02-08", eventName: "WTT 新加坡大满贯", athlete: "shasha", category: "女双", result: "亚军" },
  { date: "2025-02-08", eventName: "新加坡大满贯", athlete: "shasha", category: "女双", result: "冠军" }
]);
assert.deepEqual(conflictRecords[0].conflicts, [{ field: "shashaDoublesResult", values: ["亚军", "冠军"] }]);
assert.equal(conflictRecords[0].shashaDoublesResult, "亚军");

console.log("matchParser mock tests passed", records.map((record) => ({ eventName: record.eventName, eventDate: record.eventDate })));