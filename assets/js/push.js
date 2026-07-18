/* Современник script loader: preserve push logic, then add the interface shell. */
/* push-legacy.js keeps loading assets/js/employee-status.js and all existing push handlers. */
document.write('<script src="assets/js/push-legacy.js?v=20260718"><\/script>');
document.write('<script src="assets/js/interface-redesign.js?v=20260718"><\/script>');
