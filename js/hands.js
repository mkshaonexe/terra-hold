/* ============================================
   TerraHold — Hand Tracking Module (ES Module)
   
   STRICT RULES:
   ─ Single hand = ONLY position (no resize, no rotate, ever)
   ─ Two hands = left positions, right scales/rotates
   ─ Two hands must be spatially separated (prevents
     MediaPipe from splitting one hand into two)
   ─ Manual frame sending (no MediaPipe Camera)
   ─ Optimized for M4 Mac Mini
   ============================================ */

/* ============================================
   TerraHold — Hand Tracking Module (ES Module)
   ============================================ */

const CONFIG = {
    BUFFER_SIZE_POSITION: 3,
    BUFFER_SIZE_PINCH: 3,
    MIN_HAND_SEPARATION: 0.18,
    MIN_HAND_SEPARATION: 0.18,
    PINCH_THRESHOLD: 0.05,        // Distance to trigger "pinch" state
    PINCH_RELEASE_THRESHOLD: 0.08, // Distance to exit "pinch" state
    CLUTCH_VELOCITY_THRESHOLD: 0.02, // Rapid opening speed to disengage
};

class HandTracker {
    constructor() {
        this.handsInstance = null;
        this.videoElement = null;
        this.isReady = false;
        this._isProcessing = false;
        this._firstResultReceived = false;

        // Hand state
        this.leftHandDetected = false;
        this.rightHandDetected = false;
        this.handsCount = 0;

        // Palm positions (normalized 0-1)
        this.leftPalm = { x: 0.5, y: 0.5 };
        this.rightPalm = { x: 0.5, y: 0.5 };
        this.prevRightPalm = null;

        // Pinch state
        this.pinchDistance = 0;
        this.prevPinchDistance = 0;
        this.isZooming = false;
        this.startPinchDistance = 0;
        this._rightHandActive = false;

        // Buffers
        this.leftPalmBuffer = [];
        this.rightPalmBuffer = [];
        this.pinchBuffer = [];

        // Callbacks
        this.onLeftHand = null;
        this.onRightHand = null;
        this.onHandsLost = null;
    }

    async init(videoElement) {
        this.videoElement = videoElement;

        if (typeof Hands === 'undefined') {
            console.error('❌ MediaPipe Hands not loaded.');
            return;
        }

        console.log('🖐️ Initializing MediaPipe Hands...');

        this.handsInstance = new Hands({
            locateFile: (file) => {
                return `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`;
            }
        });

        this.handsInstance.setOptions({
            maxNumHands: 2,
            modelComplexity: 1,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.4,
        });

        this.handsInstance.onResults((results) => this._processResults(results));

        this.handsInstance.onResults((results) => this._processResults(results));

        this.isReady = true;
        console.log('✅ Hand tracking initialized');
    }

    async processFrame() {
        if (this._isProcessing) return;
        if (!this.handsInstance || !this.videoElement) return;
        if (this.videoElement.readyState < 2) return;

        this._isProcessing = true;
        try {
            await this.handsInstance.send({ image: this.videoElement });
        } catch (e) { /* frame drop */ }
        this._isProcessing = false;
    }

    _processResults(results) {
        if (!this._firstResultReceived) {
            this._firstResultReceived = true;
            console.log('🖐️ First hand tracking result received!');
        }

        // No hands
        if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
            this.handsCount = 0;
            this.leftHandDetected = false;
            this.rightHandDetected = false;
            this._rightHandActive = false;
            this.prevRightPalm = null;
            this._updateStatusUI(false, false);
            if (this.onHandsLost) this.onHandsLost();
            return;
        }

        const numHands = results.multiHandLandmarks.length;

        if (numHands === 1) {
            // ★ SINGLE HAND → ALWAYS position only
            this.handsCount = 1;
            this.leftHandDetected = true;
            this.rightHandDetected = false;
            this._rightHandActive = false;
            this.prevRightPalm = null;
            // Clear right hand buffers so they don't carry over
            this.rightPalmBuffer = [];
            this.pinchBuffer = [];

            this._processLeftHand(results.multiHandLandmarks[0]);

        } else if (numHands === 2) {
            // ★ TWO HANDS → Check if they're truly separate
            const palm0 = this._calculatePalmCenter(results.multiHandLandmarks[0]);
            const palm1 = this._calculatePalmCenter(results.multiHandLandmarks[1]);

            const dx = palm0.x - palm1.x;
            const dy = palm0.y - palm1.y;
            const separation = Math.sqrt(dx * dx + dy * dy);

            if (separation < CONFIG.MIN_HAND_SEPARATION) {
                // Too close — MediaPipe is splitting one hand into two.
                // Treat as single hand (position only).
                this.handsCount = 1;
                this.leftHandDetected = true;
                this.rightHandDetected = false;
                this._rightHandActive = false;
                this.prevRightPalm = null;
                this.rightPalmBuffer = [];
                this.pinchBuffer = [];

                // Use the average of both as the palm center
                const avgLandmarks = results.multiHandLandmarks[0]; // Just use first
                this._processLeftHand(avgLandmarks);

            } else {
                // Truly two separate hands
                this.handsCount = 2;

                // Figure out left vs right
                const hand0Label = results.multiHandedness[0].label;
                const hand1Label = results.multiHandedness[1].label;

                // MediaPipe mirrors: "Right" label = user's LEFT hand
                const hand0IsLeft = hand0Label === 'Right';
                const hand1IsLeft = hand1Label === 'Right';

                let leftIdx, rightIdx;

                if (hand0IsLeft && !hand1IsLeft) {
                    leftIdx = 0; rightIdx = 1;
                } else if (!hand0IsLeft && hand1IsLeft) {
                    leftIdx = 1; rightIdx = 0;
                } else {
                    // Both same label — use spatial position
                    // In mirrored view, larger X = user's left side
                    if (palm0.x > palm1.x) {
                        leftIdx = 0; rightIdx = 1;
                    } else {
                        leftIdx = 1; rightIdx = 0;
                    }
                }

                this.leftHandDetected = true;
                this.rightHandDetected = true;
                this._processLeftHand(results.multiHandLandmarks[leftIdx]);
                this._processRightHand(results.multiHandLandmarks[rightIdx]);
            }
        }

        this._updateStatusUI(this.leftHandDetected, this.rightHandDetected);
    }

    // ---- Smoothing ----

    _smoothPosition(buffer, newPos) {
        buffer.push({ ...newPos });
        if (buffer.length > CONFIG.BUFFER_SIZE_POSITION) buffer.shift();
        let sx = 0, sy = 0;
        for (const p of buffer) { sx += p.x; sy += p.y; }
        return { x: sx / buffer.length, y: sy / buffer.length };
    }

    _smoothValue(buffer, newVal) {
        buffer.push(newVal);
        if (buffer.length > CONFIG.BUFFER_SIZE_PINCH) buffer.shift();
        let sum = 0;
        for (const v of buffer) sum += v;
        return sum / buffer.length;
    }

    _calculatePalmCenter(landmarks) {
        const palmIndices = [0, 5, 9, 13, 17];
        let cx = 0, cy = 0;
        for (const idx of palmIndices) {
            cx += landmarks[idx].x;
            cy += landmarks[idx].y;
        }
        return { x: cx / palmIndices.length, y: cy / palmIndices.length };
    }

    // ---- Hand Processing ----

    // ---- Hand Processing ----

    _processLeftHand(landmarks) {
        const rawPalm = this._calculatePalmCenter(landmarks);
        this.leftPalm = this._smoothPosition(this.leftPalmBuffer, rawPalm);

        // Left hand ONLY sends position data — nothing else
        if (this.onLeftHand) {
            this.onLeftHand({
                palmCenter: this.leftPalm,
                landmarks: landmarks, // Raw landmarks for skeleton
            });
        }
    }

    _processRightHand(landmarks) {
        const rawPalm = this._calculatePalmCenter(landmarks);
        this.rightPalm = this._smoothPosition(this.rightPalmBuffer, rawPalm);

        // Analyze Finger States (Strict Zoom Guard)
        // Middle (12), Ring (16), Pinky (20) must be CLOSED
        // PIP joints: Middle(10), Ring(14), Pinky(18)
        const middleClosed = this._isFingerClosed(landmarks, 12, 10);
        const ringClosed = this._isFingerClosed(landmarks, 16, 14);
        const pinkyClosed = this._isFingerClosed(landmarks, 20, 18);

        // Strict Rule: ALL three must be closed to allow resizing
        const isStrictGestureValid = middleClosed && ringClosed && pinkyClosed;

        // Pinch distance: thumb tip (4) ↔ index tip (8)
        const thumbTip = landmarks[4];
        const indexTip = landmarks[8];
        const dx = thumbTip.x - indexTip.x;
        const dy = thumbTip.y - indexTip.y;
        const rawDistance = Math.sqrt(dx * dx + dy * dy);
        this.pinchDistance = this._smoothValue(this.pinchBuffer, rawDistance);


        // ---- DEBUG LOGGING ----
        if (this.debugEnabled) {
            // Throttle logs slightly or just log on strict state change?
            // Real-time requested: "active hapen in the rela time"
            console.log(`%c[HandDebug] Right Hand Stats:
            Middle Closed: ${middleClosed}
            Ring Closed:   ${ringClosed}
            Pinky Closed:  ${pinkyClosed}
            Strict Valid:  ${isStrictGestureValid ? '✅ YES' : '❌ NO'}
            Pinch Dist:    ${this.pinchDistance.toFixed(3)}
            Zooming:       ${this.isZooming}`,
                isStrictGestureValid ? 'color: green; font-weight: bold;' : 'color: red;'
            );

            if (!isStrictGestureValid && this.isZooming) {
                console.warn('⚠️ Gesture Invalidated! Forced STOP resizing.');
            }
        }


        // ---- STATE MACHINE: PINCH LOGIC ----
        // 1. Detect rapid opening (CLUTCH)
        const pinchVelocity = this.pinchDistance - this.prevPinchDistance;
        const isOpeningFast = pinchVelocity > CONFIG.CLUTCH_VELOCITY_THRESHOLD;

        // 2. State Transitions
        if (!this.isZooming) {
            // ENGAGE: Fingers close enough AND strict gesture is validation
            if (this.pinchDistance < CONFIG.PINCH_THRESHOLD && isStrictGestureValid) {
                this.isZooming = true;
                this.startPinchDistance = this.pinchDistance;
                if (this.debugEnabled) console.log('✅ ZOOM STARTED');
            }
        } else {
            // DISENGAGE: Fingers open wide OR opening too fast OR gesture becomes invalid
            if (this.pinchDistance > CONFIG.PINCH_RELEASE_THRESHOLD || isOpeningFast || !isStrictGestureValid) {
                this.isZooming = false;
                if (this.debugEnabled && !isStrictGestureValid) console.log('🛑 ZOOM STOPPED (Invalid Gesture)');
                else if (this.debugEnabled) console.log('⏹️ ZOOM STOPPED (Released)');
            }
        }

        // 3. Calculate Factors
        let scaleFactor = 1.0;
        if (this.isZooming && this.startPinchDistance > 0.001) {
            scaleFactor = this.pinchDistance / this.startPinchDistance;
        }

        // Rotation delta (only when right hand settled)
        let rotDelta = { x: 0, y: 0 };
        if (this._rightHandActive && this.prevRightPalm) {
            rotDelta = {
                x: this.rightPalm.x - this.prevRightPalm.x,
                y: this.rightPalm.y - this.prevRightPalm.y,
            };
        }

        this._rightHandActive = true;
        this.prevPinchDistance = this.pinchDistance;
        this.prevRightPalm = { ...this.rightPalm };

        if (this.onRightHand) {
            this.onRightHand({
                palmCenter: this.rightPalm,
                isZooming: this.isZooming,
                scaleFactor: scaleFactor, // 1.0 = no change, 0.5 = half size, etc.
                rotationDelta: rotDelta,
                landmarks: landmarks, // Raw landmarks for skeleton
            });
        }
    }

    _isFingerClosed(landmarks, tipIdx, pipIdx) {
        const wrist = landmarks[0];
        const tip = landmarks[tipIdx];
        const pip = landmarks[pipIdx];

        // 2D Distance squared check
        const dTip = (tip.x - wrist.x) ** 2 + (tip.y - wrist.y) ** 2;
        const dPip = (pip.x - wrist.x) ** 2 + (pip.y - wrist.y) ** 2;

        return dTip < dPip;
    }

    _updateStatusUI(left, right) {
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

    setDebugMode(enabled) {
        this.debugEnabled = enabled;
    }

    setCallbacks({ onLeftHand, onRightHand, onHandsLost }) {
        this.onLeftHand = onLeftHand || null;
        this.onRightHand = onRightHand || null;
        this.onHandsLost = onHandsLost || null;
    }
}

export default HandTracker;
