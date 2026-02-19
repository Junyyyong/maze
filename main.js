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

const COLORS = ['#00f2ff', '#39ff14', '#bc13fe', '#ff383f', '#f8e71c', '#ff9d00', '#00ffff', '#ffffff'];
const RANDOM_NAMES = ["Neo", "Trinity", "Morpheus", "Cypher", "Tank", "Dozer", "Mouse", "Switch", "Ghost", "Niobe", "Oracle", "Smith"];

let config = { cellSize: 10, width: 41, height: 41, shape: 'rect' };
let state = {
    players: [],
    maze: [],
    items: [], 
    floatingTexts: [],
    running: false,
    finishedCount: 0,
    cameraShake: 0
};

const bgCanvas = document.createElement('canvas');
const bgCtx = bgCanvas.getContext('2d');

// --- AdSense Policy Content ---
const policies = {
    privacy: `<h2>Privacy Policy</h2><p>본 서비스는 사용자의 개인정보를 서버에 저장하지 않습니다. 모든 게임 데이터는 브라우저 내에서만 처리됩니다. 구글 애드센스를 통한 광고 표시를 위해 쿠키가 사용될 수 있습니다.</p>`,
    terms: `<h2>Terms of Service</h2><p>본 게임은 누구나 자유롭게 이용 가능합니다. 비정상적인 방법으로 시스템에 부하를 주는 행위는 금지됩니다.</p>`
};

function showPolicy(type) {
    document.getElementById('policy-text').innerHTML = policies[type];
    document.getElementById('policy-modal').classList.remove('hidden');
}

function closeModal() {
    document.getElementById('policy-modal').classList.add('hidden');
}

// --- Setup UI Logic ---
function adjustPlayerCount(delta) {
    let val = parseInt(playerCountInput.value) + delta;
    val = Math.max(2, Math.min(12, val));
    playerCountInput.value = val;
    renderPlayerSetup();
}

function renderPlayerSetup() {
    const count = parseInt(playerCountInput.value);
    const currentInputs = document.querySelectorAll('.player-name-input');
    const existingNames = Array.from(currentInputs).map(input => input.value);
    
    playerListSetup.innerHTML = '';
    for (let i = 0; i < count; i++) {
        const div = document.createElement('div');
        div.className = 'player-setup-card';
        const defaultName = existingNames[i] || RANDOM_NAMES[i % RANDOM_NAMES.length];
        div.innerHTML = `
            <div class="color-dot" style="background: ${COLORS[i % COLORS.length]}"></div>
            <input type="text" class="player-name-input" value="${defaultName.trim()}">
            <button class="btn-mini" onclick="randomizeName(this)"><i class="fas fa-dice"></i></button>
        `;
        playerListSetup.appendChild(div);
    }
}

function randomizeName(btn) {
    const input = btn.parentElement.querySelector('.player-name-input');
    input.value = RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)];
}

renderPlayerSetup();

// --- Core Game Classes ---
class Player {
    constructor(name, color, startPos, endPos, mazeData) {
        this.name = name;
        this.color = color;
        this.path = solveMaze(mazeData, startPos, endPos);
        this.currentIdx = 0;
        this.baseSpeed = 0.12 + Math.random() * 0.08;
        this.speed = this.baseSpeed;
        this.state = 'RUN';
        this.timer = 0;
        this.finished = false;
        this.x = startPos.x * config.cellSize + config.cellSize/2;
        this.y = startPos.y * config.cellSize + config.cellSize/2;
    }

    update() {
        if (this.finished) return;

        const cellX = Math.floor(this.x / config.cellSize);
        const cellY = Math.floor(this.y / config.cellSize);
        const item = state.items.find(it => it.x === cellX && it.y === cellY);
        
        if (item && this.state === 'RUN') {
            if (item.type === 'boost') {
                this.state = 'BOOST';
                this.speed = 0.5;
                this.timer = 30;
                addHistoryLog(`⚡ ${this.name}: BOOSTED!`, this.color);
                spawnFloatingText(this.x, this.y, "⚡ BOOST", this.color);
            } else if (item.type === 'slow') {
                this.state = 'SLOW';
                this.speed = 0.04;
                this.timer = 45;
                addHistoryLog(`🕸️ ${this.name}: SLOWED!`, '#bc13fe');
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

        if (this.state === 'RUN' && Math.random() < 0.0015) {
            this.state = 'STUN';
            this.speed = 0;
            this.timer = 70;
            addHistoryLog(`💫 ${this.name}: GLITCHED!`, '#fff');
            spawnFloatingText(this.x, this.y, "💫 GLITCH", '#fff');
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
            ctx.shadowBlur = 20;
            ctx.shadowColor = this.color;
        }
        
        ctx.fillStyle = this.color;
        if (this.finished) ctx.globalAlpha = 0.2;
        ctx.beginPath();
        ctx.arc(this.x, this.y, config.cellSize/1.6, 0, Math.PI*2);
        ctx.fill();
        
        // Face
        if (!this.finished) {
            ctx.fillStyle = '#000';
            const eyeSize = config.cellSize / 8;
            const eyeOffset = config.cellSize / 5;
            if (this.state === 'STUN') {
                ctx.font = `${config.cellSize/2}px Arial`;
                ctx.textAlign = 'center';
                ctx.fillText('x x', this.x, this.y + eyeSize);
            } else if (this.state === 'BOOST') {
                ctx.beginPath();
                ctx.arc(this.x - eyeOffset, this.y - eyeOffset, eyeSize, 0, Math.PI, true);
                ctx.arc(this.x + eyeOffset, this.y - eyeOffset, eyeSize, 0, Math.PI, true);
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(this.x, this.y + eyeOffset/2, eyeSize, 0, Math.PI);
                ctx.fill();
            } else {
                ctx.beginPath();
                ctx.arc(this.x - eyeOffset, this.y - eyeSize, eyeSize, 0, Math.PI*2);
                ctx.arc(this.x + eyeOffset, this.y - eyeSize, eyeSize, 0, Math.PI*2);
                ctx.fill();
                ctx.fillRect(this.x - eyeOffset, this.y + eyeOffset/2, eyeOffset*2, 1);
            }
        }
        ctx.restore();

        if (!this.finished) {
            ctx.fillStyle = '#fff';
            ctx.font = `bold ${Math.max(10, config.cellSize * 0.8)}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText(this.name, this.x, this.y - config.cellSize);
        }
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

function generateMaze(w, h, shape) {
    const map = Array.from({length: h}, () => Array(w).fill(1));
    const center = {x: Math.floor(w/2), y: Math.floor(h/2)};

    for(let y = 0; y < h; y++) {
        for(let x = 0; x < w; x++) {
            if (shape === 'circle') {
                if (Math.sqrt((x-center.x)**2 + (y-center.y)**2) > w/2 - 1) map[y][x] = -1;
            } else if (shape === 'diamond') {
                if (Math.abs(x-center.x) + Math.abs(y-center.y) > w/2 - 1) map[y][x] = -1;
            }
        }
    }

    let start = {x: 1, y: 1};
    if (map[1][1] === -1) {
        outer: for(let y=1; y<h-1; y++) {
            for(let x=1; x<w-1; x++) {
                if(map[y][x] === 1) { start = {x, y}; break outer; }
            }
        }
    }

    map[start.y][start.x] = 0;
    const stack = [start];
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

    state.items = [];
    const itemCount = (w * h) * 0.05;
    for(let i=0; i<itemCount; i++) {
        const rx = Math.floor(Math.random()*w);
        const ry = Math.floor(Math.random()*h);
        if(map[ry][rx] === 0 && (rx !== center.x || ry !== center.y)) {
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
                bgCtx.fillStyle = '#11121a';
                bgCtx.fillRect(cx, cy, config.cellSize, config.cellSize);
            } else if (state.maze[y][x] === 0) {
                const item = state.items.find(it => it.x === x && it.y === y);
                if(item) {
                    bgCtx.fillStyle = item.type === 'boost' ? 'rgba(0, 242, 255, 0.15)' : 'rgba(188, 19, 254, 0.15)';
                    bgCtx.fillRect(cx, cy, config.cellSize, config.cellSize);
                    bgCtx.fillStyle = item.type === 'boost' ? '#00f2ff' : '#bc13fe';
                    bgCtx.font = `${config.cellSize * 0.8}px Arial`;
                    bgCtx.textAlign = 'center';
                    bgCtx.fillText(item.type === 'boost' ? '⚡' : '🕸️', cx + config.cellSize/2, cy + config.cellSize * 0.8);
                }
            }
        }
    }
    const ex = Math.floor(config.width/2) * config.cellSize;
    const ey = Math.floor(config.height/2) * config.cellSize;
    bgCtx.fillStyle = '#bc13fe';
    bgCtx.shadowBlur = 20;
    bgCtx.shadowColor = '#bc13fe';
    bgCtx.beginPath();
    bgCtx.arc(ex + config.cellSize/2, ey + config.cellSize/2, config.cellSize/1.5, 0, Math.PI*2);
    bgCtx.fill();
    bgCtx.shadowBlur = 0;
}

function addHistoryLog(msg, color = '#fff') {
    const div = document.createElement('div');
    div.className = 'log-entry';
    div.style.borderLeftColor = color;
    div.innerHTML = `<span style="color: ${color}">${msg}</span>`;
    logPanel.prepend(div);
    logPanel.scrollTop = 0;
}

function spawnFloatingText(x, y, text, color) {
    state.floatingTexts.push({ x, y, text, color, life: 1.0 });
}

function handleFinish(p) {
    state.finishedCount++;
    state.cameraShake = 8;
    addHistoryLog(`🏁 ${p.name} SAFE! (#${state.finishedCount})`, p.color);
    const li = document.createElement('li');
    li.innerHTML = `<span style="color:${p.color}">${p.name}</span> <b>#${state.finishedCount}</b>`;
    finishedList.appendChild(li);

    if (state.finishedCount === state.players.length - 1) {
        const loser = state.players.find(pl => !pl.finished);
        gameMessage.innerText = `TERMINATED: ${loser.name.toUpperCase()} LOST`;
        state.running = false;
        restartBtn.classList.remove('hidden');
    }
}

function initGame() {
    const nameInputs = document.querySelectorAll('.player-name-input');
    const playerConfigs = Array.from(nameInputs).map((input, i) => ({
        name: input.value.trim() || `RUNNER ${i+1}`,
        color: COLORS[i % COLORS.length]
    }));

    setupScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');

    const difficultyVal = parseInt(document.getElementById('difficulty').value);
    config.width = config.height = difficultyVal * 2 + 1;
    const shapes = ['rect', 'circle', 'diamond'];
    config.shape = shapes[Math.floor(Math.random() * shapes.length)];

    const container = document.querySelector('.canvas-container');
    const size = Math.min(container.clientWidth, container.clientHeight) - 40;
    config.cellSize = Math.floor(size / config.width);
    canvas.width = canvas.height = config.width * config.cellSize;

    state.maze = generateMaze(config.width, config.height, config.shape);
    const exit = {x: Math.floor(config.width/2), y: Math.floor(config.height/2)};
    state.maze[exit.y][exit.x] = 0;

    const validStarts = [];
    for(let y=1; y<config.height-1; y++) {
        for(let x=1; x<config.width-1; x++) {
            if(state.maze[y][x] === 0) {
                const dist = Math.sqrt((x-exit.x)**2 + (y-exit.y)**2);
                if(dist > config.width/4) validStarts.push({x,y});
            }
        }
    }

    state.players = playerConfigs.map(c => {
        const startIdx = Math.floor(Math.random() * validStarts.length);
        const s = validStarts.splice(startIdx, 1)[0] || {x:1, y:1};
        return new Player(c.name, c.color, s, exit, state.maze);
    });

    state.floatingTexts = [];
    state.finishedCount = 0;
    state.running = true;
    logPanel.innerHTML = '';
    addHistoryLog(`🚀 SYSTEM INITIALIZED (${config.shape.toUpperCase()})`, '#00f2ff');
    
    preRenderMaze();
    activeList.innerHTML = '';
    finishedList.innerHTML = '';
    gameMessage.innerText = "SIGNAL ACQUIRED. RACING...";
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
        state.floatingTexts[i].life -= 0.025;
        state.floatingTexts[i].y -= 0.4;
        if(state.floatingTexts[i].life <= 0) state.floatingTexts.splice(i, 1);
    }
    if(state.cameraShake > 0) state.cameraShake *= 0.85;

    const survivors = state.players.filter(p => !p.finished).sort((a,b) => b.currentIdx - a.currentIdx);
    activeList.innerHTML = survivors.map(p => {
        let status = '';
        if(p.state === 'BOOST') status = '<span class="badge badge-boost">BOOST</span>';
        if(p.state === 'STUN') status = '<span class="badge badge-stun">GLITCH</span>';
        if(p.state === 'SLOW') status = '<span class="badge badge-slow">TRAPPED</span>';
        return `<li><span style="color:${p.color}">● ${p.name}</span> <div>${status}</div></li>`;
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
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(t.text, t.x, t.y - 12);
    });
    ctx.restore();
}

startBtn.addEventListener('click', initGame);
restartBtn.addEventListener('click', () => {
    gameScreen.classList.add('hidden');
    setupScreen.classList.remove('hidden');
    restartBtn.classList.add('hidden');
});
window.adjustPlayerCount = adjustPlayerCount;
window.randomizeName = randomizeName;
window.showPolicy = showPolicy;
window.closeModal = closeModal;
