/* ============================================
   TerraHold — Main Application (ES Module)
   Orchestrates webcam, Three.js scene, Earth
   model loading, and hand tracking.
   ============================================ */

import * as THREE from 'three';
import Earth from './earth.js';
import HandTracker from './hands.js';

// ---- DOM ----
const loadingScreen = document.getElementById('loading-screen');
const progressBar = document.getElementById('progress-bar');
const loadingStatus = document.getElementById('loading-status');
const cameraError = document.getElementById('camera-error');
const instructions = document.getElementById('instructions');
const hud = document.getElementById('hud');
const fpsCounter = document.getElementById('fps-counter');
const canvas = document.getElementById('render-canvas');
const video = document.getElementById('webcam');
const dismissBtn = document.getElementById('dismiss-instructions');
const toggleInstructionsBtn = document.getElementById('toggle-instructions');

// ---- Three.js ----
let scene, camera, renderer;
let videoTexture, videoMesh;

// ---- Modules ----
const earth = new Earth();
const handTracker = new HandTracker();

// ---- State ----
let currentEarthScale = 1.0;
let lastFrameTime = performance.now();
let frameCount = 0;
let fps = 0;

// ============================================
// Progress & Status
// ============================================
function setProgress(pct) {
    if (progressBar) progressBar.style.width = Math.min(100, pct) + '%';
}

function setStatus(msg) {
    if (loadingStatus) loadingStatus.textContent = msg;
}

// ============================================
// Three.js Setup
// ============================================
function initThreeJS() {
    scene = new THREE.Scene();

    const w = window.innerWidth;
    const h = window.innerHeight;

    camera = new THREE.OrthographicCamera(
        -w / 2, w / 2,
        h / 2, -h / 2,
        0.1, 5000
    );
    camera.position.z = 1000;

    renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        alpha: true,
        antialias: true,
    });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Lighting for the GLTF model
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(5, 3, 7);
    scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0x4fc3f7, 0.4);
    fillLight.position.set(-5, -2, 3);
    scene.add(fillLight);

    window.addEventListener('resize', onResize);
}

function onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;

    camera.left = -w / 2;
    camera.right = w / 2;
    camera.top = h / 2;
    camera.bottom = -h / 2;
    camera.updateProjectionMatrix();

    renderer.setSize(w, h);

    if (videoMesh) updateVideoMeshSize();
}

// ============================================
// Webcam Video Background
// ============================================
function setupVideoBackground() {
    videoTexture = new THREE.VideoTexture(video);
    videoTexture.minFilter = THREE.LinearFilter;
    videoTexture.magFilter = THREE.LinearFilter;
    videoTexture.colorSpace = THREE.SRGBColorSpace;

    const videoMaterial = new THREE.MeshBasicMaterial({
        map: videoTexture,
        depthWrite: false,
        depthTest: false,
    });

    const planeGeometry = new THREE.PlaneGeometry(1, 1);
    videoMesh = new THREE.Mesh(planeGeometry, videoMaterial);
    videoMesh.renderOrder = -1;
    videoMesh.position.z = -500;

    // Mirror horizontally for selfie view
    videoMesh.scale.x = -1;

    scene.add(videoMesh);
    updateVideoMeshSize();
}

function updateVideoMeshSize() {
    if (!videoMesh || !video.videoWidth) return;

    const screenW = window.innerWidth;
    const screenH = window.innerHeight;
    const videoAspect = video.videoWidth / video.videoHeight;
    const screenAspect = screenW / screenH;

    let planeW, planeH;
    if (screenAspect > videoAspect) {
        planeW = screenW;
        planeH = screenW / videoAspect;
    } else {
        planeH = screenH;
        planeW = screenH * videoAspect;
    }

    videoMesh.scale.set(-planeW, planeH, 1);
}

// ============================================
// Camera Access
// ============================================
async function requestCamera() {
    setStatus('Requesting camera access...');
    setProgress(15);

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: 'user',
            },
            audio: false,
        });
        video.srcObject = stream;
        await video.play();
        setProgress(30);
        setStatus('Camera ready ✓');
        return true;
    } catch (err) {
        console.error('Camera access denied:', err);
        return false;
    }
}

// ============================================
// Hand Event Handlers
// ============================================
function handleLeftHand(data) {
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;

    // FIXED: Negate X to match mirrored video feed
    // MediaPipe x=0 is left of original camera image = RIGHT side of mirrored display
    // So we negate: (0.5 - x) maps correctly to screen coordinates
    const x = (0.5 - data.palmCenter.x) * screenW;
    const y = -(data.palmCenter.y - 0.5) * screenH;

    // Earth floats directly on the palm (slight Y offset above palm)
    earth.setPosition(x, y + 40, 0);
}

function handleRightHand(data) {
    // ---- PINCH-TO-ZOOM (like phone two-finger zoom) ----
    // Spread fingers apart = BIGGER Earth
    // Bring fingers together = SMALLER Earth
    // Use pinch delta (change in distance) for smooth scaling
    const scaleDelta = data.pinchDelta * 25;
    currentEarthScale = Math.max(0.15, Math.min(5.0, currentEarthScale + scaleDelta));
    earth.setScale(currentEarthScale);

    // ---- ROTATION from palm movement ----
    // Only rotate if the movement is significant enough (avoid jitter)
    const moveThreshold = 0.002;
    if (Math.abs(data.rotationDelta.x) > moveThreshold ||
        Math.abs(data.rotationDelta.y) > moveThreshold) {
        // FIXED: Negate X rotation delta too for mirrored view
        const rotX = data.rotationDelta.y * 15;
        const rotY = -data.rotationDelta.x * 15;
        earth.addRotation(rotX, rotY);
    }
}

function handleHandsLost() {
    // Earth stays in place — natural floating effect
}

// ============================================
// Loading Complete
// ============================================
function onFullyLoaded() {
    setProgress(100);
    setStatus('Ready!');

    setTimeout(() => {
        loadingScreen.classList.add('fade-out');
        setTimeout(() => {
            loadingScreen.classList.add('hidden');
            hud.classList.remove('hidden');
            instructions.classList.remove('hidden');
        }, 800);
    }, 400);
}

// ============================================
// UI Events
// ============================================
function setupUI() {
    dismissBtn.addEventListener('click', () => {
        instructions.classList.add('hidden');
    });

    toggleInstructionsBtn.addEventListener('click', () => {
        instructions.classList.toggle('hidden');
    });
}

// ============================================
// FPS Counter
// ============================================
function updateFPS() {
    frameCount++;
    const now = performance.now();
    if (now - lastFrameTime >= 1000) {
        fps = frameCount;
        frameCount = 0;
        lastFrameTime = now;
        if (fpsCounter) fpsCounter.textContent = fps + ' FPS';
    }
}

// ============================================
// Main Render Loop
// ============================================
function animate() {
    requestAnimationFrame(animate);

    // Update video texture
    if (videoTexture && video.readyState >= video.HAVE_CURRENT_DATA) {
        videoTexture.needsUpdate = true;
    }

    // Update video mesh size
    if (videoMesh && video.videoWidth && videoMesh.userData.lastW !== video.videoWidth) {
        updateVideoMeshSize();
        videoMesh.userData.lastW = video.videoWidth;
    }

    // Update Earth (smooth lerp + rotation)
    earth.update(1 / 60);

    // Render
    renderer.render(scene, camera);

    // FPS
    updateFPS();
}

// ============================================
// Boot Sequence
// ============================================
async function boot() {
    console.log('🌍 TerraHold booting...');
    setProgress(5);
    setStatus('Initializing 3D engine...');

    // 1. Init Three.js
    initThreeJS();
    setProgress(10);

    // 2. Request camera
    const cameraGranted = await requestCamera();
    if (!cameraGranted) {
        loadingScreen.classList.add('hidden');
        cameraError.classList.remove('hidden');
        return;
    }

    // 3. Setup video background
    setupVideoBackground();
    setProgress(35);

    // 4. Load Earth GLTF model
    setStatus('Loading 3D Earth model...');
    try {
        await earth.load(scene, (pct) => {
            setProgress(35 + pct * 0.4);
            setStatus(`Loading Earth model... ${pct}%`);
        });
    } catch (err) {
        console.error('Failed to load Earth model:', err);
        setStatus('⚠️ Earth model failed — check console');
    }

    setProgress(80);
    setStatus('Starting hand tracking...');

    // 5. Init hand tracking
    handTracker.setCallbacks({
        onLeftHand: handleLeftHand,
        onRightHand: handleRightHand,
        onHandsLost: handleHandsLost,
    });

    handTracker.init(video);

    // 6. Setup UI
    setupUI();

    // 7. Wait for hand tracker
    setProgress(90);
    setStatus('Finalizing...');

    let waited = 0;
    const checkInterval = setInterval(() => {
        waited += 200;
        if (handTracker.isReady || waited > 5000) {
            clearInterval(checkInterval);
            onFullyLoaded();
        }
    }, 200);

    // 8. Start render loop
    animate();
}

// Start!
boot();
