/**
 * Vertex AI Search (Discovery Engine) retrieve + Gemini grounded answer.
 */

import { GoogleAuth } from 'google-auth-library';
import { GoogleGenAI } from '@google/genai';

export type RagCitation = { title?: string; uri?: string; snippet?: string };

export type RagResult = {
  answer: string;
  confidence: number;
  citations: RagCitation[];
  mode: 'vertex_search' | 'gemini_only' | 'demo';
};

function projectId(): string | undefined {
  return process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
}

function dataStorePath(dataStoreId?: string): string | null {
  const project = projectId();
  const location = process.env.VERTEX_SEARCH_LOCATION || 'global';
  const collection = process.env.VERTEX_SEARCH_COLLECTION || 'default_collection';
  const store =
    dataStoreId ||
    process.env.VERTEX_DATA_STORE_ID ||
    process.env.DISCOVERY_ENGINE_DATA_STORE_ID;
  if (!project || !store) return null;
  return `projects/${project}/locations/${location}/collections/${collection}/dataStores/${store}`;
}

async function accessToken(): Promise<string | null> {
  try {
    const auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    return token.token || null;
  } catch {
    return null;
  }
}

/** Search / retrieve snippets from Vertex AI Search */
export async function retrieveFromVertexSearch(
  query: string,
  dataStoreId?: string
): Promise<{ snippets: string[]; citations: RagCitation[]; ok: boolean; error?: string }> {
  const storePath = dataStorePath(dataStoreId);
  if (!storePath) {
    return {
      snippets: [],
      citations: [],
      ok: false,
      error: 'VERTEX_DATA_STORE_ID / GOOGLE_CLOUD_PROJECT not configured',
    };
  }

  const token = await accessToken();
  if (!token) {
    return { snippets: [], citations: [], ok: false, error: 'ADC / access token unavailable' };
  }

  const location = process.env.VERTEX_SEARCH_LOCATION || 'global';
  const host =
    location === 'global'
      ? 'https://discoveryengine.googleapis.com'
      : `https://${location}-discoveryengine.googleapis.com`;

  const servingConfig = `${storePath}/servingConfigs/default_search`;
  const url = `${host}/v1/${servingConfig}:search`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        pageSize: 5,
        contentSearchSpec: {
          snippetSpec: { returnSnippet: true },
          extractiveContentSpec: { maxExtractiveAnswerCount: 2 },
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return {
        snippets: [],
        citations: [],
        ok: false,
        error: `Discovery Engine ${res.status}: ${text.slice(0, 400)}`,
      };
    }

    const json: any = await res.json();
    const citations: RagCitation[] = [];
    const snippets: string[] = [];

    for (const r of json.results || []) {
      const doc = r.document || {};
      const derived = doc.derivedStructData || doc.structData || {};
      const title = derived.title || doc.name;
      const link = derived.link || derived.uri;
      const snips = (derived.snippets || [])
        .map((s: any) => s.snippet)
        .filter(Boolean);
      const extractive = (derived.extractive_answers || derived.extractiveAnswers || [])
        .map((e: any) => e.content)
        .filter(Boolean);
      const piece = [...snips, ...extractive].join('\n');
      if (piece) snippets.push(piece);
      citations.push({ title, uri: link, snippet: piece?.slice(0, 240) });
    }

    return { snippets, citations, ok: true };
  } catch (err: any) {
    return { snippets: [], citations: [], ok: false, error: err.message };
  }
}

/** Ensure a Drive-backed data store id is recorded (provision stub / real API). */
export async function ensureDriveDataStore(opts: {
  displayName: string;
  driveFolderId: string;
}): Promise<{ dataStoreId: string; status: 'created' | 'existing' | 'pending'; message?: string }> {
  const configured = process.env.VERTEX_DATA_STORE_ID;
  if (configured) {
    return {
      dataStoreId: configured,
      status: 'existing',
      message: `Using configured data store; bind Drive folder ${opts.driveFolderId} in console if needed`,
    };
  }

  // Real create requires Discovery Engine admin APIs + Workspace connector setup.
  // We mint a deterministic id and mark pending for the provisioner / ops runbook.
  const safe = opts.displayName.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40);
  const dataStoreId = `solvamos-${safe || 'drive'}-${opts.driveFolderId.slice(0, 8)}`;
  return {
    dataStoreId,
    status: 'pending',
    message:
      'Data store id reserved. Complete Drive connector binding via Terraform/console (Domain-wide Delegation or OAuth).',
  };
}

export async function generateGroundedAnswer(opts: {
  systemPrompt: string;
  userPrompt: string;
  dataStoreId?: string;
  geminiApiKey?: string;
}): Promise<RagResult> {
  const retrieval = await retrieveFromVertexSearch(opts.userPrompt, opts.dataStoreId);
  const contextBlock =
    retrieval.snippets.length > 0
      ? `\n\n[GROUNDED CONTEXT FROM VERTEX AI SEARCH / CUSTOMER DRIVE]\n${retrieval.snippets.join('\n---\n')}\n`
      : '\n\n[GROUNDED CONTEXT] None retrieved. Prefer saying insufficient_grounded_data if security is strict.\n';

  if (!opts.geminiApiKey) {
    return {
      answer: `[DEMO] Payment OK. RAG mode=${retrieval.ok ? 'vertex_search' : 'unavailable'}.\nQuery: ${opts.userPrompt}\n${contextBlock}`,
      confidence: retrieval.ok ? 0.7 : 0.4,
      citations: retrieval.citations,
      mode: 'demo',
    };
  }

  const ai = new GoogleGenAI({ apiKey: opts.geminiApiKey });
  const response = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
    contents: `${contextBlock}\n\nUser query: ${opts.userPrompt}`,
    config: {
      systemInstruction: opts.systemPrompt,
      temperature: 0.4,
    },
  });

  return {
    answer: response.text || 'No response text generated',
    confidence: retrieval.ok && retrieval.snippets.length ? 0.92 : 0.65,
    citations: retrieval.citations,
    mode: retrieval.ok ? 'vertex_search' : 'gemini_only',
  };
}
