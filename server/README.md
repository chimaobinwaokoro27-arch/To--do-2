# To-Do Reminder Backend

A small Node.js + Express + PostgreSQL backend for a To-Do app. It stores your tasks,
works out **when** each reminder should go out, and **sends the email by itself**
when that time arrives. Every account only ever sees its own tasks.

---

## 1. What this backend does

- Keeps **user accounts**: email + a bcrypt-hashed password, stored in `users`.
- Logs a user in with a **JWT in an HTTP-only cookie**. The token is never given
  to page scripts and is never written to `localStorage`.
- Stores tasks (title, description, deadline, reminder lead time) in a
  PostgreSQL database (Supabase) reached through `DATABASE_URL`.
- Gives every task an owner (`userId`) and **only ever returns the tasks that
  belong to the logged-in user**.
- Calculates the reminder time automatically:
  `reminderAt = deadline - reminderMinutes`.
- Runs **one** `node-cron` job that checks the database every minute and emails
  any task whose reminder time has been reached — always to the address of the
  account that owns it.
- Exposes a small REST API so a React frontend can create, list, edit, complete
  and delete tasks.

### The most important thing to understand

**The browser does NOT send the email.** The React app only sends HTTP requests to
this backend. The backend talks to Gmail. That is why the Gmail password lives in
`server/.env` and never in the frontend.

```
React app  --HTTP-->  This backend  --SMTP-->  Gmail  --email-->  Your inbox
  (port 5173)          (port 5000)                (your account)
```

Because sending happens here, reminders still work **while the browser tab is
closed**. The only requirement is that this server keeps running (`npm start`).

> Gmail credentials and `JWT_SECRET` are secrets. Never put them in `.env` files
> you commit, never put them in React code, and never use your normal Gmail password.

---

## 2. Requirements

- Node.js 18 or newer (Node 22+ recommended)
- A Gmail account with 2-Step Verification enabled

## 3. Install dependencies

From the `server` folder:

```bash
cd server
npm install
```

The app talks to PostgreSQL through `pg`, which is pure JavaScript, so no native
compiler is needed. `better-sqlite3` is still installed only for the optional
`scripts/copy-sqlite-to-postgres.mjs` that reads the old local database.

Packages used: `express`, `cors`, `cookie-parser`, `pg`, `nodemailer`,
`node-cron`, `bcryptjs`, `jsonwebtoken`, `dotenv`.

## 4. Create your `.env` file

Copy the example file and fill in your own values:

```bash
cp .env.example .env      # macOS / Linux
copy .env.example .env    # Windows PowerShell / CMD
```

`.env` is already in `.gitignore`, so it will never be committed.

## 5. Get a Gmail App Password

Gmail refuses normal account logins from other apps, so you need an **App Password**.

1. Turn on 2-Step Verification for your Google account:
   <https://myaccount.google.com/security> → **2-Step Verification** → turn it on.
2. Generate the App Password:
   <https://myaccount.google.com/apppasswords> → **App passwords** → name it
   (for example `todo-reminder`) → **Create**.
3. Google shows a **16-character password** like `abcd efgh ijkl mnop`. Copy it.
   You will not be able to see it again.

## 6. Final `.env` values

| Variable              | Default / required       | Purpose                                        |
| --------------------- | ------------------------ | ---------------------------------------------- |
| `PORT`                | `5000`                   | Port the API listens on                        |
| `CLIENT_URL`          | `http://localhost:5173`  | Frontend origin allowed through CORS           |
| `NODE_ENV`            | `development`            | `production` turns on the `secure` cookie flag |
| `EMAIL_USER`          | required to send email   | Gmail account used to send reminders           |
| `EMAIL_APP_PASSWORD`  | required to send email   | Gmail App Password (16 chars)                  |
| `EMAIL_FROM`          | falls back to `EMAIL_USER` | The sender shown in the email                |
| `JWT_SECRET`          | required                 | Signs the login cookie                          |

Generate your own `JWT_SECRET` with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

If `JWT_SECRET` is missing the server still starts, but it makes up a random
secret for that run, so everybody is logged out again after a restart. The
warning in the console tells you when this happens.

The server still starts (and the whole API works) when the email variables are
empty — only the reminder scheduler stays off until you fill them in.

## 7. Run the backend

```bash
npm start     # normal run
npm run dev   # same, but restarts automatically when you edit a file
```

You should see:

```
Database ready at ...\server\data\todo.db
5 task(s) stored, 0 user(s) registered
Reminder scheduler started (checks every minute)
API listening on http://localhost:5000
```

Check that it is alive:

```bash
curl http://localhost:5000/api/health
# {"status":"ok","service":"todo-reminder-api"}
```

---

## 8. Accounts and login

### The tables

```sql
users
- id           INTEGER PRIMARY KEY AUTOINCREMENT
- email        TEXT NOT NULL UNIQUE     -- stored in lower case
- passwordHash TEXT NOT NULL            -- bcrypt hash, never the password
- createdAt    TEXT NOT NULL
```

```sql
tasks
- ... all the task fields ...
- userId       INTEGER REFERENCES users(id)   -- who owns the task
```

`tasks.userId` has an index (`idx_tasks_user_id`) so the "my tasks" query stays
fast, and PostgreSQL foreign keys are enforced by default, so a task can never
point at a user that does not exist.

**Older databases are never thrown away.** On startup the server checks whether
`tasks.userId` exists and adds the column with `ALTER TABLE` if it does not. Tasks
that were created before accounts existed keep `userId = NULL`; they belong to
nobody and are therefore never shown to anybody.

### The cookie

Logging in does not return a token in the JSON body. It sets a cookie called
`todo_token`:

| Setting      | Value            | Why                                                     |
| ------------ | ---------------- | ------------------------------------------------------- |
| `httpOnly`   | `true`           | Page JavaScript cannot read the token, so it cannot be stolen |
| `sameSite`   | `lax`            | The cookie is not sent from other websites              |
| `secure`     | `true` only when `NODE_ENV=production` | Sent over HTTPS in production; off in development because `http://localhost` has no HTTPS |
| `maxAge`     | 7 days           | The login lasts a week                                  |

### Auth routes

| Method | Route              | Purpose                                   |
| ------ | ------------------ | ----------------------------------------- |
| `POST` | `/api/auth/register` | Create an account and log in             |
| `POST` | `/api/auth/login`    | Log in                                   |
| `POST` | `/api/auth/logout`   | Clear the cookie                          |
| `GET`  | `/api/auth/me`       | Who am I? (401 when not logged in)        |

#### Register

```bash
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"user@gmail.com\",\"password\":\"password123\"}"
```

```json
{ "user": { "id": 1, "email": "user@gmail.com" } }
```

`201 Created`. The password is hashed with bcrypt (10 rounds) and only the hash is
stored. The response never contains `passwordHash` and never contains the token.

#### Login

```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"user@gmail.com\",\"password\":\"password123\"}"
```

```json
{ "user": { "id": 1, "email": "user@gmail.com" } }
```

`200 OK`, and the `todo_token` cookie is set.

#### Logout

```bash
curl -X POST http://localhost:5000/api/auth/logout
# {"message":"Logged out"}
```

The cookie is cleared. After that, every protected route answers `401`.

#### Who am I

```bash
curl http://localhost:5000/api/auth/me \
  -H "Cookie: todo_token=<the cookie value>"
```

```json
{ "user": { "id": 1, "email": "user@gmail.com" } }
```

### Auth status codes

| Situation                                  | Status | Message                                     |
| ------------------------------------------ | ------ | ------------------------------------------- |
| Registered / logged in                     | 201 / 200 | –                                         |
| `email` missing or not an email address   | 400    | `email is not a valid email address`        |
| `password` shorter than 8 characters       | 400    | `password must be at least 8 characters`    |
| Email already registered                   | 409    | `An account with that email already exists` |
| Wrong password, or email not registered    | 401    | `Email or password is incorrect`            |
| No cookie / expired / tampered token       | 401    | `You must be logged in`                     |

Login gives the same message for an unknown email and a wrong password, so the
response cannot be used to find out which addresses have accounts.

---

## 9. Task routes and how privacy works

**Every task route is protected.** `requireAuth` reads the `todo_token` cookie,
checks the signature and the expiry, and puts `req.user = { id, email }` on the
request. If there is no valid token the request stops with `401` before any
database work happens.

| Method   | Route            | Purpose                                      |
| -------- | ---------------- | -------------------------------------------- |
| `GET`    | `/api/health`    | Health check (open, no login needed)         |
| `POST`   | `/api/tasks`     | Create a task                                |
| `GET`    | `/api/tasks`     | **Your** tasks, earliest deadline first      |
| `GET`    | `/api/tasks/:id` | One of **your** tasks                        |
| `PATCH`  | `/api/tasks/:id` | Update one of **your** tasks                 |
| `DELETE` | `/api/tasks/:id` | Delete one of **your** tasks                 |

A task looks like this:

```json
{
  "id": 1,
  "title": "Submit frontend assignment",
  "description": "Finish the React assignment",
  "deadline": "2026-09-30T18:00:00",
  "reminderMinutes": 60,
  "reminderAt": "2026-09-30T17:00:00",
  "recipientEmail": "user@gmail.com",
  "completed": 0,
  "emailSent": 0,
  "createdAt": "2026-09-29T12:00:00",
  "userId": 1
}
```

### Why one person cannot see or touch another's tasks

The owner is decided **on the server**, in three places:

1. **`userId` always comes from the token.** `POST /api/tasks` stores
   `req.user.id`. A `userId` in the request body is never read, so sending
   `{"userId": 2}` while logged in as user 1 still creates a task for user 1.
2. **Every read is filtered.** `GET /api/tasks` runs
   `SELECT * FROM tasks WHERE userId = ?` with the id from the cookie. There is no
   way to ask for "all tasks".
3. **Every single-task query filters on both columns.** `GET`, `PATCH` and
   `DELETE` all run `... WHERE id = ? AND userId = ?`. If the row does not match,
   the answer is `404 Task not found` — the same answer as a task id that does not
   exist at all, so the response never reveals that somebody else's task is there.

`recipientEmail` is not a choice either. It is copied from `req.user.email`, so a
task can only ever send a reminder to the account that created it, and the
frontend cannot redirect someone's reminders to another address.

`PATCH` also never touches `userId` or `emailSent`. An update cannot move a task
to another account, and it cannot hand a task a second reminder email.

### Example: create a task

```bash
curl -X POST http://localhost:5000/api/tasks \
  -H "Content-Type: application/json" \
  -H "Cookie: todo_token=<the cookie value>" \
  -d "{\"title\":\"Submit frontend assignment\",\"description\":\"Finish the React assignment\",\"deadline\":\"2026-09-30T18:00:00\",\"reminderMinutes\":60}"
```

Note that `recipientEmail` is **not** in the body — the backend fills it in from
your account.

Response: `201 Created` with the created task.

### Validation rules and status codes

| Situation                                        | Status | Example error                                             |
| ------------------------------------------------ | ------ | --------------------------------------------------------- |
| Everything is valid                              | 201    | –                                                          |
| No valid login cookie                            | 401    | `You must be logged in`                                   |
| `title` missing                                   | 400    | `title is required`                                        |
| `deadline` missing or unparseable                 | 400    | `deadline is not a valid date`                             |
| `reminderMinutes` not a whole number 0…10080      | 400    | `reminderMinutes must be a whole number between 0 and 10080` |
| `reminderAt` would already be in the past         | 400    | `The reminder time (...) is already in the past. ...`      |
| Task missing, or owned by somebody else           | 404    | `Task not found`                                           |
| Unknown route                                     | 404    | `Route not found`                                          |
| Frontend origin not in `CLIENT_URL`              | 403    | `Origin not allowed by CORS`                               |
| Unexpected server failure                         | 500    | `Something went wrong` (details are logged, not returned)  |

Errors always come back as JSON: `{ "error": "message here" }`.

---

## 10. How the reminder scheduler works

1. `src/server.js` starts one `node-cron` job with the schedule `* * * * *`
   (top of every minute) and also runs one check immediately at startup.
2. Each run asks PostgreSQL for tasks where
   `emailSent = 0 AND completed = 0 AND reminderAt <= now`, joining `users` to
   find the owner's address.
3. For each task it calls `sendReminderEmail(task)` (`src/services/emailService.js`),
   which logs in to `smtp.gmail.com` with your App Password and sends the email
   **to the task owner's own email address**.
4. **Only if the send succeeds** is `emailSent` set to `1`. If it fails, the error
   is logged and the task is retried on the next minute.
5. Because the query always filters on `emailSent = 0`, a task is never emailed twice.

Accounts do not change any of this. The scheduler is server-side, runs once for
the whole app, and simply sends each reminder to whoever owns the task.

Design decisions worth knowing:

- **One cron job, not a `setTimeout` per task.** Tasks can be created, edited,
  deleted or completed at any time, so the schedule cannot live in memory.
- **Dates are stored as plain text** (`YYYY-MM-DDTHH:mm:ss`, your local time) so that
  simple string comparison in SQL works and the values match what you typed.
- **Completed tasks are skipped** by the query, so they never get an email.
- **Reopening a task** (`completed: 1` → `0`) whose reminder time is already in the
  past re-arms `reminderAt` to the current time. The PATCH request does not send an
  email; the scheduler sends it on its next run.
- **Editing `deadline` or `reminderMinutes`** recalculates `reminderAt` and the new
  time is used. A reminder that was already delivered stays delivered (`emailSent`
  is not reset), so one task produces at most one email.
- **All users share one sending Gmail account.** That is the `EMAIL_USER` in
  `.env`; it is only the *sender*. Each reminder still arrives in the inbox of the
  person who owns the task.

### Testing reminders without waiting an hour

Create a task whose reminder is only a minute away by using
`"reminderMinutes": 0` and a deadline one minute in the future:

```bash
curl -X POST http://localhost:5000/api/tasks \
  -H "Content-Type: application/json" \
  -H "Cookie: todo_token=<the cookie value>" \
  -d "{\"title\":\"Scheduler test\",\"deadline\":\"<now + 1 minute>\",\"reminderMinutes\":0}"
```

Within a minute the server log shows the attempt:

```
Reminder check at 2026-09-29T19:33:00: 1 task(s) due
Reminder email sent for task #3 to user@gmail.com
Reminder check finished: 1/1 email(s) sent
```

If something is wrong with Gmail, the same run shows the reason instead and the
task is retried next minute (`emailSent` stays `0`):

```
Failed to send reminder for task #3 (EAUTH): Invalid login: 535-5.7.8 ...
```

`SMTP_HOST`, `SMTP_PORT` and `SMTP_SECURE` can be set in `.env` if you want to
send through a different mail server. They default to
`smtp.gmail.com` / `465` / `true`, which is what Gmail needs.

---

## 11. How the React frontend connects

The backend already allows your dev frontend through CORS
(`CLIENT_URL=http://localhost:5173`) **with credentials**, so the login cookie is
accepted. Every `fetch` that talks to a protected route has to ask for it:

```js
const API = 'http://localhost:5000';

// register
await fetch(`${API}/api/auth/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify({ email: 'user@gmail.com', password: 'password123' }),
});

// login
await fetch(`${API}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify({ email: 'user@gmail.com', password: 'password123' }),
});

// who am I
const me = await (await fetch(`${API}/api/auth/me`, { credentials: 'include' })).json();

// logout
await fetch(`${API}/api/auth/logout`, { method: 'POST', credentials: 'include' });

// list my tasks
const tasks = await (await fetch(`${API}/api/tasks`, { credentials: 'include' })).json();

// create
await fetch(`${API}/api/tasks`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify({
    title: 'Submit frontend assignment',
    description: 'Finish the React assignment',
    deadline: '2026-09-30T18:00:00',
    reminderMinutes: 60,
  }),
});

// complete
await fetch(`${API}/api/tasks/1`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify({ completed: true }),
});

// delete
await fetch(`${API}/api/tasks/1`, { method: 'DELETE', credentials: 'include' });
```

There is no need to store the token yourself. The browser saves the HTTP-only
cookie and sends it back on every request, so `localStorage` stays empty and a
script (or an XSS bug) cannot read the token.

To get the `deadline` value from an `<input type="datetime-local">` (which gives
`2026-09-30T18:00`), just send it as-is — the backend accepts that exact format.
If you ever need a different origin, add it to `CLIENT_URL` separated by a comma,
for example `CLIENT_URL=http://localhost:5173,http://localhost:3000`.

---

## 12. Project layout

```
server/
├── src/
│   ├── config/
│   │   ├── auth.js             # JWT signing, cookie options, safe user object
│   │   └── db.js               # PostgreSQL pool, creates tables, camelCases rows
│   ├── middleware/auth.js      # requireAuth: reads + verifies the cookie
│   ├── services/
│   │   ├── emailService.js     # Gmail + Nodemailer, sendReminderEmail(task)
│   │   └── reminderService.js  # node-cron job, sends due reminders
│   ├── routes/
│   │   ├── authRoutes.js       # register / login / logout / me
│   │   └── taskRoutes.js       # CRUD endpoints, scoped to req.user.id
│   ├── utils/dateTime.js       # date parsing / reminderAt calculation
│   ├── app.js                  # Express app, CORS + credentials, error handling
│   └── server.js               # entry point: DB + HTTP + scheduler
├── data/todo.db                # created automatically on first run
├── .env                        # your secrets (gitignored)
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

## 13. Troubleshooting

| Problem                          | Fix                                                                    |
| -------------------------------- | ---------------------------------------------------------------------- |
| `EAUTH ... 535 Username and Password not accepted` | Wrong App Password, or 2-Step Verification is off. Regenerate the App Password and make sure there are no extra spaces. |
| `Reminder scheduler disabled`    | `EMAIL_USER` / `EMAIL_APP_PASSWORD` are empty in `.env`. Restart the server after editing `.env`. |
| `JWT_SECRET is not set` warning  | Add `JWT_SECRET` to `.env` and restart, otherwise everybody is logged out on every restart. |
| `401 You must be logged in`      | The browser is not sending the cookie. Use `credentials: 'include'` on the `fetch`, and check the frontend origin is in `CLIENT_URL`. |
| Tasks list is empty after logging in | That user has no tasks yet, or the tasks were created before accounts existed (those belong to nobody). |
| `Cannot log in after an old secret changed` | Changing `JWT_SECRET` signs everybody out. Log in again. |
| No email arrives                 | Check the server log, then the **Spam** folder. The recipient is the task owner's account address, but `EMAIL_USER` must be a working Gmail account. |
| `ECONNREFUSED` from the frontend| The backend is not running, or the port differs from `5000`. |
| Frontend blocked by CORS         | Add the frontend origin to `CLIENT_URL` in `.env` and restart the server. |
| `SQLITE_CANTOPEN`                | Make sure the `data` folder exists and is writable.                          |
