import type { MatchConflict, MatchRecord, RawMatchResult } from "./types";

type ResultCategory = RawMatchResult["category"];
type Athlete = RawMatchResult["athlete"];

const categories: ResultCategory[] = ["女单", "女双", "男单", "男双", "混双", "混团", "女团", "男团"];
const resultWords = ["三十二强", "十六强", "八强", "四强", "季军", "亚军", "冠军"];
const eventNoiseWords = ["WTT", "国际乒联"];

const pointsByResult: Record<string, number> = {
  冠军: 0,
  亚军: 0,
  季军: 0,
  四强: 0,
  八强: 0,
  十六强: 0,
  三十二强: 0
};

export function cleanMatchLine(line: string) {
  return line
    .replace(/[🏆🥈🥉🏅]/gu, "")
    .replace(/[①②③④⑤❶❷❸❹]/gu, "")
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "")
    .replace(/[\u00a0\u2000-\u200d\u202f\u205f\u3000\ufeff]/gu, "")
    .replace(/\s+/g, "")
    .trim();
}

function normalizeDate(raw: string) {
  const match = raw.match(/^(20\d{2})[.\-/年](\d{1,2})[.\-/月](\d{1,2})日?/);
  if (!match) return null;
  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

export function normalizeEventName(eventName: string) {
  let normalized = eventName
    .replace(/[\s·•・]/g, "")
    .replace(/WTT/gi, "WTT")
    .trim();

  for (const word of eventNoiseWords) {
    normalized = normalized.replace(new RegExp(`^${word}`, "i"), word === "WTT" ? "WTT" : "");
  }

  if (normalized === "新加坡大满贯") return "WTT新加坡大满贯";
  if (normalized.includes("新加坡大满贯")) return "WTT新加坡大满贯";
  if (normalized.includes("多哈世乒赛")) return "多哈世乒赛";
  if (normalized.includes("兵超")) return "兵超";

  return normalized;
}

function inferAthlete(category: ResultCategory, source?: "shasha" | "datou"): Athlete {
  if (category === "混双" || category === "混团") return "mixed";
  if (category.startsWith("女")) return "shasha";
  if (category.startsWith("男")) return "datou";
  return source ?? "mixed";
}

export function parseMatchLines(text: string, source?: "shasha" | "datou"): RawMatchResult[] {
  return text
    .split(/\r?\n/)
    .map(cleanMatchLine)
    .filter(Boolean)
    .map((line) => {
      const date = normalizeDate(line);
      if (!date) return null;

      const category = categories.find((item) => line.includes(item));
      const result = resultWords.find((item) => line.includes(item));
      if (!category || !result) return null;

      const dateText = line.match(/^(20\d{2})[.\-/年](\d{1,2})[.\-/月](\d{1,2})日?/)?.[0] ?? "";
      const afterDate = line.slice(dateText.length);
      const categoryIndex = afterDate.indexOf(category);
      const eventName = normalizeEventName(afterDate.slice(0, categoryIndex));

      if (!eventName) return null;

      return {
        date,
        eventName,
        athlete: inferAthlete(category, source),
        category,
        result
      } satisfies RawMatchResult;
    })
    .filter((item): item is RawMatchResult => Boolean(item));
}

function createEmptyRecord(eventName: string, eventDate: string): MatchRecord {
  return {
    id: `match-${normalizeEventName(eventName).toLowerCase()}-${eventDate}`,
    eventName,
    eventDate,
    shashaSinglesResult: "",
    shashaSinglesPoints: 0,
    shashaDoublesResult: "",
    shashaDoublesPoints: 0,
    shashaTeamResult: "",
    shashaTeamPoints: 0,
    datouSinglesResult: "",
    datouSinglesPoints: 0,
    datouDoublesResult: "",
    datouDoublesPoints: 0,
    datouTeamResult: "",
    datouTeamPoints: 0,
    mixedDoublesResult: "",
    mixedDoublesPoints: 0,
    mixedTeamResult: "",
    mixedTeamPoints: 0,
    notes: "",
    photos: [],
    totalMatchPoints: 0,
    conflicts: [],
    createdAt: new Date().toISOString()
  };
}

function fieldForCategory(category: ResultCategory): keyof MatchRecord | null {
  switch (category) {
    case "女单":
      return "shashaSinglesResult";
    case "女双":
      return "shashaDoublesResult";
    case "女团":
      return "shashaTeamResult";
    case "男单":
      return "datouSinglesResult";
    case "男双":
      return "datouDoublesResult";
    case "男团":
      return "datouTeamResult";
    case "混双":
      return "mixedDoublesResult";
    default:
      return null;
  }
}

function pointFieldForResultField(field: keyof MatchRecord): keyof MatchRecord | null {
  switch (field) {
    case "shashaSinglesResult":
      return "shashaSinglesPoints";
    case "shashaDoublesResult":
      return "shashaDoublesPoints";
    case "shashaTeamResult":
      return "shashaTeamPoints";
    case "datouSinglesResult":
      return "datouSinglesPoints";
    case "datouDoublesResult":
      return "datouDoublesPoints";
    case "datouTeamResult":
      return "datouTeamPoints";
    case "mixedDoublesResult":
      return "mixedDoublesPoints";
    default:
      return null;
  }
}

function recordConflict(conflicts: MatchConflict[], field: string, values: string[]) {
  const uniqueValues = Array.from(new Set(values.filter(Boolean)));
  if (uniqueValues.length <= 1) return conflicts;
  const existing = conflicts.find((conflict) => conflict.field === field);
  if (existing) {
    existing.values = Array.from(new Set([...existing.values, ...uniqueValues]));
    return conflicts;
  }
  conflicts.push({ field, values: uniqueValues });
  return conflicts;
}

function setResult(record: MatchRecord, field: keyof MatchRecord, result: string) {
  const current = record[field];
  if (typeof current !== "string") return;

  if (!current) {
    (record[field] as string) = result;
  } else if (current !== result) {
    record.conflicts = recordConflict(record.conflicts, String(field), [current, result]);
  }

  const pointField = pointFieldForResultField(field);
  if (pointField) {
    (record[pointField] as number) = pointsByResult[result] ?? 0;
  }
}

function recalcTotal(record: MatchRecord) {
  record.totalMatchPoints =
    record.shashaSinglesPoints +
    record.shashaDoublesPoints +
    record.shashaTeamPoints +
    record.datouSinglesPoints +
    record.datouDoublesPoints +
    record.datouTeamPoints +
    record.mixedDoublesPoints;
}

export function mergeMatchResults(rawResults: RawMatchResult[]): MatchRecord[] {
  const records = new Map<string, MatchRecord>();

  for (const raw of rawResults) {
    const key = normalizeEventName(raw.eventName);
    const existing = records.get(key);
    const record = existing ?? createEmptyRecord(key, raw.date);

    record.eventName = key;
    if (raw.date > record.eventDate) record.eventDate = raw.date;

    const field = fieldForCategory(raw.category);
    if (field) setResult(record, field, raw.result);
    recalcTotal(record);

    records.set(key, record);
  }

  return Array.from(records.values()).sort((a, b) => a.eventDate.localeCompare(b.eventDate));
}