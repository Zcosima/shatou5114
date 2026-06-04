"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { MatchRecord, MerchRecord, PointsEntry } from "@/lib/types";
import { makeId, todayISO } from "@/lib/utils";

export type HandbookBackup = {
  app: "shatou-handbook";
  version: 1;
  exportedAt: string;
  data: {
    matches: MatchRecord[];
    merch: MerchRecord[];
    points: PointsEntry[];
  };
};

export function calculateTotalMatchPoints(match: Pick<MatchRecord, "shashaSinglesPoints" | "shashaDoublesPoints" | "shashaTeamPoints" | "datouSinglesPoints" | "datouDoublesPoints" | "datouTeamPoints" | "mixedDoublesPoints">) {
  return (
    Number(match.shashaSinglesPoints || 0) +
    Number(match.shashaDoublesPoints || 0) +
    Number(match.shashaTeamPoints || 0) +
    Number(match.datouSinglesPoints || 0) +
    Number(match.datouDoublesPoints || 0) +
    Number(match.datouTeamPoints || 0) +
    Number(match.mixedDoublesPoints || 0)
  );
}

export function createEmptyMatch(): MatchRecord {
  const now = new Date().toISOString();
  return {
    id: makeId("match"),
    eventName: "",
    eventDate: todayISO(),
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
    notes: "",
    photos: [],
    totalMatchPoints: 0,
    conflicts: [],
    createdAt: now
  };
}

export function createEmptyMerch(): MerchRecord {
  return {
    id: makeId("merch"),
    merchName: "",
    purchaseDate: todayISO(),
    costPoints: 0,
    moodNote: "",
    photos: [],
    createdAt: new Date().toISOString()
  };
}

function normalizeMatch(match: MatchRecord): MatchRecord {
  const next = {
    ...createEmptyMatch(),
    ...match,
    shashaSinglesPoints: Number(match.shashaSinglesPoints || 0),
    shashaDoublesPoints: Number(match.shashaDoublesPoints || 0),
    shashaTeamPoints: Number(match.shashaTeamPoints || 0),
    datouSinglesPoints: Number(match.datouSinglesPoints || 0),
    datouDoublesPoints: Number(match.datouDoublesPoints || 0),
    datouTeamPoints: Number(match.datouTeamPoints || 0),
    mixedDoublesPoints: Number(match.mixedDoublesPoints || 0),
    photos: Array.isArray(match.photos) ? match.photos : [],
    conflicts: Array.isArray(match.conflicts) ? match.conflicts : []
  };
  return { ...next, totalMatchPoints: calculateTotalMatchPoints(next) };
}

function normalizeMerch(record: MerchRecord): MerchRecord {
  return {
    ...createEmptyMerch(),
    ...record,
    costPoints: Number(record.costPoints || 0),
    photos: Array.isArray(record.photos) ? record.photos : []
  };
}

type HandbookState = {
  matches: MatchRecord[];
  merch: MerchRecord[];
  points: PointsEntry[];
  hasHydrated: boolean;
  addMatch: (match: MatchRecord) => void;
  updateMatch: (id: string, patch: Partial<MatchRecord>) => void;
  deleteMatch: (id: string) => void;
  addMerch: (record: MerchRecord) => void;
  updateMerch: (id: string, patch: Partial<MerchRecord>) => void;
  deleteMerch: (id: string) => void;
  addPoints: (entry: PointsEntry) => void;
  exportData: () => HandbookBackup;
  replaceData: (data: Partial<HandbookBackup["data"]>) => void;
  setHasHydrated: (value: boolean) => void;
};

const now = new Date().toISOString();
const demoMatch = normalizeMatch({
  ...createEmptyMatch(),
  id: "demo-match-singapore",
  eventName: "WTT新加坡大满贯",
  eventDate: "2025-05-10",
  shashaSinglesResult: "冠军",
  shashaSinglesPoints: 2000,
  datouSinglesResult: "四强",
  datouSinglesPoints: 700,
  datouDoublesResult: "冠军",
  datouDoublesPoints: 1200,
  mixedDoublesResult: "冠军",
  mixedDoublesPoints: 1400,
  notes: "基础数据示例，后续可接 OCR 确认流程。\n这一场混双节奏很好，适合放进年度复盘。",
  createdAt: now
});

const demoMerch = normalizeMerch({
  ...createEmptyMerch(),
  id: "demo-merch-bag",
  merchName: "奶油黄应援包",
  purchaseDate: todayISO(),
  costPoints: 128,
  moodNote: "比赛日应援用，收到的时候很开心。",
  createdAt: now
});

export const useHandbookStore = create<HandbookState>()(
  persist(
    (set, get) => ({
      matches: [demoMatch],
      merch: [demoMerch],
      points: [
        {
          id: "demo-points",
          date: todayISO(),
          title: "今日复盘积分",
          points: 4100,
          source: "手动",
          createdAt: now
        }
      ],
      hasHydrated: false,
      addMatch: (match) => set({ matches: [normalizeMatch(match), ...get().matches] }),
      updateMatch: (id, patch) =>
        set({
          matches: get().matches.map((match) => (match.id === id ? normalizeMatch({ ...match, ...patch }) : match))
        }),
      deleteMatch: (id) => set({ matches: get().matches.filter((match) => match.id !== id) }),
      addMerch: (record) => set({ merch: [normalizeMerch(record), ...get().merch] }),
      updateMerch: (id, patch) =>
        set({
          merch: get().merch.map((record) => (record.id === id ? normalizeMerch({ ...record, ...patch }) : record))
        }),
      deleteMerch: (id) => set({ merch: get().merch.filter((record) => record.id !== id) }),
      addPoints: (entry) => set({ points: [entry, ...get().points] }),
      exportData: () => ({
        app: "shatou-handbook",
        version: 1,
        exportedAt: new Date().toISOString(),
        data: {
          matches: get().matches,
          merch: get().merch,
          points: get().points
        }
      }),
      replaceData: (data) =>
        set({
          matches: Array.isArray(data.matches) ? data.matches.map(normalizeMatch) : [],
          merch: Array.isArray(data.merch) ? data.merch.map(normalizeMerch) : [],
          points: Array.isArray(data.points) ? data.points : []
        }),
      setHasHydrated: (value) => set({ hasHydrated: value })
    }),
    {
      name: "shatou-handbook-local-v6",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ matches: state.matches, merch: state.merch, points: state.points }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      }
    }
  )
);