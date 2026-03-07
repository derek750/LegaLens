const API_BASE = "/api";

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

/** Upload a PDF/DOCX to the agents pipeline; returns session_id for analysis. */
export async function uploadToAgents(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await apiFetch("/agents/upload", {
    method: "POST",
    body: formData,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || data.message || "Upload failed");
  return data;
}

/**
 * Run the analysis pipeline for an uploaded document (SSE stream).
 * Resolves with the full result when the pipeline completes.
 */
export function runAnalysisStream(sessionId: string): Promise<{
  session_id: string;
  document_name: string;
  document_type: string;
  overall_risk_score: string | null;
  executive_summary: string | null;
  top_risks: string[] | null;
  bottom_line: string | null;
  analyzed_clauses: Array<Record<string, unknown>>;
  errors: string[];
}> {
  return new Promise((resolve, reject) => {
    const url = `${API_BASE}/agents/analyze/${sessionId}`;
    const tokenPromise = _getAccessToken ? _getAccessToken() : Promise.resolve(null);

    tokenPromise.then((token) => {
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;

      fetch(url, { headers })
        .then((res) => {
          if (!res.ok) {
            res.json().then((d) => reject(new Error(d.detail || "Analysis failed"))).catch(() => reject(new Error("Analysis failed")));
            return;
          }
          const reader = res.body?.getReader();
          if (!reader) {
            reject(new Error("No response body"));
            return;
          }
          const decoder = new TextDecoder();
          let buffer = "";

          function processChunk(): Promise<void> {
            return reader.read().then(({ done, value }) => {
              if (done) {
                reject(new Error("Stream ended without complete event"));
                return;
              }
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() ?? "";
              for (const line of lines) {
                if (line.startsWith("data: ")) {
                  try {
                    const payload = JSON.parse(line.slice(6)) as { event?: string; result?: unknown; message?: string };
                    if (payload.event === "complete" && payload.result) {
                      resolve(payload.result as Parameters<typeof resolve>[0]);
                      return;
                    }
                    if (payload.event === "error") {
                      reject(new Error(payload.message || "Analysis error"));
                      return;
                    }
                  } catch {
                    // ignore non-JSON lines
                  }
                }
              }
              return processChunk();
            });
          }
          processChunk().catch(reject);
        })
        .catch(reject);
    }).catch(reject);
  });
}
