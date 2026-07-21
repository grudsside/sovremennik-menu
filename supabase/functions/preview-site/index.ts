// Supabase Edge Function: preview-site
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  contentTypeForPath,
  encodeStoragePath,
  resolveAssetPath,
} from "./routing.ts";

const bucketId = "open-test-preview";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "range, content-type",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
};

function errorResponse(message: string, status: number) {
  return new Response(message, {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    return errorResponse("Method not allowed", 405);
  }

  const requestUrl = new URL(req.url);
  const assetPath = resolveAssetPath(requestUrl.pathname);
  if (!assetPath) return errorResponse("Invalid preview path", 400);

  const supabaseUrl = (Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, "");
  if (!supabaseUrl) return errorResponse("Preview configuration error", 500);

  const deploymentId = Deno.env.get("DENO_DEPLOYMENT_ID") || "preview";
  const sourceUrl =
    `${supabaseUrl}/storage/v1/object/public/${bucketId}/${
      encodeStoragePath(assetPath)
    }` +
    `?deployment=${encodeURIComponent(deploymentId)}`;

  const sourceHeaders = new Headers();
  const range = req.headers.get("Range");
  if (range) sourceHeaders.set("Range", range);

  let sourceResponse: Response;
  try {
    sourceResponse = await fetch(sourceUrl, {
      method: req.method,
      headers: sourceHeaders,
      cache: "no-store",
    });
  } catch {
    return errorResponse("Preview asset unavailable", 502);
  }

  if (!sourceResponse.ok && sourceResponse.status !== 206) {
    return errorResponse(
      sourceResponse.status === 404
        ? "Preview asset not found"
        : "Preview asset unavailable",
      sourceResponse.status === 404 ? 404 : 502,
    );
  }

  const headers = new Headers({
    ...corsHeaders,
    "Content-Type": contentTypeForPath(assetPath),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
  });

  for (
    const headerName of [
      "Accept-Ranges",
      "Content-Length",
      "Content-Range",
      "ETag",
      "Last-Modified",
    ]
  ) {
    const value = sourceResponse.headers.get(headerName);
    if (value) headers.set(headerName, value);
  }

  return new Response(req.method === "HEAD" ? null : sourceResponse.body, {
    status: sourceResponse.status,
    headers,
  });
});
