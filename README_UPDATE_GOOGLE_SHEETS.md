# Update Google Apps Script

1. Open Apps Script.
2. Delete the old code completely.
3. Paste the full code from `google_apps_script_code.js`.
4. Save.
5. Run `setupDatabase` once.
6. Deploy a new version: Deploy -> Manage deployments -> Edit -> New version -> Deploy.

Important: this version returns JSONP as ASCII Unicode escapes. It prevents Russian text from being corrupted during script loading. It also uses new localStorage keys, so old corrupted browser cache will not be shown.
