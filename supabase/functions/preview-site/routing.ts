export const PREVIEW_FUNCTION_NAME = "preview-site";

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".pdf": "application/pdf",
};

export function resolveAssetPath(pathname: string): string | null {
  const marker = `/${PREVIEW_FUNCTION_NAME}`;
  const markerIndex = pathname.indexOf(marker);
  if (markerIndex < 0) return null;

  let suffix = pathname.slice(markerIndex + marker.length);
  try {
    suffix = decodeURIComponent(suffix);
  } catch {
    return null;
  }

  suffix = suffix.replace(/^\/+/, "");
  if (!suffix) return "index.html";

  const segments = suffix.split("/");
  if (
    segments.some((segment) =>
      !segment || segment === "." || segment === ".." || segment.includes("\0")
    )
  ) {
    return null;
  }

  return segments.join("/");
}

export function contentTypeForPath(assetPath: string): string {
  const fileName = assetPath.split("/").at(-1) || "";
  const dotIndex = fileName.lastIndexOf(".");
  const extension = dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : "";
  return contentTypes[extension] || "application/octet-stream";
}

export function encodeStoragePath(assetPath: string): string {
  return assetPath.split("/").map(encodeURIComponent).join("/");
}
