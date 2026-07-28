import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Core = require('../assets/js/attestations-core.js');
const ManagementCore = require('../assets/js/attestations-question-management-core.js');

assert.equal(ManagementCore.install(), false, 'Question management core should install only once.');
assert.equal(Core.__questionManagementInstalled, true);

const registry = new Map([
  ['lesson:coffee', {type:'lesson', key:'coffee', title:'Теория кофе', topic:'coffee', version:'source-v1'}]
]);
const generated = [{
  id:'generated-fp-1', origin:'generated', topic:'coffee', sourceType:'lesson', sourceKey:'coffee',
  sourceTitle:'Теория кофе', sourceVersion:'source-v1', type:'single', prompt:'Исходный вопрос?',
  options:['A','B','C'], correctAnswer:'A', tolerance:0, explanation:'', active:true, fingerprint:'fp-1'
}];

const overrideRows = [{
  id:'00000000-0000-4000-8000-000000000001', topic:'coffee', source_type:'lesson', source_key:'coffee',
  source_title:'Теория кофе', source_version:'source-v1', question_type:'single', prompt:'Отредактированный вопрос?',
  options:['A','B','C'], correct_answer:'B', tolerance:0, explanation:'Изменено администратором',
  fingerprint:'fp-1', is_active:true, deleted_at:null
}];
const overridden = Core.mergeQuestionBank(generated, overrideRows, registry);
assert.equal(overridden.length, 1);
assert.equal(overridden[0].prompt, 'Отредактированный вопрос?');
assert.equal(overridden[0].correctAnswer, 'B');
assert.equal(overridden[0].origin, 'override');
assert.equal(overridden[0].storedId, overrideRows[0].id);
assert.equal(overridden[0].validity.valid, true);

const deleted = Core.mergeQuestionBank(generated, [{...overrideRows[0], deleted_at:'2026-07-28T20:00:00Z'}], registry);
assert.equal(deleted.length, 0, 'Deleted override must suppress the generated question instead of revealing it again.');
assert.throws(() => Core.autoAssemble(deleted, {coffee:1}), error => error.code === 'BANK_SHORTAGE');

const manualRows = [{...overrideRows[0], id:'00000000-0000-4000-8000-000000000002', fingerprint:'manual-fp', prompt:'Ручной вопрос?'}];
const withManual = Core.mergeQuestionBank(generated, manualRows, registry);
assert.equal(withManual.length, 2);
assert.equal(withManual.find(question => question.fingerprint === 'manual-fp')?.origin, 'manual');

const ui = await fs.readFile('assets/js/attestations-question-management.js', 'utf8');
for(const marker of [
  'data-att-qm-edit',
  'data-att-qm-delete',
  'Сохранить изменения',
  "role() === 'admin'",
  "deleted_at: new Date().toISOString()",
  "from('attestation_questions').update",
  "from('attestation_questions').insert"
]) assert(ui.includes(marker), `Question management UI marker is missing: ${marker}`);

const guard = await fs.readFile('assets/js/attestations-question-management-guard.js', 'utf8');
for(const marker of [
  "role() !== 'admin'",
  'attestations-question-management.js?v=20260728-auth-2',
  "event.target?.id === 'login-form'",
  'setInterval(reloadAfterLogin, 1500)'
]) assert(guard.includes(marker), `Question management login guard marker is missing: ${marker}`);

const buttons = await fs.readFile('assets/js/attestations-question-management-buttons.js', 'utf8');
for(const marker of [
  'filteredBank()',
  'data-att-qm-edit',
  'data-att-qm-delete',
  'card.dataset.attQmFingerprint',
  'SovAttestationsQuestionManagementButtons'
]) assert(buttons.includes(marker), `Question button binding marker is missing: ${marker}`);

const push = await fs.readFile('assets/js/push.js', 'utf8');
assert(push.includes('attestations-question-management-core.js?v=20260728-1'));
assert(push.includes('attestations-question-management.js?v=20260728-1'));
assert(push.includes('attestations-question-management-guard.js?v=20260728-1'));
assert(push.includes('attestations-question-management-buttons.js?v=20260728-1'));
assert(push.includes('attestations-question-management.css?v=20260728-1'));

const worker = await fs.readFile('service-worker.js', 'utf8');
for(const asset of [
  'assets/js/attestations-question-management-core.js',
  'assets/js/attestations-question-management.js',
  'assets/js/attestations-question-management-guard.js',
  'assets/js/attestations-question-management-buttons.js',
  'assets/css/attestations-question-management.css'
]) assert(worker.includes(asset), `PWA cache is missing ${asset}`);

const migration = await fs.readFile('supabase/migrations/20260728223000_attestation_question_management.sql', 'utf8');
for(const marker of [
  'add column if not exists deleted_at',
  'add column if not exists deleted_by',
  'attestation_questions_admin_update',
  'attestation_questions_admin_delete',
  'public.is_admin()'
]) assert(migration.includes(marker), `Question management migration marker is missing: ${marker}`);

console.log('Attestation question editing, deletion, reliable card binding, permissions and PWA integration checks passed.');