import webpush from 'web-push';
import fs from 'node:fs';
const keys = webpush.generateVAPIDKeys();
const env = `VAPID_PUBLIC_KEY=${keys.publicKey}
VAPID_PRIVATE_KEY=${keys.privateKey}
VAPID_SUBJECT=mailto:uhalovgrigorij40731@gmail.com
NOTIFICATION_CRON_SECRET=${crypto.randomUUID()}
`;
fs.writeFileSync('vapid.env', env, 'utf8');
console.log('Готово. Создан файл vapid.env');
console.log('Скопируйте VAPID_PUBLIC_KEY в assets/js/supabase-config.js');
console.log(keys.publicKey);
