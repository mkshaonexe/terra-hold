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
let handsAreActive = false; // Track if any hand is currently controlling

const settings = {
    followHand: true,
    enableZoom: true,
    enableManualRotate: false,
    enableAutoRotate: true,
    showSkeleton: false
};

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

    camera = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 0.1, 5000);
    camera.position.z = 1000;

    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(5, 3, 7);
    scene.add(dirLight);
    const fillLight = new THREE.DirectionalLight(0x4fc3f7, 0.4);
    fillLight.position.set(-5, -2, 3);
    scene.add(fillLight);

    initSkeleton();

    window.addEventListener('resize', onResize);
}

function onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.left = -w / 2; camera.right = w / 2;
    camera.top = h / 2; camera.bottom = -h / 2;
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

    const mat = new THREE.MeshBasicMaterial({ map: videoTexture, depthWrite: false, depthTest: false });
    videoMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    videoMesh.renderOrder = -1;
    videoMesh.position.z = -500;
    videoMesh.scale.x = -1; // Mirror
    scene.add(videoMesh);
    updateVideoMeshSize();
}

function updateVideoMeshSize() {
    if (!videoMesh || !video.videoWidth) return;
    const sw = window.innerWidth, sh = window.innerHeight;
    const va = video.videoWidth / video.videoHeight;
    const sa = sw / sh;
    let pw, ph;
    if (sa > va) { pw = sw; ph = sw / va; }
    else { ph = sh; pw = sh * va; }
    videoMesh.scale.set(-pw, ph, 1);
}

// ============================================
// Camera Access
// ============================================
async function requestCamera() {
    setStatus('Requesting camera access...');
    setProgress(15);
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
            audio: false,
        });
        video.srcObject = stream;
        await video.play();
        await new Promise(r => {
            if (video.readyState >= 2) r();
            else video.addEventListener('loadeddata', r, { once: true });
        });
        console.log(`📷 Camera ready: ${video.videoWidth}x${video.videoHeight}`);
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

// LEFT HAND → Position ONLY
function handleLeftHand(data) {
    if (!handsAreActive) {
        handsAreActive = true;
        earth.setVisible(true); // Show Earth when left hand is detected
    }

    if (!settings.followHand) return;

    const sw = window.innerWidth;
    const sh = window.innerHeight;

    // Mirror X for selfie view
    const x = (0.5 - data.palmCenter.x) * sw;
    const y = -(data.palmCenter.y - 0.5) * sh;

    // Earth sits directly on the palm
    earth.setPosition(x, y + 40, 0);

    updateSkeleton(data.landmarks, 'left');
}

// RIGHT HAND → Scale + Rotation ONLY (never called with single hand)
function handleRightHand(data) {
    // ---- PINCH-TO-ZOOM (Proportional) ----
    if (settings.enableZoom) {
        // Use the new state-based logic: data.isZooming + data.scaleFactor
        earth.setScaleFactor(data.scaleFactor, data.isZooming);
    }

    // ---- ROTATION ----
    if (settings.enableManualRotate) {
        const ROT_DEAD_ZONE = 0.003;
        if (Math.abs(data.rotationDelta.x) > ROT_DEAD_ZONE ||
            Math.abs(data.rotationDelta.y) > ROT_DEAD_ZONE) {
            const rotX = data.rotationDelta.y * 15;
            const rotY = -data.rotationDelta.x * 15;
            earth.addRotation(rotX, rotY);
        }
    }

    updateSkeleton(data.landmarks, 'right');
}

function handleHandsLost() {
    if (handsAreActive) {
        handsAreActive = false;
        earth.setVisible(false); // Hide Earth when hands are lost
    }
    clearSkeleton();
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
// UI
// ============================================
// ============================================
// UI
// ============================================
function setupUI() {
    dismissBtn.addEventListener('click', () => instructions.classList.add('hidden'));
    toggleInstructionsBtn.addEventListener('click', () => instructions.classList.toggle('hidden'));

    // Settings UI
    const paramsBtn = document.getElementById('params-btn');
    const paramsPanel = document.getElementById('params-panel');
    const closeParamsBtn = document.getElementById('close-params');

    paramsBtn.addEventListener('click', () => paramsPanel.classList.toggle('hidden'));
    closeParamsBtn.addEventListener('click', () => paramsPanel.classList.add('hidden'));

    // Checkboxes
    document.getElementById('toggle-follow').addEventListener('change', (e) => {
        settings.followHand = e.target.checked;
    });
    document.getElementById('toggle-zoom').addEventListener('change', (e) => {
        settings.enableZoom = e.target.checked;
    });
    document.getElementById('toggle-manual-rotate').addEventListener('change', (e) => {
        settings.enableManualRotate = e.target.checked;
    });
    document.getElementById('toggle-auto-rotate').addEventListener('change', (e) => {
        settings.enableAutoRotate = e.target.checked;
        earth.setAutoRotation(e.target.checked);
    });
    document.getElementById('toggle-skeleton').addEventListener('change', (e) => {
        settings.showSkeleton = e.target.checked;
        if (!settings.showSkeleton) {
            clearSkeleton();
        }
    });
}

// ============================================
// Skeleton Visualization
// ============================================
let skeletonGroup = new THREE.Group();
const skeletons = { left: null, right: null };

function initSkeleton() {
    scene.add(skeletonGroup);
}

function updateSkeleton(landmarks, handType) {
    if (!settings.showSkeleton || !landmarks) return;

    // Create line geometry if not exists
    if (!skeletons[handType]) {
        const material = new THREE.LineBasicMaterial({
            color: handType === 'left' ? 0x00ff00 : 0xff0000,
            linewidth: 2
        });
        const geometry = new THREE.BufferGeometry();
        skeletons[handType] = new THREE.LineSegments(geometry, material);
        skeletonGroup.add(skeletons[handType]);
    }

    const points = [];
    const connections = [
        [0, 1], [1, 2], [2, 3], [3, 4], // Thumb
        [0, 5], [5, 6], [6, 7], [7, 8], // Index
        [0, 9], [9, 10], [10, 11], [11, 12], // Middle
        [0, 13], [13, 14], [14, 15], [15, 16], // Ring
        [0, 17], [17, 18], [18, 19], [19, 20], // Pinky
        [5, 9], [9, 13], [13, 17] // Palm
    ];

    const sw = window.innerWidth;
    const sh = window.innerHeight;

    connections.forEach(([i, j]) => {
        const p1 = landmarks[i];
        const p2 = landmarks[j];

        // Map normalized coordinates to screen space (same as handleLeftHand)
        // x: (0.5 - p.x) * sw
        // y: -(p.y - 0.5) * sh
        points.push(
            (0.5 - p1.x) * sw, -(p1.y - 0.5) * sh, 0,
            (0.5 - p2.x) * sw, -(p2.y - 0.5) * sh, 0
        );
    });

    skeletons[handType].geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    skeletons[handType].visible = true;
}

function clearSkeleton() {
    if (skeletons.left) skeletons.left.visible = false;
    if (skeletons.right) skeletons.right.visible = false;
}

// ============================================
// FPS
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
// Render Loop
// ============================================
function animate() {
    requestAnimationFrame(animate);

    if (videoTexture && video.readyState >= video.HAVE_CURRENT_DATA) {
        videoTexture.needsUpdate = true;
    }

    if (videoMesh && video.videoWidth && videoMesh.userData.lastW !== video.videoWidth) {
        updateVideoMeshSize();
        videoMesh.userData.lastW = video.videoWidth;
    }

    // Send frame to hand tracker
    handTracker.processFrame();

    // Update Earth (pass whether hands are active to control auto-rotation)
    earth.update(handsAreActive);

    renderer.render(scene, camera);
    updateFPS();
}

// ============================================
// Boot
// ============================================
async function boot() {
    console.log('🌍 TerraHold booting...');
    setProgress(5);
    setStatus('Initializing 3D engine...');

    initThreeJS();
    setProgress(10);

    const camOk = await requestCamera();
    if (!camOk) {
        loadingScreen.classList.add('hidden');
        cameraError.classList.remove('hidden');
        return;
    }

    setupVideoBackground();
    setProgress(35);

    setStatus('Loading 3D Earth model...');
    try {
        await earth.load(scene, (pct) => {
            setProgress(35 + pct * 0.4);
            setStatus(`Loading Earth model... ${pct}%`);
        });
    } catch (err) {
        console.error('Failed to load Earth model:', err);
        setStatus('⚠️ Earth model failed');
    }

    setProgress(80);
    setStatus('Starting hand tracking...');

    handTracker.setCallbacks({
        onLeftHand: handleLeftHand,
        onRightHand: handleRightHand,
        onHandsLost: handleHandsLost,
    });
    await handTracker.init(video);

    setupUI();
    setProgress(95);
    setStatus('Almost ready...');

    animate();

    setTimeout(onFullyLoaded, 1500);
}

boot();
