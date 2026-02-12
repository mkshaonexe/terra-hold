/* ============================================
   TerraHold — Main Application
   Initializes webcam, Three.js scene, and
   orchestrates Earth + Hand modules.
   ============================================ */

(() => {
    // DOM Elements
    const loadingScreen = document.getElementById('loading-screen');
    const progressBar = document.getElementById('progress-bar');
    const cameraError = document.getElementById('camera-error');
    const instructions = document.getElementById('instructions');
    const hud = document.getElementById('hud');
    const fpsCounter = document.getElementById('fps-counter');
    const canvas = document.getElementById('render-canvas');
    const video = document.getElementById('webcam');
    const dismissBtn = document.getElementById('dismiss-instructions');
    const toggleInstructionsBtn = document.getElementById('toggle-instructions');

    // Three.js
    let scene, camera, renderer;
    let videoTexture, videoMesh;

    // State
    let currentEarthScale = 1.0;
    let lastFrameTime = performance.now();
    let frameCount = 0;
    let fps = 0;
    let handsReady = false;
    let firstHandDetected = false;

    // ---- Progress Animation ----
    function setProgress(pct) {
        if (progressBar) progressBar.style.width = pct + '%';
    }

    // ---- Initialize Three.js ----
    function initThreeJS() {
        scene = new THREE.Scene();

        // Orthographic camera for screen-space rendering
        const w = window.innerWidth;
        const h = window.innerHeight;
        camera = new THREE.OrthographicCamera(
            -w / 2, w / 2,
            h / 2, -h / 2,
            0.1, 2000
        );
        camera.position.z = 500;

        renderer = new THREE.WebGLRenderer({
            canvas: canvas,
            alpha: true,
            antialias: true,
        });
        renderer.setSize(w, h);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setClearColor(0x000000, 0);

        // Handle resize
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

        // Update video background
        if (videoMesh) {
            updateVideoMeshSize();
        }
    }

    // ---- Webcam Video Background ----
    function setupVideoBackground() {
        videoTexture = new THREE.VideoTexture(video);
        videoTexture.minFilter = THREE.LinearFilter;
        videoTexture.magFilter = THREE.LinearFilter;

        const videoMaterial = new THREE.MeshBasicMaterial({
            map: videoTexture,
            depthWrite: false,
            depthTest: false,
        });

        // Create a plane to show the video
        const planeGeometry = new THREE.PlaneGeometry(1, 1);
        videoMesh = new THREE.Mesh(planeGeometry, videoMaterial);
        videoMesh.renderOrder = -1;
        videoMesh.position.z = -100;

        // Mirror the video horizontally
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

    // ---- Camera Access ----
    async function requestCamera() {
        setProgress(20);
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
            setProgress(40);
            return true;
        } catch (err) {
            console.error('Camera access denied:', err);
            return false;
        }
    }

    // ---- Initialize Hand Tracking ----
    function initHandTracking() {
        setProgress(60);

        HandsModule.setCallbacks({
            onLeftHand: handleLeftHand,
            onRightHand: handleRightHand,
            onHandsLost: handleHandsLost,
        });

        HandsModule.init(video);

        // Wait for hands module to be ready
        const checkReady = setInterval(() => {
            if (HandsModule.getIsReady()) {
                handsReady = true;
                clearInterval(checkReady);
                setProgress(100);
                onFullyLoaded();
            }
        }, 200);
    }

    // ---- Hand Event Handlers ----
    function handleLeftHand(data) {
        if (!EarthModule.isVisible()) {
            EarthModule.show();
            if (!firstHandDetected) {
                firstHandDetected = true;
            }
        }

        // Convert normalized coordinates to screen coordinates
        const screenW = window.innerWidth;
        const screenH = window.innerHeight;

        // Mirror X since video is mirrored
        const x = (data.palmCenter.x - 0.5) * screenW;
        const y = -(data.palmCenter.y - 0.5) * screenH;

        // Offset earth slightly above the palm
        EarthModule.setPosition(x, y + 60, 0);
    }

    function handleRightHand(data) {
        // Pinch to scale
        if (data.isPinching) {
            // When pinching, use pinch delta to scale
            const scaleDelta = -data.pinchDelta * 15;
            currentEarthScale = Math.max(0.3, Math.min(3.0, currentEarthScale + scaleDelta));
            EarthModule.setScale(currentEarthScale);
        }

        // Open hand rotation
        if (!data.isPinching) {
            const rotX = data.rotationDelta.y * 8;
            const rotY = data.rotationDelta.x * 8;
            EarthModule.addRotation(rotX, rotY);
        }
    }

    function handleHandsLost() {
        // Keep earth visible but stop updates — it just floats
    }

    // ---- Loading Complete ----
    function onFullyLoaded() {
        setTimeout(() => {
            loadingScreen.classList.add('fade-out');
            setTimeout(() => {
                loadingScreen.classList.add('hidden');
                hud.classList.remove('hidden');
                instructions.classList.remove('hidden');
            }, 800);
        }, 500);
    }

    // ---- UI Events ----
    function setupUI() {
        dismissBtn.addEventListener('click', () => {
            instructions.classList.add('hidden');
        });

        toggleInstructionsBtn.addEventListener('click', () => {
            instructions.classList.toggle('hidden');
        });
    }

    // ---- FPS Counter ----
    function updateFPS() {
        frameCount++;
        const currentTime = performance.now();
        if (currentTime - lastFrameTime >= 1000) {
            fps = frameCount;
            frameCount = 0;
            lastFrameTime = currentTime;
            if (fpsCounter) fpsCounter.textContent = fps + ' FPS';
        }
    }

    // ---- Main Render Loop ----
    function animate() {
        requestAnimationFrame(animate);

        // Update video texture
        if (videoTexture && video.readyState >= video.HAVE_CURRENT_DATA) {
            videoTexture.needsUpdate = true;
        }

        // Update video mesh size if video dimensions changed
        if (videoMesh && video.videoWidth && videoMesh.userData.lastW !== video.videoWidth) {
            updateVideoMeshSize();
            videoMesh.userData.lastW = video.videoWidth;
        }

        // Update Earth
        EarthModule.update(1 / 60);

        // Render
        renderer.render(scene, camera);

        // FPS
        updateFPS();
    }

    // ---- Boot Sequence ----
    async function boot() {
        setProgress(10);

        // Init Three.js
        initThreeJS();
        setProgress(15);

        // Request camera
        const cameraGranted = await requestCamera();
        if (!cameraGranted) {
            loadingScreen.classList.add('hidden');
            cameraError.classList.remove('hidden');
            return;
        }

        // Setup video background
        setupVideoBackground();
        setProgress(50);

        // Create Earth
        EarthModule.create(scene);
        setProgress(55);

        // Setup UI
        setupUI();

        // Init hand tracking
        initHandTracking();

        // Start render loop
        animate();
    }

    // Start
    boot();
})();
