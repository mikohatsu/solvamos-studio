/**
 * A2A orchestrator — human talks to one agent; that agent may pay-call
 * peers discovered on the pay.sh catalog, then synthesize an answer.
 */

import { GoogleGenAI } from '@google/genai';
import { config, networkLabel } from './config.js';
import { getAgent, bumpInvoke, listAgents, type AgentRecord } from './agents-store.js';
import { generateGroundedAnswer } from './rag.js';
import { verifyPayment } from './payment.js';
import { getCatalogEntry, listCatalog, type PayShCatalogEntry } from './paysh-catalog.js';

export type A2APeerHop = {
  fromAgentId: string;
  toAgentId: string;
  toName: string;
  question: string;
  feeUsdc: number;
  paymentProof: string;
  paymentVerified: boolean;
  answer?: string;
  error?: string;
  catalogId?: string;
};

export type A2AOrchestrationResult = {
  answer: string;
  confidence: number;
  citations: any[];
  ragMode: string;
  peerHops: A2APeerHop[];
  catalogUsed: boolean;
  planningNote?: string;
};

type PeerPlan = { agentId: string; question: string; reason?: string };

const MAX_PEER_CALLS = 2;

function agentFee(agent: AgentRecord): number {
  if (typeof agent.fee === 'number') return agent.fee;
  if (typeof agent.perCallPriceUsdc === 'number') return agent.perCallPriceUsdc;
  return config.defaultAgentFeeUsdc;
}

function catalogForPeers(excludeAgentId: string): PayShCatalogEntry[] {
  return listCatalog({ listedOnly: true }).filter((e) => e.agentId !== excludeAgentId);
}

/** Decide which catalog peers to call (Gemini if available, else heuristic). */
export async function planPeerCalls(
  caller: AgentRecord,
  userPrompt: string,
  peers: PayShCatalogEntry[]
): Promise<{ calls: PeerPlan[]; note: string }> {
  if (peers.length === 0) {
    return { calls: [], note: 'pay.sh catalog has no other listed agents' };
  }

  const catalogBrief = peers
    .map(
      (p) =>
        `- id=${p.agentId} name="${p.name}" role=${p.role} fee=${p.feeUsdc} USDC tags=${p.tags.join(',')}`
    )
    .join('\n');

  if (config.geminiApiKey) {
    try {
      const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
      const response = await ai.models.generateContent({
        model: config.geminiModel || 'gemini-2.0-flash',
        contents: `You are the planning head of SolVamos agent "${caller.agentName || caller.id}" (role=${caller.role}).

User message:
"""${userPrompt}"""

pay.sh catalog peers you may PAY to query (x402 / USDC):
${catalogBrief}

If your own knowledge is enough, return {"calls":[]}.
If you need another agent's specialty, pick up to ${MAX_PEER_CALLS} peers and craft a focused question for each.

Return ONLY JSON:
{"calls":[{"agentId":"...","question":"...","reason":"..."}]}`,
        config: { temperature: 0.2 },
      });
      const text = response.text || '';
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        const calls = (parsed.calls || [])
          .filter((c: any) => c.agentId && c.question && peers.some((p) => p.agentId === c.agentId))
          .slice(0, MAX_PEER_CALLS);
        return { calls, note: 'planned via Gemini + pay.sh catalog' };
      }
    } catch (err: any) {
      console.warn('[a2a] planning LLM failed, heuristic fallback', err?.message);
    }
  }

  // Prefer peers with a different specialty than the caller
  const lower = userPrompt.toLowerCase();
  const calls: PeerPlan[] = [];
  const ranked = [...peers].sort((a, b) => {
    const aDiff = a.role === caller.role ? 1 : 0;
    const bDiff = b.role === caller.role ? 1 : 0;
    return aDiff - bDiff;
  });

  for (const p of ranked) {
    if (calls.length >= MAX_PEER_CALLS) break;
    const keys = [p.role, p.name, ...(p.tags || [])].map((k) => String(k).toLowerCase());
    const hit = keys.some((k) => k.length > 2 && lower.includes(k));
    const cross =
      caller.role !== p.role &&
      (lower.includes('다른') ||
        lower.includes('전문') ||
        lower.includes('물어') ||
        lower.includes('학술') ||
        lower.includes('academic') ||
        lower.includes('peer') ||
        lower.includes('agent') ||
        lower.includes('연구'));
    if (hit || cross) {
      calls.push({
        agentId: p.agentId,
        question: userPrompt,
        reason: hit ? 'keyword match on catalog' : 'cross-role A2A assist',
      });
    }
  }

  // Demo convenience: first *different-role* peer if still empty
  if (
    calls.length === 0 &&
    ranked.length > 0 &&
    userPrompt.trim().length > 12 &&
    !/^(hi|hello|hey|안녕|테스트)\b/i.test(userPrompt.trim())
  ) {
    const p = ranked.find((x) => x.role !== caller.role) || ranked[0];
    calls.push({
      agentId: p.agentId,
      question: `From peer agent ${caller.id}: please help with — ${userPrompt}`,
      reason: 'default A2A consult of catalog peer',
    });
  }

  return { calls, note: 'planned via heuristic + pay.sh catalog' };
}

/** Pay peer via pay.sh-style proof and run their RAG (no nested A2A). */
export async function paidPeerInvoke(
  caller: AgentRecord,
  targetId: string,
  question: string
): Promise<A2APeerHop> {
  const target = getAgent(targetId);
  const listing = getCatalogEntry(targetId);
  const toName = listing?.name || target?.agentName || targetId;

  if (!target) {
    return {
      fromAgentId: caller.id,
      toAgentId: targetId,
      toName,
      question,
      feeUsdc: 0,
      paymentProof: '',
      paymentVerified: false,
      error: 'Peer agent not found',
      catalogId: listing?.catalogId,
    };
  }

  if (!listing || listing.status !== 'listed') {
    return {
      fromAgentId: caller.id,
      toAgentId: targetId,
      toName,
      question,
      feeUsdc: agentFee(target),
      paymentProof: '',
      paymentVerified: false,
      error: 'Peer not listed on pay.sh catalog — cannot A2A share',
      catalogId: listing?.catalogId,
    };
  }

  const fee = listing.feeUsdc ?? agentFee(target);
  let paymentProof = '';
  let paymentVerified = true;
  const payLogs: string[] = [];

  if (fee > 0) {
    // On product/devnet path, auto A2A peer settlement needs a real USDC tx.
    // Without bypass, skip paid peers and report clearly (human→agent still uses pasted sig).
    if (config.paymentNetwork !== 'sandbox' && !config.allowPaymentBypass) {
      return {
        fromAgentId: caller.id,
        toAgentId: targetId,
        toName,
        question,
        feeUsdc: fee,
        paymentProof: '',
        paymentVerified: false,
        error:
          'Devnet/product mode: auto A2A peer USDC payment requires a real signature path. Switch to Sandbox for peer demos, or set ALLOW_PAYMENT_BYPASS for lab only.',
        catalogId: listing.catalogId,
      };
    }
    // A2A settlement proof (sandbox / local pay.sh). Live wallets = Solana workstream.
    paymentProof = `PAYSH_A2A_${caller.id.slice(0, 8)}_${target.id.slice(0, 8)}_${Date.now()}`;
    const audit = await verifyPayment(paymentProof, target.publicKey, fee);
    paymentVerified = audit.verified;
    payLogs.push(...audit.logs);
    if (!audit.verified) {
      return {
        fromAgentId: caller.id,
        toAgentId: targetId,
        toName,
        question,
        feeUsdc: fee,
        paymentProof,
        paymentVerified: false,
        error: audit.error || 'A2A payment verification failed',
        catalogId: listing.catalogId,
      };
    }
  } else {
    paymentProof = 'FREE_TIER';
    payLogs.push('[A2A] peer fee=0 — paywall skipped');
  }

  const rag = await generateGroundedAnswer({
    systemPrompt: target.systemPrompt,
    userPrompt: `[A2A paid query from agent ${caller.id}]\n${question}`,
    dataStoreId: target.vertexDataStoreId,
    geminiApiKey: config.geminiApiKey || undefined,
  });
  bumpInvoke(targetId);

  return {
    fromAgentId: caller.id,
    toAgentId: targetId,
    toName,
    question,
    feeUsdc: fee,
    paymentProof,
    paymentVerified,
    answer: rag.answer,
    catalogId: listing.catalogId,
  };
}

/** Full turn: plan peers → pay.sh paid calls → synthesize for human. */
export async function orchestrateA2ATurn(opts: {
  agent: AgentRecord;
  userPrompt: string;
  enablePeers?: boolean;
}): Promise<A2AOrchestrationResult> {
  const enablePeers = opts.enablePeers !== false;
  const peers = enablePeers ? catalogForPeers(opts.agent.id) : [];
  const peerHops: A2APeerHop[] = [];
  let planningNote: string | undefined;

  if (enablePeers && peers.length > 0) {
    const plan = await planPeerCalls(opts.agent, opts.userPrompt, peers);
    planningNote = plan.note;
    for (const call of plan.calls) {
      const hop = await paidPeerInvoke(opts.agent, call.agentId, call.question);
      peerHops.push(hop);
    }
  }

  const peerContext =
    peerHops.length > 0
      ? `\n\n[A2A PEER INTEL via pay.sh catalog — paid USDC calls]\n` +
        peerHops
          .map((h) => {
            if (h.error) {
              return `• ${h.toName} (${h.toAgentId}): ERROR ${h.error}`;
            }
            return `• ${h.toName} (${h.toAgentId}) fee=${h.feeUsdc} USDC proof=${h.paymentProof.slice(0, 28)}…\nQ: ${h.question}\nA: ${h.answer}`;
          })
          .join('\n---\n') +
        `\n[/A2A PEER INTEL]\n`
      : '';

  const a2aSystem = `${opts.agent.systemPrompt}

[A2A RUNTIME]
- You converse with a human user.
- When you needed specialty knowledge, you MAY have paid other agents listed on the pay.sh Solana catalog (x402 USDC).
- Use peer intel when present; cite which peer agent contributed.
- Never invent unpaid peer answers.
- Network: ${networkLabel()}
`;

  const rag = await generateGroundedAnswer({
    systemPrompt: a2aSystem,
    userPrompt: `${peerContext}\nHuman: ${opts.userPrompt}`,
    dataStoreId: opts.agent.vertexDataStoreId,
    geminiApiKey: config.geminiApiKey || undefined,
  });

  // Demo-friendly answer annotation when no Gemini
  let answer = rag.answer;
  if (peerHops.length > 0 && rag.mode === 'demo') {
    const ok = peerHops.filter((h) => !h.error);
    answer += `\n\n---\n[A2A] Consulted ${ok.length}/${peerHops.length} pay.sh-listed peer(s).`;
    for (const h of ok) {
      answer += `\n→ ${h.toName}: ${String(h.answer).slice(0, 280)}`;
    }
  }

  return {
    answer,
    confidence: rag.confidence,
    citations: rag.citations,
    ragMode: rag.mode,
    peerHops,
    catalogUsed: peers.length > 0,
    planningNote,
  };
}

/** Ensure demo has ≥2 catalog-listed agents for A2A. */
export function ensureDemoPeerAgents() {
  const agents = listAgents();
  // registration is done by caller after putAgent
  return agents.length;
}
