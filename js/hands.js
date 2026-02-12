/* ============================================
   TerraHold — Hand Tracking Module (ES Module)
   MediaPipe Hands integration with gesture
   detection for left (position) and right
   (scale/rotation) hand controls.
   ============================================ */

class HandTracker {
    constructor() {
        this.handsInstance = null;
        this.camera = null;
        this.isReady = false;

        // Hand state
        this.leftHandDetected = false;
        this.rightHandDetected = false;

        // Smoothed palm positions (normalized 0-1)
        this.leftPalm = { x: 0.5, y: 0.5 };
        this.rightPalm = { x: 0.5, y: 0.5 };
        this.prevRightPalm = { x: 0.5, y: 0.5 };

        // Pinch state
        this.pinchDistance = 1.0;
        this.prevPinchDistance = 1.0;
        this.isPinching = false;

        // Smoothing buffers for palm positions
        this.leftPalmBuffer = [];
        this.rightPalmBuffer = [];
        this.BUFFER_SIZE = 5;

        // Callbacks
        this.onLeftHand = null;
        this.onRightHand = null;
        this.onHandsLost = null;
    }

    init(videoElement) {
        // Use global Hands from MediaPipe script
        if (typeof Hands === 'undefined') {
            console.error('❌ MediaPipe Hands not loaded. Make sure to include the script.');
            return;
        }

        this.handsInstance = new Hands({
            locateFile: (file) => {
                return `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`;
            }
        });

        this.handsInstance.setOptions({
            maxNumHands: 2,
            modelComplexity: 1,
            minDetectionConfidence: 0.6,
            minTrackingConfidence: 0.5,
        });

        this.handsInstance.onResults((results) => this._processResults(results));

        // Use global Camera from MediaPipe script
        this.camera = new Camera(videoElement, {
            onFrame: async () => {
                if (this.handsInstance) {
                    try {
                        await this.handsInstance.send({ image: videoElement });
                    } catch (e) {
                        // Silently handle frame drops
                    }
                }
            },
            width: 1280,
            height: 720,
        });

        this.camera.start().then(() => {
            this.isReady = true;
            console.log('✅ Hand tracking ready');
        }).catch(err => {
            console.error('❌ Camera start failed:', err);
        });
    }

    _processResults(results) {
        this.leftHandDetected = false;
        this.rightHandDetected = false;

        if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
            if (this.onHandsLost) this.onHandsLost();
            this._updateStatusUI(false, false);
            return;
        }

        for (let i = 0; i < results.multiHandLandmarks.length; i++) {
            const landmarks = results.multiHandLandmarks[i];
            const handedness = results.multiHandedness[i];

            // MediaPipe mirrors: "Right" label = user's LEFT hand
            const isLeftHand = handedness.label === 'Right';

            if (isLeftHand) {
                this.leftHandDetected = true;
                this._processLeftHand(landmarks);
            } else {
                this.rightHandDetected = true;
                this._processRightHand(landmarks);
            }
        }

        this._updateStatusUI(this.leftHandDetected, this.rightHandDetected);
    }

    _smoothPosition(buffer, newPos) {
        buffer.push({ ...newPos });
        if (buffer.length > this.BUFFER_SIZE) {
            buffer.shift();
        }

        let sx = 0, sy = 0;
        for (const p of buffer) {
            sx += p.x;
            sy += p.y;
        }
        return {
            x: sx / buffer.length,
            y: sy / buffer.length,
        };
    }

    _calculatePalmCenter(landmarks) {
        const palmIndices = [0, 5, 9, 13, 17]; // Wrist + MCP joints
        let cx = 0, cy = 0;
        for (const idx of palmIndices) {
            cx += landmarks[idx].x;
            cy += landmarks[idx].y;
        }
        return {
            x: cx / palmIndices.length,
            y: cy / palmIndices.length,
        };
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

        // Pinch detection: thumb tip (4) ↔ index tip (8)
        const thumbTip = landmarks[4];
        const indexTip = landmarks[8];
        const dx = thumbTip.x - indexTip.x;
        const dy = thumbTip.y - indexTip.y;
        this.prevPinchDistance = this.pinchDistance;
        this.pinchDistance = Math.sqrt(dx * dx + dy * dy);
        this.isPinching = this.pinchDistance < 0.07;

        // Rotation delta from palm movement
        const rotDeltaX = this.rightPalm.x - this.prevRightPalm.x;
        const rotDeltaY = this.rightPalm.y - this.prevRightPalm.y;

        if (this.onRightHand) {
            this.onRightHand({
                palmCenter: this.rightPalm,
                pinchDistance: this.pinchDistance,
                pinchDelta: this.pinchDistance - this.prevPinchDistance,
                rotationDelta: { x: rotDeltaX, y: rotDeltaY },
                isPinching: this.isPinching,
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
