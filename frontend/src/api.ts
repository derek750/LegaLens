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

export async function getDocumentUrl(path: string) {
  const res = await apiFetch(`/documents/url?path=${encodeURIComponent(path)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Failed to get document URL");
  return data as { url: string };
}
