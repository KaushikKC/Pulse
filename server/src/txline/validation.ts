/**
 * On-chain stat validation — the "verified moment" differentiator.
 *
 * Two steps, exactly as the TxLINE docs' on-chain-validation example describes:
 *
 *   1. FETCH PROOF   GET /api/scores/stat-validation?fixtureId=&seq=&statKey=
 *                    → a Merkle proof (sub-tree + main-tree + stat proof nodes)
 *                      for one stat increment in the feed.
 *   2. VALIDATE      program.validateStat(...).view()  against the
 *                      `daily_scores_roots` PDA published on Solana each day.
 *
 * `validateStat` is a read-only `.view()` — it simulates and returns a boolean,
 * so it needs NO funded wallet and no signature (see readOnlyProvider). The proof
 * FETCH, however, needs a live TxLINE API token (headers below). Both the devnet
 * and mainnet programs publish daily roots, so this works on devnet.
 */
import anchorPkg from "@coral-xyz/anchor";
import { ComputeBudgetProgram, PublicKey } from "@solana/web3.js";
import { config } from "../config.js";
import { loadProgram, readOnlyProvider } from "./program.js";

// NB: `import * as anchor` does not surface anchor's re-exported `BN` under tsx's
// ESM interop (it's `export { default as BN } from "bn.js"`); the default import
// does. See the on-chain-validation notes in the README.
const { BN } = anchorPkg;

// ---------------------------------------------------------------------------
// Types mirroring the /api/scores/stat-validation response
// ---------------------------------------------------------------------------

/** The live devnet API returns 32-byte hashes as number arrays (not hex). */
type Bytes32 = number[];

interface ProofNode {
  hash: Bytes32;
  isRightSibling: boolean;
}

export interface StatProof {
  summary: {
    fixtureId: number | string;
    updateStats: {
      updateCount: number;
      minTimestamp: number | string;
      maxTimestamp: number | string;
    };
    eventStatsSubTreeRoot: Bytes32;
  };
  subTreeProof: ProofNode[];
  mainTreeProof: ProofNode[];
  /** e.g. { key: 1002, value: 1, period: 4 } — passed straight to the program. */
  statToProve: unknown;
  eventStatRoot: Bytes32;
  statProof: ProofNode[];
}

export interface OnChainResult {
  valid: boolean;
  root: string;
  pda: string;
  epochDay: number;
  explorer: string;
  /** The proven stat value (e.g. goal tally) from statToProve. */
  statValue: number;
}

// ---------------------------------------------------------------------------
// Step 1 — fetch the Merkle proof from TxLINE (needs a live API token)
// ---------------------------------------------------------------------------

export function hasLiveToken(): boolean {
  return Boolean(config.txline.apiToken && config.txline.jwt);
}

export async function fetchStatProof(
  fixtureId: string | number,
  seq: number,
  statKey: number,
): Promise<StatProof> {
  if (!hasLiveToken()) {
    throw new Error(
      "no TxLINE API token — run `npm run setup:txline -w @pulse/server` to enable on-chain verification",
    );
  }
  const url = new URL(`${config.txline.baseUrl}/api/scores/stat-validation`);
  url.searchParams.set("fixtureId", String(fixtureId));
  url.searchParams.set("seq", String(seq));
  url.searchParams.set("statKey", String(statKey));

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${config.txline.jwt}`,
      "X-Api-Token": config.txline.apiToken,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`stat-validation HTTP ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as StatProof;
}

// ---------------------------------------------------------------------------
// Step 2 — validate the proof on-chain against the daily Merkle root
// ---------------------------------------------------------------------------

export async function validateStatOnChain(v: StatProof): Promise<OnChainResult> {
  const provider = readOnlyProvider();
  const programId = new PublicKey(config.solana.programId);
  // The published IDL omits `validate_stat`'s return type; annotate it so anchor
  // exposes a `.view()` (the on-chain program returns a bool via set_return_data).
  const program = await loadProgram(provider, programId, patchValidateStatReturns);

  const targetTs = Number(v.summary.updateStats.minTimestamp);
  const epochDay = Math.floor(targetTs / (24 * 60 * 60 * 1000));
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("daily_scores_roots"), new BN(epochDay).toArrayLike(Buffer, "le", 2)],
    programId,
  );

  const root = asBytes32(v.summary.eventStatsSubTreeRoot);
  // Anchor 0.30 encodes by the IDL field names (snake_case); we dual-key both
  // casings so it works regardless of the coder's expectation.
  const updateStats = dual({
    update_count: v.summary.updateStats.updateCount,
    min_timestamp: new BN(v.summary.updateStats.minTimestamp),
    max_timestamp: new BN(v.summary.updateStats.maxTimestamp),
  });
  const fixtureSummary = dual({
    fixture_id: new BN(v.summary.fixtureId),
    update_stats: updateStats,
    events_sub_tree_root: root,
  });
  const statA = dual({
    stat_to_prove: v.statToProve, // { key, value, period } — same in both casings
    event_stat_root: asBytes32(v.eventStatRoot),
    stat_proof: toProofNodes(v.statProof),
  });

  // Single-stat existence proof: "this stat value is in the tree" (threshold 0,
  // greaterThan). stat_b / op are null for the single-stat case.
  const valid: unknown = await program.methods
    .validateStat(
      new BN(targetTs),
      fixtureSummary,
      toProofNodes(v.subTreeProof),
      toProofNodes(v.mainTreeProof),
      { threshold: 0, comparison: { greaterThan: {} } },
      statA,
      null,
      null,
    )
    .accounts({ dailyScoresMerkleRoots: pda })
    .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })])
    .view();

  return {
    valid: Boolean(valid),
    root: hex(v.summary.eventStatsSubTreeRoot),
    pda: pda.toBase58(),
    epochDay,
    explorer: explorerUrl(pda.toBase58()),
    statValue: Number((v.statToProve as any)?.value ?? 0),
  };
}

/** Add camelCase aliases for every snake_case key so either coder casing works. */
function dual<T extends Record<string, unknown>>(obj: T): T & Record<string, unknown> {
  const out: Record<string, unknown> = { ...obj };
  for (const [k, val] of Object.entries(obj)) {
    const camel = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    if (camel !== k) out[camel] = val;
  }
  return out as T & Record<string, unknown>;
}

/** Mark `validate_stat` as returning a bool so anchor builds a `.view()` for it. */
function patchValidateStatReturns(idl: any): void {
  const ix = idl?.instructions?.find(
    (i: any) => i.name === "validate_stat" || i.name === "validateStat",
  );
  if (ix && !ix.returns) ix.returns = "bool";
}

/** Fetch + validate in one call. Returns the on-chain result or throws. */
export async function verifyStat(
  fixtureId: string | number,
  seq: number,
  statKey: number,
): Promise<OnChainResult> {
  const proof = await fetchStatProof(fixtureId, seq, statKey);
  return validateStatOnChain(proof);
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** A Solana explorer link for the active network. */
export function explorerUrl(address: string): string {
  const cluster = config.network === "mainnet" ? "" : "?cluster=devnet";
  return `https://explorer.solana.com/address/${address}${cluster}`;
}

/**
 * Coerce a hash into the 32-byte number array the program expects. The live
 * devnet API already returns byte arrays; we also accept hex strings defensively
 * in case another deployment returns that form.
 */
function asBytes32(v: unknown): number[] {
  let bytes: number[];
  if (Array.isArray(v)) {
    bytes = v.map((n) => Number(n) & 0xff);
  } else if (typeof v === "string") {
    const clean = v.replace(/^0x/, "");
    bytes = [];
    for (let i = 0; i < clean.length; i += 2) bytes.push(parseInt(clean.slice(i, i + 2), 16));
  } else {
    bytes = [];
  }
  while (bytes.length < 32) bytes.push(0);
  return bytes.slice(0, 32);
}

function toProofNodes(nodes: ProofNode[] = []): Record<string, unknown>[] {
  return nodes.map((n) => {
    const isRight = Boolean((n as any).isRightSibling ?? (n as any).is_right_sibling);
    return { hash: asBytes32(n.hash), is_right_sibling: isRight, isRightSibling: isRight };
  });
}

/** Byte array (or hex string) → short hex for display. */
function hex(v: unknown): string {
  if (Array.isArray(v)) return v.map((n) => (Number(n) & 0xff).toString(16).padStart(2, "0")).join("");
  return String(v ?? "");
}
