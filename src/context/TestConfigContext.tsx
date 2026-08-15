import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type Checkpoint = {
  id: string;
  code: string;
  label: string;
};

export const CHECKPOINTS: Checkpoint[] = [
  { id: "find-product", code: "CP-01", label: "Find product" },
  { id: "read-price", code: "CP-02", label: "Read price" },
  { id: "check-stock", code: "CP-03", label: "Check stock" },
  { id: "add-to-cart", code: "CP-04", label: "Add to cart" },
  { id: "reach-checkout", code: "CP-05", label: "Reach checkout" },
];

export type GoalMode = "checkpoints" | "freetext";

export type AttemptOutcome = {
  n: number;
  result: "success" | "fail";
  failCode: "CP-03" | "CP-04" | null;
  progressPct: number;
};

export type RunResult = {
  score: number;
  previousScore: number;
  durationLabel: string;
  cost: string;
  attempts: AttemptOutcome[];
};

type TestConfigState = {
  siteUrl: string;
  setSiteUrl: (v: string) => void;
  mode: GoalMode;
  setMode: (v: GoalMode) => void;
  freeTextGoal: string;
  setFreeTextGoal: (v: string) => void;
  checkedCheckpoints: Set<string>;
  toggleCheckpoint: (id: string) => void;
  attempts: 1 | 5;
  setAttempts: (v: 1 | 5) => void;
  alsoMonitor: boolean;
  setAlsoMonitor: (v: boolean) => void;
  runResult: RunResult | null;
  setRunResult: (v: RunResult) => void;
  /** id of the real backend run created by POST /runs (see src/lib/api.ts createRun) */
  runId: string | null;
  setRunId: (v: string | null) => void;
};

const TestConfigContext = createContext<TestConfigState | null>(null);

export function TestConfigProvider({ children }: { children: ReactNode }) {
  const [siteUrl, setSiteUrl] = useState("https://northfield-supply.com");
  const [mode, setMode] = useState<GoalMode>("checkpoints");
  const [freeTextGoal, setFreeTextGoal] = useState("Buy the cheapest in-stock backpack");
  const [checkedCheckpoints, setCheckedCheckpoints] = useState<Set<string>>(
    () => new Set(CHECKPOINTS.filter((c) => c.id !== "reach-checkout").map((c) => c.id)),
  );
  const [attempts, setAttempts] = useState<1 | 5>(5);
  const [alsoMonitor, setAlsoMonitor] = useState(false);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [runId, setRunId] = useState<string | null>(null);

  const toggleCheckpoint = (id: string) => {
    setCheckedCheckpoints((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const value = useMemo<TestConfigState>(
    () => ({
      siteUrl,
      setSiteUrl,
      mode,
      setMode,
      freeTextGoal,
      setFreeTextGoal,
      checkedCheckpoints,
      toggleCheckpoint,
      attempts,
      setAttempts,
      alsoMonitor,
      setAlsoMonitor,
      runResult,
      setRunResult,
      runId,
      setRunId,
    }),
    [siteUrl, mode, freeTextGoal, checkedCheckpoints, attempts, alsoMonitor, runResult, runId],
  );

  return <TestConfigContext.Provider value={value}>{children}</TestConfigContext.Provider>;
}

export function useTestConfig() {
  const ctx = useContext(TestConfigContext);
  if (!ctx) throw new Error("useTestConfig must be used within TestConfigProvider");
  return ctx;
}
