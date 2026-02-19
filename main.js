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
const playerListSetup = document.getElementById('player-list-setup');
const playerCountInput = document.getElementById('player-count');

let audioCtx = null;
const COLORS = ['#00f2ff', '#39ff14', '#bc13fe', '#ff383f', '#f8e71c', '#ff9d00', '#00ffff', '#ffffff'];

let config = { cellSize: 10, width: 41, height: 41 };
let state = {
    players: [],
    maze: [],
    items: [], // {x, y, type: 'boost' | 'slow'}
    particles: [],
    floatingTexts: [],
    running: false,
    finishedCount: 0,
    cameraShake: 0
};

const bgCanvas = document.createElement('canvas');
const bgCtx = bgCanvas.getContext('2d');

// --- 초기 설정 UI 관련 ---
function adjustPlayerCount(delta) {
    let val = parseInt(playerCountInput.value) + delta;
    val = Math.max(2, Math.min(8, val));
    playerCountInput.value = val;
    renderPlayerSetup();
}

function renderPlayerSetup() {
    const count = parseInt(playerCountInput.value);
    playerListSetup.innerHTML = '';
    for (let i = 0; i < count; i++) {
        const div = document.createElement('div');
        div.className = 'player-setup-card';
        div.innerHTML = `
            <div class="color-dot" style="background: ${COLORS[i % COLORS.length]}"></div>
            <input type="text" class="player-name-input" value="Runner ${i + 1}" placeholder="이름 입력">
        `;
        playerListSetup.appendChild(div);
    }
}

// 초기 로드 시 실행
renderPlayerSetup();

// --- 게임 로직 ---
class Player {
    constructor(name, color, startPos, endPos, mazeData) {
        this.name = name;
        this.color = color;
        this.path = solveMaze(mazeData, startPos, endPos);
        this.currentIdx = 0;
        this.baseSpeed = 0.15 + Math.random() * 0.1;
        this.speed = this.baseSpeed;
        this.state = 'RUN';
        this.timer = 0;
        this.finished = false;
        this.x = startPos.x * config.cellSize + config.cellSize/2;
        this.y = startPos.y * config.cellSize + config.cellSize/2;
    }

    update() {
        if (this.finished) return;

        // 타일 체크 (아이템/장애물)
        const cellX = Math.floor(this.x / config.cellSize);
        const cellY = Math.floor(this.y / config.cellSize);
        const item = state.items.find(it => it.x === cellX && it.y === cellY);
        
        if (item && this.state === 'RUN') {
            if (item.type === 'boost') {
                this.state = 'BOOST';
                this.speed = 0.6;
                this.timer = 30;
                spawnFloatingText(this.x, this.y, "⚡ SPEED UP", this.color);
            } else if (item.type === 'slow') {
                this.state = 'SLOW';
                this.speed = 0.05;
                this.timer = 40;
                spawnFloatingText(this.x, this.y, "🕸️ SLOW", '#bc13fe');
            }
        }

        if (this.timer > 0) {
            this.timer--;
            if (this.timer <= 0) {
                this.state = 'RUN';
                this.speed = this.baseSpeed;
            }
        }

        // 랜덤 기절 (긴장감)
        if (this.state === 'RUN' && Math.random() < 0.002) {
            this.state = 'STUN';
            this.speed = 0;
            this.timer = 60;
            spawnFloatingText(this.x, this.y, "💫 STUNNED", '#fff');
        }

        this.currentIdx += this.speed;

        if (this.currentIdx >= this.path.length - 1) {
            this.finished = true;
            this.currentIdx = this.path.length - 1;
            handleFinish(this);
        }

        const i = Math.floor(this.currentIdx);
        const next = Math.min(i + 1, this.path.length - 1);
        const t = this.currentIdx - i;
        const p1 = this.path[i];
        const p2 = this.path[next];

        this.x = (p1.x + (p2.x - p1.x) * t) * config.cellSize + config.cellSize/2;
        this.y = (p1.y + (p2.y - p1.y) * t) * config.cellSize + config.cellSize/2;
    }

    draw(ctx) {
        ctx.save();
        if (this.state === 'BOOST') {
            ctx.shadowBlur = 15;
            ctx.shadowColor = this.color;
        }
        ctx.fillStyle = this.color;
        if (this.finished) ctx.globalAlpha = 0.2;
        ctx.beginPath();
        ctx.arc(this.x, this.y, config.cellSize/2, 0, Math.PI*2);
        ctx.fill();
        ctx.restore();
    }
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

function generateMaze(w, h) {
    const map = Array.from({length: h}, () => Array(w).fill(1));
    const stack = [{x:1, y:1}];
    map[1][1] = 0;
    
    while(stack.length) {
        const cur = stack[stack.length-1];
        const nbs = [];
        for(let d of [{x:0,y:-2},{x:0,y:2},{x:-2,y:0},{x:2,y:0}]) {
            const nx=cur.x+d.x, ny=cur.y+d.y;
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

    // 아이템/장애물 배치
    state.items = [];
    for(let i=0; i<w*h*0.05; i++) {
        const rx = Math.floor(Math.random()*w);
        const ry = Math.floor(Math.random()*h);
        if(map[ry][rx] === 0) {
            state.items.push({x:rx, y:ry, type: Math.random() > 0.4 ? 'boost' : 'slow'});
        }
    }

    return map;
}

function preRenderMaze() {
    bgCanvas.width = canvas.width;
    bgCanvas.height = canvas.height;
    bgCtx.fillStyle = '#050505';
    bgCtx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);

    for(let y=0; y<config.height; y++) {
        for(let x=0; x<config.width; x++) {
            const cx = x * config.cellSize;
            const cy = y * config.cellSize;
            
            if(state.maze[y][x] === 1) {
                bgCtx.fillStyle = '#111';
                bgCtx.fillRect(cx, cy, config.cellSize, config.cellSize);
            } else {
                // 아이템 바닥 그리기
                const item = state.items.find(it => it.x === x && it.y === y);
                if(item) {
                    bgCtx.fillStyle = item.type === 'boost' ? 'rgba(0, 242, 255, 0.2)' : 'rgba(188, 19, 254, 0.2)';
                    bgCtx.fillRect(cx, cy, config.cellSize, config.cellSize);
                }
            }
        }
    }
    // 출구
    const ex = Math.floor(config.width/2) * config.cellSize;
    const ey = Math.floor(config.height/2) * config.cellSize;
    bgCtx.fillStyle = '#bc13fe';
    bgCtx.shadowBlur = 15;
    bgCtx.shadowColor = '#bc13fe';
    bgCtx.fillRect(ex, ey, config.cellSize, config.cellSize);
    bgCtx.shadowBlur = 0;
}

function spawnFloatingText(x, y, text, color) {
    state.floatingTexts.push({ x, y, text, color, life: 1.0 });
}

function handleFinish(p) {
    state.finishedCount++;
    state.cameraShake = 5;
    const li = document.createElement('li');
    li.innerHTML = `<span style="color:${p.color}">${p.name}</span> <b>#${state.finishedCount}</b>`;
    finishedList.appendChild(li);

    if (state.finishedCount === state.players.length - 1) {
        const loser = state.players.find(pl => !pl.finished);
        gameMessage.innerText = `GAME OVER: ${loser.name} LOST`;
        state.running = false;
        restartBtn.classList.remove('hidden');
    }
}

function initGame() {
    const nameInputs = document.querySelectorAll('.player-name-input');
    const playerConfigs = Array.from(nameInputs).map((input, i) => ({
        name: input.value || `Runner ${i+1}`,
        color: COLORS[i % COLORS.length]
    }));

    setupScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');

    const diff = parseInt(document.getElementById('difficulty').value);
    config.width = config.height = diff * 2 + 1;
    
    // 비율 유지 리사이징
    const container = document.querySelector('.canvas-container');
    const size = Math.min(container.clientWidth, container.clientHeight) - 20;
    config.cellSize = Math.floor(size / config.width);
    canvas.width = canvas.height = config.width * config.cellSize;

    state.maze = generateMaze(config.width, config.height);
    const exit = {x: Math.floor(config.width/2), y: Math.floor(config.height/2)};
    state.maze[exit.y][exit.x] = 0;

    state.players = playerConfigs.map(c => {
        let rx, ry;
        do {
            rx = Math.floor(Math.random()*config.width);
            ry = Math.floor(Math.random()*config.height);
        } while(state.maze[ry][rx] !== 0 || (rx === exit.x && ry === exit.y));
        return new Player(c.name, c.color, {x:rx, y:ry}, exit, state.maze);
    });

    state.floatingTexts = [];
    state.finishedCount = 0;
    state.running = true;
    preRenderMaze();
    
    activeList.innerHTML = '';
    finishedList.innerHTML = '';
    gameMessage.innerText = "RACING...";
    requestAnimationFrame(loop);
}

function loop() {
    if(!state.running) return;
    update();
    draw();
    requestAnimationFrame(loop);
}

function update() {
    state.players.forEach(p => p.update());
    for(let i=state.floatingTexts.length-1; i>=0; i--) {
        state.floatingTexts[i].life -= 0.02;
        state.floatingTexts[i].y -= 0.5;
        if(state.floatingTexts[i].life <= 0) state.floatingTexts.splice(i, 1);
    }
    if(state.cameraShake > 0) state.cameraShake *= 0.9;

    // 실시간 상태 업데이트
    const survivors = state.players.filter(p => !p.finished).sort((a,b) => b.currentIdx - a.currentIdx);
    activeList.innerHTML = survivors.map(p => {
        let badge = '';
        if(p.state === 'BOOST') badge = '<span class="badge badge-boost">BOOST</span>';
        if(p.state === 'STUN') badge = '<span class="badge badge-stun">STUN</span>';
        if(p.state === 'SLOW') badge = '<span class="badge badge-slow">SLOW</span>';
        return `<li><span style="color:${p.color}">${p.name}</span> <div>${badge} ${Math.floor((p.currentIdx/p.path.length)*100)}%</div></li>`;
    }).join('');
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    if(state.cameraShake > 0.5) {
        ctx.translate((Math.random()-0.5)*state.cameraShake, (Math.random()-0.5)*state.cameraShake);
    }
    ctx.drawImage(bgCanvas, 0, 0);
    state.players.forEach(p => p.draw(ctx));
    state.floatingTexts.forEach(t => {
        ctx.globalAlpha = t.life;
        ctx.fillStyle = t.color;
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(t.text, t.x, t.y - 10);
    });
    ctx.restore();
}

startBtn.addEventListener('click', initGame);
restartBtn.addEventListener('click', () => {
    gameScreen.classList.add('hidden');
    setupScreen.classList.remove('hidden');
    restartBtn.classList.add('hidden');
});
window.adjustPlayerCount = adjustPlayerCount; // 전역 스코프 노출
