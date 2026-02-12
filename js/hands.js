/* ============================================
   TerraHold — Hand Tracking Module (ES Module)
   MediaPipe Hands integration — uses manual
   frame sending (no MediaPipe Camera utility)
   to avoid dual-stream conflicts.
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

        // Smoothed palm positions (normalized 0-1)
        this.leftPalm = { x: 0.5, y: 0.5 };
        this.rightPalm = { x: 0.5, y: 0.5 };
        this.prevRightPalm = { x: 0.5, y: 0.5 };

        // Pinch state
        this.pinchDistance = 0.15;
        this.prevPinchDistance = 0.15;

        // Smoothing buffers
        this.leftPalmBuffer = [];
        this.rightPalmBuffer = [];
        this.pinchBuffer = [];
        this.BUFFER_SIZE = 4;
        this.PINCH_BUFFER_SIZE = 3;

        // Callbacks
        this.onLeftHand = null;
        this.onRightHand = null;
        this.onHandsLost = null;

        // Lost hand frame counters
        this.leftLostFrames = 0;
        this.rightLostFrames = 0;
        this.LOST_THRESHOLD = 5;
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

        // Send one initial frame to trigger model loading
        // (Hands model loads lazily on first .send() call)
        try {
            if (videoElement.readyState >= 2) {
                await this.handsInstance.send({ image: videoElement });
            }
        } catch (e) {
            console.log('⏳ Initial frame send skipped, will retry in render loop');
        }

        this.isReady = true;
        console.log('✅ Hand tracking initialized (manual frame mode)');
    }

    /**
     * Call this every frame from the render loop.
     * Sends the current video frame to MediaPipe for processing.
     */
    async processFrame() {
        if (this._isProcessing) return; // Skip if still processing previous frame
        if (!this.handsInstance) return;
        if (!this.videoElement || this.videoElement.readyState < 2) return;

        this._isProcessing = true;
        try {
            await this.handsInstance.send({ image: this.videoElement });
        } catch (e) {
            // Silently handle frame drops
        }
        this._isProcessing = false;
    }

    _processResults(results) {
        if (!this._firstResultReceived) {
            this._firstResultReceived = true;
            console.log('🖐️ First hand tracking result received!');
        }

        let foundLeft = false;
        let foundRight = false;

        if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            for (let i = 0; i < results.multiHandLandmarks.length; i++) {
                const landmarks = results.multiHandLandmarks[i];
                const handedness = results.multiHandedness[i];

                // MediaPipe mirrors: "Right" label = user's LEFT hand
                const isLeftHand = handedness.label === 'Right';

                if (isLeftHand) {
                    foundLeft = true;
                    this.leftLostFrames = 0;
                    this._processLeftHand(landmarks);
                } else {
                    foundRight = true;
                    this.rightLostFrames = 0;
                    this._processRightHand(landmarks);
                }
            }
        }

        // Track lost frames
        if (!foundLeft) {
            this.leftLostFrames++;
            if (this.leftLostFrames > this.LOST_THRESHOLD) {
                this.leftHandDetected = false;
            }
        } else {
            this.leftHandDetected = true;
        }

        if (!foundRight) {
            this.rightLostFrames++;
            if (this.rightLostFrames > this.LOST_THRESHOLD) {
                this.rightHandDetected = false;
            }
        } else {
            this.rightHandDetected = true;
        }

        if (!this.leftHandDetected && !this.rightHandDetected && this.onHandsLost) {
            this.onHandsLost();
        }

        this._updateStatusUI(this.leftHandDetected, this.rightHandDetected);
    }

    _smoothPosition(buffer, newPos) {
        buffer.push({ ...newPos });
        if (buffer.length > this.BUFFER_SIZE) buffer.shift();

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

        // Rotation delta
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
