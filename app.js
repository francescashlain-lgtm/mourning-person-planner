import {
  signInWithGoogle,
  signOutUser,
  setAuthStateCallback,
  saveToCloud
} from './firebase-config.js';

// ── State ──
let ideas = [];
let events = [];
let crossPosts = [];
let collaborators = [];
let calendarDate = new Date(); // month currently shown

// ── Cloud sync ──
let saveTimer = null;

function scheduleCloudSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveToCloud({ ideas, events, crossPosts, collaborators });
  }, 1200);
}

window.onCloudDataReceived = function(data) {
  if (data.ideas) ideas = data.ideas;
  if (data.events) events = data.events;
  if (data.crossPosts) crossPosts = data.crossPosts;
  if (data.collaborators) collaborators = data.collaborators;
  renderAll();
};

// ── Auth ──
document.getElementById('login-btn').addEventListener('click', async () => {
  try { await signInWithGoogle(); } catch (e) { console.error(e); }
});

document.getElementById('sign-out-btn').addEventListener('click', async () => {
  await signOutUser();
  document.getElementById('app-content').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
});

setAuthStateCallback((user) => {
  if (user) {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-content').style.display = 'block';
    const avatar = document.getElementById('user-avatar');
    if (user.photoURL) avatar.src = user.photoURL;
  } else {
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('app-content').style.display = 'none';
  }
});

// ── Navigation ──
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`${tab}-tab`).classList.add('active');
    if (tab === 'calendar') renderCalendar();
    if (tab === 'trending') fetchReddit(currentSubreddit);
    if (tab === 'promote') renderPromote();
  });
});

// ── Ideas ──
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

const STATUSES = ['idea', 'drafting', 'ready', 'published'];
const typeLabel = { substack: 'Substack', tiktok: 'TikTok' };

function renderIdeas() {
  const typeFilter = document.getElementById('type-filter').value;
  const search = document.getElementById('search-ideas').value.toLowerCase();

  let filtered = [...ideas];
  if (typeFilter !== 'all') filtered = filtered.filter(i => (i.type || 'substack') === typeFilter);
  if (search) filtered = filtered.filter(i =>
    i.title.toLowerCase().includes(search) ||
    (i.notes || '').toLowerCase().includes(search)
  );

  // Update count chips
  const counts = { idea: 0, drafting: 0, ready: 0, published: 0 };
  ideas.forEach(i => { if (counts[i.status] !== undefined) counts[i.status]++; });
  document.getElementById('count-idea').textContent = `${counts.idea} just an idea`;
  document.getElementById('count-drafting').textContent = `${counts.drafting} drafting`;
  document.getElementById('count-ready').textContent = `${counts.ready} ready`;
  document.getElementById('count-published').textContent = `${counts.published} published`;

  // Render each column
  STATUSES.forEach(status => {
    const col = document.getElementById(`col-${status}`);
    const colIdeas = filtered
      .filter(i => i.status === status)
      .sort((a, b) => {
        if (a.publishDate && b.publishDate) return a.publishDate.localeCompare(b.publishDate);
        if (a.publishDate) return -1;
        if (b.publishDate) return 1;
        return b.createdAt - a.createdAt;
      });

    if (colIdeas.length === 0) {
      col.innerHTML = `<div class="kanban-empty">Drop ideas here</div>`;
    } else {
      col.innerHTML = colIdeas.map(idea => {
        const date = idea.publishDate ? `📅 ${formatDate(idea.publishDate)}` : '';
        const type = typeLabel[idea.type || 'substack'];
        const notes = idea.notes ? `<div class="idea-card-notes">${escapeHtml(idea.notes)}</div>` : '';
        const series = idea.series ? `<div class="idea-card-series">Part of: ${escapeHtml(idea.series)}</div>` : '';
        return `
        <div class="idea-card" data-id="${idea.id}" draggable="true">
          <div class="idea-card-type">${type}</div>
          <div class="idea-card-title">${escapeHtml(idea.title)}</div>
          ${series}
          ${notes}
          ${date ? `<div class="idea-card-meta">${date}</div>` : ''}
        </div>`;
      }).join('');
    }

    // Click to edit
    col.querySelectorAll('.idea-card').forEach(card => {
      card.addEventListener('click', () => openIdeaModal(card.dataset.id));
    });

    // Drag events on cards
    col.querySelectorAll('.idea-card').forEach(card => {
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', card.dataset.id);
        card.classList.add('dragging');
      });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
    });

    // Drop events on column
    col.addEventListener('dragover', (e) => {
      e.preventDefault();
      col.classList.add('drag-over');
    });
    col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
    col.addEventListener('drop', (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      const id = e.dataTransfer.getData('text/plain');
      const idx = ideas.findIndex(i => i.id === id);
      if (idx > -1 && ideas[idx].status !== status) {
        ideas[idx].status = status;
        scheduleCloudSave();
        renderIdeas();
        renderCalendar();
      }
    });
  });
}

function renderAll() {
  renderIdeas();
  renderCalendar();
  renderPromote();
}

// ── Idea Modal ──
let editingIdeaId = null;

document.getElementById('new-idea-btn').addEventListener('click', () => openIdeaModal(null));

function openIdeaModal(id) {
  editingIdeaId = id;
  const idea = id ? ideas.find(i => i.id === id) : null;
  const modal = document.getElementById('idea-modal');

  document.getElementById('modal-title').value = idea ? idea.title : '';
  document.getElementById('modal-type').value = idea ? (idea.type || 'substack') : 'substack';
  document.getElementById('modal-status').value = idea ? idea.status : 'idea';
  document.getElementById('modal-series').value = idea ? (idea.series || '') : '';
  document.getElementById('modal-date').value = idea ? (idea.publishDate || '') : '';
  document.getElementById('modal-notes').value = idea ? (idea.notes || '') : '';

  document.getElementById('modal-delete-btn').style.display = id ? 'inline-flex' : 'none';
  document.getElementById('modal-save-btn').textContent = id ? 'Save Changes' : 'Save Idea';

  modal.classList.add('active');
  setTimeout(() => document.getElementById('modal-title').focus(), 50);
}

function closeIdeaModal() {
  document.getElementById('idea-modal').classList.remove('active');
  editingIdeaId = null;
}

document.getElementById('modal-close-btn').addEventListener('click', closeIdeaModal);
document.getElementById('modal-cancel-btn').addEventListener('click', closeIdeaModal);
document.getElementById('idea-modal').addEventListener('click', (e) => {
  if (e.target.id === 'idea-modal') closeIdeaModal();
});

document.getElementById('modal-save-btn').addEventListener('click', () => {
  const title = document.getElementById('modal-title').value.trim();
  if (!title) { document.getElementById('modal-title').focus(); return; }

  const data = {
    title,
    type: document.getElementById('modal-type').value,
    status: document.getElementById('modal-status').value,
    series: document.getElementById('modal-series').value.trim(),
    publishDate: document.getElementById('modal-date').value,
    notes: document.getElementById('modal-notes').value.trim(),
  };

  if (editingIdeaId) {
    const idx = ideas.findIndex(i => i.id === editingIdeaId);
    if (idx > -1) ideas[idx] = { ...ideas[idx], ...data, updatedAt: Date.now() };
  } else {
    ideas.unshift({ id: generateId(), ...data, createdAt: Date.now() });
  }

  scheduleCloudSave();
  renderIdeas();
  renderCalendar();
  closeIdeaModal();
});

document.getElementById('modal-delete-btn').addEventListener('click', () => {
  if (!editingIdeaId) return;
  if (!confirm('Delete this idea?')) return;
  ideas = ideas.filter(i => i.id !== editingIdeaId);
  scheduleCloudSave();
  renderIdeas();
  renderCalendar();
  closeIdeaModal();
});

// ── Filters ──
document.getElementById('type-filter').addEventListener('change', renderIdeas);
document.getElementById('search-ideas').addEventListener('input', renderIdeas);

// ── Calendar ──
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function renderCalendar() {
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  document.getElementById('cal-month-title').textContent = `${MONTHS[month]} ${year}`;

  const grid = document.getElementById('calendar-grid');
  const today = new Date();

  // Day headers
  let html = DAYS.map(d => `<div class="cal-day-header">${d}</div>`).join('');

  // First day of month, last day
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrev = new Date(year, month, 0).getDate();

  // Prev month overflow
  for (let i = firstDay - 1; i >= 0; i--) {
    const d = daysInPrev - i;
    html += `<div class="cal-day other-month"><div class="cal-day-num">${d}</div></div>`;
  }

  // Current month
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isToday = d === today.getDate() && month === today.getMonth() && year === today.getFullYear();
    const dayIdeas = ideas.filter(i => i.publishDate === dateStr);
    const dayEvents = events.filter(e => e.date === dateStr);
    const chips = [
      ...dayIdeas.map(i => `<div class="cal-event status-${i.status}" data-id="${i.id}" data-type="idea">${escapeHtml(i.title)}</div>`),
      ...dayEvents.map(e => `<div class="cal-event cal-event-promote" data-id="${e.id}" data-type="promote">📅 ${escapeHtml(e.title)}</div>`)
    ].join('');
    html += `
      <div class="cal-day${isToday ? ' today' : ''}" data-date="${dateStr}">
        <div class="cal-day-num">${d}</div>
        ${chips}
      </div>`;
  }

  // Next month fill
  const totalCells = firstDay + daysInMonth;
  const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
  for (let d = 1; d <= remaining; d++) {
    html += `<div class="cal-day other-month"><div class="cal-day-num">${d}</div></div>`;
  }

  grid.innerHTML = html;

  // Click on a day to assign
  grid.querySelectorAll('.cal-day:not(.other-month)').forEach(day => {
    day.addEventListener('click', (e) => {
      const eventEl = e.target.closest('.cal-event');
      if (eventEl) {
        if (eventEl.dataset.type === 'promote') openPromoteModal('events', eventEl.dataset.id);
        else openIdeaModal(eventEl.dataset.id);
        return;
      }
      openCalModal(day.dataset.date);
    });
  });

  // Upcoming list
  renderUpcoming();
}

function renderUpcoming() {
  const list = document.getElementById('cal-upcoming-list');
  const today = new Date().toISOString().slice(0, 10);

  const upcomingIdeas = ideas
    .filter(i => i.publishDate && i.publishDate >= today)
    .map(i => ({ id: i.id, date: i.publishDate, title: i.title, type: 'idea', status: i.status }));

  const upcomingEvents = events
    .filter(e => e.date && e.date >= today)
    .map(e => ({ id: e.id, date: e.date, title: e.title, type: 'event', status: e.status }));

  const upcoming = [...upcomingIdeas, ...upcomingEvents]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 10);

  if (upcoming.length === 0) {
    list.innerHTML = `<p class="upcoming-empty">No upcoming scheduled posts or events.</p>`;
    return;
  }

  list.innerHTML = upcoming.map(item => `
    <div class="upcoming-item" data-id="${item.id}" data-type="${item.type}">
      <div class="upcoming-date">${formatDate(item.date)}</div>
      <div class="upcoming-title">${item.type === 'event' ? '📅 ' : ''}${escapeHtml(item.title)}</div>
      <span class="promote-status-badge ${item.type === 'event' ? 'status-idea' : `badge-${item.status}`}" style="font-size:0.6rem">${item.status}</span>
    </div>`
  ).join('');

  list.querySelectorAll('.upcoming-item').forEach(item => {
    item.addEventListener('click', () => {
      if (item.dataset.type === 'event') openPromoteModal('events', item.dataset.id);
      else openIdeaModal(item.dataset.id);
    });
  });
}

// Calendar nav
document.getElementById('cal-prev').addEventListener('click', () => {
  calendarDate.setMonth(calendarDate.getMonth() - 1);
  renderCalendar();
});
document.getElementById('cal-next').addEventListener('click', () => {
  calendarDate.setMonth(calendarDate.getMonth() + 1);
  renderCalendar();
});
document.getElementById('cal-today-btn').addEventListener('click', () => {
  calendarDate = new Date();
  renderCalendar();
});

// Calendar assign modal
let calModalDate = null;

function openCalModal(dateStr) {
  calModalDate = dateStr;
  document.getElementById('cal-modal-date-title').textContent = formatDate(dateStr);

  const select = document.getElementById('cal-modal-idea-select');
  const unscheduled = ideas.filter(i => !i.publishDate || i.publishDate === dateStr);

  select.innerHTML = `<option value="">— choose an idea —</option>` +
    unscheduled.map(i => `<option value="${i.id}" ${i.publishDate === dateStr ? 'selected' : ''}>${escapeHtml(i.title)}</option>`).join('') +
    (unscheduled.length === 0 ? `<option disabled>All ideas are already scheduled</option>` : '');

  document.getElementById('cal-modal').classList.add('active');
}

function closeCalModal() {
  document.getElementById('cal-modal').classList.remove('active');
  calModalDate = null;
}

document.getElementById('cal-modal-close').addEventListener('click', closeCalModal);
document.getElementById('cal-modal-cancel').addEventListener('click', closeCalModal);
document.getElementById('cal-modal').addEventListener('click', (e) => {
  if (e.target.id === 'cal-modal') closeCalModal();
});

document.getElementById('cal-modal-assign').addEventListener('click', () => {
  const selectedId = document.getElementById('cal-modal-idea-select').value;
  if (!selectedId) { closeCalModal(); return; }
  const idx = ideas.findIndex(i => i.id === selectedId);
  if (idx > -1) {
    ideas[idx].publishDate = calModalDate;
    scheduleCloudSave();
    renderCalendar();
    renderIdeas();
  }
  closeCalModal();
});

// ── Reddit ──
let currentSubreddit = 'GriefSupport';

async function fetchReddit(sub) {
  const container = document.getElementById('reddit-posts');
  container.innerHTML = `<div class="reddit-loading">Loading r/${sub}...</div>`;
  try {
    const res = await fetch(`https://www.reddit.com/r/${sub}/hot.json?limit=9&raw_json=1`, {
      headers: { 'Accept': 'application/json' }
    });
    if (!res.ok) throw new Error('Failed to fetch');
    const data = await res.json();
    const posts = data.data.children.map(c => c.data).filter(p => !p.stickied);
    renderRedditPosts(posts);
  } catch (e) {
    container.innerHTML = `<div class="reddit-error">Could not load posts. <a href="https://www.reddit.com/r/${sub}/hot/" target="_blank">Open Reddit directly ↗</a></div>`;
  }
}

function renderRedditPosts(posts) {
  const container = document.getElementById('reddit-posts');
  if (!posts.length) {
    container.innerHTML = `<div class="reddit-error">No posts found.</div>`;
    return;
  }
  container.innerHTML = posts.map(p => {
    const age = timeAgo(p.created_utc);
    const flair = p.link_flair_text ? `<span class="reddit-flair">${escapeHtml(p.link_flair_text)}</span>` : '';
    return `
    <a class="reddit-card" href="https://www.reddit.com${p.permalink}" target="_blank">
      ${flair}
      <div class="reddit-card-title">${escapeHtml(p.title)}</div>
      <div class="reddit-card-meta">
        <span>▲ ${p.score.toLocaleString()}</span>
        <span>💬 ${p.num_comments.toLocaleString()}</span>
        <span>${age}</span>
      </div>
    </a>`;
  }).join('');
}

function timeAgo(utc) {
  const diff = Math.floor(Date.now() / 1000) - utc;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

document.querySelectorAll('.subreddit-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.subreddit-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentSubreddit = btn.dataset.sub;
    fetchReddit(currentSubreddit);
  });
});

document.getElementById('reddit-refresh').addEventListener('click', () => {
  fetchReddit(currentSubreddit);
});

// ── Promote ──

const promoteConfig = {
  events: {
    titlePlaceholder: 'Event idea',
    statuses: ['Idea', 'Planned', 'Done'],
    showDate: true,
    showUrl: false,
  },
  crossPosts: {
    titlePlaceholder: 'Writer / Publication name',
    statuses: ['Wishlist', 'Reached Out', 'Confirmed'],
    showDate: false,
    showUrl: true,
  },
  collaborators: {
    titlePlaceholder: 'Person\'s name',
    statuses: ['Dream List', 'Reached Out', 'Confirmed'],
    showDate: false,
    showUrl: false,
  },
};

const promoteData = () => ({ events, crossPosts, collaborators });

function getPromoteList(section) {
  if (section === 'events') return events;
  if (section === 'crossPosts') return crossPosts;
  if (section === 'collaborators') return collaborators;
}

function setPromoteList(section, list) {
  if (section === 'events') events = list;
  else if (section === 'crossPosts') crossPosts = list;
  else if (section === 'collaborators') collaborators = list;
}

const statusColors = {
  'Idea': 'status-idea', 'Planned': 'status-drafting', 'Done': 'status-done',
  'Wishlist': 'status-idea', 'Reached Out': 'status-drafting', 'Confirmed': 'status-done',
  'Dream List': 'status-idea',
};

function renderPromote() {
  ['events', 'crossPosts', 'collaborators'].forEach(section => {
    const list = getPromoteList(section);
    const container = document.getElementById(`promote-list-${section}`);
    if (!list.length) {
      container.innerHTML = `<div class="promote-empty">Nothing added yet.</div>`;
      return;
    }
    container.innerHTML = list.map(item => {
      const colorClass = statusColors[item.status] || 'status-idea';
      const url = item.url ? `<a class="promote-card-url" href="${item.url}" target="_blank">${item.url}</a>` : '';
      const date = item.date ? `<span>📅 ${formatDate(item.date)}</span>` : '';
      const notes = item.notes ? `<div class="promote-card-notes">${escapeHtml(item.notes)}</div>` : '';
      return `
      <div class="promote-card" data-id="${item.id}" data-section="${section}">
        <div class="promote-card-top">
          <div class="promote-card-title">${escapeHtml(item.title)}</div>
          <span class="promote-status-badge ${colorClass}">${item.status}</span>
        </div>
        ${url}
        ${notes}
        ${date ? `<div class="promote-card-meta">${date}</div>` : ''}
      </div>`;
    }).join('');

    container.querySelectorAll('.promote-card').forEach(card => {
      card.addEventListener('click', () => openPromoteModal(card.dataset.section, card.dataset.id));
    });
  });
}

// ── Promote Modal ──
let editingPromoteSection = null;
let editingPromoteId = null;

function openPromoteModal(section, id = null) {
  editingPromoteSection = section;
  editingPromoteId = id;
  const cfg = promoteConfig[section];
  const list = getPromoteList(section);
  const item = id ? list.find(i => i.id === id) : null;

  document.getElementById('promote-modal-title').placeholder = cfg.titlePlaceholder;
  document.getElementById('promote-modal-title').value = item ? item.title : '';
  document.getElementById('promote-modal-notes').value = item ? (item.notes || '') : '';
  document.getElementById('promote-modal-date').value = item ? (item.date || '') : '';
  document.getElementById('promote-modal-url').value = item ? (item.url || '') : '';

  // Status options
  const statusSel = document.getElementById('promote-modal-status');
  statusSel.innerHTML = cfg.statuses.map(s => `<option value="${s}">${s}</option>`).join('');
  statusSel.value = item ? item.status : cfg.statuses[0];

  // Show/hide optional fields
  document.getElementById('promote-modal-date-wrap').style.display = cfg.showDate ? '' : 'none';
  document.getElementById('promote-modal-url-wrap').style.display = cfg.showUrl ? '' : 'none';

  document.getElementById('promote-modal-save').textContent = id ? 'Save Changes' : 'Save';
  document.getElementById('promote-modal-delete').style.display = id ? 'inline-flex' : 'none';

  document.getElementById('promote-modal').classList.add('active');
  setTimeout(() => document.getElementById('promote-modal-title').focus(), 50);
}

function closePromoteModal() {
  document.getElementById('promote-modal').classList.remove('active');
  editingPromoteSection = null;
  editingPromoteId = null;
}

document.getElementById('promote-modal-close').addEventListener('click', closePromoteModal);
document.getElementById('promote-modal-cancel').addEventListener('click', closePromoteModal);
document.getElementById('promote-modal').addEventListener('click', e => {
  if (e.target.id === 'promote-modal') closePromoteModal();
});

document.getElementById('promote-modal-save').addEventListener('click', () => {
  const title = document.getElementById('promote-modal-title').value.trim();
  if (!title) { document.getElementById('promote-modal-title').focus(); return; }

  const data = {
    title,
    status: document.getElementById('promote-modal-status').value,
    notes: document.getElementById('promote-modal-notes').value.trim(),
    date: document.getElementById('promote-modal-date').value,
    url: document.getElementById('promote-modal-url').value.trim(),
  };

  const list = getPromoteList(editingPromoteSection);
  if (editingPromoteId) {
    const idx = list.findIndex(i => i.id === editingPromoteId);
    if (idx > -1) list[idx] = { ...list[idx], ...data };
  } else {
    list.unshift({ id: generateId(), ...data, createdAt: Date.now() });
  }
  setPromoteList(editingPromoteSection, list);
  scheduleCloudSave();
  renderPromote();
  if (editingPromoteSection === 'events') renderCalendar();
  closePromoteModal();
});

document.getElementById('promote-modal-delete').addEventListener('click', () => {
  if (!editingPromoteId) return;
  if (!confirm('Delete this item?')) return;
  const list = getPromoteList(editingPromoteSection).filter(i => i.id !== editingPromoteId);
  setPromoteList(editingPromoteSection, list);
  scheduleCloudSave();
  renderPromote();
  if (editingPromoteSection === 'events') renderCalendar();
  closePromoteModal();
});

document.querySelectorAll('[data-promote-add]').forEach(btn => {
  btn.addEventListener('click', () => openPromoteModal(btn.dataset.promoteAdd));
});

function showSaved(id) {
  const el = document.getElementById(id);
  el.textContent = 'Saved';
  setTimeout(() => { el.textContent = ''; }, 2000);
}

// ── Helpers ──
function formatDate(str) {
  if (!str) return '';
  const [y, m, d] = str.split('-');
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Init ──
renderAll();
