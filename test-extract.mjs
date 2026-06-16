// PDF 추출 로직 진단 스크립트
import { readFileSync } from 'fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const pdfPath = '/root/.claude/uploads/9e282634-6b47-5e42-9e90-0b80ebc1967b/68991b61-TalkFile____.pdf.pdf';
const data = new Uint8Array(readFileSync(pdfPath));

const CAPTION_RE = /^\s*(figure|fig\.?|table|tbl\.?|scheme|chart|algorithm|그림|표|도표|차트|알고리즘)\s*\.?\s*[\[\(<]?\s*\d/i;

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

// OPS 코드 (PDF.js 3.x)
const IMAGE_OPS_CODES = new Set([85, 86, 87, 88, 90]); // paintImageXObject 등

async function getImageRects(page) {
  let opList;
  try { opList = await page.getOperatorList(); } catch { return []; }
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
    if      (fn === 10) stack.push([...ctm]);
    else if (fn === 11) { if (stack.length) ctm = stack.pop(); }
    else if (fn === 12) ctm = mul(ctm, args);
    else if (IMAGE_OPS_CODES.has(fn)) {
      const pts = [[0,0],[1,0],[0,1],[1,1]].map(([x,y]) =>
        [ctm[0]*x+ctm[2]*y+ctm[4], ctm[1]*x+ctm[3]*y+ctm[5]]);
      const xs = pts.map(p=>p[0]), ys = pts.map(p=>p[1]);
      const r = { xMin:Math.min(...xs), xMax:Math.max(...xs),
                  yMin:Math.min(...ys), yMax:Math.max(...ys) };
      if (r.xMax-r.xMin > 40 && r.yMax-r.yMin > 40) regions.push(r);
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

const pdf = await pdfjsLib.getDocument({ data }).promise;
console.log(`총 ${pdf.numPages}페이지\n`);

// 본문 폰트 크기 추출 (처음 3페이지)
const sizes = [];
for (let p = 1; p <= Math.min(3, pdf.numPages); p++) {
  const page = await pdf.getPage(p);
  for (const l of groupIntoLines((await page.getTextContent()).items))
    sizes.push(Math.round(l.h));
}
const freq = {};
for (const s of sizes) freq[s] = (freq[s]||0)+1;
const bodySize = Number(Object.keys(freq).sort((a,b)=>freq[b]-freq[a])[0]) || 10;
console.log(`bodySize: ${bodySize}pt\n`);

// 각 페이지 분석
for (let p = 1; p <= pdf.numPages; p++) {
  const page = await pdf.getPage(p);
  const { width: pageW, height: pageH } = page.getViewport({ scale: 1 });
  const [content, imageRects] = await Promise.all([
    page.getTextContent(),
    getImageRects(page),
  ]);
  const lines = groupIntoLines(content.items);
  const captions = lines.filter(l => CAPTION_RE.test(l.text));
  const body = lines.filter(l => l.h >= bodySize * 0.65 && !CAPTION_RE.test(l.text));
  const colX0 = body.length ? Math.min(...body.map(b=>b.x0)) : 0;
  const colX1 = body.length ? Math.max(...body.map(b=>b.x1)) : pageW;

  if (imageRects.length || captions.length) {
    console.log(`── 페이지 ${p} (${pageW.toFixed(0)}×${pageH.toFixed(0)}) ──`);
    if (imageRects.length)
      imageRects.forEach(r => console.log(`  [래스터] y=${r.yMin.toFixed(0)}~${r.yMax.toFixed(0)} x=${r.xMin.toFixed(0)}~${r.xMax.toFixed(0)}`));
    if (captions.length)
      captions.forEach(c => console.log(`  [캡션] y=${c.y.toFixed(0)} "${c.text.slice(0,60)}"`));

    // 표가 있는 경우: body line 중 maxGap이 큰 것 (표 행)
    const tableRows = body.filter(l => l.maxGap > bodySize * 2);
    if (tableRows.length > 0) {
      console.log(`  [표행 감지] ${tableRows.length}개 (maxGap>${(bodySize*2).toFixed(0)}pt)`);
      tableRows.slice(0,3).forEach(l =>
        console.log(`    gap=${l.maxGap.toFixed(0)}pt "${l.text.slice(0,50)}"`));
    }

    // 새 로직 시뮬레이션
    const RASTER_RADIUS = bodySize * 16;
    const colSpan = colX1 - colX0;
    // bodyStrict: 다중 컬럼 표 행(큰 gap) + 좁은 레이블(< 40% 컬럼폭) 모두 제외
    const bodyStrict = body.filter(l => l.maxGap < bodySize * 2 && (l.x1 - l.x0) > colSpan * 0.4);
    for (const cap of captions) {
      const capMid = cap.y + cap.h / 2;
      const capTop = cap.y + cap.h;
      const capBot = cap.y;
      const near = imageRects.filter(r => Math.abs((r.yMin+r.yMax)/2 - capMid) < RASTER_RADIUS);

      if (near.length) {
        let yLo = Math.min(...near.map(r=>r.yMin)), yHi = Math.max(...near.map(r=>r.yMax));
        console.log(`  캡션 "${cap.text.slice(0,40)}" → [래스터 경로] y=${yLo.toFixed(0)}~${yHi.toFixed(0)}`);
      } else {
        let aboveBase = pageH, aboveLine = null;
        for (const b of bodyStrict) if (b.y > capTop + bodySize*1.5 && b.y < aboveBase) { aboveBase = b.y; aboveLine = b; }
        let belowTop = 0, belowLine = null;
        for (const b of bodyStrict) if (b.y+b.h < capBot - bodySize*1.5 && b.y+b.h > belowTop) { belowTop = b.y+b.h; belowLine = b; }
        const spanA = aboveBase - capTop, spanB = capBot - belowTop;
        console.log(`  캡션 "${cap.text.slice(0,40)}" capTop=${capTop.toFixed(0)} capBot=${capBot.toFixed(0)}`);
        console.log(`    위: aboveBase=${aboveBase.toFixed(0)} spanA=${spanA.toFixed(0)}  "${aboveLine?.text?.slice(0,40)||'(없음)'}"`);
        console.log(`    아래: belowTop=${belowTop.toFixed(0)} spanB=${spanB.toFixed(0)}  "${belowLine?.text?.slice(0,40)||'(없음)'}"`);
        // 표 행이 어느 쪽에 있는지 확인 → 갭 크기보다 우선
        const tableRowsAll = lines.filter(l => l.maxGap > bodySize * 2 && !CAPTION_RE.test(l.text));
        const tableRowsAbove = tableRowsAll.some(l => l.y >= capTop && l.y < aboveBase);
        const tableRowsBelow = tableRowsAll.some(l => l.y+l.h <= capBot && l.y+l.h > belowTop);
        console.log(`    tableRowsAbove=${tableRowsAbove} tableRowsBelow=${tableRowsBelow}`);

        let yLo, yHi, dir;
        if (tableRowsAbove && spanA > bodySize*2) { yHi=aboveBase; yLo=capTop; dir='위(표행)'; }
        else if (tableRowsBelow && spanB > bodySize*2) { yHi=capBot; yLo=belowTop; dir='아래(표행)'; }
        else if (spanA >= spanB && spanA > bodySize*2.5) { yHi=aboveBase; yLo=capTop; dir='위'; }
        else if (spanB > bodySize*2.5) { yHi=capBot; yLo=belowTop; dir='아래'; }
        else { console.log(`    → 갭 부족`); continue; }
        console.log(`    → [갭 ${dir}] y=${yLo.toFixed(0)}~${yHi.toFixed(0)} (${(yHi-yLo).toFixed(0)}pt)`);
      }
    }
    console.log();
  }
}
