import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const outputDir = path.join(process.cwd(), 'artifacts', 'live-preview');
const bucketId = 'open-test-preview';
const configPath = 'assets/js/supabase-config.js';

function required(name) {
  const value = String(process.env[name] || '').trim();
  assert(value, `Missing required environment variable: ${name}`);
  return value;
}

const supabaseUrl = required('PREVIEW_SUPABASE_URL').replace(/\/+$/, '');
const publicKey = required('PREVIEW_PUBLIC_KEY');
const secretKey = required('PREVIEW_SECRET_KEY');
const previewProjectRef = required('PREVIEW_PROJECT_REF');
const productionProjectRef = String(process.env.PRODUCTION_SUPABASE_PROJECT_REF || '').trim();

assert(!productionProjectRef || previewProjectRef !== productionProjectRef, 'Preview feature config must not target production.');
assert.equal(new URL(supabaseUrl).hostname, `${previewProjectRef}.supabase.co`, 'Preview URL must match the dedicated project.');

const functionBase = `${supabaseUrl}/functions/v1`;
const version = '20260721-1';
const configSource = `window.SOVREMENNIK_SUPABASE = ${JSON.stringify({
  url: supabaseUrl,
  anonKey: publicKey,
  employeeFunctionUrl: `${functionBase}/admin-employees`,
  maintenanceFunctionUrl: `${functionBase}/admin-maintenance`,
  notifyFunctionUrl: '',
  pushSendFunctionUrl: '',
  deadlineFunctionUrl: '',
  vapidPublicKey: '',
  loginDomain: 'sovremennik.local',
  preview: true,
}, null, 2)};

(function loadCoffeeRevisionEditor(){
  const version = '${version}';
  const cssId = 'coffee-revision-editor-css';
  const scriptId = 'coffee-revision-editor-js';

  if(!document.getElementById(cssId)){
    const link = document.createElement('link');
    link.id = cssId;
    link.rel = 'stylesheet';
    link.href = \`assets/css/coffee-revision-editor.css?v=\${version}\`;
    document.head.appendChild(link);
  }

  const loadScript = () => {
    if(document.getElementById(scriptId)) return;
    const script = document.createElement('script');
    script.id = scriptId;
    script.src = \`assets/js/coffee-revision-editor.js?v=\${version}\`;
    script.defer = true;
    document.body.appendChild(script);
  };

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadScript, { once:true });
  else loadScript();
})();
`;

assert.match(configSource, new RegExp(previewProjectRef), 'Generated config must target preview.');
if (productionProjectRef) assert.doesNotMatch(configSource, new RegExp(productionProjectRef), 'Generated config must not mention production.');
assert.match(configSource, /coffee-revision-editor\.js/, 'Generated config must load the correction editor.');

const service = createClient(supabaseUrl, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const upload = await service.storage.from(bucketId).upload(configPath, Buffer.from(configSource, 'utf8'), {
  contentType: 'text/javascript; charset=utf-8',
  cacheControl: '60',
  upsert: true,
});
if (upload.error) throw upload.error;

const publicUrl = `${supabaseUrl}/storage/v1/object/public/${bucketId}/${configPath}`;
const response = await fetch(`${publicUrl}?v=${Date.now()}`, { cache: 'no-store' });
assert.equal(response.status, 200, 'Published preview config must be readable.');
const published = await response.text();
assert.match(published, new RegExp(previewProjectRef), 'Published config must target preview.');
assert.match(published, /coffee-revision-editor\.js/, 'Published config must load the revision editor.');
if (productionProjectRef) assert.doesNotMatch(published, new RegExp(productionProjectRef), 'Published config must not target production.');

await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(path.join(outputDir, 'feature-config.json'), JSON.stringify({
  ok: true,
  projectRef: previewProjectRef,
  configPath,
  editorVersion: version,
  generatedAt: new Date().toISOString(),
}, null, 2));

console.log('Preview configuration with coffee revision editor published.');
