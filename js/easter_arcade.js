/* ================= EASTER ARCADE VAULT ================= */
(function () {
    const ARCADE_MODAL_ID = 'easterArcadeModal';
    const REQUIRED_CLICKS = 5;
    const CLICK_WINDOW_MS = 5500;

    window.EASTER_ARCADE_CLICK_TRACKER = window.EASTER_ARCADE_CLICK_TRACKER || {
        count: 0,
        lastTs: 0,
        unlocked: false
    };

    function isOpen() {
        const modal = document.getElementById(ARCADE_MODAL_ID);
        return !!modal && !modal.classList.contains('hidden');
    }

    function ensureUI() {
        if (document.getElementById(ARCADE_MODAL_ID)) return;
        const html = `
            <div id="${ARCADE_MODAL_ID}" class="modal-overlay hidden" style="z-index:12500;">
                <div class="modal-box" style="width:min(980px,96vw); max-height:92vh; overflow-y:auto;">
                    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border-color); padding-bottom:10px; margin-bottom:10px;">
                        <h3 style="margin:0;"><i class="fas fa-gamepad"></i> Arcade Vault</h3>
                        <button class="btn-secondary btn-sm" onclick="closeEasterArcadeVault()">&times;</button>
                    </div>
                    <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:10px;">Unlocked easter egg mode. Local-only games available to all users.</div>
                    <div id="easterArcadeTabs" style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px;">
                        <button class="btn-primary btn-sm" data-game="tetris" onclick="easterArcadeShow('tetris')">Tetris</button>
                        <button class="btn-secondary btn-sm" data-game="snake" onclick="easterArcadeShow('snake')">Snake</button>
                        <button class="btn-secondary btn-sm" data-game="space" onclick="easterArcadeShow('space')">Space Impact</button>
                        <button class="btn-secondary btn-sm" data-game="hangman" onclick="easterArcadeShow('hangman')">Hangman</button>
                    </div>

                    <div id="easterGame-tetris" class="easter-game-panel">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                            <strong>Tetris</strong>
                            <span id="ea_t_status" style="font-size:0.78rem; color:var(--text-muted);">Paused</span>
                        </div>
                        <canvas id="ea_t_canvas" width="180" height="360" style="display:block; margin:0 auto 8px; border:1px solid #1f1f1f; background:#0a0a0a;"></canvas>
                        <div style="display:flex; justify-content:space-between; font-size:0.82rem; margin-bottom:8px;">
                            <span>Score: <strong id="ea_t_score">0</strong></span>
                            <span>Lines: <strong id="ea_t_lines">0</strong></span>
                        </div>
                        <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:6px;">
                            <button class="btn-secondary btn-sm" onclick="eaTetrisMove(-1)"><i class="fas fa-arrow-left"></i></button>
                            <button class="btn-secondary btn-sm" onclick="eaTetrisRotate()"><i class="fas fa-rotate"></i></button>
                            <button class="btn-secondary btn-sm" onclick="eaTetrisMove(1)"><i class="fas fa-arrow-right"></i></button>
                            <button class="btn-secondary btn-sm" onclick="eaTetrisDrop()"><i class="fas fa-arrow-down"></i></button>
                            <button class="btn-primary btn-sm" onclick="eaTetrisToggle()">Start / Pause</button>
                            <button class="btn-warning btn-sm" onclick="eaTetrisReset()">Reset</button>
                        </div>
                    </div>

                    <div id="easterGame-snake" class="easter-game-panel hidden">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                            <strong>Snake</strong>
                            <span id="ea_s_status" style="font-size:0.78rem; color:var(--text-muted);">Paused</span>
                        </div>
                        <canvas id="ea_s_canvas" width="240" height="240" style="display:block; margin:0 auto 8px; border:1px solid #1f1f1f; background:#0a0a0a;"></canvas>
                        <div style="display:flex; justify-content:space-between; font-size:0.82rem; margin-bottom:8px;">
                            <span>Score: <strong id="ea_s_score">0</strong></span>
                            <span>Controls: Arrows</span>
                        </div>
                        <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:6px;">
                            <button class="btn-secondary btn-sm" onclick="eaSnakeTurn('left')"><i class="fas fa-arrow-left"></i></button>
                            <button class="btn-secondary btn-sm" onclick="eaSnakeTurn('up')"><i class="fas fa-arrow-up"></i></button>
                            <button class="btn-secondary btn-sm" onclick="eaSnakeTurn('right')"><i class="fas fa-arrow-right"></i></button>
                            <button class="btn-secondary btn-sm" onclick="eaSnakeTurn('down')"><i class="fas fa-arrow-down"></i></button>
                            <button class="btn-primary btn-sm" onclick="eaSnakeToggle()">Start / Pause</button>
                            <button class="btn-warning btn-sm" onclick="eaSnakeReset()">Reset</button>
                        </div>
                    </div>

                    <div id="easterGame-space" class="easter-game-panel hidden">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                            <strong>Space Impact</strong>
                            <span id="ea_p_status" style="font-size:0.78rem; color:var(--text-muted);">Paused</span>
                        </div>
                        <canvas id="ea_p_canvas" width="420" height="260" style="display:block; margin:0 auto 8px; border:1px solid #1f1f1f; background:#020710;"></canvas>
                        <div style="display:flex; justify-content:space-between; font-size:0.82rem; margin-bottom:8px;">
                            <span>Score: <strong id="ea_p_score">0</strong></span>
                            <span>Lives: <strong id="ea_p_lives">3</strong></span>
                        </div>
                        <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:6px;">
                            <button class="btn-secondary btn-sm" onclick="eaSpaceMove(-1)"><i class="fas fa-arrow-up"></i></button>
                            <button class="btn-secondary btn-sm" onclick="eaSpaceShoot()"><i class="fas fa-bolt"></i></button>
                            <button class="btn-secondary btn-sm" onclick="eaSpaceMove(1)"><i class="fas fa-arrow-down"></i></button>
                            <button class="btn-primary btn-sm" onclick="eaSpaceToggle()">Start / Pause</button>
                            <button class="btn-warning btn-sm" style="grid-column:span 4;" onclick="eaSpaceReset()">Reset</button>
                        </div>
                        <div style="margin-top:8px; font-size:0.75rem; color:var(--text-muted);">Controls: Arrow Up/Down and Spacebar.</div>
                    </div>

                    <div id="easterGame-hangman" class="easter-game-panel hidden">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                            <strong>Hangman</strong>
                            <button class="btn-warning btn-sm" onclick="eaHangmanNew()">New Word</button>
                        </div>
                        <div id="ea_h_word" style="font-family:monospace; font-size:1.5rem; text-align:center; letter-spacing:6px; margin:10px 0;"></div>
                        <div style="display:flex; justify-content:space-between; font-size:0.85rem; margin-bottom:8px;">
                            <span>Wrong: <strong id="ea_h_wrong">None</strong></span>
                            <span id="ea_h_status" style="color:var(--text-muted);">Guess a letter</span>
                        </div>
                        <div id="ea_h_keys" style="display:grid; grid-template-columns:repeat(7,minmax(0,1fr)); gap:6px;"></div>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', html);
        const modal = document.getElementById(ARCADE_MODAL_ID);
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target && e.target.id === ARCADE_MODAL_ID) closeEasterArcadeVault();
            });
        }
    }

    function setActiveGame(game) {
        const state = ensureState();
        state.activeGame = game;
        ['tetris', 'snake', 'space', 'hangman'].forEach((key) => {
            const panel = document.getElementById(`easterGame-${key}`);
            const btn = document.querySelector(`#easterArcadeTabs button[data-game="${key}"]`);
            if (panel) panel.classList.toggle('hidden', key !== game);
            if (btn) {
                btn.classList.toggle('btn-primary', key === game);
                btn.classList.toggle('btn-secondary', key !== game);
            }
        });
    }

    function ensureState() {
        if (window.EASTER_ARCADE_STATE) return window.EASTER_ARCADE_STATE;
        window.EASTER_ARCADE_STATE = {
            keybound: false,
            activeGame: 'tetris',
            tetris: {},
            snake: {},
            space: {},
            hangman: {}
        };
        return window.EASTER_ARCADE_STATE;
    }

    window.easterArcadeShow = setActiveGame;

    window.openEasterArcadeVault = function (force) {
        const tracker = window.EASTER_ARCADE_CLICK_TRACKER;
        if (!force && !tracker.unlocked) return;
        ensureUI();
        const modal = document.getElementById(ARCADE_MODAL_ID);
        if (!modal) return;
        modal.classList.remove('hidden');
        initArcade();
    };

    window.closeEasterArcadeVault = function () {
        const modal = document.getElementById(ARCADE_MODAL_ID);
        if (modal) modal.classList.add('hidden');
        if (window.eaPauseAll) window.eaPauseAll();
    };

    function bindTrigger(target) {
        if (!target || target.dataset.arcadeBound === '1') return;
        target.dataset.arcadeBound = '1';
        target.style.cursor = 'pointer';
        target.addEventListener('click', () => {
            const tracker = window.EASTER_ARCADE_CLICK_TRACKER;
            const now = Date.now();
            if ((now - tracker.lastTs) > CLICK_WINDOW_MS) tracker.count = 0;
            tracker.count += 1;
            tracker.lastTs = now;
            if (tracker.count >= REQUIRED_CLICKS) {
                tracker.count = 0;
                tracker.unlocked = true;
                if (typeof showToast === 'function') showToast("Arcade Vault unlocked.", "success");
                openEasterArcadeVault(true);
                return;
            }
            if (tracker.count === REQUIRED_CLICKS - 2 && typeof showToast === 'function') {
                showToast("Two more clicks...", "info");
            }
        });
    }

    window.setupArcadeEasterEggTrigger = function () {
        bindTrigger(document.querySelector('.nav-brand'));
        bindTrigger(document.querySelector('.control-bubble .bubble-handle'));
    };

    function initArcade() {
        if (typeof window.eaInitAllGames === 'function') window.eaInitAllGames();
        setActiveGame(ensureState().activeGame || 'tetris');
    }
})();

(function () {
    const HANGMAN_WORDS = ['ROUTER', 'FIBER', 'NETWORK', 'TRAINING', 'ASSESSMENT', 'SCHEDULE', 'DASHBOARD', 'SUPABASE', 'VETTING'];

    function getState() {
        window.EASTER_ARCADE_STATE = window.EASTER_ARCADE_STATE || { tetris: {}, snake: {}, space: {}, hangman: {}, activeGame: 'tetris', keybound: false };
        return window.EASTER_ARCADE_STATE;
    }

    function isOpen() {
        const modal = document.getElementById('easterArcadeModal');
        return !!modal && !modal.classList.contains('hidden');
    }

    function initTetris() {
        const s = getState().tetris;
        if (s.ready) return;
        s.rows = 20; s.cols = 10; s.cell = 18;
        s.board = Array.from({ length: s.rows }, () => Array(s.cols).fill(0));
        s.pieces = [[[1,1,1,1]],[[1,1],[1,1]],[[0,1,0],[1,1,1]],[[1,0,0],[1,1,1]],[[0,0,1],[1,1,1]],[[0,1,1],[1,1,0]],[[1,1,0],[0,1,1]]];
        s.colors = ['#2ecc71','#3498db','#f39c12','#f1c40f','#1abc9c','#9b59b6','#e74c3c'];
        s.score = 0; s.lines = 0; s.dropMs = 500; s.active = false; s.paused = true; s.gameOver = false; s.raf = null; s.last = 0; s.current = null;
        s.ready = true;
    }

    function tPiece() {
        const s = getState().tetris;
        const idx = Math.floor(Math.random() * s.pieces.length);
        return { matrix: s.pieces[idx].map(r => r.slice()), color: idx + 1, x: Math.floor((s.cols - s.pieces[idx][0].length) / 2), y: 0 };
    }
    function tCollide(piece) {
        const s = getState().tetris;
        for (let y = 0; y < piece.matrix.length; y++) for (let x = 0; x < piece.matrix[y].length; x++) {
            if (!piece.matrix[y][x]) continue;
            const nx = piece.x + x, ny = piece.y + y;
            if (nx < 0 || nx >= s.cols || ny >= s.rows) return true;
            if (ny >= 0 && s.board[ny][nx]) return true;
        }
        return false;
    }
    function tMerge() {
        const s = getState().tetris;
        if (!s.current) return;
        s.current.matrix.forEach((row, y) => row.forEach((v, x) => {
            if (!v) return;
            const ny = s.current.y + y, nx = s.current.x + x;
            if (ny >= 0 && ny < s.rows && nx >= 0 && nx < s.cols) s.board[ny][nx] = s.current.color;
        }));
    }
    function tClear() {
        const s = getState().tetris;
        let cleared = 0;
        for (let y = s.rows - 1; y >= 0; y--) {
            if (!s.board[y].every(c => c > 0)) continue;
            s.board.splice(y, 1); s.board.unshift(Array(s.cols).fill(0)); cleared++; y++;
        }
        if (cleared > 0) {
            s.lines += cleared; s.score += (cleared * cleared) * 100; s.dropMs = Math.max(120, 500 - Math.floor(s.lines / 4) * 25);
        }
    }
    function tSpawn() {
        const s = getState().tetris; s.current = tPiece();
        if (tCollide(s.current)) { s.gameOver = true; s.active = false; s.paused = true; if (s.raf) cancelAnimationFrame(s.raf); s.raf = null; }
    }
    function tDropStep() {
        const s = getState().tetris;
        if (!s.current || s.gameOver) return;
        s.current.y += 1;
        if (tCollide(s.current)) {
            s.current.y -= 1; tMerge(); tClear(); tSpawn();
        }
    }
    function tRotate(mat) {
        const h = mat.length, w = mat[0].length, out = Array.from({ length: w }, () => Array(h).fill(0));
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[x][h - 1 - y] = mat[y][x];
        return out;
    }
    function tDraw() {
        const s = getState().tetris;
        const canvas = document.getElementById('ea_t_canvas'); if (!canvas) return;
        const ctx = canvas.getContext('2d'); if (!ctx) return;
        ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        const drawCell = (x, y, c) => { ctx.fillStyle = s.colors[(c - 1) % s.colors.length] || '#2ecc71'; ctx.fillRect(x * s.cell, y * s.cell, s.cell - 1, s.cell - 1); };
        s.board.forEach((row, y) => row.forEach((v, x) => { if (v) drawCell(x, y, v); }));
        if (s.current) s.current.matrix.forEach((row, y) => row.forEach((v, x) => { if (v) drawCell(s.current.x + x, s.current.y + y, s.current.color); }));
        const score = document.getElementById('ea_t_score'), lines = document.getElementById('ea_t_lines'), status = document.getElementById('ea_t_status');
        if (score) score.innerText = String(s.score); if (lines) lines.innerText = String(s.lines); if (status) status.innerText = s.gameOver ? 'Game Over' : (s.paused ? 'Paused' : 'Running');
    }
    function tLoop(ts) {
        const s = getState().tetris;
        if (!isOpen()) { s.active = false; s.paused = true; s.raf = null; return; }
        if (!s.active || s.paused || s.gameOver) { s.raf = null; tDraw(); return; }
        if (!s.last) s.last = ts;
        if (ts - s.last >= s.dropMs) { s.last = ts; tDropStep(); tDraw(); }
        s.raf = requestAnimationFrame(tLoop);
    }

    window.eaTetrisReset = function () { initTetris(); const s = getState().tetris; s.board = Array.from({ length: s.rows }, () => Array(s.cols).fill(0)); s.score = 0; s.lines = 0; s.dropMs = 500; s.active = false; s.paused = true; s.gameOver = false; s.last = 0; if (s.raf) cancelAnimationFrame(s.raf); s.raf = null; s.current = tPiece(); tDraw(); };
    window.eaTetrisToggle = function () { initTetris(); const s = getState().tetris; if (s.gameOver && !s.current) window.eaTetrisReset(); if (!s.current) tSpawn(); s.active = true; s.paused = !s.paused; if (!s.paused && !s.raf) { s.last = 0; s.raf = requestAnimationFrame(tLoop); } tDraw(); };
    window.eaTetrisMove = function (delta) { const s = getState().tetris; if (!s.current || s.paused || s.gameOver) return; s.current.x += delta; if (tCollide(s.current)) s.current.x -= delta; tDraw(); };
    window.eaTetrisRotate = function () { const s = getState().tetris; if (!s.current || s.paused || s.gameOver) return; const old = s.current.matrix; s.current.matrix = tRotate(old); if (tCollide(s.current)) s.current.matrix = old; tDraw(); };
    window.eaTetrisDrop = function () { const s = getState().tetris; if (!s.current || s.paused || s.gameOver) return; tDropStep(); tDraw(); };

    function initSnake() {
        const s = getState().snake;
        if (s.ready) return;
        s.size = 16; s.cell = 15; s.score = 0; s.speed = 130; s.active = false; s.paused = true; s.gameOver = false; s.timer = null;
        s.direction = 'right'; s.next = 'right'; s.snake = [{ x: 4, y: 8 }, { x: 3, y: 8 }, { x: 2, y: 8 }]; s.food = { x: 10, y: 8 };
        s.ready = true;
    }
    function snakeFood() {
        const s = getState().snake, taken = new Set(s.snake.map(p => `${p.x},${p.y}`));
        let x = 0, y = 0, guard = 0;
        do { x = Math.floor(Math.random() * s.size); y = Math.floor(Math.random() * s.size); guard++; } while (taken.has(`${x},${y}`) && guard < 500);
        s.food = { x, y };
    }
    function snakeDraw() {
        const s = getState().snake, canvas = document.getElementById('ea_s_canvas'); if (!canvas) return;
        const ctx = canvas.getContext('2d'); if (!ctx) return;
        ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#e74c3c'; ctx.fillRect(s.food.x * s.cell, s.food.y * s.cell, s.cell - 1, s.cell - 1);
        s.snake.forEach((part, i) => { ctx.fillStyle = i === 0 ? '#2ecc71' : '#27ae60'; ctx.fillRect(part.x * s.cell, part.y * s.cell, s.cell - 1, s.cell - 1); });
        const score = document.getElementById('ea_s_score'), status = document.getElementById('ea_s_status');
        if (score) score.innerText = String(s.score); if (status) status.innerText = s.gameOver ? 'Game Over' : (s.paused ? 'Paused' : 'Running');
    }
    function snakePause() { const s = getState().snake; if (s.timer) clearInterval(s.timer); s.timer = null; }
    function snakeTick() {
        const s = getState().snake;
        if (!isOpen()) { s.active = false; s.paused = true; snakePause(); return; }
        if (!s.active || s.paused || s.gameOver) { snakeDraw(); return; }
        s.direction = s.next;
        const head = { ...s.snake[0] };
        if (s.direction === 'up') head.y -= 1; if (s.direction === 'down') head.y += 1; if (s.direction === 'left') head.x -= 1; if (s.direction === 'right') head.x += 1;
        if (head.x < 0 || head.y < 0 || head.x >= s.size || head.y >= s.size || s.snake.some(p => p.x === head.x && p.y === head.y)) { s.gameOver = true; s.active = false; s.paused = true; snakePause(); snakeDraw(); return; }
        s.snake.unshift(head);
        if (head.x === s.food.x && head.y === s.food.y) { s.score += 10; snakeFood(); } else s.snake.pop();
        snakeDraw();
    }
    window.eaSnakeReset = function () { initSnake(); const s = getState().snake; s.score = 0; s.gameOver = false; s.active = false; s.paused = true; s.direction = 'right'; s.next = 'right'; s.snake = [{ x: 4, y: 8 }, { x: 3, y: 8 }, { x: 2, y: 8 }]; snakeFood(); snakePause(); snakeDraw(); };
    window.eaSnakeToggle = function () { initSnake(); const s = getState().snake; if (s.gameOver) window.eaSnakeReset(); s.active = true; s.paused = !s.paused; if (!s.paused && !s.timer) s.timer = setInterval(snakeTick, s.speed); if (s.paused) snakePause(); snakeDraw(); };
    window.eaSnakeTurn = function (dir) { const s = getState().snake, c = s.direction; if ((c === 'up' && dir === 'down') || (c === 'down' && dir === 'up') || (c === 'left' && dir === 'right') || (c === 'right' && dir === 'left')) return; s.next = dir; };

    function initSpace() {
        const s = getState().space;
        if (s.ready) return;
        s.w = 420; s.h = 260; s.px = 18; s.py = 128; s.pw = 18; s.ph = 12;
        s.bullets = []; s.enemies = []; s.score = 0; s.lives = 3; s.fireCd = 0; s.spawnMs = 850; s.spawnTimer = 0; s.active = false; s.paused = true; s.gameOver = false; s.raf = null; s.last = 0;
        s.ready = true;
    }
    function spaceDraw() {
        const s = getState().space, canvas = document.getElementById('ea_p_canvas'); if (!canvas) return;
        const ctx = canvas.getContext('2d'); if (!ctx) return;
        ctx.fillStyle = '#020710'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#22324a'; for (let i = 0; i < 52; i++) { const x = (i * 67 + Math.floor((Date.now() / 28) % canvas.width)) % canvas.width; const y = (i * 31) % canvas.height; ctx.fillRect(x, y, 2, 2); }
        ctx.fillStyle = '#33d0ff'; ctx.beginPath(); ctx.moveTo(s.px, s.py); ctx.lineTo(s.px, s.py + s.ph); ctx.lineTo(s.px + s.pw, s.py + Math.floor(s.ph / 2)); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#f1c40f'; s.bullets.forEach(b => ctx.fillRect(b.x, b.y, 7, 2));
        ctx.fillStyle = '#ff5c5c'; s.enemies.forEach(en => ctx.fillRect(en.x, en.y, 16, 10));
        const score = document.getElementById('ea_p_score'), lives = document.getElementById('ea_p_lives'), status = document.getElementById('ea_p_status');
        if (score) score.innerText = String(s.score); if (lives) lives.innerText = String(s.lives); if (status) status.innerText = s.gameOver ? 'Game Over' : (s.paused ? 'Paused' : 'Running');
    }
    function spaceStep(dt) {
        const s = getState().space;
        s.fireCd = Math.max(0, s.fireCd - dt);
        s.bullets.forEach(b => { b.x += 9; });
        s.bullets = s.bullets.filter(b => b.x < s.w + 20);
        s.spawnTimer += dt;
        if (s.spawnTimer >= s.spawnMs) { s.spawnTimer = 0; s.enemies.push({ x: s.w + 10, y: 8 + Math.floor(Math.random() * (s.h - 18)), v: 1.8 + Math.random() * 1.8 }); }
        s.enemies.forEach(en => { en.x -= en.v; });

        const keepEnemies = [];
        s.enemies.forEach(en => {
            let hit = false;
            for (let i = 0; i < s.bullets.length; i++) {
                const b = s.bullets[i];
                if (b.x <= en.x + 16 && b.x + 7 >= en.x && b.y <= en.y + 10 && b.y + 2 >= en.y) { s.bullets.splice(i, 1); i--; s.score += 10; hit = true; break; }
            }
            if (!hit) keepEnemies.push(en);
        });
        s.enemies = keepEnemies;

        const survivors = [];
        s.enemies.forEach(en => {
            const collide = en.x <= s.px + s.pw && en.x + 16 >= s.px && en.y <= s.py + s.ph && en.y + 10 >= s.py;
            if (collide || en.x < -20) { s.lives -= 1; return; }
            survivors.push(en);
        });
        s.enemies = survivors;
        if (s.lives <= 0) { s.gameOver = true; s.active = false; s.paused = true; if (s.raf) cancelAnimationFrame(s.raf); s.raf = null; }
    }
    function spaceLoop(ts) {
        const s = getState().space;
        if (!isOpen()) { s.active = false; s.paused = true; s.raf = null; return; }
        if (!s.active || s.paused || s.gameOver) { s.raf = null; spaceDraw(); return; }
        if (!s.last) s.last = ts;
        const dt = Math.max(16, ts - s.last); s.last = ts;
        spaceStep(dt); spaceDraw(); s.raf = requestAnimationFrame(spaceLoop);
    }
    window.eaSpaceReset = function () { initSpace(); const s = getState().space; s.px = 18; s.py = 128; s.bullets = []; s.enemies = []; s.score = 0; s.lives = 3; s.fireCd = 0; s.spawnTimer = 0; s.active = false; s.paused = true; s.gameOver = false; s.last = 0; if (s.raf) cancelAnimationFrame(s.raf); s.raf = null; spaceDraw(); };
    window.eaSpaceToggle = function () { initSpace(); const s = getState().space; if (s.gameOver) window.eaSpaceReset(); s.active = true; s.paused = !s.paused; if (!s.paused && !s.raf) { s.last = 0; s.raf = requestAnimationFrame(spaceLoop); } spaceDraw(); };
    window.eaSpaceMove = function (dir) { const s = getState().space; s.py += dir * 14; s.py = Math.max(4, Math.min(s.h - s.ph - 4, s.py)); spaceDraw(); };
    window.eaSpaceShoot = function () { const s = getState().space; if (s.paused || s.gameOver || s.fireCd > 0) return; s.bullets.push({ x: s.px + s.pw + 1, y: s.py + Math.floor(s.ph / 2) }); s.fireCd = 120; spaceDraw(); };

    function initHangman() {
        const h = getState().hangman;
        if (h.ready) return;
        h.word = ''; h.guessed = new Set(); h.wrong = new Set(); h.maxWrong = 6; h.gameOver = false; h.ready = true;
    }
    function hRender() {
        const h = getState().hangman;
        const wordEl = document.getElementById('ea_h_word'), wrongEl = document.getElementById('ea_h_wrong'), statusEl = document.getElementById('ea_h_status'), keysEl = document.getElementById('ea_h_keys');
        if (!wordEl || !wrongEl || !statusEl || !keysEl) return;
        const masked = h.word.split('').map(ch => h.guessed.has(ch) ? ch : '_').join(' ');
        wordEl.innerText = masked;
        wrongEl.innerText = h.wrong.size > 0 ? Array.from(h.wrong).sort().join(', ') : 'None';
        const won = h.word && h.word.split('').every(ch => h.guessed.has(ch));
        const lost = h.wrong.size >= h.maxWrong;
        h.gameOver = won || lost;
        statusEl.innerText = won ? 'You won.' : (lost ? `Game over. Word: ${h.word}` : `${h.maxWrong - h.wrong.size} tries left`);
        statusEl.style.color = won ? '#2ecc71' : (lost ? '#ff5252' : 'var(--text-muted)');
        const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
        keysEl.innerHTML = letters.map(letter => {
            const used = h.guessed.has(letter) || h.wrong.has(letter) || h.gameOver;
            return `<button class="btn-secondary btn-sm" ${used ? 'disabled' : ''} onclick="eaHangmanGuess('${letter}')">${letter}</button>`;
        }).join('');
    }
    window.eaHangmanNew = function () { initHangman(); const h = getState().hangman; h.word = HANGMAN_WORDS[Math.floor(Math.random() * HANGMAN_WORDS.length)] || 'TRAINING'; h.guessed = new Set(); h.wrong = new Set(); h.gameOver = false; hRender(); };
    window.eaHangmanGuess = function (letter) { const h = getState().hangman; if (h.gameOver) return; const l = String(letter || '').toUpperCase(); if (!l || h.guessed.has(l) || h.wrong.has(l)) return; if (h.word.includes(l)) h.guessed.add(l); else h.wrong.add(l); hRender(); };

    window.eaPauseAll = function () {
        const st = getState();
        if (st.tetris && st.tetris.raf) cancelAnimationFrame(st.tetris.raf);
        if (st.snake && st.snake.timer) clearInterval(st.snake.timer);
        if (st.space && st.space.raf) cancelAnimationFrame(st.space.raf);
        if (st.tetris) { st.tetris.raf = null; st.tetris.active = false; st.tetris.paused = true; }
        if (st.snake) { st.snake.timer = null; st.snake.active = false; st.snake.paused = true; }
        if (st.space) { st.space.raf = null; st.space.active = false; st.space.paused = true; }
    };

    window.eaInitAllGames = function () {
        initTetris(); initSnake(); initSpace(); initHangman();
        if (!getState().tetris.current) window.eaTetrisReset(); else tDraw();
        snakeDraw(); spaceDraw();
        if (!getState().hangman.word) window.eaHangmanNew(); else hRender();

        const state = getState();
        if (!state.keybound) {
            window.addEventListener('keydown', (event) => {
                if (!isOpen()) return;
                const target = event.target;
                if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
                const key = String(event.key || '').toLowerCase();
                if (key === 'escape') { event.preventDefault(); if (window.closeEasterArcadeVault) window.closeEasterArcadeVault(); return; }
                if (state.activeGame === 'tetris') {
                    if (key === 'a' || key === 'arrowleft') { event.preventDefault(); window.eaTetrisMove(-1); return; }
                    if (key === 'd' || key === 'arrowright') { event.preventDefault(); window.eaTetrisMove(1); return; }
                    if (key === 'w' || key === 'arrowup') { event.preventDefault(); window.eaTetrisRotate(); return; }
                    if (key === 's' || key === 'arrowdown') { event.preventDefault(); window.eaTetrisDrop(); return; }
                }
                if (state.activeGame === 'snake') {
                    if (key === 'arrowup') { event.preventDefault(); window.eaSnakeTurn('up'); return; }
                    if (key === 'arrowdown') { event.preventDefault(); window.eaSnakeTurn('down'); return; }
                    if (key === 'arrowleft') { event.preventDefault(); window.eaSnakeTurn('left'); return; }
                    if (key === 'arrowright') { event.preventDefault(); window.eaSnakeTurn('right'); return; }
                }
                if (state.activeGame === 'space') {
                    if (key === 'arrowup' || key === 'w') { event.preventDefault(); window.eaSpaceMove(-1); return; }
                    if (key === 'arrowdown' || key === 's') { event.preventDefault(); window.eaSpaceMove(1); return; }
                    if (key === ' ') { event.preventDefault(); window.eaSpaceShoot(); return; }
                }
            });
            state.keybound = true;
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { if (window.setupArcadeEasterEggTrigger) window.setupArcadeEasterEggTrigger(); });
    } else {
        if (window.setupArcadeEasterEggTrigger) window.setupArcadeEasterEggTrigger();
    }
    window.addEventListener('focus', () => { if (window.setupArcadeEasterEggTrigger) window.setupArcadeEasterEggTrigger(); });
})();
