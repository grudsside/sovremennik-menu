(function(root, factory){
  const api = factory();
  if(typeof module === 'object' && module.exports) module.exports = api;
  if(root) root.SovAttestationsCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  'use strict';

  const TOPICS = Object.freeze({
    techcards: 'Технологические карты напитков',
    coffee: 'Теория про кофе',
    espresso: 'Настройка эспрессо',
    milk: 'Работа с молоком'
  });

  const PREP_RE = /(заготов|полуфабрикат|сироп|соус|пюре|кордиал|раствор|смесь|база|топпинг|варенье|джем|крем|сиропы|заготовки)/i;
  const DRINK_RE = /(напит|кофе|чай|лимонад|какао|раф|латте|капучино|эспрессо|американо|флэт|матча|бамбл|смузи|коктейл|фреш|милкшейк|тоник)/i;

  function text(value){ return String(value == null ? '' : value).trim(); }
  function norm(value){ return text(value).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' '); }
  function safeArray(value){ return Array.isArray(value) ? value : []; }
  function stableHash(value){
    const source = typeof value === 'string' ? value : JSON.stringify(value);
    let hash = 2166136261;
    for(let i = 0; i < source.length; i += 1){
      hash ^= source.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }
  function shuffle(input, random = Math.random){
    const rows = safeArray(input).slice();
    for(let i = rows.length - 1; i > 0; i -= 1){
      const j = Math.floor(random() * (i + 1));
      [rows[i], rows[j]] = [rows[j], rows[i]];
    }
    return rows;
  }
  function uniq(values){
    const seen = new Set();
    return safeArray(values).filter(value => {
      const key = norm(value);
      if(!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function techCardKey(card, doc){
    return text(card && card.__cardKey) || [text(doc && (doc.id || doc.title || doc.sourceFile)), text(card && card.category), text(card && card.title)].join('::');
  }

  function lessonKey(lesson){
    return text(lesson && lesson.id) || ['lesson', text(lesson && lesson.category), text(lesson && lesson.title)].join('::');
  }

  function isDrinkTechCard(card, doc){
    const title = [doc && doc.title, doc && doc.description, card && card.category, card && card.title].map(text).join(' ');
    if(!text(card && card.title)) return false;
    if(PREP_RE.test(title)) return false;
    const ingredients = safeArray(card && card.ingredients);
    const hasDrinkSignal = DRINK_RE.test(title) || Boolean(text(card && card.output)) || Boolean(text(card && card.technology));
    return hasDrinkSignal && ingredients.length > 0;
  }

  function lessonTopic(lesson){
    const heading = norm([lesson && lesson.title, lesson && lesson.category].join(' '));
    if(/эспрессо|настройк.*эспрессо/.test(heading)) return 'espresso';
    if(/молок|латте[- ]?арт|взбив/.test(heading)) return 'milk';
    if(/кофе|зерн|обжарк|арабик|робуст/.test(heading)) return 'coffee';

    const payload = norm([
      heading,
      lesson && lesson.summary,
      ...safeArray(lesson && lesson.blocks).flatMap(block => [block && block.title, block && block.text, block && block.caption])
    ].join(' '));
    if(/эспрессо|экстракц|пролив|помол|дозиров|выход напитка|таблетк|темпер/.test(payload)) return 'espresso';
    if(/молок|латте[- ]?арт|питчер|микропен|взбив|текстур/.test(payload)) return 'milk';
    if(/кофе|зерн|обжарк|арабик|робуст|обработк|дескриптор|каппинг/.test(payload)) return 'coffee';
    return '';
  }

  function flattenLessonFacts(lesson){
    const facts = [];
    safeArray(lesson && lesson.blocks).forEach((block, blockIndex) => {
      const type = text(block && block.type);
      if(type === 'cards'){
        safeArray(block.cards).forEach((card, itemIndex) => {
          if(text(card && card.title) && text(card && card.text)){
            facts.push({
              id: `card-${blockIndex}-${itemIndex}`,
              kind: 'pair',
              label: text(card.title),
              value: text(card.text),
              context: text(block.title)
            });
          }
        });
      }
      if(type === 'table'){
        const headers = safeArray(block.headers).map(text);
        safeArray(block.rows).forEach((row, rowIndex) => {
          const cells = safeArray(row).map(text);
          const subject = cells[0];
          for(let col = 1; col < cells.length; col += 1){
            if(subject && cells[col]){
              facts.push({
                id: `table-${blockIndex}-${rowIndex}-${col}`,
                kind: 'table',
                label: subject,
                value: cells[col],
                context: headers[col] || text(block.title)
              });
            }
          }
        });
      }
      if(type === 'steps' || type === 'checklist'){
        safeArray(block.items).forEach((item, itemIndex) => {
          if(text(item)){
            facts.push({
              id: `item-${blockIndex}-${itemIndex}`,
              kind: 'item',
              label: text(block.title) || text(lesson && lesson.title),
              value: text(item),
              context: text(block.title)
            });
          }
        });
      }
    });
    return facts;
  }

  function sourceSnapshot(source){
    const snapshot = {
      type: source.type,
      key: source.key,
      title: source.title,
      topic: source.topic,
      payload: source.payload
    };
    return { ...snapshot, version: stableHash(snapshot) };
  }

  function buildSourceRegistry(menu){
    const map = new Map();
    safeArray(menu && menu.techCards).forEach(doc => {
      safeArray(doc && doc.cards).forEach(card => {
        if(!isDrinkTechCard(card, doc)) return;
        const source = {
          type: 'techcard',
          key: techCardKey(card, doc),
          title: text(card.title),
          topic: 'techcards',
          payload: {
            documentTitle: text(doc.title),
            category: text(card.category),
            output: text(card.output),
            technology: text(card.technology),
            ingredients: safeArray(card.ingredients).map(item => typeof item === 'string' ? item : text(item && (item.name || item.title || item.ingredient))).filter(Boolean)
          }
        };
        map.set(`${source.type}:${source.key}`, sourceSnapshot(source));
      });
    });
    safeArray(menu && menu.lessons).forEach(lesson => {
      const topic = lessonTopic(lesson);
      if(!topic) return;
      const source = {
        type: 'lesson',
        key: lessonKey(lesson),
        title: text(lesson.title),
        topic,
        payload: {
          category: text(lesson.category),
          summary: text(lesson.summary),
          facts: flattenLessonFacts(lesson)
        }
      };
      map.set(`${source.type}:${source.key}`, sourceSnapshot(source));
    });
    return map;
  }

  function makeQuestion(base){
    const question = {
      id: text(base.id),
      origin: text(base.origin) || 'generated',
      topic: text(base.topic),
      sourceType: text(base.sourceType),
      sourceKey: text(base.sourceKey),
      sourceTitle: text(base.sourceTitle),
      sourceVersion: text(base.sourceVersion),
      type: text(base.type) || 'single',
      prompt: text(base.prompt),
      options: safeArray(base.options).map(text).filter(Boolean),
      correctAnswer: base.correctAnswer,
      tolerance: Number(base.tolerance || 0),
      explanation: text(base.explanation),
      active: base.active !== false
    };
    question.fingerprint = text(base.fingerprint) || stableHash({
      topic: question.topic,
      sourceType: question.sourceType,
      sourceKey: question.sourceKey,
      sourceVersion: question.sourceVersion,
      type: question.type,
      prompt: question.prompt,
      options: question.options,
      correctAnswer: question.correctAnswer
    });
    if(!question.id) question.id = `${question.origin}-${question.fingerprint}`;
    return question;
  }

  function buildOptionSet(correct, distractors, random){
    const options = uniq([correct, ...safeArray(distractors)]);
    if(options.length < 3) return [];
    return shuffle(options.slice(0, 4), random);
  }

  function generateTechQuestions(registry, random = Math.random){
    const sources = Array.from(registry.values()).filter(source => source.type === 'techcard');
    const allOutputs = uniq(sources.map(source => source.payload.output).filter(Boolean));
    const allIngredients = uniq(sources.flatMap(source => source.payload.ingredients || []));
    const questions = [];
    sources.forEach(source => {
      const ingredients = uniq(source.payload.ingredients || []);
      if(ingredients.length){
        const correct = ingredients[Math.floor(random() * ingredients.length)] || ingredients[0];
        const distractors = shuffle(allIngredients.filter(item => !ingredients.some(own => norm(own) === norm(item))), random).slice(0, 3);
        const options = buildOptionSet(correct, distractors, random);
        if(options.length >= 3){
          questions.push(makeQuestion({
            origin: 'generated', topic: 'techcards', sourceType: source.type, sourceKey: source.key,
            sourceTitle: source.title, sourceVersion: source.version, type: 'single',
            prompt: `Какой ингредиент входит в напиток «${source.title}»?`, options,
            correctAnswer: correct,
            explanation: `Источник: техкарта «${source.title}».`
          }));
        }
      }
      if(source.payload.output){
        const distractors = shuffle(allOutputs.filter(value => norm(value) !== norm(source.payload.output)), random).slice(0, 3);
        const options = buildOptionSet(source.payload.output, distractors, random);
        if(options.length >= 3){
          questions.push(makeQuestion({
            origin: 'generated', topic: 'techcards', sourceType: source.type, sourceKey: source.key,
            sourceTitle: source.title, sourceVersion: source.version, type: 'single',
            prompt: `Какой выход указан в техкарте напитка «${source.title}»?`, options,
            correctAnswer: source.payload.output,
            explanation: `Источник: техкарта «${source.title}».`
          }));
        }
      }
    });
    return questions;
  }

  function generateLessonQuestions(registry, random = Math.random){
    const lessonSources = Array.from(registry.values()).filter(source => source.type === 'lesson');
    const byTopic = lessonSources.reduce((acc, source) => {
      (acc[source.topic] ||= []).push(source);
      return acc;
    }, {});
    const questions = [];
    Object.entries(byTopic).forEach(([topic, sources]) => {
      const allValues = uniq(sources.flatMap(source => safeArray(source.payload.facts).map(fact => fact.value)));
      sources.forEach(source => {
        safeArray(source.payload.facts).forEach(fact => {
          const distractors = shuffle(allValues.filter(value => norm(value) !== norm(fact.value)), random).slice(0, 3);
          const options = buildOptionSet(fact.value, distractors, random);
          if(options.length < 3) return;
          let prompt = `Какое утверждение содержится в материале «${source.title}»?`;
          if(fact.kind === 'pair') prompt = `Что сказано о «${fact.label}» в материале «${source.title}»?`;
          if(fact.kind === 'table') prompt = `Какое значение указано для «${fact.label}» в колонке «${fact.context || 'значение'}»?`;
          if(fact.kind === 'item') prompt = `Какой пункт относится к теме «${fact.label}»?`;
          questions.push(makeQuestion({
            origin: 'generated', topic, sourceType: source.type, sourceKey: source.key,
            sourceTitle: source.title, sourceVersion: source.version, type: 'single', prompt, options,
            correctAnswer: fact.value,
            explanation: `Источник: материал «${source.title}».`
          }));
        });
      });
    });
    return questions;
  }

  function generateQuestionBank(menu, random = Math.random){
    const registry = buildSourceRegistry(menu);
    return {
      registry,
      questions: [...generateTechQuestions(registry, random), ...generateLessonQuestions(registry, random)]
    };
  }

  function normalizeStoredQuestion(row){
    const answer = row.correct_answer !== undefined ? row.correct_answer : row.correctAnswer;
    return makeQuestion({
      id: row.id,
      origin: 'manual',
      topic: row.topic,
      sourceType: row.source_type || row.sourceType,
      sourceKey: row.source_key || row.sourceKey,
      sourceTitle: row.source_title || row.sourceTitle,
      sourceVersion: row.source_version || row.sourceVersion,
      type: row.question_type || row.type,
      prompt: row.prompt,
      options: row.options,
      correctAnswer: answer,
      tolerance: row.tolerance,
      explanation: row.explanation,
      active: row.is_active !== undefined ? row.is_active : row.active,
      fingerprint: row.fingerprint
    });
  }

  function questionValidity(question, registry){
    const source = registry.get(`${question.sourceType}:${question.sourceKey}`);
    if(!source) return { valid:false, reason:'Источник удалён или недоступен' };
    if(source.topic !== question.topic) return { valid:false, reason:'Источник относится к другой теме' };
    if(question.sourceVersion && source.version !== question.sourceVersion) return { valid:false, reason:'Источник изменён — вопрос нужно проверить' };
    if(!question.active) return { valid:false, reason:'Вопрос выключен' };
    return { valid:true, reason:'' };
  }

  function mergeQuestionBank(generatedQuestions, storedRows, registry){
    const map = new Map();
    safeArray(generatedQuestions).forEach(question => map.set(question.fingerprint, question));
    safeArray(storedRows).map(normalizeStoredQuestion).forEach(question => map.set(question.fingerprint, question));
    return Array.from(map.values()).map(question => ({ ...question, validity: questionValidity(question, registry) }));
  }

  function normalizePlan(plan){
    const normalized = {};
    Object.keys(TOPICS).forEach(topic => {
      const value = Number(plan && plan[topic] || 0);
      normalized[topic] = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    });
    return normalized;
  }

  function autoAssemble(bank, plan, random = Math.random){
    const normalizedPlan = normalizePlan(plan);
    const selected = [];
    const shortages = [];
    Object.entries(normalizedPlan).forEach(([topic, count]) => {
      if(!count) return;
      const candidates = safeArray(bank).filter(question => question.topic === topic && question.active !== false && (!question.validity || question.validity.valid));
      const uniqueByFingerprint = Array.from(new Map(candidates.map(question => [question.fingerprint, question])).values());
      if(uniqueByFingerprint.length < count){
        shortages.push({ topic, requested: count, available: uniqueByFingerprint.length });
        return;
      }
      selected.push(...shuffle(uniqueByFingerprint, random).slice(0, count));
    });
    if(shortages.length){
      const error = new Error(shortages.map(item => `${TOPICS[item.topic]}: нужно ${item.requested}, доступно ${item.available}`).join('; '));
      error.code = 'BANK_SHORTAGE';
      error.shortages = shortages;
      throw error;
    }
    return shuffle(selected, random);
  }

  function questionSnapshot(question){
    return {
      id: question.id,
      fingerprint: question.fingerprint,
      topic: question.topic,
      sourceType: question.sourceType,
      sourceKey: question.sourceKey,
      sourceTitle: question.sourceTitle,
      sourceVersion: question.sourceVersion,
      type: question.type,
      prompt: question.prompt,
      options: safeArray(question.options),
      correctAnswer: question.correctAnswer,
      tolerance: Number(question.tolerance || 0),
      explanation: question.explanation
    };
  }

  function answerIsCorrect(question, answer){
    if(question.type === 'multiple'){
      const expected = uniq(safeArray(question.correctAnswer)).map(norm).sort();
      const actual = uniq(safeArray(answer)).map(norm).sort();
      return expected.length === actual.length && expected.every((value, index) => value === actual[index]);
    }
    if(question.type === 'number'){
      const expected = Number(Array.isArray(question.correctAnswer) ? question.correctAnswer[0] : question.correctAnswer);
      const actual = Number(String(answer == null ? '' : answer).replace(',', '.'));
      if(!Number.isFinite(expected) || !Number.isFinite(actual)) return false;
      return Math.abs(expected - actual) <= Number(question.tolerance || 0);
    }
    return norm(answer) === norm(Array.isArray(question.correctAnswer) ? question.correctAnswer[0] : question.correctAnswer);
  }

  function gradeAnswers(questions, answers){
    const rows = safeArray(questions);
    const answerMap = answers || {};
    const details = rows.map(question => ({
      questionId: question.id || question.fingerprint,
      correct: answerIsCorrect(question, answerMap[question.id || question.fingerprint])
    }));
    const correctCount = details.filter(row => row.correct).length;
    const totalCount = rows.length;
    return {
      correctCount,
      totalCount,
      scorePercent: totalCount ? Math.round(correctCount / totalCount * 10000) / 100 : 0,
      details
    };
  }

  return {
    TOPICS,
    norm,
    stableHash,
    shuffle,
    techCardKey,
    lessonKey,
    isDrinkTechCard,
    lessonTopic,
    flattenLessonFacts,
    buildSourceRegistry,
    generateQuestionBank,
    normalizeStoredQuestion,
    questionValidity,
    mergeQuestionBank,
    normalizePlan,
    autoAssemble,
    questionSnapshot,
    answerIsCorrect,
    gradeAnswers
  };
});
