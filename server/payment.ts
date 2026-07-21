/**
 * Solana Devnet payment verification (x402).
 * Fail-closed on RPC errors unless ALLOW_PAYMENT_BYPASS=true.
 */

import { Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';

export async function verifySolanaDevnetPayment(
  signature: string,
  recipientWallet: string,
  expectedSolAmount: number
): Promise<{ verified: boolean; logs: string[]; error?: string }> {
  const logs: string[] = [];
  const allowBypass = process.env.ALLOW_PAYMENT_BYPASS === 'true';

  logs.push(`[RPC Handshake] Initializing Solana Devnet Connection...`);

  if (signature.startsWith('MOCK_TX_') || signature === 'SOLVAMOS_TEST_SIGNATURE') {
    if (!allowBypass) {
      logs.push(`[Rejected] Mock signatures disabled (ALLOW_PAYMENT_BYPASS!=true)`);
      return { verified: false, logs, error: 'Mock payment signatures are not allowed' };
    }
    logs.push(`[Mock Verification] Sandbox signature accepted under ALLOW_PAYMENT_BYPASS`);
    return { verified: true, logs };
  }

  try {
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
    const connection = new Connection(rpcUrl, 'confirmed');
    logs.push(`[RPC Query] signature=${signature}`);

    const tx = await connection.getTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });

    if (!tx) {
      return { verified: false, logs, error: 'Transaction signature not found on Devnet' };
    }

    const meta = tx.meta;
    if (!meta) {
      return { verified: false, logs, error: 'Transaction meta information is missing' };
    }

    const accountKeys = tx.transaction.message.getAccountKeys();
    let recipientIndex = -1;
    for (let i = 0; i < accountKeys.length; i++) {
      if (accountKeys.get(i)?.toBase58() === recipientWallet) {
        recipientIndex = i;
        break;
      }
    }

    if (recipientIndex === -1) {
      return {
        verified: false,
        logs,
        error: 'Recipient address not found in transaction accounts',
      };
    }

    const preBalance = meta.preBalances[recipientIndex] || 0;
    const postBalance = meta.postBalances[recipientIndex] || 0;
    const receivedSol = (postBalance - preBalance) / LAMPORTS_PER_SOL;
    logs.push(`[Payment Audit] Net received SOL: ${receivedSol}`);

    if (receivedSol >= expectedSolAmount * 0.99) {
      logs.push(`[SUCCESS] Payment verified`);
      return { verified: true, logs };
    }
    return {
      verified: false,
      logs,
      error: `Incomplete payment. Expected ${expectedSolAmount} SOL, got ${receivedSol}`,
    };
  } catch (err: any) {
    logs.push(`[RPC Error] ${err.message}`);
    if (allowBypass) {
      logs.push(`[Sandbox Grace] ALLOW_PAYMENT_BYPASS=true — accepting signature`);
      return { verified: true, logs };
    }
    return {
      verified: false,
      logs,
      error: `RPC verification failed (fail-closed): ${err.message}`,
    };
  }
}
