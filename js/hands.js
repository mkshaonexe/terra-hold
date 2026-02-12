/* ============================================
   TerraHold — Hand Tracking Module (ES Module)
   
   DESIGN:
   - Single hand detected → always POSITION mode
   - Two hands detected → left = position, right = scale/rotate
   - Manual frame sending (no MediaPipe Camera)
   - Optimized for M4 Mac Mini
   ============================================ */

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
        this.prevRightPalm = { x: 0.5, y: 0.5 };

        // Pinch state
        this.pinchDistance = 0.15;
        this.prevPinchDistance = 0.15;

        // Smoothing — small buffers for fast response on M4
        this.leftPalmBuffer = [];
        this.rightPalmBuffer = [];
        this.pinchBuffer = [];
        this.POSITION_BUFFER_SIZE = 3;  // Fast for position
        this.PINCH_BUFFER_SIZE = 3;

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

        // Initial frame to trigger lazy model loading
        try {
            if (videoElement.readyState >= 2) {
                await this.handsInstance.send({ image: videoElement });
            }
        } catch (e) {
            console.log('⏳ Initial frame skipped');
        }

        this.isReady = true;
        console.log('✅ Hand tracking initialized');
    }

    async processFrame() {
        if (this._isProcessing) return;
        if (!this.handsInstance) return;
        if (!this.videoElement || this.videoElement.readyState < 2) return;

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

        if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
            this.handsCount = 0;
            this.leftHandDetected = false;
            this.rightHandDetected = false;
            this._updateStatusUI(false, false);
            if (this.onHandsLost) this.onHandsLost();
            return;
        }

        this.handsCount = results.multiHandLandmarks.length;

        // ★ KEY LOGIC: Strict hand role separation
        if (this.handsCount === 1) {
            // SINGLE HAND → always treated as LEFT (position only)
            // This prevents the handedness misidentification problem
            const landmarks = results.multiHandLandmarks[0];
            this.leftHandDetected = true;
            this.rightHandDetected = false;
            this._processLeftHand(landmarks);

        } else if (this.handsCount === 2) {
            // TWO HANDS → figure out which is left and which is right
            // Use MediaPipe's handedness labels
            const hand0 = results.multiHandedness[0];
            const hand1 = results.multiHandedness[1];

            // MediaPipe mirrors: "Right" label = user's LEFT hand
            const hand0IsLeft = hand0.label === 'Right';
            const hand1IsLeft = hand1.label === 'Right';

            let leftIdx, rightIdx;

            if (hand0IsLeft && !hand1IsLeft) {
                leftIdx = 0;
                rightIdx = 1;
            } else if (!hand0IsLeft && hand1IsLeft) {
                leftIdx = 1;
                rightIdx = 0;
            } else {
                // Both same label (rare) — use position: leftmost in view = user's right
                // Pick the one with smaller x as left hand (appears on right side of mirrored video)
                const palm0x = results.multiHandLandmarks[0][0].x;
                const palm1x = results.multiHandLandmarks[1][0].x;
                if (palm0x > palm1x) {
                    leftIdx = 0;
                    rightIdx = 1;
                } else {
                    leftIdx = 1;
                    rightIdx = 0;
                }
            }

            this.leftHandDetected = true;
            this.rightHandDetected = true;
            this._processLeftHand(results.multiHandLandmarks[leftIdx]);
            this._processRightHand(results.multiHandLandmarks[rightIdx]);
        }

        this._updateStatusUI(this.leftHandDetected, this.rightHandDetected);
    }

    _smoothPosition(buffer, newPos) {
        buffer.push({ ...newPos });
        if (buffer.length > this.POSITION_BUFFER_SIZE) buffer.shift();

        let sx = 0, sy = 0;
        for (const p of buffer) { sx += p.x; sy += p.y; }
        return { x: sx / buffer.length, y: sy / buffer.length };
    }

    _smoothValue(buffer, newVal) {
        buffer.push(newVal);
        if (buffer.length > this.PINCH_BUFFER_SIZE) buffer.shift();

        let sum = 0;
        for (const v of buffer) sum += v;
        return sum / buffer.length;
    }

    _calculatePalmCenter(landmarks) {
        // Wrist + MCP joints = stable palm center
        const palmIndices = [0, 5, 9, 13, 17];
        let cx = 0, cy = 0;
        for (const idx of palmIndices) {
            cx += landmarks[idx].x;
            cy += landmarks[idx].y;
        }
        return { x: cx / palmIndices.length, y: cy / palmIndices.length };
    }

    _processLeftHand(landmarks) {
        const rawPalm = this._calculatePalmCenter(landmarks);
        this.leftPalm = this._smoothPosition(this.leftPalmBuffer, rawPalm);

        if (this.onLeftHand) {
            this.onLeftHand({
                palmCenter: this.leftPalm,
                landmarks: landmarks,
            });
        }
    }

    _processRightHand(landmarks) {
        const rawPalm = this._calculatePalmCenter(landmarks);
        this.prevRightPalm = { ...this.rightPalm };
        this.rightPalm = this._smoothPosition(this.rightPalmBuffer, rawPalm);

        // Pinch distance: thumb tip (4) ↔ index tip (8)
        const thumbTip = landmarks[4];
        const indexTip = landmarks[8];
        const dx = thumbTip.x - indexTip.x;
        const dy = thumbTip.y - indexTip.y;
        const rawDistance = Math.sqrt(dx * dx + dy * dy);

        this.prevPinchDistance = this.pinchDistance;
        this.pinchDistance = this._smoothValue(this.pinchBuffer, rawDistance);

        // Rotation delta from palm movement
        const rotDeltaX = this.rightPalm.x - this.prevRightPalm.x;
        const rotDeltaY = this.rightPalm.y - this.prevRightPalm.y;

        if (this.onRightHand) {
            this.onRightHand({
                palmCenter: this.rightPalm,
                pinchDistance: this.pinchDistance,
                pinchDelta: this.pinchDistance - this.prevPinchDistance,
                rotationDelta: { x: rotDeltaX, y: rotDeltaY },
                landmarks: landmarks,
            });
        }
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

    setCallbacks({ onLeftHand, onRightHand, onHandsLost }) {
        this.onLeftHand = onLeftHand || null;
        this.onRightHand = onRightHand || null;
        this.onHandsLost = onHandsLost || null;
    }
}

export default HandTracker;
