import { NextRequest, NextResponse } from "next/server";
import { createDemoDashboard } from "@/app/lib/demo.mjs";
import { getHistorySummary } from "@/app/lib/history";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

export const dynamic = "force-dynamic";

type DashboardCache = {
  expiresAt: number;
  value: unknown;
};

const globalCache = globalThis as typeof globalThis & {
  __commslayerDashboardCache?: DashboardCache;
};

const CACHE_FILE = join(process.cwd(), ".cache", "dashboard.json");

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
      storage: "local-d1" as const,
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

function readCacheFile(): unknown | null {
  try {
    if (!existsSync(CACHE_FILE)) return null;
    const raw = readFileSync(CACHE_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
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
  // The cache file is written by the external Python warmer every 6 hours.
  const now = Date.now();
  const cached = globalCache.__commslayerDashboardCache;

  if (forceRefresh) {
    const fileData = readCacheFile();
    if (fileData) {
      const cacheSeconds = envNumber("COMMSLAYER_CACHE_SECONDS", 21600);
      globalCache.__commslayerDashboardCache = {
        expiresAt: now + cacheSeconds * 1000,
        value: fileData,
      };
      return NextResponse.json(fileData, {
        headers: noStoreHeaders(),
      });
    }
  }

  // Check in-memory cache (populated from file on first read).
  if (cached && cached.expiresAt > now) {
    return NextResponse.json(cached.value, {
      headers: noStoreHeaders(),
    });
  }

  // Read the cache file written by the external Python warmer.
  const fileData = readCacheFile();
  if (fileData) {
    const cacheSeconds = envNumber("COMMSLAYER_CACHE_SECONDS", 21600);
    globalCache.__commslayerDashboardCache = {
      expiresAt: now + cacheSeconds * 1000,
      value: fileData,
    };
    return NextResponse.json(fileData, {
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
