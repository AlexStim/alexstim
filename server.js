require('dotenv').config();
const express = require('express');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { createClient } = require('@supabase/supabase-js');

const app = express();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  { auth: { persistSession: false } }
);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Rotation helpers ──────────────────────────────────────────

function computeNextRotation(frequency, dayOfWeek, dayOfMonth, from) {
  const base = from ? new Date(from) : new Date();
  const next = new Date(base);
  if (frequency === 'daily') {
    next.setDate(next.getDate() + 1);
    next.setHours(0, 0, 0, 0);
  } else if (frequency === 'weekly') {
    const dow = dayOfWeek ?? 1;
    const diff = (dow - next.getDay() + 7) % 7 || 7;
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

async function getRotationOrder() {
  const { data } = await supabase.from('rotation_order').select('user_id').order('position');
  return (data || []).map(r => r.user_id);
}

async function getSpaces() {
  const { data } = await supabase.from('spaces').select('*').order('created_at');
  return data || [];
}

async function applyRotation(rotationCount, order, spaces) {
  await supabase.from('assignments').delete().not('user_id', 'is', null);
  const rows = [];
  for (let i = 0; i < order.length; i++) {
    const sp = spaces[(i + rotationCount) % spaces.length];
    if (sp) rows.push({ user_id: order[i], space_id: sp.id });
  }
  if (rows.length) await supabase.from('assignments').insert(rows);
}

async function checkAndRotate() {
  const { data: rot } = await supabase.from('rotation').select('*').eq('id', 1).single();
  if (!rot?.next_rotation) return;
  if (new Date() >= new Date(rot.next_rotation)) {
    const newCount = (rot.rotation_count || 0) + 1;
    const now = new Date().toISOString();
    const [order, spaces] = await Promise.all([getRotationOrder(), getSpaces()]);
    await applyRotation(newCount, order, spaces);
    await supabase.from('rotation').update({
      rotation_count: newCount,
      last_rotation: now,
      next_rotation: computeNextRotation(rot.frequency, rot.day_of_week, rot.day_of_month, now)
    }).eq('id', 1);
  }
}

// Normalise a rotation row to the camelCase shape the frontend expects
function fmtRotation(rot, order) {
  return {
    frequency: rot.frequency,
    dayOfWeek: rot.day_of_week,
    dayOfMonth: rot.day_of_month,
    nextRotation: rot.next_rotation,
    lastRotation: rot.last_rotation,
    rotationCount: rot.rotation_count,
    order: order || []
  };
}

// ── Auth middleware ───────────────────────────────────────────

async function requireAuth(req, res, next) {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  const { data: user } = await supabase.from('users').select('*').eq('id', userId).single();
  if (!user) return res.status(401).json({ error: 'User not found' });
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// ── Auth ──────────────────────────────────────────────────────

app.post('/api/auth/login', async (req, res) => {
  const { name, pin } = req.body;
  if (!name || !pin) return res.status(400).json({ error: 'Name and PIN required' });
  const { data: user } = await supabase
    .from('users').select('id, name, role')
    .ilike('name', name).eq('pin', pin).maybeSingle();
  if (!user) return res.status(401).json({ error: 'Invalid name or PIN' });
  res.json(user);
});

// ── User endpoints ────────────────────────────────────────────

app.get('/api/me', requireAuth, async (req, res) => {
  await checkAndRotate();

  const [
    { data: assignRow },
    { data: rot },
    { data: incoming },
    { data: outgoing }
  ] = await Promise.all([
    supabase.from('assignments').select('space_id').eq('user_id', req.user.id).maybeSingle(),
    supabase.from('rotation').select('*').eq('id', 1).single(),
    supabase.from('swap_requests').select('*').eq('target_id', req.user.id).eq('status', 'pending'),
    supabase.from('swap_requests').select('*').eq('requester_id', req.user.id).eq('status', 'pending')
  ]);

  let space = null;
  if (assignRow?.space_id) {
    const { data } = await supabase.from('spaces').select('*').eq('id', assignRow.space_id).single();
    space = data;
  }

  // Enrich incoming with user/space names
  const [{ data: allUsers }, { data: allSpaces }] = await Promise.all([
    supabase.from('users').select('id, name'),
    supabase.from('spaces').select('id, name, description')
  ]);
  const userMap = Object.fromEntries((allUsers || []).map(u => [u.id, u]));
  const spaceMap = Object.fromEntries((allSpaces || []).map(s => [s.id, s]));

  res.json({
    user: { id: req.user.id, name: req.user.name, role: req.user.role },
    space,
    incoming: (incoming || []).map(r => ({
      ...r,
      requesterId: r.requester_id, targetId: r.target_id,
      requesterName: userMap[r.requester_id]?.name,
      theirSpace: spaceMap[r.requester_space_id],
      yourSpace: spaceMap[r.target_space_id]
    })),
    outgoing: (outgoing || []).map(r => ({
      ...r,
      requesterId: r.requester_id, targetId: r.target_id,
      targetName: userMap[r.target_id]?.name,
      theirSpace: spaceMap[r.target_space_id]
    })),
    nextRotation: rot?.next_rotation,
    lastRotation: rot?.last_rotation,
    rotationFrequency: rot?.frequency
  });
});

app.get('/api/users', requireAuth, async (req, res) => {
  const [{ data: users }, { data: assignments }, { data: spaces }] = await Promise.all([
    supabase.from('users').select('id, name, role').order('created_at'),
    supabase.from('assignments').select('user_id, space_id'),
    supabase.from('spaces').select('*')
  ]);
  const assignMap = Object.fromEntries((assignments || []).map(a => [a.user_id, a.space_id]));
  const spaceMap  = Object.fromEntries((spaces || []).map(s => [s.id, s]));
  res.json((users || []).map(u => ({ ...u, space: spaceMap[assignMap[u.id]] || null })));
});

// ── Swaps ─────────────────────────────────────────────────────

app.post('/api/swaps/request', requireAuth, async (req, res) => {
  const { targetUserId } = req.body;
  if (!targetUserId) return res.status(400).json({ error: 'targetUserId required' });
  if (req.user.id === targetUserId) return res.status(400).json({ error: 'Cannot swap with yourself' });

  const [{ data: myAssign }, { data: theirAssign }] = await Promise.all([
    supabase.from('assignments').select('space_id').eq('user_id', req.user.id).maybeSingle(),
    supabase.from('assignments').select('space_id').eq('user_id', targetUserId).maybeSingle()
  ]);
  if (!myAssign)    return res.status(400).json({ error: 'You have no parking space assigned' });
  if (!theirAssign) return res.status(400).json({ error: 'Target user has no parking space assigned' });

  const { data: existing } = await supabase.from('swap_requests')
    .select('id').eq('status', 'pending')
    .or(`and(requester_id.eq.${req.user.id},target_id.eq.${targetUserId}),and(requester_id.eq.${targetUserId},target_id.eq.${req.user.id})`)
    .maybeSingle();
  if (existing) return res.status(400).json({ error: 'A pending swap request already exists with this user' });

  const { data: swap, error } = await supabase.from('swap_requests').insert({
    id: uuidv4(),
    requester_id: req.user.id,
    target_id: targetUserId,
    requester_space_id: myAssign.space_id,
    target_space_id: theirAssign.space_id,
    status: 'pending'
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(swap);
});

app.post('/api/swaps/:id/accept', requireAuth, async (req, res) => {
  const { data: swap } = await supabase.from('swap_requests').select('*').eq('id', req.params.id).single();
  if (!swap) return res.status(404).json({ error: 'Swap request not found' });
  if (swap.target_id !== req.user.id) return res.status(403).json({ error: 'Not your swap request' });
  if (swap.status !== 'pending') return res.status(400).json({ error: 'Request already resolved' });

  const now = new Date().toISOString();
  await Promise.all([
    supabase.from('assignments').update({ space_id: swap.target_space_id }).eq('user_id', swap.requester_id),
    supabase.from('assignments').update({ space_id: swap.requester_space_id }).eq('user_id', swap.target_id),
    supabase.from('swap_requests').update({ status: 'accepted', resolved_at: now }).eq('id', swap.id)
  ]);
  // Cancel other pending swaps involving either user
  await supabase.from('swap_requests')
    .update({ status: 'cancelled', resolved_at: now })
    .neq('id', swap.id).eq('status', 'pending')
    .or(`requester_id.eq.${swap.requester_id},requester_id.eq.${swap.target_id},target_id.eq.${swap.requester_id},target_id.eq.${swap.target_id}`);
  res.json({ success: true });
});

app.post('/api/swaps/:id/reject', requireAuth, async (req, res) => {
  const { data: swap } = await supabase.from('swap_requests').select('*').eq('id', req.params.id).single();
  if (!swap) return res.status(404).json({ error: 'Swap request not found' });
  if (swap.target_id !== req.user.id) return res.status(403).json({ error: 'Not your swap request' });
  if (swap.status !== 'pending') return res.status(400).json({ error: 'Request already resolved' });
  await supabase.from('swap_requests').update({ status: 'rejected', resolved_at: new Date().toISOString() }).eq('id', swap.id);
  res.json({ success: true });
});

app.post('/api/swaps/:id/cancel', requireAuth, async (req, res) => {
  const { data: swap } = await supabase.from('swap_requests').select('*').eq('id', req.params.id).single();
  if (!swap) return res.status(404).json({ error: 'Swap request not found' });
  if (swap.requester_id !== req.user.id) return res.status(403).json({ error: 'Not your swap request' });
  if (swap.status !== 'pending') return res.status(400).json({ error: 'Request already resolved' });
  await supabase.from('swap_requests').update({ status: 'cancelled', resolved_at: new Date().toISOString() }).eq('id', swap.id);
  res.json({ success: true });
});

// ── Admin ─────────────────────────────────────────────────────

app.get('/api/admin/overview', requireAuth, requireAdmin, async (req, res) => {
  await checkAndRotate();
  const [
    { data: users },
    { data: spaces },
    { data: assignments },
    { data: swapRequests },
    { data: rot },
    { data: rotOrder }
  ] = await Promise.all([
    supabase.from('users').select('id, name, role').order('created_at'),
    supabase.from('spaces').select('*').order('created_at'),
    supabase.from('assignments').select('*'),
    supabase.from('swap_requests').select('*').order('created_at', { ascending: false }),
    supabase.from('rotation').select('*').eq('id', 1).single(),
    supabase.from('rotation_order').select('user_id').order('position')
  ]);

  const assignByUser  = Object.fromEntries((assignments || []).map(a => [a.user_id, a.space_id]));
  const assignBySpace = Object.fromEntries((assignments || []).map(a => [a.space_id, a.user_id]));
  const spaceMap = Object.fromEntries((spaces || []).map(s => [s.id, s]));
  const userMap  = Object.fromEntries((users  || []).map(u => [u.id, u]));

  res.json({
    users: (users || []).map(u => ({ ...u, space: spaceMap[assignByUser[u.id]] || null })),
    spaces: (spaces || []).map(s => ({
      ...s,
      assignedTo: assignBySpace[s.id] ? { id: assignBySpace[s.id], name: userMap[assignBySpace[s.id]]?.name } : null
    })),
    assignments: assignments || [],
    swapRequests: (swapRequests || []).map(r => ({
      ...r,
      requesterId: r.requester_id, targetId: r.target_id,
      requesterSpaceId: r.requester_space_id, targetSpaceId: r.target_space_id,
      createdAt: r.created_at
    })),
    rotation: fmtRotation(rot || {}, (rotOrder || []).map(r => r.user_id))
  });
});

app.post('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  const { name, pin, role } = req.body;
  if (!name || !pin) return res.status(400).json({ error: 'Name and PIN required' });
  const { data: existing } = await supabase.from('users').select('id').ilike('name', name).maybeSingle();
  if (existing) return res.status(400).json({ error: 'User with that name already exists' });

  const user = { id: uuidv4(), name, pin, role: role === 'admin' ? 'admin' : 'user' };
  const { error } = await supabase.from('users').insert(user);
  if (error) return res.status(500).json({ error: error.message });

  // Append to rotation order
  const { data: last } = await supabase.from('rotation_order').select('position').order('position', { ascending: false }).limit(1).maybeSingle();
  await supabase.from('rotation_order').insert({ position: (last?.position ?? -1) + 1, user_id: user.id });

  const [order, spaces, { data: rot }] = await Promise.all([
    getRotationOrder(), getSpaces(),
    supabase.from('rotation').select('rotation_count').eq('id', 1).single()
  ]);
  await applyRotation(rot?.rotation_count || 0, order, spaces);
  res.json(user);
});

app.put('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const updates = {};
  if (req.body.name) updates.name = req.body.name;
  if (req.body.pin)  updates.pin  = req.body.pin;
  if (req.body.role) updates.role = req.body.role === 'admin' ? 'admin' : 'user';
  const { data, error } = await supabase.from('users').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  await supabase.from('rotation_order').delete().eq('user_id', req.params.id);
  const { error } = await supabase.from('users').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  const [order, spaces, { data: rot }] = await Promise.all([
    getRotationOrder(), getSpaces(),
    supabase.from('rotation').select('rotation_count').eq('id', 1).single()
  ]);
  await applyRotation(rot?.rotation_count || 0, order, spaces);
  res.json({ success: true });
});

app.post('/api/admin/spaces', requireAuth, requireAdmin, async (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Space name required' });
  const space = { id: uuidv4(), name, description: description || '' };
  const { error } = await supabase.from('spaces').insert(space);
  if (error) return res.status(500).json({ error: error.message });
  const [order, spaces, { data: rot }] = await Promise.all([
    getRotationOrder(), getSpaces(),
    supabase.from('rotation').select('rotation_count').eq('id', 1).single()
  ]);
  await applyRotation(rot?.rotation_count || 0, order, spaces);
  res.json(space);
});

app.put('/api/admin/spaces/:id', requireAuth, requireAdmin, async (req, res) => {
  const updates = {};
  if (req.body.name) updates.name = req.body.name;
  if (req.body.description !== undefined) updates.description = req.body.description;
  const { data, error } = await supabase.from('spaces').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete('/api/admin/spaces/:id', requireAuth, requireAdmin, async (req, res) => {
  const { error } = await supabase.from('spaces').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  const [order, spaces, { data: rot }] = await Promise.all([
    getRotationOrder(), getSpaces(),
    supabase.from('rotation').select('rotation_count').eq('id', 1).single()
  ]);
  await applyRotation(rot?.rotation_count || 0, order, spaces);
  res.json({ success: true });
});

app.put('/api/admin/rotation', requireAuth, requireAdmin, async (req, res) => {
  const { frequency, dayOfWeek, dayOfMonth, startNow } = req.body;
  const { data: current } = await supabase.from('rotation').select('*').eq('id', 1).single();
  const updates = {};
  if (frequency)             updates.frequency    = frequency;
  if (dayOfWeek !== undefined) updates.day_of_week = parseInt(dayOfWeek);
  if (dayOfMonth !== undefined) updates.day_of_month = parseInt(dayOfMonth);
  const merged = { ...current, ...updates };
  if (startNow || !current.next_rotation) {
    updates.next_rotation = computeNextRotation(merged.frequency, merged.day_of_week, merged.day_of_month, null);
  }
  await supabase.from('rotation').update(updates).eq('id', 1);
  const [order, spaces] = await Promise.all([getRotationOrder(), getSpaces()]);
  await applyRotation(merged.rotation_count || 0, order, spaces);
  const { data: rot } = await supabase.from('rotation').select('*').eq('id', 1).single();
  res.json(fmtRotation(rot, order));
});

app.post('/api/admin/rotation/trigger', requireAuth, requireAdmin, async (req, res) => {
  const [{ data: rot }, order, spaces] = await Promise.all([
    supabase.from('rotation').select('*').eq('id', 1).single(),
    getRotationOrder(), getSpaces()
  ]);
  const newCount = (rot?.rotation_count || 0) + 1;
  const now = new Date().toISOString();
  await applyRotation(newCount, order, spaces);
  const nextRotation = computeNextRotation(rot?.frequency, rot?.day_of_week, rot?.day_of_month, now);
  await supabase.from('rotation').update({ rotation_count: newCount, last_rotation: now, next_rotation: nextRotation }).eq('id', 1);
  const { data: assignments } = await supabase.from('assignments').select('*');
  res.json({ success: true, assignments, rotation: fmtRotation({ ...rot, rotation_count: newCount, last_rotation: now, next_rotation: nextRotation }, order) });
});

app.put('/api/admin/rotation/order', requireAuth, requireAdmin, async (req, res) => {
  const { order } = req.body;
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array of user IDs' });
  await supabase.from('rotation_order').delete().gte('position', 0);
  if (order.length) await supabase.from('rotation_order').insert(order.map((uid, i) => ({ position: i, user_id: uid })));
  const [spaces, { data: rot }] = await Promise.all([
    getSpaces(),
    supabase.from('rotation').select('rotation_count').eq('id', 1).single()
  ]);
  await applyRotation(rot?.rotation_count || 0, order, spaces);
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Parking app running on http://localhost:${PORT}`));
