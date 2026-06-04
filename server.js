const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const SEED_PATH = path.join(__dirname, 'data', 'db.json');
const DB_PATH = process.env.VERCEL ? '/tmp/db.json' : SEED_PATH;

function ensureDB() {
  if (process.env.VERCEL && !fs.existsSync(DB_PATH)) {
    fs.copyFileSync(SEED_PATH, DB_PATH);
  }
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- DB helpers ---

function readDB() {
  ensureDB();
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// --- Rotation engine ---

function computeNextRotation(frequency, dayOfWeek, dayOfMonth, from) {
  const base = from ? new Date(from) : new Date();
  const next = new Date(base);
  if (frequency === 'daily') {
    next.setDate(next.getDate() + 1);
    next.setHours(0, 0, 0, 0);
  } else if (frequency === 'weekly') {
    const dow = dayOfWeek ?? 1; // 0=Sun, 1=Mon
    const current = next.getDay();
    const diff = (dow - current + 7) % 7 || 7;
    next.setDate(next.getDate() + diff);
    next.setHours(0, 0, 0, 0);
  } else if (frequency === 'monthly') {
    const dom = dayOfMonth ?? 1;
    next.setMonth(next.getMonth() + 1);
    next.setDate(dom);
    next.setHours(0, 0, 0, 0);
  }
  return next.toISOString();
}

function applyRotation(db) {
  const { rotation, spaces, users } = db;
  const order = rotation.order.filter(uid => users.find(u => u.id === uid));
  const count = rotation.rotationCount;

  db.assignments = [];
  for (let i = 0; i < order.length; i++) {
    const spaceIndex = (i + count) % spaces.length;
    if (spaces[spaceIndex]) {
      db.assignments.push({ userId: order[i], spaceId: spaces[spaceIndex].id });
    }
  }
  // spaces with no assigned user get no entry (vacant)
}

function triggerRotationIfDue(db) {
  const { rotation } = db;
  if (!rotation.nextRotation) return;
  if (new Date() >= new Date(rotation.nextRotation)) {
    rotation.lastRotation = new Date().toISOString();
    rotation.rotationCount = (rotation.rotationCount || 0) + 1;
    applyRotation(db);
    rotation.nextRotation = computeNextRotation(
      rotation.frequency,
      rotation.dayOfWeek,
      rotation.dayOfMonth,
      rotation.lastRotation
    );
  }
}

// --- Auth middleware ---

function requireAuth(req, res, next) {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  const db = readDB();
  const user = db.users.find(u => u.id === userId);
  if (!user) return res.status(401).json({ error: 'User not found' });
  req.user = user;
  req.db = db;
  next();
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// --- Auth routes ---

app.post('/api/auth/login', (req, res) => {
  const { name, pin } = req.body;
  if (!name || !pin) return res.status(400).json({ error: 'Name and PIN required' });
  const db = readDB();
  const user = db.users.find(
    u => u.name.toLowerCase() === name.toLowerCase() && u.pin === pin
  );
  if (!user) return res.status(401).json({ error: 'Invalid name or PIN' });
  res.json({ id: user.id, name: user.name, role: user.role });
});

// --- User routes ---

app.get('/api/me', requireAuth, (req, res) => {
  const db = req.db;
  triggerRotationIfDue(db);
  writeDB(db);

  const assignment = db.assignments.find(a => a.userId === req.user.id);
  const space = assignment ? db.spaces.find(s => s.id === assignment.spaceId) : null;
  const incoming = db.swapRequests.filter(
    r => r.targetId === req.user.id && r.status === 'pending'
  ).map(r => {
    const requester = db.users.find(u => u.id === r.requesterId);
    const theirSpace = db.spaces.find(s => s.id === r.requesterSpaceId);
    const yourSpace = db.spaces.find(s => s.id === r.targetSpaceId);
    return { ...r, requesterName: requester?.name, theirSpace, yourSpace };
  });
  const outgoing = db.swapRequests.filter(
    r => r.requesterId === req.user.id && r.status === 'pending'
  ).map(r => {
    const target = db.users.find(u => u.id === r.targetId);
    const theirSpace = db.spaces.find(s => s.id === r.targetSpaceId);
    return { ...r, targetName: target?.name, theirSpace };
  });

  res.json({
    user: { id: req.user.id, name: req.user.name, role: req.user.role },
    space,
    incoming,
    outgoing,
    nextRotation: db.rotation.nextRotation,
    lastRotation: db.rotation.lastRotation,
    rotationFrequency: db.rotation.frequency
  });
});

app.get('/api/users', requireAuth, (req, res) => {
  const db = req.db;
  const users = db.users.map(u => {
    const assignment = db.assignments.find(a => a.userId === u.id);
    const space = assignment ? db.spaces.find(s => s.id === assignment.spaceId) : null;
    return { id: u.id, name: u.name, role: u.role, space };
  });
  res.json(users);
});

// --- Swap routes ---

app.post('/api/swaps/request', requireAuth, (req, res) => {
  const { targetUserId } = req.body;
  if (!targetUserId) return res.status(400).json({ error: 'targetUserId required' });

  const db = req.db;
  const myAssignment = db.assignments.find(a => a.userId === req.user.id);
  const theirAssignment = db.assignments.find(a => a.userId === targetUserId);

  if (!myAssignment) return res.status(400).json({ error: 'You have no parking space assigned' });
  if (!theirAssignment) return res.status(400).json({ error: 'Target user has no parking space assigned' });
  if (req.user.id === targetUserId) return res.status(400).json({ error: 'Cannot swap with yourself' });

  const existing = db.swapRequests.find(
    r => r.status === 'pending' &&
      ((r.requesterId === req.user.id && r.targetId === targetUserId) ||
       (r.requesterId === targetUserId && r.targetId === req.user.id))
  );
  if (existing) return res.status(400).json({ error: 'A pending swap request already exists with this user' });

  const swap = {
    id: uuidv4(),
    requesterId: req.user.id,
    targetId: targetUserId,
    requesterSpaceId: myAssignment.spaceId,
    targetSpaceId: theirAssignment.spaceId,
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  db.swapRequests.push(swap);
  writeDB(db);
  res.json(swap);
});

app.post('/api/swaps/:id/accept', requireAuth, (req, res) => {
  const db = req.db;
  const swap = db.swapRequests.find(r => r.id === req.params.id);
  if (!swap) return res.status(404).json({ error: 'Swap request not found' });
  if (swap.targetId !== req.user.id) return res.status(403).json({ error: 'Not your swap request' });
  if (swap.status !== 'pending') return res.status(400).json({ error: 'Request already resolved' });

  // Execute the swap
  const reqAssignment = db.assignments.find(a => a.userId === swap.requesterId);
  const tgtAssignment = db.assignments.find(a => a.userId === swap.targetId);
  if (reqAssignment && tgtAssignment) {
    const tmp = reqAssignment.spaceId;
    reqAssignment.spaceId = tgtAssignment.spaceId;
    tgtAssignment.spaceId = tmp;
  }

  swap.status = 'accepted';
  swap.resolvedAt = new Date().toISOString();

  // Cancel any other pending swaps involving these two users' spaces
  db.swapRequests
    .filter(r => r.id !== swap.id && r.status === 'pending' &&
      (r.requesterId === swap.requesterId || r.requesterId === swap.targetId ||
       r.targetId === swap.requesterId || r.targetId === swap.targetId))
    .forEach(r => { r.status = 'cancelled'; r.resolvedAt = new Date().toISOString(); });

  writeDB(db);
  res.json({ success: true });
});

app.post('/api/swaps/:id/reject', requireAuth, (req, res) => {
  const db = req.db;
  const swap = db.swapRequests.find(r => r.id === req.params.id);
  if (!swap) return res.status(404).json({ error: 'Swap request not found' });
  if (swap.targetId !== req.user.id) return res.status(403).json({ error: 'Not your swap request' });
  if (swap.status !== 'pending') return res.status(400).json({ error: 'Request already resolved' });

  swap.status = 'rejected';
  swap.resolvedAt = new Date().toISOString();
  writeDB(db);
  res.json({ success: true });
});

app.post('/api/swaps/:id/cancel', requireAuth, (req, res) => {
  const db = req.db;
  const swap = db.swapRequests.find(r => r.id === req.params.id);
  if (!swap) return res.status(404).json({ error: 'Swap request not found' });
  if (swap.requesterId !== req.user.id) return res.status(403).json({ error: 'Not your swap request' });
  if (swap.status !== 'pending') return res.status(400).json({ error: 'Request already resolved' });

  swap.status = 'cancelled';
  swap.resolvedAt = new Date().toISOString();
  writeDB(db);
  res.json({ success: true });
});

// --- Admin routes ---

app.get('/api/admin/overview', requireAuth, requireAdmin, (req, res) => {
  const db = req.db;
  triggerRotationIfDue(db);
  writeDB(db);

  const users = db.users.map(u => {
    const assignment = db.assignments.find(a => a.userId === u.id);
    const space = assignment ? db.spaces.find(s => s.id === assignment.spaceId) : null;
    return { id: u.id, name: u.name, role: u.role, space };
  });
  const spaces = db.spaces.map(s => {
    const assignment = db.assignments.find(a => a.spaceId === s.id);
    const user = assignment ? db.users.find(u => u.id === assignment.userId) : null;
    return { ...s, assignedTo: user ? { id: user.id, name: user.name } : null };
  });
  res.json({ users, spaces, rotation: db.rotation, swapRequests: db.swapRequests });
});

app.post('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  const { name, pin, role } = req.body;
  if (!name || !pin) return res.status(400).json({ error: 'Name and PIN required' });
  const db = req.db;
  if (db.users.find(u => u.name.toLowerCase() === name.toLowerCase())) {
    return res.status(400).json({ error: 'User with that name already exists' });
  }
  const user = { id: uuidv4(), name, pin, role: role === 'admin' ? 'admin' : 'user' };
  db.users.push(user);
  if (!db.rotation.order.includes(user.id)) db.rotation.order.push(user.id);
  applyRotation(db);
  writeDB(db);
  res.json(user);
});

app.put('/api/admin/users/:id', requireAuth, requireAdmin, (req, res) => {
  const db = req.db;
  const user = db.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (req.body.name) user.name = req.body.name;
  if (req.body.pin) user.pin = req.body.pin;
  if (req.body.role) user.role = req.body.role === 'admin' ? 'admin' : 'user';
  writeDB(db);
  res.json(user);
});

app.delete('/api/admin/users/:id', requireAuth, requireAdmin, (req, res) => {
  const db = req.db;
  const idx = db.users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  db.users.splice(idx, 1);
  db.assignments = db.assignments.filter(a => a.userId !== req.params.id);
  db.rotation.order = db.rotation.order.filter(id => id !== req.params.id);
  db.swapRequests = db.swapRequests.filter(
    r => r.requesterId !== req.params.id && r.targetId !== req.params.id
  );
  applyRotation(db);
  writeDB(db);
  res.json({ success: true });
});

app.post('/api/admin/spaces', requireAuth, requireAdmin, (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Space name required' });
  const db = req.db;
  const space = { id: uuidv4(), name, description: description || '' };
  db.spaces.push(space);
  applyRotation(db);
  writeDB(db);
  res.json(space);
});

app.put('/api/admin/spaces/:id', requireAuth, requireAdmin, (req, res) => {
  const db = req.db;
  const space = db.spaces.find(s => s.id === req.params.id);
  if (!space) return res.status(404).json({ error: 'Space not found' });
  if (req.body.name) space.name = req.body.name;
  if (req.body.description !== undefined) space.description = req.body.description;
  writeDB(db);
  res.json(space);
});

app.delete('/api/admin/spaces/:id', requireAuth, requireAdmin, (req, res) => {
  const db = req.db;
  const idx = db.spaces.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Space not found' });
  db.spaces.splice(idx, 1);
  db.assignments = db.assignments.filter(a => a.spaceId !== req.params.id);
  db.swapRequests = db.swapRequests.filter(
    r => r.requesterSpaceId !== req.params.id && r.targetSpaceId !== req.params.id
  );
  applyRotation(db);
  writeDB(db);
  res.json({ success: true });
});

app.put('/api/admin/rotation', requireAuth, requireAdmin, (req, res) => {
  const { frequency, dayOfWeek, dayOfMonth, order, startNow } = req.body;
  const db = req.db;
  if (frequency) db.rotation.frequency = frequency;
  if (dayOfWeek !== undefined) db.rotation.dayOfWeek = parseInt(dayOfWeek);
  if (dayOfMonth !== undefined) db.rotation.dayOfMonth = parseInt(dayOfMonth);
  if (order) db.rotation.order = order;

  if (startNow || !db.rotation.nextRotation) {
    db.rotation.nextRotation = computeNextRotation(
      db.rotation.frequency,
      db.rotation.dayOfWeek,
      db.rotation.dayOfMonth,
      null
    );
  }
  applyRotation(db);
  writeDB(db);
  res.json(db.rotation);
});

app.post('/api/admin/rotation/trigger', requireAuth, requireAdmin, (req, res) => {
  const db = req.db;
  db.rotation.lastRotation = new Date().toISOString();
  db.rotation.rotationCount = (db.rotation.rotationCount || 0) + 1;
  applyRotation(db);
  db.rotation.nextRotation = computeNextRotation(
    db.rotation.frequency,
    db.rotation.dayOfWeek,
    db.rotation.dayOfMonth,
    db.rotation.lastRotation
  );
  writeDB(db);
  res.json({ success: true, assignments: db.assignments, rotation: db.rotation });
});

app.put('/api/admin/rotation/order', requireAuth, requireAdmin, (req, res) => {
  const { order } = req.body;
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array of user IDs' });
  const db = req.db;
  db.rotation.order = order;
  applyRotation(db);
  writeDB(db);
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Parking app running on http://localhost:${PORT}`));
