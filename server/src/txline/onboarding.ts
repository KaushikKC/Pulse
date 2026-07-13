/**
 * TxLINE onboarding — the one-time flow that turns a funded Solana **devnet**
 * wallet into a working API token for the live feed. Run with:
 *
 *   npm run setup:txline -w @pulse/server
 *
 * Three steps (from the TxLINE World Cup docs):
 *   1. Guest JWT      POST /auth/guest/start                         → { token }
 *   2. Subscribe      program.subscribe(SERVICE_LEVEL_ID, weeks)     → txSig
 *   3. Activate token POST /api/token/activate { txSig, sig, leagues } → { token }
 *
 * Free tiers (Service Level 1 = 60s delay, 12 = real-time) require NO TxL tokens —
 * but the subscribe instruction still needs the user's TxL Token-2022 ATA to exist,
 * so we create it (idempotent) before subscribing. Costs only a little devnet SOL.
 */
import { readFileSync } from "node:fs";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import nacl from "tweetnacl";
import { config } from "../config.js";
import { loadProgram } from "./program.js";

const BASE = config.txline.baseUrl;
const SERVICE_LEVEL_ID = config.txline.serviceLevelId; // 12 = real-time, free
const DURATION_WEEKS = config.txline.durationWeeks;
const SELECTED_LEAGUES: number[] = []; // empty = standard WC + Int Friendlies bundle

// ---------------------------------------------------------------------------
// Wallet
// ---------------------------------------------------------------------------

function loadKeypair(): Keypair {
  const path = config.solana.keypairPath;
  if (!path) {
    throw new Error(
      "TXLINE_WALLET_KEYPAIR is not set. Create a devnet wallet:\n" +
        "  solana-keygen new --outfile ~/pulse-devnet.json\n" +
        "  solana config set --url devnet && solana airdrop 2\n" +
        "then set TXLINE_WALLET_KEYPAIR=~/pulse-devnet.json in server/.env",
    );
  }
  const raw = JSON.parse(readFileSync(path.replace(/^~/, process.env.HOME ?? ""), "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

// ---------------------------------------------------------------------------
// Step 1 — guest JWT
// ---------------------------------------------------------------------------

export async function getGuestJwt(): Promise<string> {
  const res = await fetch(`${BASE}/auth/guest/start`, { method: "POST" });
  if (!res.ok) {
    throw new Error(`guest/start failed: HTTP ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as Record<string, any>;
  const jwt = data.token ?? data.jwt ?? data.accessToken;
  if (!jwt) throw new Error(`guest/start returned no token: ${JSON.stringify(data)}`);
  console.log("[onboarding] ✓ guest JWT acquired");
  return jwt as string;
}

// ---------------------------------------------------------------------------
// Step 2 — subscribe on-chain to the free tier
// ---------------------------------------------------------------------------

export async function subscribe(keypair: Keypair): Promise<string> {
  const connection = new Connection(config.solana.rpc, "confirmed");
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const programId = new PublicKey(config.solana.programId);
  const program = await loadProgram(provider, programId);

  const tokenMint = new PublicKey(config.solana.txlMint);

  // PDAs (seeds from the TxLINE programs/addresses doc).
  const [pricingMatrixPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pricing_matrix")],
    programId,
  );
  const [tokenTreasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_treasury_v2")],
    programId,
  );
  const tokenTreasuryVault = getAssociatedTokenAddressSync(
    tokenMint,
    tokenTreasuryPda,
    true, // treasury is a PDA (off-curve owner)
    TOKEN_2022_PROGRAM_ID,
  );

  // The user's TxL ATA must exist even for the free tier — create if missing.
  console.log("[onboarding] ensuring TxL token account exists…");
  const userTokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    keypair,
    tokenMint,
    keypair.publicKey,
    false,
    "confirmed",
    undefined,
    TOKEN_2022_PROGRAM_ID,
  );

  console.log(
    `[onboarding] subscribing: serviceLevel=${SERVICE_LEVEL_ID} weeks=${DURATION_WEEKS} (${config.network})`,
  );
  const txSig = await program.methods
    .subscribe(SERVICE_LEVEL_ID, DURATION_WEEKS)
    .accounts({
      user: keypair.publicKey,
      pricingMatrix: pricingMatrixPda,
      tokenMint,
      userTokenAccount: userTokenAccount.address,
      tokenTreasuryVault,
      tokenTreasuryPda,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log("[onboarding] ✓ subscription tx:", txSig);
  return txSig;
}

// ---------------------------------------------------------------------------
// Step 3 — activate the API token
// ---------------------------------------------------------------------------

export async function activateToken(
  jwt: string,
  txSig: string,
  keypair: Keypair,
): Promise<string> {
  // Sign "<txSig>:<leagues>:<jwt>" with the wallet secret key (per docs).
  const messageString = `${txSig}:${SELECTED_LEAGUES.join(",")}:${jwt}`;
  const signatureBytes = nacl.sign.detached(
    new TextEncoder().encode(messageString),
    keypair.secretKey,
  );
  const walletSignature = Buffer.from(signatureBytes).toString("base64");

  const res = await fetch(`${BASE}/api/token/activate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({ txSig, walletSignature, leagues: SELECTED_LEAGUES }),
  });
  if (!res.ok) {
    throw new Error(`token/activate failed: HTTP ${res.status} ${await res.text()}`);
  }
  // The endpoint returns the token as plain text (e.g. "txoracle_api_…"); some
  // deployments wrap it in JSON. Handle both.
  const body = (await res.text()).trim();
  let apiToken = body;
  if (body.startsWith("{")) {
    const data = JSON.parse(body) as Record<string, any>;
    apiToken = data.token ?? data.apiToken;
  }
  if (!apiToken) throw new Error(`token/activate returned no token: ${body}`);
  console.log("[onboarding] ✓ API token activated");
  return apiToken;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(
    `[onboarding] TxLINE setup — network=${config.network} api=${BASE} ` +
      `program=${config.solana.programId}`,
  );
  const keypair = loadKeypair();
  console.log("[onboarding] wallet:", keypair.publicKey.toBase58());

  const jwt = await getGuestJwt();
  const txSig = await subscribe(keypair);
  const apiToken = await activateToken(jwt, txSig, keypair);

  console.log("\n=== Add these to server/.env ===");
  console.log("FEED_MODE=live");
  console.log(`NETWORK=${config.network}`);
  console.log(`TXLINE_JWT=${jwt}`);
  console.log(`TXLINE_API_TOKEN=${apiToken}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error("\n[onboarding] failed:", err.message ?? err);
    process.exit(1);
  });
}
