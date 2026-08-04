const express = require('express');
const db = require('../lib/db');
const { requireAdmin } = require('../lib/auth');

const router = express.Router();
router.use(requireAdmin);

const PROJECT_STATUSES = ['planning', 'in_progress', 'on_hold', 'completed'];
const TASK_STATUSES = ['todo', 'in_progress', 'done'];
const TASK_PRIORITIES = ['low', 'medium', 'high'];

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function serializeTask(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    assignee: row.assignee,
    priority: row.priority,
    status: row.status,
    dueDate: row.due_date,
    overdue: !!(row.due_date && row.due_date < todayStr() && row.status !== 'done'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeMilestone(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    dueDate: row.due_date,
    completed: !!row.completed,
    createdAt: row.created_at,
  };
}

function projectSummary(row) {
  const counts = db.prepare(`
    SELECT status, COUNT(*) AS n FROM tasks WHERE project_id = ? GROUP BY status
  `).all(row.id);
  const byStatus = { todo: 0, in_progress: 0, done: 0 };
  let total = 0;
  counts.forEach((c) => { byStatus[c.status] = c.n; total += c.n; });
  const overdue = db.prepare(`
    SELECT COUNT(*) AS n FROM tasks WHERE project_id = ? AND status != 'done' AND due_date IS NOT NULL AND due_date < ?
  `).get(row.id, todayStr()).n;

  return {
    id: row.id,
    name: row.name,
    client: row.client,
    description: row.description,
    status: row.status,
    startDate: row.start_date,
    endDate: row.end_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    taskCounts: { ...byStatus, total },
    progress: total === 0 ? 0 : Math.round((byStatus.done / total) * 100),
    overdueTasks: overdue,
  };
}

// GET /api/pm/projects
router.get('/projects', (req, res) => {
  const rows = db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all();
  res.json({ projects: rows.map(projectSummary) });
});

// POST /api/pm/projects
router.post('/projects', (req, res) => {
  const { name, client, description, startDate, endDate } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: '프로젝트 이름을 입력해주세요.' });

  const info = db.prepare(`
    INSERT INTO projects (name, client, description, start_date, end_date)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    String(name).trim(),
    client ? String(client).trim() : null,
    description ? String(description).trim() : null,
    startDate || null,
    endDate || null
  );
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(projectSummary(row));
});

// GET /api/pm/projects/:id
router.get('/projects/:id', (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });

  const tasks = db.prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at ASC').all(project.id);
  const milestones = db.prepare('SELECT * FROM milestones WHERE project_id = ? ORDER BY due_date ASC').all(project.id);

  res.json({
    ...projectSummary(project),
    tasks: tasks.map(serializeTask),
    milestones: milestones.map(serializeMilestone),
  });
});

// PATCH /api/pm/projects/:id
router.patch('/projects/:id', (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });

  const { name, client, description, status, startDate, endDate } = req.body || {};
  if (status !== undefined && !PROJECT_STATUSES.includes(status)) {
    return res.status(400).json({ error: '유효하지 않은 프로젝트 상태입니다.' });
  }

  const next = {
    name: name !== undefined ? String(name).trim() : project.name,
    client: client !== undefined ? (client ? String(client).trim() : null) : project.client,
    description: description !== undefined ? (description ? String(description).trim() : null) : project.description,
    status: status !== undefined ? status : project.status,
    start_date: startDate !== undefined ? (startDate || null) : project.start_date,
    end_date: endDate !== undefined ? (endDate || null) : project.end_date,
  };
  if (!next.name) return res.status(400).json({ error: '프로젝트 이름을 입력해주세요.' });

  db.prepare(`
    UPDATE projects SET name = ?, client = ?, description = ?, status = ?, start_date = ?, end_date = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(next.name, next.client, next.description, next.status, next.start_date, next.end_date, project.id);

  const updated = db.prepare('SELECT * FROM projects WHERE id = ?').get(project.id);
  res.json(projectSummary(updated));
});

// DELETE /api/pm/projects/:id
router.delete('/projects/:id', (req, res) => {
  const info = db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });
  res.status(204).end();
});

// POST /api/pm/projects/:id/tasks
router.post('/projects/:id/tasks', (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });

  const { title, description, assignee, priority, dueDate } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: '작업 제목을 입력해주세요.' });
  const p = priority && TASK_PRIORITIES.includes(priority) ? priority : 'medium';

  const info = db.prepare(`
    INSERT INTO tasks (project_id, title, description, assignee, priority, due_date)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    project.id,
    String(title).trim(),
    description ? String(description).trim() : null,
    assignee ? String(assignee).trim() : null,
    p,
    dueDate || null
  );
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(serializeTask(row));
});

// PATCH /api/pm/tasks/:id
router.patch('/tasks/:id', (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: '작업을 찾을 수 없습니다.' });

  const { title, description, assignee, priority, status, dueDate } = req.body || {};
  if (status !== undefined && !TASK_STATUSES.includes(status)) {
    return res.status(400).json({ error: '유효하지 않은 작업 상태입니다.' });
  }
  if (priority !== undefined && !TASK_PRIORITIES.includes(priority)) {
    return res.status(400).json({ error: '유효하지 않은 우선순위입니다.' });
  }

  const next = {
    title: title !== undefined ? String(title).trim() : task.title,
    description: description !== undefined ? (description ? String(description).trim() : null) : task.description,
    assignee: assignee !== undefined ? (assignee ? String(assignee).trim() : null) : task.assignee,
    priority: priority !== undefined ? priority : task.priority,
    status: status !== undefined ? status : task.status,
    due_date: dueDate !== undefined ? (dueDate || null) : task.due_date,
  };
  if (!next.title) return res.status(400).json({ error: '작업 제목을 입력해주세요.' });

  db.prepare(`
    UPDATE tasks SET title = ?, description = ?, assignee = ?, priority = ?, status = ?, due_date = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(next.title, next.description, next.assignee, next.priority, next.status, next.due_date, task.id);

  db.prepare(`UPDATE projects SET updated_at = datetime('now') WHERE id = ?`).run(task.project_id);

  const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id);
  res.json(serializeTask(updated));
});

// DELETE /api/pm/tasks/:id
router.delete('/tasks/:id', (req, res) => {
  const info = db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: '작업을 찾을 수 없습니다.' });
  res.status(204).end();
});

// POST /api/pm/projects/:id/milestones
router.post('/projects/:id/milestones', (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });

  const { title, dueDate } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: '마일스톤 제목을 입력해주세요.' });

  const info = db.prepare(`
    INSERT INTO milestones (project_id, title, due_date) VALUES (?, ?, ?)
  `).run(project.id, String(title).trim(), dueDate || null);
  const row = db.prepare('SELECT * FROM milestones WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(serializeMilestone(row));
});

// PATCH /api/pm/milestones/:id
router.patch('/milestones/:id', (req, res) => {
  const milestone = db.prepare('SELECT * FROM milestones WHERE id = ?').get(req.params.id);
  if (!milestone) return res.status(404).json({ error: '마일스톤을 찾을 수 없습니다.' });

  const { title, dueDate, completed } = req.body || {};
  const next = {
    title: title !== undefined ? String(title).trim() : milestone.title,
    due_date: dueDate !== undefined ? (dueDate || null) : milestone.due_date,
    completed: completed !== undefined ? (completed ? 1 : 0) : milestone.completed,
  };
  if (!next.title) return res.status(400).json({ error: '마일스톤 제목을 입력해주세요.' });

  db.prepare('UPDATE milestones SET title = ?, due_date = ?, completed = ? WHERE id = ?')
    .run(next.title, next.due_date, next.completed, milestone.id);

  const updated = db.prepare('SELECT * FROM milestones WHERE id = ?').get(milestone.id);
  res.json(serializeMilestone(updated));
});

// DELETE /api/pm/milestones/:id
router.delete('/milestones/:id', (req, res) => {
  const info = db.prepare('DELETE FROM milestones WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: '마일스톤을 찾을 수 없습니다.' });
  res.status(204).end();
});

module.exports = router;
