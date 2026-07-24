/* Современник — centralized role, navigation and operation configuration. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  if(root) root.SovremennikRoles=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const ROLES=Object.freeze({
    admin:{label:'Администратор',icon:'◆',accent:'graphite',routes:['home','tasks','method','theory','checklists','revisions','techcards','schedule','reportError','employees','control'],home:['technicalSummary','systemStatus','maintenance','employees','recentActions'],operations:['*'],preview:['manager','barista','waiter']},
    manager:{label:'Руководитель',icon:'★',accent:'gold',routes:['home','tasks','method','theory','checklists','revisions','techcards','schedule','reportError','control'],home:['attention','onShift','overdueTasks','incompleteChecklists','missingRevisions','issues','maintenance','upcoming','training','handoff','recentActions'],operations:['view_operations','manage_tasks','view_all_checklists','view_revisions','correct_revisions','manage_schedule','view_control']},
    barista:{label:'Бариста',icon:'☕',accent:'olive',routes:['home','tasks','method','theory','checklists','revisions','techcards','schedule','reportError'],home:['primaryAction','activeChecklist','coffeeRevision','personalTasks','importantInfo'],operations:['view_assigned','submit_checklist','submit_revision','view_coffee_revision','report_issue']},
    waiter:{label:'Официант',icon:'●',accent:'blue',routes:['home','tasks','method','theory','checklists','schedule','reportError'],home:['primaryAction','activeChecklist','personalTasks','importantInfo'],operations:['view_assigned','submit_checklist','report_issue']}
  });
  const NAV=Object.freeze({
    home:{label:'Главная',icon:'⌂'},tasks:{label:'Мои задачи',icon:'✓'},method:{label:'Методичка',icon:'▤'},theory:{label:'Обучение',icon:'◇'},checklists:{label:'Чек-листы',icon:'☑'},revisions:{label:'Ревизии',icon:'≋'},techcards:{label:'Тех. карты',icon:'◫'},schedule:{label:'Расписание',icon:'□'},reportError:{label:'Сообщить о проблеме',icon:'!'},employees:{label:'Сотрудники',icon:'♟'},control:{label:'Контроль',icon:'▥'}
  });
  const aliases={'администратор':'admin','админ':'admin','admin':'admin','руководитель':'manager','менеджер':'manager','manager':'manager','бариста':'barista','barista':'barista','официант':'waiter','waiter':'waiter'};
  function normalizeRole(value){return aliases[String(value||'').trim().toLowerCase()]||'unknown';}
  function config(value){return ROLES[normalizeRole(value)]||null;}
  function roleLabel(value){return config(value)?.label||'Роль не назначена';}
  function routes(value){return (config(value)?.routes||['home','tasks']).slice();}
  function canRoute(value,route,{assigned=false,maintenance=false,realRole=value}={}){
    const role=normalizeRole(value), actual=normalizeRole(realRole);
    if(actual==='admin') return true;
    if(maintenance) return false;
    if(assigned&&['tasks','checklists','schedule'].includes(route)) return true;
    return routes(role).includes(route);
  }
  function can(value,operation,{realRole=value}={}){
    const actual=normalizeRole(realRole); if(actual==='admin') return true;
    const ops=config(value)?.operations||[]; return ops.includes('*')||ops.includes(operation);
  }
  function navigation(value){const allowed=new Set(routes(value));return Object.entries(NAV).filter(([id])=>allowed.has(id)).map(([id,meta])=>({id,...meta}));}
  function homeBlocks(value){return (config(value)?.home||['primaryAction','personalTasks']).slice();}
  function previewRoles(value){return normalizeRole(value)==='admin'?ROLES.admin.preview.slice():[];}
  function isKnown(value){return Boolean(config(value));}
  return Object.freeze({ROLES,NAV,normalizeRole,config,roleLabel,routes,canRoute,can,navigation,homeBlocks,previewRoles,isKnown});
});