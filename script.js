const STORAGE_KEY = 'my-tasks';
const THEME_KEY = 'my-tasks-theme';
const SORT_KEY = 'my-tasks-sort';

const CATEGORIES = {
  work: '업무',
  personal: '개인',
  study: '공부',
};

const CATEGORY_ORDER = { work: 0, personal: 1, study: 2 };

// 자동 분류용 키워드. 모두 소문자로 적는다 (입력도 소문자로 바꿔 대조하므로).
// 두 카테고리에 같은 단어를 넣지 않는다 — 양쪽 점수가 같이 올라 판단에 기여하지 못한다.
// 한 카테고리 안에서도 '보고'/'보고서' 처럼 한쪽이 다른 쪽에 포함되면 이중으로 세어진다.
const KEYWORDS = {
  work: [
    '회의', '미팅', '보고', '메일', '기획', '발표', '자료', '제출',
    '마감', '업무', '프로젝트', '결재', '출장', '고객', '계약', '회식',
    '야근', '면접', '실적', '거래처',
    'meeting', 'report', 'deadline', 'invoice',
  ],
  personal: [
    '장보기', '병원', '약속', '운동', '청소', '빨래', '요리', '은행',
    '가족', '친구', '생일', '여행', '예약', '미용실', '쇼핑', '택배',
    '세탁', '공과금', '산책', '취미',
    'shopping', 'doctor', 'dentist', 'workout',
  ],
  study: [
    '공부', '시험', '강의', '수업', '과제', '숙제', '독서', '복습',
    '예습', '문제집', '인강', '자격증', '토익', '논문', '학습', '스터디',
    '수강', '필기', '학원', '단어장',
    'study', 'exam', 'homework', 'lecture',
  ],
};

const DEFAULT_CATEGORY = 'work';

// 드롭다운에서만 쓰는 값. 추가하는 순간 실제 카테고리로 확정되며 저장되지 않는다.
const AUTO_CATEGORY = 'auto';
const LEAVE_DURATION = 180; // style.css 의 item-out 애니메이션과 맞춘다
const SEARCH_DEBOUNCE = 120;

// 정렬 기준. 'manual' 은 배열 순서 그대로이므로 비교 함수가 없다.
const SORTERS = {
  created: (a, b) => b.createdAt - a.createdAt,
  category: (a, b) =>
    CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category] ||
    b.createdAt - a.createdAt,
  done: (a, b) => Number(a.done) - Number(b.done) || b.createdAt - a.createdAt,
};

// Alt+1~4 로 전환할 필터. 맥에서 Option 키는 글자를 바꿔버리므로
// e.key 대신 물리 키 위치인 e.code 를 쓴다.
const FILTER_KEYS = {
  Digit1: 'all',
  Digit2: 'work',
  Digit3: 'personal',
  Digit4: 'study',
};

const form = document.getElementById('todo-form');
const input = document.getElementById('todo-input');
const categorySelect = document.getElementById('category-select');
const categoryHint = document.getElementById('category-hint');
const searchInput = document.getElementById('search-input');
const sortSelect = document.getElementById('sort-select');
const filterBar = document.getElementById('filter-bar');
const list = document.getElementById('todo-list');
const emptyMsg = document.getElementById('empty-msg');
const overallValue = document.getElementById('overall-value');
const overallFill = document.getElementById('overall-fill');
const todayCount = document.getElementById('today-count');
const remainingBadge = document.getElementById('remaining-badge');
const clearDoneBtn = document.getElementById('clear-done-btn');
const exportBtn = document.getElementById('export-btn');
const importBtn = document.getElementById('import-btn');
const importFile = document.getElementById('import-file');
const confirmDialog = document.getElementById('confirm-dialog');
const confirmTitle = document.getElementById('confirm-title');
const confirmText = document.getElementById('confirm-text');
const confirmActions = document.getElementById('confirm-actions');
const themeToggle = document.getElementById('theme-toggle');
const themeIcon = document.getElementById('theme-icon');
const toast = document.getElementById('toast');

// 미니 통계 요소는 고정이므로 한 번만 찾아 둔다 (항목이 많아도 매번 뒤지지 않게)
const miniRefs = Object.fromEntries(
  Object.keys(CATEGORIES).map((key) => {
    const stat = document.querySelector(`.mini-stat[data-category="${key}"]`);
    return [
      key,
      {
        count: stat.querySelector('[data-role="count"]'),
        fill: stat.querySelector('[data-role="fill"]'),
      },
    ];
  })
);

// { id: number, text: string, done: boolean, category: string, createdAt: number }
let todos = loadTodos();
let currentFilter = 'all';
let searchQuery = '';
let sortBy = loadSort();

// 편집 중인 항목의 id 와, 아직 저장하지 않은 입력값.
// 다시 그려도 입력하던 내용이 날아가지 않도록 상태로 들고 있는다.
let editingId = null;
let editingDraft = { text: '', category: DEFAULT_CATEGORY };

// 방금 추가된 항목에만 등장 애니메이션을 주기 위한 표시
let enteringId = null;

let searchTimer = null;
let toastTimer = null;

/* ── 저장 / 불러오기 ─────────────────────── */

function normalizeTodo(raw, index, usedIds) {
  if (!raw || typeof raw !== 'object') return null;

  const text = typeof raw.text === 'string' ? raw.text.trim() : '';
  if (!text) return null;

  const createdAt = Number.isFinite(raw.createdAt)
    ? raw.createdAt
    : Number.isFinite(raw.id)
      ? raw.id
      : Date.now() + index;

  // id 는 목록 안에서 유일해야 한다 (수정·삭제가 id 로 찾아가므로)
  let id = Number.isFinite(raw.id) ? raw.id : createdAt;
  while (usedIds.has(id)) id += 1;
  usedIds.add(id);

  return {
    id,
    text,
    done: raw.done === true,
    category: raw.category in CATEGORIES ? raw.category : DEFAULT_CATEGORY,
    createdAt,
  };
}

function normalizeList(rawList) {
  const usedIds = new Set();
  return rawList
    .map((raw, i) => normalizeTodo(raw, i, usedIds))
    .filter(Boolean);
}

function loadTodos() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? normalizeList(parsed) : [];
  } catch {
    return [];
  }
}

function saveTodos() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
  } catch {
    showToast('저장 공간이 가득 차 저장하지 못했습니다.');
  }
}

function loadSort() {
  try {
    const saved = localStorage.getItem(SORT_KEY);
    return saved === 'manual' || saved in SORTERS ? saved : 'manual';
  } catch {
    return 'manual';
  }
}

function saveSort() {
  try {
    localStorage.setItem(SORT_KEY, sortBy);
  } catch {
    // 정렬 기준을 저장하지 못해도 이번 세션에는 그대로 적용된다
  }
}

/* ── 테마 ────────────────────────────────── */

// 현재 테마는 <head> 의 인라인 스크립트가 이미 정해 두었다.
// 여기서는 버튼 표시만 맞춘다.
function syncThemeUI() {
  const isDark = document.documentElement.dataset.theme === 'dark';
  themeIcon.textContent = isDark ? '☀️' : '🌙';
  themeToggle.setAttribute('aria-label', isDark ? '라이트 모드 전환' : '다크 모드 전환');
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;

  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // 저장에 실패해도 이번 세션의 테마는 유지된다
  }

  syncThemeUI();
}

/* ── 안내 메시지 / 확인 창 ───────────────── */

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('is-visible');

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2600);
}

// 선택한 버튼의 value 로 resolve 한다. Esc 로 닫으면 'cancel'.
function askConfirm({ title, text, actions }) {
  return new Promise((resolve) => {
    confirmTitle.textContent = title;
    confirmText.textContent = text;
    confirmActions.innerHTML = '';

    actions.forEach((action) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = action.className || 'btn-ghost';
      btn.textContent = action.label;
      btn.addEventListener('click', () => confirmDialog.close(action.value));
      confirmActions.appendChild(btn);
    });

    // returnValue 는 다음 번에도 남아 있으므로 열기 전에 비운다
    confirmDialog.returnValue = '';
    confirmDialog.addEventListener(
      'close',
      () => resolve(confirmDialog.returnValue || 'cancel'),
      { once: true }
    );

    confirmDialog.showModal();
  });
}

/* ── 자동 분류 ───────────────────────────── */

// 입력 글자에서 카테고리를 추측한다. DOM 도 상태도 건드리지 않는 순수 함수다.
// score 가 0 이면 추측하지 못한 것이고, category 는 기본값이다.
function classify(text) {
  const haystack = text.toLowerCase();
  let best = { category: DEFAULT_CATEGORY, score: 0, matched: [] };

  // CATEGORIES 의 순서가 곧 동점일 때의 우선순위다 (업무 > 개인 > 공부).
  // 더 큰 점수일 때만 교체하므로 먼저 나온 카테고리가 동점에서 이긴다.
  for (const category of Object.keys(CATEGORIES)) {
    const matched = KEYWORDS[category].filter((word) => haystack.includes(word));

    if (matched.length > best.score) {
      best = { category, score: matched.length, matched };
    }
  }

  return best;
}

// 자동일 때만, 그리고 입력이 있을 때만 무엇으로 갈지 미리 보여준다.
function updateCategoryHint() {
  const text = input.value.trim();

  if (categorySelect.value !== AUTO_CATEGORY || !text) {
    categoryHint.classList.add('hidden');
    categoryHint.textContent = '';
    return;
  }

  const guess = classify(text);
  categoryHint.dataset.category = guess.category;
  categoryHint.classList.remove('hidden');

  // 못 맞혔을 때 맞춘 척하지 않는다
  categoryHint.textContent =
    guess.score === 0
      ? `키워드 없음 · 기본값 ${CATEGORIES[guess.category]}`
      : `${CATEGORIES[guess.category]}로 분류 · ${guess.matched.join(', ')}`;
}

/* ── 상대 시간 ───────────────────────────── */

function formatRelativeTime(timestamp) {
  const diff = Date.now() - timestamp;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return '방금 전';
  if (diff < hour) return `${Math.floor(diff / minute)}분 전`;
  if (diff < day) return `${Math.floor(diff / hour)}시간 전`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}일 전`;

  return new Date(timestamp).toLocaleDateString('ko-KR', {
    month: 'long',
    day: 'numeric',
  });
}

/* ── 진행률 대시보드 ─────────────────────── */

function percent(done, total) {
  return total === 0 ? 0 : Math.round((done / total) * 100);
}

// 항목이 많아도 한 번만 훑는다
function updateStats() {
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const per = {};
  Object.keys(CATEGORIES).forEach((key) => {
    per[key] = { total: 0, done: 0 };
  });

  let done = 0;
  let addedToday = 0;

  for (const todo of todos) {
    const bucket = per[todo.category];
    bucket.total += 1;

    if (todo.done) {
      done += 1;
      bucket.done += 1;
    }

    if (todo.createdAt >= startOfToday) addedToday += 1;
  }

  const total = todos.length;
  const rate = percent(done, total);

  overallValue.textContent = `${done}/${total} 완료 (${rate}%)`;
  overallFill.style.width = `${rate}%`;

  Object.entries(per).forEach(([key, stat]) => {
    miniRefs[key].count.textContent = `${stat.done}/${stat.total}`;
    miniRefs[key].fill.style.width = `${percent(stat.done, stat.total)}%`;
  });

  todayCount.textContent = `오늘 추가된 할 일 ${addedToday}개`;
  remainingBadge.textContent = `${total - done}개 남음`;
  clearDoneBtn.disabled = done === 0;
}

/* ── 렌더링 ──────────────────────────────── */

function getVisibleTodos() {
  const query = searchQuery.toLowerCase();

  const visible = todos.filter((todo) => {
    const matchesCategory =
      currentFilter === 'all' || todo.category === currentFilter;
    const matchesQuery = !query || todo.text.toLowerCase().includes(query);
    return matchesCategory && matchesQuery;
  });

  return sortBy === 'manual' ? visible : visible.sort(SORTERS[sortBy]);
}

// 검색어와 겹치는 부분을 <mark> 로 감싼다.
// innerHTML 을 쓰지 않으므로 할 일 내용은 언제나 글자 그대로 남는다.
function fillHighlighted(el, text, query) {
  if (!query) {
    el.textContent = text;
    return;
  }

  const lower = text.toLowerCase();
  const needle = query.toLowerCase();
  let cursor = 0;

  for (;;) {
    const hit = lower.indexOf(needle, cursor);
    if (hit === -1) break;

    el.append(text.slice(cursor, hit));

    const mark = document.createElement('mark');
    mark.textContent = text.slice(hit, hit + needle.length);
    el.append(mark);

    cursor = hit + needle.length;
  }

  el.append(text.slice(cursor));
}

function createCategorySelect(className, selected) {
  const select = document.createElement('select');
  select.className = className;
  select.setAttribute('aria-label', '카테고리');

  Object.entries(CATEGORIES).forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    option.selected = value === selected;
    select.appendChild(option);
  });

  return select;
}

function createTodoElement(todo) {
  const li = document.createElement('li');
  li.className = todo.done ? 'todo-item done' : 'todo-item';
  li.dataset.id = todo.id;
  li.dataset.category = todo.category;

  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = 'drag-handle';
  handle.textContent = '⠿';
  handle.setAttribute('aria-label', '끌어서 순서 변경');

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'todo-checkbox';
  checkbox.checked = todo.done;

  const body = document.createElement('div');
  body.className = 'todo-body';

  const text = document.createElement('span');
  text.className = 'todo-text';
  text.title = '더블클릭해서 수정';
  fillHighlighted(text, todo.text, searchQuery);

  const meta = document.createElement('div');
  meta.className = 'todo-meta';

  const tag = document.createElement('span');
  tag.className = 'category-tag';
  tag.dataset.category = todo.category;
  tag.textContent = CATEGORIES[todo.category];

  const time = document.createElement('span');
  time.className = 'todo-time';
  time.dataset.createdAt = todo.createdAt;
  time.textContent = formatRelativeTime(todo.createdAt);

  meta.append(tag, time);
  body.append(text, meta);

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'delete-btn';
  deleteBtn.textContent = '✕';
  deleteBtn.setAttribute('aria-label', '삭제');

  li.append(handle, checkbox, body, deleteBtn);
  return li;
}

function createEditElement(todo) {
  const li = document.createElement('li');
  li.className = 'todo-item is-editing';
  li.dataset.id = todo.id;
  li.dataset.category = editingDraft.category;

  // form 으로 감싸면 Enter 가 곧 submit 이 된다
  const editForm = document.createElement('form');
  editForm.className = 'edit-form';

  const editInput = document.createElement('input');
  editInput.type = 'text';
  editInput.className = 'edit-input';
  editInput.value = editingDraft.text;
  editInput.autocomplete = 'off';

  const select = createCategorySelect('edit-select', editingDraft.category);

  const hint = document.createElement('span');
  hint.className = 'edit-hint';
  hint.textContent = 'Enter 저장 · Esc 취소';

  editForm.append(editInput, select, hint);
  li.appendChild(editForm);
  return li;
}

function emptyMessage() {
  if (todos.length === 0) return '할 일이 없습니다. 추가해보세요!';
  if (searchQuery) return `"${searchQuery}" 와(과) 일치하는 할 일이 없습니다.`;
  if (currentFilter !== 'all') {
    return `${CATEGORIES[currentFilter]} 카테고리에는 할 일이 없습니다.`;
  }
  return '할 일이 없습니다. 추가해보세요!';
}

function render() {
  const visible = getVisibleTodos();

  // 항목을 하나씩 붙이면 그때마다 화면을 다시 계산한다.
  // 조각에 모아 한 번에 넣으면 100개가 넘어도 갱신이 한 번으로 끝난다.
  const fragment = document.createDocumentFragment();

  visible.forEach((todo) => {
    if (todo.id === editingId) {
      fragment.appendChild(createEditElement(todo));
      return;
    }

    const li = createTodoElement(todo);
    if (todo.id === enteringId) li.classList.add('is-entering');
    fragment.appendChild(li);
  });

  list.replaceChildren(fragment);
  enteringId = null;

  // 편집 중이면 입력란으로 포커스를 되돌리고 커서를 끝에 둔다
  if (editingId !== null) {
    const editInput = list.querySelector('.edit-input');
    if (editInput) {
      editInput.focus();
      editInput.setSelectionRange(editInput.value.length, editInput.value.length);
    }
  }

  emptyMsg.textContent = emptyMessage();
  emptyMsg.classList.toggle('hidden', visible.length > 0);

  updateStats();
}

/* ── 동작 ────────────────────────────────── */

function addTodo(text, category) {
  const now = Date.now();
  todos.push({ id: now, text, done: false, category, createdAt: now });
  enteringId = now;
  saveTodos();
  render();
}

function deleteTodo(id) {
  todos = todos.filter((todo) => todo.id !== id);
  if (editingId === id) editingId = null;
  saveTodos();
  render();
}

// 사라지는 모습을 보여준 뒤에 실제로 지운다
function requestDelete(li, id) {
  li.classList.add('is-leaving');
  setTimeout(() => deleteTodo(id), LEAVE_DURATION);
}

function clearCompleted() {
  const leaving = list.querySelectorAll('.todo-item.done');
  leaving.forEach((li) => li.classList.add('is-leaving'));

  setTimeout(() => {
    // 편집 중이던 항목이 함께 지워질 수 있으므로 편집 상태를 먼저 정리한다
    const editing = todos.find((todo) => todo.id === editingId);
    if (editing && editing.done) editingId = null;

    todos = todos.filter((todo) => !todo.done);
    saveTodos();
    render();
  }, leaving.length ? LEAVE_DURATION : 0);
}

function toggleTodo(id) {
  const todo = todos.find((t) => t.id === id);
  if (!todo) return;

  todo.done = !todo.done;
  saveTodos();
  render();
}

function setFilter(filter) {
  currentFilter = filter;

  filterBar.querySelectorAll('.filter-btn').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.filter === filter);
  });

  render();
}

function setSort(next) {
  sortBy = next;
  sortSelect.value = next;
  saveSort();
  render();
}

/* ── 인라인 수정 ─────────────────────────── */

function startEdit(id) {
  const todo = todos.find((t) => t.id === id);
  if (!todo) return;

  editingId = id;
  editingDraft = { text: todo.text, category: todo.category };
  render();
}

function commitEdit() {
  if (editingId === null) return;

  const todo = todos.find((t) => t.id === editingId);
  const text = editingDraft.text.trim();

  // 내용을 비운 채로 저장하면 지우는 대신 원래 값을 지킨다
  if (todo && text) {
    todo.text = text;
    todo.category = editingDraft.category;
    saveTodos();
  }

  editingId = null;
  render();
}

function cancelEdit() {
  if (editingId === null) return;

  editingId = null;
  render();
}

/* ── 끌어서 순서 바꾸기 ──────────────────── */

// 정렬 기준이 걸려 있으면 직접 정렬과 모순이므로,
// 지금 보이는 순서를 배열에 그대로 굳히고 '직접 정렬' 로 넘어간다.
// 화면은 이미 그 순서이므로 여기서 다시 그리지 않는다 (끌던 요소가 사라지면 안 된다).
function freezeSortOrder() {
  if (sortBy === 'manual') return;

  todos = [...todos].sort(SORTERS[sortBy]);
  sortBy = 'manual';
  sortSelect.value = 'manual';
  saveSort();
  saveTodos();
  showToast('직접 정렬로 바뀌었습니다.');
}

function elementAfterPointer(y) {
  const candidates = [...list.querySelectorAll('.todo-item:not(.is-dragging)')];

  return candidates.find((el) => {
    const box = el.getBoundingClientRect();
    return y < box.top + box.height / 2;
  }) ?? null;
}

// 화면에 보이는 순서를 배열에 반영한다.
// 필터·검색으로 가려진 항목은 원래 자리를 그대로 지킨다.
function commitDragOrder() {
  const shownOrder = [...list.children].map((li) => Number(li.dataset.id));
  const shown = new Set(shownOrder);
  const byId = new Map(todos.map((todo) => [todo.id, todo]));

  let cursor = 0;
  todos = todos.map((todo) =>
    shown.has(todo.id) ? byId.get(shownOrder[cursor++]) : todo
  );

  saveTodos();
  render();
}

/* ── 내보내기 / 가져오기 ─────────────────── */

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();

  // 브라우저가 내려받기를 시작할 틈을 준 뒤에 정리한다
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function fileStamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function exportData(filename = `my-tasks-${fileStamp()}.json`) {
  downloadJson(filename, {
    app: 'my-tasks',
    version: 1,
    exportedAt: new Date().toISOString(),
    todos,
  });
}

function parseImported(raw) {
  const parsed = JSON.parse(raw);

  // 내보내기 형식과 할 일 배열만 있는 형식을 모두 받는다
  const rawList = Array.isArray(parsed) ? parsed : parsed?.todos;
  if (!Array.isArray(rawList)) throw new Error('할 일 목록을 찾을 수 없습니다.');

  return { list: normalizeList(rawList), skipped: rawList.length };
}

async function handleImportFile(file) {
  let imported;

  try {
    imported = parseImported(await file.text());
  } catch {
    showToast('JSON 파일을 읽지 못했습니다.');
    return;
  }

  if (imported.list.length === 0) {
    showToast('가져올 수 있는 할 일이 없습니다.');
    return;
  }

  const answer = await askConfirm({
    title: '데이터 가져오기',
    text:
      `현재 할 일 ${todos.length}개가 가져온 ${imported.list.length}개로 바뀝니다. ` +
      '되돌릴 수 없으니 먼저 백업을 내려받는 것을 권합니다.',
    actions: [
      { value: 'cancel', label: '취소' },
      { value: 'plain', label: '그대로 가져오기' },
      { value: 'backup', label: '백업 후 가져오기', className: 'btn-primary' },
    ],
  });

  if (answer === 'cancel') return;
  if (answer === 'backup') exportData(`my-tasks-backup-${fileStamp()}.json`);

  todos = imported.list;
  editingId = null;
  saveTodos();
  render();

  const dropped = imported.skipped - imported.list.length;
  showToast(
    dropped > 0
      ? `${imported.list.length}개를 가져왔습니다. ${dropped}개는 형식이 맞지 않아 건너뛰었습니다.`
      : `${imported.list.length}개를 가져왔습니다.`
  );
}

/* ── 이벤트 ──────────────────────────────── */

// submit 은 추가 버튼 클릭과 Enter 키를 모두 처리한다
form.addEventListener('submit', (e) => {
  e.preventDefault();

  const text = input.value.trim();
  if (!text) return;

  const chosen = categorySelect.value;
  addTodo(text, chosen === AUTO_CATEGORY ? classify(text).category : chosen);

  input.value = '';
  input.focus();
  updateCategoryHint();
});

// 입력과 드롭다운 어느 쪽이 바뀌어도 힌트를 다시 계산한다
input.addEventListener('input', updateCategoryHint);
categorySelect.addEventListener('change', updateCategoryHint);

// 글자마다 목록 전체를 다시 그리지 않도록 잠깐 모아서 처리한다
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    searchQuery = searchInput.value.trim();
    render();
  }, SEARCH_DEBOUNCE);
});

sortSelect.addEventListener('change', () => setSort(sortSelect.value));

filterBar.addEventListener('click', (e) => {
  const btn = e.target.closest('.filter-btn');
  if (btn) setFilter(btn.dataset.filter);
});

themeToggle.addEventListener('click', toggleTheme);

exportBtn.addEventListener('click', () => {
  if (todos.length === 0) {
    showToast('내보낼 할 일이 없습니다.');
    return;
  }

  exportData();
  showToast(`할 일 ${todos.length}개를 파일로 내보냈습니다.`);
});

importBtn.addEventListener('click', () => importFile.click());

importFile.addEventListener('change', () => {
  const file = importFile.files[0];
  // 같은 파일을 다시 고를 수 있도록 값을 비운다
  importFile.value = '';
  if (file) handleImportFile(file);
});

clearDoneBtn.addEventListener('click', async () => {
  const count = todos.filter((todo) => todo.done).length;
  if (count === 0) return;

  const answer = await askConfirm({
    title: '완료된 항목 삭제',
    text: `완료된 할 일 ${count}개를 모두 삭제합니다. 되돌릴 수 없습니다.`,
    actions: [
      { value: 'cancel', label: '취소' },
      { value: 'confirm', label: '삭제', className: 'btn-danger' },
    ],
  });

  if (answer === 'confirm') clearCompleted();
});

// 목록은 항목마다 새로 그려지므로 이벤트는 위임으로 한 번만 등록한다
list.addEventListener('click', (e) => {
  const li = e.target.closest('.todo-item');
  if (!li) return;

  const id = Number(li.dataset.id);

  if (e.target.closest('.delete-btn')) {
    requestDelete(li, id);
  } else if (e.target.classList.contains('todo-checkbox')) {
    toggleTodo(id);
  }
});

list.addEventListener('dblclick', (e) => {
  if (!e.target.closest('.todo-text')) return;

  const li = e.target.closest('.todo-item');
  startEdit(Number(li.dataset.id));
});

// 편집 중 입력은 상태에만 반영한다 (다시 그리지 않으므로 커서가 튀지 않는다)
list.addEventListener('input', (e) => {
  if (e.target.classList.contains('edit-input')) {
    editingDraft.text = e.target.value;
  }
});

list.addEventListener('change', (e) => {
  if (e.target.classList.contains('edit-select')) {
    editingDraft.category = e.target.value;
    // 태그 색이 바로 따라오도록 편집 중인 행의 카테고리도 갱신한다
    e.target.closest('.todo-item').dataset.category = e.target.value;
  }
});

list.addEventListener('submit', (e) => {
  if (e.target.classList.contains('edit-form')) {
    e.preventDefault();
    commitEdit();
  }
});

list.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && e.target.classList.contains('edit-input')) {
    cancelEdit();
  }
});

// 편집 영역 밖을 클릭하면 저장한다. select 로 옮겨가는 것은 이탈이 아니다.
list.addEventListener('focusout', (e) => {
  const editForm = e.target.closest('.edit-form');
  if (!editForm) return;
  if (editForm.contains(e.relatedTarget)) return;

  commitEdit();
});

/* 드래그는 손잡이를 잡았을 때만 시작한다.
   항목 전체를 항상 draggable 로 두면 글자 선택과 더블클릭 편집을 방해한다. */
list.addEventListener('pointerdown', (e) => {
  const handle = e.target.closest('.drag-handle');
  if (handle) handle.closest('.todo-item').draggable = true;
});

list.addEventListener('dragstart', (e) => {
  const li = e.target.closest('.todo-item');
  if (!li) return;

  freezeSortOrder();
  li.classList.add('is-dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', li.dataset.id);
});

list.addEventListener('dragover', (e) => {
  const dragging = list.querySelector('.is-dragging');
  if (!dragging) return;

  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  // 끌고 있는 요소를 화면에서 바로 옮겨 두고, 놓을 때 배열에 반영한다
  const after = elementAfterPointer(e.clientY);
  if (after === null) list.appendChild(dragging);
  else if (after !== dragging) list.insertBefore(dragging, after);
});

list.addEventListener('drop', (e) => e.preventDefault());

list.addEventListener('dragend', (e) => {
  const li = e.target.closest('.todo-item');
  if (!li) return;

  li.classList.remove('is-dragging');
  li.draggable = false;
  commitDragOrder();
});

/* ── 키보드 단축키 ───────────────────────── */

document.addEventListener('keydown', (e) => {
  if (!e.altKey || e.ctrlKey || e.metaKey) return;

  if (e.code === 'KeyN') {
    e.preventDefault();
    input.focus();
    input.select();
    return;
  }

  const filter = FILTER_KEYS[e.code];
  if (filter) {
    e.preventDefault();
    setFilter(filter);
  }
});

// "방금 전" 이 계속 "방금 전" 으로 남지 않도록 시간 표시만 주기적으로 갱신한다
setInterval(() => {
  list.querySelectorAll('.todo-time').forEach((el) => {
    el.textContent = formatRelativeTime(Number(el.dataset.createdAt));
  });
}, 60 * 1000);

syncThemeUI();
sortSelect.value = sortBy;
render();
