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

/* ===================== PDF 추출 ===================== */

function groupIntoLines(items) {
  const frags = items
    .filter(it => it.str.trim() !== '')
    .map(it => ({
      str: it.str,
      x: it.transform[4], y: it.transform[5],
      w: it.width,
      h: it.height || Math.abs(it.transform[3]) || 10,
    }));

  frags.sort((a, b) => (b.y - a.y) || (a.x - b.x));

  const lines = [];
  for (const f of frags) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - f.y) < f.h * 0.5) last.frags.push(f);
    else lines.push({ y: f.y, frags: [f] });
  }

  return lines.map(l => {
    l.frags.sort((a, b) => a.x - b.x);
    let text = '', prevEnd = null;
    for (const f of l.frags) {
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

function reorderColumns(lines, pageWidth) {
  const mid = pageWidth / 2;
  let left = 0, right = 0, span = 0;
  for (const l of lines) {
    if (l.x1 < mid + pageWidth * 0.05) left++;
    else if (l.x0 > mid - pageWidth * 0.05) right++;
    else span++;
  }
  if (left < 4 || right < 4 || span > (left + right) * 0.5) return lines;
  const spanning = [], leftCol = [], rightCol = [];
  for (const l of lines) {
    if (l.x1 < mid + pageWidth * 0.05) leftCol.push(l);
    else if (l.x0 > mid - pageWidth * 0.05) rightCol.push(l);
    else spanning.push(l);
  }
  return [...spanning, ...leftCol, ...rightCol];
}

function linesToBlocks(lines, bodySize, blocks) {
  let para = '', prev = null;
  const flush = () => {
    const t = para.trim();
    if (t) blocks.push({ type: 'p', text: t });
    para = '';
  };
  for (const line of lines) {
    if (/^\d{1,4}$/.test(line.text)) continue;
    const isHeading = line.h > bodySize * 1.15 && line.text.length < 120;
    if (isHeading) {
      flush();
      const level = line.h > bodySize * 1.45 ? 'h2' : 'h3';
      const last = blocks[blocks.length - 1];
      if (last && last.type === level && prev?.isHeading &&
          Math.abs(prev.y - line.y) < line.h * 2.2) {
        last.text += ' ' + line.text;
      } else {
        blocks.push({ type: level, text: line.text });
      }
      prev = { y: line.y, h: line.h, isHeading: true };
      continue;
    }
    if (prev && (prev.isHeading || prev.y - line.y > line.h * 1.9)) flush();
    if (para.endsWith('-')) para = para.slice(0, -1) + line.text;
    else para += (para ? ' ' : '') + line.text;
    prev = { y: line.y, h: line.h, isHeading: false };
  }
  flush();
}

async function extractBlocks(pdf, onProgress) {
  const blocks = [];
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
  return blocks.filter(b => b.text.trim() !== '');
}

/* ===================== 다크모드 ===================== */

function applyTheme(dark) {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const meta = document.getElementById('themeColorMeta');
  if (meta) meta.content = dark ? '#18181C' : '#F8F6F1';
  const btns = document.querySelectorAll('#darkBtn, #libDarkBtn');
  btns.forEach(b => { b.textContent = dark ? '☀️' : '🌙'; });
  localStorage.setItem('theme', dark ? 'dark' : 'light');
}

function toggleTheme() {
  applyTheme(document.documentElement.dataset.theme !== 'dark');
}

(function initTheme() {
  const saved = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved ? saved === 'dark' : prefersDark);
})();

/* ===================== 상태 ===================== */

const $ = id => document.getElementById(id);

let currentBook = null;
let saveTimer = null;

/* ===================== 서재 ===================== */

const COVER_GRADIENTS = [
  ['#5378B0','#3A5590'], ['#7A5FAF','#563C8A'],
  ['#3FA89C','#267A70'], ['#C96B3A','#A04A1E'],
  ['#4EA64E','#317A31'], ['#A64870','#7A2E50'],
  ['#8A7040','#605018'], ['#4070A0','#284E7E'],
];

function coverGradient(id) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) & 0x7FFFFFFF;
  const [c1, c2] = COVER_GRADIENTS[h % COVER_GRADIENTS.length];
  return `linear-gradient(145deg, ${c1}, ${c2})`;
}

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
      <button class="book-delete" aria-label="삭제">✕</button>
      <div class="book-cover" style="background:${coverGradient(b.id)}">
        <span class="book-cover-icon">📄</span>
      </div>
      <div class="book-title"></div>
      <div class="book-meta">${b.numPages}쪽 · ${pct}% 읽음</div>
      <div class="book-progress"><div class="book-progress-fill" style="width:${pct}%"></div></div>`;
    card.querySelector('.book-title').textContent = b.title;
    card.querySelector('.book-delete').onclick = async e => {
      e.stopPropagation();
      if (confirm(`"${b.title}" 을(를) 삭제할까요?`)) {
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
      if (t && t.length > 2 && !/^(untitled|about:blank|microsoft word|\d+)/i.test(t)) title = t;
    } catch { /* 파일명 사용 */ }

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

function blockHtml(blockIdx, text, highlights) {
  const marks = highlights
    .filter(h => h.block === blockIdx)
    .sort((a, b) => a.start - b.start);
  if (marks.length === 0) return escapeHtml(text);

  let html = '', pos = 0;
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

  ttsStop();
  $('libraryView').hidden = true;
  $('readerView').hidden = false;
  $('readerTitle').textContent = currentBook.title;
  renderReaderContent();

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
  ttsStop();
  saveProgressNow();
  currentBook = null;
  $('readerView').hidden = true;
  $('hlPanel').hidden = true;
  xlClose();
  $('libraryView').hidden = false;
  window.scrollTo(0, 0);
  renderLibrary();
}

/* ----- 진행률 ----- */

function topVisibleBlock() {
  const blocks = document.querySelectorAll('#readerContent .blk');
  const top = 70;
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

function offsetInBlock(blockEl, node, offset) {
  let total = 0;
  const walker = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT);
  let cur;
  while ((cur = walker.nextNode())) {
    if (cur === node) return total + offset;
    total += cur.length;
  }
  return offset === 0 ? 0 : total;
}

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

let pendingRanges = null;
let editingHlId = null;

function showSelMenu() {
  const sel = window.getSelection();
  if (!currentBook || !sel || sel.isCollapsed) { $('selMenu').hidden = true; return; }
  const ranges = selectionToRanges();
  if (!ranges) { $('selMenu').hidden = true; return; }

  pendingRanges = ranges;
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  const menu = $('selMenu');
  menu.hidden = false;
  const top = rect.top + window.scrollY - menu.offsetHeight - 10;
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
    ...r, note: '',
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
  if (hl) { hl.note = $('noteText').value.trim(); dbPut(currentBook); renderReaderContent(); }
  closeNotePopup();
}

function deleteHighlight() {
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

/* ----- 하이라이트 패널 ----- */

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
        setTimeout(() => (mark.style.outline = ''), 1400);
      }
    };
    list.appendChild(item);
  }
}

/* ===================== 번역 ===================== */

let xlPendingRanges = null;
let xlTranslated = '';

function detectLang(text) {
  const kor = (text.match(/[가-힣]/g) || []).length;
  return kor / text.length > 0.15 ? 'ko' : 'en';
}

async function xlFetch(text) {
  if (!text.trim()) return '';
  const src = detectLang(text);
  const tgt = src === 'ko' ? 'en' : 'ko';
  const label = src.toUpperCase() + ' → ' + tgt.toUpperCase();
  $('xlLangBadge').textContent = label;

  const url = 'https://api.mymemory.translated.net/get?q=' +
    encodeURIComponent(text.slice(0, 500)) + '&langpair=' + src + '|' + tgt;

  const resp = await fetch(url);
  if (!resp.ok) throw new Error('네트워크 오류');
  const data = await resp.json();
  if (data.responseStatus !== 200) throw new Error(data.responseMessage || '번역 실패');
  return data.responseData.translatedText;
}

function xlOpen(text, ranges) {
  xlPendingRanges = ranges || null;
  xlTranslated = '';

  $('xlOriginal').textContent = text.length > 180 ? text.slice(0, 180) + '…' : text;
  $('xlText').hidden = true;
  $('xlText').textContent = '';
  $('xlSpinner').hidden = false;
  $('xlActions').hidden = true;
  $('xlOverlay').hidden = false;
  $('xlSheet').hidden = false;

  xlFetch(text).then(result => {
    xlTranslated = result;
    $('xlSpinner').hidden = true;
    $('xlText').textContent = result;
    $('xlText').hidden = false;
    $('xlActions').hidden = false;
  }).catch(err => {
    $('xlSpinner').hidden = true;
    $('xlText').textContent = '번역에 실패했어요: ' + err.message;
    $('xlText').hidden = false;
  });
}

function xlClose() {
  $('xlSheet').hidden = true;
  $('xlOverlay').hidden = true;
  xlPendingRanges = null;
}

function xlTranslateSelection() {
  if (!pendingRanges) return;
  const text = pendingRanges.map(r => r.text).join(' ');
  const saved = pendingRanges;
  pendingRanges = null;
  window.getSelection().removeAllRanges();
  $('selMenu').hidden = true;
  xlOpen(text, saved);
}

function xlTranslateParagraph() {
  if (!currentBook) return;
  const idx = topVisibleBlock();
  const block = currentBook.blocks[idx];
  if (!block) return;
  xlOpen(block.text, null);
}

function xlSaveAsMemo() {
  if (!xlPendingRanges || !xlTranslated || !currentBook) return;
  const groupId = crypto.randomUUID();
  const created = xlPendingRanges.map((r, i) => ({
    id: xlPendingRanges.length === 1 ? groupId : `${groupId}-${i}`,
    ...r,
    note: xlTranslated,
  }));
  currentBook.highlights.push(...created);
  dbPut(currentBook);
  renderReaderContent();
  xlClose();
}

/* ===================== TTS (읽어주기) ===================== */

const TTS_RATES = [0.8, 1.0, 1.2, 1.5, 2.0];
let ttsRateIdx = 1;

const tts = {
  active: false,
  paused: false,
  blockIdx: 0,
};

function ttsPlayBlock(idx) {
  if (!('speechSynthesis' in window)) {
    alert('이 브라우저는 읽어주기 기능을 지원하지 않아요.');
    return;
  }
  window.speechSynthesis.cancel();

  if (!currentBook || idx >= currentBook.blocks.length) {
    ttsStop();
    return;
  }

  tts.active = true;
  tts.paused = false;
  tts.blockIdx = idx;

  document.querySelectorAll('.blk.tts-active').forEach(el => el.classList.remove('tts-active'));
  const blkEl = document.querySelector(`.blk[data-idx="${idx}"]`);
  if (blkEl) {
    blkEl.classList.add('tts-active');
    const topbarH = 54;
    const rect = blkEl.getBoundingClientRect();
    if (rect.top < topbarH || rect.bottom > window.innerHeight * 0.8) {
      blkEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  const text = currentBook.blocks[idx].text;
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = TTS_RATES[ttsRateIdx];
  utter.lang = detectLang(text) === 'ko' ? 'ko-KR' : 'en-US';
  utter.onend = () => { if (tts.active && !tts.paused) ttsPlayBlock(idx + 1); };
  utter.onerror = e => { if (e.error !== 'interrupted') ttsPlayBlock(idx + 1); };

  window.speechSynthesis.speak(utter);
  document.getElementById('readerView').classList.add('tts-active-padding');
  updateTtsUI();
}

function ttsPauseResume() {
  if (!tts.active) return;
  if (tts.paused) {
    window.speechSynthesis.resume();
    tts.paused = false;
  } else {
    window.speechSynthesis.pause();
    tts.paused = true;
  }
  updateTtsUI();
}

function ttsStop() {
  window.speechSynthesis?.cancel();
  tts.active = false;
  tts.paused = false;
  document.querySelectorAll('.blk.tts-active').forEach(el => el.classList.remove('tts-active'));
  document.getElementById('readerView')?.classList.remove('tts-active-padding');
  updateTtsUI();
}

function ttsStart() {
  if (tts.active) {
    ttsStop();
    return;
  }
  const startIdx = currentBook ? topVisibleBlock() : 0;
  ttsPlayBlock(startIdx);
}

function ttsNext() { if (tts.active) ttsPlayBlock(tts.blockIdx + 1); }
function ttsPrev() { if (tts.active) ttsPlayBlock(Math.max(0, tts.blockIdx - 1)); }

function ttsCycleRate() {
  ttsRateIdx = (ttsRateIdx + 1) % TTS_RATES.length;
  $('ttsRateBtn').textContent = TTS_RATES[ttsRateIdx].toFixed(1) + '×';
  if (tts.active) ttsPlayBlock(tts.blockIdx);
}

function updateTtsUI() {
  const bar = $('ttsBar');
  if (!tts.active) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  bar.classList.toggle('paused', tts.paused);

  const block = currentBook?.blocks[tts.blockIdx];
  $('ttsText').textContent = block
    ? block.text.slice(0, 70) + (block.text.length > 70 ? '…' : '')
    : '';

  $('ttsPlayIcon').hidden = !tts.paused;
  $('ttsPauseIcon').hidden = tts.paused;
  $('ttsRateBtn').textContent = TTS_RATES[ttsRateIdx].toFixed(1) + '×';
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
$('darkBtn').onclick = toggleTheme;
$('libDarkBtn').onclick = toggleTheme;

$('hlListBtn').onclick = () => {
  const panel = $('hlPanel');
  panel.hidden = !panel.hidden;
  if (!panel.hidden) renderHlPanel();
};
$('hlPanelClose').onclick = () => ($('hlPanel').hidden = true);

$('ttsBtn').onclick = ttsStart;
$('ttsPauseBtn').onclick = ttsPauseResume;
$('ttsNextBtn').onclick = ttsNext;
$('ttsPrevBtn').onclick = ttsPrev;
$('ttsStopBtn').onclick = ttsStop;
$('ttsRateBtn').onclick = ttsCycleRate;

$('xlParaBtn').onclick = xlTranslateParagraph;
$('xlOverlay').onclick = xlClose;
$('xlClose').onclick = xlClose;
$('xlCopy').onclick = () => {
  navigator.clipboard.writeText(xlTranslated).then(() => {
    const btn = $('xlCopy');
    btn.textContent = '복사됨 ✓';
    setTimeout(() => { btn.textContent = '복사'; }, 1500);
  });
};
$('xlMemo').onclick = xlSaveAsMemo;

$('selMenu').addEventListener('mousedown', e => e.preventDefault());
$('selMenu').addEventListener('touchstart', e => e.preventDefault(), { passive: false });
$('selHighlight').onclick = () => addHighlight(false);
$('selMemo').onclick = () => addHighlight(true);
$('selTranslate').onclick = xlTranslateSelection;

$('noteSave').onclick = saveNote;
$('noteDelete').onclick = deleteHighlight;

document.addEventListener('selectionchange', () => {
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

// iOS에서 SpeechSynthesis가 백그라운드에서 멈추는 현상 방지
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && tts.active && !tts.paused) {
    window.speechSynthesis.resume();
  }
});

/* ===================== 초기화 ===================== */

applyFontSize();
renderLibrary();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
