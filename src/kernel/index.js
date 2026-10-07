/* SiReader kernel plugin: server-side network access for non-Electron clients. */
(function () {
  const pick = (value, lower, upper) => value && value[lower] !== undefined ? value[lower] : value?.[upper];
  const requestMeta = (request) => pick(request, "request", "Request") || {};
  const requestPath = (request) => {
    const context = pick(request, "context", "Context") || {};
    const url = pick(request, "url", "URL") || {};
    const raw = pick(context, "path", "Path") || pick(url, "path", "Path") || "/";
    return decodeURIComponent(String(raw).replace(/^\/plugin\/private\/[^/]+/, "") || "/");
  };
  const query = (request, key) => {
    const url = pick(request, "url", "URL") || {};
    const raw = pick(url, "rawQuery", "RawQuery") || pick(url, "search", "Search") || "";
    return new URLSearchParams(String(raw).replace(/^\?/, "")).get(key) || "";
  };
  const jsonResponse = (data, statusCode = 200) => ({
    statusCode,
    headers: { "Content-Type": ["application/json; charset=utf-8"] },
    body: { data: { type: "JSON", data } },
  });
  const proxyResponse = (url, headers = {}, method = "GET") => ({
    statusCode: 200,
    headers: {},
    body: { proxy: { url, method, headers } },
  });
  const parseBody = async (request) => {
    const body = pick(requestMeta(request), "body", "Body");
    if (!body) return {};
    const data = pick(body, "data", "Data");
    if (data && typeof data.json === "function") return data.json().catch(() => ({}));
    if (typeof data === "string") {
      try { return JSON.parse(data); } catch (_) { return {}; }
    }
    if (data && typeof data === "object") return data;
    const stringBody = pick(body, "string", "String");
    if (stringBody && Array.isArray(stringBody.values)) {
      try { return JSON.parse(stringBody.values.join("")); } catch (_) { return {}; }
    }
    return {};
  };
  const validUrl = (value) => {
    try {
      const url = new URL(String(value || ""));
      return url.protocol === "http:" || url.protocol === "https:";
    } catch (_) { return false; }
  };
  const forward = async (payload) => {
    const target = String(payload.url || "");
    if (!validUrl(target)) throw new Error("Only http(s) URLs are allowed");
    const method = String(payload.method || "GET").toUpperCase();
    if (!["GET", "HEAD", "POST", "PUT"].includes(method)) throw new Error("Unsupported method");
    let requestPayload = payload.payload === undefined ? "" : payload.payload;
    if (String(payload.contentType || "").toLowerCase().includes("application/json") && typeof requestPayload === "string") {
      try { requestPayload = JSON.parse(requestPayload); } catch (_) {}
    }
    const response = await siyuan.client.fetch("/api/network/forwardProxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: target,
        method,
        timeout: Math.min(Math.max(Number(payload.timeout || 15000), 1000), 60000),
        contentType: payload.contentType || "text/plain",
        headers: (Array.isArray(payload.headers) ? payload.headers : []).map((header) => {
          if (!header || typeof header !== "object") return header;
          if (header.name) return { [header.name]: String(header.value ?? "") };
          return header;
        }),
        payload: requestPayload,
        payloadEncoding: payload.payload === undefined ? "text" : "json",
      }),
    });
    const contentType = response.headers && (response.headers["Content-Type"] || response.headers["content-type"] || "");
    const value = String(contentType).includes("application/json") ? await response.json() : await response.text();
    return value?.code === undefined ? value : (value.code === 0 ? value.data : value);
  };
  const route = async (request) => {
    const path = requestPath(request);
    const method = String(pick(requestMeta(request), "method", "Method") || "GET").toUpperCase();
    if (path === "/api/network/download" && method === "GET") {
      const target = query(request, "url");
      let headers = {};
      try { headers = JSON.parse(query(request, "headers") || "{}"); } catch (_) {}
      if (!validUrl(target)) return jsonResponse({ code: -1, msg: "Invalid URL" }, 400);
      return proxyResponse(target, headers, "GET");
    }
    if (path === "/api/network/forwardProxy" && method === "POST") {
      try { return jsonResponse({ code: 0, data: await forward(await parseBody(request)) }); }
      catch (error) { return jsonResponse({ code: -1, msg: String(error?.message || error) }, 500); }
    }
    return jsonResponse({ code: -1, msg: "Not found" }, 404);
  };
  siyuan.plugin.lifecycle.onload = async () => {};
  siyuan.plugin.lifecycle.onunload = async () => {};
  siyuan.server.private.http.handler = route;
})();
