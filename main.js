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

// 설정값
let CELL_SIZE = 10;
let MAZE_WIDTH = 51; // 홀수여야 함
let MAZE_HEIGHT = 51;
let players = [];
let maze = [];
let path = []; // 정답 경로
let isGameRunning = false;
let finishedCount = 0;

const COLORS = [
    '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#ffa500', '#800080', '#008000', '#ffc0cb'
];

class Player {
    constructor(name, color, path) {
        this.name = name;
        this.color = color;
        this.path = path; // 따라갈 경로 좌표 배열 [{x,y}, {x,y}...]
        this.pathIndex = 0; // 현재 경로상 인덱스 (float)
        this.speed = 0.3 + Math.random() * 0.2; // 기본 속도
        this.baseSpeed = this.speed;
        this.state = 'RUNNING'; // RUNNING, STUNNED, BOOST
        this.stateTimer = 0;
        this.finished = false;
        this.finishTime = 0;
        this.x = path[0].x * CELL_SIZE + CELL_SIZE/2;
        this.y = path[0].y * CELL_SIZE + CELL_SIZE/2;
    }

    update() {
        if (this.finished) return;

        // 상태 관리
        if (this.stateTimer > 0) {
            this.stateTimer--;
            if (this.stateTimer <= 0) {
                this.state = 'RUNNING';
                this.speed = this.baseSpeed;
            }
        }

        // 랜덤 이벤트 발생 (1% 확률)
        if (this.state === 'RUNNING' && Math.random() < 0.01) {
            const r = Math.random();
            if (r < 0.3) {
                this.state = 'BOOST';
                this.speed = this.baseSpeed * 2.5;
                this.stateTimer = 60; // 1초
                addLog(`🚀 ${this.name} 부스터 발동!`);
            } else if (r < 0.5) {
                this.state = 'STUNNED';
                this.speed = 0;
                this.stateTimer = 40; // 0.6초
                addLog(`💫 ${this.name} 미끄러짐!`);
            } else if (r < 0.6) {
                 this.speed = this.baseSpeed * 0.5; // 일시적 감속
                 this.stateTimer = 30;
                 // 로그는 너무 많으면 지저분하니 생략
            }
        }

        // 이동
        this.pathIndex += this.speed;

        // 도착 체크
        if (this.pathIndex >= this.path.length - 1) {
            this.finished = true;
            this.pathIndex = this.path.length - 1;
            this.finishTime = Date.now();
            handleFinish(this);
        }

        // 화면 좌표 계산 (선형 보간)
        const idx = Math.floor(this.pathIndex);
        const nextIdx = Math.min(idx + 1, this.path.length - 1);
        const progress = this.pathIndex - idx;
        
        const p1 = this.path[idx];
        const p2 = this.path[nextIdx];

        // 좌표 보간
        const tx = p1.x + (p2.x - p1.x) * progress;
        const ty = p1.y + (p2.y - p1.y) * progress;

        // 흔들림 효과 (겹침 방지)
        const jitterX = (Math.random() - 0.5) * (CELL_SIZE * 0.4);
        const jitterY = (Math.random() - 0.5) * (CELL_SIZE * 0.4);

        this.x = tx * CELL_SIZE + CELL_SIZE/2 + jitterX;
        this.y = ty * CELL_SIZE + CELL_SIZE/2 + jitterY;
    }

    draw(ctx) {
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, CELL_SIZE/2 - 1, 0, Math.PI * 2);
        ctx.fill();

        // 이름표
        if (!this.finished) {
            ctx.fillStyle = '#fff';
            ctx.font = '10px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(this.name, this.x, this.y - CELL_SIZE);
        }
    }
}

// 미로 생성 (Recursive Backtracker)
function generateMaze(w, h) {
    const map = Array.from({ length: h }, () => Array(w).fill(1));
    const stack = [];
    const start = { x: 1, y: 1 };
    
    map[start.y][start.x] = 0;
    stack.push(start);

    const dirs = [
        { x: 0, y: -2 }, { x: 0, y: 2 }, { x: -2, y: 0 }, { x: 2, y: 0 }
    ];

    while (stack.length > 0) {
        const current = stack[stack.length - 1];
        const neighbors = [];

        for (let d of dirs) {
            const nx = current.x + d.x;
            const ny = current.y + d.y;

            if (nx > 0 && nx < w - 1 && ny > 0 && ny < h - 1 && map[ny][nx] === 1) {
                neighbors.push({ x: nx, y: ny, dx: d.x / 2, dy: d.y / 2 });
            }
        }

        if (neighbors.length > 0) {
            const next = neighbors[Math.floor(Math.random() * neighbors.length)];
            map[next.y][next.x] = 0;
            map[current.y + next.dy][current.x + next.dx] = 0; // 벽 뚫기
            stack.push({ x: next.x, y: next.y });
        } else {
            stack.pop();
        }
    }
    return map;
}

// 길 찾기 (BFS)
function solveMaze(map, start, end) {
    const queue = [[start]];
    const visited = new Set([`${start.x},${start.y}`]);

    while (queue.length > 0) {
        const path = queue.shift();
        const curr = path[path.length - 1];

        if (curr.x === end.x && curr.y === end.y) {
            return path;
        }

        const dirs = [{x:0, y:-1}, {x:0, y:1}, {x:-1, y:0}, {x:1, y:0}];
        for (let d of dirs) {
            const nx = curr.x + d.x;
            const ny = curr.y + d.y;
            
            if (nx >= 0 && nx < map[0].length && ny >= 0 && ny < map.length && 
                map[ny][nx] === 0 && !visited.has(`${nx},${ny}`)) {
                visited.add(`${nx},${ny}`);
                queue.push([...path, {x: nx, y: ny}]);
            }
        }
    }
    return []; // 길 없음 (이론상 안 생김)
}

function initGame() {
    const names = document.getElementById('player-input').value.split(',').map(s => s.trim()).filter(s => s);
    if (names.length < 2) {
        alert("최소 2명 이상의 참가자가 필요합니다.");
        return;
    }

    const diff = parseInt(document.getElementById('difficulty').value);
    MAZE_WIDTH = diff * 2 + 1;
    MAZE_HEIGHT = diff * 2 + 1;

    // 캔버스 리사이징
    // 화면 크기에 맞춰 셀 크기 조정
    const containerW = document.querySelector('.main-content').clientWidth * 0.75;
    const containerH = document.querySelector('.main-content').clientHeight;
    const sizeW = Math.floor(containerW / MAZE_WIDTH);
    const sizeH = Math.floor(containerH / MAZE_HEIGHT);
    CELL_SIZE = Math.min(sizeW, sizeH, 15); // 최대 15px

    canvas.width = MAZE_WIDTH * CELL_SIZE;
    canvas.height = MAZE_HEIGHT * CELL_SIZE;

    // 미로 생성
    maze = generateMaze(MAZE_WIDTH, MAZE_HEIGHT);
    path = solveMaze(maze, {x:1, y:1}, {x: MAZE_WIDTH-2, y: MAZE_HEIGHT-2});

    // 플레이어 생성
    players = names.map((name, i) => {
        return new Player(name, COLORS[i % COLORS.length], path);
    });

    setupScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');
    restartBtn.classList.add('hidden');
    
    activeList.innerHTML = '';
    finishedList.innerHTML = '';
    logPanel.innerHTML = '<div class="log-entry">게임 시작!</div>';
    finishedCount = 0;
    survivorCountSpan.innerText = players.length;
    gameMessage.innerText = "RUN FOR YOUR LIFE!";

    isGameRunning = true;
    updateLeaderboard();
    requestAnimationFrame(gameLoop);
}

function handleFinish(player) {
    finishedCount++;
    survivorCountSpan.innerText = players.length - finishedCount;
    addLog(`🚩 ${player.name} 탈출 성공! (#${finishedCount})`);
    
    // 탈출 목록 이동
    updateLeaderboard();

    // 꼴등 확정 시
    if (finishedCount === players.length - 1) {
        const loser = players.find(p => !p.finished);
        addLog(`☠️ ${loser.name} 당첨 확정!`);
        gameMessage.innerText = `${loser.name} 님이 꼴등입니다!`;
        gameMessage.style.color = 'red';
        isGameRunning = false;
        restartBtn.classList.remove('hidden');
        draw(); // 마지막 프레임 그림
    } else if (finishedCount === players.length) {
         // 모두 동시 도착 (희박함)
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

function updateLeaderboard() {
    // 생존자 (거리순 정렬)
    const survivors = players.filter(p => !p.finished).sort((a,b) => b.pathIndex - a.pathIndex);
    activeList.innerHTML = survivors.map(p => `
        <li>
            <span><span class="player-dot" style="background:${p.color}"></span>${p.name}</span>
            <small>${Math.floor((p.pathIndex / path.length)*100)}%</small>
        </li>
    `).join('');

    // 완료자 (도착순)
    const finishers = players.filter(p => p.finished).sort((a,b) => a.finishTime - b.finishTime);
    finishedList.innerHTML = finishers.map((p, idx) => `
        <li>
            <span><span class="player-dot" style="background:${p.color}"></span>${p.name}</span>
            <small>#${idx + 1}</small>
        </li>
    `).join('');
}

function update() {
    players.forEach(p => p.update());
    
    // 리더보드는 0.5초마다가 아니라 매 프레임 하면 성능 이슈 있을 수 있으나
    // 인원이 적으므로 매 프레임 업데이트해도 무방 (부드러운 % 변화 위해)
    // 최적화를 위해 10프레임마다 한 번만 돔 렌더링 업데이트
    if (frameCnt % 10 === 0) updateLeaderboard();
}

let frameCnt = 0;
function draw() {
    // 배경 (잔상 효과를 위해 투명도 있는 검정으로 덮기 -> 네온 효과 극대화 하려면 그냥 지우는게 깔끔함)
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 미로 그리기
    ctx.fillStyle = '#222'; // 벽 색상
    for (let y = 0; y < MAZE_HEIGHT; y++) {
        for (let x = 0; x < MAZE_WIDTH; x++) {
            if (maze[y][x] === 1) {
                ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
            }
        }
    }

    // 도착지점
    ctx.fillStyle = 'rgba(0, 255, 0, 0.3)';
    ctx.fillRect((MAZE_WIDTH-2)*CELL_SIZE, (MAZE_HEIGHT-2)*CELL_SIZE, CELL_SIZE, CELL_SIZE);

    // 플레이어 그리기 (도착한 사람은 반투명)
    players.forEach(p => {
        if (p.finished) ctx.globalAlpha = 0.3;
        else ctx.globalAlpha = 1.0;
        p.draw(ctx);
    });
    ctx.globalAlpha = 1.0;
}

function gameLoop() {
    if (!isGameRunning) return;
    
    frameCnt++;
    update();
    draw();
    requestAnimationFrame(gameLoop);
}

startBtn.addEventListener('click', initGame);
restartBtn.addEventListener('click', () => {
    gameScreen.classList.add('hidden');
    setupScreen.classList.remove('hidden');
    gameMessage.innerText = "RACE IN PROGRESS...";
    gameMessage.style.color = 'inherit';
});
