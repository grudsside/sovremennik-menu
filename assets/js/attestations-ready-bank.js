(function(root,factory){
  'use strict';
  if(typeof module === 'object' && module.exports){
    module.exports = factory(require('./attestations-core.js'));
    return;
  }
  const api = factory(root && root.SovAttestationsCore);
  if(root) root.SovAttestationsReadyBank = api;
  if(api && typeof api.install === 'function') api.install();
})(typeof globalThis !== 'undefined' ? globalThis : this, function(Core){
  'use strict';

  const QUESTIONS_PER_TOPIC = 20;
  const BANK_VERSION = 'ready-bank-20260728-v1';

  function safeArray(value){ return Array.isArray(value) ? value : []; }

  function seededRandom(seedText){
    let seed = parseInt(Core.stableHash(String(seedText || BANK_VERSION)), 36) >>> 0;
    if(!seed) seed = 0x6d2b79f5;
    return function(){
      seed += 0x6d2b79f5;
      let value = seed;
      value = Math.imul(value ^ value >>> 15, value | 1);
      value ^= value + Math.imul(value ^ value >>> 7, value | 61);
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
  }

  function sourceSeed(menu){
    const registry = Core.buildSourceRegistry(menu || {});
    return Array.from(registry.values())
      .map(source => `${source.type}:${source.key}:${source.version}`)
      .sort()
      .join('|');
  }

  function topicCounts(questions){
    return safeArray(questions).reduce((counts, question) => {
      counts[question.topic] = Number(counts[question.topic] || 0) + 1;
      return counts;
    }, {});
  }

  function stableRank(question){
    return Core.stableHash({
      bankVersion:BANK_VERSION,
      topic:question.topic,
      sourceKey:question.sourceKey,
      fingerprint:question.fingerprint,
      prompt:question.prompt
    });
  }

  function selectReadyQuestions(questions){
    const selected = [];
    Object.keys(Core.TOPICS).forEach(topic => {
      const unique = Array.from(new Map(
        safeArray(questions)
          .filter(question => question.topic === topic)
          .map(question => [question.fingerprint, question])
      ).values());
      unique.sort((left, right) => stableRank(left).localeCompare(stableRank(right), 'en'));
      selected.push(...unique.slice(0, QUESTIONS_PER_TOPIC));
    });
    return selected;
  }

  function createGenerator(originalGenerate){
    return function generateReadyQuestionBank(menu){
      const random = seededRandom(`${BANK_VERSION}|${sourceSeed(menu)}`);
      const built = originalGenerate(menu || {}, random);
      const questions = selectReadyQuestions(built.questions);
      return {
        registry:built.registry,
        questions,
        bankPolicy:{
          version:BANK_VERSION,
          questionsPerTopic:QUESTIONS_PER_TOPIC,
          counts:topicCounts(questions)
        }
      };
    };
  }

  function install(){
    if(!Core || Core.__readyQuestionBankInstalled) return false;
    const originalGenerate = Core.generateQuestionBank;
    Core.__generatedQuestionBankOriginal = originalGenerate;
    Core.generateQuestionBank = createGenerator(originalGenerate);
    Core.__readyQuestionBankInstalled = true;
    return true;
  }

  return {
    QUESTIONS_PER_TOPIC,
    BANK_VERSION,
    seededRandom,
    topicCounts,
    selectReadyQuestions,
    createGenerator,
    install
  };
});
