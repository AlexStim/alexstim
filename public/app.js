// ── State ──────────────────────────────────────────────────
let currentUser = null;
let pinValue = '';
let editingUserId = null;
let editingSpaceId = null;
let dragSrcIdx = null;
let adminData = null;

// ── API ────────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
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
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

// ── Pages ──────────────────────────────────────────────────
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}
function openModal(id) {
  document.getElementById(id).classList.add('open');
}

// ── PIN keypad ─────────────────────────────────────────────
function updatePinDots() {
  for (let i = 0; i < 4; i++) {
    document.getElementById('dot-' + i).classList.toggle('filled', i < pinValue.length);
  }
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
      showPage('user');
      loadUserDashboard();
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

// ── User Dashboard ─────────────────────────────────────────
async function loadUserDashboard() {
  const main = document.getElementById('user-main');
  main.innerHTML = '<div class="empty">Loading...</div>';
  try {
    const data = await api('GET', '/me');
    renderUserDashboard(data);
  } catch (e) {
    main.innerHTML = `<div class="empty">${e.message}</div>`;
  }
}

function renderUserDashboard(data) {
  const { user, space, incoming, outgoing, nextRotation, lastRotation, rotationFrequency } = data;
  const main = document.getElementById('user-main');

  const nextDate = nextRotation ? new Date(nextRotation).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : 'Not set';
  const lastDate = lastRotation ? new Date(lastRotation).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : 'Never';

  const spaceHTML = space
    ? `<div class="space-hero">
        <div class="label">Your parking space</div>
        <div class="space-name">${esc(space.name)}</div>
        ${space.description ? `<div class="space-desc">${esc(space.description)}</div>` : ''}
       </div>`
    : `<div class="no-space">
        <div style="font-size:2rem;margin-bottom:8px">🚫</div>
        <div style="font-weight:600;margin-bottom:4px">No space assigned</div>
        <div style="font-size:.875rem">You are not currently assigned a parking space.</div>
       </div>`;

  const incomingHTML = incoming.length
    ? incoming.map(r => `
      <div class="swap-item">
        <div class="swap-info">
          <div style="font-weight:600">${esc(r.requesterName)} wants to swap</div>
          <div style="font-size:.8rem;color:var(--text-muted)">
            Their space: <strong>${r.theirSpace ? esc(r.theirSpace.name) : 'none'}</strong>
            &nbsp;↔&nbsp;
            Your space: <strong>${r.yourSpace ? esc(r.yourSpace.name) : 'none'}</strong>
          </div>
        </div>
        <div class="swap-actions">
          <button class="btn btn-success btn-sm" onclick="respondSwap('${r.id}','accept')">Accept</button>
          <button class="btn btn-danger btn-sm" onclick="respondSwap('${r.id}','reject')">Decline</button>
        </div>
      </div>`).join('')
    : '<div class="empty">No incoming requests</div>';

  const outgoingHTML = outgoing.length
    ? outgoing.map(r => `
      <div class="swap-item">
        <div class="swap-info">
          <div style="font-weight:600">Swap requested with ${esc(r.targetName)}</div>
          <div style="font-size:.8rem;color:var(--text-muted)">
            For their space: <strong>${r.theirSpace ? esc(r.theirSpace.name) : 'none'}</strong>
            &nbsp;·&nbsp; <span class="badge badge-pending">Pending</span>
          </div>
        </div>
        <div class="swap-actions">
          <button class="btn btn-ghost btn-sm" onclick="cancelSwap('${r.id}')">Cancel</button>
        </div>
      </div>`).join('')
    : '<div class="empty">No outgoing requests</div>';

  main.innerHTML = `
    <div style="margin-bottom:8px;font-size:.95rem;color:var(--text-muted)">
      Welcome back, <strong style="color:var(--text)">${esc(user.name)}</strong>
    </div>

    ${spaceHTML}

    <div class="rotation-bar">
      <div class="item">
        <span class="lbl">Schedule</span>
        <span class="val">${capitalise(rotationFrequency)}</span>
      </div>
      <div class="item">
        <span class="lbl">Next rotation</span>
        <span class="val">${nextDate}</span>
      </div>
      <div class="item">
        <span class="lbl">Last rotation</span>
        <span class="val">${lastDate}</span>
      </div>
      ${space ? `<button class="btn btn-primary btn-sm" style="margin-left:auto" onclick="openSwapModal()">↔ Request Swap</button>` : ''}
    </div>

    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title">Incoming Swap Requests</div>
          <div class="card-subtitle">Requests from other users to swap spaces with you</div>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="loadUserDashboard()">↺ Refresh</button>
      </div>
      <div id="incoming-list">${incomingHTML}</div>
    </div>

    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title">Your Sent Requests</div>
          <div class="card-subtitle">Swap requests you've sent to others</div>
        </div>
      </div>
      <div id="outgoing-list">${outgoingHTML}</div>
    </div>
  `;

  // Store user list for swap modal
  window._userDashData = data;
}

async function openSwapModal() {
  try {
    const users = await api('GET', '/users');
    const sel = document.getElementById('swap-target-select');
    sel.innerHTML = '';
    const others = users.filter(u => u.id !== currentUser.id && u.space);
    if (!others.length) {
      toast('No other users have an assigned space to swap with', 'error');
      return;
    }
    others.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.id;
      opt.textContent = `${u.name}  →  Space ${u.space.name}`;
      sel.appendChild(opt);
    });
    openModal('modal-swap');
  } catch (e) {
    toast(e.message, 'error');
  }
}

document.getElementById('btn-confirm-swap').addEventListener('click', async () => {
  const targetUserId = document.getElementById('swap-target-select').value;
  try {
    await api('POST', '/swaps/request', { targetUserId });
    closeModal('modal-swap');
    toast('Swap request sent!', 'success');
    loadUserDashboard();
  } catch (e) {
    toast(e.message, 'error');
  }
});

async function respondSwap(id, action) {
  try {
    await api('POST', `/swaps/${id}/${action}`);
    toast(action === 'accept' ? 'Swap accepted!' : 'Request declined', action === 'accept' ? 'success' : 'info');
    loadUserDashboard();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function cancelSwap(id) {
  try {
    await api('POST', `/swaps/${id}/cancel`);
    toast('Request cancelled', 'info');
    loadUserDashboard();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ── Admin ──────────────────────────────────────────────────
function showAdminTab(tab) {
  document.querySelectorAll('.admin-tab').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.nav-tab[id^="admin-tab-"]').forEach(btn => btn.classList.remove('active'));
  document.getElementById('admin-' + tab).style.display = 'block';
  document.getElementById('admin-tab-' + tab).classList.add('active');
  if (tab === 'overview') loadAdminOverview();
  else if (tab === 'rotation') loadAdminRotation();
  else if (tab === 'users') loadAdminUsers();
  else if (tab === 'spaces') loadAdminSpaces();
}

async function loadAdminOverview() {
  const el = document.getElementById('admin-overview');
  el.innerHTML = '<div class="empty">Loading...</div>';
  try {
    adminData = await api('GET', '/admin/overview');
    renderAdminOverview(adminData);
  } catch (e) {
    el.innerHTML = `<div class="empty">${e.message}</div>`;
  }
}

function renderAdminOverview(data) {
  const { users, spaces, rotation, swapRequests } = data;
  const el = document.getElementById('admin-overview');
  const pending = swapRequests.filter(r => r.status === 'pending');
  const nextDate = rotation.nextRotation
    ? new Date(rotation.nextRotation).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    : 'Not set';

  const assignedCount = spaces.filter(s => s.assignedTo).length;

  el.innerHTML = `
    <div class="grid-2">
      <div class="card">
        <div class="card-title" style="margin-bottom:4px">Spaces</div>
        <div style="font-size:2rem;font-weight:800">${assignedCount}/${spaces.length}</div>
        <div style="color:var(--text-muted);font-size:.8rem">assigned</div>
      </div>
      <div class="card">
        <div class="card-title" style="margin-bottom:4px">Next Rotation</div>
        <div style="font-size:1.2rem;font-weight:700">${nextDate}</div>
        <div style="color:var(--text-muted);font-size:.8rem">${capitalise(rotation.frequency)}</div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title">Current Assignments</div>
          <div class="card-subtitle">Rotation #${rotation.rotationCount}</div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="triggerRotation()">↺ Rotate Now</button>
      </div>
      <div class="user-list">
        ${users.map(u => `
          <div class="user-item">
            <div class="avatar">${esc(u.name[0].toUpperCase())}</div>
            <div class="info">
              <div class="name">${esc(u.name)} ${u.role === 'admin' ? '<span class="badge badge-admin">admin</span>' : ''}</div>
              <div class="meta">
                ${u.space
                  ? `<span class="badge badge-space">Space ${esc(u.space.name)}</span>`
                  : `<span class="badge badge-none">No space</span>`}
              </div>
            </div>
          </div>`).join('')}
      </div>
    </div>

    ${pending.length ? `
    <div class="card">
      <div class="card-header">
        <div class="card-title">Pending Swap Requests</div>
      </div>
      ${pending.map(r => {
        const req = users.find(u => u.id === r.requesterId);
        const tgt = users.find(u => u.id === r.targetId);
        const rs = spaces.find(s => s.id === r.requesterSpaceId);
        const ts = spaces.find(s => s.id === r.targetSpaceId);
        return `<div class="swap-item">
          <div class="swap-info">
            <span style="font-weight:600">${req ? esc(req.name) : '?'}</span>
            <span style="color:var(--text-muted)"> wants </span>
            <span class="badge badge-space">${ts ? esc(ts.name) : '?'}</span>
            <span style="color:var(--text-muted)"> from </span>
            <span style="font-weight:600">${tgt ? esc(tgt.name) : '?'}</span>
            <span style="color:var(--text-muted)"> (offering </span>
            <span class="badge badge-space">${rs ? esc(rs.name) : '?'}</span><span style="color:var(--text-muted)">)</span>
          </div>
          <div style="font-size:.75rem;color:var(--text-muted)">${timeAgo(r.createdAt)}</div>
        </div>`;
      }).join('')}
    </div>` : ''}
  `;
}

async function triggerRotation() {
  if (!confirm('Rotate all parking assignments now?')) return;
  try {
    await api('POST', '/admin/rotation/trigger');
    toast('Rotation applied!', 'success');
    loadAdminOverview();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ── Admin: Rotation settings ───────────────────────────────
async function loadAdminRotation() {
  const el = document.getElementById('admin-rotation');
  el.innerHTML = '<div class="empty">Loading...</div>';
  try {
    const data = await api('GET', '/admin/overview');
    adminData = data;
    renderAdminRotation(data);
  } catch (e) {
    el.innerHTML = `<div class="empty">${e.message}</div>`;
  }
}

function renderAdminRotation(data) {
  const { rotation, users } = data;
  const el = document.getElementById('admin-rotation');
  const order = rotation.order.filter(uid => users.find(u => u.id === uid));

  el.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div class="card-title">Rotation Schedule</div>
      </div>
      <div class="field">
        <label>Frequency</label>
        <select id="rot-freq">
          <option value="daily" ${rotation.frequency==='daily'?'selected':''}>Daily</option>
          <option value="weekly" ${rotation.frequency==='weekly'?'selected':''}>Weekly</option>
          <option value="monthly" ${rotation.frequency==='monthly'?'selected':''}>Monthly</option>
        </select>
      </div>
      <div id="rot-extra"></div>
      <div style="display:flex;gap:10px;margin-top:4px">
        <button class="btn btn-primary" onclick="saveRotation()">Save Schedule</button>
        <button class="btn btn-ghost" onclick="triggerRotation()">↺ Rotate Now</button>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title">Rotation Order</div>
          <div class="card-subtitle">Drag to reorder. First user gets the first space on each cycle.</div>
        </div>
      </div>
      <div class="order-list" id="order-list">
        ${order.map((uid, i) => {
          const u = users.find(x => x.id === uid);
          return u ? `
          <div class="order-item" draggable="true" data-idx="${i}" data-uid="${uid}"
               ondragstart="dragStart(event,${i})"
               ondragover="dragOver(event)"
               ondrop="dropOrder(event,${i})"
               ondragleave="dragLeave(event)">
            <div class="order-num">${i+1}</div>
            <div style="font-weight:600">${esc(u.name)}</div>
            ${u.role==='admin'?'<span class="badge badge-admin">admin</span>':''}
            <span class="drag-handle">⋮⋮</span>
          </div>` : '';
        }).join('')}
      </div>
      <button class="btn btn-primary" style="margin-top:12px" onclick="saveOrder()">Save Order</button>
    </div>
  `;

  updateRotExtra();
  document.getElementById('rot-freq').addEventListener('change', updateRotExtra);
}

function updateRotExtra() {
  const freq = document.getElementById('rot-freq').value;
  const el = document.getElementById('rot-extra');
  const data = adminData?.rotation || {};
  if (freq === 'weekly') {
    const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    el.innerHTML = `<div class="field"><label>Day of week</label>
      <select id="rot-dow">${days.map((d,i)=>`<option value="${i}" ${data.dayOfWeek===i?'selected':''}>${d}</option>`).join('')}</select></div>`;
  } else if (freq === 'monthly') {
    const doms = Array.from({length:28}, (_,i)=>i+1);
    el.innerHTML = `<div class="field"><label>Day of month</label>
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
  } catch (e) {
    toast(e.message, 'error');
  }
}

// drag-drop order
let dragOrder = null;

function dragStart(e, idx) {
  dragOrder = idx;
  e.dataTransfer.effectAllowed = 'move';
}
function dragOver(e) {
  e.preventDefault();
  e.currentTarget.classList.add('drag-over');
}
function dragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}
function dropOrder(e, idx) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  if (dragOrder === null || dragOrder === idx) return;
  const data = adminData;
  const order = data.rotation.order.filter(uid => data.users.find(u => u.id === uid));
  const [moved] = order.splice(dragOrder, 1);
  order.splice(idx, 0, moved);
  data.rotation.order = order;
  dragOrder = null;
  renderAdminRotation(data);
}

async function saveOrder() {
  const items = document.querySelectorAll('#order-list .order-item');
  const order = [...items].map(el => el.dataset.uid);
  try {
    await api('PUT', '/admin/rotation/order', { order });
    toast('Order saved!', 'success');
    loadAdminRotation();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ── Admin: Users ───────────────────────────────────────────
async function loadAdminUsers() {
  const el = document.getElementById('admin-users');
  el.innerHTML = '<div class="empty">Loading...</div>';
  try {
    const data = await api('GET', '/admin/overview');
    adminData = data;
    renderAdminUsers(data.users);
  } catch (e) {
    el.innerHTML = `<div class="empty">${e.message}</div>`;
  }
}

function renderAdminUsers(users) {
  const el = document.getElementById('admin-users');
  el.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div class="card-title">Users (${users.length})</div>
        <button class="btn btn-primary btn-sm" onclick="openAddUser()">+ Add User</button>
      </div>
      <div class="user-list">
        ${users.map(u => `
          <div class="user-item">
            <div class="avatar">${esc(u.name[0].toUpperCase())}</div>
            <div class="info">
              <div class="name">
                ${esc(u.name)}
                ${u.role==='admin' ? '<span class="badge badge-admin">admin</span>' : ''}
              </div>
              <div class="meta">
                ${u.space
                  ? `<span class="badge badge-space">Space ${esc(u.space.name)}</span>`
                  : '<span class="badge badge-none">No space</span>'}
              </div>
            </div>
            <div style="display:flex;gap:6px">
              <button class="btn btn-ghost btn-sm" onclick='openEditUser(${JSON.stringify(u)})'>Edit</button>
              <button class="btn btn-danger btn-sm" onclick="deleteUser('${u.id}','${esc(u.name)}')">Delete</button>
            </div>
          </div>`).join('')}
      </div>
    </div>
  `;
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
  const pin = document.getElementById('new-user-pin').value.trim();
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
      if (!body.pin) { toast('PIN required', 'error'); return; }
      await api('POST', '/admin/users', body);
      toast('User added', 'success');
    }
    closeModal('modal-add-user');
    loadAdminUsers();
  } catch (e) {
    toast(e.message, 'error');
  }
});

async function deleteUser(id, name) {
  if (!confirm(`Delete user "${name}"? This will remove their assignment.`)) return;
  try {
    await api('DELETE', `/admin/users/${id}`);
    toast('User deleted', 'success');
    loadAdminUsers();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ── Admin: Spaces ──────────────────────────────────────────
async function loadAdminSpaces() {
  const el = document.getElementById('admin-spaces');
  el.innerHTML = '<div class="empty">Loading...</div>';
  try {
    const data = await api('GET', '/admin/overview');
    adminData = data;
    renderAdminSpaces(data.spaces);
  } catch (e) {
    el.innerHTML = `<div class="empty">${e.message}</div>`;
  }
}

function renderAdminSpaces(spaces) {
  const el = document.getElementById('admin-spaces');
  el.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div class="card-title">Spaces (${spaces.length})</div>
        <button class="btn btn-primary btn-sm" onclick="openAddSpace()">+ Add Space</button>
      </div>
      <div class="space-list">
        ${spaces.map(s => `
          <div class="space-item">
            <div style="width:40px;height:40px;border-radius:var(--radius-sm);background:var(--accent);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:.9rem;flex-shrink:0">
              ${esc(s.name.slice(0,2).toUpperCase())}
            </div>
            <div class="info" style="flex:1;min-width:0">
              <div style="font-weight:600">${esc(s.name)}</div>
              <div style="font-size:.8rem;color:var(--text-muted)">${s.description || 'No description'}</div>
              <div style="margin-top:4px">
                ${s.assignedTo
                  ? `<span class="badge badge-space">→ ${esc(s.assignedTo.name)}</span>`
                  : '<span class="badge badge-none">Vacant</span>'}
              </div>
            </div>
            <div style="display:flex;gap:6px">
              <button class="btn btn-ghost btn-sm" onclick='openEditSpace(${JSON.stringify(s)})'>Edit</button>
              <button class="btn btn-danger btn-sm" onclick="deleteSpace('${s.id}','${esc(s.name)}')">Delete</button>
            </div>
          </div>`).join('')}
      </div>
    </div>
  `;
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
  } catch (e) {
    toast(e.message, 'error');
  }
});

async function deleteSpace(id, name) {
  if (!confirm(`Delete space "${name}"? This will remove its current assignment.`)) return;
  try {
    await api('DELETE', `/admin/spaces/${id}`);
    toast('Space deleted', 'success');
    loadAdminSpaces();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ── Utilities ──────────────────────────────────────────────
function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function capitalise(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

function ordinal(n) {
  const s = ['th','st','nd','rd'];
  const v = n % 100;
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

// close modals on overlay click
document.querySelectorAll('.modal-overlay').forEach(el => {
  el.addEventListener('click', e => {
    if (e.target === el) el.classList.remove('open');
  });
});
