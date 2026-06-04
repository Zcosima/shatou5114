"use client";

import { CalendarDays, CircleDollarSign, Home, Medal, Shirt, Sparkles, Trophy } from "lucide-react";
import type { ReactNode } from "react";

type TabKey = "home" | "matches" | "merch" | "points";

const tabs: Array<{ key: TabKey; label: string; icon: ReactNode }> = [
  { key: "home", label: "首页", icon: <Home size={19} /> },
  { key: "matches", label: "比赛", icon: <Trophy size={19} /> },
  { key: "merch", label: "周边", icon: <Shirt size={19} /> },
  { key: "points", label: "积分", icon: <Medal size={19} /> }
];

export function AppShell({ activeTab, onTabChange, children }: { activeTab: TabKey; onTabChange: (tab: TabKey) => void; children: ReactNode }) {
  return (
    <main className="app-shell relative overflow-hidden">
      <header className="sticky top-0 z-20 border-b border-[var(--line)] bg-[rgba(255,248,241,0.9)] px-5 pb-3 pt-5 backdrop-blur-xl">
        <p className="text-xs font-medium text-[var(--rose)]">mobile-first fan journal</p>
        <h1 className="mt-1 text-[26px] font-semibold tracking-normal text-[var(--ink)]">莎头观赛手账</h1>
      </header>

      <section className="px-4 pb-28 pt-4">{children}</section>

      <nav className="safe-bottom fixed bottom-0 left-1/2 z-30 w-full max-w-[430px] -translate-x-1/2 border-t border-[var(--line)] bg-[rgba(255,253,248,0.92)] px-4 pt-2 backdrop-blur-xl">
        <div className="grid grid-cols-4 gap-1">
          {tabs.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => onTabChange(tab.key)}
                className={`flex h-14 flex-col items-center justify-center gap-1 rounded-2xl text-xs transition ${active ? "bg-[#fce3d6] text-[var(--berry)]" : "text-[var(--cocoa)]"}`}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </main>
  );
}

export function StatCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="card rounded-[20px] p-3">
      <div className="mb-3 grid h-8 w-8 place-items-center rounded-full bg-[#fbe0d0] text-[var(--berry)]">{icon}</div>
      <p className="text-[11px] text-[var(--cocoa)]">{label}</p>
      <p className="mt-1 break-words text-lg font-semibold">{value}</p>
    </div>
  );
}

export function SectionTitle({ title }: { title: string }) {
  return <h2 className="text-lg font-semibold tracking-normal text-[var(--ink)]">{title}</h2>;
}

export function MatchSummaryCard({ title, date, points, shasha, datou, mixed, notes }: { title: string; date: string; points: number; shasha: string; datou: string; mixed: string; notes?: string }) {
  return (
    <article className="card rounded-[24px] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-words text-base font-semibold">{title || "未命名赛事"}</h3>
          <p className="mt-1 flex items-center gap-1 text-xs text-[var(--cocoa)]"><CalendarDays size={13} />{date}</p>
        </div>
        <span className="shrink-0 rounded-full bg-[#fce3d6] px-3 py-1 text-sm font-semibold text-[var(--berry)]">{points} pts</span>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
        <MiniResult label="莎莎女单" value={shasha} />
        <MiniResult label="大头男单" value={datou} />
        <MiniResult label="莎头混双" value={mixed} />
      </div>
      {notes ? <p className="mt-3 text-sm leading-6 text-[var(--cocoa)]">{notes}</p> : null}
    </article>
  );
}

function MiniResult({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-[#fff2e8] px-2 py-3">
      <p className="text-[var(--cocoa)]">{label}</p>
      <p className="mt-1 font-semibold text-[var(--ink)]">{value || "待补"}</p>
    </div>
  );
}

export const appIcons = { Sparkles, Trophy, CircleDollarSign, Shirt, Medal };