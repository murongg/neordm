import { invoke } from "@tauri-apps/api/core";

interface ProxyHeader {
  name: string;
  value: string;
}

interface ProxyHttpResponse {
  status: number;
  statusText: string;
  headers: ProxyHeader[];
  body: string;
}

async function readRequestBody(request: Request) {
  if (request.method === "GET" || request.method === "HEAD") {
    return null;
  }

  const bodyText = await request.text();
  return bodyText.length > 0 ? bodyText : null;
}

function normalizeHeaders(headers: Headers) {
  const normalizedHeaders: ProxyHeader[] = [];

  headers.forEach((value, name) => {
    normalizedHeaders.push({ name, value });
  });

  return normalizedHeaders;
}

function toRequest(input: URL | RequestInfo, init?: RequestInit) {
  return new Request(input, init);
}

export async function tauriProxyFetch(
  input: URL | RequestInfo,
  init?: RequestInit
) {
  const request = toRequest(input, init);
  const response = await invoke<ProxyHttpResponse>("proxy_http_request", {
    input: {
      url: request.url,
      method: request.method,
      headers: normalizeHeaders(request.headers),
      body: await readRequestBody(request),
    },
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers.map(
      (header): [string, string] => [header.name, header.value]
    ),
  });
}
