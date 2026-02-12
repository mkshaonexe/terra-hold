/* ============================================
   TerraHold — Earth Module (ES Module)
   Loads a GLTF 3D Earth model and provides
   smooth position, scale, and rotation controls.
   ============================================ */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

class Earth {
    constructor() {
        this.group = new THREE.Group();
        this.model = null;
        this.loaded = false;

        // Smooth interpolation targets
        this.targetPosition = new THREE.Vector3(0, 0, 0);
        this.currentPosition = new THREE.Vector3(0, 0, 0);
        this.targetScale = 1.0;
        this.currentScale = 1.0;

        // Rotation
        this.autoRotateSpeed = 0.003;
        this.velocityRotX = 0;
        this.velocityRotY = 0;

        // Atmosphere
        this.atmosphere = null;
    }

    async load(scene, onProgress) {
        const loader = new GLTFLoader();
        const textureLoader = new THREE.TextureLoader();

        return new Promise((resolve, reject) => {
            // Pre-load the Earth texture manually
            const earthTexture = textureLoader.load('earth/textures/Material.002_diffuse.jpeg');
            earthTexture.colorSpace = THREE.SRGBColorSpace;
            earthTexture.flipY = false; // GLTF textures don't flip Y

            loader.load(
                'earth/scene.gltf',
                (gltf) => {
                    this.model = gltf.scene;

                    // Apply the texture manually to all meshes
                    // (because KHR_materials_pbrSpecularGlossiness is deprecated)
                    this.model.traverse((child) => {
                        if (child.isMesh) {
                            child.material = new THREE.MeshStandardMaterial({
                                map: earthTexture,
                                roughness: 0.7,
                                metalness: 0.0,
                            });
                            child.material.needsUpdate = true;
                        }
                    });

                    // Normalize scale to fit nicely on screen
                    const box = new THREE.Box3().setFromObject(this.model);
                    const size = box.getSize(new THREE.Vector3());
                    const maxDim = Math.max(size.x, size.y, size.z);
                    const desiredSize = 200;
                    const scaleFactor = desiredSize / maxDim;

                    this.model.scale.setScalar(scaleFactor);

                    // Center the model
                    const center = box.getCenter(new THREE.Vector3());
                    this.model.position.sub(center.multiplyScalar(scaleFactor));

                    this.group.add(this.model);

                    // Add atmosphere glow
                    this._createAtmosphere(desiredSize / 2);

                    scene.add(this.group);

                    // Start visible, centered on screen
                    this.group.visible = true;
                    this.loaded = true;

                    console.log('✅ Earth GLTF model loaded with textures');
                    resolve();
                },
                (progress) => {
                    if (progress.total > 0) {
                        const pct = Math.round((progress.loaded / progress.total) * 100);
                        if (onProgress) onProgress(pct);
                    }
                },
                (error) => {
                    console.error('❌ Error loading Earth model:', error);
                    reject(error);
                }
            );
        });
    }

    _createAtmosphere(radius) {
        const atmosphereGeometry = new THREE.SphereGeometry(radius * 1.15, 48, 48);
        const atmosphereMaterial = new THREE.ShaderMaterial({
            vertexShader: `
                varying vec3 vNormal;
                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                varying vec3 vNormal;
                void main() {
                    float intensity = pow(0.6 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.0);
                    gl_FragColor = vec4(0.3, 0.6, 1.0, 0.8) * intensity;
                }
            `,
            blending: THREE.AdditiveBlending,
            side: THREE.BackSide,
            transparent: true,
            depthWrite: false,
        });
        this.atmosphere = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);
        this.group.add(this.atmosphere);
    }

    setPosition(x, y, z = 0) {
        this.targetPosition.set(x, y, z);
    }

    setScale(scale) {
        this.targetScale = Math.max(0.2, Math.min(4.0, scale));
    }

    addRotation(dx, dy) {
        this.velocityRotX += dx;
        this.velocityRotY += dy;
    }

    update(dt) {
        if (!this.loaded) return;

        // Smooth position lerp
        this.currentPosition.lerp(this.targetPosition, 0.1);
        this.group.position.copy(this.currentPosition);

        // Smooth scale lerp
        this.currentScale += (this.targetScale - this.currentScale) * 0.08;
        this.group.scale.setScalar(this.currentScale);

        // Auto rotation
        if (this.model) {
            this.model.rotation.y += this.autoRotateSpeed;
        }

        // Manual rotation with velocity
        if (this.model) {
            this.model.rotation.y += this.velocityRotY * 0.08;
            this.model.rotation.x += this.velocityRotX * 0.08;
        }

        // Dampen rotation velocity
        this.velocityRotX *= 0.92;
        this.velocityRotY *= 0.92;
        if (Math.abs(this.velocityRotX) < 0.0001) this.velocityRotX = 0;
        if (Math.abs(this.velocityRotY) < 0.0001) this.velocityRotY = 0;
    }

    isLoaded() {
        return this.loaded;
    }
}

export default Earth;
