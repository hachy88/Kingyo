/**
 * @file Goldfish Particle Simulation - Optimized Version
 * @author Optimized by a Professional JavaScript Engineer
 * @description An interactive particle simulation of a goldfish, optimized for performance, readability, and maintainability.
 */

// =================================================================
// I. CONFIGURATION & GLOBAL CONSTANTS
// =================================================================

const COLOR_PALETTE = [
  "#41e2e0", "#41e2af", "#41e271", "#c2e241", "#e29a41",
  "#e24141", "#7e2626", "#ffffff", "#c038d7", "#39a0d7"
];

const CONFIG = {
  FRAME_RATE: 120,
  DECAY_TIMEOUT: 15000,
  FISH_SCALE: 0.7,
  PARTICLE_COUNT_ON_CLICK: 28,
  SOUND_INTERVAL: 0.15, // 衝突音が再生される最小間隔（秒）

  PARTICLE: {
    GRID_CELL_SIZE: 14,
    COLLISION_RADIUS: 6,
    COLLISION_RADIUS_SQ: 36, // COLLISION_RADIUSの2乗 (平方根の計算を避けるため)
    DAMPING: 0.89,
    REPULSION_FACTOR: 0.04,
  },
  RIPPLE: {
    SPEED: 5,
    MAX_RADIUS: 1000,
    STROKE_WEIGHT: 1.5,
    COLOR: [255, 255, 255, 150],
  },
  PATTERN: {
    DEFAULT_TYPE: "tri",
    DEFAULT_ALPHA: 150,
    FADE_OUT_SPEED: 1.0,
    MASK_STROKE_WEIGHT: 4,
    MASK_PARTICLE_SIZE_FACTOR: 1.6,
  },
  GOLDFISH: {
    WALL_MARGIN: 100,
    PART_BOUNDS: {
      TAIL_START: 0.6,
      DORSAL_PIVOT: 0.4,
      VENTRAL_PIVOT: 0.6,
      BODY_START: 0.35,
      BODY_END: 0.6,
      HEAD_END: 0.15,
    }
  },
  IMAGE_SAMPLING_STEP: 20,
  CONNECTION_CELL_SIZE: 30,
  CONNECTION_EDGE_THRESH_SQ: 900,
  AUDIO_RESET_INTERVAL: 15000,
};

// OPTIMIZED: グリッド探索用のオフセットを定数として定義
const NEIGHBOR_OFFSETS = [
  [0, 0], [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]
];

const WATERDROP_SOUND_FILES = [
  "./assets/waterdrop01.mp3", "./assets/waterdrop02.mp3", "./assets/waterdrop03.mp3", "./assets/waterdrop04.mp3",
  "./assets/waterdroprev1.mp3", "./assets/waterdroprev2.mp3", "./assets/waterdroprev3.mp3", "./assets/waterdroprev4.mp3"
];

// =================================================================
// II. GLOBAL VARIABLES
// =================================================================

let masterGoldfish;
let goldfishModelL = { vertices: [], connections: [], bounds: {} };
let goldfishModelR = { vertices: [], connections: [], bounds: {} };
let currentGoldfishModel;
let currentFishDirection;

let kingyoImageL, kingyoImageR;
const collisionSounds = [];
const waterdropSounds = [];

let soundQueueMaxIntensity = 0;
let soundQueueMaxFreq = 440;
let lastSoundTime = 0;
let lastInteractionTime = 0;
let lastAudioResetTime = 0;

// グラフィックス関連
let patternG, maskG, maskedPatternG;
let patternType = CONFIG.PATTERN.DEFAULT_TYPE;
let patternAlpha = CONFIG.PATTERN.DEFAULT_ALPHA;
let cachedPatternImg = null;
let cachedMaskImg = null;
let lastPatternType = null;
let lastFishShapeHash = null;

const ripples = [];

// =================================================================
// III. p5.js LIFECYCLE FUNCTIONS
// =================================================================

function preload() {
  kingyoImageL = loadImage("./assets/kingyoL.jpg");
  kingyoImageR = loadImage("./assets/kingyoR.jpg");
  soundFormats("mp3", "ogg");

  collisionSounds.push(loadSound("./assets/gharp.mp3"));
  collisionSounds.push(loadSound("./assets/harp.mp3"));

  for (const filename of WATERDROP_SOUND_FILES) {
    waterdropSounds.push(loadSound(filename));
  }
}

function setup() {
  createCanvas(windowWidth, windowHeight);
  rectMode(CENTER);
  ellipseMode(CENTER);
  frameRate(CONFIG.FRAME_RATE);

  analyzeImageForBody(kingyoImageL, goldfishModelL, -1);
  analyzeImageForBody(kingyoImageR, goldfishModelR, 1);

  // 両モデルの頂点数を少ない方に合わせる
  const minVertices = Math.min(goldfishModelL.vertices.length, goldfishModelR.vertices.length);
  goldfishModelL.vertices.length = minVertices;
  goldfishModelR.vertices.length = minVertices;

  precalculateConnections(goldfishModelL);
  precalculateConnections(goldfishModelR);

  currentFishDirection = (random() > 0.5) ? 'right' : 'left';
  currentGoldfishModel = (currentFishDirection === 'left') ? goldfishModelL : goldfishModelR;

  masterGoldfish = new MasterGoldfish();
  userStartAudio();
  lastInteractionTime = millis();
  lastAudioResetTime = millis();

  initializeGraphicsBuffers();
  handlePageLoadTrigger();
  setupWebSocket();
}

function draw() {
  clear();
  masterGoldfish.run();

  // OPTIMIZED: forループを逆順にすることで、安全に要素を削除
  for (let i = ripples.length - 1; i >= 0; i--) {
    const ripple = ripples[i];
    ripple.update();
    ripple.draw();
    if (!ripple.isAlive) {
      ripples.splice(i, 1);
    }
  }

  if (masterGoldfish.isDecaying) {
    patternAlpha = Math.max(0, patternAlpha - CONFIG.PATTERN.FADE_OUT_SPEED);
  }

  if (patternAlpha > 0) {
    renderPatternMasked();
  }

  playMelody();
  checkDecay();
  checkAndResetAudio();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  initializeGraphicsBuffers();
}

// =================================================================
// IV. EVENT HANDLERS & TRIGGERS
// =================================================================

/**
 * ユーザーインタラクション（クリック、WebSocket経由のタップ）を処理する
 * @param {number} x - インタラクションのx座標
 * @param {number} y - インタラクションのy座標
 */
function triggerKingyoInteraction(x, y) {
  lastInteractionTime = millis();

  if (masterGoldfish.isDecaying) {
    masterGoldfish = new MasterGoldfish(); // 新しい金魚を生成
    patternAlpha = CONFIG.PATTERN.DEFAULT_ALPHA;
  }

  masterGoldfish.addParticles(x, y, CONFIG.PARTICLE_COUNT_ON_CLICK);
  ripples.push(new Ripple(x, y));

  if (waterdropSounds.length > 0) {
    const soundToPlay = random(waterdropSounds);
    if (soundToPlay?.isLoaded()) {
      soundToPlay.play();
    }
  }
}

function mousePressed() {
  triggerKingyoInteraction(mouseX, mouseY);
}

function handlePageLoadTrigger() {
  const urlParams = new URLSearchParams(window.location.search);
  const triggerX = urlParams.get('x');
  const triggerY = urlParams.get('y');

  if (triggerX !== null && triggerY !== null) {
    const x = parseFloat(triggerX);
    const y = parseFloat(triggerY);
    if (!isNaN(x) && !isNaN(y)) {
      setTimeout(() => triggerKingyoInteraction(x, y), 100);
    }
  }
}

// =================================================================
// V. HELPER & UTILITY FUNCTIONS
// =================================================================

/**
 * AudioContextが停止するのを防ぐために定期的にリセットする
 */
function checkAndResetAudio() {
  if (millis() - lastAudioResetTime > CONFIG.AUDIO_RESET_INTERVAL) {
    console.log("Resetting audio context to prevent errors...");
    userStartAudio();
    lastAudioResetTime = millis();
  }
}

/**
 * 描画用のグラフィックバッファを初期化・再初期化する
 */
function initializeGraphicsBuffers() {
  patternG = createGraphics(width, height);
  maskG = createGraphics(width, height);
  maskedPatternG = createGraphics(width, height);
  cachedPatternImg = null;
  cachedMaskImg = null;
  lastFishShapeHash = null;
  lastPatternType = null;
}

/**
 * 画像を解析して金魚の体の頂点データを生成する
 * @param {p5.Image} image - 解析対象の画像
 * @param {object} model - 頂点データを格納するモデルオブジェクト
 * @param {number} [flipFactor=1] - 左右反転のための係数 (-1 or 1)
 */
function analyzeImageForBody(image, model, flipFactor = 1) {
  model.vertices = [];
  image.loadPixels();
  const { width: imgWidth, height: imgHeight, pixels } = image;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

  const step = CONFIG.IMAGE_SAMPLING_STEP;
  for (let y = 0; y < imgHeight; y += step) {
    for (let x = 0; x < imgWidth; x += step) {
      const index = (y * imgWidth + x) * 4;
      // OPTIMIZED: 輝度計算を簡略化
      const brightness = (pixels[index] + pixels[index + 1] + pixels[index + 2]) * 0.333;

      if (brightness > 25) {
        const modelX = (x - imgWidth / 2) * flipFactor;
        const modelY = y - imgHeight / 2;
        model.vertices.push({ pos: createVector(modelX, modelY) });
        minX = Math.min(minX, modelX);
        maxX = Math.max(maxX, modelX);
        minY = Math.min(minY, modelY);
        maxY = Math.max(maxY, modelY);
      }
    }
  }

  const boundsWidth = Math.max(maxX - minX, 1);
  const boundsHeight = Math.max(maxY - minY, 1);
  model.bounds = { minX, maxX, minY, maxY, width: boundsWidth, height: boundsHeight };

  const { PART_BOUNDS } = CONFIG.GOLDFISH;
  const tailPivotX = lerp(minX, maxX, PART_BOUNDS.TAIL_START);
  const dorsalPivotY = lerp(minY, maxY, PART_BOUNDS.DORSAL_PIVOT);
  const ventralPivotY = lerp(minY, maxY, PART_BOUNDS.VENTRAL_PIVOT);
  const bodyStartX = lerp(minX, maxX, PART_BOUNDS.BODY_START);
  const bodyEndX = lerp(minX, maxX, PART_BOUNDS.BODY_END);
  const headEndX = lerp(minX, maxX, PART_BOUNDS.HEAD_END);

  for (const v of model.vertices) {
    v.longitudinalT = constrain(1 - (v.pos.x - minX) / boundsWidth, 0, 1);
    const { x, y } = v.pos;

    if (x > tailPivotX) v.part = "tail";
    else if (y < dorsalPivotY && x > bodyStartX && x < bodyEndX) v.part = "dorsal";
    else if (y > ventralPivotY && x > bodyStartX && x < bodyEndX) v.part = "ventral";
    else if (x < headEndX) v.part = "head";
    else v.part = "body";
  }
}

/**
 * 頂点間の接続を事前計算してパフォーマンスを向上させる
 * @param {object} model - 接続を計算するモデルオブジェクト
 */
function precalculateConnections(model) {
  const { vertices } = model;
  model.connections = [];
  const grid = new Map();
  // OPTIMIZED: ビットシフトによる高速なキー生成
  const getCellKey = (x, y) => (x << 16) | (y & 0xFFFF);
  const cellSize = CONFIG.CONNECTION_CELL_SIZE;

  for (let i = 0; i < vertices.length; i++) {
    const { pos } = vertices[i];
    const gridX = Math.floor(pos.x / cellSize);
    const gridY = Math.floor(pos.y / cellSize);
    const key = getCellKey(gridX, gridY);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(i);
  }

  const thresholdSq = CONFIG.CONNECTION_EDGE_THRESH_SQ;
  for (let i = 0; i < vertices.length; i++) {
    const pos1 = vertices[i].pos;
    const gridX = Math.floor(pos1.x / cellSize);
    const gridY = Math.floor(pos1.y / cellSize);

    for (const offset of NEIGHBOR_OFFSETS) {
      const key = getCellKey(gridX + offset[0], gridY + offset[1]);
      const neighbors = grid.get(key);
      if (neighbors) {
        for (const j of neighbors) {
          if (j <= i) continue; // 重複接続を避ける
          const pos2 = vertices[j].pos;
          // OPTIMIZED: `p5.Vector.dist`の代わりに手動で距離の2乗を計算
          const dx = pos1.x - pos2.x;
          const dy = pos1.y - pos2.y;
          const distSq = dx * dx + dy * dy;

          if (distSq < thresholdSq) {
            model.connections.push([i, j]);
          }
        }
      }
    }
  }
}

/**
 * 金魚の形状でマスクされたパターンを描画する
 */
function renderPatternMasked() {
  if (patternAlpha <= 0) return;

  const isDynamicPattern = patternType === 'waves';
  const needsPatternUpdate = !cachedPatternImg || patternType !== lastPatternType || isDynamicPattern;
  if (needsPatternUpdate) {
    patternG.clear();
    drawGeometricPattern(patternG, patternType);
    if (!isDynamicPattern) {
      cachedPatternImg = patternG.get();
      lastPatternType = patternType;
    }
  }

  const currentShapeHash = masterGoldfish.getShapeHash();
  const needsMaskUpdate = !cachedMaskImg || currentShapeHash !== lastFishShapeHash;
  if (needsMaskUpdate) {
    maskG.clear();
    masterGoldfish.drawMask(maskG);
    cachedMaskImg = maskG.get();
    lastFishShapeHash = currentShapeHash;
  }

  const patternSource = isDynamicPattern ? patternG : cachedPatternImg;
  if (patternSource && cachedMaskImg) {
    maskedPatternG.clear();
    maskedPatternG.image(patternSource, 0, 0);
    maskedPatternG.drawingContext.globalCompositeOperation = "destination-in";
    maskedPatternG.image(cachedMaskImg, 0, 0);
    maskedPatternG.drawingContext.globalCompositeOperation = "source-over";

    push();
    tint(255, patternAlpha);
    image(maskedPatternG, 0, 0);
    pop();
  }
}

/**
 * 指定されたタイプの幾何学模様を描画する
 * @param {p5.Graphics} pg - 描画対象のグラフィックバッファ
 * @param {string} type - パターンの種類 ("tri", "stripes", "dots", "waves")
 */
function drawGeometricPattern(pg, type = "tri") {
  pg.push();
  pg.background(0, 0); // alpha=0
  switch (type) {
    case "stripes":
      pg.stroke(255);
      pg.strokeWeight(0.5);
      for (let x = -height; x < width + height; x += 40) {
        pg.line(x, 0, x - height, height);
      }
      break;
    case "dots":
      pg.noStroke();
      pg.fill(255);
      const dotSizes = [2, 3];
      for (let y = 0; y < height; y += 20) {
        const yOffset = (y / 20) % 2;
        for (let x = 0; x < width; x += 20) {
          const sizeIndex = ((x / 20) + yOffset) % 2;
          pg.circle(x, y, dotSizes[sizeIndex]);
        }
      }
      break;
    case "waves":
      pg.noFill();
      pg.stroke(10, 10, 40);
      pg.strokeWeight(1);
      const timeFactor = 0.02 * frameCount;
      for (let y = 0; y < height; y += 10) {
        pg.beginShape();
        for (let x = 0; x < width; x += 8) {
          const waveY = y + 10 * Math.sin(0.03 * x + timeFactor) + 6 * Math.cos(0.02 * y - timeFactor);
          pg.vertex(x, waveY);
        }
        pg.endShape();
      }
      break;
    case "tri":
    default:
      pg.noFill();
      pg.stroke(255);
      pg.strokeWeight(0.8);
      const triHeight = 24 * Math.sqrt(3) / 2;
      for (let row = 0; row < Math.ceil(height / triHeight) + 2; row++) {
        const yPos = row * triHeight;
        const xOffset = (row % 2) * 12;
        for (let col = 0; col < Math.ceil(width / 24) + 2; col++) {
          const xPos = 24 * col + xOffset;
          pg.triangle(xPos, yPos - triHeight / 2, xPos - 12, yPos + triHeight / 2, xPos + 12, yPos + triHeight / 2);
          pg.triangle(xPos, yPos + triHeight / 2, xPos - 12, yPos - triHeight / 2, xPos + 12, yPos - triHeight / 2);
        }
      }
      break;
  }
  pg.pop();
}

/**
 * 衝突強度と周波数に応じてメロディを再生する
 */
function playMelody() {
  const currentTime = millis() / 1000;
  if (soundQueueMaxIntensity >= 0.15 && currentTime - lastSoundTime >= CONFIG.SOUND_INTERVAL) {
    playSoundDynamic(soundQueueMaxFreq, soundQueueMaxIntensity);
    lastSoundTime = currentTime;
  }
  soundQueueMaxIntensity = 0; // キューをリセット
}

/**
 * 動的な周波数と音量でサウンドを再生する
 * @param {number} freq - 周波数
 * @param {number} intensity - 音量
 */
function playSoundDynamic(freq, intensity) {
  const soundToPlay = masterGoldfish.collisionSound;
  if (soundToPlay?.isLoaded()) {
    const rate = map(freq, 300, 1000, 0.5, 2, true);
    soundToPlay.rate(rate);
    soundToPlay.setVolume(intensity);
    soundToPlay.play();
  }
}

/**
 * 一定時間インタラクションがない場合に金魚を消滅させる
 */
function checkDecay() {
  if (!masterGoldfish.isDecaying && millis() - lastInteractionTime > CONFIG.DECAY_TIMEOUT) {
    masterGoldfish.startDecay();
  }
}

/**
 * 指定された点を中心にベクトルを回転させる（結果をoutベクトルに格納）
 * @param {p5.Vector} out - 結果を格納するベクトル
 * @param {number} x - 回転させる点のx座標
 * @param {number} y - 回転させる点のy座標
 * @param {number} cx - 回転中心のx座標
 * @param {number} cy - 回転中心のy座標
 * @param {number} angle - 回転角度 (ラジアン)
 */
function rotateAroundPoint(out, x, y, cx, cy, angle) {
  const dx = x - cx;
  const dy = y - cy;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  out.set(dx * cosA - dy * sinA + cx, dx * sinA + dy * cosA + cy);
}

function setupWebSocket() {
  const socket = new WebSocket('ws://localhost:8080');
  socket.onopen = () => {
    console.log('Connected to WebSocket server from kingyo.html');
  };
  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'tap' && typeof data.x === 'number' && typeof data.y === 'number') {
        // OPTIMIZED: デバッグログを削除し、インタラクションのみに集中
        let targetX = data.x;
            let targetY = data.y;
            
            if (data.isNormalized) {
              targetX = data.x * windowWidth;
              targetY = data.y * windowHeight;
            }
            
            setTimeout(() => triggerKingyoInteraction(targetX, targetY), 50);
      }
    } catch (e) {
      console.error("Error parsing message:", e);
    }
  };
  socket.onclose = () => {
    console.log('Connection closed. Retrying in 3 seconds...');
    setTimeout(setupWebSocket, 3000);
  };
  socket.onerror = (error) => {
    // OPTIMIZED: エラーハンドリングを追加
    console.error("WebSocket Error:", error);
  };
}


// =================================================================
// VI. CLASSES
// =================================================================

class MasterGoldfish {
  constructor() {
    this.particles = {};
    this.particleOrder = [];
    this.modelIndex = 0;
    this.fishScale = CONFIG.FISH_SCALE;
    this.anchor = createVector(width / 2, height / 2);
    this.creationTime = millis();
    this.time = 0;
    this.isDecaying = false;

    this.collisionSound = random(collisionSounds);

    const horizontalDirection = (currentFishDirection === 'left') ? -1 : 1;
    const angle = random(-PI / 4, PI / 4);
    this.vel = createVector(horizontalDirection, 0).rotate(angle);
    this.baseSpeed = 0.5;
    this.vel.mult(this.baseSpeed);

    let paletteCopy = [...COLOR_PALETTE];
    let c1 = random(paletteCopy);
    paletteCopy.splice(paletteCopy.indexOf(c1), 1);
    let c2 = random(paletteCopy);
    this.headColor = color(c1);
    this.tailColor = color(c2);

    this.isTurning = false;
    this.turnStartTime = 0;
    this.turnDuration = 2000;
    this.sourceModel = null;
    this.targetModel = null;

    this.isBouncing = false;
    this.bounceStartTime = 0;
    this.bounceDuration = 500;

    this.grid = new Map();

    // OPTIMIZED: 計算用の一時ベクトルを事前に確保し、再利用する
    this.initialVelOnBounce = createVector();
    this.targetVelOnBounce = createVector();
    this._tmpDeformed = createVector();
    this._tmpRotated = createVector();
    this._tmpOffset = createVector();
    this._tmpTarget = createVector();
    this._tmpStartTarget = createVector();
    this._tmpEndTarget = createVector();
  }

  isComplete() { return this.modelIndex >= currentGoldfishModel.vertices.length; }
  startDecay() { this.isDecaying = true; soundQueueMaxIntensity = 0; }

  /**
   * 金魚の現在の形状からハッシュ値を生成し、描画キャッシュの更新判定に利用する
   * @returns {number} 形状のハッシュ値
   */
  getShapeHash() {
    const ax = Math.floor(0.1 * this.anchor.x);
    const ay = Math.floor(0.1 * this.anchor.y);
    const heading = Math.floor(100 * this.vel.heading());
    const time = Math.floor(10 * this.time);
    // OPTIMIZED: ビット演算で高速にハッシュを生成
    return ((ax & 0xFFFF) << 16) | ((ay & 0xFFFF) ^ (heading << 1) ^ time);
  }

  /**
   * 指定された位置に新しいパーティクルを追加する
   * @param {number} x
   * @param {number} y
   * @param {number} count
   */
  addParticles(x, y, count) {
    if (this.isComplete()) return;
    for (let i = 0; i < count && !this.isComplete(); i++) {
      // OPTIMIZED: パーティクル生成時に色情報を渡す
      const newParticle = new Particle(
        createVector(x, y),
        this.modelIndex,
        this.headColor,
        this.tailColor
      );
      this.particles[this.modelIndex] = newParticle;
      this.particleOrder.push(newParticle);
      this.modelIndex++;
    }
  }

  run() {
    if (!this.isDecaying) {
      this.move();
    }
    this.updateParticles();
    this.detectCollisions();
    this.display();
  }

  move() {
    this.time += 0.02;

    if (this.isBouncing) {
      const elapsed = millis() - this.bounceStartTime;
      const progress = Math.min(elapsed / this.bounceDuration, 1);
      const easedProgress = progress * progress * (3 - 2 * progress);
      p5.Vector.lerp(this.initialVelOnBounce, this.targetVelOnBounce, easedProgress, this.vel);
      if (progress >= 1.0) {
        this.isBouncing = false;
      }
    } else {
      const age = millis() - this.creationTime;
      const timeInCycle = age % 3000;
      let speedMultiplier;
      if (timeInCycle <= 1000) speedMultiplier = random(1, 2);
      else if (timeInCycle <= 1200) speedMultiplier = 0.5;
      else speedMultiplier = random(2, 3);
      this.vel.setMag(this.baseSpeed * speedMultiplier);
    }

    const nextAnchor = p5.Vector.add(this.anchor, this.vel);
    const isMovingLeft = this.vel.x < 0;
    const wallMargin = CONFIG.GOLDFISH.WALL_MARGIN;
    const wallX = isMovingLeft ? wallMargin : width - wallMargin;

    if (!this.isTurning && ((isMovingLeft && nextAnchor.x < wallX) || (!isMovingLeft && nextAnchor.x > wallX))) {
      this.isTurning = true;
      this.turnStartTime = millis();
      const newDirection = isMovingLeft ? 'right' : 'left';
      this.sourceModel = currentGoldfishModel;
      currentFishDirection = newDirection;
      currentGoldfishModel = (currentFishDirection === 'left') ? goldfishModelL : goldfishModelR;
      this.targetModel = currentGoldfishModel;
      this.vel.x *= -1;
      this.anchor.x = wallX;
    }

    this.anchor.add(this.vel);

    if (!this.isTurning && !this.isBouncing) {
      if ((this.anchor.y < wallMargin && this.vel.y < 0) || (this.anchor.y > height - wallMargin && this.vel.y > 0)) {
        this.isBouncing = true;
        this.bounceStartTime = millis();
        this.initialVelOnBounce.set(this.vel);
        this.targetVelOnBounce.set(this.vel.x, -this.vel.y);
      }
    }
    this.vel.limit(1);
  }

  /**
   * モデルの頂点位置を体の動きに合わせて変形させる
   * @param {p5.Vector} modelPos - 元の頂点位置
   * @param {string} part - 体の部位 ("tail", "dorsal", etc.)
   * @param {p5.Vector} outPos - 結果を格納するベクトル
   * @param {object} model - 参照する金魚モデル
   */
  deformModelPosition(modelPos, part, outPos, model) {
    let { x, y } = modelPos;
    const { bounds } = model;
    const { minX, maxX, minY, maxY } = bounds;
    const { PART_BOUNDS } = CONFIG.GOLDFISH;

    switch (part) {
      case "tail": {
        const angle = Math.sin(2.1 * this.time + 0.02 * y) * 0.1047; // radians(6)
        const pivotX = lerp(minX, maxX, PART_BOUNDS.TAIL_START);
        const factor = constrain((x - pivotX) / Math.max(maxX - pivotX, 1), 0, 1);
        rotateAroundPoint(this._tmpRotated, x, y, pivotX, y, angle * factor);
        x = this._tmpRotated.x;
        y = this._tmpRotated.y;
        break;
      }
      case "dorsal": {
        const angle = Math.sin(1.6 * this.time + 0.03 * x + 0.7) * 0.0698; // radians(4)
        const pivotY = lerp(minY, maxY, PART_BOUNDS.DORSAL_PIVOT);
        const factor = constrain((pivotY - y) / Math.max(pivotY - minY, 1), 0, 1);
        rotateAroundPoint(this._tmpRotated, x, y, x, pivotY, angle * factor);
        x = this._tmpRotated.x;
        y = this._tmpRotated.y;
        break;
      }
      case "ventral": {
        const angle = Math.sin(1.8 * this.time + 0.025 * x + 1.4) * 0.0872; // radians(5)
        const pivotY = lerp(minY, maxY, PART_BOUNDS.VENTRAL_PIVOT);
        const factor = constrain((y - pivotY) / Math.max(maxY - pivotY, 1), 0, 1);
        rotateAroundPoint(this._tmpRotated, x, y, x, pivotY, angle * factor);
        x = this._tmpRotated.x;
        y = this._tmpRotated.y;
        break;
      }
    }
    outPos.set(x, y);
  }

  _calculateParticleTarget(particle, model, outTarget) {
    const rotation = this.vel.heading();
    const modelVertex = model.vertices[particle.modelId];
    if (!modelVertex) {
      outTarget.set(particle.pos);
      return;
    }

    this.deformModelPosition(modelVertex.pos, modelVertex.part, this._tmpDeformed, model);
    const sway = Math.sin(this.time - 0.03 * this._tmpDeformed.x) * this._tmpDeformed.y * 0.2;
    this._tmpOffset.set(0, sway).rotate(rotation);
    this._tmpRotated.set(this._tmpDeformed).mult(this.fishScale).rotate(rotation);
    outTarget.set(this.anchor).add(this._tmpRotated).add(this._tmpOffset);
  }

  updateParticles() {
    let turnProgress = 1.0;
    if (this.isTurning) {
      const elapsed = millis() - this.turnStartTime;
      turnProgress = Math.min(elapsed / this.turnDuration, 1.0);
      if (turnProgress >= 1.0) {
        this.isTurning = false;
        this.sourceModel = null;
        this.targetModel = null;
        lastFishShapeHash = null; // ターン完了後にマスクを再生成
      }
    }
    const easedProgress = turnProgress * turnProgress * (3 - 2 * turnProgress);

    for (const particle of this.particleOrder) {
      let followStrength = 0.02;

      if (!this.isDecaying) {
        if (this.isTurning) {
          this._calculateParticleTarget(particle, this.sourceModel, this._tmpStartTarget);
          this._calculateParticleTarget(particle, this.targetModel, this._tmpEndTarget);
          p5.Vector.lerp(this._tmpStartTarget, this._tmpEndTarget, easedProgress, this._tmpTarget);
        } else {
          this._calculateParticleTarget(particle, currentGoldfishModel, this._tmpTarget);
        }

        // Ripple interaction
        for (const ripple of ripples) {
          const dx = particle.pos.x - ripple.x;
          const dy = particle.pos.y - ripple.y;
          const distSq = dx * dx + dy * dy;
          const influenceRadius = ripple.radius + 25;

          if (distSq < influenceRadius * influenceRadius) {
            const dist = Math.sqrt(distSq);
            const delta = Math.abs(dist - ripple.radius);
            if (delta < 25) {
              const angle = Math.atan2(dy, dx);
              const strength = map(delta, 0, 25, 45, 0, true);
              this._tmpTarget.x += Math.cos(angle) * strength;
              this._tmpTarget.y += Math.sin(angle) * strength;
            }
          }
        }
        particle.setTarget(this._tmpTarget);

        if (this.isTurning || this.isBouncing) {
          followStrength *= 0.5;
        }
      }
      particle.update(this.isDecaying, followStrength);
    }

    if (this.isDecaying) {
      for (let i = this.particleOrder.length - 1; i >= 0; i--) {
        const p = this.particleOrder[i];
        if (p.alpha <= 0) {
          delete this.particles[p.modelId];
          this.particleOrder.splice(i, 1);
        }
      }
    }
  }

  detectCollisions() {
    if (this.isDecaying) return;
    this.grid.clear();

    const getCellKey = (x, y) => (x << 16) | (y & 0xFFFF);
    const cellSize = CONFIG.PARTICLE.GRID_CELL_SIZE;
    const radiusSq = CONFIG.PARTICLE.COLLISION_RADIUS_SQ;
    const repulsion = CONFIG.PARTICLE.REPULSION_FACTOR;

    for (let i = 0; i < this.particleOrder.length; i++) {
      const particle = this.particleOrder[i];
      const gridX = Math.floor(particle.pos.x / cellSize);
      const gridY = Math.floor(particle.pos.y / cellSize);
      const key = getCellKey(gridX, gridY);
      if (!this.grid.has(key)) this.grid.set(key, []);
      this.grid.get(key).push(i);
    }

    for (let i = 0; i < this.particleOrder.length; i++) {
      const p1 = this.particleOrder[i];
      const gridX = Math.floor(p1.pos.x / cellSize);
      const gridY = Math.floor(p1.pos.y / cellSize);

      for (const offset of NEIGHBOR_OFFSETS) {
        const key = getCellKey(gridX + offset[0], gridY + offset[1]);
        const neighbors = this.grid.get(key);
        if (neighbors) {
          for (const j of neighbors) {
            if (j <= i) continue;

            const p2 = this.particleOrder[j];
            const dx = p1.pos.x - p2.pos.x;
            const dy = p1.pos.y - p2.pos.y;
            const distSq = dx * dx + dy * dy;

            if (distSq < radiusSq && distSq > 1e-6) {
              const dist = Math.sqrt(distSq);
              const nx = dx / dist;
              const ny = dy / dist;
              const pushFactor = (CONFIG.PARTICLE.COLLISION_RADIUS - dist) * repulsion;

              p1.vel.x += nx * pushFactor;
              p1.vel.y += ny * pushFactor;
              p2.vel.x -= nx * pushFactor;
              p2.vel.y -= ny * pushFactor;

              const dvx = p1.vel.x - p2.vel.x;
              const dvy = p1.vel.y - p2.vel.y;
              const impactSpeed = Math.abs(dvx * nx + dvy * ny);
              // OPTIMIZED: constrain(val, 0, 1)は、valが正ならMath.min(val, 1)と同じ
              const impactIntensity = Math.min(0.5 * impactSpeed, 1);

              if (impactIntensity >= 0.15 && impactIntensity > soundQueueMaxIntensity) {
                const frequency = map(dist, 0, CONFIG.PARTICLE.COLLISION_RADIUS, 1000, 300, true);
                soundQueueMaxIntensity = impactIntensity;
                soundQueueMaxFreq = frequency;
              }
            }
          }
        }
      }
    }
  }

  display() {
    strokeWeight(1.2);
    colorMode(RGB, 255);

    if (!this.isTurning) {
      for (const conn of currentGoldfishModel.connections) {
        const p1 = this.particles[conn[0]];
        const p2 = this.particles[conn[1]];
        if (!p1 || !p2) continue;

        // OPTIMIZED: 色計算を削減
        const c1 = p1.baseColor;
        const c2 = p2.baseColor;
        const lineColor = lerpColor(c1, c2, 0.5);

        const avgAlpha = (p1.alpha + p2.alpha) * 0.5;
        lineColor.setAlpha(map(avgAlpha, 0, 90, 0, 255 * 0.15));
        stroke(lineColor);
        line(p1.pos.x, p1.pos.y, p2.pos.x, p2.pos.y);
      }
    }

    for (const p of this.particleOrder) {
      p.display();
    }
  }

  drawMask(graphics) {
    graphics.push();
    graphics.clear();
    graphics.noFill();
    graphics.stroke(255);
    graphics.strokeWeight(CONFIG.PATTERN.MASK_STROKE_WEIGHT);

    if (!this.isTurning) {
      for (const conn of currentGoldfishModel.connections) {
        const p1 = this.particles[conn[0]];
        const p2 = this.particles[conn[1]];
        if (p1 && p2) {
          graphics.line(p1.pos.x, p1.pos.y, p2.pos.x, p2.pos.y);
        }
      }
    }

    graphics.noStroke();
    graphics.fill(255);
    const sizeFactor = CONFIG.PATTERN.MASK_PARTICLE_SIZE_FACTOR;
    for (const p of this.particleOrder) {
      graphics.circle(p.pos.x, p.pos.y, sizeFactor * p.size);
    }
    graphics.pop();
  }
}

class Particle {
  /**
   * @param {p5.Vector} position - 初期位置
   * @param {number} modelId - 対応するモデルの頂点ID
   * @param {p5.Color} headColor - 金魚の頭の色
   * @param {p5.Color} tailColor - 金魚の尾の色
   */
  constructor(position, modelId, headColor, tailColor) {
    this.pos = position.copy();
    this.vel = createVector();
    this.acc = createVector();
    this.target = position.copy();
    this.modelId = modelId;
    this.maxSpeed = random(15, 100);
    this.size = 10;

    const modelVertex = currentGoldfishModel.vertices[this.modelId];
    this.longitudinalT = modelVertex.longitudinalT;

    // OPTIMIZATION: 色を事前に計算して保存
    this.baseColor = lerpColor(headColor, tailColor, this.longitudinalT);

    this.alpha = 90;
    this._tmpForce = createVector(); // 計算用ベクトルを再利用
  }

  setTarget(t) { this.target.set(t); }

  update(isDecaying, followStrength = 0.02) {
    if (isDecaying) {
      const angle = random(TWO_PI);
      const dispersionForce = 0.3;
      this.acc.x += dispersionForce * Math.cos(angle);
      this.acc.y += dispersionForce * Math.sin(angle);
      if (this.alpha > 0) this.alpha -= 0.3;
    } else {
      p5.Vector.sub(this.target, this.pos, this._tmpForce);
      this._tmpForce.mult(followStrength);
      this.acc.add(this._tmpForce);
      const angle = random(TWO_PI);
      this.acc.x += 0.4 * Math.cos(angle);
      this.acc.y += 0.4 * Math.sin(angle);
    }

    this.vel.add(this.acc);
    this.vel.limit(this.maxSpeed);
    this.vel.mult(CONFIG.PARTICLE.DAMPING);
    this.pos.add(this.vel);
    this.acc.mult(0);
  }

  /**
   * パーティクルを描画する
   */
  display() {
    noStroke();
    // OPTIMIZED: 事前計算した色を使用
    this.baseColor.setAlpha(map(this.alpha, 0, 90, 0, 255));
    fill(this.baseColor);
    ellipse(this.pos.x, this.pos.y, this.size, this.size);
  }
}

class Ripple {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.radius = 0;
    this.isAlive = true;
  }

  update() {
    this.radius += CONFIG.RIPPLE.SPEED;
    if (this.radius > CONFIG.RIPPLE.MAX_RADIUS) {
      this.isAlive = false;
    }
  }

  draw() {
    noFill();
    stroke(...CONFIG.RIPPLE.COLOR);
    strokeWeight(CONFIG.RIPPLE.STROKE_WEIGHT);
    ellipse(this.x, this.y, this.radius * 2);
  }
}