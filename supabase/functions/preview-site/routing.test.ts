import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  contentTypeForPath,
  encodeStoragePath,
  resolveAssetPath,
} from "./routing.ts";

Deno.test("preview root resolves to index", () => {
  assertEquals(resolveAssetPath("/functions/v1/preview-site"), "index.html");
  assertEquals(resolveAssetPath("/functions/v1/preview-site/"), "index.html");
});

Deno.test("nested preview assets resolve safely", () => {
  assertEquals(
    resolveAssetPath("/functions/v1/preview-site/assets/js/app.js"),
    "assets/js/app.js",
  );
  assertEquals(
    resolveAssetPath("/functions/v1/preview-site/data/menu%20photo.json"),
    "data/menu photo.json",
  );
});

Deno.test("unsafe or malformed paths are rejected", () => {
  assertEquals(resolveAssetPath("/functions/v1/another-function/index.html"), null);
  assertEquals(resolveAssetPath("/functions/v1/preview-site/../index.html"), null);
  assertEquals(resolveAssetPath("/functions/v1/preview-site/%2e%2e/index.html"), null);
  assertEquals(resolveAssetPath("/functions/v1/preview-site/assets//app.js"), null);
  assertEquals(resolveAssetPath("/functions/v1/preview-site/%E0%A4%A"), null);
});

Deno.test("preview assets receive browser-safe MIME types", () => {
  assertEquals(contentTypeForPath("index.html"), "text/html; charset=utf-8");
  assertEquals(
    contentTypeForPath("assets/js/app.js"),
    "text/javascript; charset=utf-8",
  );
  assertEquals(contentTypeForPath("assets/icons/icon.png"), "image/png");
  assertEquals(contentTypeForPath("unknown.bin"), "application/octet-stream");
});

Deno.test("storage paths encode each segment without changing directories", () => {
  assertEquals(
    encodeStoragePath("data/menu photo.json"),
    "data/menu%20photo.json",
  );
});
