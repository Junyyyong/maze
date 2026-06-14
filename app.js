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
    let text = '', prevEnd = null, maxGap = 0;
    for (const f of l.frags) {
      if (prevEnd !== null) {
        const gap = f.x - prevEnd;
        if (gap > maxGap) maxGap = gap;
        if (gap > f.h * 0.25 && !text.endsWith(' ')) text += ' ';
      }
      text += f.str;
      prevEnd = f.x + f.w;
    }
    const h = Math.max(...l.frags.map(f => f.h));
    return {
      text: text.replace(/\s+/g, ' ').trim(),
      y: l.y,
      x0: Math.min(...l.frags.map(f => f.x)),
      x1: Math.max(...l.frags.map(f => f.x + f.w)),
      h, maxGap,
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

// PDF 연산자 리스트에서 임베드 이미지의 bbox + 이름을 수집
async function getImageRects(page) {
  const OPS = pdfjsLib.OPS;
  let opList;
  try { opList = await page.getOperatorList(); } catch { return []; }

  const IMAGE_OPS = new Set(
    [OPS.paintImageXObject, OPS.paintInlineImageXObject,
     OPS.paintImageMaskXObject, OPS.paintJpegXObject,
     OPS.paintImageXObjectRepeat].filter(Boolean));

  const mul = (m, [a,b,c,d,e,f]) => [
    m[0]*a+m[2]*b, m[1]*a+m[3]*b,
    m[0]*c+m[2]*d, m[1]*c+m[3]*d,
    m[0]*e+m[2]*f+m[4], m[1]*e+m[3]*f+m[5],
  ];

  const rects = [];
  let ctm = [1,0,0,1,0,0];
  const stack = [];
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
                  yMin:Math.min(...ys), yMax:Math.max(...ys), name: args[0] };
      if (r.xMax-r.xMin > 40 && r.yMax-r.yMin > 40) rects.push(r);
    }
  }
  return rects;
}

// 임베드 이미지 한 개의 픽셀을 꺼내 JPEG blob으로 변환 (직접 추출, 최고 화질)
async function extractImageBlob(page, name) {
  const getObj = nm => new Promise(resolve => {
    try { page.objs.get(nm, o => resolve(o)); }
    catch { try { page.commonObjs.get(nm, o => resolve(o)); } catch { resolve(null); } }
  });
  const obj = await Promise.race([
    getObj(name),
    new Promise(r => setTimeout(() => r(null), 4000)),
  ]);
  if (!obj || !obj.data || !obj.width || !obj.height) return null;
  const { width, height, data } = obj;
  const ch = data.length / (width * height);

  let rgba;
  if (ch === 4) {
    rgba = new Uint8ClampedArray(data.buffer || data);
  } else if (ch === 3) {
    rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      rgba[i*4] = data[i*3]; rgba[i*4+1] = data[i*3+1];
      rgba[i*4+2] = data[i*3+2]; rgba[i*4+3] = 255;
    }
  } else if (ch === 1) {
    rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      rgba[i*4] = rgba[i*4+1] = rgba[i*4+2] = data[i]; rgba[i*4+3] = 255;
    }
  } else return null;

  const cv = document.createElement('canvas');
  cv.width = width; cv.height = height;
  cv.getContext('2d').putImageData(new ImageData(rgba, width, height), 0, 0);
  const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.88));
  return blob && blob.size > 1500 ? blob : null;
}

// 이미지 bbox 목록을 그림 영역으로 클러스터링
// 규칙: ① 같은 x열 (30%+ 가로 겹침) 내에서만 병합 → 다른 단 이미지 혼입 방지
//       ② 이미지 사이에 본문 텍스트가 있으면 별개 그림으로 분리
//       ③ 텍스트 없이 붙어있거나 매우 가까우면 (gap ≤ bodySize) 하나로 병합
// 벡터 흡수 없음 → 표 셀·테두리 199개를 흡수하며 페이지 전체로 팽창하는 버그 방지
function clusterFigures(imageBoxes, lines, bodySize) {
  if (!imageBoxes.length) return [];

  // ① x열 그룹화: 30% 이상 가로 겹침이면 같은 열
  const cols = [];
  for (const img of imageBoxes) {
    let best = null, bestRatio = 0;
    for (const col of cols) {
      const ovlp = Math.max(0, Math.min(img.xMax, col.xMax) - Math.max(img.xMin, col.xMin));
      const span = Math.max(img.xMax - img.xMin, col.xMax - col.xMin);
      const r = span > 0 ? ovlp / span : 0;
      if (r > bestRatio && r >= 0.3) { best = col; bestRatio = r; }
    }
    if (best) {
      best.xMin = Math.min(best.xMin, img.xMin);
      best.xMax = Math.max(best.xMax, img.xMax);
      best.images.push(img);
    } else {
      cols.push({ xMin: img.xMin, xMax: img.xMax, images: [img] });
    }
  }

  // ② 각 열에서 본문 텍스트를 경계로 그룹 분리
  const bodyLines = lines.filter(l => !CAPTION_RE.test(l.text) && l.h >= bodySize * 0.65);
  const makeCluster = imgs => {
    const xMin = Math.min(...imgs.map(i => i.xMin));
    const xMax = Math.max(...imgs.map(i => i.xMax));
    const yMin = Math.min(...imgs.map(i => i.yMin));
    const yMax = Math.max(...imgs.map(i => i.yMax));
    return { xMin, xMax, yMin, yMax, x0:xMin, x1:xMax, yLo:yMin, yHi:yMax, images:imgs };
  };

  const result = [];
  for (const col of cols) {
    col.images.sort((a, b) => b.yMin - a.yMin); // 위→아래 (PDF y: 위쪽 = 값 큼)
    let group = [col.images[0]];

    for (let i = 1; i < col.images.length; i++) {
      const above = group[group.length - 1]; // 더 위쪽 이미지 (yMin 더 큼)
      const below = col.images[i];
      // above.yMin = above 이미지의 아래쪽, below.yMax = below 이미지의 위쪽
      const yGap = above.yMin - below.yMax;

      // 두 이미지 사이 영역에 본문 텍스트가 끼어 있는지 확인
      const textBetween = yGap > 0 && bodyLines.some(l =>
        l.y >= below.yMax - 2 && l.y + l.h <= above.yMin + 2 &&
        l.x1 > col.xMin - bodySize && l.x0 < col.xMax + bodySize
      );

      if (textBetween || yGap > bodySize * 5) {
        // 텍스트 경계 또는 큰 간격 → 별개 그림
        result.push(makeCluster(group));
        group = [below];
      } else {
        group.push(below);
      }
    }
    result.push(makeCluster(group));
  }

  result.sort((a, b) => b.yHi - a.yHi);
  return result;
}

const CAPTION_RE = /^\s*(figure|fig\.?|table|tbl\.?|scheme|chart|algorithm|그림|표|도표|차트|알고리즘)\s*\.?\s*[\[\(<]?\s*\d/i;

// TTS: 참고문헌 섹션 헤딩 감지 (여기서 자동 정지)
const REFS_HEADING_RE = /^(references|bibliography|works\s+cited|참고\s*문헌|인용\s*문헌|문헌)$/i;

// TTS: 본문 읽어주기 전 인용·URL 등 노이즈 제거
function cleanForTts(text) {
  return text
    .replace(/\[\d[\d,;\s–\-]*\]/g, '')              // [1], [1,2], [1–3]
    .replace(/\([A-Z][^)]{0,60}\d{4}[a-z]?\)/g, '')  // (Smith et al., 2024)
    .replace(/https?:\/\/\S+/g, '')                   // URLs
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function buildFigureRegions(lines, rasterRects, pageW, pageH, bodySize) {
  const captions = lines.filter(l => CAPTION_RE.test(l.text));
  const body     = lines.filter(l => l.h >= bodySize * 0.65 && !CAPTION_RE.test(l.text));
  const colX0    = body.length ? Math.min(...body.map(b => b.x0)) : 0;
  const colX1    = body.length ? Math.max(...body.map(b => b.x1)) : pageW;
  const colSpan  = colX1 - colX0;

  // 갭 감지에서 표 행(넓은 열 간격)과 좁은 레이블을 제외
  const bodyStrict = body.filter(l =>
    l.maxGap < bodySize * 2 && (l.x1 - l.x0) > colSpan * 0.4);

  // 갭 방향 판별에 쓸 표 행 목록 (캡션 반복 계산 방지)
  const tableRows = lines.filter(l => l.maxGap > bodySize * 2 && !CAPTION_RE.test(l.text));

  // 래스터가 캡션 중심으로부터 이 거리 안에 있어야 연결됨
  const RASTER_RADIUS = bodySize * 16;

  const regions  = [];
  const usedCaps = [];

  for (const cap of captions) {
    // ── 1순위: 래스터 이미지 rect ──────────────────────────
    const capMid = cap.y + cap.h / 2;
    const near   = rasterRects.filter(r =>
      Math.abs((r.yMin + r.yMax) / 2 - capMid) < RASTER_RADIUS);

    if (near.length) {
      let yLo = Math.min(...near.map(r => r.yMin));
      let yHi = Math.max(...near.map(r => r.yMax));
      let x0  = Math.min(...near.map(r => r.xMin));
      let x1  = Math.max(...near.map(r => r.xMax));

      // 래스터에 직접 붙어있는 텍스트 흡수 (3회 반복으로 최대 3줄)
      for (let pass = 0; pass < 3; pass++) {
        for (const l of lines) {
          if (CAPTION_RE.test(l.text)) continue;
          if (l.y + l.h > yHi && l.y - yHi <= bodySize) yHi = l.y + l.h;
          if (l.y < yLo && yLo - (l.y + l.h) <= bodySize) yLo = l.y;
        }
      }

      regions.push({
        yLo: Math.max(0, yLo - bodySize * 0.3),
        yHi: Math.min(pageH, yHi + bodySize * 0.3),
        x0, x1, caption: cap.text,
      });
      usedCaps.push(cap);
      continue;
    }

    // ── 2순위: 캡션 위/아래 텍스트 갭 ──────────────────────
    const capTop = cap.y + cap.h;
    const capBot = cap.y;

    let aboveBase = pageH;
    for (const b of bodyStrict)
      if (b.y > capTop + bodySize * 1.5 && b.y < aboveBase) aboveBase = b.y;

    let belowTop = 0;
    for (const b of bodyStrict)
      if (b.y + b.h < capBot - bodySize * 1.5 && b.y + b.h > belowTop) belowTop = b.y + b.h;

    const spanAbove = aboveBase - capTop;
    const spanBelow = capBot - belowTop;

    // 표 행이 있는 쪽을 갭 크기보다 우선
    const hasRowsAbove = tableRows.some(l => l.y >= capTop && l.y < aboveBase);
    const hasRowsBelow = tableRows.some(l => l.y + l.h <= capBot && l.y + l.h > belowTop);

    let yLo, yHi;
    if      (hasRowsAbove && spanAbove > bodySize * 2)          { yHi = aboveBase; yLo = capTop;  }
    else if (hasRowsBelow && spanBelow > bodySize * 2)          { yHi = capBot;    yLo = belowTop; }
    else if (spanAbove >= spanBelow && spanAbove > bodySize * 2.5) { yHi = aboveBase; yLo = capTop;  }
    else if (spanBelow > bodySize * 2.5)                        { yHi = capBot;    yLo = belowTop; }
    else continue;

    // 갭 영역 안 래스터 x 범위도 병합 (이미지 우측 절단 방지)
    const inRasters = rasterRects.filter(r =>
      r.yMin >= yLo - bodySize && r.yMax <= yHi + bodySize);
    const x0 = inRasters.length ? Math.min(colX0, ...inRasters.map(r => r.xMin)) : colX0;
    const x1 = inRasters.length ? Math.max(colX1, ...inRasters.map(r => r.xMax)) : colX1;

    regions.push({ yLo, yHi, x0, x1, caption: cap.text });
    usedCaps.push(cap);
  }

  // ── 캡션 없는 래스터 이미지 ──────────────────────────────
  for (const r of rasterRects) {
    if (regions.some(g => r.yMin < g.yHi + bodySize && r.yMax > g.yLo - bodySize)) continue;
    regions.push({ yLo: r.yMin, yHi: r.yMax, x0: r.xMin, x1: r.xMax, caption: '' });
  }

  if (!regions.length) return { regions: [], usedCaps };

  // 인접 영역 병합
  regions.sort((a, b) => b.yHi - a.yHi);
  const merged = [];
  for (const g of regions) {
    const last = merged[merged.length - 1];
    if (last && g.yHi > last.yLo - bodySize) {
      last.yLo = Math.min(last.yLo, g.yLo);
      last.yHi = Math.max(last.yHi, g.yHi);
      last.x0  = Math.min(last.x0, g.x0);
      last.x1  = Math.max(last.x1, g.x1);
      if (!last.caption && g.caption) last.caption = g.caption;
    } else merged.push({ ...g });
  }
  return { regions: merged, usedCaps };
}

function cropCanvasRegion(canvas, pdfYTop, pdfYBottom, pdfXMin, pdfXMax, pageH, scale) {
  const padX = Math.round(10 * scale);
  const padY = Math.round(12 * scale);
  const cx = Math.max(0, Math.floor(pdfXMin * scale) - padX);
  const cw = Math.min(canvas.width - cx, Math.ceil((pdfXMax - pdfXMin) * scale) + padX * 2);
  const cy = Math.max(0, Math.floor((pageH - pdfYTop) * scale) - padY);
  const ch = Math.min(canvas.height - cy, Math.ceil((pdfYTop - pdfYBottom) * scale) + padY * 2);
  if (ch < 30 || cw < 30) return Promise.resolve(null);
  return new Promise(res => {
    const tmp = document.createElement('canvas');
    tmp.width = cw; tmp.height = ch;
    tmp.getContext('2d').drawImage(canvas, cx, cy, cw, ch, 0, 0, cw, ch);
    tmp.toBlob(b => res(b && b.size > 1500 ? b : null), 'image/jpeg', 0.88);
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

    // 텍스트 + 이미지 bbox 병렬 취득
    const [content, imageRects] = await Promise.all([
      page.getTextContent(),
      getImageRects(page),
    ]);
    let lines = groupIntoLines(content.items);
    lines = reorderColumns(lines, pageW);
    // 페이지 꼬리말(하단)/머리말(상단) 제거: 짧은 라인만 필터 (실제 본문은 유지)
    lines = lines.filter(l =>
      (l.y >= bodySize * 3 && l.y <= pageH - bodySize * 2) ||
      l.text.length > 80 ||
      CAPTION_RE.test(l.text));

    // 텍스트를 경계로 이미지를 그림 영역으로 클러스터링
    const figRegions = imageRects.length
      ? clusterFigures(imageRects, lines, bodySize)
      : [];

    const SCALE = 2.5;
    let pageCanvas = null;
    const getCanvas = async () => (pageCanvas ??= (await renderPageCanvas(page, SCALE)).cv);

    // 한 그림 영역을 blob으로: 단일 래스터면 직접 추출(최고화질), 다중/복합이면 캔버스 크롭
    const regionToBlob = async (g) => {
      if (g.images.length === 1) {
        const blob = await extractImageBlob(page, g.images[0].name);
        if (blob) return blob;
      }
      return cropCanvasRegion(await getCanvas(), g.yHi, g.yLo, g.x0, g.x1, pageH, SCALE);
    };

    // 텍스트 없는 페이지 → 그림만
    if (lines.length === 0) {
      if (figRegions.length) {
        for (const g of figRegions) {
          const blob = await regionToBlob(g);
          if (blob) blocks.push({ type: 'fig', blob, caption: '' });
        }
      } else {
        const { cv } = await renderPageCanvas(page, 2.0);
        const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.85));
        if (blob && blob.size > 2000) blocks.push({ type: 'fig', blob });
      }
      onProgress(p, pdf.numPages); continue;
    }

    if (figRegions.length) {
      // ── 그래픽 영역 기반 경로 ──
      const captions  = lines.filter(l =>  CAPTION_RE.test(l.text));
      const bodyLines = lines.filter(l => !CAPTION_RE.test(l.text)).sort((a, b) => b.y - a.y);

      // 각 영역에 가장 가까운 캡션 연결 (y 거리 기준)
      const usedCaps = new Set();
      for (const g of figRegions) {
        const mid = (g.yLo + g.yHi) / 2;
        let best = null, bestD = Infinity;
        for (const c of captions) {
          const d = Math.abs(c.y + c.h / 2 - mid);
          if (d < bestD && d < bodySize * 20 && !usedCaps.has(c)) { bestD = d; best = c; }
        }
        g.caption = best ? best.text : '';
        if (best) usedCaps.add(best);
      }

      // 텍스트와 그림을 y 순서(위→아래)로 인터리브
      let ptr = 0;
      for (const g of figRegions) {
        const seg = [];
        while (ptr < bodyLines.length && bodyLines[ptr].y > g.yHi - bodySize * 0.5)
          seg.push(bodyLines[ptr++]);
        linesToBlocks(seg, bodySize, blocks);

        const blob = await regionToBlob(g);
        if (blob) blocks.push({ type: 'fig', blob, caption: g.caption });

        // 그림 영역 내부 텍스트(축 레이블/표 셀) 건너뜀
        while (ptr < bodyLines.length && bodyLines[ptr].y >= g.yLo - bodySize * 0.5)
          ptr++;
      }
      linesToBlocks(bodyLines.slice(ptr), bodySize, blocks);

    } else {
      // ── 벡터 전용 그림 폴백: 캡션 기반 캔버스 크롭 ──
      const { regions, usedCaps } = buildFigureRegions(lines, [], pageW, pageH, bodySize);

      if (!regions.length) {
        linesToBlocks(lines, bodySize, blocks);
        onProgress(p, pdf.numPages); continue;
      }

      const used = new Set(usedCaps);
      const sortedLines = lines.filter(l => !used.has(l)).sort((a, b) => b.y - a.y);
      let ptr = 0;

      for (const g of regions) {
        const seg = [];
        while (ptr < sortedLines.length && sortedLines[ptr].y > g.yHi - bodySize * 0.5)
          seg.push(sortedLines[ptr++]);
        linesToBlocks(seg, bodySize, blocks);
        const blob = await cropCanvasRegion(await getCanvas(), g.yHi, g.yLo, g.x0, g.x1, pageH, SCALE);
        if (blob) blocks.push({ type: 'fig', blob, caption: g.caption || '' });
        while (ptr < sortedLines.length && sortedLines[ptr].y >= g.yLo - bodySize * 0.5)
          ptr++;
      }
      linesToBlocks(sortedLines.slice(ptr), bodySize, blocks);
    }

    onProgress(p, pdf.numPages);
  }
  // 캡션 있는 그림 직후 캡션 없는 그림 → 다음 페이지 연속 블록으로 표시 (예: 다중 페이지 표)
  let prevFigCaption = '';
  for (const b of blocks) {
    if (b.type === 'fig') {
      if (b.caption) prevFigCaption = b.caption;
      else if (prevFigCaption) b.caption = prevFigCaption + ' (이어서)';
    } else {
      prevFigCaption = ''; // 본문 텍스트가 나오면 연속성 초기화
    }
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
    const initial = (b.title || '?').trim().charAt(0).toUpperCase() || '?';
    card.innerHTML = `
      <button class="book-del-btn" aria-label="삭제">✕</button>
      <div class="book-cover">
        <span class="book-cover-letter"></span>
      </div>
      <div class="book-title-wrap">
        <div class="book-title"></div>
        <button class="book-rename-btn" aria-label="제목 수정">✎</button>
      </div>
      <div class="book-meta">${b.numPages}쪽 · ${pct}% 읽음</div>
      <div class="book-progress-bar"><div class="book-progress-fill" style="width:${pct}%"></div></div>`;
    card.querySelector('.book-cover-letter').textContent = initial;
    card.querySelector('.book-title').textContent = b.title;
    card.querySelector('.book-del-btn').onclick = async e => {
      e.stopPropagation();
      if (confirm(`"${b.title}"을(를) 삭제할까요?`)) { await dbDelete(b.id); renderLibrary(); }
    };
    card.querySelector('.book-rename-btn').onclick = e => {
      e.stopPropagation();
      const titleEl = card.querySelector('.book-title');
      const renBtn  = card.querySelector('.book-rename-btn');
      const input   = document.createElement('input');
      input.className = 'book-title-input';
      input.value     = b.title;
      titleEl.replaceWith(input);
      renBtn.style.display = 'none';
      input.focus(); input.select();
      const commit = async () => {
        const v = input.value.trim();
        if (v && v !== b.title) { b.title = v; await dbPut(b); }
        renderLibrary();
      };
      input.addEventListener('blur',    commit);
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { renderLibrary(); }
        e.stopPropagation();
      });
      input.addEventListener('click', e => e.stopPropagation());
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

/* ===================== 그림 확대 모달 ===================== */

function figZoomOpen(src) {
  $('figZoomImg').src = src;
  $('figZoomModal').hidden = false;
}
function figZoomClose() {
  $('figZoomModal').hidden = true;
  $('figZoomImg').src = '';
}

function renderReaderContent() {
  const el = $('readerContent');
  el.querySelectorAll('img[data-fig]').forEach(img => URL.revokeObjectURL(img.src));
  el.innerHTML = '';
  const frag = document.createDocumentFragment();
  currentBook.blocks.forEach((b, i) => {
    let node;
    if (b.type === 'fig') {
      node = document.createElement('figure');
      node.className = 'blk fig-block';
      const img = document.createElement('img');
      img.src = URL.createObjectURL(b.blob);
      img.alt = b.caption || 'Figure'; img.dataset.fig = '1';
      img.addEventListener('click', e => { e.stopPropagation(); figZoomOpen(img.src); });
      node.appendChild(img);
      if (b.caption) {
        const cap = document.createElement('figcaption');
        cap.className = 'fig-cap';
        cap.textContent = b.caption;
        node.appendChild(cap);
      }
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
  $('tocPanel').hidden    = true;
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

function renderTocPanel() {
  const list = $('tocPanelList');
  list.innerHTML = '';
  if (!currentBook) return;
  const headings = currentBook.blocks
    .map((b, i) => ({ ...b, idx: i }))
    .filter(b => b.type === 'h2' || b.type === 'h3');
  if (!headings.length) {
    list.innerHTML = '<div class="hl-empty">이 문서에서 목차를 찾지 못했어요.</div>';
    return;
  }
  for (const h of headings) {
    const item = document.createElement('div');
    item.className = 'toc-item toc-' + h.type;
    item.textContent = h.text;
    item.onclick = () => {
      $('tocPanel').hidden = true;
      const el = $('readerContent').querySelector(`.blk[data-idx="${h.idx}"]`);
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); $('readerContent').scrollBy(0, -8); }
    };
    list.appendChild(item);
  }
}

function toggleTocPanel() {
  const tp = $('tocPanel');
  $('fontPanel').hidden  = true;
  $('themePanel').hidden = true;
  $('hlPanel').hidden    = true;
  tp.hidden = !tp.hidden;
  if (!tp.hidden) renderTocPanel();
}

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

const TTS_RATES = [0.8, 1.0, 1.2, 1.5, 2.0, 2.5];
let ttsRateIdx  = 1;
const tts = { active: false, paused: false, blockIdx: 0 };

function ttsPlayBlock(idx) {
  if (!('speechSynthesis' in window)) { alert('이 브라우저는 읽어주기를 지원하지 않아요.'); return; }
  window.speechSynthesis.cancel();
  if (!currentBook || idx >= currentBook.blocks.length) { ttsStop(); return; }
  // 그림 블록은 건너뜀
  if (currentBook.blocks[idx].type === 'fig') { ttsPlayBlock(idx + 1); return; }

  // 참고문헌 헤딩에서 자동 정지
  const block = currentBook.blocks[idx];
  if ((block.type === 'h2' || block.type === 'h3') && REFS_HEADING_RE.test(block.text.trim())) {
    ttsStop(); return;
  }

  tts.active = true; tts.paused = false; tts.blockIdx = idx;

  $('readerContent').querySelectorAll('.blk.tts-active').forEach(el => el.classList.remove('tts-active'));
  const blkEl = $('readerContent').querySelector(`.blk[data-idx="${idx}"]`);
  if (blkEl) {
    blkEl.classList.add('tts-active');
    blkEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  const rawText  = block.text;
  const spokenText = block.type === 'p' ? (cleanForTts(rawText) || rawText) : rawText;
  const utter = new SpeechSynthesisUtterance(spokenText);
  utter.rate  = TTS_RATES[ttsRateIdx];
  utter.lang  = detectLang(rawText) === 'ko' ? 'ko-KR' : 'en-US';
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
$('tocBtn').onclick       = toggleTocPanel;
$('tocPanelClose').onclick = () => ($('tocPanel').hidden = true);
$('hlListBtn').onclick    = () => {
  const p = $('hlPanel');
  $('tocPanel').hidden = true;
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

// 그림 확대 모달 닫기 (이미지 바깥 탭)
$('figZoomModal').addEventListener('click', e => {
  if (!e.target.closest('#figZoomImg')) figZoomClose();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') figZoomClose(); });

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
