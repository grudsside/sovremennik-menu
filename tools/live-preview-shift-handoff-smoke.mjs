import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const outputDir = path.join(process.cwd(), 'artifacts', 'live-preview');
const bucket = 'shift-handoff-photos';

function required(name){
  const value = String(process.env[name] || '').trim();
  assert(value, `Missing required environment variable: ${name}`);
  return value;
}

const supabaseUrl = required('PREVIEW_SUPABASE_URL').replace(/\/+$/, '');
const publicKey = required('PREVIEW_PUBLIC_KEY');
const secretKey = required('PREVIEW_SECRET_KEY');
const password = required('PREVIEW_TEST_PASSWORD');
const previewRef = required('PREVIEW_PROJECT_REF');
const productionRef = String(process.env.PRODUCTION_SUPABASE_PROJECT_REF || '').trim();
assert.equal(new URL(supabaseUrl).hostname, `${previewRef}.supabase.co`);
assert.notEqual(previewRef, productionRef, 'Shift handoff smoke test must never target production');

const service = createClient(supabaseUrl, secretKey, { auth:{ autoRefreshToken:false, persistSession:false } });
function userClient(){
  return createClient(supabaseUrl, publicKey, { auth:{ autoRefreshToken:false, persistSession:false } });
}
async function signIn(login){
  const client = userClient();
  const result = await client.auth.signInWithPassword({ email:`${login}@sovremennik.local`, password });
  if(result.error) throw result.error;
  const profile = await client.from('profiles').select('id,login,name,role,is_active').eq('id', result.data.user.id).single();
  if(profile.error) throw profile.error;
  return { client, profile:profile.data };
}

const admin = await signIn('preview-admin');
const author = await signIn('preview-barista');
const waiter = await signIn('preview-waiter');
const firstId = randomUUID();
const secondId = randomUUID();
const deniedId = randomUUID();
const photoId = randomUUID();
const photoPath = `${author.profile.id}/${firstId}/${photoId}.jpg`;
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/AP/EABQQAQAAAAAAAAAAAAAAAAAAADD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAAAAAAAAAAADD/2gAIAQEABj8Cf//Z', 'base64');
const report = { checks:[], firstId, secondId };
const check = label => report.checks.push(label);

try{
  const created = await author.client.rpc('create_shift_handoff', {
    p_id:firstId,
    p_unfinished:['Не разобрана поставка'],
    p_out_of_stock:['Овсяное молоко'],
    p_equipment_issues:['Правый гриндер выдаёт ошибку'],
    p_next_shift_control:['Проверить поставку сиропов'],
    p_notes:'Live preview',
  });
  if(created.error) throw created.error;
  assert.equal(created.data[0].created_by_role, 'barista');
  assert.equal(new Date(created.data[0].visible_until).getUTCFullYear(), 9999);
  check('barista created a handoff that remains active until the next closing checklist');

  const adminView = await admin.client.from('shift_handoffs').select('*').eq('id', firstId).single();
  if(adminView.error) throw adminView.error;
  assert.equal(adminView.data.id, firstId);
  check('administrator can read the current handoff');

  const waiterView = await waiter.client.from('shift_handoffs').select('id').eq('id', firstId);
  if(waiterView.error) throw waiterView.error;
  assert.equal(waiterView.data.length, 0);
  const waiterCreate = await waiter.client.rpc('create_shift_handoff', {
    p_id:deniedId, p_unfinished:['Нет доступа'], p_out_of_stock:[], p_equipment_issues:[], p_next_shift_control:[], p_notes:'',
  });
  assert(waiterCreate.error, 'Waiter must not create shift handoff');
  check('waiter cannot read or create shift handoffs');

  const authorAck = await author.client.rpc('acknowledge_shift_handoff', { p_handoff_id:firstId });
  assert(authorAck.error, 'Handoff author must not acknowledge their own message');
  const accepted = await admin.client.rpc('acknowledge_shift_handoff', { p_handoff_id:firstId });
  if(accepted.error) throw accepted.error;
  assert.equal(accepted.data[0].employee_id, admin.profile.id);
  assert.equal(accepted.data[0].employee_name, admin.profile.name);
  const acceptedAgain = await admin.client.rpc('acknowledge_shift_handoff', { p_handoff_id:firstId });
  if(acceptedAgain.error) throw acceptedAgain.error;
  assert.equal(acceptedAgain.data.length, 1);
  check('administrator acknowledgement stores server identity and remains idempotent');

  const upload = await author.client.storage.from(bucket).upload(photoPath, jpeg, { contentType:'image/jpeg', cacheControl:'60', upsert:false });
  if(upload.error) throw upload.error;
  const metadata = await author.client.from('shift_handoff_photos').insert({
    id:photoId, handoff_id:firstId, storage_path:photoPath,
    mime_type:'image/jpeg', file_size:jpeg.length, created_by:author.profile.id,
  }).select('*').single();
  if(metadata.error) throw metadata.error;
  const adminPhoto = await admin.client.from('shift_handoff_photos').select('id,storage_path').eq('id', photoId).single();
  if(adminPhoto.error) throw adminPhoto.error;
  const signed = await admin.client.storage.from(bucket).createSignedUrl(adminPhoto.data.storage_path, 60);
  if(signed.error) throw signed.error;
  assert.match(signed.data.signedUrl, /token=/);
  check('administrator can view a private handoff photo');

  const replacement = await admin.client.rpc('create_shift_handoff', {
    p_id:secondId,
    p_unfinished:[],
    p_out_of_stock:[],
    p_equipment_issues:[],
    p_next_shift_control:[],
    p_notes:'Замечаний нет',
  });
  if(replacement.error) throw replacement.error;
  assert.equal(replacement.data[0].created_by_role, 'admin');
  assert.equal(new Date(replacement.data[0].visible_until).getUTCFullYear(), 9999);
  const superseded = await service.from('shift_handoffs').select('visible_until').eq('id', firstId).single();
  if(superseded.error) throw superseded.error;
  assert(new Date(superseded.data.visible_until).getTime() <= Date.now() + 2000);
  check('administrator can submit the next closing handoff and replace the previous one');

  const waiterAck = await waiter.client.rpc('acknowledge_shift_handoff', { p_handoff_id:secondId });
  assert(waiterAck.error, 'Waiter must not acknowledge shift handoff');
  check('waiter remains excluded from acknowledgement');

  await fs.mkdir(outputDir, { recursive:true });
  await fs.writeFile(path.join(outputDir, 'shift-handoff-smoke.json'), JSON.stringify({
    ok:true, projectRef:previewRef, ...report, generatedAt:new Date().toISOString(),
  }, null, 2));
  console.log('Live shift handoff admin access and replacement lifecycle smoke test passed.');
} finally {
  await service.storage.from(bucket).remove([photoPath]).catch(() => undefined);
  await service.from('shift_handoffs').delete().in('id', [firstId, secondId, deniedId]);
  await Promise.all([admin, author, waiter].map(actor => actor.client.auth.signOut().catch(() => undefined)));
}
