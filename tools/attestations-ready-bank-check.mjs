import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Core = require('../assets/js/attestations-core.js');
const ReadyBank = require('../assets/js/attestations-ready-bank.js');

const html = await fs.readFile('index.html', 'utf8');
const match = html.match(/<script id="menu-data" type="application\/json">([\s\S]*?)<\/script>/i);
assert(match?.[1], 'В index.html не найдены актуальные данные приложения.');
const menu = JSON.parse(match[1]);

assert.equal(ReadyBank.QUESTIONS_PER_TOPIC, 20);
assert.equal(Core.__readyQuestionBankInstalled, true, 'Готовый банк должен заменять случайную генерацию.');

const first = Core.generateQuestionBank(menu);
const second = Core.generateQuestionBank(menu);
const expectedTopics = Object.keys(Core.TOPICS);
const counts = ReadyBank.topicCounts(first.questions);

assert.equal(first.questions.length, 80, 'Базовый банк должен содержать ровно 80 вопросов.');
expectedTopics.forEach(topic => {
  assert.equal(counts[topic], 20, `В теме ${topic} должно быть ровно 20 вопросов.`);
});

assert.equal(new Set(first.questions.map(question => question.id)).size, 80, 'Идентификаторы вопросов должны быть уникальными.');
assert.equal(new Set(first.questions.map(question => question.fingerprint)).size, 80, 'В банке не должно быть дубликатов.');
assert.deepEqual(
  first.questions.map(question => ({ fingerprint:question.fingerprint, options:question.options })),
  second.questions.map(question => ({ fingerprint:question.fingerprint, options:question.options })),
  'Готовый банк должен быть стабильным между открытиями приложения.'
);

first.questions.forEach(question => {
  assert(question.prompt, 'У каждого вопроса должен быть текст.');
  assert(question.sourceKey && question.sourceVersion, 'Каждый вопрос должен быть связан с актуальным источником.');
  assert.equal(Core.questionValidity(question, first.registry).valid, true, `Вопрос ${question.id} потерял актуальный источник.`);
  if(question.type === 'single' || question.type === 'multiple'){
    assert(question.options.length >= 3, `У вопроса ${question.id} недостаточно вариантов ответа.`);
  }
});

const source = first.registry.values().next().value;
assert(source, 'Не найден источник для проверки ручного вопроса.');
const manualRow = {
  id:'manual-bank-check',
  topic:source.topic,
  source_type:source.type,
  source_key:source.key,
  source_title:source.title,
  source_version:source.version,
  question_type:'single',
  prompt:'Тестовый ручной вопрос',
  options:['Верно','Неверно','Не указано'],
  correct_answer:'Верно',
  tolerance:0,
  explanation:'Проверка сохранения ручного функционала.',
  is_active:true,
  fingerprint:'manual-bank-check-fingerprint'
};
const merged = Core.mergeQuestionBank(first.questions, [manualRow], first.registry);
assert.equal(merged.length, 81, 'Ручной вопрос должен добавляться поверх готовых 80 вопросов.');
assert(merged.some(question => question.id === manualRow.id && question.origin === 'manual' && question.validity.valid), 'Ручное добавление вопросов должно остаться доступным.');

const assembled = Core.autoAssemble(first.questions, {
  techcards:20,
  coffee:20,
  espresso:20,
  milk:20
}, () => 0.42);
assert.equal(assembled.length, 80, 'Автоматическая сборка должна уметь использовать весь готовый банк.');

console.log('Готовый банк аттестаций проверен: по 20 вопросов в каждой теме, ручное добавление сохранено.');
