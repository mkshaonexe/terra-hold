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
let earthFollowingHand = false;

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

    // Mirror horizontally
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
    earthFollowingHand = true;

    const screenW = window.innerWidth;
    const screenH = window.innerHeight;

    // Convert normalized coords to screen space (mirrored X)
    const x = (data.palmCenter.x - 0.5) * screenW;
    const y = -(data.palmCenter.y - 0.5) * screenH;

    // Position Earth slightly above the palm
    earth.setPosition(x, y + 50, 0);
}

function handleRightHand(data) {
    // Pinch to scale
    if (data.isPinching) {
        const scaleDelta = -data.pinchDelta * 20;
        currentEarthScale = Math.max(0.2, Math.min(4.0, currentEarthScale + scaleDelta));
        earth.setScale(currentEarthScale);
    }

    // Open hand → rotate
    if (!data.isPinching) {
        const rotX = data.rotationDelta.y * 12;
        const rotY = data.rotationDelta.x * 12;
        earth.addRotation(rotX, rotY);
    }
}

function handleHandsLost() {
    // Earth stays where it is — no snapping
    earthFollowingHand = false;
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

    // Update video mesh sizing if needed
    if (videoMesh && video.videoWidth && videoMesh.userData.lastW !== video.videoWidth) {
        updateVideoMeshSize();
        videoMesh.userData.lastW = video.videoWidth;
    }

    // Update Earth
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
            setProgress(35 + pct * 0.4); // 35% to 75%
            setStatus(`Loading Earth model... ${pct}%`);
        });
    } catch (err) {
        console.error('Failed to load Earth model:', err);
        setStatus('⚠️ Earth model failed to load. Check console.');
        // Continue anyway — the app will work without the model visible
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

    // 7. Wait briefly for hand tracker to initialize
    setProgress(90);
    setStatus('Finalizing...');

    // Check readiness with a poll (max 5 seconds)
    let waited = 0;
    const checkInterval = setInterval(() => {
        waited += 200;
        if (handTracker.isReady || waited > 5000) {
            clearInterval(checkInterval);
            onFullyLoaded();
        }
    }, 200);

    // 8. Start render loop immediately
    animate();
}

// Start!
boot();
