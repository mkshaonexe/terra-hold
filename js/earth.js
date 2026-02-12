/* ============================================
   TerraHold — Earth Module
   Creates a photorealistic 3D Earth with
   textures, clouds, and atmosphere glow.
   ============================================ */

const EarthModule = (() => {
    let earthGroup = null;
    let earthMesh = null;
    let cloudMesh = null;
    let atmosphereMesh = null;
    let targetPosition = new THREE.Vector3(0, 0, 0);
    let targetScale = 1.0;
    let currentScale = 1.0;
    let autoRotateSpeed = 0.001;
    let manualRotationX = 0;
    let manualRotationY = 0;

    const BASE_RADIUS = 80;

    function create(scene) {
        earthGroup = new THREE.Group();
        earthGroup.visible = false;

        // Texture loader
        const textureLoader = new THREE.TextureLoader();
        textureLoader.crossOrigin = 'anonymous';

        // Earth textures from NASA/public sources
        const earthTexture = textureLoader.load(
            'https://unpkg.com/three-globe@2.31.1/example/img/earth-blue-marble.jpg'
        );
        const bumpTexture = textureLoader.load(
            'https://unpkg.com/three-globe@2.31.1/example/img/earth-topology.png'
        );

        // Earth sphere
        const earthGeometry = new THREE.SphereGeometry(BASE_RADIUS, 64, 64);
        const earthMaterial = new THREE.MeshPhongMaterial({
            map: earthTexture,
            bumpMap: bumpTexture,
            bumpScale: 1.5,
            shininess: 15,
        });
        earthMesh = new THREE.Mesh(earthGeometry, earthMaterial);
        earthGroup.add(earthMesh);

        // Cloud layer
        const cloudGeometry = new THREE.SphereGeometry(BASE_RADIUS * 1.02, 48, 48);
        const cloudTexture = textureLoader.load(
            'https://unpkg.com/three-globe@2.31.1/example/img/earth-water.png'
        );
        const cloudMaterial = new THREE.MeshPhongMaterial({
            map: cloudTexture,
            transparent: true,
            opacity: 0.15,
            depthWrite: false,
        });
        cloudMesh = new THREE.Mesh(cloudGeometry, cloudMaterial);
        earthGroup.add(cloudMesh);

        // Atmosphere glow
        const atmosphereGeometry = new THREE.SphereGeometry(BASE_RADIUS * 1.12, 48, 48);
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
                    float intensity = pow(0.65 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.0);
                    gl_FragColor = vec4(0.3, 0.6, 1.0, 1.0) * intensity;
                }
            `,
            blending: THREE.AdditiveBlending,
            side: THREE.BackSide,
            transparent: true,
            depthWrite: false,
        });
        atmosphereMesh = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);
        earthGroup.add(atmosphereMesh);

        scene.add(earthGroup);

        // Lighting
        const ambientLight = new THREE.AmbientLight(0x444466, 0.6);
        scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
        directionalLight.position.set(5, 3, 5);
        scene.add(directionalLight);

        const pointLight = new THREE.PointLight(0x4fc3f7, 0.4, 1000);
        pointLight.position.set(-3, -2, 4);
        scene.add(pointLight);

        return earthGroup;
    }

    function setPosition(x, y, z) {
        targetPosition.set(x, y, z || 0);
    }

    function setScale(scale) {
        targetScale = Math.max(0.3, Math.min(3.0, scale));
    }

    function addRotation(dx, dy) {
        manualRotationX += dx;
        manualRotationY += dy;
    }

    function show() {
        if (earthGroup) earthGroup.visible = true;
    }

    function hide() {
        if (earthGroup) earthGroup.visible = false;
    }

    function update(deltaTime) {
        if (!earthGroup) return;

        // Smooth position lerp
        earthGroup.position.lerp(targetPosition, 0.12);

        // Smooth scale lerp
        currentScale += (targetScale - currentScale) * 0.1;
        earthGroup.scale.setScalar(currentScale);

        // Auto rotation
        if (earthMesh) {
            earthMesh.rotation.y += autoRotateSpeed;
        }

        // Apply manual rotation
        if (earthMesh) {
            earthMesh.rotation.x += manualRotationX * 0.05;
            earthMesh.rotation.y += manualRotationY * 0.05;
        }

        // Cloud layer rotation (slightly different speed)
        if (cloudMesh) {
            cloudMesh.rotation.y += autoRotateSpeed * 0.6;
        }

        // Dampen manual rotation
        manualRotationX *= 0.9;
        manualRotationY *= 0.9;
    }

    function getGroup() {
        return earthGroup;
    }

    function isVisible() {
        return earthGroup ? earthGroup.visible : false;
    }

    return {
        create,
        setPosition,
        setScale,
        addRotation,
        show,
        hide,
        update,
        getGroup,
        isVisible,
    };
})();
