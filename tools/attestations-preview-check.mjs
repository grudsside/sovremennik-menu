import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Core = require('../assets/js/attestations-core.js');

const menu = {
  techCards: [{
    id:'bar', title:'Напитки бара', cards:[
      {title:'Капучино', category:'Кофе', output:'250 мл', technology:'Приготовить эспрессо и влить молоко', ingredients:['Кофе 18 г','Молоко 180 г']},
      {title:'Латте', category:'Кофе', output:'300 мл', technology:'Приготовить эспрессо и влить молоко', ingredients:['Кофе 18 г','Молоко 240 г']},
      {title:'Американо', category:'Кофе', output:'250 мл', technology:'Эспрессо и вода', ingredients:['Кофе 18 г','Вода 200 г']},
      {title:'Эспрессо', category:'Кофе', output:'36 г', technology:'Пролив', ingredients:['Кофе 18 г']},
      {title:'Лимонад Крем-Сода', category:'Лимонады', output:'300 мл', technology:'Смешать напиток', ingredients:['Кордиал 50 г','Содовая 200 г']},
      {title:'Сироп ванильный', category:'Заготовки', output:'1000 мл', technology:'Сварить', ingredients:['Сахар','Вода','Ваниль']}
    ]
  }],
  lessons: [
    {id:'coffee-basics', title:'Теория про кофе', category:'Кофе', blocks:[{type:'cards', title:'Виды зерна', cards:[
      {title:'Арабика', text:'Более сложная кислотность и ароматический профиль.'},
      {title:'Робуста', text:'Больше кофеина и выраженная горечь.'},
      {title:'Обжарка', text:'Степень обжарки влияет на вкус зерна.'}
    ]}]},
    {id:'espresso-setup', title:'Настройка эспрессо', category:'Эспрессо', blocks:[{type:'table', title:'Диагностика', headers:['Ситуация','Действие'], rows:[
      ['Пролив быстрый','Сделать помол мельче'],
      ['Пролив медленный','Сделать помол крупнее'],
      ['Выход малый','Проверить дозировку']
    ]}]},
    {id:'milk-work', title:'Работа с молоком', category:'Молоко', blocks:[{type:'steps', title:'Последовательность', items:[
      'Налить холодное молоко в питчер',
      'Создать микропену',
      'Очистить паровик'
    ]}]}
  ]
};

const registry = Core.buildSourceRegistry(menu);
assert.equal(Array.from(registry.values()).filter(item => item.type === 'techcard').length, 5, 'Заготовка должна быть исключена, а напиток Крем-Сода — сохранён');
assert.ok(Array.from(registry.values()).some(item => item.title === 'Лимонад Крем-Сода'));
assert.equal(Core.lessonTopic(menu.lessons[0]), 'coffee');
assert.equal(Core.lessonTopic(menu.lessons[1]), 'espresso');
assert.equal(Core.lessonTopic(menu.lessons[2]), 'milk');
assert.equal(Core.lessonTopic({title:'Все что нужно знать о кофе', category:'Теория', blocks:[{title:'Молоко в кофейных напитках'}]}), 'coffee', 'Название текущего материала должно иметь приоритет над отдельными упоминаниями молока');

const built = Core.generateQuestionBank(menu, () => 0.31);
assert.ok(built.questions.some(q => q.topic === 'techcards'));
assert.ok(built.questions.some(q => q.topic === 'coffee'));
assert.ok(built.questions.some(q => q.topic === 'espresso'));
assert.ok(built.questions.some(q => q.topic === 'milk'));
assert.ok(built.questions.every(q => built.registry.has(`${q.sourceType}:${q.sourceKey}`)), 'У каждого вопроса должен быть актуальный источник');

const merged = Core.mergeQuestionBank(built.questions, [], built.registry);
const selected = Core.autoAssemble(merged, {techcards:2, coffee:1, espresso:1, milk:1}, () => 0.4);
assert.equal(selected.length, 5);
assert.deepEqual(selected.reduce((acc,q)=>{acc[q.topic]=(acc[q.topic]||0)+1;return acc;},{}), {techcards:2,coffee:1,espresso:1,milk:1});
assert.throws(() => Core.autoAssemble(merged, {milk:999}), error => error.code === 'BANK_SHORTAGE');

const snapshots = [
  {id:'q1',type:'single',correctAnswer:'A'},
  {id:'q2',type:'multiple',correctAnswer:['A','B']},
  {id:'q3',type:'number',correctAnswer:18,tolerance:0.5}
];
const grade = Core.gradeAnswers(snapshots, {q1:'A',q2:['B','A'],q3:'18,4'});
assert.equal(grade.correctCount, 3);
assert.equal(grade.scorePercent, 100);

const source = Array.from(registry.values()).find(item => item.topic === 'coffee');
const stale = Core.normalizeStoredQuestion({
  id:'manual', topic:'coffee', source_type:'lesson', source_key:source.key, source_title:source.title,
  source_version:'old-version', question_type:'single', prompt:'Проверка', options:['1','2','3'], correct_answer:'1', is_active:true
});
assert.equal(Core.questionValidity(stale, registry).valid, false, 'Изменённый источник должен блокировать вопрос');

console.log('Attestations preview core checks passed.');
