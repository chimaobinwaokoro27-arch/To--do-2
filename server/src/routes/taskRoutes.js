import express from 'express';
import { query } from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import {
  nowLocalIsoString,
  parseDateInput,
  calculateReminderAt,
  toLocalIsoString,
} from '../utils/dateTime.js';

const router = express.Router();

// Every task request needs a logged-in user. The user id always comes from
// the JWT cookie, never from the request body.
router.use(requireAuth);

const MAX_REMINDER_MINUTES = 60 * 24 * 7; // 7 days

// Every query filters on user_id as well as the id, so another person's task
// simply does not exist as far as this request is concerned.

const SELECT_ALL_FOR_USER_SQL =
  'SELECT * FROM tasks WHERE user_id = $1 ORDER BY deadline ASC, id ASC';

const SELECT_OWNED_BY_ID_SQL = 'SELECT * FROM tasks WHERE id = $1 AND user_id = $2';

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
  }
}

/**
 * SQLite never complained about a non-numeric id ("abc" just matched nothing).
 * PostgreSQL would, so we accept it as "not found" to keep the same behaviour.
 */
function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function parseReminderMinutes(value) {
  if (value === undefined || value === null || value === '') return 60;

  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > MAX_REMINDER_MINUTES) {
    throw new ValidationError(
      `reminderMinutes must be a whole number between 0 and ${MAX_REMINDER_MINUTES}`
    );
  }
  return minutes;
}

function parseCompleted(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return 1;
  if (value === false || value === 0 || value === '0' || value === 'false') return 0;
  throw new ValidationError('completed must be true/false (or 1/0)');
}

/**
 * Reads the fields the user is allowed to change.
 * `userEmail` comes from the signed-in account, so nobody can send a reminder
 * to an address they do not own. `userId` and `emailSent` in the request body
 * are simply never looked at.
 */
function buildTaskValues(body, currentTask, userEmail) {
  const title = body.title !== undefined ? String(body.title).trim() : currentTask?.title;
  if (!title) throw new ValidationError('title is required');

  const description =
    body.description !== undefined ? String(body.description) : currentTask?.description || '';

  const deadlineInput = body.deadline !== undefined ? body.deadline : currentTask?.deadline;
  if (deadlineInput === undefined || deadlineInput === null || deadlineInput === '') {
    throw new ValidationError('deadline is required');
  }
  const deadlineDate = parseDateInput(deadlineInput);
  if (!deadlineDate) throw new ValidationError('deadline is not a valid date');
  const deadline = toLocalIsoString(deadlineDate);

  const reminderMinutes =
    body.reminderMinutes !== undefined
      ? parseReminderMinutes(body.reminderMinutes)
      : currentTask?.reminderMinutes ?? 60;

  const completed =
    body.completed !== undefined ? parseCompleted(body.completed) : currentTask?.completed ?? 0;

  return { title, description, deadline, reminderMinutes, completed, deadlineDate, userEmail };
}

// POST /api/tasks
router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    const { title, description, deadline, reminderMinutes, deadlineDate, userEmail } =
      buildTaskValues(body, null, req.user.email);

    const reminderAt = calculateReminderAt(deadlineDate, reminderMinutes);
    if (reminderAt <= nowLocalIsoString()) {
      throw new ValidationError(
        `The reminder time (${reminderAt}) is already in the past. ` +
          'Pick a later deadline or a smaller reminderMinutes value.'
      );
    }

    const createdAt = nowLocalIsoString();
    const inserted = await query(
      `INSERT INTO tasks
        (title, description, deadline, reminder_minutes, reminder_at, recipient_email,
         completed, email_sent, created_at, user_id)
       VALUES ($1, $2, $3, $4, $5, $6, 0, 0, $7, $8)
       RETURNING *`,
      [title, description, deadline, reminderMinutes, reminderAt, userEmail, createdAt, req.user.id]
    );

    res.status(201).json(inserted.rows[0]);
  } catch (error) {
    next(error);
  }
});

// GET /api/tasks
router.get('/', async (req, res, next) => {
  try {
    const result = await query(SELECT_ALL_FOR_USER_SQL, [req.user.id]);
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

// GET /api/tasks/:id
router.get('/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) return res.status(404).json({ error: 'Task not found' });

    // A task that belongs to somebody else is reported as "not found" instead
    // of "forbidden", so its existence is never revealed.
    const result = await query(SELECT_OWNED_BY_ID_SQL, [id, req.user.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Task not found' });
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

// PATCH /api/tasks/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) return res.status(404).json({ error: 'Task not found' });

    const current = await query(SELECT_OWNED_BY_ID_SQL, [id, req.user.id]);
    if (current.rows.length === 0) return res.status(404).json({ error: 'Task not found' });
    const currentTask = current.rows[0];

    const body = req.body || {};
    const values = buildTaskValues(body, currentTask, req.user.email);

    const deadlineChanged = body.deadline !== undefined;
    const reminderChanged = body.reminderMinutes !== undefined;
    const isReopened = currentTask.completed === 1 && values.completed === 0;

    let reminderAt = currentTask.reminderAt;

    if (deadlineChanged || reminderChanged) {
      reminderAt = calculateReminderAt(values.deadlineDate, values.reminderMinutes);

      if (reminderAt <= nowLocalIsoString() && !isReopened) {
        throw new ValidationError(
          `The new reminder time (${reminderAt}) is already in the past. ` +
            'Pick a later deadline or a smaller reminderMinutes value.'
        );
      }
    }

    if (isReopened && reminderAt <= nowLocalIsoString()) {
      // Reopening must not fire a stale reminder right away, so the task is
      // re-armed from "now" and the scheduler picks it up on its next run.
      reminderAt = nowLocalIsoString();
    }

    // email_sent is deliberately not in this UPDATE, so an update can never
    // hand a task a second reminder email.
    const updated = await query(
      `UPDATE tasks
       SET title = $1, description = $2, deadline = $3, reminder_minutes = $4,
           reminder_at = $5, recipient_email = $6, completed = $7
       WHERE id = $8 AND user_id = $9
       RETURNING *`,
      [
        values.title,
        values.description,
        values.deadline,
        values.reminderMinutes,
        reminderAt,
        values.userEmail,
        values.completed,
        currentTask.id,
        req.user.id,
      ]
    );

    res.json(updated.rows[0]);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/tasks/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) return res.status(404).json({ error: 'Task not found' });

    const result = await query('DELETE FROM tasks WHERE id = $1 AND user_id = $2', [
      id,
      req.user.id,
    ]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Task not found' });
    res.json({ message: 'Task deleted', id });
  } catch (error) {
    next(error);
  }
});

export { ValidationError };
export default router;