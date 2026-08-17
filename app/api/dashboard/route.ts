import { NextRequest, NextResponse } from "next/server";
import { createDemoDashboard } from "@/app/lib/demo.mjs";
import {
  getHistorySummary,
  persistDashboardSnapshot,
} from "@/app/lib/history";
import { readFileSync, existsSync, statSync } from "fs";
import { join } from "path";

export const dynamic = "force-dynamic";

type DashboardCache = {
  expiresAt: number;
  fileMtimeMs: number;
  value: unknown;
};

const globalCache = globalThis as typeof globalThis & {
  __commslayerDashboardCache?: DashboardCache;
};

const CACHE_FILE = join(process.cwd(), ".cache", "dashboard.json");
const RESOLUTIONS_FILE = join(process.cwd(), ".cache", "resolutions.json");
const INFLOW_FILE = join(process.cwd(), ".cache", "inflow.json");
const SNAPSHOT_METRIC_KEYS = [
  "newTotal",
  "newUnder24",
  "newOver24",
  "backlogTotal",
  "backlogOver48",
  "totalActive",
  "unclassified",
] as const;

function envNumber(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function noStoreHeaders() {
  return {
    "Cache-Control": "no-store, max-age=0",
  };
}

function parseList(value: string | undefined) {
  return (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function agentConfigs() {
  const ids = parseList(
    process.env.COMMSLAYER_ASSIGNEE_IDS ||
      process.env.COMMSLAYER_ASSIGNEE_ID,
  );
  const configuredNames = parseList(process.env.COMMSLAYER_AGENT_NAMES);
  const fallbackNames = ["Mari", "Michael", "Gian"];

  return ids.map((assigneeId, index) => ({
    assigneeId,
    name:
      configuredNames[index] ||
      fallbackNames[index] ||
      `Agent ${index + 1}`,
  }));
}

async function loadHistory() {
  try {
    return await getHistorySummary();
  } catch (error) {
    return {
      status: "unavailable" as const,
      storage: "local-json" as const,
      detail:
        error instanceof Error
          ? error.message
          : "Historical storage is unavailable.",
      retentionDays: 400,
      snapshotDays: 0,
      firstSnapshotDate: null,
      lastSnapshotDate: null,
      weekly: [],
    };
  }
}

function cacheFileMtimeMs(): number {
  try {
    return statSync(CACHE_FILE).mtimeMs;
  } catch {
    return 0;
  }
}

function readCacheFile(): unknown | null {
  try {
    if (!existsSync(CACHE_FILE)) return null;
    const raw = readFileSync(CACHE_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

type ResolutionRow = {
  date: string;
  total: number;
  mari: number;
  michael: number;
  gian: number;
  unassigned: number;
};

function readResolutions(): ResolutionRow[] {
  try {
    if (!existsSync(RESOLUTIONS_FILE)) return [];
    const raw = readFileSync(RESOLUTIONS_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    const rows = Array.isArray(parsed?.rows) ? parsed.rows : [];
    return rows.slice(-14);
  } catch {
    return [];
  }
}

type InflowRow = {
  date: string;
  total: number;
  sarah: number;
  mari: number;
  michael: number;
  gian: number;
  other: number;
};

function readInflow(): InflowRow[] {
  try {
    if (!existsSync(INFLOW_FILE)) return [];
    const raw = readFileSync(INFLOW_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    const rows = Array.isArray(parsed?.rows) ? parsed.rows : [];
    return rows.slice(-14);
  } catch {
    return [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPersistableAgents(
  value: unknown,
): value is Parameters<typeof persistDashboardSnapshot>[0] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isRecord(item) &&
        isRecord(item.agent) &&
        typeof item.agent.name === "string" &&
        (typeof item.agent.assigneeId === "string" ||
          typeof item.agent.assigneeId === "number") &&
        isRecord(item.metrics) &&
        SNAPSHOT_METRIC_KEYS.every(
          (metricKey) => typeof item.metrics[metricKey] === "number",
        ),
    )
  );
}

async function prepareCachedDashboard(fileData: unknown) {
  if (!isRecord(fileData)) return fileData;

  if (
    fileData.source === "live" &&
    typeof fileData.refreshedAt === "string" &&
    isPersistableAgents(fileData.agents)
  ) {
    try {
      await persistDashboardSnapshot(fileData.agents, fileData.refreshedAt);
    } catch {
      // History failures must not block the live queue from loading.
    }
  }

  return {
    ...fileData,
    history: await loadHistory(),
    resolutions: readResolutions(),
    inflow: readInflow(),
  };
}

export async function GET(request: NextRequest) {
  const token = process.env.COMMSLAYER_API_TOKEN?.trim();
  const configs = agentConfigs();
  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";

  if (!token || configs.length === 0) {
    const demoDashboard = createDemoDashboard();
    return NextResponse.json(
      {
        ...demoDashboard,
        history: await loadHistory(),
      },
      {
        headers: noStoreHeaders(),
      },
    );
  }

  // forceRefresh bypasses the in-memory cache and re-reads the cache file.
  // The cache file is written by the external Python warmer every 3 hours.
  const now = Date.now();
  const cached = globalCache.__commslayerDashboardCache;
  const fileMtimeMs = cacheFileMtimeMs();

  // Serve from memory only while the TTL holds AND the cache file is unchanged
  // (mtime). When the warmer writes a fresher file, pick it up immediately.
  const memoryCacheUsable =
    cached !== undefined &&
    cached.expiresAt > now &&
    (fileMtimeMs === 0 || cached.fileMtimeMs === fileMtimeMs);

  if (forceRefresh) {
    const fileData = readCacheFile();
    if (fileData) {
      const dashboard = await prepareCachedDashboard(fileData);
      const cacheSeconds = envNumber("COMMSLAYER_CACHE_SECONDS", 21600);
      globalCache.__commslayerDashboardCache = {
        expiresAt: now + cacheSeconds * 1000,
        fileMtimeMs,
        value: dashboard,
      };
      return NextResponse.json(dashboard, {
        headers: noStoreHeaders(),
      });
    }
  }

  // Check in-memory cache (populated from file on first read).
  if (memoryCacheUsable) {
    return NextResponse.json(cached.value, {
      headers: noStoreHeaders(),
    });
  }

  // Read the cache file written by the external Python warmer.
  const fileData = readCacheFile();
  if (fileData) {
    const dashboard = await prepareCachedDashboard(fileData);
    const cacheSeconds = envNumber("COMMSLAYER_CACHE_SECONDS", 21600);
    globalCache.__commslayerDashboardCache = {
      expiresAt: now + cacheSeconds * 1000,
      fileMtimeMs,
      value: dashboard,
    };
    return NextResponse.json(dashboard, {
      headers: noStoreHeaders(),
    });
  }

  // No cache file — serve demo data.
  const demoDashboard = createDemoDashboard();
  return NextResponse.json(
    {
      ...demoDashboard,
      history: await loadHistory(),
      source: "demo" as const,
      notice: "Waiting for the next scheduled data refresh (every 3 hours)." as unknown as null,
    },
    {
      headers: noStoreHeaders(),
    },
  );
}
