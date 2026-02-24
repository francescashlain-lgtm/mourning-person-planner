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
let merch = [];
let calendarDate = new Date(); // month currently shown

// ── Cloud sync ──
let saveTimer = null;

function scheduleCloudSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveToCloud({ ideas, events, crossPosts, collaborators, merch });
  }, 1200);
}

window.onCloudDataReceived = function(data) {
  if (data.ideas) ideas = data.ideas;
  if (data.events) events = data.events;
  if (data.crossPosts) crossPosts = data.crossPosts;
  if (data.collaborators) collaborators = data.collaborators;
  if (data.merch) merch = data.merch;
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
    if (tab === 'trending') { fetchReddit(currentSubreddit); fetchArticles(currentArticleSource); }
    if (tab === 'promote') renderPromote();
    if (tab === 'merch') renderMerch();
  });
});

// ── Ideas ──
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

const STATUSES = ['idea', 'drafting', 'ready', 'published'];
const typeLabel = { substack: 'Substack', tiktok: 'TikTok' };

function renderIdeas() {
  const search = document.getElementById('search-ideas').value.toLowerCase();

  // Update count chips per board type
  const counts = {
    substack: { idea: 0, drafting: 0, ready: 0, published: 0 },
    tiktok:   { idea: 0, drafting: 0, ready: 0, published: 0 },
  };
  ideas.forEach(i => {
    const t = i.type || 'substack';
    if (counts[t] && counts[t][i.status] !== undefined) counts[t][i.status]++;
  });
  ['substack', 'tiktok'].forEach(type => {
    document.getElementById(`count-${type}-idea`).textContent = `${counts[type].idea} just an idea`;
    document.getElementById(`count-${type}-drafting`).textContent = `${counts[type].drafting} drafting`;
    document.getElementById(`count-${type}-ready`).textContent = `${counts[type].ready} ready`;
    document.getElementById(`count-${type}-published`).textContent = `${counts[type].published} published`;
  });

  // Render each board
  ['substack', 'tiktok'].forEach(type => {
    let filtered = ideas.filter(i => (i.type || 'substack') === type);
    if (search) filtered = filtered.filter(i =>
      i.title.toLowerCase().includes(search) ||
      (i.notes || '').toLowerCase().includes(search)
    );

    STATUSES.forEach(status => {
      const col = document.getElementById(`col-${type}-${status}`);
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
          const notes = idea.notes ? `<div class="idea-card-notes">${escapeHtml(idea.notes)}</div>` : '';
          const pillar = idea.pillar ? `<div class="idea-card-series">${escapeHtml(idea.pillar)}</div>` : '';
          const format = idea.format ? `<span class="idea-card-format">${escapeHtml(idea.format)}</span>` : '';
          return `
          <div class="idea-card" data-id="${idea.id}" draggable="true">
            ${format}
            <div class="idea-card-title">${escapeHtml(idea.title)}</div>
            ${pillar}
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
  });
}

function renderAll() {
  renderIdeas();
  renderCalendar();
  renderPromote();
  renderMerch();
}

// ── Idea Modal ──
let editingIdeaId = null;

document.getElementById('new-idea-btn').addEventListener('click', () => openIdeaModal(null));

function openIdeaModal(id, prefill = null) {
  editingIdeaId = id;
  const idea = id ? ideas.find(i => i.id === id) : null;
  const modal = document.getElementById('idea-modal');

  document.getElementById('modal-title').value = prefill?.title || (idea ? idea.title : '');
  document.getElementById('modal-type').value = prefill?.type || (idea ? (idea.type || 'substack') : 'substack');
  document.getElementById('modal-status').value = idea ? idea.status : 'idea';
  document.getElementById('modal-pillar').value = prefill?.pillar || (idea ? (idea.pillar || '') : '');
  document.getElementById('modal-date').value = idea ? (idea.publishDate || '') : '';
  document.getElementById('modal-notes').value = idea ? (idea.notes || '') : '';
  setModalFormat(idea ? (idea.format || null) : null);
  updateFormatVisibility();

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

  const type = document.getElementById('modal-type').value;
  const data = {
    title,
    type,
    status: document.getElementById('modal-status').value,
    pillar: document.getElementById('modal-pillar').value,
    publishDate: document.getElementById('modal-date').value,
    notes: document.getElementById('modal-notes').value.trim(),
    format: type === 'tiktok' ? (document.querySelector('.format-pill.active')?.dataset.format || null) : null,
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

// ── TikTok format pills ──
function updateFormatVisibility() {
  const isTikTok = document.getElementById('modal-type').value === 'tiktok';
  document.getElementById('modal-format-wrap').style.display = isTikTok ? '' : 'none';
}

function setModalFormat(format) {
  document.querySelectorAll('.format-pill').forEach(pill => {
    pill.classList.toggle('active', pill.dataset.format === format);
  });
}

document.getElementById('modal-type').addEventListener('change', () => {
  updateFormatVisibility();
  setModalFormat(null);
});

document.querySelectorAll('.format-pill').forEach(pill => {
  pill.addEventListener('click', () => {
    const already = pill.classList.contains('active');
    setModalFormat(null);
    if (!already) pill.classList.add('active');
  });
});

// ── Filters ──
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

// ── Articles ──
function stripHtml(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  return (div.textContent || div.innerText || '').trim();
}

const ARTICLE_SOURCES = {
  whatsyourgrief: {
    label: "What's Your Grief",
    fetch: async () => {
      const rssUrl = encodeURIComponent('https://whatsyourgrief.com/feed/');
      const res = await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${rssUrl}`);
      if (!res.ok) throw new Error('Feed error');
      const data = await res.json();
      if (data.status !== 'ok') throw new Error('Feed unavailable');
      return data.items.map(item => ({
        title: item.title,
        url: item.link,
        date: item.pubDate,
        description: stripHtml(item.description || '').slice(0, 220),
        section: null,
        source: "What's Your Grief",
      }));
    },
  },
  modernloss: {
    label: 'Modern Loss',
    fetch: async () => {
      const rssUrl = encodeURIComponent('https://modernloss.com/feed/');
      const res = await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${rssUrl}`);
      if (!res.ok) throw new Error('Feed error');
      const data = await res.json();
      if (data.status !== 'ok') throw new Error('Feed unavailable');
      return data.items.map(item => ({
        title: item.title,
        url: item.link,
        date: item.pubDate,
        description: stripHtml(item.description || '').slice(0, 220),
        section: null,
        source: 'Modern Loss',
      }));
    },
  },
  endwell: {
    label: 'End Well',
    fetch: async () => {
      const rssUrl = encodeURIComponent('https://endwellproject.org/feed/?post_type=blog');
      const res = await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${rssUrl}`);
      if (!res.ok) throw new Error('Feed error');
      const data = await res.json();
      if (data.status !== 'ok') throw new Error('Feed unavailable');
      return data.items.map(item => ({
        title: item.title,
        url: item.link,
        date: item.pubDate,
        description: stripHtml(item.description || '').slice(0, 220),
        section: null,
        source: 'End Well',
      }));
    },
  },
};

let currentArticleSource = 'whatsyourgrief';

async function fetchArticles(sourceKey) {
  currentArticleSource = sourceKey;
  const container = document.getElementById('article-posts');
  container.innerHTML = `<div class="reddit-loading">Loading articles...</div>`;
  try {
    const articles = await ARTICLE_SOURCES[sourceKey].fetch();
    renderArticles(articles);
  } catch (e) {
    const label = ARTICLE_SOURCES[sourceKey]?.label || sourceKey;
    container.innerHTML = `<div class="reddit-error">Could not load ${label}. <a href="#" id="article-retry">Try again ↗</a></div>`;
    document.getElementById('article-retry')?.addEventListener('click', (e) => {
      e.preventDefault();
      fetchArticles(sourceKey);
    });
  }
}

function renderArticles(articles) {
  const container = document.getElementById('article-posts');
  if (!articles.length) {
    container.innerHTML = '<div class="reddit-error">No articles found.</div>';
    return;
  }
  container.innerHTML = articles.map(a => {
    const date = a.date ? new Date(a.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    const flair = a.section ? `<span class="reddit-flair">${escapeHtml(a.section)}</span>` : '';
    const desc = a.description ? `<p class="article-card-desc">${escapeHtml(a.description)}${a.description.length >= 220 ? '…' : ''}</p>` : '';
    return `
    <a class="reddit-card" href="${a.url}" target="_blank" rel="noopener">
      ${flair}
      <div class="reddit-card-title">${escapeHtml(a.title)}</div>
      ${desc}
      <div class="reddit-card-meta">
        <span>${escapeHtml(a.source)}</span>
        ${date ? `<span>${date}</span>` : ''}
      </div>
    </a>`;
  }).join('');
}

document.querySelectorAll('.article-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.article-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    fetchArticles(btn.dataset.source);
  });
});

document.getElementById('articles-refresh').addEventListener('click', () => {
  fetchArticles(currentArticleSource);
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
    showUrl: true,
    urlLabel: 'Instagram / TikTok / Website',
    urlPlaceholder: 'https://instagram.com/...',
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
  if (cfg.showUrl) {
    document.querySelector('#promote-modal-url-wrap label').firstChild.textContent = cfg.urlLabel || 'Substack URL';
    document.getElementById('promote-modal-url').placeholder = cfg.urlPlaceholder || 'https://';
  }

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

// ── Image resize utility ──
function resizeImage(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 400;
        let w = img.width, h = img.height;
        if (w > h && w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
        else if (h > MAX) { w = Math.round(w * MAX / h); h = MAX; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.65));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ── Merch ──
const MERCH_STATUS_COLORS = {
  'Just an Idea': 'status-idea',
  'In Development': 'status-drafting',
  'Ready to Launch': 'status-ready',
  'Selling': 'status-done',
};

function renderMerch() {
  const grid = document.getElementById('merch-grid');
  if (!merch.length) {
    grid.innerHTML = `<div class="merch-empty">No merch ideas yet. Hit "+ Add Idea" to start your list.</div>`;
    return;
  }
  grid.innerHTML = merch.map(item => {
    const colorClass = MERCH_STATUS_COLORS[item.status] || 'status-idea';
    const notes = item.notes ? `<div class="merch-card-notes">${escapeHtml(item.notes)}</div>` : '';
    const price = item.price ? `<div class="merch-card-price">${escapeHtml(item.price)}</div>` : '';
    const img = item.image ? `<img class="merch-card-image" src="${item.image}" alt="">` : '';
    return `
    <div class="merch-card" data-id="${item.id}">
      ${img}
      <div class="merch-card-top">
        <span class="merch-category-badge">${escapeHtml(item.category)}</span>
        <span class="promote-status-badge ${colorClass}">${item.status}</span>
      </div>
      <div class="merch-card-title">${escapeHtml(item.title)}</div>
      ${price}
      ${notes}
    </div>`;
  }).join('');

  grid.querySelectorAll('.merch-card').forEach(card => {
    card.addEventListener('click', () => openMerchModal(card.dataset.id));
  });
}

let editingMerchId = null;
let currentMerchImage = null;

function setMerchImagePreview(src) {
  currentMerchImage = src || null;
  document.getElementById('merch-image-thumb').src = src || '';
  document.getElementById('merch-image-placeholder').style.display = src ? 'none' : 'flex';
  document.getElementById('merch-image-preview').style.display = src ? 'block' : 'none';
}

document.getElementById('merch-image-area').addEventListener('click', () => {
  if (!currentMerchImage) document.getElementById('merch-image-input').click();
});

document.getElementById('merch-image-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const src = await resizeImage(file);
  setMerchImagePreview(src);
  e.target.value = '';
});

document.getElementById('merch-image-remove').addEventListener('click', (e) => {
  e.stopPropagation();
  setMerchImagePreview(null);
});

document.getElementById('new-merch-btn').addEventListener('click', () => openMerchModal(null));

function openMerchModal(id) {
  editingMerchId = id;
  const item = id ? merch.find(m => m.id === id) : null;

  document.getElementById('merch-modal-title').value = item ? item.title : '';
  document.getElementById('merch-modal-category').value = item ? (item.category || 'Apparel') : 'Apparel';
  document.getElementById('merch-modal-status').value = item ? (item.status || 'Just an Idea') : 'Just an Idea';
  document.getElementById('merch-modal-price').value = item ? (item.price || '') : '';
  document.getElementById('merch-modal-notes').value = item ? (item.notes || '') : '';
  setMerchImagePreview(item ? (item.image || null) : null);

  document.getElementById('merch-modal-delete').style.display = id ? 'inline-flex' : 'none';
  document.getElementById('merch-modal-save').textContent = id ? 'Save Changes' : 'Save';

  document.getElementById('merch-modal').classList.add('active');
  setTimeout(() => document.getElementById('merch-modal-title').focus(), 50);
}

function closeMerchModal() {
  document.getElementById('merch-modal').classList.remove('active');
  editingMerchId = null;
}

document.getElementById('merch-modal-close').addEventListener('click', closeMerchModal);
document.getElementById('merch-modal-cancel').addEventListener('click', closeMerchModal);
document.getElementById('merch-modal').addEventListener('click', e => {
  if (e.target.id === 'merch-modal') closeMerchModal();
});

document.getElementById('merch-modal-save').addEventListener('click', () => {
  const title = document.getElementById('merch-modal-title').value.trim();
  if (!title) { document.getElementById('merch-modal-title').focus(); return; }

  const data = {
    title,
    category: document.getElementById('merch-modal-category').value,
    status: document.getElementById('merch-modal-status').value,
    price: document.getElementById('merch-modal-price').value.trim(),
    notes: document.getElementById('merch-modal-notes').value.trim(),
    image: currentMerchImage,
  };

  if (editingMerchId) {
    const idx = merch.findIndex(m => m.id === editingMerchId);
    if (idx > -1) merch[idx] = { ...merch[idx], ...data };
  } else {
    merch.unshift({ id: generateId(), ...data, createdAt: Date.now() });
  }

  scheduleCloudSave();
  renderMerch();
  closeMerchModal();
});

document.getElementById('merch-modal-delete').addEventListener('click', () => {
  if (!editingMerchId) return;
  if (!confirm('Delete this merch idea?')) return;
  merch = merch.filter(m => m.id !== editingMerchId);
  scheduleCloudSave();
  renderMerch();
  closeMerchModal();
});

// ── Brainstorm ──
document.getElementById('brainstorm-toggle').addEventListener('click', () => {
  const panel = document.getElementById('brainstorm-panel');
  const btn = document.getElementById('brainstorm-toggle');
  const open = panel.style.display === 'none' || panel.style.display === '';
  panel.style.display = open ? 'block' : 'none';
  btn.textContent = open ? '✕ Close' : '✦ Brainstorm';
});

document.getElementById('brainstorm-generate').addEventListener('click', () => {
  const pillar = document.getElementById('brainstorm-pillar').value;
  const context = document.getElementById('brainstorm-context').value.trim();

  const prompt = `You are helping brainstorm content ideas for "Mourning Person," a grief-focused Substack by Frankie Shlain. The publication has a modern, honest, intimate voice — specific and raw, never clinical or overly sentimental.

Content pillars:
- CRYING AND CRAFTING: grief-adjacent creative projects and activities
- GRIEVER'S GUIDE TO:: practical guides for navigating specific grief moments (first holidays, clearing belongings, etc.)
- MOURNING MEDIA: TV shows, movies, books, and cultural events that feature grief well — your take on how culture handles loss
- MOURNING ROUTINE: personal morning/mourning rituals and daily life with grief
- RECIPES FOR GRIEF: cooking from her late mother's handwritten recipe cards — dishes she never ate or made before, meeting a side of her mother she didn't know through food
- DREADING TO WED: the complicated grief of wedding planning and milestone moments without the people you've lost — incorporating them, missing them, and the dread woven into joy
${pillar ? `\nFocus ideas on the "${pillar}" pillar.` : ''}${context ? `\nContext from the writer: ${context}` : ''}

Please generate 8 specific, compelling article or TikTok video ideas. Make titles strong and evocative — specific, not generic. For each include a one-sentence angle or hook. Mix Substack articles and TikTok videos.`;

  navigator.clipboard.writeText(prompt).catch(() => {});

  const results = document.getElementById('brainstorm-results');
  results.innerHTML = `
    <div class="brainstorm-prompt-box">
      <div class="brainstorm-prompt-header">
        <span class="brainstorm-prompt-label">Prompt ready — paste it into Claude or ChatGPT</span>
        <a href="https://claude.ai" target="_blank" class="btn-primary brainstorm-open-btn">Open Claude.ai ↗</a>
      </div>
      <textarea class="brainstorm-prompt-preview" readonly>${escapeHtml(prompt)}</textarea>
      <p class="brainstorm-prompt-hint">Copied to clipboard. Click the box to copy again.</p>
    </div>`;

  results.querySelector('.brainstorm-prompt-preview').addEventListener('click', function() {
    navigator.clipboard.writeText(prompt).catch(() => {});
    this.select();
  });
});

// ── Init ──
renderAll();
