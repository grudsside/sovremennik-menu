(function(root, factory){
  'use strict';
  const api = factory(root && root.SovAttestationsCore);
  if(typeof module === 'object' && module.exports) module.exports = api;
  if(root) root.SovAttestationsQuestionManagementCore = api;
  if(api && typeof api.install === 'function') api.install();
})(typeof globalThis !== 'undefined' ? globalThis : this, function(Core){
  'use strict';

  function safeArray(value){ return Array.isArray(value) ? value : []; }
  function isDeletedRow(row){ return Boolean(row && (row.deleted_at || row.deletedAt)); }

  function createMergeQuestionBank(core){
    return function mergeQuestionBank(generatedQuestions, storedRows, registry){
      const map = new Map();
      safeArray(generatedQuestions).forEach(question => map.set(question.fingerprint, question));

      safeArray(storedRows).forEach(row => {
        const fingerprint = String(row?.fingerprint || '').trim();
        if(!fingerprint) return;
        if(isDeletedRow(row)){
          map.delete(fingerprint);
          return;
        }

        const replacesGenerated = map.has(fingerprint);
        const question = core.normalizeStoredQuestion(row);
        question.origin = replacesGenerated ? 'override' : 'manual';
        question.storedId = row.id || '';
        map.set(fingerprint, question);
      });

      return Array.from(map.values()).map(question => ({
        ...question,
        validity: core.questionValidity(question, registry)
      }));
    };
  }

  function install(){
    if(!Core || Core.__questionManagementInstalled) return false;
    Core.__mergeQuestionBankBeforeQuestionManagement = Core.mergeQuestionBank;
    Core.mergeQuestionBank = createMergeQuestionBank(Core);
    Core.__questionManagementInstalled = true;
    return true;
  }

  return {
    isDeletedRow,
    createMergeQuestionBank,
    install
  };
});