/* ============================================
   TerraHold — Hand Tracking Module
   MediaPipe Hands integration with gesture
   detection for left (position) and right
   (scale/rotation) hand controls.
   ============================================ */

const HandsModule = (() => {
    let handsInstance = null;
    let camera = null;
    let isReady = false;

    // Hand state
    let leftHandDetected = false;
    let rightHandDetected = false;
    let leftPalmCenter = { x: 0.5, y: 0.5 };
    let rightPalmCenter = { x: 0.5, y: 0.5 };
    let prevRightPalm = { x: 0.5, y: 0.5 };
    let rightPinchDistance = 1.0;
    let prevRightPinchDistance = 1.0;

    // Callbacks
    let onLeftHandUpdate = null;
    let onRightHandUpdate = null;
    let onHandsLost = null;

    function init(videoElement, onResults) {
        handsInstance = new Hands({
            locateFile: (file) => {
                return `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`;
            }
        });

        handsInstance.setOptions({
            maxNumHands: 2,
            modelComplexity: 1,
            minDetectionConfidence: 0.7,
            minTrackingConfidence: 0.6,
        });

        handsInstance.onResults(processResults);

        camera = new Camera(videoElement, {
            onFrame: async () => {
                if (handsInstance) {
                    await handsInstance.send({ image: videoElement });
                }
            },
            width: 1280,
            height: 720,
        });

        camera.start().then(() => {
            isReady = true;
        });
    }

    function processResults(results) {
        leftHandDetected = false;
        rightHandDetected = false;

        if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
            if (onHandsLost) onHandsLost();
            updateStatusIndicators(false, false);
            return;
        }

        for (let i = 0; i < results.multiHandLandmarks.length; i++) {
            const landmarks = results.multiHandLandmarks[i];
            const handedness = results.multiHandedness[i];

            // MediaPipe reports handedness as seen in the image (mirrored)
            // So "Right" label = user's left hand (mirrored) and vice versa
            const isLeftHand = handedness.label === 'Right';

            if (isLeftHand) {
                leftHandDetected = true;
                processLeftHand(landmarks);
            } else {
                rightHandDetected = true;
                processRightHand(landmarks);
            }
        }

        updateStatusIndicators(leftHandDetected, rightHandDetected);
    }

    function processLeftHand(landmarks) {
        // Calculate palm center from wrist and MCP joints
        const palmPoints = [
            landmarks[0],  // Wrist
            landmarks[5],  // Index MCP
            landmarks[9],  // Middle MCP
            landmarks[13], // Ring MCP
            landmarks[17], // Pinky MCP
        ];

        let cx = 0, cy = 0;
        palmPoints.forEach(p => {
            cx += p.x;
            cy += p.y;
        });
        cx /= palmPoints.length;
        cy /= palmPoints.length;

        leftPalmCenter = { x: cx, y: cy };

        if (onLeftHandUpdate) {
            onLeftHandUpdate({
                palmCenter: leftPalmCenter,
                landmarks: landmarks,
            });
        }
    }

    function processRightHand(landmarks) {
        // Palm center
        const palmPoints = [
            landmarks[0], landmarks[5], landmarks[9], landmarks[13], landmarks[17],
        ];
        let cx = 0, cy = 0;
        palmPoints.forEach(p => { cx += p.x; cy += p.y; });
        cx /= palmPoints.length;
        cy /= palmPoints.length;

        prevRightPalm = { ...rightPalmCenter };
        rightPalmCenter = { x: cx, y: cy };

        // Pinch detection: thumb tip (4) to index tip (8)
        const thumbTip = landmarks[4];
        const indexTip = landmarks[8];
        const dx = thumbTip.x - indexTip.x;
        const dy = thumbTip.y - indexTip.y;
        prevRightPinchDistance = rightPinchDistance;
        rightPinchDistance = Math.sqrt(dx * dx + dy * dy);

        // Calculate rotation delta from palm movement
        const rotDeltaX = rightPalmCenter.x - prevRightPalm.x;
        const rotDeltaY = rightPalmCenter.y - prevRightPalm.y;

        if (onRightHandUpdate) {
            onRightHandUpdate({
                palmCenter: rightPalmCenter,
                pinchDistance: rightPinchDistance,
                pinchDelta: rightPinchDistance - prevRightPinchDistance,
                rotationDelta: { x: rotDeltaX, y: rotDeltaY },
                isPinching: rightPinchDistance < 0.06,
                landmarks: landmarks,
            });
        }
    }

    function updateStatusIndicators(left, right) {
        const leftEl = document.getElementById('left-hand-status');
        const rightEl = document.getElementById('right-hand-status');

        if (leftEl) {
            leftEl.classList.toggle('on', left);
            leftEl.classList.toggle('off', !left);
        }
        if (rightEl) {
            rightEl.classList.toggle('on', right);
            rightEl.classList.toggle('off', !right);
        }
    }

    function setCallbacks(callbacks) {
        onLeftHandUpdate = callbacks.onLeftHand || null;
        onRightHandUpdate = callbacks.onRightHand || null;
        onHandsLost = callbacks.onHandsLost || null;
    }

    function getIsReady() {
        return isReady;
    }

    function getState() {
        return {
            leftDetected: leftHandDetected,
            rightDetected: rightHandDetected,
            leftPalm: { ...leftPalmCenter },
            rightPalm: { ...rightPalmCenter },
            pinchDistance: rightPinchDistance,
        };
    }

    return {
        init,
        setCallbacks,
        getIsReady,
        getState,
    };
})();
