/* Современник checklist template editor — pure data model and stable item keys. */
(function(root){
  'use strict';

  const VERSION = '2026-07-24-checklist-editor-1';
  const MAX_SECTIONS = 30;
  const MAX_ROWS_PER_SECTION = 100;
  const MAX_TOTAL_ROWS = 300;

  function text(value){ return String(value ?? '').trim(); }
  function clone(value){ return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function fallbackItemKey(checklistId, sectionIndex, rowIndex){
    return `${text(checklistId) || 'checklist'}:${Number(sectionIndex) || 0}:${Number(rowIndex) || 0}`;
  }
  function rowItemKey(checklistId, row, sectionIndex, rowIndex){
    return text(row?.itemKey || row?.item_key || row?.key) || fallbackItemKey(checklistId, sectionIndex, rowIndex);
  }
  function randomToken(){
    if(root.crypto?.randomUUID) return root.crypto.randomUUID();
    return `item-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
  function createItemKey(checklistId){
    return `${text(checklistId) || 'checklist'}:custom:${randomToken()}`;
  }
  function normalizeRow(checklistId, row, sectionIndex, rowIndex){
    const normalized = {
      itemKey:rowItemKey(checklistId, row, sectionIndex, rowIndex),
      task:text(row?.task || row?.text || row?.label)
    };
    const responsible = text(row?.responsible);
    const min = text(row?.min);
    if(responsible) normalized.responsible = responsible;
    if(min) normalized.min = min;
    return normalized;
  }
  function normalizeSection(checklistId, section, sectionIndex){
    const type = text(section?.type) === 'minlist' ? 'minlist' : '';
    const normalized = {
      title:text(section?.title),
      rows:(section?.rows || []).map((row, rowIndex) => normalizeRow(checklistId, row, sectionIndex, rowIndex))
    };
    if(type) normalized.type = type;
    return normalized;
  }
  function normalizeTemplate(input){
    const checklistId = text(input?.id || input?.checklistId || input?.checklist_id);
    return {
      id:checklistId,
      title:text(input?.title),
      description:text(input?.description),
      sections:(input?.sections || []).map((section, sectionIndex) => normalizeSection(checklistId, section, sectionIndex))
    };
  }
  function validateTemplate(input){
    const template = normalizeTemplate(input);
    const errors = [];
    if(!template.id) errors.push('Не найден идентификатор чек-листа.');
    if(!template.title) errors.push('Укажите название чек-листа.');
    if(template.title.length > 160) errors.push('Название чек-листа должно быть короче 160 символов.');
    if(template.description.length > 2000) errors.push('Описание чек-листа должно быть короче 2000 символов.');
    if(!template.sections.length) errors.push('Добавьте хотя бы один раздел.');
    if(template.sections.length > MAX_SECTIONS) errors.push(`В чек-листе может быть не более ${MAX_SECTIONS} разделов.`);

    let totalRows = 0;
    const keys = new Set();
    template.sections.forEach((section, sectionIndex) => {
      if(!section.title) errors.push(`Укажите название раздела ${sectionIndex + 1}.`);
      if(section.title.length > 160) errors.push(`Название раздела ${sectionIndex + 1} слишком длинное.`);
      if(!section.rows.length) errors.push(`В разделе «${section.title || sectionIndex + 1}» должен быть хотя бы один пункт.`);
      if(section.rows.length > MAX_ROWS_PER_SECTION) errors.push(`В одном разделе может быть не более ${MAX_ROWS_PER_SECTION} пунктов.`);
      totalRows += section.rows.length;
      section.rows.forEach((row, rowIndex) => {
        if(!row.task) errors.push(`Заполните пункт ${rowIndex + 1} в разделе «${section.title || sectionIndex + 1}».`);
        if(row.task.length > 500) errors.push(`Пункт ${rowIndex + 1} в разделе «${section.title || sectionIndex + 1}» слишком длинный.`);
        if(row.responsible?.length > 160) errors.push(`Поле «Ответственный» в пункте ${rowIndex + 1} слишком длинное.`);
        if(row.min?.length > 160) errors.push(`Поле «Минимум» в пункте ${rowIndex + 1} слишком длинное.`);
        if(keys.has(row.itemKey)) errors.push('Обнаружены повторяющиеся идентификаторы пунктов. Обновите страницу и повторите редактирование.');
        keys.add(row.itemKey);
      });
    });
    if(totalRows > MAX_TOTAL_ROWS) errors.push(`В чек-листе может быть не более ${MAX_TOTAL_ROWS} пунктов.`);
    return { ok:errors.length === 0, errors, template, totalRows };
  }
  function applyOverrides(menu, rows){
    const result = clone(menu || {});
    const docs = Array.isArray(result.checklists) ? result.checklists : [];
    const byId = new Map((rows || []).map(row => [text(row?.checklist_id || row?.checklistId || row?.id), row]));
    result.checklists = docs.map(doc => {
      const override = byId.get(text(doc?.id));
      if(!override) return doc;
      const normalized = normalizeTemplate({
        id:doc.id,
        title:override.title ?? doc.title,
        description:override.description ?? doc.description,
        sections:override.sections ?? doc.sections
      });
      return {
        ...doc,
        title:normalized.title || doc.title,
        description:normalized.description,
        sections:normalized.sections,
        __templateOverride:true,
        __templateVersion:Number(override.version || 1),
        __templateUpdatedAt:override.updated_at || override.updatedAt || ''
      };
    });
    return result;
  }
  function flattenChecklistStable(doc){
    const rows = [];
    (doc?.sections || []).forEach((section, sectionIndex) => {
      (section?.rows || []).forEach((row, rowIndex) => {
        rows.push({
          checklistId:text(doc?.id),
          checklistTitle:text(doc?.title),
          sectionIndex,
          rowIndex,
          sectionTitle:text(section?.title),
          itemKey:rowItemKey(doc?.id, row, sectionIndex, rowIndex),
          itemText:text(row?.task || row?.text || row?.label || 'Пункт чек-листа'),
          row
        });
      });
    });
    return rows;
  }

  const api = Object.freeze({
    VERSION,
    MAX_SECTIONS,
    MAX_ROWS_PER_SECTION,
    MAX_TOTAL_ROWS,
    text,
    clone,
    fallbackItemKey,
    rowItemKey,
    createItemKey,
    normalizeRow,
    normalizeSection,
    normalizeTemplate,
    validateTemplate,
    applyOverrides,
    flattenChecklistStable
  });
  root.SovremennikChecklistEditorCore = api;

  const photoCore = root.SovremennikChecklistPhotoCore;
  if(photoCore){
    root.SovremennikChecklistPhotoCore = Object.freeze({
      ...photoCore,
      flattenChecklist:flattenChecklistStable
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
