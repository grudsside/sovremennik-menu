import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const outputDir = path.join(process.cwd(), 'artifacts', 'live-preview');
const bucket = 'checklist-photo-reports';

function required(name) {
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
assert.notEqual(previewRef, productionRef, 'Photo smoke test must never target production');

const service = createClient(supabaseUrl, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
function userClient() {
  return createClient(supabaseUrl, publicKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
async function signIn(login) {
  const client = userClient();
  const result = await client.auth.signInWithPassword({
    email: `${login}@sovremennik.local`,
    password,
  });
  if (result.error) throw result.error;
  assert(result.data.session?.access_token, `${login} session is missing`);
  const profile = await client.from('profiles').select('id,login,name,role,is_active').eq('id', result.data.user.id).single();
  if (profile.error) throw profile.error;
  return { client, session: result.data.session, profile: profile.data };
}

const admin = await signIn('preview-admin');
const manager = await signIn('preview-manager');
const barista = await signIn('preview-barista');
const waiter = await signIn('preview-waiter');
const checklistId = `photo-preview-${Date.now()}`;
const itemKey = `${checklistId}:0:0`;
const submissionId = randomUUID();
const photoId = randomUUID();
const fullPath = `${barista.profile.id}/${submissionId}/${itemKey.replace(/[^a-zA-Z0-9_-]+/g, '-')}/full-1-live.jpg`;
const thumbnailPath = `${barista.profile.id}/${submissionId}/${itemKey.replace(/[^a-zA-Z0-9_-]+/g, '-')}/thumb-1-live.jpg`;
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/AP/EABQQAQAAAAAAAAAAAAAAAAAAADD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAAAAAAAAAAADD/2gAIAQEABj8Cf//Z', 'base64');
const report = { checks: [], submissionId, checklistId };
function check(label) { report.checks.push(label); }

try {
  const configured = await admin.client.rpc('replace_checklist_photo_rules', {
    p_checklist_id: checklistId,
    p_rules: [{
      item_key: itemKey,
      item_text: 'Сфотографировать чистую кофемашину',
      required_count: 1,
      hint: 'В кадре должны быть видны группа и поддон',
    }],
  });
  if (configured.error) throw configured.error;
  assert.equal(configured.data.length, 1);
  check('administrator configured one required photo rule');

  for (const actor of [manager, barista, waiter]) {
    const rejected = await actor.client.rpc('replace_checklist_photo_rules', {
      p_checklist_id: checklistId,
      p_rules: [],
    });
    assert(rejected.error, `${actor.profile.role} must not edit photo rules`);
  }
  check('non-administrators cannot edit photo requirements');

  const items = [{
    itemKey,
    text: 'Сфотографировать чистую кофемашину',
    checkedByUser: true,
    checked: true,
  }];
  const inserted = await barista.client.from('checklist_submissions').insert({
    id: submissionId,
    checklist_id: checklistId,
    checklist_title: 'Live preview photo checklist',
    employee_id: barista.profile.id,
    employee_name: barista.profile.name,
    items,
    completed_count: 1,
    total_count: 1,
    percent: 100,
    version: 2,
  }).select('*').single();
  if (inserted.error) throw inserted.error;
  assert.equal(inserted.data.completed_count, 0, 'Required photo item must start incomplete');
  assert.equal(inserted.data.photo_required_count, 1);
  assert.equal(inserted.data.photo_upload_status, 'pending');
  check('server rejects checkbox-only completion before photo upload');

  const fullUpload = await barista.client.storage.from(bucket).upload(fullPath, jpeg, {
    contentType: 'image/jpeg', cacheControl: '60', upsert: false,
  });
  if (fullUpload.error) throw fullUpload.error;
  const thumbUpload = await barista.client.storage.from(bucket).upload(thumbnailPath, jpeg, {
    contentType: 'image/jpeg', cacheControl: '60', upsert: false,
  });
  if (thumbUpload.error) throw thumbUpload.error;
  check('barista uploaded full and thumbnail files to private owner path');

  const metadata = await barista.client.from('checklist_submission_photos').insert({
    id: photoId,
    submission_id: submissionId,
    checklist_id: checklistId,
    item_key: itemKey,
    item_text: 'Сфотографировать чистую кофемашину',
    photo_index: 1,
    storage_path: fullPath,
    thumbnail_path: thumbnailPath,
    mime_type: 'image/jpeg',
    file_size: jpeg.length,
    thumbnail_size: jpeg.length,
    created_by: barista.profile.id,
  }).select('*').single();
  if (metadata.error) throw metadata.error;
  assert.equal(metadata.data.created_by, barista.profile.id);
  assert.match(metadata.data.expires_at, /^\d{4}-\d{2}-\d{2}T/);
  check('photo metadata received immutable owner and 90-day expiry');

  const finalized = await barista.client.rpc('finalize_checklist_photo_submission', {
    p_submission_id: submissionId,
    p_items: items,
  });
  if (finalized.error) throw finalized.error;
  const finalRow = finalized.data[0];
  assert.equal(finalRow.completed_count, 1);
  assert.equal(finalRow.percent, 100);
  assert.equal(finalRow.photo_count, 1);
  assert.equal(finalRow.photo_upload_status, 'complete');
  assert.equal(finalRow.items[0].checked, true);
  check('checkbox plus stored photo finalized the item at 100 percent');

  const ownerView = await barista.client.from('checklist_submission_photos').select('id').eq('id', photoId).single();
  if (ownerView.error) throw ownerView.error;
  const managerView = await manager.client.from('checklist_submission_photos').select('id,thumbnail_path').eq('id', photoId).single();
  if (managerView.error) throw managerView.error;
  const waiterView = await waiter.client.from('checklist_submission_photos').select('id').eq('id', photoId);
  if (waiterView.error) throw waiterView.error;
  assert.equal(waiterView.data.length, 0, 'Unrelated waiter must not see checklist photos');
  const signed = await manager.client.storage.from(bucket).createSignedUrl(managerView.data.thumbnail_path, 60);
  if (signed.error) throw signed.error;
  assert.match(signed.data.signedUrl, /token=/);
  check('owner and control role can read private metadata and signed thumbnail; unrelated user cannot');

  const nonAdminRetain = await manager.client.rpc('set_checklist_photo_retained', {
    p_photo_id: photoId,
    p_retained: true,
  });
  assert(nonAdminRetain.error, 'Manager must not retain a photo indefinitely');
  const retained = await admin.client.rpc('set_checklist_photo_retained', {
    p_photo_id: photoId,
    p_retained: true,
  });
  if (retained.error) throw retained.error;
  assert.equal(retained.data[0].retained, true);
  const unretained = await admin.client.rpc('set_checklist_photo_retained', {
    p_photo_id: photoId,
    p_retained: false,
  });
  if (unretained.error) throw unretained.error;
  assert.equal(unretained.data[0].retained, false);
  check('only administrator can switch indefinite retention');

  const expired = await service.from('checklist_submission_photos').update({
    expires_at: '2000-01-01T00:00:00Z',
  }).eq('id', photoId);
  if (expired.error) throw expired.error;
  const cleanupResponse = await fetch(`${supabaseUrl}/functions/v1/checklist-photo-retention`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${admin.session.access_token}`,
    },
    body: JSON.stringify({ action: 'cleanup', limit: 10, dry_run: false }),
  });
  const cleanup = await cleanupResponse.json().catch(() => ({}));
  assert.equal(cleanupResponse.status, 200, cleanup.error || 'Retention function failed');
  assert.equal(cleanup.ok, true);
  assert(cleanup.photoIds.includes(photoId));
  const deletedMetadata = await service.from('checklist_submission_photos').select('deleted_at,deleted_reason').eq('id', photoId).single();
  if (deletedMetadata.error) throw deletedMetadata.error;
  assert(deletedMetadata.data.deleted_at);
  assert.equal(deletedMetadata.data.deleted_reason, 'retention_90_days');
  const deletedFull = await service.storage.from(bucket).download(fullPath);
  assert(deletedFull.error, 'Expired full photo must be removed from Storage');
  const expiredSubmission = await service.from('checklist_submissions').select('photo_upload_status').eq('id', submissionId).single();
  if (expiredSubmission.error) throw expiredSubmission.error;
  assert.equal(expiredSubmission.data.photo_upload_status, 'expired');
  check('retention function removed expired objects and preserved deleted metadata marker');

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, 'checklist-photo-smoke.json'), JSON.stringify({
    ok: true,
    projectRef: previewRef,
    ...report,
    generatedAt: new Date().toISOString(),
  }, null, 2));
  console.log('Live checklist photo-report smoke test passed.');
} finally {
  await service.storage.from(bucket).remove([fullPath, thumbnailPath]).catch(() => undefined);
  await service.from('checklist_submissions').delete().eq('id', submissionId);
  await service.from('checklist_photo_rules').delete().eq('checklist_id', checklistId);
  await Promise.all([admin, manager, barista, waiter].map(actor => actor.client.auth.signOut().catch(() => undefined)));
}
