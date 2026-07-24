import fs from 'node:fs';
import assert from 'node:assert/strict';

const js = fs.readFileSync('assets/js/checklist-review-tools.js', 'utf8');
const css = fs.readFileSync('assets/css/checklist-review-tools.css', 'utf8');
const observerGuard = fs.readFileSync('assets/js/checklist-review-observer-guard.js', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260724210000_checklist_review_tools_preview.sql', 'utf8');
const loader = fs.readFileSync('assets/js/push.js', 'utf8');
const worker = fs.readFileSync('service-worker.js', 'utf8');

for (const marker of [
  'data-checklist-review-viewer',
  'data-viewer-previous',
  'data-viewer-next',
  'data-viewer-zoom-in',
  'data-viewer-zoom-out',
  "event.key === 'ArrowLeft'",
  "event.key === 'ArrowRight'",
  'pointerDistance()',
  'data-checklist-comment-form',
  "rpc('create_checklist_submission_comment'",
  "rpc('delete_checklist_submission'",
  'data-checklist-department="barista"',
  'data-checklist-department="waiter"'
]) assert.ok(js.includes(marker), `Missing JS marker: ${marker}`);

for (const marker of [
  '.checklist-review-viewer-stage{',
  'touch-action:none',
  '.checklist-review-filter{',
  '.checklist-review-form{',
  '.checklist-review-delete{'
]) assert.ok(css.includes(marker), `Missing CSS marker: ${marker}`);

for (const marker of [
  'create table if not exists public.checklist_submission_comments',
  'create or replace function public.create_checklist_submission_comment',
  'insert into public.tasks',
  'create or replace function public.delete_checklist_submission',
  'public.is_admin_or_manager()',
  'public.is_admin()',
  'deleted_at timestamptz'
]) assert.ok(migration.includes(marker), `Missing migration marker: ${marker}`);

assert.ok(observerGuard.includes("closest?.('#control-records')"), 'Observer guard must ignore internal Control mutations');
assert.ok(loader.includes('assets/css/checklist-review-tools.css'), 'Review CSS is not loaded');
assert.ok(loader.includes('assets/js/checklist-review-observer-guard.js'), 'Observer guard is not loaded');
assert.ok(loader.includes('assets/js/checklist-review-tools.js'), 'Review JS is not loaded');
assert.ok(worker.includes('./assets/css/checklist-review-tools.css'), 'Review CSS is not cached');
assert.ok(worker.includes('./assets/js/checklist-review-observer-guard.js'), 'Observer guard is not cached');
assert.ok(worker.includes('./assets/js/checklist-review-tools.js'), 'Review JS is not cached');

console.log('Checklist review tools structure is valid.');
