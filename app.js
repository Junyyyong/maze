'use strict';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

/* ===================== IndexedDB ===================== */

const DB_NAME = 'paperShelf';
const STORE   = 'books';

// iOS Safari는 매번 openDB()를 새로 열면 "connection lost" 에러가 발생함
// 싱글턴으로 관리하고 연결이 끊기면 재연결
let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((res, rej) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = e => {
        e.target.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = e => {
        const db = e.target.result;
        db.onclose = () => { _dbPromise = null; }; // 연결 끊기면 재연결 허용
        db.onversionchange = () => { db.close(); _dbPromise = null; };
        res(db);
      };
      req.onerror = e => {
        _dbPromise = null;
        rej(e.target.error);
      };
      req.onblocked = () => {
        _dbPromise = null;
        rej(new Error('DB blocked'));
      };
    } catch (e) {
      _dbPromise = null;
      rej(e);
    }
  });
  return _dbPromise;
}

// iOS Safari IDB 작업 실패 시 한 번 재시도
async function withDB(fn) {
  try {
    const db = await openDB();
    return await fn(db);
  } catch (err) {
    // 연결 끊김 에러면 캐시 초기화 후 재시도
    if (/connection|lost|closed/i.test(err.message || '')) {
      _dbPromise = null;
      const db = await openDB();
      return await fn(db);
    }
    throw err;
  }
}

async function dbPut(book) {
  return withDB(db => new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(book);
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
    tx.onabort  = () => rej(tx.error);
  }));
}
async function dbGetAll() {
  return withDB(db => new Promise((res, rej) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    req.onsuccess = () => res(req.result);
    req.onerror  = () => rej(req.error);
  }));
}
async function dbGet(id) {
  return withDB(db => new Promise((res, rej) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
    req.onsuccess = () => res(req.result);
    req.onerror  = () => rej(req.error);
  }));
}
async function dbDelete(id) {
  return withDB(db => new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
    tx.onabort  = () => rej(tx.error);
  }));
}

/* ===================== PDF 추출 ===================== */

function groupIntoLines(items) {
  const frags = items.filter(it => it.str.trim()).map(it => ({
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
  }).filter(l => l.text);
}

function reorderColumns(lines, pageWidth) {
  const mid = pageWidth / 2;
  let left = 0, right = 0, span = 0;
  for (const l of lines) {
    if      (l.x1 < mid + pageWidth * 0.05) left++;
    else if (l.x0 > mid - pageWidth * 0.05) right++;
    else span++;
  }
  if (left < 4 || right < 4 || span > (left + right) * 0.5) return lines;
  const spanning = [], leftCol = [], rightCol = [];
  for (const l of lines) {
    if      (l.x1 < mid + pageWidth * 0.05) leftCol.push(l);
    else if (l.x0 > mid - pageWidth * 0.05) rightCol.push(l);
    else spanning.push(l);
  }
  return [...spanning, ...leftCol, ...rightCol];
}

function linesToBlocks(lines, bodySize, blocks) {
  let para = '', prev = null;
  const flush = () => { const t = para.trim(); if (t) blocks.push({ type: 'p', text: t }); para = ''; };
  for (const line of lines) {
    if (/^\d{1,4}$/.test(line.text)) continue;
    const isHeading = line.h > bodySize * 1.15 && line.text.length < 120;
    if (isHeading) {
      flush();
      const level = line.h > bodySize * 1.45 ? 'h2' : 'h3';
      const last = blocks[blocks.length - 1];
      if (last && last.type === level && prev?.isHeading && Math.abs(prev.y - line.y) < line.h * 2.2)
        last.text += ' ' + line.text;
      else blocks.push({ type: level, text: line.text });
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

/* ── 그림 영역 감지 ─────────────────────────────── */

// 방법 1: PDF operator list에서 실제 이미지 드로우 명령 추출 (래스터 이미지용)
async function getImageRects(page) {
  const OPS = pdfjsLib.OPS;
  let opList;
  try { opList = await page.getOperatorList(); } catch { return []; }

  const IMAGE_OPS = new Set(
    [OPS.paintImageXObject, OPS.paintInlineImageXObject,
     OPS.paintImageMaskXObject, OPS.paintJpegXObject,
     OPS.paintImageXObjectRepeat].filter(Boolean));

  const regions = [];
  let ctm = [1,0,0,1,0,0];
  const stack = [];
  const mul = (m,[a,b,c,d,e,f]) => [
    m[0]*a+m[2]*b, m[1]*a+m[3]*b,
    m[0]*c+m[2]*d, m[1]*c+m[3]*d,
    m[0]*e+m[2]*f+m[4], m[1]*e+m[3]*f+m[5],
  ];

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i], args = opList.argsArray[i];
    if      (fn === OPS.save)      stack.push([...ctm]);
    else if (fn === OPS.restore)   { if (stack.length) ctm = stack.pop(); }
    else if (fn === OPS.transform) ctm = mul(ctm, args);
    else if (IMAGE_OPS.has(fn)) {
      const pts = [[0,0],[1,0],[0,1],[1,1]].map(([x,y]) =>
        [ctm[0]*x+ctm[2]*y+ctm[4], ctm[1]*x+ctm[3]*y+ctm[5]]);
      const xs = pts.map(p=>p[0]), ys = pts.map(p=>p[1]);
      const r = { xMin:Math.min(...xs), xMax:Math.max(...xs),
                  yMin:Math.min(...ys), yMax:Math.max(...ys) };
      if (r.xMax-r.xMin > 20 && r.yMax-r.yMin > 20) regions.push(r);
    }
  }

  if (!regions.length) return [];
  regions.sort((a,b) => a.yMin - b.yMin);
  const merged = [];
  for (const r of regions) {
    const last = merged[merged.length-1];
    if (last && r.yMin < last.yMax + 12) {
      last.xMin=Math.min(last.xMin,r.xMin); last.xMax=Math.max(last.xMax,r.xMax);
      last.yMin=Math.min(last.yMin,r.yMin); last.yMax=Math.max(last.yMax,r.yMax);
    } else merged.push({...r});
  }
  return merged;
}

// 방법 2: 본문 텍스트 사이 큰 공백 감지 (벡터 그래픽/표 용 fallback)
// 축 레이블 같은 작은 텍스트(h < 0.65 * bodySize)는 무시
function findFigureGaps(lines, pageH, bodySize) {
  const bodyLines = lines.filter(l => l.h >= bodySize * 0.65);
  if (bodyLines.length < 2) return [];
  const MIN_GAP = bodySize * 2.0; // 낮춘 임계값
  const MARGIN  = bodySize * 1.5;
  const sorted  = [...bodyLines].sort((a, b) => b.y - a.y);
  const gaps    = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const above = sorted[i], below = sorted[i + 1];
    const yTop    = above.y;
    const yBottom = below.y + below.h;
    const gap = yTop - yBottom;
    if (gap > MIN_GAP && yBottom > MARGIN && yTop < pageH - MARGIN)
      gaps.push({ yTop, yBottom });
  }
  return gaps;
}

function cropCanvasRegion(canvas, pdfYTop, pdfYBottom, pageH, scale) {
  const pad = Math.round(3 * scale);
  const cy  = Math.max(0, Math.floor((pageH - pdfYTop) * scale) - pad);
  const ch  = Math.min(canvas.height - cy,
               Math.ceil((pdfYTop - pdfYBottom) * scale) + pad * 2);
  if (ch < 16) return Promise.resolve(null);
  return new Promise(res => {
    const tmp = document.createElement('canvas');
    tmp.width = canvas.width; tmp.height = ch;
    tmp.getContext('2d').drawImage(canvas, 0, cy, canvas.width, ch, 0, 0, canvas.width, ch);
    tmp.toBlob(b => res(b && b.size > 1500 ? b : null), 'image/jpeg', 0.85);
  });
}

async function renderPageCanvas(page, scale = 1.5) {
  const vp = page.getViewport({ scale });
  const cv = document.createElement('canvas');
  cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
  await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
  return { cv, vp };
}

/* ── extractBlocks ─────────────────────────────── */

async function extractBlocks(pdf, onProgress) {
  const blocks = [], sizes = [];
  for (let p = 1; p <= Math.min(3, pdf.numPages); p++) {
    const page = await pdf.getPage(p);
    for (const l of groupIntoLines((await page.getTextContent()).items)) sizes.push(Math.round(l.h));
  }
  const freq = {};
  for (const s of sizes) freq[s] = (freq[s] || 0) + 1;
  const bodySize = Number(Object.keys(freq).sort((a, b) => freq[b] - freq[a])[0]) || 10;

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const { width: pageW, height: pageH } = page.getViewport({ scale: 1 });

    // 텍스트 + 이미지 rect 병렬 취득
    const [content, imageRects] = await Promise.all([
      page.getTextContent(),
      getImageRects(page),
    ]);
    let lines = groupIntoLines(content.items);
    lines = reorderColumns(lines, pageW);

    // 텍스트 없는 페이지 → 전체 그림
    if (lines.length === 0) {
      const { cv } = await renderPageCanvas(page, 1.5);
      const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.80));
      if (blob && blob.size > 2000) blocks.push({ type: 'fig', blob });
      onProgress(p, pdf.numPages); continue;
    }

    // 래스터 이미지 없으면 갭 감지로 벡터 그래픽 탐지
    const rects = imageRects.length
      ? imageRects
      : findFigureGaps(lines, pageH, bodySize).map(g =>
          ({ xMin: 0, xMax: pageW, yMin: g.yBottom, yMax: g.yTop }));

    if (!rects.length) {
      linesToBlocks(lines, bodySize, blocks);
      onProgress(p, pdf.numPages); continue;
    }

    const SCALE = 1.5;
    const { cv } = await renderPageCanvas(page, SCALE);

    // 이미지 rect와 텍스트 라인을 위→아래 순으로 인터리브
    const sortedImgs  = [...rects].sort((a,b) => b.yMax - a.yMax);
    const sortedLines = [...lines].sort((a,b) => b.y - a.y);
    let ptr = 0;

    for (const img of sortedImgs) {
      // 이 이미지 위의 텍스트 라인
      const seg = [];
      while (ptr < sortedLines.length && sortedLines[ptr].y > img.yMax + bodySize * 0.3)
        seg.push(sortedLines[ptr++]);
      linesToBlocks(seg, bodySize, blocks);

      // 그림 영역 캡처
      const blob = await cropCanvasRegion(cv, img.yMax, img.yMin, pageH, SCALE);
      if (blob) blocks.push({ type: 'fig', blob });

      // 이미지 내부 텍스트 항목(축 레이블 등) 건너뜀
      while (ptr < sortedLines.length && sortedLines[ptr].y >= img.yMin - bodySize * 0.5)
        ptr++;
    }
    // 이미지 아래 남은 텍스트
    linesToBlocks(sortedLines.slice(ptr), bodySize, blocks);

    onProgress(p, pdf.numPages);
  }
  return blocks.filter(b => b.type === 'fig' || b.text?.trim());
}

/* ===================== 테마 ===================== */

const THEMES      = ['light', 'sepia', 'dark'];
const THEME_ICONS = { light: '☀', sepia: '📖', dark: '🌙' };
const THEME_META  = { light: '#F5F5F5', sepia: '#F0E6D0', dark: '#0F1013' };

function applyTheme(name) {
  document.documentElement.dataset.theme = name;
  const meta = document.getElementById('themeColorMeta');
  if (meta) meta.content = THEME_META[name];
  // 아이콘 업데이트
  const icon = THEME_ICONS[name];
  const libBtn = document.getElementById('libThemeBtn');
  const pickIcon = document.getElementById('themePickIcon');
  if (libBtn) libBtn.textContent = icon;
  if (pickIcon) pickIcon.textContent = icon;
  // 테마 칩 활성화
  document.querySelectorAll('.theme-chip').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.t === name));
  localStorage.setItem('readerTheme', name);
}

function cycleTheme() {
  const cur = document.documentElement.dataset.theme || 'sepia';
  applyTheme(THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length]);
}

/* ===================== 리더 UI 자동 숨김 ===================== */

let uiTimer = null;

function showReaderUi(autoHide = false) {
  document.getElementById('readerView').classList.add('ui-on');
  clearTimeout(uiTimer);
  if (autoHide) uiTimer = setTimeout(hideReaderUi, 3000);
}

function hideReaderUi() {
  clearTimeout(uiTimer);
  document.getElementById('readerView').classList.remove('ui-on');
  closePanels();
}

function toggleReaderUi() {
  const rv = document.getElementById('readerView');
  if (rv.classList.contains('ui-on')) hideReaderUi();
  else showReaderUi(false);
}

function closePanels() {
  document.getElementById('fontPanel').hidden  = true;
  document.getElementById('themePanel').hidden = true;
}

/* ===================== 글자 크기 패널 ===================== */

function applyFontSize() {
  const size = Number(localStorage.getItem('readerFontSize') || 19);
  document.documentElement.style.setProperty('--reader-font-size', size + 'px');
}

function changeFontSize(delta) {
  let size = Number(localStorage.getItem('readerFontSize') || 19) + delta;
  size = Math.max(14, Math.min(28, size));
  localStorage.setItem('readerFontSize', size);
  applyFontSize();
  updateFontDots();
}

function updateFontDots() {
  const size  = Number(localStorage.getItem('readerFontSize') || 19);
  const level = size <= 15 ? 1 : size <= 17 ? 2 : size <= 20 ? 3 : size <= 23 ? 4 : 5;
  document.querySelectorAll('#fontDots span').forEach((dot, i) =>
    dot.classList.toggle('active', i < level));
}

function toggleFontPanel() {
  const fp = document.getElementById('fontPanel');
  document.getElementById('themePanel').hidden = true;
  fp.hidden = !fp.hidden;
  if (!fp.hidden) updateFontDots();
}

function toggleThemePanel() {
  const tp = document.getElementById('themePanel');
  document.getElementById('fontPanel').hidden = true;
  tp.hidden = !tp.hidden;
}

/* ===================== 상태 ===================== */

const $ = id => document.getElementById(id);
let currentBook = null;
let saveTimer   = null;

/* ===================== 서재 ===================== */

const COVER_GRADIENTS = [
  ['#4D6FA3','#2E4F82'], ['#7057A8','#4E3580'],
  ['#3A9890','#236A64'], ['#C0623A','#944018'],
  ['#4A9A4A','#2E7030'], ['#A04070','#6E244C'],
  ['#806838','#5A4418'], ['#3868A0','#1E4878'],
];
function coverGradient(id) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) & 0x7FFFFFFF;
  const [c1, c2] = COVER_GRADIENTS[h % COVER_GRADIENTS.length];
  return `linear-gradient(160deg, ${c1}, ${c2})`;
}

async function renderLibrary() {
  const books = await dbGetAll();
  books.sort((a, b) => (b.lastReadAt || b.addedAt) - (a.lastReadAt || a.addedAt));
  const grid = $('bookGrid');
  grid.innerHTML = '';
  $('libHint').hidden = books.length > 0;

  for (const b of books) {
    const pct  = Math.round((b.progress?.percent || 0) * 100);
    const card = document.createElement('div');
    card.className = 'book-card';
    card.style.position = 'relative';
    card.innerHTML = `
      <button class="book-del-btn" aria-label="삭제">✕</button>
      <div class="book-cover" style="background:${coverGradient(b.id)}">
        <span class="book-cover-icon">📄</span>
      </div>
      <div class="book-title"></div>
      <div class="book-meta">${b.numPages}쪽 · ${pct}% 읽음</div>
      <div class="book-progress-bar"><div class="book-progress-fill" style="width:${pct}%"></div></div>`;
    card.querySelector('.book-title').textContent = b.title;
    card.querySelector('.book-del-btn').onclick = async e => {
      e.stopPropagation();
      if (confirm(`"${b.title}"을(를) 삭제할까요?`)) { await dbDelete(b.id); renderLibrary(); }
    };
    card.onclick = () => openBook(b.id);
    grid.appendChild(card);
  }
}

async function addPdf(file) {
  $('extractOverlay').hidden = false;
  $('extractMsg').textContent = 'PDF 여는 중…';
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
      $('extractMsg').textContent = `텍스트 추출 중… ${done}/${total}쪽`;
    });
    if (!blocks.length) { alert('텍스트를 추출하지 못했어요. 스캔본(이미지) PDF는 지원되지 않습니다.'); return; }

    await dbPut({
      id: crypto.randomUUID(), title,
      fileName: file.name, numPages: pdf.numPages,
      addedAt: Date.now(), lastReadAt: null,
      pdfBlob: new Blob([buf], { type: 'application/pdf' }),
      blocks, progress: { block: 0, percent: 0 }, highlights: [],
    });
    renderLibrary();
  } catch (err) {
    console.error(err);
    const msg = err.message || '';
    if (/connection|lost|quota|storage|blocked/i.test(msg)) {
      alert('저장 공간 오류가 발생했어요.\n\n해결 방법:\n1. Safari 설정 > 개인 정보 보호 > "모든 쿠키 차단" 꺼주기\n2. 일반 탭(비공개 탭 아님)에서 열기\n3. 기기 저장 공간 확인 후 재시도');
    } else {
      alert('PDF를 처리하지 못했어요.\n' + msg);
    }
  } finally {
    $('extractOverlay').hidden = true;
  }
}

/* ===================== 리더 ===================== */

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function blockHtml(idx, text, highlights) {
  const marks = highlights.filter(h => h.block === idx).sort((a, b) => a.start - b.start);
  if (!marks.length) return escapeHtml(text);
  let html = '', pos = 0;
  for (const m of marks) {
    const start = Math.max(pos, m.start);
    if (start >= m.end) continue;
    html += escapeHtml(text.slice(pos, start));
    html += `<mark class="${m.note ? 'hl has-note' : 'hl'}" data-hl="${m.id}">` +
            escapeHtml(text.slice(start, m.end)) + '</mark>';
    pos = m.end;
  }
  return html + escapeHtml(text.slice(pos));
}

function renderReaderContent() {
  const el = $('readerContent');
  el.querySelectorAll('img[data-fig]').forEach(img => URL.revokeObjectURL(img.src));
  el.innerHTML = '';
  const frag = document.createDocumentFragment();
  currentBook.blocks.forEach((b, i) => {
    let node;
    if (b.type === 'fig') {
      node = document.createElement('div');
      node.className = 'blk fig-block';
      const img = document.createElement('img');
      img.src = URL.createObjectURL(b.blob);
      img.alt = 'Figure'; img.loading = 'lazy'; img.dataset.fig = '1';
      node.appendChild(img);
    } else {
      node = document.createElement(b.type === 'p' ? 'p' : b.type);
      node.className = 'blk';
      node.innerHTML = blockHtml(i, b.text, currentBook.highlights);
    }
    node.dataset.idx = i;
    frag.appendChild(node);
  });
  el.appendChild(frag);
}

async function openBook(id) {
  currentBook = await dbGet(id);
  if (!currentBook) return;

  ttsStop();
  $('libraryView').hidden = true;
  $('readerView').hidden  = false;
  $('readerTitle').textContent = currentBook.title;
  renderReaderContent();

  const rc = $('readerContent');
  const target = rc.querySelector(`.blk[data-idx="${currentBook.progress.block}"]`);
  requestAnimationFrame(() => {
    if (target && currentBook.progress.block > 0) {
      target.scrollIntoView();
      rc.scrollBy(0, -20);
    } else {
      rc.scrollTo(0, 0);
    }
    updateProgressUI();
    showReaderUi(true); // 열리면 3초 후 자동 숨김
  });

  currentBook.lastReadAt = Date.now();
  dbPut(currentBook);
}

function closeBook() {
  hideReaderUi();
  clearTimeout(uiTimer);
  ttsStop();
  saveProgressNow();
  $('readerContent').querySelectorAll('img[data-fig]').forEach(img => URL.revokeObjectURL(img.src));
  currentBook = null;
  $('readerView').hidden  = true;
  $('hlPanel').hidden     = true;
  xlClose();
  $('libraryView').hidden = false;
  renderLibrary();
}

/* ----- 진행률 ----- */

function topVisibleBlock() {
  const rc  = $('readerContent');
  const top = rc.getBoundingClientRect().top + 10;
  const blocks = rc.querySelectorAll('.blk');
  for (const el of blocks) if (el.getBoundingClientRect().bottom > top) return Number(el.dataset.idx);
  return blocks.length - 1;
}

function updateProgressUI() {
  if (!currentBook) return;
  const rc       = $('readerContent');
  const scrollable = rc.scrollHeight - rc.clientHeight;
  const percent    = scrollable > 0 ? Math.min(1, rc.scrollTop / scrollable) : 1;
  $('progressFill').style.width  = (percent * 100) + '%';
  $('progressLabel').textContent = Math.round(percent * 100) + '%';
  currentBook.progress = { block: topVisibleBlock(), percent };
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveProgressNow, 800);
}

function saveProgressNow() {
  clearTimeout(saveTimer);
  if (currentBook) dbPut(currentBook);
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
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const range   = sel.getRangeAt(0);
  const blockOf = node => {
    const el = node.nodeType === 1 ? node : node.parentElement;
    return el?.closest('#readerContent .blk') || null;
  };
  const startBlk = blockOf(range.startContainer);
  const endBlk   = blockOf(range.endContainer);
  if (!startBlk || !endBlk) return null;
  const sIdx = Number(startBlk.dataset.idx);
  const eIdx = Number(endBlk.dataset.idx);
  const ranges = [];
  for (let i = sIdx; i <= eIdx; i++) {
    const blkEl = $('readerContent').querySelector(`.blk[data-idx="${i}"]`);
    if (!blkEl) continue;
    const full  = currentBook.blocks[i].text;
    const start = i === sIdx ? offsetInBlock(startBlk, range.startContainer, range.startOffset) : 0;
    const end   = i === eIdx ? offsetInBlock(endBlk,   range.endContainer,   range.endOffset)   : full.length;
    if (end > start) ranges.push({ block: i, start, end, text: full.slice(start, end) });
  }
  return ranges.length ? ranges : null;
}

let pendingRanges = null;
let editingHlId   = null;

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
  menu.style.top  = Math.max(window.scrollY + 60, top) + 'px';
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
  const popup  = $('notePopup');
  popup.hidden = false;
  const markEl = $('readerContent').querySelector(`mark[data-hl="${hlId}"]`);
  if (markEl) {
    const rect = markEl.getBoundingClientRect();
    popup.style.top  = (rect.bottom + window.scrollY + 8) + 'px';
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

function closeNotePopup() { $('notePopup').hidden = true; editingHlId = null; }

function renderHlPanel() {
  const list = $('hlPanelList');
  list.innerHTML = '';
  const hls = [...currentBook.highlights].sort((a, b) => a.block - b.block || a.start - b.start);
  if (!hls.length) { list.innerHTML = '<div class="hl-empty">아직 하이라이트가 없어요.<br>텍스트를 드래그해 보세요.</div>'; return; }
  for (const h of hls) {
    const item = document.createElement('div');
    item.className = 'hl-item';
    const q = document.createElement('span'); q.className = 'q';
    q.textContent = h.text.length > 90 ? h.text.slice(0, 90) + '…' : h.text;
    item.appendChild(q);
    if (h.note) {
      const n = document.createElement('span'); n.className = 'n';
      n.textContent = '📝 ' + h.note;
      item.appendChild(n);
    }
    item.onclick = () => {
      $('hlPanel').hidden = true;
      const mark = $('readerContent').querySelector(`mark[data-hl="${h.id}"]`);
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
let xlTranslated    = '';

function detectLang(text) {
  const kor = (text.match(/[가-힣]/g) || []).length;
  return kor / text.length > 0.15 ? 'ko' : 'en';
}

async function xlFetch(text) {
  if (!text.trim()) return '';
  const src = detectLang(text);
  const tgt = src === 'ko' ? 'en' : 'ko';
  $('xlLangBadge').textContent = src.toUpperCase() + ' → ' + tgt.toUpperCase();
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
  xlTranslated    = '';
  $('xlOriginal').textContent = text.length > 180 ? text.slice(0, 180) + '…' : text;
  $('xlText').hidden   = true;
  $('xlText').textContent = '';
  $('xlSpinner').hidden = false;
  $('xlActions').hidden = true;
  $('xlOverlay').hidden = false;
  $('xlSheet').hidden  = false;
  xlFetch(text).then(r => {
    xlTranslated = r;
    $('xlSpinner').hidden = true;
    $('xlText').textContent = r;
    $('xlText').hidden   = false;
    $('xlActions').hidden = false;
  }).catch(err => {
    $('xlSpinner').hidden = true;
    $('xlText').textContent = '번역에 실패했어요: ' + err.message;
    $('xlText').hidden = false;
  });
}

function xlClose() {
  $('xlSheet').hidden  = true;
  $('xlOverlay').hidden = true;
  xlPendingRanges = null;
}

function xlTranslateSelection() {
  if (!pendingRanges) return;
  const text  = pendingRanges.map(r => r.text).join(' ');
  const saved = pendingRanges;
  pendingRanges = null;
  window.getSelection().removeAllRanges();
  $('selMenu').hidden = true;
  xlOpen(text, saved);
}

function xlTranslateParagraph() {
  if (!currentBook) return;
  const block = currentBook.blocks[topVisibleBlock()];
  if (block) xlOpen(block.text, null);
}

function xlSaveAsMemo() {
  if (!xlPendingRanges || !xlTranslated || !currentBook) return;
  const groupId = crypto.randomUUID();
  const created = xlPendingRanges.map((r, i) => ({
    id: xlPendingRanges.length === 1 ? groupId : `${groupId}-${i}`,
    ...r, note: xlTranslated,
  }));
  currentBook.highlights.push(...created);
  dbPut(currentBook);
  renderReaderContent();
  xlClose();
}

/* ===================== TTS ===================== */

const TTS_RATES = [0.8, 1.0, 1.2, 1.5, 2.0];
let ttsRateIdx  = 1;
const tts = { active: false, paused: false, blockIdx: 0 };

function ttsPlayBlock(idx) {
  if (!('speechSynthesis' in window)) { alert('이 브라우저는 읽어주기를 지원하지 않아요.'); return; }
  window.speechSynthesis.cancel();
  if (!currentBook || idx >= currentBook.blocks.length) { ttsStop(); return; }
  // 그림 블록은 건너뜀
  if (currentBook.blocks[idx].type === 'fig') { ttsPlayBlock(idx + 1); return; }

  tts.active = true; tts.paused = false; tts.blockIdx = idx;

  $('readerContent').querySelectorAll('.blk.tts-active').forEach(el => el.classList.remove('tts-active'));
  const blkEl = $('readerContent').querySelector(`.blk[data-idx="${idx}"]`);
  if (blkEl) {
    blkEl.classList.add('tts-active');
    blkEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  const text  = currentBook.blocks[idx].text;
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate  = TTS_RATES[ttsRateIdx];
  utter.lang  = detectLang(text) === 'ko' ? 'ko-KR' : 'en-US';
  utter.onend   = () => { if (tts.active && !tts.paused) ttsPlayBlock(idx + 1); };
  utter.onerror = e => { if (e.error !== 'interrupted') ttsPlayBlock(idx + 1); };
  window.speechSynthesis.speak(utter);
  document.body.classList.add('tts-on');
  updateTtsUI();
}

function ttsPauseResume() {
  if (!tts.active) return;
  if (tts.paused) { window.speechSynthesis.resume(); tts.paused = false; }
  else             { window.speechSynthesis.pause();  tts.paused = true; }
  updateTtsUI();
}

function ttsStop() {
  window.speechSynthesis?.cancel();
  tts.active = false; tts.paused = false;
  $('readerContent')?.querySelectorAll('.blk.tts-active').forEach(el => el.classList.remove('tts-active'));
  document.body.classList.remove('tts-on');
  updateTtsUI();
}

function ttsStart() {
  if (tts.active) { ttsStop(); return; }
  ttsPlayBlock(currentBook ? topVisibleBlock() : 0);
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
  if (!tts.active) { bar.hidden = true; return; }
  bar.hidden = false;
  bar.classList.toggle('paused', tts.paused);
  const block = currentBook?.blocks[tts.blockIdx];
  const blockTxt = block?.text || '';
  $('ttsText').textContent = blockTxt.length > 65 ? blockTxt.slice(0, 65) + '…' : blockTxt;
  $('ttsPlayIcon').hidden  = !tts.paused;
  $('ttsPauseIcon').hidden = tts.paused;
  $('ttsRateBtn').textContent = TTS_RATES[ttsRateIdx].toFixed(1) + '×';
}

/* ===================== 이벤트 바인딩 ===================== */

$('fileInput').addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) addPdf(file);
  e.target.value = '';
});

// 서재
$('libThemeBtn').onclick = cycleTheme;

// 리더 상단 바
$('backBtn').onclick = closeBook;

// 하단 툴바
$('fontBtn').onclick      = toggleFontPanel;
$('themePickBtn').onclick = toggleThemePanel;
$('ttsBtn').onclick       = ttsStart;
$('xlParaBtn').onclick    = xlTranslateParagraph;
$('hlListBtn').onclick    = () => {
  const p = $('hlPanel');
  p.hidden = !p.hidden;
  if (!p.hidden) renderHlPanel();
};
$('hlPanelClose').onclick = () => ($('hlPanel').hidden = true);

// 글자 크기·테마 패널
$('fontDownBtn').onclick = () => changeFontSize(-1);
$('fontUpBtn').onclick   = () => changeFontSize(+1);
document.querySelectorAll('.theme-chip').forEach(btn =>
  btn.onclick = () => applyTheme(btn.dataset.t));

// 선택 메뉴
$('selMenu').addEventListener('mousedown', e => e.preventDefault());
$('selMenu').addEventListener('touchstart', e => e.preventDefault(), { passive: false });
$('selHighlight').onclick  = () => addHighlight(false);
$('selMemo').onclick       = () => addHighlight(true);
$('selTranslate').onclick  = xlTranslateSelection;

// 메모 팝업
$('noteSave').onclick   = saveNote;
$('noteDelete').onclick = deleteHighlight;

// 번역 시트
$('xlOverlay').onclick = xlClose;
$('xlClose').onclick   = xlClose;
$('xlCopy').onclick    = () => {
  navigator.clipboard.writeText(xlTranslated).then(() => {
    const btn = $('xlCopy');
    btn.textContent = '복사됨 ✓';
    setTimeout(() => { btn.textContent = '복사'; }, 1500);
  });
};
$('xlMemo').onclick = xlSaveAsMemo;

// TTS
$('ttsPauseBtn').onclick = ttsPauseResume;
$('ttsNextBtn').onclick  = ttsNext;
$('ttsPrevBtn').onclick  = ttsPrev;
$('ttsStopBtn').onclick  = ttsStop;
$('ttsRateBtn').onclick  = ttsCycleRate;

// 본문 탭 → UI 토글 / 하이라이트 클릭
$('readerContent').addEventListener('click', e => {
  const mark = e.target.closest('mark.hl');
  if (mark) { openNotePopupFor(mark.dataset.hl); return; }
  if (e.target.closest('#notePopup, #selMenu')) return;
  if (!window.getSelection().isCollapsed) return;
  toggleReaderUi();
});

// 텍스트 선택
document.addEventListener('selectionchange', () => {
  if (window.getSelection().isCollapsed)
    setTimeout(() => { if (window.getSelection().isCollapsed) $('selMenu').hidden = true; }, 150);
});
document.addEventListener('mouseup', e => {
  if (currentBook && !$('selMenu').contains(e.target)) setTimeout(showSelMenu, 10);
});
document.addEventListener('touchend', e => {
  if (currentBook && !$('selMenu').contains(e.target)) setTimeout(showSelMenu, 300);
});

// 스크롤 (readerContent 내부)
$('readerContent').addEventListener('scroll', () => {
  if (currentBook) updateProgressUI();
}, { passive: true });

window.addEventListener('beforeunload', saveProgressNow);

// iOS 백그라운드 TTS 복구
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && tts.active && !tts.paused) window.speechSynthesis.resume();
});

/* ===================== e-ink 모드 ===================== */

function applyEink(on) {
  if (on) {
    document.documentElement.dataset.eink = '';
    document.documentElement.dataset.theme = 'light';
    localStorage.setItem('einkMode', '1');
  } else {
    delete document.documentElement.dataset.eink;
    localStorage.removeItem('einkMode');
    applyTheme(localStorage.getItem('readerTheme') || 'sepia');
  }
}

// e-ink 버튼 토글
const einkBtnEl = document.getElementById('einkBtn');
if (einkBtnEl) {
  einkBtnEl.onclick = () => applyEink(!document.documentElement.hasAttribute('data-eink'));
}

// Onyx Boox / e-ink 기기 자동 감지 (userAgent or low-color-gamut)
const isEink = /onyx|boox|kindle|kobo|remarkable|pocketbook/i.test(navigator.userAgent)
  || window.matchMedia?.('(color-gamut: srgb)').matches === false;

if (localStorage.getItem('einkMode') === '1' || isEink) {
  applyEink(true);
}

/* ===================== 초기화 ===================== */

// 테마
const savedTheme = localStorage.getItem('readerTheme') || 'sepia';
if (!localStorage.getItem('einkMode')) applyTheme(savedTheme);

applyFontSize();
renderLibrary();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// iOS Safari에서 IndexedDB 데이터가 임의로 지워지지 않도록 영구 저장 요청
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist();
}

// DB를 미리 열어 첫 PDF 추가 시 연결 지연 방지
openDB().catch(() => {});
