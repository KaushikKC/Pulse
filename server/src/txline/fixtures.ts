import { config } from "../config.js";

/**
 * Fixtures snapshot — the "match list (setup)" call. The live SSE feed only carries
 * participant *IDs*, so we fetch /api/fixtures/snapshot once to (a) populate the
 * lobby with real matches and (b) resolve team names for live score frames.
 */
export interface FixtureInfo {
  fixtureId: string;
  participants: [string, string];
  competition?: string;
  startTime?: number;
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${config.txline.jwt}`,
    "X-Api-Token": config.txline.apiToken,
  };
}

export async function fetchFixturesSnapshot(): Promise<FixtureInfo[]> {
  const res = await fetch(`${config.txline.baseUrl}/api/fixtures/snapshot`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    throw new Error(`fixtures/snapshot failed: HTTP ${res.status} ${await res.text()}`);
  }
  const arr = (await res.json()) as Record<string, any>[];
  return arr.map((f) => ({
    fixtureId: String(f.FixtureId ?? f.fixtureId),
    participants: [
      String(f.Participant1 ?? `Team ${f.Participant1Id ?? "1"}`),
      String(f.Participant2 ?? `Team ${f.Participant2Id ?? "2"}`),
    ],
    competition: f.Competition,
    startTime: f.StartTime,
  }));
}

/**
 * Registry the ingest consults to attach real names to live frames (which only
 * carry participant IDs).
 */
class FixtureRegistry {
  private names = new Map<string, [string, string]>();

  setAll(fixtures: FixtureInfo[]): void {
    for (const f of fixtures) this.names.set(f.fixtureId, f.participants);
  }

  names_(fixtureId: string): [string, string] | undefined {
    return this.names.get(fixtureId);
  }
}

export const fixtureRegistry = new FixtureRegistry();
