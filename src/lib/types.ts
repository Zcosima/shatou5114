export type MatchConflict = {
  field: string;
  values: string[];
};

export type MatchRecord = {
  id: string;
  eventName: string;
  eventDate: string;

  shashaSinglesResult: string;
  shashaSinglesPoints: number;
  shashaDoublesResult: string;
  shashaDoublesPoints: number;
  shashaTeamResult: string;
  shashaTeamPoints: number;

  datouSinglesResult: string;
  datouSinglesPoints: number;
  datouDoublesResult: string;
  datouDoublesPoints: number;
  datouTeamResult: string;
  datouTeamPoints: number;

  mixedDoublesResult: string;
  mixedDoublesPoints: number;
  mixedTeamResult: string;
  mixedTeamPoints: number;

  notes: string;
  photos: string[];
  totalMatchPoints: number;
  conflicts: MatchConflict[];
  createdAt: string;
};

export type MerchRecord = {
  id: string;
  merchName: string;
  purchaseDate: string;
  costPoints: number;
  moodNote: string;
  photos: string[];
  createdAt: string;
};

export type PointsEntry = {
  id: string;
  date: string;
  title: string;
  points: number;
  source: "比赛" | "周边" | "手动";
  createdAt: string;
};

export type RawMatchResult = {
  date: string;
  eventName: string;
  athlete: "shasha" | "datou" | "mixed";
  category: "女单" | "女双" | "男单" | "男双" | "混双" | "混团" | "女团" | "男团";
  result: string;
};