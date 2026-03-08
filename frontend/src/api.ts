const raw = (typeof import.meta !== "undefined" && (import.meta as { env?: Record<string, string> }).env?.VITE_API_URL) || "";
const API_BASE = raw ? (raw.replace(/\/+$/, "").endsWith("/api") ? raw.replace(/\/+$/, "") : raw.replace(/\/+$/, "") + "/api") : "/api";

let _getAccessToken: (() => Promise<string>) | null = null;

/**
 * Called once from a React component to wire up the Auth0
 * getAccessTokenSilently function so api helpers can attach JWTs.
 */
export function setTokenGetter(fn: () => Promise<string>) {
  _getAccessToken = fn;
}

export async function apiFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  if (_getAccessToken) {
    try {
      const token = await _getAccessToken();
      headers["Authorization"] = `Bearer ${token}`;
    } catch (err) {
      console.error("Failed to get access token:", err);
    }
  }

  return fetch(`${API_BASE}${path}`, { ...options, headers });
}

export async function uploadDocument(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await apiFetch("/documents/upload", {
    method: "POST",
    body: formData,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Upload failed");
  return data;
}

export async function listDocuments() {
  const res = await apiFetch("/documents/");
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Failed to fetch documents");
  return data;
}

export type DocumentStats = {
  total_scanned: number;
  clauses_flagged: number;
  clean_documents: number;
};

export async function getDocumentStats(): Promise<DocumentStats> {
  const res = await apiFetch("/documents/stats");
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Failed to fetch document stats");
  return data as DocumentStats;
}

export async function getDocumentUrl(path: string) {
  const res = await apiFetch(`/documents/url?path=${encodeURIComponent(path)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Failed to get document URL");
  return data as { url: string };
}

export type AnalysisProgress = {
  event: "progress";
  agent: string;
  message: string;
};

export type AnalysisRejected = {
  event: "rejected";
  reason: string;
  document_category?: string;
  suggestion?: string;
};

export type AnalyzedClause = {
  id: string;
  type: string;
  raw_text: string;
  location: string;
  severity: "LOW" | "HIGH";
  severity_reason?: string;
  plain_english?: string;
  canadian_law?: string;
  baseline_comparison?: string;
  negotiation_tip?: string;
  line_start?: number;
  line_end?: number;
  char_start?: number;
  char_end?: number;
  page_start?: number;
  page_end?: number;
};

export type AnalysisResult = {
  session_id: string;
  thread_id: string;
  document_name: string;
  document_type: string;
  overall_risk_score: string;
  executive_summary: string;
  top_risks: string[];
  bottom_line: string;
  analyzed_clauses: AnalyzedClause[];
  clause_count: number;
};

export type AnalysisComplete = {
  event: "complete";
  result: AnalysisResult;
};

export type AnalysisError = {
  event: "error";
  message: string;
};

export type AnalysisStreamEvent =
  | AnalysisProgress
  | AnalysisRejected
  | AnalysisComplete
  | AnalysisError;

/**
 * Run the full pipeline (extract → analyze → summarize) for a stored document.
 * Consumes SSE stream; onEvent is called for each event. Resolves with result on complete.
 */
export async function analyzeStoredDocument(
  path: string,
  onEvent: (ev: AnalysisStreamEvent) => void
): Promise<AnalysisResult> {
  const token = _getAccessToken ? await _getAccessToken() : null;
  const res = await fetch(`${API_BASE}/documents/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || "Failed to start analysis");
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");
  const decoder = new TextDecoder();
  let buffer = "";
  let result: AnalysisResult | null = null;
  let rejected: AnalysisRejected | null = null;
  let streamError: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const data = JSON.parse(line.slice(6)) as AnalysisStreamEvent;
          onEvent(data);
          if (data.event === "complete") {
            result = data.result;
          } else if (data.event === "rejected") {
            rejected = data;
          } else if (data.event === "error") {
            streamError = data.message;
          }
        } catch (_) {}
      }
    }
  }
  if (streamError) throw new Error(streamError);
  if (rejected) throw new Error(rejected.reason || "Document was rejected");
  if (!result) throw new Error("Analysis did not complete");
  return result;
}

export type NegotiatedClause = {
  id: string;
  type: string;
  severity: "HIGH";
  original_text: string;
  rewritten_clause: string;
  negotiation_script: string;
  priority: "MUST FIGHT" | "SHOULD PUSH BACK" | "ACCEPT IF NEEDED";
  leverage: string;
  fallback_position: string;
};

export type NegotiationResult = {
  session_id: string;
  document_name: string;
  must_fight: NegotiatedClause[];
  should_push: NegotiatedClause[];
  accept_if_needed: NegotiatedClause[];
  total: number;
};

export async function negotiateDocument(
  sessionId: string
): Promise<NegotiationResult> {
  const res = await apiFetch(`/agents/negotiate/${sessionId}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Negotiation failed");
  return data as NegotiationResult;
}

export type EditedTextResult = {
  session_id: string;
  document_name: string;
  edited_text: string;
  replacements: number;
};

export async function getEditedText(
  sessionId: string
): Promise<EditedTextResult> {
  const res = await apiFetch(`/agents/edited-text/${sessionId}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Failed to get edited text");
  return data as EditedTextResult;
}

type VoiceSessionResponse = {
  agent_id: string;
  webrtc_token: string;
  connection_type: string;
};

const voiceApiKey = () => {
  const key =
    (typeof import.meta !== "undefined" && (import.meta as { env?: Record<string, string> }).env?.VITE_VOICE_AGENT_API_KEY) ||
    "";
  // Match backend default so dev works without frontend env
  return key || "dev-voice-agent-key";
};

export async function createVoiceSession(): Promise<VoiceSessionResponse> {
  const res = await apiFetch("/voice/session", {
    method: "POST",
    headers: {
      "X-API-Key": voiceApiKey(),
    },
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail || "Failed to create voice session");
  }

  return data as VoiceSessionResponse;
}

export async function createBackboardThread(name: string): Promise<{ thread_id: string }> {
  const res = await apiFetch("/voice/backboard/thread", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": voiceApiKey(),
    },
    body: JSON.stringify({ name }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail || "Failed to create Backboard thread");
  }

  return data as { thread_id: string };
}

export async function voiceThink(params: {
  thread_id: string;
  user_utterance: string;
  session_id?: string | null;
}): Promise<{ answer: string }> {
  const res = await apiFetch("/voice/think", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": voiceApiKey(),
    },
    body: JSON.stringify({
      thread_id: params.thread_id,
      user_utterance: params.user_utterance,
      session_id: params.session_id ?? null,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail || "Voice think failed");
  }

  return data as { answer: string };
}

export async function textToSpeech(text: string): Promise<Blob> {
  const res = await apiFetch("/voice/tts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": voiceApiKey(),
    },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || "TTS failed");
  }
  return res.blob();
}

export async function addContextDocumentToVoiceThread(params: {
  thread_id: string;
  bucket_path: string;
}): Promise<{ document_name: string; document_type: string; clause_count: number }> {
  const res = await apiFetch("/voice/context/document", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": voiceApiKey(),
    },
    body: JSON.stringify({
      thread_id: params.thread_id,
      bucket_path: params.bucket_path,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail || "Failed to add document context to voice thread");
  }

  return data as { document_name: string; document_type: string; clause_count: number };
}
