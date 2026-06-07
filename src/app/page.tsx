"use client";

import { Download, Image as ImageIcon, Plus, Upload, X } from "lucide-react";
import { useMemo, useState } from "react";
import { createWorker } from "tesseract.js";
import { AppShell, SectionTitle, StatCard, appIcons } from "@/components/AppShell";
import { calculateTotalMatchPoints, createEmptyMatch, createEmptyMerch, useHandbookStore } from "@/store/useHandbookStore";
import { mergeMatchResults, parseMatchLines } from "@/lib/matchParser";
import { todayISO } from "@/lib/utils";
import type { MatchRecord, MerchRecord } from "@/lib/types";

type TabKey = "home" | "matches" | "merch" | "points";
type MatchFormState = Omit<MatchRecord, "id" | "createdAt" | "totalMatchPoints" | "conflicts">;
type MerchFormState = Omit<MerchRecord, "id" | "createdAt">;
type PointsFlowItem = { id: string; date: string; title: string; points: number; type: "比赛" | "周边" };
type OcrStatus = "等待识别" | "正在识别" | "已识别" | "识别失败";
type ImportImageDraft = { id: string; preview: string; fileName: string; source: "shasha" | "datou"; recognizedText: string; ocrStatus: OcrStatus };
type MerchImportImageDraft = { id: string; preview: string; fileName: string; recognizedText: string; ocrStatus: OcrStatus };

const initialMatchForm = (): MatchFormState => ({
  eventName: "伦敦团体世乒赛",
  eventDate: todayISO(),
  shashaSinglesResult: "女单冠军",
  shashaSinglesPoints: 750,
  shashaDoublesResult: "",
  shashaDoublesPoints: 0,
  shashaTeamResult: "",
  shashaTeamPoints: 0,
  datouSinglesResult: "男单冠军",
  datouSinglesPoints: 952,
  datouDoublesResult: "",
  datouDoublesPoints: 0,
  datouTeamResult: "",
  datouTeamPoints: 0,
  mixedDoublesResult: "",
  mixedDoublesPoints: 0,
  mixedTeamResult: "",
  mixedTeamPoints: 0,
  notes: "我永远相信中国乒乓球队！\n记录一下自己的五月团体世乒赛观赛历程。",
  photos: []
});

const initialMerchForm = (): MerchFormState => ({
  merchName: "王楚钦优时颜眼霜",
  purchaseDate: todayISO(),
  costPoints: 511,
  moodNote: "嗷嗷嗷根本抢不到\n还好预售了\n时隔一个月才拿到我的 hoho 一号",
  photos: []
});

function formatMonthDay(date: string) {
  const [, month = "", day = ""] = date.match(/^(?:\d{4})-(\d{2})-(\d{2})$/) ?? [];
  return month && day ? `${month}月${day}日` : date;
}

function formatYearMonth(date: string) {
  const [, year = "", month = ""] = date.match(/^(\d{4})-(\d{2})-/) ?? [];
  return year && month ? `${year}年${month}月` : "未归档月份";
}

function groupByMonth<T>(items: T[], getDate: (item: T) => string) {
  return items
    .slice()
    .sort((a, b) => getDate(b).localeCompare(getDate(a)))
    .reduce<Array<{ month: string; records: T[] }>>((groups, item) => {
      const month = formatYearMonth(getDate(item));
      const last = groups[groups.length - 1];
      if (last?.month === month) last.records.push(item);
      else groups.push({ month, records: [item] });
      return groups;
    }, []);
}

function getPointsSummary(matches: MatchRecord[], merch: MerchRecord[]) {
  const matchPoints = matches.reduce((sum, match) => sum + match.totalMatchPoints, 0);
  const merchCostPoints = merch.reduce((sum, record) => sum + record.costPoints, 0);
  return { matchPoints, merchCostPoints, totalPoints: matchPoints - merchCostPoints };
}

function getPointsFlow(matches: MatchRecord[], merch: MerchRecord[]): PointsFlowItem[] {
  const matchFlow = matches.map((match) => ({ id: `match-${match.id}`, date: match.eventDate, title: match.eventName || "未命名赛事", points: match.totalMatchPoints, type: "比赛" as const }));
  const merchFlow = merch.map((record) => ({ id: `merch-${record.id}`, date: record.purchaseDate, title: record.merchName || "未命名周边", points: -record.costPoints, type: "周边" as const }));
  return [...matchFlow, ...merchFlow].sort((a, b) => b.date.localeCompare(a.date));
}

async function recognizeImageText(image: string) {
  const worker = await createWorker("chi_sim+eng");
  try {
    const result = await worker.recognize(image);
    return result.data.text;
  } finally {
    await worker.terminate();
  }
}

function readFilesAsDataUrls(files: FileList | null): Promise<string[]> {
  if (!files?.length) return Promise.resolve([]);
  return Promise.all(Array.from(files).map((file) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  })));
}

function cleanMerchLine(line: string) {
  return line.replace(/[\u00a0\u2000-\u200d\u202f\u205f\u3000\ufeff]/g, " ").replace(/\s+/g, " ").trim();
}

function isMerchNoiseLine(line: string) {
  return /^(更多|全部|时间|申请开票|追加评价|查看物流|闲鱼转卖|加入购物车|再买一单)$/.test(line) ||
    /交易成功|实付款|退货宝|价保|破损包退|无理由退货|大促价保|×\s*\d+|x\s*\d+/i.test(line);
}

function normalizeMerchName(raw: string) {
  return cleanMerchLine(raw)
    .replace(/[¥￥]\s*\d+(?:\.\d{1,2})?/g, "")
    .replace(/^(淘宝|天猫|超市)\s*/g, "")
    .replace(/交易成功|实付款|退货宝|7天价保|破损包退|7天无理由退货|大促价保|×\s*\d+|x\s*\d+/gi, "")
    .replace(/^[>》\-—\s]+|[>》\-—\s]+$/g, "")
    .trim();
}

function parseMerchText(text: string, photo?: string): MerchRecord[] {
  const lines = text.split(/\r?\n/).map(cleanMerchLine).filter(Boolean);
  const drafts: MerchRecord[] = [];
  const seen = new Set<string>();

  lines.forEach((line, index) => {
    const priceMatch = line.match(/[¥￥]\s*(\d+(?:\.\d{1,2})?)/);
    if (!priceMatch) return;

    const price = Number(priceMatch[1]);
    const beforePrice = line.slice(0, priceMatch.index).trim();
    const nearbyName = [beforePrice, lines[index - 1], lines[index - 2], lines[index - 3]]
      .map((item) => normalizeMerchName(item ?? ""))
      .find((item) => item.length >= 3 && !isMerchNoiseLine(item) && !/[¥￥]/.test(item));

    if (!nearbyName || !Number.isFinite(price)) return;
    const costPoints = Math.round(price);
    const key = `${nearbyName}-${costPoints}`;
    if (seen.has(key)) return;
    seen.add(key);

    drafts.push({
      id: `merch-import-${Date.now()}-${drafts.length}`,
      merchName: nearbyName,
      purchaseDate: todayISO(),
      costPoints,
      moodNote: "OCR 识别自购物截图，可继续补充心情记录。",
      photos: photo ? [photo] : [],
      createdAt: new Date().toISOString()
    });
  });

  return drafts;
}

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<TabKey>("home");
  const hasHydrated = useHandbookStore((state) => state.hasHydrated);

  return (
    <AppShell activeTab={activeTab} onTabChange={setActiveTab}>
      {!hasHydrated ? (
        <div className="grid min-h-[60vh] place-items-center text-center text-[var(--cocoa)]">
          <div>
            <div className="mx-auto mb-4 h-10 w-10 rounded-full border-4 border-[#fce3d6] border-t-[var(--berry)]" />
            <p className="text-sm font-semibold">正在读取本地手账数据</p>
          </div>
        </div>
      ) : (
        <>
          {activeTab === "home" && <HomeView onGoMatches={() => setActiveTab("matches")} />}
          {activeTab === "matches" && <MatchesView />}
          {activeTab === "merch" && <MerchView />}
          {activeTab === "points" && <PointsView />}
        </>
      )}
    </AppShell>
  );
}

function HomeView({ onGoMatches }: { onGoMatches: () => void }) {
  const { matches, merch } = useHandbookStore();
  const summary = useMemo(() => getPointsSummary(matches, merch), [matches, merch]);
  const latestMatch = matches.slice().sort((a, b) => b.eventDate.localeCompare(a.eventDate))[0];

  return (
    <div className="space-y-8 pt-10">
      <section className="text-center">
        <h2 className="text-[34px] font-semibold tracking-normal text-[var(--ink)]">莎头观赛手账</h2>
        <p className="mt-3 text-base text-[var(--cocoa)]">记录每一次陪伴与成长</p>
      </section>

      <section className="grid grid-cols-3 gap-3">
        <HomeMetric icon="🏆" value={summary.totalPoints} label="当前积分" />
        <HomeMetric icon="🎯" value={matches.length} label="观赛场次" />
        <HomeMetric icon="🛍️" value={merch.length} label="周边收藏" />
      </section>

      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <span className="h-8 w-1 rounded-full bg-[var(--apricot)]" />
          <h3 className="text-2xl font-semibold text-[var(--ink)]">最近比赛</h3>
        </div>

        {latestMatch ? (
          <MatchRecordCard match={latestMatch} onClick={onGoMatches} />
        ) : (
          <div className="grid min-h-72 place-items-center text-center">
            <div>
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-[#fff2e8] text-3xl text-[var(--cocoa)]">📋</div>
              <p className="mt-5 text-base text-[var(--cocoa)]">还没有比赛记录</p>
              <button onClick={onGoMatches} className="mt-5 h-12 rounded-2xl bg-[var(--apricot)] px-8 font-semibold text-white shadow-lg shadow-orange-100">记录第一场比赛</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function getMetricFontSize(value: number) {
  const digits = String(Math.abs(Math.trunc(value))).length;
  if (digits <= 2) return 48;
  if (digits === 3) return 42;
  if (digits === 4) return 34;
  if (digits === 5) return 28;
  if (digits === 6) return 24;
  return 20;
}

function HomeMetric({ icon, value, label }: { icon: string; value: number; label: string }) {
  return (
    <article className="card grid min-h-36 min-w-0 place-items-center rounded-[24px] p-3 text-center">
      <div className="min-w-0 w-full">
        <div className="text-3xl">{icon}</div>
        <p
          className="mx-auto mt-4 block max-w-full whitespace-nowrap text-center font-semibold leading-none text-[var(--ink)]"
          style={{ fontSize: `${getMetricFontSize(value)}px`, fontVariantNumeric: "tabular-nums" }}
          title={String(value)}
        >
          {value}
        </p>
        <p className="mt-3 truncate text-sm text-[var(--cocoa)]">{label}</p>
      </div>
    </article>
  );
}

function MatchesView() {
  const { matches, addMatch, updateMatch, deleteMatch } = useHandbookStore();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<MatchFormState>(() => initialMatchForm());
  const [importImages, setImportImages] = useState<ImportImageDraft[]>([]);
  const [recognitionDrafts, setRecognitionDrafts] = useState<MatchRecord[] | null>(null);
  const selected = matches.find((match) => match.id === selectedId) ?? null;
  const grouped = useMemo(() => groupByMonth(matches, (match) => match.eventDate), [matches]);
  const totalMatchPoints = calculateTotalMatchPoints(form);
  const updateForm = <Key extends keyof MatchFormState>(key: Key, value: MatchFormState[Key]) => setForm((current) => ({ ...current, [key]: value }));

  const submit = () => {
    const base = createEmptyMatch();
    addMatch({ ...base, ...form, totalMatchPoints });
    setForm(initialMatchForm());
    setSheetOpen(false);
  };

  const updateImportImage = (id: string, patch: Partial<ImportImageDraft>) => {
    setImportImages((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  };

  const runOcrForImage = async (id: string, preview: string) => {
    updateImportImage(id, { ocrStatus: "正在识别" });
    try {
      const recognizedText = await recognizeImageText(preview);
      updateImportImage(id, { recognizedText, ocrStatus: "已识别" });
    } catch {
      updateImportImage(id, { ocrStatus: "识别失败" });
    }
  };

  const addImportImages = async (files: FileList | null) => {
    if (!files?.length) return;
    const fileList = Array.from(files);
    const previews = await readFilesAsDataUrls(files);
    const timestamp = Date.now();
    const drafts = previews.map((preview, index) => ({
      id: `import-${timestamp}-${index}`,
      preview,
      fileName: fileList[index]?.name ?? `截图${index + 1}`,
      source: index % 2 === 0 ? "shasha" : "datou",
      recognizedText: "",
      ocrStatus: "等待识别"
    } satisfies ImportImageDraft));

    setImportImages((current) => [...current, ...drafts]);
    drafts.forEach((draft) => { void runOcrForImage(draft.id, draft.preview); });
  };

  const generateRecognitionDrafts = () => {
    const allRawResults = importImages.flatMap((image) => parseMatchLines(image.recognizedText, image.source));
    const merged = mergeMatchResults(allRawResults);
    setRecognitionDrafts(merged);
    setImportOpen(false);
  };

  const confirmRecognitionDrafts = () => {
    if (!recognitionDrafts) return;
    recognitionDrafts.forEach((draft) => addMatch({ ...draft, id: `${draft.id}-${Date.now()}` }));
    setRecognitionDrafts(null);
    setImportImages([]);
  };

  if (recognitionDrafts) {
    return (
      <RecognitionConfirmView
        drafts={recognitionDrafts}
        onBack={() => setRecognitionDrafts(null)}
        onChange={setRecognitionDrafts}
        onConfirm={confirmRecognitionDrafts}
      />
    );
  }

  return (
    <div className="space-y-4">
      {selected ? (
        <MatchDetail match={selected} onBack={() => setSelectedId(null)} onUpdate={updateMatch} onDelete={(id) => { deleteMatch(id); setSelectedId(null); }} />
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <TimelineList title="比赛记录" count={`${matches.length} 场`} groups={grouped} renderItem={(match) => <MatchRecordCard match={match} onClick={() => setSelectedId(match.id)} />} />
            </div>
          </div>
          <ImportFloatingButton onClick={() => setImportOpen(true)} />
          <FloatingAddButton label="新增比赛" onClick={() => setSheetOpen(true)} />
          <BottomSheet title="新增比赛" open={sheetOpen} onClose={() => setSheetOpen(false)}>
            <MatchForm form={form} totalMatchPoints={totalMatchPoints} onChange={updateForm} onSubmit={submit} submitLabel="保存比赛" />
          </BottomSheet>
          <BottomSheet title="批量导入赛事截图" open={importOpen} onClose={() => setImportOpen(false)}>
            <div className="grid gap-4">
              <label className="grid min-h-24 cursor-pointer place-items-center rounded-2xl border border-dashed border-[#eab895] bg-[#fff2e8] text-center text-sm font-semibold text-[var(--berry)]">
                上传多张截图
                <input className="hidden" type="file" accept="image/*" multiple onChange={(event) => { void addImportImages(event.target.files); event.currentTarget.value = ""; }} />
              </label>
              {importImages.map((image) => (
                <article key={image.id} className="rounded-2xl bg-white/70 p-3">
                  <div className="mb-3 flex gap-3">
                    <img src={image.preview} alt={image.fileName} className="h-16 w-16 rounded-xl object-cover" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{image.fileName}</p>
                      <span className={`mt-1 inline-flex rounded-full px-2 py-1 text-xs font-semibold ${image.ocrStatus === "已识别" ? "bg-emerald-50 text-emerald-600" : image.ocrStatus === "识别失败" ? "bg-rose-50 text-rose-500" : image.ocrStatus === "正在识别" ? "bg-[#fff2e8] text-[var(--berry)]" : "bg-white text-[var(--muted)]"}`}>{image.ocrStatus}</span>
                      <select className="input mt-2 h-9 py-1 text-sm" value={image.source} onChange={(event) => setImportImages((current) => current.map((item) => item.id === image.id ? { ...item, source: event.target.value as "shasha" | "datou" } : item))}>
                        <option value="shasha">莎莎图</option>
                        <option value="datou">小王图</option>
                      </select>
                    </div>
                    <button onClick={() => setImportImages((current) => current.filter((item) => item.id !== image.id))} className="grid h-8 w-8 place-items-center rounded-full bg-[#fff2e8] text-[var(--berry)]" aria-label="删除图片"><X size={16} /></button>
                  </div>
                  <textarea className="input min-h-32 resize-none text-sm" placeholder="OCR 失败时也可以在这里手动粘贴文字" value={image.recognizedText} onChange={(event) => setImportImages((current) => current.map((item) => item.id === image.id ? { ...item, recognizedText: event.target.value } : item))} />
                </article>
              ))}
              <button onClick={generateRecognitionDrafts} disabled={!importImages.length} className="h-11 rounded-2xl bg-[var(--berry)] font-semibold text-white disabled:opacity-40">生成候选赛事记录</button>
            </div>
          </BottomSheet>
        </>
      )}
    </div>
  );
}

function MerchView() {
  const { merch, addMerch, updateMerch, deleteMerch } = useHandbookStore();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<MerchFormState>(() => initialMerchForm());
  const [importImages, setImportImages] = useState<MerchImportImageDraft[]>([]);
  const [recognitionDrafts, setRecognitionDrafts] = useState<MerchRecord[] | null>(null);
  const selected = merch.find((record) => record.id === selectedId) ?? null;
  const grouped = useMemo(() => groupByMonth(merch, (record) => record.purchaseDate), [merch]);
  const updateForm = <Key extends keyof MerchFormState>(key: Key, value: MerchFormState[Key]) => setForm((current) => ({ ...current, [key]: value }));
  const submit = () => {
    const base = createEmptyMerch();
    addMerch({ ...base, ...form });
    setForm(initialMerchForm());
    setSheetOpen(false);
  };

  const updateImportImage = (id: string, patch: Partial<MerchImportImageDraft>) => {
    setImportImages((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  };

  const runOcrForImage = async (id: string, preview: string) => {
    updateImportImage(id, { ocrStatus: "正在识别" });
    try {
      const recognizedText = await recognizeImageText(preview);
      updateImportImage(id, { recognizedText, ocrStatus: "已识别" });
    } catch {
      updateImportImage(id, { ocrStatus: "识别失败" });
    }
  };

  const addImportImages = async (files: FileList | null) => {
    if (!files?.length) return;
    const fileList = Array.from(files);
    const previews = await readFilesAsDataUrls(files);
    const timestamp = Date.now();
    const drafts = previews.map((preview, index) => ({
      id: `merch-import-image-${timestamp}-${index}`,
      preview,
      fileName: fileList[index]?.name ?? `购物截图${index + 1}`,
      recognizedText: "",
      ocrStatus: "等待识别"
    } satisfies MerchImportImageDraft));

    setImportImages((current) => [...current, ...drafts]);
    drafts.forEach((draft) => { void runOcrForImage(draft.id, draft.preview); });
  };

  const generateRecognitionDrafts = () => {
    const drafts = importImages.flatMap((image) => parseMerchText(image.recognizedText, image.preview));
    setRecognitionDrafts(drafts);
    setImportOpen(false);
  };

  const confirmRecognitionDrafts = () => {
    if (!recognitionDrafts) return;
    recognitionDrafts.forEach((draft) => addMerch({ ...draft, id: `${draft.id}-${Date.now()}` }));
    setRecognitionDrafts(null);
    setImportImages([]);
  };

  if (recognitionDrafts) {
    return (
      <MerchRecognitionConfirmView
        drafts={recognitionDrafts}
        onBack={() => setRecognitionDrafts(null)}
        onChange={setRecognitionDrafts}
        onConfirm={confirmRecognitionDrafts}
      />
    );
  }

  return (
    <div className="space-y-4">
      {selected ? (
        <MerchDetail record={selected} onBack={() => setSelectedId(null)} onUpdate={updateMerch} onDelete={(id) => { deleteMerch(id); setSelectedId(null); }} />
      ) : (
        <TimelineList title="周边记录" count={`${merch.length} 条`} groups={grouped} renderItem={(record) => <MerchRecordCard record={record} onClick={() => setSelectedId(record.id)} />} markerColor="bg-[#f47b9a]" />
      )}
      {!selected && <ImportFloatingButton label="识别购物截图" onClick={() => setImportOpen(true)} />}
      {!selected && <FloatingAddButton label="新增周边" onClick={() => setSheetOpen(true)} />}
      <BottomSheet title="新增周边" open={sheetOpen} onClose={() => setSheetOpen(false)}>
        <MerchForm form={form} onChange={updateForm} onSubmit={submit} />
      </BottomSheet>
      <BottomSheet title="识别购物截图" open={importOpen} onClose={() => setImportOpen(false)}>
        <div className="grid gap-4">
          <label className="grid min-h-24 cursor-pointer place-items-center rounded-2xl border border-dashed border-[#eab895] bg-[#fff2e8] text-center text-sm font-semibold text-[var(--berry)]">
            上传淘宝 / 天猫订单截图
            <input className="hidden" type="file" accept="image/*" multiple onChange={(event) => { void addImportImages(event.target.files); event.currentTarget.value = ""; }} />
          </label>
          {importImages.map((image) => (
            <article key={image.id} className="rounded-2xl bg-white/70 p-3">
              <div className="mb-3 flex gap-3">
                <img src={image.preview} alt={image.fileName} className="h-16 w-16 rounded-xl object-cover" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{image.fileName}</p>
                  <span className={`mt-1 inline-flex rounded-full px-2 py-1 text-xs font-semibold ${image.ocrStatus === "已识别" ? "bg-emerald-50 text-emerald-600" : image.ocrStatus === "识别失败" ? "bg-rose-50 text-rose-500" : image.ocrStatus === "正在识别" ? "bg-[#fff2e8] text-[var(--berry)]" : "bg-white text-[var(--cocoa)]"}`}>{image.ocrStatus}</span>
                </div>
                <button onClick={() => setImportImages((current) => current.filter((item) => item.id !== image.id))} className="grid h-8 w-8 place-items-center rounded-full bg-[#fff2e8] text-[var(--berry)]" aria-label="删除图片"><X size={16} /></button>
              </div>
              <textarea className="input min-h-32 resize-none text-sm" placeholder="OCR 失败时也可以在这里手动粘贴订单文字" value={image.recognizedText} onChange={(event) => setImportImages((current) => current.map((item) => item.id === image.id ? { ...item, recognizedText: event.target.value } : item))} />
            </article>
          ))}
          <button onClick={generateRecognitionDrafts} disabled={!importImages.length} className="h-11 rounded-2xl bg-[var(--berry)] font-semibold text-white disabled:opacity-40">生成候选周边记录</button>
        </div>
      </BottomSheet>
    </div>
  );
}
function TimelineList<T>({ title, count, groups, renderItem, markerColor = "bg-[var(--apricot)]" }: { title: string; count: string; groups: Array<{ month: string; records: T[] }>; renderItem: (item: T) => React.ReactNode; markerColor?: string }) {
  return (
    <>
      <div className="flex items-end justify-between gap-4">
        <SectionTitle title={title} />
        <span className="text-sm font-medium text-[var(--cocoa)]">{count}</span>
      </div>
      <div className="relative space-y-6 pl-7 before:absolute before:left-[9px] before:top-9 before:h-[calc(100%-36px)] before:w-px before:bg-[#f0c4a6]">
        {groups.map((group) => (
          <section key={group.month} className="relative space-y-3">
            <div className="relative -ml-7 flex items-center gap-3">
              <span className="h-5 w-1 rounded-full bg-[var(--apricot)]" />
              <h3 className="text-xl font-semibold text-[var(--ink)]">{group.month}</h3>
            </div>
            {group.records.map((record, index) => (
              <div key={index} className="relative">
                <span className={`absolute -left-[30px] top-7 h-5 w-5 rounded-full border-4 border-[#f8dcc6] ${markerColor}`} />
                {renderItem(record)}
              </div>
            ))}
          </section>
        ))}
      </div>
    </>
  );
}

function MatchRecordCard({ match, onClick }: { match: MatchRecord; onClick?: () => void }) {
  const scoreGroups = [
    {
      person: "莎莎",
      items: [
        { category: "女单", result: match.shashaSinglesResult, points: match.shashaSinglesPoints },
        { category: "女双", result: match.shashaDoublesResult, points: match.shashaDoublesPoints },
        { category: "女团", result: match.shashaTeamResult, points: match.shashaTeamPoints }
      ]
    },
    {
      person: "大头",
      items: [
        { category: "男单", result: match.datouSinglesResult, points: match.datouSinglesPoints },
        { category: "男双", result: match.datouDoublesResult, points: match.datouDoublesPoints },
        { category: "男团", result: match.datouTeamResult, points: match.datouTeamPoints }
      ]
    },
    {
      person: "莎头",
      items: [
        { category: "混双", result: match.mixedDoublesResult, points: match.mixedDoublesPoints },
        { category: "混团", result: match.mixedTeamResult, points: match.mixedTeamPoints }
      ]
    }
  ].map((group) => ({ ...group, items: group.items.filter((item) => hasScoreResult(item.result)) })).filter((group) => group.items.length > 0);

  const body = (
    <>
      <p className="text-sm font-medium text-[var(--cocoa)]">{formatMonthDay(match.eventDate)}</p>
      <h3 className="mt-2 break-words text-xl font-semibold text-[var(--ink)]">{match.eventName || "未命名赛事"}</h3>
      {scoreGroups.length > 0 ? (
        <div className="mt-4 grid gap-3 text-sm">
          {scoreGroups.map((group) => <ScoreGroupRow key={group.person} person={group.person} items={group.items} />)}
        </div>
      ) : null}
      <PhotoStrip photos={match.photos} />
      <NoteBlock label="观赛感受" text={match.notes} empty="还没有记录观赛感受。" />
      <CardFooter points={match.totalMatchPoints} photos={match.photos.length} positive />
    </>
  );
  if (!onClick) return <article className="card rounded-[24px] p-5">{body}</article>;
  return <button onClick={onClick} className="card block w-full rounded-[24px] p-5 text-left">{body}</button>;
}

function MerchRecordCard({ record, onClick }: { record: MerchRecord; onClick?: () => void }) {
  const body = (
    <>
      <p className="text-sm font-medium text-[var(--cocoa)]">{formatMonthDay(record.purchaseDate)}</p>
      <h3 className="mt-2 break-words text-xl font-semibold text-[var(--ink)]">{record.merchName || "未命名周边"}</h3>
      <PhotoStrip photos={record.photos} compact />
      <NoteBlock text={record.moodNote} empty="还没有心情记录。" />
      <CardFooter points={record.costPoints} photos={record.photos.length} />
    </>
  );
  if (!onClick) return <article className="card rounded-[24px] p-5">{body}</article>;
  return <button onClick={onClick} className="card block w-full rounded-[24px] p-5 text-left">{body}</button>;
}

function hasScoreResult(result?: string | null) {
  const value = result?.trim();
  return Boolean(value && value !== "待补");
}

function scoreLabel(category: string, result?: string | null, points?: number | null) {
  const resultText = result?.trim() ?? "";
  const scoreText = resultText.startsWith(category) ? resultText : `${category}${resultText}`;
  return `${scoreText}${points && points > 0 ? ` +${points}` : ""}`;
}

function ScoreGroupRow({ person, items }: { person: string; items: Array<{ category: string; result?: string | null; points?: number | null }> }) {
  return (
    <div className="grid grid-cols-[76px_1fr] items-start gap-2">
      <span className="pt-2 text-[var(--cocoa)]"><span className="mr-1">{person === "莎莎" ? "🐬" : person === "大头" ? "🦁" : "🏓"}</span>{person}</span>
      <div className="flex min-w-0 flex-wrap gap-2">
        {items.map((item) => (
          <span key={item.category} className="w-fit rounded-full bg-[#f2bf98] px-4 py-2 font-semibold text-[var(--ink)]">
            {scoreLabel(item.category, item.result, item.points)}
          </span>
        ))}
      </div>
    </div>
  );
}

function NoteBlock({ label, text, empty }: { label?: string; text: string; empty: string }) {
  return (
    <div className="mt-4 rounded-2xl bg-[#fff4e7] p-4">
      {label ? <p className="mb-2 text-sm font-semibold text-[var(--cocoa)]">{label}</p> : null}
      <div className="max-h-28 overflow-y-auto whitespace-pre-wrap text-[15px] leading-7 text-[var(--ink)]">{text || empty}</div>
    </div>
  );
}

function CardFooter({ points, photos, positive = false }: { points: number; photos: number; positive?: boolean }) {
  return (
    <div className="mt-4 flex items-center justify-between border-t border-[var(--line)] pt-3">
      <span className={`text-lg font-semibold ${positive ? "text-[#8fc3a6]" : "text-[#e0627d]"}`}>{positive ? "+" : "-"}{points} 积分</span>
      {photos > 0 ? <span className="flex items-center gap-1 text-sm text-[var(--cocoa)]"><ImageIcon size={16} />{photos}</span> : null}
    </div>
  );
}

function PhotoStrip({ photos, compact = false }: { photos: string[]; compact?: boolean }) {
  if (!photos.length) return null;
  return (
    <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
      {photos.map((photo, index) => <img key={`${photo}-${index}`} src={photo} alt="记录照片" className={`${compact ? "h-20 w-20" : "h-16 w-16"} shrink-0 rounded-xl object-cover`} />)}
    </div>
  );
}
function MatchDetail({ match, onBack, onUpdate, onDelete }: { match: MatchRecord; onBack: () => void; onUpdate: (id: string, patch: Partial<MatchRecord>) => void; onDelete: (id: string) => void }) {
  const patch = <Key extends keyof MatchRecord>(key: Key, value: MatchRecord[Key]) => onUpdate(match.id, { [key]: value } as Partial<MatchRecord>);
  return (
    <article className="card rounded-[24px] p-4">
      <div className="mb-3 flex items-center justify-between gap-3"><SectionTitle title="比赛详情" /><button onClick={onBack} className="rounded-full bg-[#fff2e8] px-4 py-2 text-sm font-semibold text-[var(--cocoa)]">返回</button></div>
      <div className="grid gap-3">
        <Field label="赛事名称"><input className="input" value={match.eventName} onChange={(event) => patch("eventName", event.target.value)} /></Field>
        <Field label="比赛日期"><input className="input" type="date" value={match.eventDate} onChange={(event) => patch("eventDate", event.target.value)} /></Field>
        <MatchResultFields record={match} onChange={patch} />
        <Field label="观赛感受"><textarea className="input min-h-28 resize-none" value={match.notes} onChange={(event) => patch("notes", event.target.value)} /></Field>
        <PhotoEditor photos={match.photos} onChange={(photos) => patch("photos", photos)} />
        <div className="rounded-2xl bg-[#fff2e8] px-4 py-3 text-sm font-semibold text-[var(--berry)]">本场积分：+{match.totalMatchPoints}</div>
        <button onClick={() => onDelete(match.id)} className="h-11 rounded-2xl bg-[#fff2e8] font-semibold text-[var(--berry)]">删除这条比赛</button>
      </div>
    </article>
  );
}

function MerchDetail({ record, onBack, onUpdate, onDelete }: { record: MerchRecord; onBack: () => void; onUpdate: (id: string, patch: Partial<MerchRecord>) => void; onDelete: (id: string) => void }) {
  const patch = <Key extends keyof MerchRecord>(key: Key, value: MerchRecord[Key]) => onUpdate(record.id, { [key]: value } as Partial<MerchRecord>);
  return (
    <article className="card rounded-[24px] p-4">
      <div className="mb-3 flex items-center justify-between gap-3"><SectionTitle title="周边详情" /><button onClick={onBack} className="rounded-full bg-[#fff2e8] px-4 py-2 text-sm font-semibold text-[var(--cocoa)]">返回</button></div>
      <div className="grid gap-3">
        <Field label="周边名称"><input className="input" value={record.merchName} onChange={(event) => patch("merchName", event.target.value)} /></Field>
        <Field label="购买日期"><input className="input" type="date" value={record.purchaseDate} onChange={(event) => patch("purchaseDate", event.target.value)} /></Field>
        <Field label="消费积分"><input className="input" type="number" value={record.costPoints} onChange={(event) => patch("costPoints", Number(event.target.value) || 0)} /></Field>
        <Field label="心情记录"><textarea className="input min-h-28 resize-none" value={record.moodNote} onChange={(event) => patch("moodNote", event.target.value)} /></Field>
        <PhotoEditor photos={record.photos} onChange={(photos) => patch("photos", photos)} />
        <div className="rounded-2xl bg-[#fff2e8] px-4 py-3 text-sm font-semibold text-[var(--berry)]">本次消费：-{record.costPoints}</div>
        <button onClick={() => onDelete(record.id)} className="h-11 rounded-2xl bg-[#fff2e8] font-semibold text-[var(--berry)]">删除这条周边</button>
      </div>
    </article>
  );
}

function MatchForm({ form, totalMatchPoints, onChange, onSubmit, submitLabel }: { form: MatchFormState; totalMatchPoints: number; onChange: <Key extends keyof MatchFormState>(key: Key, value: MatchFormState[Key]) => void; onSubmit: () => void; submitLabel: string }) {
  return (
    <div className="grid gap-3">
      <Field label="赛事名称"><input className="input" value={form.eventName} onChange={(event) => onChange("eventName", event.target.value)} /></Field>
      <Field label="比赛日期"><input className="input" type="date" value={form.eventDate} onChange={(event) => onChange("eventDate", event.target.value)} /></Field>
      <MatchResultFields record={form} onChange={onChange} />
      <Field label="观赛感受"><textarea className="input min-h-24 resize-none" value={form.notes} onChange={(event) => onChange("notes", event.target.value)} /></Field>
      <PhotoEditor photos={form.photos} onChange={(photos) => onChange("photos", photos)} />
      <div className="rounded-2xl bg-[#fff2e8] px-4 py-3 text-sm font-semibold text-[var(--berry)]">本场积分：+{totalMatchPoints}</div>
      <button onClick={onSubmit} className="h-11 rounded-2xl bg-[var(--berry)] font-semibold text-white shadow-lg shadow-rose-200">{submitLabel}</button>
    </div>
  );
}

type MatchResultEditable = Pick<MatchRecord,
  "shashaSinglesResult" | "shashaSinglesPoints" |
  "shashaDoublesResult" | "shashaDoublesPoints" |
  "shashaTeamResult" | "shashaTeamPoints" |
  "datouSinglesResult" | "datouSinglesPoints" |
  "datouDoublesResult" | "datouDoublesPoints" |
  "datouTeamResult" | "datouTeamPoints" |
  "mixedDoublesResult" | "mixedDoublesPoints" |
  "mixedTeamResult" | "mixedTeamPoints"
>;

function MatchResultFields({ record, onChange }: { record: MatchResultEditable; onChange: (key: keyof MatchResultEditable, value: string | number) => void }) {
  return (
    <div className="grid gap-3">
      <p className="text-sm font-semibold text-[var(--cocoa)]">莎莎</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="女单成绩"><input className="input" value={record.shashaSinglesResult} onChange={(event) => onChange("shashaSinglesResult", event.target.value)} /></Field>
        <Field label="女单积分"><input className="input" type="number" value={record.shashaSinglesPoints} onChange={(event) => onChange("shashaSinglesPoints", Number(event.target.value) || 0)} /></Field>
        <Field label="女双成绩"><input className="input" value={record.shashaDoublesResult} onChange={(event) => onChange("shashaDoublesResult", event.target.value)} /></Field>
        <Field label="女双积分"><input className="input" type="number" value={record.shashaDoublesPoints} onChange={(event) => onChange("shashaDoublesPoints", Number(event.target.value) || 0)} /></Field>
        <Field label="女团成绩"><input className="input" value={record.shashaTeamResult} onChange={(event) => onChange("shashaTeamResult", event.target.value)} /></Field>
        <Field label="女团积分"><input className="input" type="number" value={record.shashaTeamPoints} onChange={(event) => onChange("shashaTeamPoints", Number(event.target.value) || 0)} /></Field>
      </div>
      <p className="text-sm font-semibold text-[var(--cocoa)]">大头</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="男单成绩"><input className="input" value={record.datouSinglesResult} onChange={(event) => onChange("datouSinglesResult", event.target.value)} /></Field>
        <Field label="男单积分"><input className="input" type="number" value={record.datouSinglesPoints} onChange={(event) => onChange("datouSinglesPoints", Number(event.target.value) || 0)} /></Field>
        <Field label="男双成绩"><input className="input" value={record.datouDoublesResult} onChange={(event) => onChange("datouDoublesResult", event.target.value)} /></Field>
        <Field label="男双积分"><input className="input" type="number" value={record.datouDoublesPoints} onChange={(event) => onChange("datouDoublesPoints", Number(event.target.value) || 0)} /></Field>
        <Field label="男团成绩"><input className="input" value={record.datouTeamResult} onChange={(event) => onChange("datouTeamResult", event.target.value)} /></Field>
        <Field label="男团积分"><input className="input" type="number" value={record.datouTeamPoints} onChange={(event) => onChange("datouTeamPoints", Number(event.target.value) || 0)} /></Field>
      </div>
      <p className="text-sm font-semibold text-[var(--cocoa)]">莎头</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="混双成绩"><input className="input" value={record.mixedDoublesResult} onChange={(event) => onChange("mixedDoublesResult", event.target.value)} /></Field>
        <Field label="混双积分"><input className="input" type="number" value={record.mixedDoublesPoints} onChange={(event) => onChange("mixedDoublesPoints", Number(event.target.value) || 0)} /></Field>
        <Field label="混团成绩"><input className="input" value={record.mixedTeamResult} onChange={(event) => onChange("mixedTeamResult", event.target.value)} /></Field>
        <Field label="混团积分"><input className="input" type="number" value={record.mixedTeamPoints} onChange={(event) => onChange("mixedTeamPoints", Number(event.target.value) || 0)} /></Field>
      </div>
    </div>
  );
}
function MerchForm({ form, onChange, onSubmit }: { form: MerchFormState; onChange: <Key extends keyof MerchFormState>(key: Key, value: MerchFormState[Key]) => void; onSubmit: () => void }) {
  return (
    <div className="grid gap-3">
      <Field label="周边名称"><input className="input" value={form.merchName} onChange={(event) => onChange("merchName", event.target.value)} /></Field>
      <Field label="购买日期"><input className="input" type="date" value={form.purchaseDate} onChange={(event) => onChange("purchaseDate", event.target.value)} /></Field>
      <Field label="消费积分"><input className="input" type="number" value={form.costPoints} onChange={(event) => onChange("costPoints", Number(event.target.value) || 0)} /></Field>
      <Field label="心情记录"><textarea className="input min-h-24 resize-none" value={form.moodNote} onChange={(event) => onChange("moodNote", event.target.value)} /></Field>
      <PhotoEditor photos={form.photos} onChange={(photos) => onChange("photos", photos)} />
      <div className="rounded-2xl bg-[#fff2e8] px-4 py-3 text-sm font-semibold text-[var(--berry)]">本次消费：-{form.costPoints}</div>
      <button onClick={onSubmit} className="h-11 rounded-2xl bg-[var(--berry)] font-semibold text-white shadow-lg shadow-rose-200">保存周边</button>
    </div>
  );
}

function MerchRecognitionConfirmView({ drafts, onBack, onChange, onConfirm }: { drafts: MerchRecord[]; onBack: () => void; onChange: (drafts: MerchRecord[]) => void; onConfirm: () => void }) {
  const updateDraft = (id: string, patch: Partial<MerchRecord>) => onChange(drafts.map((draft) => draft.id === id ? { ...draft, ...patch } : draft));
  const removeDraft = (id: string) => onChange(drafts.filter((draft) => draft.id !== id));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <SectionTitle title="周边识别确认" />
        <button onClick={onBack} className="rounded-full bg-[#fff2e8] px-4 py-2 text-sm font-semibold text-[var(--cocoa)]">返回</button>
      </div>
      <p className="text-sm leading-6 text-[var(--cocoa)]">购物截图 OCR 可能会把商品名或价格识别错，确认前可以逐条修改，不会直接写入正式周边记录。</p>
      {drafts.length ? drafts.map((draft) => (
        <MerchRecognitionResultCard key={draft.id} draft={draft} onUpdate={updateDraft} onDelete={removeDraft} />
      )) : (
        <article className="card rounded-[24px] p-5 text-center text-sm leading-6 text-[var(--cocoa)]">
          没有从当前文字里识别到价格和商品名。可以返回，在 textarea 里手动补充商品名和 ￥价格后再生成。
        </article>
      )}
      <button onClick={onConfirm} disabled={!drafts.length} className="h-12 w-full rounded-2xl bg-[var(--berry)] font-semibold text-white shadow-lg shadow-rose-200 disabled:opacity-40">确认添加</button>
    </div>
  );
}

function MerchRecognitionResultCard({ draft, onUpdate, onDelete }: { draft: MerchRecord; onUpdate: (id: string, patch: Partial<MerchRecord>) => void; onDelete: (id: string) => void }) {
  const patch = <Key extends keyof MerchRecord>(key: Key, value: MerchRecord[Key]) => onUpdate(draft.id, { [key]: value } as Partial<MerchRecord>);
  return (
    <article className="card rounded-[24px] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-semibold text-[var(--ink)]">候选周边</h3>
        <button onClick={() => onDelete(draft.id)} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#fff2e8] text-[var(--berry)]" aria-label="删除识别周边"><X size={17} /></button>
      </div>
      <div className="grid gap-3">
        <Field label="周边名称"><input className="input" value={draft.merchName} onChange={(event) => patch("merchName", event.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="购买日期"><input className="input" type="date" value={draft.purchaseDate} onChange={(event) => patch("purchaseDate", event.target.value)} /></Field>
          <Field label="消费积分"><input className="input" type="number" value={draft.costPoints} onChange={(event) => patch("costPoints", Number(event.target.value) || 0)} /></Field>
        </div>
        <Field label="心情记录"><textarea className="input min-h-24 resize-none" value={draft.moodNote} onChange={(event) => patch("moodNote", event.target.value)} /></Field>
        <PhotoEditor photos={draft.photos} onChange={(photos) => patch("photos", photos)} />
        <div className="rounded-2xl bg-[#fff2e8] px-4 py-3 text-sm font-semibold text-[var(--berry)]">本次消费：-{draft.costPoints}</div>
      </div>
    </article>
  );
}
function PhotoEditor({ photos, onChange }: { photos: string[]; onChange: (photos: string[]) => void }) {
  const addPhotos = async (files: FileList | null) => {
    const next = await readFilesAsDataUrls(files);
    if (next.length) onChange([...photos, ...next]);
  };
  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium text-[var(--cocoa)]">照片</span>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {photos.map((photo, index) => (
          <div key={`${photo}-${index}`} className="relative h-16 w-16 shrink-0">
            <img src={photo} alt="记录照片" className="h-16 w-16 rounded-xl object-cover" />
            <button onClick={() => onChange(photos.filter((_, itemIndex) => itemIndex !== index))} className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-[var(--berry)] text-white" aria-label="删除照片"><X size={12} /></button>
          </div>
        ))}
        <label className="grid h-16 w-16 shrink-0 cursor-pointer place-items-center rounded-xl border border-dashed border-[#eab895] bg-[#fff2e8] text-[var(--berry)]">
          <Plus size={20} />
          <input className="hidden" type="file" accept="image/*" multiple onChange={(event) => { void addPhotos(event.target.files); event.currentTarget.value = ""; }} />
        </label>
      </div>
    </div>
  );
}

function PointsView() {
  const { matches, merch } = useHandbookStore();
  const summary = useMemo(() => getPointsSummary(matches, merch), [matches, merch]);
  const flow = useMemo(() => getPointsFlow(matches, merch), [matches, merch]);
  return (
    <div className="space-y-4">
      <article className="card rounded-[26px] p-5"><p className="text-sm text-[var(--cocoa)]">当前总积分</p><p className="mt-2 text-4xl font-semibold text-[var(--berry)]">{summary.totalPoints}</p></article>
      <div className="grid grid-cols-2 gap-3"><StatCard icon={<appIcons.Trophy size={18} />} label="比赛获得积分" value={`+${summary.matchPoints}`} /><StatCard icon={<appIcons.CircleDollarSign size={18} />} label="周边消费积分" value={`-${summary.merchCostPoints}`} /></div>
      <BackupPanel />
      <SectionTitle title="积分流水" />
      {flow.length ? flow.map((item) => (
        <article key={item.id} className="card flex items-center justify-between gap-3 rounded-[22px] p-4">
          <div className="min-w-0"><h3 className="break-words font-semibold">{item.title}</h3><p className="mt-1 text-xs text-[var(--cocoa)]">{formatMonthDay(item.date)} · {item.type}</p></div>
          <span className={`shrink-0 font-semibold ${item.points >= 0 ? "text-[var(--berry)]" : "text-[var(--cocoa)]"}`}>{item.points >= 0 ? "+" : ""}{item.points}</span>
        </article>
      )) : <p className="py-8 text-center text-sm text-[var(--cocoa)]">还没有积分流水。</p>}
    </div>
  );
}

function BackupPanel() {
  const exportData = useHandbookStore((state) => state.exportData);
  const replaceData = useHandbookStore((state) => state.replaceData);
  const [message, setMessage] = useState("");

  const downloadBackup = () => {
    const backup = exportData();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `shatou-handbook-backup-${backup.exportedAt.slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setMessage("已导出 JSON 备份");
  };

  const importBackup = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as { app?: string; data?: unknown; matches?: unknown; merch?: unknown; points?: unknown };
      const data = parsed.data && typeof parsed.data === "object" ? parsed.data as { matches?: unknown; merch?: unknown; points?: unknown } : parsed;
      if (!Array.isArray(data.matches) || !Array.isArray(data.merch)) throw new Error("invalid backup");
      replaceData({
        matches: data.matches as MatchRecord[],
        merch: data.merch as MerchRecord[],
        points: Array.isArray(data.points) ? data.points : []
      });
      setMessage("已导入备份并恢复到本机 localStorage");
    } catch {
      setMessage("导入失败，请选择有效的 JSON 备份文件");
    }
  };

  return (
    <article className="card rounded-[24px] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-semibold text-[var(--ink)]">数据备份</h3>
        {message ? <span className="text-xs text-[var(--cocoa)]">{message}</span> : null}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <button onClick={downloadBackup} className="flex h-11 items-center justify-center gap-2 rounded-2xl bg-[#fff2e8] text-sm font-semibold text-[var(--berry)]"><Download size={16} />导出数据</button>
        <label className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-2xl bg-[var(--berry)] text-sm font-semibold text-white shadow-lg shadow-rose-100">
          <Upload size={16} />导入数据
          <input className="hidden" type="file" accept="application/json,.json" onChange={(event) => { void importBackup(event.target.files); event.currentTarget.value = ""; }} />
        </label>
      </div>
    </article>
  );
}

function ImportFloatingButton({ label = "批量导入赛事截图", onClick }: { label?: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="fixed bottom-[154px] right-[calc(50%-195px+18px)] z-30 grid h-14 w-14 place-items-center rounded-full bg-[#fff2e8] text-[var(--berry)] shadow-xl shadow-rose-100 ring-1 ring-[var(--line)] transition active:scale-95 max-[430px]:right-5"
    >
      <ImageIcon size={23} />
    </button>
  );
}

function FloatingAddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button onClick={onClick} aria-label={label} className="fixed bottom-24 right-[calc(50%-195px+18px)] z-30 grid h-14 w-14 place-items-center rounded-full bg-[var(--berry)] text-white shadow-xl shadow-rose-200 transition active:scale-95 max-[430px]:right-5"><Plus size={24} /></button>;
}

function BottomSheet({ title, open, onClose, children }: { title: string; open: boolean; onClose: () => void; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-[rgba(61,48,43,0.28)] px-0" role="dialog" aria-modal="true">
      <button className="absolute inset-0 cursor-default" aria-label="关闭弹窗" onClick={onClose} />
      <section className="safe-bottom relative max-h-[86vh] w-full max-w-[430px] overflow-y-auto rounded-t-[28px] border border-[var(--line)] bg-[var(--cream)] px-4 pb-5 pt-3 shadow-2xl">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[rgba(108,85,74,0.24)]" />
        <div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">{title}</h2><button onClick={onClose} className="rounded-full bg-[#fff2e8] px-4 py-2 text-sm font-semibold text-[var(--cocoa)]">取消</button></div>
        {children}
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-1 text-sm font-medium text-[var(--cocoa)]"><span>{label}</span>{children}</label>;
}
function recalcImportedMatchTotal(match: MatchRecord) {
  return (
    match.shashaSinglesPoints +
    match.shashaDoublesPoints +
    match.shashaTeamPoints +
    match.datouSinglesPoints +
    match.datouDoublesPoints +
    match.datouTeamPoints +
    match.mixedDoublesPoints
  );
}

function RecognitionConfirmView({ drafts, onBack, onChange, onConfirm }: { drafts: MatchRecord[]; onBack: () => void; onChange: (drafts: MatchRecord[]) => void; onConfirm: () => void }) {
  const updateDraft = (id: string, patch: Partial<MatchRecord>) => {
    onChange(drafts.map((draft) => {
      if (draft.id !== id) return draft;
      const next = { ...draft, ...patch };
      return { ...next, totalMatchPoints: recalcImportedMatchTotal(next) };
    }));
  };
  const removeDraft = (id: string) => onChange(drafts.filter((draft) => draft.id !== id));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <SectionTitle title="识别结果确认" />
        <button onClick={onBack} className="rounded-full bg-[#fff2e8] px-4 py-2 text-sm font-semibold text-[var(--cocoa)]">返回</button>
      </div>
      <p className="text-sm leading-6 text-[var(--cocoa)]">已跨图片统一合并。同一赛事只生成一张卡片，确认前不会写入正式比赛记录。</p>
      {drafts.map((draft) => (
        <RecognitionResultCard key={draft.id} draft={draft} onUpdate={updateDraft} onDelete={removeDraft} />
      ))}
      <button onClick={onConfirm} disabled={!drafts.length} className="h-12 w-full rounded-2xl bg-[var(--berry)] font-semibold text-white shadow-lg shadow-rose-200 disabled:opacity-40">确认添加</button>
    </div>
  );
}

function RecognitionResultCard({ draft, onUpdate, onDelete }: { draft: MatchRecord; onUpdate: (id: string, patch: Partial<MatchRecord>) => void; onDelete: (id: string) => void }) {
  const patch = <Key extends keyof MatchRecord>(key: Key, value: MatchRecord[Key]) => onUpdate(draft.id, { [key]: value } as Partial<MatchRecord>);
  const chooseConflict = (field: string, value: string) => {
    onUpdate(draft.id, {
      [field]: value,
      conflicts: draft.conflicts.filter((conflict) => conflict.field !== field)
    } as Partial<MatchRecord>);
  };

  return (
    <article className="card rounded-[24px] p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <input className="input font-semibold" value={draft.eventName} onChange={(event) => patch("eventName", event.target.value)} />
          <input className="input mt-2" type="date" value={draft.eventDate} onChange={(event) => patch("eventDate", event.target.value)} />
        </div>
        <button onClick={() => onDelete(draft.id)} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#fff2e8] text-[var(--berry)]" aria-label="删除识别卡片"><X size={17} /></button>
      </div>

      {draft.conflicts.length > 0 ? (
        <div className="mb-3 grid gap-2 rounded-2xl border border-[#f1cf7a] bg-[#fff8d7] p-3 text-sm text-[var(--cocoa)]">
          <p className="font-semibold text-[var(--ink)]">发现冲突，请选择一个结果</p>
          {draft.conflicts.map((conflict) => (
            <div key={conflict.field} className="grid gap-2">
              <span>{conflict.field}</span>
              <div className="flex flex-wrap gap-2">
                {conflict.values.map((value) => (
                  <button key={value} onClick={() => chooseConflict(conflict.field, value)} className="rounded-full bg-white px-3 py-1 font-semibold text-[var(--berry)]">{value}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <EditableResultField label="莎莎女单" result={draft.shashaSinglesResult} points={draft.shashaSinglesPoints} onResult={(value) => patch("shashaSinglesResult", value)} onPoints={(value) => patch("shashaSinglesPoints", value)} />
        <EditableResultField label="莎莎女双" result={draft.shashaDoublesResult} points={draft.shashaDoublesPoints} onResult={(value) => patch("shashaDoublesResult", value)} onPoints={(value) => patch("shashaDoublesPoints", value)} />
        <EditableResultField label="莎莎女团" result={draft.shashaTeamResult} points={draft.shashaTeamPoints} onResult={(value) => patch("shashaTeamResult", value)} onPoints={(value) => patch("shashaTeamPoints", value)} />
        <EditableResultField label="大头男单" result={draft.datouSinglesResult} points={draft.datouSinglesPoints} onResult={(value) => patch("datouSinglesResult", value)} onPoints={(value) => patch("datouSinglesPoints", value)} />
        <EditableResultField label="大头男双" result={draft.datouDoublesResult} points={draft.datouDoublesPoints} onResult={(value) => patch("datouDoublesResult", value)} onPoints={(value) => patch("datouDoublesPoints", value)} />
        <EditableResultField label="大头男团" result={draft.datouTeamResult} points={draft.datouTeamPoints} onResult={(value) => patch("datouTeamResult", value)} onPoints={(value) => patch("datouTeamPoints", value)} />
      </div>
      <div className="mt-3">
        <EditableResultField label="莎头混双" result={draft.mixedDoublesResult} points={draft.mixedDoublesPoints} onResult={(value) => patch("mixedDoublesResult", value)} onPoints={(value) => patch("mixedDoublesPoints", value)} />
        <EditableResultField label="莎头混团" result={draft.mixedTeamResult} points={draft.mixedTeamPoints} onResult={(value) => patch("mixedTeamResult", value)} onPoints={(value) => patch("mixedTeamPoints", value)} />
      </div>
      <Field label="备注"><textarea className="input mt-3 min-h-20 resize-none" value={draft.notes} onChange={(event) => patch("notes", event.target.value)} /></Field>
      <div className="mt-3 rounded-2xl bg-[#fff2e8] px-4 py-3 text-right text-sm font-semibold text-[var(--berry)]">总积分：{draft.totalMatchPoints}</div>
    </article>
  );
}

function EditableResultField({ label, result, points, onResult, onPoints }: { label: string; result: string; points: number; onResult: (value: string) => void; onPoints: (value: number) => void }) {
  return (
    <div className="rounded-2xl bg-white/60 p-3">
      <p className="mb-2 text-xs font-semibold text-[var(--cocoa)]">{label}</p>
      <input className="input h-9 rounded-xl px-2 text-sm" value={result} onChange={(event) => onResult(event.target.value)} placeholder="成绩" />
      <input className="input mt-2 h-9 rounded-xl px-2 text-sm" type="number" value={points} onChange={(event) => onPoints(Number(event.target.value) || 0)} placeholder="积分" />
    </div>
  );
}