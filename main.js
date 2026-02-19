const canvas = document.getElementById('maze-canvas');
const ctx = canvas.getContext('2d');
const setupScreen = document.getElementById('setup-screen');
const gameScreen = document.getElementById('game-screen');
const startBtn = document.getElementById('start-btn');
const restartBtn = document.getElementById('restart-btn');
const activeList = document.getElementById('active-list');
const finishedList = document.getElementById('finished-list');
const logPanel = document.getElementById('log-panel');
const gameMessage = document.getElementById('game-message');

// 오디오 컨텍스트 (사용자 인터랙션 후 초기화)
let audioCtx = null;

// 게임 상태
let config = {
    cellSize: 10,
    width: 51,
    height: 51,
    shape: 'rect'
};

let state = {
    players: [],
    maze: [],
    particles: [], // 이펙트 파티클
    floatingTexts: [], // 팝업 텍스트
    running: false,
    finishedCount: 0,
    cameraShake: 0
};

// 정적 캔버스 (미로 배경 캐싱용)
const bgCanvas = document.createElement('canvas');
const bgCtx = bgCanvas.getContext('2d');

const COLORS = [
    '#00f2ff', '#39ff14', '#ff00ff', '#f8e71c', '#ff383f', '#00ffff', '#ffa500', '#ffffff'
];

// 사운드 효과 (Web Audio API)
function playSound(type) {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    if (type === 'boost') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(150, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(600, audioCtx.currentTime + 0.3);
        gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.3);
    } else if (type === 'win') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(500, audioCtx.currentTime);
        osc.frequency.linearRampToValueAtTime(1000, audioCtx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.5);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.5);
    } else if (type === 'stun') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(100, audioCtx.currentTime);
        osc.frequency.linearRampToValueAtTime(50, audioCtx.currentTime + 0.2);
        gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.2);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.2);
    }
}

class Player {
    constructor(name, color, startPos, endPos, mazeData) {
        this.name = name;
        this.color = color;
        this.path = solveMaze(mazeData, startPos, endPos);
        this.currentIdx = 0; // 현재 경로 인덱스 (float)
        this.targetSpeed = 0.2 + Math.random() * 0.15;
        this.speed = this.targetSpeed;
        this.state = 'RUN';
        this.timer = 0;
        this.finished = false;
        this.finishTime = 0;
        
        // 화면 좌표
        this.x = startPos.x * config.cellSize + config.cellSize/2;
        this.y = startPos.y * config.cellSize + config.cellSize/2;
    }

    update() {
        if (this.finished) return;

        // 상태 타이머
        if (this.timer > 0) {
            this.timer--;
            if (this.timer <= 0) {
                this.state = 'RUN';
                this.speed = this.targetSpeed;
            }
        }

        // 랜덤 이벤트
        if (this.state === 'RUN' && Math.random() < 0.005) {
            const r = Math.random();
            if (r < 0.3) {
                this.state = 'BOOST';
                this.speed = 0.8; // 매우 빠름
                this.timer = 40;
                spawnFloatingText(this.x, this.y, "BOOST!!", this.color);
                playSound('boost');
            } else if (r < 0.5) {
                this.state = 'STUN';
                this.speed = 0;
                this.timer = 50;
                spawnFloatingText(this.x, this.y, "STUN...", '#fff');
                playSound('stun');
            }
        }

        // 이동 로직 (부드러운 가속)
        if (this.state === 'BOOST') {
            // 파티클 생성
            if (Math.random() < 0.5) spawnParticle(this.x, this.y, this.color);
        }

        this.currentIdx += this.speed;

        // 도착 체크
        if (this.currentIdx >= this.path.length - 1) {
            this.finished = true;
            this.currentIdx = this.path.length - 1;
            this.finishTime = Date.now();
            playSound('win');
            handleFinish(this);
        }

        // 좌표 계산 (Lerp)
        const i = Math.floor(this.currentIdx);
        const next = Math.min(i + 1, this.path.length - 1);
        const t = this.currentIdx - i;
        
        const p1 = this.path[i];
        const p2 = this.path[next];

        // 좌표 업데이트
        this.x = (p1.x + (p2.x - p1.x) * t) * config.cellSize + config.cellSize/2;
        this.y = (p1.y + (p2.y - p1.y) * t) * config.cellSize + config.cellSize/2;
    }

    draw(ctx) {
        // 본체
        ctx.fillStyle = this.color;
        
        // 1등이거나 부스터 중일 때 글로우 효과 (최적화를 위해 제한적 사용)
        if (this.state === 'BOOST') {
            ctx.shadowBlur = 10;
            ctx.shadowColor = this.color;
        } else {
            ctx.shadowBlur = 0;
        }

        ctx.beginPath();
        ctx.arc(this.x, this.y, config.cellSize/2, 0, Math.PI*2);
        ctx.fill();
        ctx.shadowBlur = 0; // 리셋

        // 중앙 점
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(this.x, this.y, config.cellSize/5, 0, Math.PI*2);
        ctx.fill();

        // 이름
        if (!this.finished) {
            ctx.fillStyle = '#fff';
            ctx.font = `bold ${Math.max(10, config.cellSize)}px Arial`;
            ctx.textAlign = 'center';
            ctx.fillText(this.name, this.x, this.y - config.cellSize);
        }
    }
}

// 간단한 파티클 시스템
function spawnParticle(x, y, color) {
    state.particles.push({
        x, y, color,
        vx: (Math.random() - 0.5) * 2,
        vy: (Math.random() - 0.5) * 2,
        life: 1.0
    });
}

function spawnFloatingText(x, y, text, color) {
    state.floatingTexts.push({
        x, y, text, color,
        life: 1.0,
        dy: 0
    });
}

// 미로 알고리즘 (이전과 동일하지만 간략화)
function generateMaze(w, h) {
    const map = Array.from({length: h}, () => Array(w).fill(1));
    const stack = [];
    const center = {x: Math.floor(w/2), y: Math.floor(h/2)};
    
    // 원형 마스크
    for(let y=0; y<h; y++) {
        for(let x=0; x<w; x++) {
             if (Math.sqrt((x-center.x)**2 + (y-center.y)**2) > w/2 - 1) map[y][x] = -1;
        }
    }

    // DFS Maze Gen
    let start = {x: center.x, y: center.y};
    // 중앙이 막혀있으면 뚫음
    if (map[start.y][start.x] === -1) { 
        // fallback to standard rect
    }
    
    map[start.y][start.x] = 0;
    stack.push(start);
    const dirs = [{x:0,y:-2},{x:0,y:2},{x:-2,y:0},{x:2,y:0}];

    while(stack.length) {
        const cur = stack[stack.length-1];
        const nbs = [];
        for(let d of dirs) {
            const nx = cur.x+d.x, ny = cur.y+d.y;
            if(nx>0 && nx<w-1 && ny>0 && ny<h-1 && map[ny][nx]===1) 
                nbs.push({x:nx, y:ny, dx:d.x/2, dy:d.y/2});
        }
        if(nbs.length) {
            const next = nbs[Math.floor(Math.random()*nbs.length)];
            map[next.y][next.x] = 0;
            map[cur.y+next.dy][cur.x+next.dx] = 0;
            stack.push({x:next.x, y:next.y});
        } else stack.pop();
    }
    return map;
}

function solveMaze(map, start, end) {
    const q = [[start]];
    const v = new Set([`${start.x},${start.y}`]);
    while(q.length) {
        const p = q.shift();
        const c = p[p.length-1];
        if(c.x===end.x && c.y===end.y) return p;
        for(let d of [{x:0,y:-1},{x:0,y:1},{x:-1,y:0},{x:1,y:0}]) {
            const nx=c.x+d.x, ny=c.y+d.y;
            if(nx>=0 && nx<map[0].length && ny>=0 && ny<map.length && map[ny][nx]===0 && !v.has(`${nx},${ny}`)) {
                v.add(`${nx},${ny}`);
                q.push([...p, {x:nx, y:ny}]);
            }
        }
    }
    return [start];
}

// 배경(미로) 미리 그리기 (성능 핵심)
function preRenderMaze() {
    bgCanvas.width = canvas.width;
    bgCanvas.height = canvas.height;
    
    // 배경
    bgCtx.fillStyle = '#050505';
    bgCtx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);

    // 벽 (글로우 효과는 여기서 한 번만)
    bgCtx.shadowBlur = 5;
    bgCtx.shadowColor = 'rgba(0, 242, 255, 0.3)';
    bgCtx.fillStyle = '#111';
    
    for(let y=0; y<config.height; y++) {
        for(let x=0; x<config.width; x++) {
            if(state.maze[y][x] === 1) { // 벽
                bgCtx.fillRect(x*config.cellSize, y*config.cellSize, config.cellSize, config.cellSize);
            }
        }
    }
    bgCtx.shadowBlur = 0; // 리셋

    // 출구 포탈
    const cx = Math.floor(config.width/2) * config.cellSize + config.cellSize/2;
    const cy = Math.floor(config.height/2) * config.cellSize + config.cellSize/2;
    
    bgCtx.shadowBlur = 20;
    bgCtx.shadowColor = '#bc13fe';
    bgCtx.fillStyle = '#bc13fe';
    bgCtx.beginPath();
    bgCtx.arc(cx, cy, config.cellSize, 0, Math.PI*2);
    bgCtx.fill();
    bgCtx.shadowBlur = 0;
}

function initGame() {
    const names = document.getElementById('player-input').value.split(',').map(s=>s.trim()).filter(s=>s);
    if(names.length < 2) return alert("2명 이상 필요!");

    setupScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');

    const diff = parseInt(document.getElementById('difficulty').value);
    config.width = config.height = diff * 2 + 1;

    // 캔버스 크기
    const content = document.querySelector('.main-content');
    const w = content.clientWidth - 360; 
    const h = content.clientHeight;
    config.cellSize = Math.floor(Math.min(w/config.width, h/config.height));
    canvas.width = config.width * config.cellSize;
    canvas.height = config.height * config.cellSize;

    // 데이터 생성
    state.maze = generateMaze(config.width, config.height);
    const exit = {x: Math.floor(config.width/2), y: Math.floor(config.height/2)};
    state.maze[exit.y][exit.x] = 0; // 출구 확보

    // 플레이어 배치
    const starts = [];
    for(let y=1; y<config.height-1; y++) {
        for(let x=1; x<config.width-1; x++) {
            if(state.maze[y][x]===0) {
                 const d = Math.sqrt((x-exit.x)**2 + (y-exit.y)**2);
                 if(d > config.width/2 - 3) starts.push({x,y});
            }
        }
    }

    state.players = names.map((n, i) => {
        const s = starts[Math.floor(Math.random()*starts.length)];
        return new Player(n, COLORS[i%COLORS.length], s, exit, state.maze);
    });

    state.particles = [];
    state.floatingTexts = [];
    state.finishedCount = 0;
    state.running = true;
    state.cameraShake = 0;

    preRenderMaze(); // 배경 캐싱
    
    activeList.innerHTML = '';
    finishedList.innerHTML = '';
    gameMessage.innerText = "RACE START!";
    
    requestAnimationFrame(loop);
}

function handleFinish(p) {
    state.finishedCount++;
    state.cameraShake = 5; // 쉐이크 효과
    
    const li = document.createElement('li');
    li.innerHTML = `<span style="color:${p.color}">${p.name}</span> <small>#${state.finishedCount}</small>`;
    finishedList.appendChild(li);

    if (state.finishedCount === state.players.length - 1) {
        const loser = state.players.find(pl => !pl.finished);
        gameMessage.innerText = `LOOSER: ${loser.name}`;
        gameMessage.style.color = '#ff0033';
        state.running = false;
        restartBtn.classList.remove('hidden');
        playSound('stun'); // 탈락음
    }
}

function loop() {
    if(!state.running) {
        render(); // 마지막 프레임 그림
        return;
    }

    update();
    render();
    requestAnimationFrame(loop);
}

function update() {
    state.players.forEach(p => p.update());
    
    // 파티클 업데이트
    for(let i=state.particles.length-1; i>=0; i--) {
        const p = state.particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.05;
        if(p.life <= 0) state.particles.splice(i, 1);
    }

    // 텍스트 업데이트
    for(let i=state.floatingTexts.length-1; i>=0; i--) {
        const t = state.floatingTexts[i];
        t.y -= 0.5; // 위로 떠오름
        t.life -= 0.02;
        if(t.life <= 0) state.floatingTexts.splice(i, 1);
    }

    // 카메라 쉐이크 감쇠
    if(state.cameraShake > 0) state.cameraShake *= 0.9;
    if(state.cameraShake < 0.5) state.cameraShake = 0;

    // 리더보드 (가끔 업데이트)
    const survivors = state.players.filter(p => !p.finished).sort((a,b) => b.currentIdx - a.currentIdx);
    activeList.innerHTML = survivors.map(p => 
        `<li><span style="color:${p.color}">● ${p.name}</span> <small>${Math.floor((p.currentIdx/p.path.length)*100)}%</small></li>`
    ).join('');
}

function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 카메라 쉐이크 적용
    ctx.save();
    if (state.cameraShake > 0) {
        const dx = (Math.random() - 0.5) * state.cameraShake;
        const dy = (Math.random() - 0.5) * state.cameraShake;
        ctx.translate(dx, dy);
    }

    // 1. 배경 그리기 (캐싱된 이미지)
    ctx.drawImage(bgCanvas, 0, 0);

    // 2. 파티클 그리기
    for(const p of state.particles) {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.life;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2, 0, Math.PI*2);
        ctx.fill();
    }
    ctx.globalAlpha = 1.0;

    // 3. 플레이어 그리기
    state.players.forEach(p => p.draw(ctx));

    // 4. 플로팅 텍스트
    for(const t of state.floatingTexts) {
        ctx.fillStyle = t.color;
        ctx.globalAlpha = t.life;
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(t.text, t.x, t.y - 15);
    }
    ctx.globalAlpha = 1.0;

    ctx.restore();
}

startBtn.addEventListener('click', initGame);
restartBtn.addEventListener('click', () => {
    gameScreen.classList.add('hidden');
    setupScreen.classList.remove('hidden');
});
