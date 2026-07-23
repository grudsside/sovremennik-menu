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
const barista = await signIn('preview-barista');
const waiter = await signIn('preview-waiter');
const firstId = randomUUID();
const secondId = randomUUID();
const photoId = randomUUID();
const photoPath = `${barista.profile.id}/${firstId}/${photoId}.jpg`;
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/AP/EABQQAQAAAAAAAAAAAAAAAAAAADD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAAAAAAAAAAADD/2gAIAQEABj8Cf//Z', 'base64');
const report = { checks:[], firstId, secondId };
const check = label => report.checks.push(label);

try{
  const created = await barista.client.rpc('create_shift_handoff', {
    p_id:firstId,
    p_unfinished:['Не разобрана поставка'],
    p_out_of_stock:['Овсяное молоко'],
    p_equipment_issues:['Правый гриндер выдаёт ошибку'],
    p_next_shift_control:['Проверить поставку сиропов'],
    p_notes:'Live preview',
  });
  if(created.error) throw created.error;
  assert.equal(created.data.length, 1);
  assert.equal(created.data[0].created_by, barista.profile.id);
  assert.equal(created.data[0].created_by_name, barista.profile.name);
  assert.deepEqual(created.data[0].out_of_stock, ['Овсяное молоко']);
  check('active barista created a structured handoff with authoritative identity');

  const waiterView = await waiter.client.from('shift_handoffs').select('*').eq('id', firstId).single();
  if(waiterView.error) throw waiterView.error;
  assert.equal(waiterView.data.created_by_role, 'barista');
  check('next-shift employee can read the handoff');

  const authorAck = await barista.client.rpc('acknowledge_shift_handoff', { p_handoff_id:firstId });
  assert(authorAck.error, 'Handoff author must not acknowledge their own message');
  const accepted = await waiter.client.rpc('acknowledge_shift_handoff', { p_handoff_id:firstId });
  if(accepted.error) throw accepted.error;
  assert.equal(accepted.data[0].employee_id, waiter.profile.id);
  assert.equal(accepted.data[0].employee_name, waiter.profile.name);
  const acceptedAgain = await waiter.client.rpc('acknowledge_shift_handoff', { p_handoff_id:firstId });
  if(acceptedAgain.error) throw acceptedAgain.error;
  assert.equal(acceptedAgain.data.length, 1);
  const ackCount = await service.from('shift_handoff_acknowledgements').select('*', { count:'exact', head:true }).eq('handoff_id', firstId).eq('employee_id', waiter.profile.id);
  if(ackCount.error) throw ackCount.error;
  assert.equal(ackCount.count, 1);
  check('personal acknowledgement stores server-side name/time and is idempotent');

  const upload = await barista.client.storage.from(bucket).upload(photoPath, jpeg, {
    contentType:'image/jpeg', cacheControl:'60', upsert:false,
  });
  if(upload.error) throw upload.error;
  const metadata = await barista.client.from('shift_handoff_photos').insert({
    id:photoId,
    handoff_id:firstId,
    storage_path:photoPath,
    mime_type:'image/jpeg',
    file_size:jpeg.length,
    created_by:barista.profile.id,
  }).select('*').single();
  if(metadata.error) throw metadata.error;
  assert.equal(metadata.data.created_by, barista.profile.id);
  const waiterPhoto = await waiter.client.from('shift_handoff_photos').select('id,storage_path').eq('id', photoId).single();
  if(waiterPhoto.error) throw waiterPhoto.error;
  const signed = await waiter.client.storage.from(bucket).createSignedUrl(waiterPhoto.data.storage_path, 60);
  if(signed.error) throw signed.error;
  assert.match(signed.data.signedUrl, /token=/);
  check('private photo is uploaded by author and readable through a signed URL by next shift');

  const forbiddenMetadata = await waiter.client.from('shift_handoff_photos').insert({
    handoff_id:firstId,
    storage_path:`${waiter.profile.id}/${firstId}/${randomUUID()}.jpg`,
    mime_type:'image/jpeg', file_size:jpeg.length, created_by:waiter.profile.id,
  });
  assert(forbiddenMetadata.error, 'Non-author must not attach photo metadata');
  check('non-author cannot attach photos to another employee handoff');

  const second = await admin.client.rpc('create_shift_handoff', {
    p_id:secondId,
    p_unfinished:[],
    p_out_of_stock:['Сироп ваниль'],
    p_equipment_issues:[],
    p_next_shift_control:['Проверить остатки'],
    p_notes:'',
  });
  if(second.error) throw second.error;
  const superseded = await service.from('shift_handoffs').select('visible_until').eq('id', firstId).single();
  if(superseded.error) throw superseded.error;
  assert(new Date(superseded.data.visible_until).getTime() <= Date.now() + 2000);
  check('new handoff supersedes the previous active message without deleting history');

  const adminAckView = await admin.client.from('shift_handoff_acknowledgements').select('employee_name,acknowledged_at').eq('handoff_id', firstId).single();
  if(adminAckView.error) throw adminAckView.error;
  assert.equal(adminAckView.data.employee_name, waiter.profile.name);
  check('administrator can review acknowledgement history');

  await fs.mkdir(outputDir, { recursive:true });
  await fs.writeFile(path.join(outputDir, 'shift-handoff-smoke.json'), JSON.stringify({
    ok:true,
    projectRef:previewRef,
    ...report,
    generatedAt:new Date().toISOString(),
  }, null, 2));
  console.log('Live shift handoff smoke test passed.');
} finally {
  await service.storage.from(bucket).remove([photoPath]).catch(() => undefined);
  await service.from('shift_handoffs').delete().in('id', [firstId, secondId]);
  await Promise.all([admin, barista, waiter].map(actor => actor.client.auth.signOut().catch(() => undefined)));
}
