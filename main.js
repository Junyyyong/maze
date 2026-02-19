const canvas = document.getElementById('maze-canvas');
const ctx = canvas.getContext('2d');
const setupScreen = document.getElementById('setup-screen');
const gameScreen = document.getElementById('game-screen');
const startBtn = document.getElementById('start-btn');
const restartBtn = document.getElementById('restart-btn');
const activeList = document.getElementById('active-list');
const finishedList = document.getElementById('finished-list');
const logPanel = document.getElementById('log-panel');
const survivorCountSpan = document.getElementById('survivor-count');
const gameMessage = document.getElementById('game-message');

let CELL_SIZE = 10;
let MAZE_WIDTH = 51;
let MAZE_HEIGHT = 51;
let players = [];
let maze = [];
let isGameRunning = false;
let finishedCount = 0;
let mazeShape = 'circle'; // 'circle', 'diamond', 'octagon'

const COLORS = [
    '#00f2ff', '#39ff14', '#bc13fe', '#ff073a', '#f8e71c', '#ff00ff', '#00ffff', '#ffa500', '#ffc0cb', '#ffffff'
];

class Player {
    constructor(name, color, startPos, endPos, mazeData) {
        this.name = name;
        this.color = color;
        this.path = solveMaze(mazeData, startPos, endPos);
        this.pathIndex = 0;
        this.baseSpeed = 0.2 + Math.random() * 0.2;
        this.speed = this.baseSpeed;
        this.state = 'RUNNING';
        this.stateTimer = 0;
        this.finished = false;
        this.finishTime = 0;
        this.history = []; // 잔상을 위한 위치 기록
        this.x = startPos.x * CELL_SIZE + CELL_SIZE/2;
        this.y = startPos.y * CELL_SIZE + CELL_SIZE/2;
    }

    update() {
        if (this.finished) return;

        if (this.stateTimer > 0) {
            this.stateTimer--;
            if (this.stateTimer <= 0) {
                this.state = 'RUNNING';
                this.speed = this.baseSpeed;
            }
        }

        if (this.state === 'RUNNING' && Math.random() < 0.008) {
            const r = Math.random();
            if (r < 0.3) {
                this.state = 'BOOST';
                this.speed = this.baseSpeed * 3;
                this.stateTimer = 50;
                addLog(`🚀 ${this.name} 초가속!`);
            } else if (r < 0.5) {
                this.state = 'STUNNED';
                this.speed = 0;
                this.stateTimer = 40;
                addLog(`💫 ${this.name} 과부하!`);
            }
        }

        this.pathIndex += this.speed;

        if (this.pathIndex >= this.path.length - 1) {
            this.finished = true;
            this.pathIndex = this.path.length - 1;
            this.finishTime = Date.now();
            handleFinish(this);
        }

        const idx = Math.floor(this.pathIndex);
        const nextIdx = Math.min(idx + 1, this.path.length - 1);
        const progress = this.pathIndex - idx;
        const p1 = this.path[idx];
        const p2 = this.path[nextIdx];

        this.x = (p1.x + (p2.x - p1.x) * progress) * CELL_SIZE + CELL_SIZE/2;
        this.y = (p1.y + (p2.y - p1.y) * progress) * CELL_SIZE + CELL_SIZE/2;

        // 잔상 기록
        this.history.push({x: this.x, y: this.y});
        if (this.history.length > 10) this.history.shift();
    }

    draw(ctx) {
        // 잔상 그리기
        if (this.state === 'BOOST' || this.speed > this.baseSpeed) {
            ctx.save();
            for(let i=0; i<this.history.length; i++) {
                const pos = this.history[i];
                const alpha = (i / this.history.length) * 0.5;
                ctx.fillStyle = this.color;
                ctx.globalAlpha = alpha;
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, (CELL_SIZE/2) * (i/this.history.length), 0, Math.PI*2);
                ctx.fill();
            }
            ctx.restore();
        }

        // 본체 (동그라미)
        ctx.save();
        ctx.shadowBlur = 15;
        ctx.shadowColor = this.color;
        ctx.fillStyle = this.color;
        if (this.finished) ctx.globalAlpha = 0.2;
        
        ctx.beginPath();
        ctx.arc(this.x, this.y, CELL_SIZE/2 - 1, 0, Math.PI * 2);
        ctx.fill();

        // 중앙 코어
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(this.x, this.y, CELL_SIZE/4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        if (!this.finished) {
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(this.name, this.x, this.y - CELL_SIZE);
        }
    }
}

function generateMaze(w, h, shape) {
    const map = Array.from({ length: h }, () => Array(w).fill(1));
    const stack = [];
    const centerX = Math.floor(w/2);
    const centerY = Math.floor(h/2);
    
    // 모양에 따른 마스킹
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let dist = 0;
            if (shape === 'circle') {
                dist = Math.sqrt((x-centerX)**2 + (y-centerY)**2);
                if (dist > w/2 - 2) map[y][x] = -1; // 사용 불가 영역
            } else if (shape === 'diamond') {
                dist = Math.abs(x-centerX) + Math.abs(y-centerY);
                if (dist > w/2 - 2) map[y][x] = -1;
            }
        }
    }

    // 시작점 찾기 (가장 가운데 근처의 유효한 공간)
    let start = {x: centerX, y: centerY};
    if (map[centerY][centerX] === -1) {
        // 유효한 공간 찾기
        outer: for(let r=0; r<w/2; r++) {
            for(let i=-r; i<=r; i++) {
                if(map[centerY+i] && map[centerY+i][centerX+r] === 1) { start={x:centerX+r, y:centerY+i}; break outer; }
            }
        }
    }

    map[start.y][start.x] = 0;
    stack.push(start);

    const dirs = [{x:0, y:-2}, {x:0, y:2}, {x:-2, y:0}, {x:2, y:0}];

    while (stack.length > 0) {
        const curr = stack[stack.length - 1];
        const neighbors = [];

        for (let d of dirs) {
            const nx = curr.x + d.x, ny = curr.y + d.y;
            if (nx > 0 && nx < w - 1 && ny > 0 && ny < h - 1 && map[ny][nx] === 1) {
                neighbors.push({ x: nx, y: ny, dx: d.x / 2, dy: d.y / 2 });
            }
        }

        if (neighbors.length > 0) {
            const next = neighbors[Math.floor(Math.random() * neighbors.length)];
            map[next.y][next.x] = 0;
            map[curr.y + next.dy][curr.x + next.dx] = 0;
            stack.push({ x: next.x, y: next.y });
        } else {
            stack.pop();
        }
    }
    return map;
}

function solveMaze(map, start, end) {
    const queue = [[start]];
    const visited = new Set([`${start.x},${start.y}`]);
    while (queue.length > 0) {
        const path = queue.shift();
        const curr = path[path.length - 1];
        if (curr.x === end.x && curr.y === end.y) return path;
        for (let d of [{x:0,y:-1},{x:0,y:1},{x:-1,y:0},{x:1,y:0}]) {
            const nx = curr.x + d.x, ny = curr.y + d.y;
            if (nx>=0 && nx<map[0].length && ny>=0 && ny<map.length && map[ny][nx]===0 && !visited.has(`${nx},${ny}`)) {
                visited.add(`${nx},${ny}`);
                queue.push([...path, {x:nx, y:ny}]);
            }
        }
    }
    return [start];
}

function initGame() {
    const names = document.getElementById('player-input').value.split(',').map(s => s.trim()).filter(s => s);
    if (names.length < 2) return alert("참가자 2명 이상 필요");

    setupScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');

    const diff = parseInt(document.getElementById('difficulty').value);
    MAZE_WIDTH = MAZE_HEIGHT = diff * 2 + 1;
    
    // 랜덤 모양 선택
    const shapes = ['circle', 'diamond', 'rect'];
    mazeShape = shapes[Math.floor(Math.random() * shapes.length)];

    const mainContent = document.querySelector('.main-content');
    const containerW = mainContent.clientWidth - 380;
    const containerH = mainContent.clientHeight;
    CELL_SIZE = Math.max(Math.min(containerW / MAZE_WIDTH, containerH / MAZE_HEIGHT, 20), 5);

    canvas.width = MAZE_WIDTH * CELL_SIZE;
    canvas.height = MAZE_HEIGHT * CELL_SIZE;

    maze = generateMaze(MAZE_WIDTH, MAZE_HEIGHT, mazeShape);

    // 출구 (가장 중앙)
    const exit = {x: Math.floor(MAZE_WIDTH/2), y: Math.floor(MAZE_HEIGHT/2)};
    // 출구가 벽이면 뚫어줌
    maze[exit.y][exit.x] = 0;

    // 플레이어 생성 (각자 랜덤한 가장자리에서 시작)
    const validStarts = [];
    for(let y=1; y<MAZE_HEIGHT-1; y++) {
        for(let x=1; x<MAZE_WIDTH-1; x++) {
            if(maze[y][x] === 0) {
                // 가장자리에 가까운 지점들 수집
                const dist = Math.sqrt((x-exit.x)**2 + (y-exit.y)**2);
                if(dist > MAZE_WIDTH/2 - 5) validStarts.push({x,y});
            }
        }
    }

    players = names.map((name, i) => {
        const startPos = validStarts[Math.floor(Math.random() * validStarts.length)];
        return new Player(name, COLORS[i % COLORS.length], startPos, exit, maze);
    });

    finishedCount = 0;
    isGameRunning = true;
    logPanel.innerHTML = '';
    addLog(`System: ${mazeShape.toUpperCase()} 필드 생성 완료.`);
    requestAnimationFrame(gameLoop);
}

function handleFinish(p) {
    finishedCount++;
    addLog(`🏁 ${p.name} 탈출! (#${finishedCount})`);
    if (finishedCount === players.length - 1) {
        const loser = players.find(pl => !pl.finished);
        gameMessage.innerText = `LOOSER: ${loser.name}`;
        isGameRunning = false;
        restartBtn.classList.remove('hidden');
    }
}

function addLog(msg) {
    const div = document.createElement('div');
    div.className = 'log-entry';
    div.innerText = msg;
    logPanel.prepend(div);
}

function update() {
    players.forEach(p => p.update());
}

function draw() {
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 미로 벽 그리기
    ctx.save();
    ctx.shadowBlur = 8;
    ctx.shadowColor = '#00f2ff';
    ctx.strokeStyle = 'rgba(0, 242, 255, 0.5)';
    ctx.lineWidth = 1;

    for (let y = 0; y < MAZE_HEIGHT; y++) {
        for (let x = 0; x < MAZE_WIDTH; x++) {
            if (maze[y][x] === 1) {
                ctx.fillStyle = '#111';
                ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
                ctx.strokeRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
            }
        }
    }
    ctx.restore();

    // 출구 표시
    const ex = Math.floor(MAZE_WIDTH/2) * CELL_SIZE;
    const ey = Math.floor(MAZE_HEIGHT/2) * CELL_SIZE;
    ctx.save();
    ctx.shadowBlur = 20;
    ctx.shadowColor = '#bc13fe';
    ctx.fillStyle = '#bc13fe';
    ctx.beginPath();
    ctx.arc(ex + CELL_SIZE/2, ey + CELL_SIZE/2, CELL_SIZE, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();

    players.forEach(p => p.draw(ctx));
}

function gameLoop() {
    if (!isGameRunning) { draw(); return; }
    update();
    draw();
    requestAnimationFrame(gameLoop);
}

startBtn.addEventListener('click', initGame);
restartBtn.addEventListener('click', () => {
    gameScreen.classList.add('hidden');
    setupScreen.classList.remove('hidden');
    restartBtn.classList.add('hidden');
});
