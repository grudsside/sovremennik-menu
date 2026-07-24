/* Современник — role-specific checklist data and daily-work status helpers. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  if(root) root.SovremennikChecklistCore=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';

  const WAITER_OPENING_TASKS=Object.freeze([
    'Открыть свою смену в айке по приходу',
    'Включить музыку (Ню-диско), свет в зале и вывеску',
    'Выложить десерты. СДЕЛАТЬ АКТ разморозки',
    'Включить кондиционеры/приточку, завесу',
    'Снять стулья со столов',
    'Протереть все столы с палиролью',
    'Поправить все подушки всех диванов',
    'Проверить все столы на качание',
    'Наполнить водой бутылки',
    'Опрыскать цветы. По четвергам доп. полив.',
    'Уточнить у цехов актуальный стоп-лист',
    'Выставить ценники на кондитерке',
    'Проверить на чистоту детский стульчик',
    'Принести чистые подносы с мойки,десертные тарелки,бутылки',
    'Натереть оставшиеся с вечера приборы ',
    'Затереть столы и стулья на на летней веранде ',
    'Подготовить стейшен на улице ',
    'Проверить мусорные баки и туалетную бумагу в гостевых  туалетах'
  ]);

  const WAITER_CLOSING_TASKS=Object.freeze([
    'Проверить, закрыты ли окна',
    'Проверить в конце смены наличие упаковки на кондитерском цеху',
    'Упаковать одноразовые перчатки',
    'Протереть зеркала у гардероба и в гостевых туалетах',
    'Пополнить туалетную бумагу в гостевых туалетах',
    'Пополнить чистую микрофибру на мойке',
    'Протереть входную группу',
    'Проверить на чистоту меню',
    'Пополнить сахар, соль и перец',
    'Пополнить салфетки на стейшенах',
    'Пополнить полироли, средства для зеркал',
    'Пополнить запас чековых лент',
    'Проверить наличие чековых лент на всех цехах',
    'Убрать щеточкой все крошки с мебели',
    'Убрать чеки с чеконакалывателей всех цехов',
    'Сдать грязные подносы на мойку',
    'Сдать бутылки на мойку ',
    'Протереть все столы с палиролью',
    'Кинуть грязную микрофибру в бокс',
    'Подготовить на следующую смену макарон',
    'Списать моти, макарон, выпечку, ЗАВЕСТИ АКТ',
    'Убрать десерты в холодос, сравнить со стопом',
    'Поставить стулья на столы',
    'Протереть витрину с десертами',
    'Выбросить мусор с КЦ и у стейшена',
    'Заменить перегоревшие лампочки',
    'Поднять упавшие вешалки',
    'Поставить телефоны и терминалы на зарядку',
    'Выключить в зале свет, приточку, музыку и вывеску'
  ]);

  function checklistDocument(id,title,phase,tasks){
    return Object.freeze({
      id,
      title,
      description:'Чек-лист официанта. Отмечайте пункты по мере выполнения и отправьте заполненный чек-лист.',
      file:'',
      audience:'waiter',
      department:'waiter',
      shiftPhase:phase,
      sections:[{title:phase==='opening'?'Чек-лист открытия смены':'Чек-лист закрытия смены',rows:tasks.map(task=>({task}))}]
    });
  }

  const WAITER_CHECKLISTS=Object.freeze([
    checklistDocument('waiter-opening-checklist','Официант · открытие смены','opening',WAITER_OPENING_TASKS),
    checklistDocument('waiter-closing-checklist','Официант · закрытие смены','closing',WAITER_CLOSING_TASKS)
  ]);

  const ROLE_ALIASES=Object.freeze({
    'администратор':'admin','админ':'admin','admin':'admin',
    'руководитель':'manager','менеджер':'manager','manager':'manager',
    'бариста':'barista','barista':'barista',
    'официант':'waiter','waiter':'waiter'
  });

  function normalizeRole(value){return ROLE_ALIASES[String(value||'').trim().toLowerCase()]||'unknown';}
  function localDateKey(value=new Date()){
    if(typeof value==='string'){
      const direct=value.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if(direct) return `${direct[1]}-${direct[2]}-${direct[3]}`;
    }
    const date=value instanceof Date?value:new Date(value);
    if(Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  }
  function departmentForDoc(doc){
    const explicit=String(doc?.department||doc?.audience||'').trim().toLowerCase();
    if(explicit==='waiter'||explicit==='hall') return 'waiter';
    if(explicit==='barista'||explicit==='bar') return 'barista';
    const source=`${doc?.id||''} ${doc?.title||''}`.toLowerCase();
    return source.includes('waiter')||source.includes('официант')?'waiter':'barista';
  }
  function injectWaiterChecklists(rows){
    const map=new Map((rows||[]).filter(Boolean).map(doc=>[String(doc.id||''),doc]));
    for(const doc of WAITER_CHECKLISTS){if(!map.has(doc.id)) map.set(doc.id,doc);}
    return Array.from(map.values());
  }
  function docsForDepartment(rows,department){return injectWaiterChecklists(rows).filter(doc=>departmentForDoc(doc)===department);}
  function findShiftDoc(rows,department,phase){
    const docs=docsForDepartment(rows,department);
    const explicit=docs.find(doc=>String(doc.shiftPhase||'').toLowerCase()===phase);
    if(explicit) return explicit;
    const pattern=phase==='opening'?/открыт/i:/закрыт/i;
    return docs.find(doc=>pattern.test(String(doc.title||'')))||null;
  }
  function submissionMatchesDoc(row,doc){
    const id=String(row?.checklist_id||row?.checklistId||'');
    const title=String(row?.checklist_title||row?.checklistTitle||row?.checklistType||'');
    return Boolean(doc)&&(id===String(doc.id)||title===String(doc.title));
  }
  function submissionProgress(rows,doc,userId,today=localDateKey()){
    const matches=(rows||[]).filter(row=>{
      const employee=String(row?.employee_id||row?.employeeId||'');
      const date=localDateKey(row?.created_at||row?.createdAt||row?.date||'');
      return (!userId||!employee||employee===String(userId))&&date===today&&submissionMatchesDoc(row,doc);
    }).sort((left,right)=>String(right?.created_at||right?.createdAt||'').localeCompare(String(left?.created_at||left?.createdAt||'')));
    const row=matches[0];
    if(!row) return {done:false,completed:0,total:0,label:'Не выполнено'};
    const items=Array.isArray(row.items)?row.items:(Array.isArray(row.tasks)?row.tasks:[]);
    const total=Number(row.total_count??row.total??items.length)||0;
    const completed=Number(row.completed_count??row.completed??items.filter(item=>item?.checked||item?.done).length)||0;
    const done=total>0&&completed>=total;
    return {done,completed,total,label:done?'Выполнено':`${completed}/${total}`};
  }
  function revisionCompleted(rows,userId,today=localDateKey()){
    return (rows||[]).some(row=>{
      const employee=String(row?.employee_id||row?.employeeId||'');
      const date=localDateKey(row?.revision_date||row?.revisionDate||row?.dateKey||row?.created_at||'');
      return date===today&&(!userId||!employee||employee===String(userId));
    });
  }
  function taskStatus(task){return String(task?.status||'open').trim().toLowerCase();}
  function taskDueKey(task){return localDateKey(task?.due_at||task?.dueAt||task?.due_date||task?.dueDate||'');}
  function taskCompletedKey(task){return localDateKey(task?.completed_at||task?.completedAt||'');}
  function taskForToday(task,today=localDateKey()){
    const status=taskStatus(task);
    const due=taskDueKey(task);
    if(status==='done'||status==='completed'||status==='выполнена') return taskCompletedKey(task)===today||due===today;
    return !due||due<=today;
  }
  function taskIsDone(task){return ['done','completed','выполнена'].includes(taskStatus(task));}

  return Object.freeze({
    WAITER_OPENING_TASKS,WAITER_CLOSING_TASKS,WAITER_CHECKLISTS,
    normalizeRole,localDateKey,departmentForDoc,injectWaiterChecklists,docsForDepartment,
    findShiftDoc,submissionProgress,revisionCompleted,taskForToday,taskIsDone,taskDueKey
  });
});