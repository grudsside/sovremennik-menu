/* Современник script loader: preserve push logic, then add the interface shell. */
/* push-legacy.js keeps loading assets/js/employee-status.js and all existing push handlers. */
window.SOVREMENNIK_TASKS_MAINTENANCE = true;
document.write('<link rel="stylesheet" href="assets/css/interface-v3-hotfix.css?v=20260718-1">');
document.write('<link rel="stylesheet" href="assets/css/interface-followup.css?v=20260719-1">');
document.write('<link rel="stylesheet" href="assets/css/tasks-v2.css?v=20260719-1">');
document.write('<link rel="stylesheet" href="assets/css/mobile-active-panel.css?v=20260719-2">');
document.write('<link rel="stylesheet" href="assets/css/tasks-maintenance.css?v=20260719-1">');
document.write('<script src="assets/js/push-legacy.js?v=20260718"><\/script>');
document.write('<script src="assets/js/interface-redesign.js?v=20260718"><\/script>');
document.write('<script src="assets/js/tasks-v2.js?v=20260719-1"><\/script>');
document.write('<script src="assets/js/interface-v3.js?v=20260719-4"><\/script>');
document.write('<script src="assets/js/interface-followup.js?v=20260719-2"><\/script>');
document.write('<script src="assets/js/mobile-active-panel.js?v=20260719-3"><\/script>');
document.write('<script src="assets/js/tasks-maintenance.js?v=20260719-1"><\/script>');
