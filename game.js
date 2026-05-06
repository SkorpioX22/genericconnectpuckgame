import * as THREE from 'three';

// --- CONFIGURATION ---
const BOARD_SIZE = 5;
const DISCS_PER_ROUND = 8;
const HOLE_RADIUS = 0.4;
const HOLE_SPACING = 1.2;
const GRAVITY = -9.8;
const BOARD_Y = 0; // Board elevation

// --- STATE ---
let scene, camera, renderer;
let boardGroup, discsGroup;
let gameState = {
    discsRemaining: DISCS_PER_ROUND,
    round: 1,
    consecutiveWins: 0,
    board: Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(null)),
    activeDisc: null,
    canToss: true,
    roundEnded: false
};

// --- PHYSICS ---
class Disc {
    constructor(velocity, isGhost = false) {
        this.mesh = new THREE.Mesh(
            new THREE.CylinderGeometry(0.3, 0.3, 0.1, 32),
            new THREE.MeshPhongMaterial({ color: isGhost ? 0xffffff : 0xff0000, transparent: isGhost, opacity: isGhost ? 0.5 : 1 })
        );
        this.mesh.position.set(0, 1.5, 5); 
        this.mesh.castShadow = true;
        this.velocity = velocity || new THREE.Vector3(0, 0, 0);
        this.isLanded = false; // Fully stopped in hole
        this.capturedHole = null; // Currently sliding into a hole
        this.isGhost = isGhost;
        scene.add(this.mesh);
    }

    update(dt) {
        if (this.isLanded || this.isGhost) return;

        // Apply gravity
        this.velocity.y += GRAVITY * dt;

        // Apply air/surface friction
        const friction = this.mesh.position.y <= BOARD_Y + 0.15 ? 0.98 : 0.995;
        this.velocity.x *= friction;
        this.velocity.z *= friction;

        // Update position
        this.mesh.position.x += this.velocity.x * dt;
        this.mesh.position.y += this.velocity.y * dt;
        this.mesh.position.z += this.velocity.z * dt;

        const boardSurface = BOARD_Y + 0.1;

        // Handle sliding into a captured hole
        if (this.capturedHole) {
            const dx = this.capturedHole.x - this.mesh.position.x;
            const dz = this.capturedHole.z - this.mesh.position.z;
            const dist = Math.sqrt(dx * dx + dz * dz);

            // Pull towards center (spring effect)
            const pull = 15.0;
            this.velocity.x += dx * pull * dt;
            this.velocity.z += dz * pull * dt;
            
            // Extra friction while in the "hole zone"
            this.velocity.x *= 0.95;
            this.velocity.z *= 0.95;

            // If it's very close and slow, lock it
            if (dist < 0.05 && Math.abs(this.velocity.x) < 0.5 && Math.abs(this.velocity.z) < 0.5) {
                this.isLanded = true;
                this.mesh.position.set(this.capturedHole.x, boardSurface, this.capturedHole.z);
                this.velocity.set(0, 0, 0);
                onDiscLanded();
            }
        }

        // Collision detection with board surface
        if (this.mesh.position.y <= boardSurface && this.velocity.y < 0) {
            this.mesh.position.y = boardSurface;
            this.checkLanding();
        }

        // Check if stopped on board (outside of a hole)
        if (!this.capturedHole && this.mesh.position.y <= boardSurface + 0.01) {
            const speedSq = this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z;
            if (speedSq < 0.01) {
                this.isLanded = true; // Stop processing this disc
                this.velocity.set(0, 0, 0);
                onDiscMissed();
            }
        }

        // Out of bounds
        if (this.mesh.position.y < -2) {
            this.remove();
            onDiscMissed();
        }
    }

    checkLanding() {
        const boardX = this.mesh.position.x;
        const boardZ = this.mesh.position.z;

        const gridX = Math.round(boardX / HOLE_SPACING) + 2;
        const gridZ = Math.round(boardZ / HOLE_SPACING) + 2;

        const baseWidth = BOARD_SIZE * HOLE_SPACING + 0.4;
        const halfBase = baseWidth / 2;
        const isOnBoard = Math.abs(boardX) < halfBase && Math.abs(boardZ) < halfBase;

        if (isOnBoard && gridX >= 0 && gridX < BOARD_SIZE && gridZ >= 0 && gridZ < BOARD_SIZE) {
            const targetX = (gridX - 2) * HOLE_SPACING;
            const targetZ = (gridZ - 2) * HOLE_SPACING;
            
            const dx = boardX - targetX;
            const dz = boardZ - targetZ;
            const dist = Math.sqrt(dx * dx + dz * dz);
            
            const captureRadius = HOLE_RADIUS * 1.3; 
            
            if (dist < captureRadius && !gameState.board[gridZ][gridX]) {
                // Caught! Start the "slide-in" phase
                if (!this.capturedHole) {
                    this.capturedHole = { x: targetX, z: targetZ, r: gridZ, c: gridX };
                    gameState.board[gridZ][gridX] = true;
                    this.mesh.material.color.set(0xff3333); 
                }
                return;
            }
        }

        if (isOnBoard) {
            // Bounce/Slide logic
            if (Math.abs(this.velocity.y) > 0.5) {
                this.velocity.y = -this.velocity.y * 0.3; // Gentle bounce
            } else {
                this.velocity.y = 0;
            }
        }
    }

    remove() {
        scene.remove(this.mesh);
        if (gameState.activeDisc === this) gameState.activeDisc = null;
        if (gameState.ghostDisc === this) gameState.ghostDisc = null;
    }
}

// --- INITIALIZATION ---
function init() {
    console.log("Initializing Toss & Connect...");
    
    if (window.location.protocol === 'file:') {
        document.getElementById('protocol-warning').style.display = 'block';
        console.error("Three.js modules do not work via file:// protocol. Use a local server.");
        return;
    }

    try {
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x87ceeb); // Sky blue

        camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        camera.position.set(0, 4, 8); // Slightly higher/back for better aim view
        camera.lookAt(0, 0, 0);

        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.shadowMap.enabled = true;
        document.getElementById('game-container').appendChild(renderer.domElement);

        // Lights
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        scene.add(ambientLight);

        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(5, 10, 5);
        dirLight.castShadow = true;
        scene.add(dirLight);

        // Floor
        const floor = new THREE.Mesh(
            new THREE.PlaneGeometry(30, 30),
            new THREE.MeshStandardMaterial({ color: 0x222222 })
        );
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = -0.1;
        floor.receiveShadow = true;
        scene.add(floor);

        // Board
        createBoard();

        // Input
        setupInput();

        // Resize
        window.addEventListener('resize', () => {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        });

        animate();
    } catch (error) {
        console.error("Initialization failed:", error);
    }
}

function createBoard() {
    boardGroup = new THREE.Group();
    
    // Board Base
    const baseWidth = BOARD_SIZE * HOLE_SPACING + 0.4;
    const base = new THREE.Mesh(
        new THREE.BoxGeometry(baseWidth, 0.2, baseWidth),
        new THREE.MeshStandardMaterial({ color: 0x8b4513 })
    );
    base.position.y = BOARD_Y;
    base.receiveShadow = true;
    boardGroup.add(base);

    // Holes
    for (let i = 0; i < BOARD_SIZE; i++) {
        for (let j = 0; j < BOARD_SIZE; j++) {
            const hole = new THREE.Mesh(
                new THREE.CircleGeometry(HOLE_RADIUS, 32),
                new THREE.MeshBasicMaterial({ color: 0x222222 })
            );
            hole.rotation.x = -Math.PI / 2;
            hole.position.set(
                (j - 2) * HOLE_SPACING,
                BOARD_Y + 0.11,
                (i - 2) * HOLE_SPACING
            );
            boardGroup.add(hole);
        }
    }

    scene.add(boardGroup);
}

// --- INPUT HANDLING ---
let isDragging = false;
let dragPoints = [];

function setupInput() {
    const container = document.getElementById('game-container');
    
    const onStart = (x, y) => {
        if (!gameState.canToss || gameState.roundEnded) return;
        isDragging = true;
        dragPoints = [{ x, y, t: Date.now() }];
        
        // Create ghost disc at starting position
        gameState.ghostDisc = new Disc(null, true);
        updateGhostPosition(x, y);
    };

    const onMove = (x, y) => {
        if (!isDragging) return;
        dragPoints.push({ x, y, t: Date.now() });
        if (dragPoints.length > 5) dragPoints.shift();
        updateGhostPosition(x, y);
    };

    const onEnd = () => {
        if (!isDragging) return;
        isDragging = false;
        
        if (!gameState.ghostDisc) return;

        if (dragPoints.length < 2) {
            // If they just clicked and released without moving, do a default soft toss forward
            handleToss(0, -10, 0.1); 
            return;
        }

        const first = dragPoints[0];
        const last = dragPoints[dragPoints.length - 1];
        const dt = Math.max((last.t - first.t) / 1000, 0.01);
        const dx = last.x - first.x;
        const dy = last.y - first.y;

        // Release on EVERY end, even if dy is small
        handleToss(dx, dy, dt);
    };

    container.addEventListener('mousedown', (e) => onStart(e.clientX, e.clientY));
    window.addEventListener('mousemove', (e) => onMove(e.clientX, e.clientY));
    window.addEventListener('mouseup', onEnd);

    container.addEventListener('touchstart', (e) => onStart(e.touches[0].clientX, e.touches[0].clientY));
    window.addEventListener('touchmove', (e) => onMove(e.touches[0].clientX, e.touches[0].clientY));
    window.addEventListener('touchend', onEnd);
}

function updateGhostPosition(mouseX, mouseY) {
    if (!gameState.ghostDisc) return;
    
    // Simple screen to world mapping for the starting area
    const x = (mouseX / window.innerWidth) * 2 - 1;
    const y = -(mouseY / window.innerHeight) * 2 + 1;
    
    gameState.ghostDisc.mesh.position.x = x * 5;
    // Keep it at a reasonable height for tossing
    gameState.ghostDisc.mesh.position.y = THREE.MathUtils.clamp(y * 5 + 2, 0.5, 3);
    gameState.ghostDisc.mesh.position.z = 5;
}

function handleToss(dx, dy, dt) {
    // Proportional velocity based on swipe distance and time
    // dx and dy are in pixels. dt is in seconds.
    // We want a more sensitive, wide-range power curve.
    
    const powerScale = 0.015; // Tuning factor for overall strength
    
    // vx: Side to side (horizontal)
    const vx = (dx * powerScale * 0.5) / dt;
    
    // vy: Height (vertical arc) - keep this low for "horizontal-ish" feel
    // dy is negative for upward swipes.
    const vy = Math.abs(dy * powerScale * 0.15) / dt; 
    
    // vz: Depth (forward speed towards board) - most important for "power"
    const vz = (dy * powerScale) / dt; 

    const velocity = new THREE.Vector3(
        THREE.MathUtils.clamp(vx, -8, 8),
        THREE.MathUtils.clamp(vy, 0.5, 4), // Minimum vy to clear the floor, max low for horizontal
        THREE.MathUtils.clamp(vz, -15, -2) // Max -15 (fast), min -2 (very soft)
    );

    const startPos = gameState.ghostDisc.mesh.position.clone();
    if (gameState.ghostDisc) gameState.ghostDisc.remove();

    gameState.activeDisc = new Disc(velocity);
    gameState.activeDisc.mesh.position.copy(startPos);
    
    gameState.discsRemaining--;
    gameState.canToss = false;
    updateHUD();
}

// --- GAME LOGIC ---
function onDiscLanded() {
    gameState.activeDisc = null;
    checkWinCondition();
    
    if (!gameState.roundEnded) {
        if (gameState.discsRemaining > 0) {
            gameState.canToss = true;
        } else {
            endRound(false);
        }
    }
}

function onDiscMissed() {
    if (gameState.discsRemaining > 0) {
        gameState.canToss = true;
    } else {
        endRound(false);
    }
}

function checkWinCondition() {
    const b = gameState.board;
    
    // Check horizontal
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c <= BOARD_SIZE - 4; c++) {
            if (b[r][c] && b[r][c+1] && b[r][c+2] && b[r][c+3]) {
                endRound(true);
                return;
            }
        }
    }

    // Check vertical
    for (let c = 0; c < BOARD_SIZE; c++) {
        for (let r = 0; r <= BOARD_SIZE - 4; r++) {
            if (b[r][c] && b[r+1][c] && b[r+2][c] && b[r+3][c]) {
                endRound(true);
                return;
            }
        }
    }
}

function endRound(won) {
    gameState.roundEnded = true;
    gameState.canToss = false;

    const overlay = document.getElementById('overlay');
    const statusMsg = document.getElementById('status-message');
    const subMsg = document.getElementById('sub-message');
    const nextBtn = document.getElementById('next-btn');

    overlay.classList.remove('hidden');

    if (won) {
        gameState.consecutiveWins++;
        if (gameState.consecutiveWins >= 2) {
            statusMsg.innerText = "CHAMPION!";
            subMsg.innerText = "You connected 4 in a row for two rounds straight!";
            nextBtn.innerText = "Play Again";
            gameState.consecutiveWins = 0;
            gameState.round = 1;
        } else {
            statusMsg.innerText = "Round Won!";
            subMsg.innerText = "Connect 4 for one more round to win the game!";
            nextBtn.innerText = "Next Round";
            gameState.round++;
        }
    } else {
        statusMsg.innerText = "Round Over";
        subMsg.innerText = "You ran out of discs without connecting 4.";
        nextBtn.innerText = "Try Again";
        gameState.consecutiveWins = 0;
        gameState.round = 1;
    }
    
    updateHUD();
}

document.getElementById('next-btn').addEventListener('click', () => {
    resetBoard();
    document.getElementById('overlay').classList.add('hidden');
});

function resetBoard() {
    gameState.discsRemaining = DISCS_PER_ROUND;
    gameState.board = Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(null));
    gameState.roundEnded = false;
    gameState.canToss = true;
    
    // Clear landed discs from scene
    const objectsToRemove = [];
    scene.traverse((child) => {
        if (child instanceof THREE.Mesh && child.geometry instanceof THREE.CylinderGeometry && child.parent !== boardGroup) {
            objectsToRemove.push(child);
        }
    });
    objectsToRemove.forEach(obj => scene.remove(obj));

    updateHUD();
}

function updateHUD() {
    document.getElementById('disc-count').innerText = gameState.discsRemaining;
    document.getElementById('round-num').innerText = gameState.round;
    document.getElementById('consecutive-wins').innerText = gameState.consecutiveWins;
}

// --- ANIMATION LOOP ---
const clock = new THREE.Clock();
function animate() {
    requestAnimationFrame(animate);
    const dt = clock.getDelta();

    if (gameState.activeDisc) {
        gameState.activeDisc.update(dt);
    }

    renderer.render(scene, camera);
}

init();
