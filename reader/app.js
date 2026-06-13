/* Paper Shelf — 논문 PDF 이북 리더 */
'use strict';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

/* ===================== IndexedDB ===================== */

const DB_NAME = 'paperShelf';
const STORE = 'books';

function openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function dbPut(book) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(book);
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
}

async function dbGetAll() {
  const db = await openDB();
  return new Promise((res, rej) => {
    const req = db.transaction(STORE).objectStore(STORE).getAll();
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function dbGet(id) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const req = db.transaction(STORE).objectStore(STORE).get(id);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function dbDelete(id) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
}

/* ===================== PDF → 리플로우 텍스트 추출 ===================== */

/**
 * 페이지의 텍스트 아이템을 줄(line) 단위로 묶는다.
 * 같은 줄 판정: y 좌표 차이가 글자 높이의 절반 이내.
 */
function groupIntoLines(items) {
  const frags = items
    .filter(it => it.str.trim() !== '')
    .map(it => ({
      str: it.str,
      x: it.transform[4],
      y: it.transform[5],
      w: it.width,
      h: it.height || Math.abs(it.transform[3]) || 10,
    }));

  frags.sort((a, b) => (b.y - a.y) || (a.x - b.x));

  const lines = [];
  for (const f of frags) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - f.y) < f.h * 0.5) {
      last.frags.push(f);
    } else {
      lines.push({ y: f.y, frags: [f] });
    }
  }

  return lines.map(l => {
    l.frags.sort((a, b) => a.x - b.x);
    let text = '';
    let prevEnd = null;
    for (const f of l.frags) {
      // 조각 사이 간격이 글자폭 이상이면 공백 삽입
      if (prevEnd !== null && f.x - prevEnd > f.h * 0.25 && !text.endsWith(' ')) text += ' ';
      text += f.str;
      prevEnd = f.x + f.w;
    }
    const h = Math.max(...l.frags.map(f => f.h));
    return {
      text: text.replace(/\s+/g, ' ').trim(),
      y: l.y,
      x0: Math.min(...l.frags.map(f => f.x)),
      x1: Math.max(...l.frags.map(f => f.x + f.w)),
      h,
    };
  }).filter(l => l.text !== '');
}

/** 2단 레이아웃이면 좌→우 컬럼 순서로 줄을 재배열한다. */
function reorderColumns(lines, pageWidth) {
  const mid = pageWidth / 2;
  let left = 0, right = 0, span = 0;
  for (const l of lines) {
    if (l.x1 < mid + pageWidth * 0.05) left++;
    else if (l.x0 > mid - pageWidth * 0.05) right++;
    else span++;
  }
  // 양쪽 컬럼에 충분한 줄이 있고, 폭 전체를 쓰는 줄이 적으면 2단으로 판단
  if (left < 4 || right < 4 || span > (left + right) * 0.5) return lines;

  const spanning = [], leftCol = [], rightCol = [];
  for (const l of lines) {
    if (l.x1 < mid + pageWidth * 0.05) leftCol.push(l);
    else if (l.x0 > mid - pageWidth * 0.05) rightCol.push(l);
    else spanning.push(l);
  }
  // 상단 가로 전체 줄(제목 등) → 왼쪽 컬럼 → 오른쪽 컬럼
  return [...spanning, ...leftCol, ...rightCol];
}

/** 줄들을 문단/제목 블록으로 병합한다. */
function linesToBlocks(lines, bodySize, blocks) {
  let para = '';
  let prev = null;

  const flush = () => {
    const t = para.trim();
    if (t) blocks.push({ type: 'p', text: t });
    para = '';
  };

  for (const line of lines) {
    // 페이지 번호 등 잡음 제거
    if (/^\d{1,4}$/.test(line.text)) continue;

    const isHeading = line.h > bodySize * 1.15 && line.text.length < 120;
    if (isHeading) {
      flush();
      const level = line.h > bodySize * 1.45 ? 'h2' : 'h3';
      const last = blocks[blocks.length - 1];
      // 여러 줄 제목은 직전 제목 블록에 이어붙인다
      if (last && last.type === level && prev && prev.isHeading &&
          Math.abs(prev.y - line.y) < line.h * 2.2) {
        last.text += ' ' + line.text;
      } else {
        blocks.push({ type: level, text: line.text });
      }
      prev = { y: line.y, h: line.h, isHeading: true };
      continue;
    }

    // 문단 경계: 줄 간격이 크거나, 이전 줄이 제목이었던 경우
    if (prev && (prev.isHeading || prev.y - line.y > line.h * 1.9)) flush();

    if (para.endsWith('-')) para = para.slice(0, -1) + line.text; // 하이픈 연결
    else para += (para ? ' ' : '') + line.text;

    prev = { y: line.y, h: line.h, isHeading: false };
  }
  flush();
}

async function extractBlocks(pdf, onProgress) {
  const blocks = [];
  // 본문 글자 크기 추정: 첫 3페이지 줄 높이의 최빈값
  const sizes = [];
  for (let p = 1; p <= Math.min(3, pdf.numPages); p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    for (const l of groupIntoLines(content.items)) sizes.push(Math.round(l.h));
  }
  const freq = {};
  for (const s of sizes) freq[s] = (freq[s] || 0) + 1;
  const bodySize = Number(Object.keys(freq).sort((a, b) => freq[b] - freq[a])[0]) || 10;

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const { width } = page.getViewport({ scale: 1 });
    let lines = groupIntoLines(content.items);
    lines = reorderColumns(lines, width);
    linesToBlocks(lines, bodySize, blocks);
    onProgress(p, pdf.numPages);
  }

  // 너무 짧은 고아 블록(캡션 조각 등)이라도 일단 유지하되, 빈 블록만 제거
  return blocks.filter(b => b.text.trim() !== '');
}

/* ===================== 상태 ===================== */

const $ = id => document.getElementById(id);

let currentBook = null;   // 열려 있는 책 (DB 레코드 전체)
let saveTimer = null;

/* ===================== 서재 ===================== */

async function renderLibrary() {
  const books = await dbGetAll();
  books.sort((a, b) => (b.lastReadAt || b.addedAt) - (a.lastReadAt || a.addedAt));
  const grid = $('bookGrid');
  grid.innerHTML = '';
  $('libHint').hidden = books.length > 0;

  for (const b of books) {
    const pct = Math.round((b.progress?.percent || 0) * 100);
    const card = document.createElement('div');
    card.className = 'book-card';
    card.innerHTML = `
      <button class="book-delete" title="삭제">✕</button>
      <div class="book-cover">📄</div>
      <div class="book-title"></div>
      <div class="book-meta">${b.numPages}쪽 · ${pct}% 읽음</div>
      <div class="book-progress"><div style="width:${pct}%"></div></div>`;
    card.querySelector('.book-title').textContent = b.title;
    card.querySelector('.book-delete').onclick = async e => {
      e.stopPropagation();
      if (confirm(`"${b.title}" 책을 삭제할까요?`)) {
        await dbDelete(b.id);
        renderLibrary();
      }
    };
    card.onclick = () => openBook(b.id);
    grid.appendChild(card);
  }
}

async function addPdf(file) {
  const overlay = $('extractOverlay');
  const msg = $('extractMsg');
  overlay.hidden = false;
  msg.textContent = 'PDF 여는 중…';

  try {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise;

    let title = file.name.replace(/\.pdf$/i, '');
    try {
      const meta = await pdf.getMetadata();
      const t = meta.info?.Title?.trim();
      // 의미 없는 메타데이터 제목(빈 값, untitled, URL 등)은 무시
      if (t && t.length > 2 && !/^(untitled|about:blank|microsoft word|\d+)/i.test(t)) title = t;
    } catch { /* 메타데이터 없으면 파일명 사용 */ }

    const blocks = await extractBlocks(pdf, (done, total) => {
      msg.textContent = `텍스트 추출 중… ${done}/${total}쪽`;
    });

    if (blocks.length === 0) {
      alert('텍스트를 추출하지 못했어요. 스캔본(이미지) PDF는 지원하지 않습니다.');
      return;
    }

    await dbPut({
      id: crypto.randomUUID(),
      title,
      fileName: file.name,
      numPages: pdf.numPages,
      addedAt: Date.now(),
      lastReadAt: null,
      pdfBlob: new Blob([buf], { type: 'application/pdf' }),
      blocks,
      progress: { block: 0, percent: 0 },
      highlights: [],
    });
    renderLibrary();
  } catch (err) {
    console.error(err);
    alert('PDF를 처리하지 못했어요: ' + err.message);
  } finally {
    overlay.hidden = true;
  }
}

/* ===================== 리더 ===================== */

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 블록 텍스트에 하이라이트 마크를 입혀 HTML로 만든다. */
function blockHtml(blockIdx, text, highlights) {
  const marks = highlights
    .filter(h => h.block === blockIdx)
    .sort((a, b) => a.start - b.start);
  if (marks.length === 0) return escapeHtml(text);

  let html = '';
  let pos = 0;
  for (const m of marks) {
    const start = Math.max(pos, m.start);
    if (start >= m.end) continue;
    html += escapeHtml(text.slice(pos, start));
    const cls = m.note ? 'hl has-note' : 'hl';
    html += `<mark class="${cls}" data-hl="${m.id}">` +
            escapeHtml(text.slice(start, m.end)) + '</mark>';
    pos = m.end;
  }
  html += escapeHtml(text.slice(pos));
  return html;
}

function renderReaderContent() {
  const el = $('readerContent');
  el.innerHTML = '';
  const frag = document.createDocumentFragment();
  currentBook.blocks.forEach((b, i) => {
    const tag = b.type === 'p' ? 'p' : b.type;
    const node = document.createElement(tag);
    node.dataset.idx = i;
    node.className = 'blk';
    node.innerHTML = blockHtml(i, b.text, currentBook.highlights);
    frag.appendChild(node);
  });
  el.appendChild(frag);
}

async function openBook(id) {
  currentBook = await dbGet(id);
  if (!currentBook) return;

  $('libraryView').hidden = true;
  $('readerView').hidden = false;
  $('readerTitle').textContent = currentBook.title;
  renderReaderContent();

  // 이어읽기: 저장된 블록 위치로 스크롤
  const target = document.querySelector(`.blk[data-idx="${currentBook.progress.block}"]`);
  requestAnimationFrame(() => {
    if (target && currentBook.progress.block > 0) {
      target.scrollIntoView();
      window.scrollBy(0, -70);
    } else {
      window.scrollTo(0, 0);
    }
    updateProgressUI();
  });

  currentBook.lastReadAt = Date.now();
  dbPut(currentBook);
}

function closeBook() {
  saveProgressNow();
  currentBook = null;
  $('readerView').hidden = true;
  $('hlPanel').hidden = true;
  $('libraryView').hidden = false;
  window.scrollTo(0, 0);
  renderLibrary();
}

/* ----- 진행률 ----- */

function topVisibleBlock() {
  const blocks = document.querySelectorAll('#readerContent .blk');
  const top = 70; // 상단바 아래
  for (const el of blocks) {
    if (el.getBoundingClientRect().bottom > top) return Number(el.dataset.idx);
  }
  return blocks.length - 1;
}

function updateProgressUI() {
  if (!currentBook) return;
  const idx = topVisibleBlock();
  const doc = document.documentElement;
  const scrollable = doc.scrollHeight - window.innerHeight;
  const percent = scrollable > 0 ? Math.min(1, window.scrollY / scrollable) : 1;
  $('progressFill').style.width = (percent * 100) + '%';
  $('progressLabel').textContent = Math.round(percent * 100) + '%';

  currentBook.progress = { block: idx, percent };
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveProgressNow, 800);
}

function saveProgressNow() {
  clearTimeout(saveTimer);
  if (currentBook) dbPut(currentBook);
}

/* ----- 글자 크기 ----- */

function applyFontSize() {
  const size = Number(localStorage.getItem('readerFontSize') || 19);
  document.documentElement.style.setProperty('--reader-font-size', size + 'px');
}

function changeFontSize(delta) {
  let size = Number(localStorage.getItem('readerFontSize') || 19) + delta;
  size = Math.max(14, Math.min(28, size));
  localStorage.setItem('readerFontSize', size);
  applyFontSize();
}

/* ===================== 하이라이트 / 메모 ===================== */

/** 블록 내 텍스트 노드 기준으로 (node, offset)의 문자 오프셋을 구한다. */
function offsetInBlock(blockEl, node, offset) {
  let total = 0;
  const walker = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT);
  let cur;
  while ((cur = walker.nextNode())) {
    if (cur === node) return total + offset;
    total += cur.length;
  }
  // node가 요소인 경우(드물게): 블록 전체 기준 근사값
  return offset === 0 ? 0 : total;
}

/** 현재 선택 영역을 블록별 {block, start, end, text} 배열로 변환한다. */
function selectionToRanges() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);

  const blockOf = node => {
    const el = node.nodeType === 1 ? node : node.parentElement;
    return el?.closest('#readerContent .blk') || null;
  };
  const startBlk = blockOf(range.startContainer);
  const endBlk = blockOf(range.endContainer);
  if (!startBlk || !endBlk) return null;

  const sIdx = Number(startBlk.dataset.idx);
  const eIdx = Number(endBlk.dataset.idx);
  const ranges = [];

  for (let i = sIdx; i <= eIdx; i++) {
    const blkEl = document.querySelector(`.blk[data-idx="${i}"]`);
    if (!blkEl) continue;
    const full = currentBook.blocks[i].text;
    const start = i === sIdx ? offsetInBlock(startBlk, range.startContainer, range.startOffset) : 0;
    const end = i === eIdx ? offsetInBlock(endBlk, range.endContainer, range.endOffset) : full.length;
    if (end > start) ranges.push({ block: i, start, end, text: full.slice(start, end) });
  }
  return ranges.length ? ranges : null;
}

let pendingRanges = null;  // 선택 메뉴가 떠 있는 동안의 선택 범위
let editingHlId = null;    // 메모 팝업이 편집 중인 하이라이트

function showSelMenu() {
  const sel = window.getSelection();
  if (!currentBook || !sel || sel.isCollapsed) { $('selMenu').hidden = true; return; }
  const ranges = selectionToRanges();
  if (!ranges) { $('selMenu').hidden = true; return; }

  pendingRanges = ranges;
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  const menu = $('selMenu');
  menu.hidden = false;
  const top = rect.top + window.scrollY - menu.offsetHeight - 8;
  menu.style.top = Math.max(window.scrollY + 60, top) + 'px';
  menu.style.left = Math.max(8, Math.min(
    rect.left + window.scrollX + rect.width / 2 - menu.offsetWidth / 2,
    window.scrollX + window.innerWidth - menu.offsetWidth - 8)) + 'px';
}

function addHighlight(withNote) {
  if (!pendingRanges) return;
  const groupId = crypto.randomUUID();
  const created = pendingRanges.map((r, i) => ({
    id: pendingRanges.length === 1 ? groupId : `${groupId}-${i}`,
    ...r,
    note: '',
  }));
  currentBook.highlights.push(...created);
  dbPut(currentBook);

  window.getSelection().removeAllRanges();
  $('selMenu').hidden = true;
  pendingRanges = null;
  renderReaderContent();

  if (withNote) openNotePopupFor(created[0].id);
}

function openNotePopupFor(hlId) {
  const hl = currentBook.highlights.find(h => h.id === hlId);
  if (!hl) return;
  editingHlId = hlId;

  $('noteQuote').textContent = hl.text;
  $('noteText').value = hl.note || '';

  const markEl = document.querySelector(`mark[data-hl="${hlId}"]`);
  const popup = $('notePopup');
  popup.hidden = false;
  if (markEl) {
    const rect = markEl.getBoundingClientRect();
    popup.style.top = (rect.bottom + window.scrollY + 8) + 'px';
    popup.style.left = Math.max(8, Math.min(
      rect.left + window.scrollX,
      window.scrollX + window.innerWidth - popup.offsetWidth - 8)) + 'px';
  }
  $('noteText').focus();
}

function saveNote() {
  const hl = currentBook.highlights.find(h => h.id === editingHlId);
  if (hl) {
    hl.note = $('noteText').value.trim();
    dbPut(currentBook);
    renderReaderContent();
  }
  closeNotePopup();
}

function deleteHighlight() {
  // 같은 선택에서 나온 멀티블록 하이라이트(id 접두사 공유)도 함께 삭제
  const base = editingHlId.replace(/-\d+$/, '');
  currentBook.highlights = currentBook.highlights.filter(
    h => h.id !== editingHlId && !h.id.startsWith(base + '-'));
  dbPut(currentBook);
  renderReaderContent();
  closeNotePopup();
}

function closeNotePopup() {
  $('notePopup').hidden = true;
  editingHlId = null;
}

/* ----- 하이라이트 목록 패널 ----- */

function renderHlPanel() {
  const list = $('hlPanelList');
  list.innerHTML = '';
  const hls = [...currentBook.highlights].sort((a, b) => a.block - b.block || a.start - b.start);
  if (hls.length === 0) {
    list.innerHTML = '<div class="hl-empty">아직 하이라이트가 없어요.<br>본문에서 텍스트를 드래그해 보세요.</div>';
    return;
  }
  for (const h of hls) {
    const item = document.createElement('div');
    item.className = 'hl-item';
    const q = document.createElement('span');
    q.className = 'q';
    q.textContent = h.text.length > 90 ? h.text.slice(0, 90) + '…' : h.text;
    item.appendChild(q);
    if (h.note) {
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = '📝 ' + h.note;
      item.appendChild(n);
    }
    item.onclick = () => {
      $('hlPanel').hidden = true;
      const mark = document.querySelector(`mark[data-hl="${h.id}"]`);
      if (mark) {
        mark.scrollIntoView({ block: 'center' });
        mark.style.outline = '2px solid var(--accent)';
        setTimeout(() => (mark.style.outline = ''), 1200);
      }
    };
    list.appendChild(item);
  }
}

/* ===================== 이벤트 바인딩 ===================== */

$('fileInput').addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) addPdf(file);
  e.target.value = '';
});

$('backBtn').onclick = closeBook;
$('fontUpBtn').onclick = () => changeFontSize(1);
$('fontDownBtn').onclick = () => changeFontSize(-1);
$('hlListBtn').onclick = () => {
  const panel = $('hlPanel');
  panel.hidden = !panel.hidden;
  if (!panel.hidden) renderHlPanel();
};
$('hlPanelClose').onclick = () => ($('hlPanel').hidden = true);

// 메뉴를 누를 때 텍스트 선택이 풀리지 않도록 기본 동작 차단
$('selMenu').addEventListener('mousedown', e => e.preventDefault());
$('selMenu').addEventListener('touchstart', e => e.preventDefault(), { passive: false });
$('selHighlight').onclick = () => addHighlight(false);
$('selMemo').onclick = () => addHighlight(true);
$('noteSave').onclick = saveNote;
$('noteDelete').onclick = deleteHighlight;

document.addEventListener('selectionchange', () => {
  // 선택이 풀리면 메뉴 숨김 (버튼 클릭은 mousedown 시점에 처리되도록 약간 지연)
  if (window.getSelection().isCollapsed) {
    setTimeout(() => { if (window.getSelection().isCollapsed) $('selMenu').hidden = true; }, 150);
  }
});
document.addEventListener('mouseup', e => {
  if (currentBook && !$('selMenu').contains(e.target)) setTimeout(showSelMenu, 10);
});
document.addEventListener('touchend', e => {
  if (currentBook && !$('selMenu').contains(e.target)) setTimeout(showSelMenu, 300);
});

$('readerContent').addEventListener('click', e => {
  const mark = e.target.closest('mark.hl');
  if (mark) openNotePopupFor(mark.dataset.hl);
  else if (!$('notePopup').contains(e.target)) closeNotePopup();
});

window.addEventListener('scroll', () => {
  if (currentBook && !$('readerView').hidden) updateProgressUI();
}, { passive: true });

window.addEventListener('beforeunload', saveProgressNow);

/* ===================== 초기화 ===================== */

applyFontSize();
renderLibrary();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
