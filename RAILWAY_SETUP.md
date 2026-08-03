# Railway deployment setup

## 1. Set the frontend API URL

Open `js/config.js` and replace:

```js
const RAILWAY_API_BASE_URL = 'https://REPLACE-WITH-YOUR-RAILWAY-DOMAIN.up.railway.app';
```

with the public domain from Railway, for example:

```js
const RAILWAY_API_BASE_URL = 'https://nexttask-production.up.railway.app';
```

Do not include a trailing slash.

## 2. Set the Railway frontend-origin variable

In Railway, add this service variable:

```text
FRONTEND_ORIGINS=https://pbangiola.github.io
```

For a custom frontend domain or additional local origin, use a comma-separated list:

```text
FRONTEND_ORIGINS=https://pbangiola.github.io,https://tasks.example.com
```

## 3. Confirm the persistent volume

Mount the Railway volume and ensure `RAILWAY_VOLUME_MOUNT_PATH` is available to the service. `database.js` uses that directory for `task_sorter.db`.

## 4. Test the backend

Open this route using your Railway domain:

```text
https://YOUR-RAILWAY-DOMAIN/api/health
```

It should return JSON containing `"ok": true`.

## 5. Deploy the frontend

Upload the full project structure to GitHub Pages, including all `js/` subfolders. A missing subfolder will cause the page to load without its related feature code.
