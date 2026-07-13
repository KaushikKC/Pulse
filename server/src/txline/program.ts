/**
 * Anchor program loader for the TxLINE Solana program — shared by the one-time
 * onboarding (subscribe) flow and the on-chain stat-validation reads.
 *
 * The IDL is fetched on-chain (`anchor idl init`) with a local file fallback, so
 * we never hard-code an interface that could drift from the deployed program.
 */
import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { config } from "../config.js";

/**
 * Load the configured Solana keypair (the wallet used to subscribe), if any.
 * Returns null when `TXLINE_WALLET_KEYPAIR` is unset.
 */
export function loadConfiguredKeypair(): Keypair | null {
  const path = config.solana.keypairPath;
  if (!path) return null;
  const raw = JSON.parse(readFileSync(path.replace(/^~/, process.env.HOME ?? ""), "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

/**
 * Load the deployed program via its on-chain IDL (local file fallback). An
 * optional `patch` runs on the raw IDL before the Program is built — used to
 * annotate `validate_stat` with its `returns` type so anchor can `.view()` it
 * (the published IDL omits the return annotation).
 */
export async function loadProgram(
  provider: anchor.AnchorProvider,
  programId: PublicKey,
  patch?: (idl: any) => void,
): Promise<anchor.Program> {
  let idl = await anchor.Program.fetchIdl(programId, provider);
  if (!idl) {
    try {
      idl = JSON.parse(
        readFileSync(new URL("../../idl/txline.json", import.meta.url), "utf8"),
      );
    } catch {
      throw new Error(
        `Could not fetch the TxLINE IDL on-chain for ${programId.toBase58()} and no ` +
          `local server/idl/txline.json present. Drop the program IDL there and re-run.`,
      );
    }
  }
  // Ensure the address is set so anchor 0.30 resolves the program id.
  (idl as any).address = programId.toBase58();
  patch?.(idl);
  return new anchor.Program(idl as anchor.Idl, provider);
}

/**
 * A read-only Anchor provider for `.view()` calls (like `validateStat`), which
 * run as a simulation with signature verification off. Simulation still needs a
 * fee-payer account that EXISTS on-chain, so we reuse the configured subscribe
 * wallet (already funded) as the payer, falling back to a throwaway keypair when
 * none is configured.
 */
export function readOnlyProvider(): anchor.AnchorProvider {
  const connection = new Connection(config.solana.rpc, "confirmed");
  const wallet = new anchor.Wallet(loadConfiguredKeypair() ?? Keypair.generate());
  return new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
}
