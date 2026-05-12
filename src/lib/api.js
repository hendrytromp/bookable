function buildQueryString(query = {}) {
  const params = new URLSearchParams();

  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  });

  const text = params.toString();
  return text ? `?${text}` : "";
}

export async function requestBackendMultipart(path, { method = "POST", query, formData } = {}) {
  const response = await fetch(`/api/statementpdf/${path}${buildQueryString(query)}`, {
    method,
    headers: {
      Accept: "application/json",
    },
    cache: "no-store",
    body: formData,
  });

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const errorMessage =
      typeof payload === "string"
        ? payload
        : payload?.error || payload?.detail || "Request failed.";
    throw new Error(errorMessage);
  }

  return payload;
}

export async function downloadBackendMultipart(path, { method = "POST", query, formData } = {}) {
  const response = await fetch(`/api/statementpdf/${path}${buildQueryString(query)}`, {
    method,
    headers: {
      Accept: "text/csv,application/octet-stream,*/*",
    },
    cache: "no-store",
    body: formData,
  });

  if (!response.ok) {
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json")
      ? await response.json()
      : await response.text();
    const errorMessage =
      typeof payload === "string"
        ? payload
        : payload?.error || payload?.detail || "Request failed.";
    throw new Error(errorMessage);
  }

  const contentDisposition = response.headers.get("content-disposition") || "";
  const filenameMatch = contentDisposition.match(/filename="?([^";]+)"?/i);

  return {
    blob: await response.blob(),
    filename: filenameMatch?.[1] || null,
  };
}