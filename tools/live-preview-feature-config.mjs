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
const version = '20260722-3';
const configSource = `window.SOVREMENNIK_SUPABASE = ${JSON.stringify({
  url: supabaseUrl,
  anonKey: publicKey,
  employeeFunctionUrl: `${functionBase}/admin-employees`,
  maintenanceFunctionUrl: `${functionBase}/admin-maintenance`,
  photoRetentionFunctionUrl: `${functionBase}/checklist-photo-retention`,
  notifyFunctionUrl: '',
  pushSendFunctionUrl: '',
  deadlineFunctionUrl: '',
  vapidPublicKey: '',
  loginDomain: 'sovremennik.local',
  preview: true,
}, null, 2)};

(function loadCoffeeRevisionTools(){
  const version = '${version}';

  function appendStyle(id, path){
    if(document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = \`\${path}?v=\${version}\`;
    document.head.appendChild(link);
  }

  appendStyle('coffee-revision-editor-css', 'assets/css/coffee-revision-editor.css');
  appendStyle('coffee-revision-report-summary-css', 'assets/css/coffee-revision-report-summary.css');

  function appendScript(id, path){
    return new Promise((resolve, reject) => {
      if(document.getElementById(id)) return resolve();
      const script = document.createElement('script');
      script.id = id;
      script.src = \`\${path}?v=\${version}\`;
      script.async = false;
      script.onload = resolve;
      script.onerror = () => reject(new Error(\`Не удалось загрузить \${path}\`));
      document.body.appendChild(script);
    });
  }

  const loadScripts = async () => {
    try {
      await appendScript('coffee-revision-formula-core-js', 'assets/js/coffee-revision-formula-core.js');
      await appendScript('coffee-revision-formula-fix-js', 'assets/js/coffee-revision-formula-fix.js');
      await appendScript('coffee-revision-editor-js', 'assets/js/coffee-revision-editor.js');
      await appendScript('coffee-revision-summary-core-js', 'assets/js/coffee-revision-summary-core.js');
      await appendScript('coffee-revision-integrity-fix-js', 'assets/js/coffee-revision-integrity-fix.js');
      await appendScript('coffee-revision-summary-labels-js', 'assets/js/coffee-revision-summary-labels.js');
    } catch(error){
      console.error('Coffee revision tools failed to load', error);
    }
  };

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadScripts, { once:true });
  else loadScripts();
})();
`;

assert.match(configSource, new RegExp(previewProjectRef), 'Generated config must target preview.');
if (productionProjectRef) assert.doesNotMatch(configSource, new RegExp(productionProjectRef), 'Generated config must not mention production.');
assert.match(configSource, /checklist-photo-retention/, 'Generated config must load checklist photo retention endpoint.');
assert.match(configSource, /coffee-revision-editor\.css/, 'Generated config must load the correction styles.');
assert.match(configSource, /coffee-revision-report-summary\.css/, 'Generated config must load report summary styles.');
assert.match(configSource, /coffee-revision-formula-core\.js/, 'Generated config must load the formula core.');
assert.match(configSource, /coffee-revision-formula-fix\.js/, 'Generated config must load the formula integration.');
assert.match(configSource, /coffee-revision-editor\.js/, 'Generated config must load the correction editor.');
assert.match(configSource, /coffee-revision-summary-core\.js/, 'Generated config must load the revision summary core.');
assert.match(configSource, /coffee-revision-integrity-fix\.js/, 'Generated config must load duplicate protection.');
assert.match(configSource, /coffee-revision-summary-labels\.js/, 'Generated config must load report-date labels.');

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
assert.match(published, /checklist-photo-retention/, 'Published config must expose checklist photo retention endpoint.');
assert.match(published, /coffee-revision-editor\.css/, 'Published config must load the correction styles.');
assert.match(published, /coffee-revision-report-summary\.css/, 'Published config must load report summary styles.');
assert.match(published, /coffee-revision-formula-core\.js/, 'Published config must load the formula core.');
assert.match(published, /coffee-revision-formula-fix\.js/, 'Published config must load the formula integration.');
assert.match(published, /coffee-revision-editor\.js/, 'Published config must load the revision editor.');
assert.match(published, /coffee-revision-summary-core\.js/, 'Published config must load the summary core.');
assert.match(published, /coffee-revision-integrity-fix\.js/, 'Published config must load duplicate protection.');
assert.match(published, /coffee-revision-summary-labels\.js/, 'Published config must load report-date labels.');
if (productionProjectRef) assert.doesNotMatch(published, new RegExp(productionProjectRef), 'Published config must not target production.');

await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(path.join(outputDir, 'feature-config.json'), JSON.stringify({
  ok: true,
  projectRef: previewProjectRef,
  configPath,
  editorVersion: version,
  checklistPhotoReports: true,
  generatedAt: new Date().toISOString(),
}, null, 2));

console.log('Preview configuration with coffee revision and checklist photo-report tools published.');
