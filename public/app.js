// ── State ──────────────────────────────────────────────────
let currentUser = null;
let pinValue = '';
let editingUserId = null;
let editingSpaceId = null;
let dragOrder = null;
let adminData = null;

// ── API ────────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (currentUser) opts.headers['x-user-id'] = currentUser.id;
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch('/api' + path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ── Toast ──────────────────────────────────────────────────
let toastTimer;
function toast(msg, type = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = type + ' show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

// ── Pages / Modals ─────────────────────────────────────────
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
}
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
function openModal(id)  { document.getElementById(id).classList.add('open'); }

// ── PIN ────────────────────────────────────────────────────
function updatePinDots() {
  for (let i = 0; i < 4; i++)
    document.getElementById('dot-' + i).classList.toggle('filled', i < pinValue.length);
}

document.querySelectorAll('.pin-key[data-n]').forEach(btn => {
  btn.addEventListener('click', () => {
    if (pinValue.length < 4) {
      pinValue += btn.dataset.n;
      updatePinDots();
      if (pinValue.length === 4) attemptLogin();
    }
  });
});
document.getElementById('pin-del').addEventListener('click', () => {
  pinValue = pinValue.slice(0, -1);
  updatePinDots();
});

// ── Login ──────────────────────────────────────────────────
async function attemptLogin() {
  const name = document.getElementById('login-name').value.trim();
  if (!name) { toast('Please enter your name', 'error'); return; }
  if (pinValue.length < 4) { toast('Please enter your 4-digit PIN', 'error'); return; }
  try {
    const user = await api('POST', '/auth/login', { name, pin: pinValue });
    currentUser = user;
    if (user.role === 'admin') {
      showPage('admin');
      loadAdminOverview();
    } else {
      const initials = user.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
      document.getElementById('user-avatar').textContent = initials;
      document.getElementById('user-name-display').textContent = user.name;
      showPage('user');
      loadUserSpace();
    }
  } catch (e) {
    toast(e.message, 'error');
    pinValue = '';
    updatePinDots();
  }
}

document.getElementById('btn-login').addEventListener('click', attemptLogin);
document.getElementById('login-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('pin-grid').querySelector('[data-n="1"]').focus();
});

function logout() {
  currentUser = null;
  pinValue = '';
  updatePinDots();
  document.getElementById('login-name').value = '';
  showPage('login');
}
document.getElementById('user-logout-btn').addEventListener('click', logout);
document.getElementById('admin-logout-btn').addEventListener('click', logout);

// ── User: tab switching ────────────────────────────────────
function showUserTab(tab) {
  document.querySelectorAll('.user-tab').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.nav-item[id^="user-tab-"]').forEach(b => b.classList.remove('active'));
  document.getElementById('user-' + tab).style.display = 'block';
  document.getElementById('user-tab-' + tab).classList.add('active');
  if (tab === 'space') loadUserSpace();
  else if (tab === 'swaps') loadUserSwaps();
}

// ── User: My Space ─────────────────────────────────────────
async function loadUserSpace() {
  const el = document.getElementById('user-space');
  el.innerHTML = '<div class="empty-state"><div class="empty-text">Loading…</div></div>';
  try {
    const data = await api('GET', '/me');
    renderUserSpace(data);
  } catch (e) { el.innerHTML = `<div class="empty-state"><div class="empty-text">${e.message}</div></div>`; }
}

function renderUserSpace(data) {
  const { space, nextRotation, lastRotation, rotationFrequency } = data;
  const el = document.getElementById('user-space');
  const nextDate = nextRotation
    ? new Date(nextRotation).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : 'Not set';
  const lastDate = lastRotation
    ? new Date(lastRotation).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : 'Never';

  if (!space) {
    el.innerHTML = `
      <div class="page-header"><div>
        <div class="page-title">My Parking Space</div>
        <div class="page-sub">Your current assigned space</div>
      </div></div>
      <div class="page-body">
        <div class="empty-state">
          <div class="empty-icon">🅿</div>
          <div class="empty-text">No parking space assigned yet.</div>
        </div>
      </div>`;
    window._meData = data;
    return;
  }

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">My Parking Space</div>
        <div class="page-sub">Your current assignment · rotates ${capitalise(rotationFrequency || '—')}</div>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="loadUserSpace()">Refresh</button>
    </div>
    <div class="page-body">
      <div class="space-hero">
        <div class="space-hero-eyebrow">Assigned Space</div>
        <div class="space-hero-name">${esc(space.name)}</div>
        ${space.description ? `<div class="space-hero-desc">${esc(space.description)}</div>` : ''}
      </div>

      <div class="two-col">
        <div class="card">
          <div class="card-head"><div class="card-title">Rotation Info</div></div>
          <div class="info-rows">
            <div class="info-row">
              <span class="info-label">Schedule</span>
              <span class="info-val">${capitalise(rotationFrequency || '—')}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Next rotation</span>
              <span class="info-val">${nextDate}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Last rotation</span>
              <span class="info-val">${lastDate}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Status</span>
              <span class="badge badge-green">Assigned</span>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><div class="card-title">Actions</div></div>
          <div class="card-body">
            <p style="font-size:.82rem;color:var(--muted);margin-bottom:16px">Want to swap with a colleague? Send a request — they'll need to accept it first.</p>
            <button class="btn btn-primary" onclick="openSwapModal()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 16V4m0 0L3 8m4-4 4 4M17 8v12m0 0 4-4m-4 4-4-4"/></svg>
              Request Space Swap
            </button>
          </div>
        </div>
      </div>
    </div>`;
  window._meData = data;
}

// ── User: Swaps ────────────────────────────────────────────
async function loadUserSwaps() {
  const el = document.getElementById('user-swaps');
  el.innerHTML = '<div class="empty-state"><div class="empty-text">Loading…</div></div>';
  try {
    const data = await api('GET', '/me');
    renderUserSwaps(data);
  } catch (e) { el.innerHTML = `<div class="empty-state"><div class="empty-text">${e.message}</div></div>`; }
}

function renderUserSwaps(data) {
  const { space, incoming, outgoing } = data;
  const el = document.getElementById('user-swaps');

  const inRows = incoming.length
    ? incoming.map(r => `
      <tr>
        <td class="td-name">${esc(r.requesterName)}</td>
        <td>${r.theirSpace ? `<span class="badge badge-blue">${esc(r.theirSpace.name)}</span>` : '—'}</td>
        <td>${r.yourSpace ? `<span class="badge badge-blue">${esc(r.yourSpace.name)}</span>` : '—'}</td>
        <td style="color:var(--muted)">${timeAgo(r.createdAt)}</td>
        <td>
          <div style="display:flex;gap:6px">
            <button class="btn btn-primary btn-sm" onclick="respondSwap('${r.id}','accept')">Accept</button>
            <button class="btn btn-ghost btn-sm" onclick="respondSwap('${r.id}','reject')">Decline</button>
          </div>
        </td>
      </tr>`).join('')
    : `<tr><td colspan="5"><div class="empty-state" style="padding:28px"><div class="empty-text">No incoming requests</div></div></td></tr>`;

  const outRows = outgoing.length
    ? outgoing.map(r => `
      <tr>
        <td class="td-name">${esc(r.targetName)}</td>
        <td>${r.theirSpace ? `<span class="badge badge-blue">${esc(r.theirSpace.name)}</span>` : '—'}</td>
        <td><span class="badge badge-yellow">Pending</span></td>
        <td style="color:var(--muted)">${timeAgo(r.createdAt)}</td>
        <td>
          <button class="btn btn-ghost btn-sm" onclick="cancelSwap('${r.id}')">Cancel</button>
        </td>
      </tr>`).join('')
    : `<tr><td colspan="5"><div class="empty-state" style="padding:28px"><div class="empty-text">No outgoing requests</div></div></td></tr>`;

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Swap Requests</div>
        <div class="page-sub">Manage your parking space swap requests</div>
      </div>
      ${space ? `<button class="btn btn-primary" onclick="openSwapModal()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 16V4m0 0L3 8m4-4 4 4M17 8v12m0 0 4-4m-4 4-4-4"/></svg>
        Request Swap
      </button>` : ''}
    </div>
    <div class="page-body">
      <div class="card" style="margin-bottom:16px">
        <div class="card-head">
          <div>
            <div class="card-title">Incoming Requests</div>
            <div class="card-sub">${incoming.length} pending</div>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="loadUserSwaps()">Refresh</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>From</th><th>Their Space</th><th>Your Space</th><th>Sent</th><th></th></tr></thead>
            <tbody>${inRows}</tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <div>
            <div class="card-title">Sent Requests</div>
            <div class="card-sub">${outgoing.length} pending</div>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>To</th><th>Their Space</th><th>Status</th><th>Sent</th><th></th></tr></thead>
            <tbody>${outRows}</tbody>
          </table>
        </div>
      </div>
    </div>`;
}

async function openSwapModal() {
  try {
    const users = await api('GET', '/users');
    const sel = document.getElementById('swap-target-select');
    sel.innerHTML = '';
    const others = users.filter(u => u.id !== currentUser.id && u.space);
    if (!others.length) { toast('No other users have an assigned space to swap with', 'error'); return; }
    others.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.id;
      opt.textContent = `${u.name}  →  Space ${u.space.name}`;
      sel.appendChild(opt);
    });
    openModal('modal-swap');
  } catch (e) { toast(e.message, 'error'); }
}

document.getElementById('btn-confirm-swap').addEventListener('click', async () => {
  const targetUserId = document.getElementById('swap-target-select').value;
  try {
    await api('POST', '/swaps/request', { targetUserId });
    closeModal('modal-swap');
    toast('Swap request sent!', 'success');
    loadUserSwaps();
  } catch (e) { toast(e.message, 'error'); }
});

async function respondSwap(id, action) {
  try {
    await api('POST', `/swaps/${id}/${action}`);
    toast(action === 'accept' ? 'Swap accepted!' : 'Request declined', action === 'accept' ? 'success' : 'info');
    loadUserSwaps();
  } catch (e) { toast(e.message, 'error'); }
}

async function cancelSwap(id) {
  try {
    await api('POST', `/swaps/${id}/cancel`);
    toast('Request cancelled', 'info');
    loadUserSwaps();
  } catch (e) { toast(e.message, 'error'); }
}

// ── Admin: tab switching ────────────────────────────────────
function showAdminTab(tab) {
  document.querySelectorAll('.admin-tab').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.nav-item[id^="admin-tab-"]').forEach(b => b.classList.remove('active'));
  document.getElementById('admin-' + tab).style.display = 'block';
  document.getElementById('admin-tab-' + tab).classList.add('active');
  if (tab === 'overview') loadAdminOverview();
  else if (tab === 'rotation') loadAdminRotation();
  else if (tab === 'users') loadAdminUsers();
  else if (tab === 'spaces') loadAdminSpaces();
}

// ── Admin: Overview ────────────────────────────────────────
async function loadAdminOverview() {
  const el = document.getElementById('admin-overview');
  el.innerHTML = '<div class="empty-state"><div class="empty-text">Loading…</div></div>';
  try {
    adminData = await api('GET', '/admin/overview');
    renderAdminOverview(adminData);
  } catch (e) { el.innerHTML = `<div class="empty-state"><div class="empty-text">${e.message}</div></div>`; }
}

function renderAdminOverview(data) {
  const { users, spaces, rotation, swapRequests } = data;
  const el = document.getElementById('admin-overview');
  const pending = swapRequests.filter(r => r.status === 'pending');
  const assigned = spaces.filter(s => s.assignedTo).length;
  const nextDate = rotation.nextRotation
    ? new Date(rotation.nextRotation).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : 'Not scheduled';
  const lastDate = rotation.lastRotation
    ? new Date(rotation.lastRotation).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : 'Never';

  const assignRows = users.map(u => `
    <tr>
      <td class="td-name">${esc(u.name)}</td>
      <td>${u.role === 'admin' ? '<span class="badge badge-purple">Admin</span>' : '<span class="badge badge-gray">User</span>'}</td>
      <td>${u.space
        ? `<span class="badge badge-green">${esc(u.space.name)}</span>`
        : '<span class="badge badge-gray">Unassigned</span>'}</td>
      <td style="color:var(--muted)">${u.space ? esc(u.space.description || '—') : '—'}</td>
    </tr>`).join('');

  const pendingRows = pending.length
    ? pending.map(r => {
        const req = users.find(u => u.id === r.requesterId);
        const tgt = users.find(u => u.id === r.targetId);
        const rs  = spaces.find(s => s.id === r.requesterSpaceId);
        const ts  = spaces.find(s => s.id === r.targetSpaceId);
        return `<tr>
          <td class="td-name">${req ? esc(req.name) : '?'}</td>
          <td>${rs ? `<span class="badge badge-blue">${esc(rs.name)}</span>` : '—'}</td>
          <td style="color:var(--subtle);font-size:1rem">⇄</td>
          <td class="td-name">${tgt ? esc(tgt.name) : '?'}</td>
          <td>${ts ? `<span class="badge badge-blue">${esc(ts.name)}</span>` : '—'}</td>
          <td style="color:var(--muted)">${timeAgo(r.createdAt)}</td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="6"><div class="empty-state" style="padding:28px"><div class="empty-text">No pending swap requests</div></div></td></tr>`;

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Overview</div>
        <div class="page-sub">Parking assignments and system status</div>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="loadAdminOverview()">Refresh</button>
    </div>
    <div class="page-body">
      <div class="stats-row">
        <div class="stat"><div class="stat-label">Spaces</div><div class="stat-val">${spaces.length}</div></div>
        <div class="stat"><div class="stat-label">Assigned</div><div class="stat-val">${assigned}</div></div>
        <div class="stat"><div class="stat-label">Users</div><div class="stat-val">${users.length}</div></div>
        <div class="stat"><div class="stat-label">Pending Swaps</div><div class="stat-val">${pending.length}</div></div>
      </div>

      <div class="card" style="margin-bottom:16px">
        <div class="card-head">
          <div>
            <div class="card-title">Rotation Status</div>
            <div class="card-sub">${capitalise(rotation.frequency)} · Cycle #${rotation.rotationCount}</div>
          </div>
          <button class="btn btn-primary btn-sm" onclick="triggerRotation()">Rotate Now</button>
        </div>
        <div class="info-rows">
          <div class="info-row">
            <span class="info-label">Next rotation</span>
            <span class="info-val">${nextDate}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Last rotation</span>
            <span class="info-val">${lastDate}</span>
          </div>
        </div>
      </div>

      <div class="card" style="margin-bottom:16px">
        <div class="card-head">
          <div class="card-title">Current Assignments</div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Role</th><th>Space</th><th>Description</th></tr></thead>
            <tbody>${assignRows || `<tr><td colspan="4"><div class="empty-state" style="padding:28px"><div class="empty-text">No users found</div></div></td></tr>`}</tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <div>
            <div class="card-title">Pending Swap Requests</div>
            <div class="card-sub">${pending.length} awaiting response</div>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>From</th><th>Space</th><th></th><th>To</th><th>Space</th><th>Sent</th></tr></thead>
            <tbody>${pendingRows}</tbody>
          </table>
        </div>
      </div>
    </div>`;
}

async function triggerRotation() {
  if (!confirm('Apply rotation now? All assignments will be updated.')) return;
  try {
    await api('POST', '/admin/rotation/trigger');
    toast('Rotation applied!', 'success');
    loadAdminOverview();
  } catch (e) { toast(e.message, 'error'); }
}

// ── Admin: Rotation settings ────────────────────────────────
async function loadAdminRotation() {
  const el = document.getElementById('admin-rotation');
  el.innerHTML = '<div class="empty-state"><div class="empty-text">Loading…</div></div>';
  try {
    const data = await api('GET', '/admin/overview');
    adminData = data;
    renderAdminRotation(data);
  } catch (e) { el.innerHTML = `<div class="empty-state"><div class="empty-text">${e.message}</div></div>`; }
}

function renderAdminRotation(data) {
  const { rotation, users } = data;
  const el = document.getElementById('admin-rotation');
  const order = rotation.order.filter(uid => users.find(u => u.id === uid));

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Rotation</div>
        <div class="page-sub">Configure schedule and assignment order</div>
      </div>
    </div>
    <div class="page-body">
      <div class="two-col">
        <div class="card">
          <div class="card-head"><div class="card-title">Schedule</div></div>
          <div class="card-body">
            <div class="form-group">
              <label class="form-label">Frequency</label>
              <select id="rot-freq">
                <option value="daily"   ${rotation.frequency==='daily'  ?'selected':''}>Daily</option>
                <option value="weekly"  ${rotation.frequency==='weekly' ?'selected':''}>Weekly</option>
                <option value="monthly" ${rotation.frequency==='monthly'?'selected':''}>Monthly</option>
              </select>
            </div>
            <div id="rot-extra"></div>
            <div style="display:flex;gap:8px;margin-top:8px">
              <button class="btn btn-primary" onclick="saveRotation()">Save</button>
              <button class="btn btn-ghost" onclick="triggerRotation()">Rotate Now</button>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><div class="card-title">Rotation Order</div></div>
          <div class="card-body">
            <p style="font-size:.82rem;color:var(--muted);margin-bottom:14px">Drag to reorder. Position 1 gets the first space on each cycle.</p>
            <div class="order-list" id="order-list">
              ${order.map((uid, i) => {
                const u = users.find(x => x.id === uid);
                return u ? `
                <div class="order-item" draggable="true" data-idx="${i}" data-uid="${uid}"
                     ondragstart="dragStart(event,${i})"
                     ondragover="dragOver(event)"
                     ondrop="dropOrder(event,${i})"
                     ondragleave="dragLeave(event)">
                  <div class="order-pos">${i+1}</div>
                  <span>${esc(u.name)}</span>
                  ${u.role==='admin' ? '<span class="badge badge-purple" style="font-size:.65rem">admin</span>' : ''}
                  <span class="drag-handle">⋮⋮</span>
                </div>` : '';
              }).join('')}
            </div>
            <button class="btn btn-primary" style="margin-top:14px;width:100%" onclick="saveOrder()">Save Order</button>
          </div>
        </div>
      </div>
    </div>`;

  updateRotExtra();
  document.getElementById('rot-freq').addEventListener('change', updateRotExtra);
}

function updateRotExtra() {
  const freq = document.getElementById('rot-freq').value;
  const el = document.getElementById('rot-extra');
  const data = adminData?.rotation || {};
  if (freq === 'weekly') {
    const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    el.innerHTML = `<div class="form-group"><label class="form-label">Day of week</label>
      <select id="rot-dow">${days.map((d,i)=>`<option value="${i}" ${data.dayOfWeek===i?'selected':''}>${d}</option>`).join('')}</select></div>`;
  } else if (freq === 'monthly') {
    const doms = Array.from({length:28}, (_,i) => i+1);
    el.innerHTML = `<div class="form-group"><label class="form-label">Day of month</label>
      <select id="rot-dom">${doms.map(d=>`<option value="${d}" ${data.dayOfMonth===d?'selected':''}>${d}${ordinal(d)}</option>`).join('')}</select></div>`;
  } else {
    el.innerHTML = '';
  }
}

async function saveRotation() {
  const frequency = document.getElementById('rot-freq').value;
  const body = { frequency, startNow: true };
  const dow = document.getElementById('rot-dow');
  const dom = document.getElementById('rot-dom');
  if (dow) body.dayOfWeek = parseInt(dow.value);
  if (dom) body.dayOfMonth = parseInt(dom.value);
  try {
    await api('PUT', '/admin/rotation', body);
    toast('Schedule saved!', 'success');
    loadAdminRotation();
  } catch (e) { toast(e.message, 'error'); }
}

function dragStart(e, idx) { dragOrder = idx; e.dataTransfer.effectAllowed = 'move'; }
function dragOver(e) { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }
function dragLeave(e) { e.currentTarget.classList.remove('drag-over'); }
function dropOrder(e, idx) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  if (dragOrder === null || dragOrder === idx) return;
  const order = adminData.rotation.order.filter(uid => adminData.users.find(u => u.id === uid));
  const [moved] = order.splice(dragOrder, 1);
  order.splice(idx, 0, moved);
  adminData.rotation.order = order;
  dragOrder = null;
  renderAdminRotation(adminData);
}

async function saveOrder() {
  const items = document.querySelectorAll('#order-list .order-item');
  const order = [...items].map(el => el.dataset.uid);
  try {
    await api('PUT', '/admin/rotation/order', { order });
    toast('Order saved!', 'success');
    loadAdminRotation();
  } catch (e) { toast(e.message, 'error'); }
}

// ── Admin: Users ────────────────────────────────────────────
async function loadAdminUsers() {
  const el = document.getElementById('admin-users');
  el.innerHTML = '<div class="empty-state"><div class="empty-text">Loading…</div></div>';
  try {
    const data = await api('GET', '/admin/overview');
    adminData = data;
    renderAdminUsers(data.users);
  } catch (e) { el.innerHTML = `<div class="empty-state"><div class="empty-text">${e.message}</div></div>`; }
}

function renderAdminUsers(users) {
  const el = document.getElementById('admin-users');
  const rows = users.map(u => `
    <tr>
      <td class="td-name">${esc(u.name)}</td>
      <td>${u.role === 'admin' ? '<span class="badge badge-purple">Admin</span>' : '<span class="badge badge-gray">User</span>'}</td>
      <td>${u.space
        ? `<span class="badge badge-green">${esc(u.space.name)}</span>`
        : '<span class="badge badge-gray">Unassigned</span>'}</td>
      <td>
        <div style="display:flex;gap:6px">
          <button class="btn btn-ghost btn-sm" onclick='openEditUser(${JSON.stringify(u)})'>Edit</button>
          <button class="btn btn-danger btn-sm" onclick="deleteUser('${u.id}','${esc(u.name)}')">Delete</button>
        </div>
      </td>
    </tr>`).join('');

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Users</div>
        <div class="page-sub">${users.length} registered ${users.length === 1 ? 'user' : 'users'}</div>
      </div>
      <button class="btn btn-primary btn-sm" onclick="openAddUser()">+ Add User</button>
    </div>
    <div class="page-body">
      <div class="card">
        <div class="card-head"><div class="card-title">All Users</div></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Role</th><th>Space</th><th>Actions</th></tr></thead>
            <tbody>${rows || `<tr><td colspan="4"><div class="empty-state" style="padding:28px"><div class="empty-text">No users found</div></div></td></tr>`}</tbody>
          </table>
        </div>
      </div>
    </div>`;
}

function openAddUser() {
  editingUserId = null;
  document.getElementById('modal-user-title').textContent = 'Add User';
  document.getElementById('new-user-name').value = '';
  document.getElementById('new-user-pin').value = '';
  document.getElementById('new-user-role').value = 'user';
  document.getElementById('btn-save-user').textContent = 'Add User';
  openModal('modal-add-user');
}
function openEditUser(u) {
  editingUserId = u.id;
  document.getElementById('modal-user-title').textContent = 'Edit User';
  document.getElementById('new-user-name').value = u.name;
  document.getElementById('new-user-pin').value = '';
  document.getElementById('new-user-role').value = u.role;
  document.getElementById('btn-save-user').textContent = 'Save Changes';
  openModal('modal-add-user');
}

document.getElementById('btn-save-user').addEventListener('click', async () => {
  const name = document.getElementById('new-user-name').value.trim();
  const pin  = document.getElementById('new-user-pin').value.trim();
  const role = document.getElementById('new-user-role').value;
  if (!name) { toast('Name is required', 'error'); return; }
  if (!editingUserId && (!pin || pin.length < 4)) { toast('PIN must be 4 digits', 'error'); return; }
  try {
    const body = { name, role };
    if (pin) body.pin = pin.padStart(4, '0').slice(-4);
    if (editingUserId) {
      await api('PUT', `/admin/users/${editingUserId}`, body);
      toast('User updated', 'success');
    } else {
      await api('POST', '/admin/users', body);
      toast('User added', 'success');
    }
    closeModal('modal-add-user');
    loadAdminUsers();
  } catch (e) { toast(e.message, 'error'); }
});

async function deleteUser(id, name) {
  if (!confirm(`Delete user "${name}"? Their space will be unassigned.`)) return;
  try {
    await api('DELETE', `/admin/users/${id}`);
    toast('User deleted', 'success');
    loadAdminUsers();
  } catch (e) { toast(e.message, 'error'); }
}

// ── Admin: Spaces ────────────────────────────────────────────
async function loadAdminSpaces() {
  const el = document.getElementById('admin-spaces');
  el.innerHTML = '<div class="empty-state"><div class="empty-text">Loading…</div></div>';
  try {
    const data = await api('GET', '/admin/overview');
    adminData = data;
    renderAdminSpaces(data.spaces);
  } catch (e) { el.innerHTML = `<div class="empty-state"><div class="empty-text">${e.message}</div></div>`; }
}

function renderAdminSpaces(spaces) {
  const el = document.getElementById('admin-spaces');
  const rows = spaces.map(s => `
    <tr>
      <td class="td-name">${esc(s.name)}</td>
      <td style="color:var(--muted)">${esc(s.description || '—')}</td>
      <td>${s.assignedTo
        ? `<span class="td-name">${esc(s.assignedTo.name)}</span>`
        : '<span class="badge badge-gray">Vacant</span>'}</td>
      <td>
        <div style="display:flex;gap:6px">
          <button class="btn btn-ghost btn-sm" onclick='openEditSpace(${JSON.stringify(s)})'>Edit</button>
          <button class="btn btn-danger btn-sm" onclick="deleteSpace('${s.id}','${esc(s.name)}')">Delete</button>
        </div>
      </td>
    </tr>`).join('');

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Spaces</div>
        <div class="page-sub">${spaces.length} parking ${spaces.length === 1 ? 'space' : 'spaces'}</div>
      </div>
      <button class="btn btn-primary btn-sm" onclick="openAddSpace()">+ Add Space</button>
    </div>
    <div class="page-body">
      <div class="card">
        <div class="card-head"><div class="card-title">All Parking Spaces</div></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Space</th><th>Description</th><th>Assigned To</th><th>Actions</th></tr></thead>
            <tbody>${rows || `<tr><td colspan="4"><div class="empty-state" style="padding:28px"><div class="empty-text">No spaces yet</div></div></td></tr>`}</tbody>
          </table>
        </div>
      </div>
    </div>`;
}

function openAddSpace() {
  editingSpaceId = null;
  document.getElementById('modal-space-title').textContent = 'Add Parking Space';
  document.getElementById('new-space-name').value = '';
  document.getElementById('new-space-desc').value = '';
  document.getElementById('btn-save-space').textContent = 'Add Space';
  openModal('modal-add-space');
}
function openEditSpace(s) {
  editingSpaceId = s.id;
  document.getElementById('modal-space-title').textContent = 'Edit Space';
  document.getElementById('new-space-name').value = s.name;
  document.getElementById('new-space-desc').value = s.description || '';
  document.getElementById('btn-save-space').textContent = 'Save Changes';
  openModal('modal-add-space');
}

document.getElementById('btn-save-space').addEventListener('click', async () => {
  const name = document.getElementById('new-space-name').value.trim();
  const description = document.getElementById('new-space-desc').value.trim();
  if (!name) { toast('Space name is required', 'error'); return; }
  try {
    if (editingSpaceId) {
      await api('PUT', `/admin/spaces/${editingSpaceId}`, { name, description });
      toast('Space updated', 'success');
    } else {
      await api('POST', '/admin/spaces', { name, description });
      toast('Space added', 'success');
    }
    closeModal('modal-add-space');
    loadAdminSpaces();
  } catch (e) { toast(e.message, 'error'); }
});

async function deleteSpace(id, name) {
  if (!confirm(`Delete space "${name}"? Its assignment will be removed.`)) return;
  try {
    await api('DELETE', `/admin/spaces/${id}`);
    toast('Space deleted', 'success');
    loadAdminSpaces();
  } catch (e) { toast(e.message, 'error'); }
}

// ── Utilities ──────────────────────────────────────────────
function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function capitalise(s) { return s ? s[0].toUpperCase() + s.slice(1) : ''; }
function ordinal(n) {
  const s = ['th','st','nd','rd'], v = n % 100;
  return s[(v-20)%10] || s[v] || s[0];
}
function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs/24)}d ago`;
}

document.querySelectorAll('.modal-overlay').forEach(el => {
  el.addEventListener('click', e => { if (e.target === el) el.classList.remove('open'); });
});
