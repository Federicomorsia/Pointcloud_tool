import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

const app = document.querySelector('[data-pointcloud-app]');

if (app && app.dataset.ready !== 'true') {
	app.dataset.ready = 'true';
	const defaultModelUrl = app.dataset.defaultModel ?? '';

	const stage = app.querySelector('[data-stage]');
	const canvas = app.querySelector('[data-pointcloud-canvas]');
	const uploadButton = app.querySelector('[data-action-upload]');
	const fileInput = app.querySelector('[data-file-input]');
	const dropzone = app.querySelector('[data-dropzone]');
	const densityInput = app.querySelector('[data-density]');
	const sizeInput = app.querySelector('[data-size]');
	const animationToggle = app.querySelector('[data-animate-toggle]');
	const rotationSpeedInput = app.querySelector('[data-rotation-speed]');
	const bloomToggle = app.querySelector('[data-bloom-toggle]');
	const bloomStrengthInput = app.querySelector('[data-bloom-strength]');
	const bloomRadiusInput = app.querySelector('[data-bloom-radius]');
	const bloomThresholdInput = app.querySelector('[data-bloom-threshold]');
	const densityValueElement = app.querySelector('[data-density-value]');
	const sizeValueElement = app.querySelector('[data-size-value]');
	const rotationSpeedValueElement = app.querySelector('[data-rotation-speed-value]');
	const bloomStrengthValueElement = app.querySelector('[data-bloom-strength-value]');
	const bloomRadiusValueElement = app.querySelector('[data-bloom-radius-value]');
	const bloomThresholdValueElement = app.querySelector('[data-bloom-threshold-value]');
	const backgroundInput = app.querySelector('[data-background]');
	const resetButton = app.querySelector('[data-reset-camera]');
	const exportButton = app.querySelector('[data-export-png]');
	const exportGifButton = app.querySelector('[data-export-gif]');
	const pointCountElement = app.querySelector('[data-point-count]');

	if (!stage || !canvas) {
		throw new Error('Pointcloud stage was not found in the page.');
	}

	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(45, stage.clientWidth / stage.clientHeight, 0.01, 200);
	camera.up.set(0, 0, 1);
	camera.position.set(0, 1.8, 5.5);

	const renderer = new THREE.WebGLRenderer({
		canvas,
		antialias: true,
		powerPreference: 'high-performance'
	});
	const isNarrowScreen = window.matchMedia('(max-width: 900px)').matches;
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, isNarrowScreen ? 1.5 : 2));
	renderer.setSize(stage.clientWidth, stage.clientHeight, false);
	renderer.setClearColor('#000000', 1);
	renderer.outputColorSpace = THREE.SRGBColorSpace;

	const gl = renderer.getContext();
	const pointSizeRange = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
	const maxPointSize = Number(pointSizeRange?.[1] ?? 64);

	const controls = new OrbitControls(camera, canvas);
	controls.enableDamping = true;
	controls.dampingFactor = 0.08;
	controls.minDistance = 0.2;
	controls.maxDistance = 40;

	scene.add(new THREE.HemisphereLight(0x666666, 0x333333, 0.4));

	const bloomComposer = new EffectComposer(renderer);
	bloomComposer.renderToScreen = false;
	const bloomRenderPass = new RenderPass(scene, camera);
	bloomComposer.addPass(bloomRenderPass);

	const bloomPass = new UnrealBloomPass(
		new THREE.Vector2(stage.clientWidth, stage.clientHeight),
		Number(bloomStrengthInput?.value ?? 1),
		Number(bloomRadiusInput?.value ?? 0.3),
		Number(bloomThresholdInput?.value ?? 0.15)
	);
	bloomComposer.addPass(bloomPass);

	const finalComposer = new EffectComposer(renderer);
	const finalRenderPass = new RenderPass(scene, camera);
	finalComposer.addPass(finalRenderPass);

	const bloomMixPass = new ShaderPass(
		new THREE.ShaderMaterial({
			uniforms: {
				baseTexture: { value: null },
				bloomTexture: { value: bloomComposer.renderTarget2.texture }
			},
			vertexShader: `
				varying vec2 vUv;

				void main() {
					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
				}
			`,
			fragmentShader: `
				uniform sampler2D baseTexture;
				uniform sampler2D bloomTexture;
				varying vec2 vUv;

				void main() {
					vec4 baseColor = texture2D(baseTexture, vUv);
					vec4 bloomColor = texture2D(bloomTexture, vUv);
					gl_FragColor = baseColor + bloomColor;
				}
			`
		}),
		'baseTexture'
	);
	finalComposer.addPass(bloomMixPass);

	let bloomEnabled = bloomToggle ? bloomToggle.checked : false;

	const pointContainer = new THREE.Group();
	scene.add(pointContainer);
	let autoRotateAroundZ = animationToggle ? animationToggle.checked : true;
	let zRotationSpeed = Number(rotationSpeedInput?.value ?? 0.6);
	const forceZUpOrientation = true;
	const BLOOM_LAYER = 1;
	const bloomLayer = new THREE.Layers();
	bloomLayer.set(BLOOM_LAYER);
	const darkMaterial = new THREE.MeshBasicMaterial({ color: 'black' });
	const hiddenMaterials = {};

	const uniforms = {
		uSize: { value: Number(sizeInput?.value ?? 0.03) },
		uProjectionScale: { value: 1 },
		uPointSizeCap: { value: Math.max(1, Math.min(6, maxPointSize)) }
	};

	const pointMaterial = new THREE.ShaderMaterial({
		uniforms,
		transparent: false,
		depthWrite: true,
		vertexShader: `
			uniform float uSize;
			uniform float uProjectionScale;
			uniform float uPointSizeCap;
			attribute vec3 color;
			varying vec3 vColor;

			void main() {
				vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
				float perspectiveAttenuation = uProjectionScale / max(0.0001, -mvPosition.z);
				float computedSize = uSize * perspectiveAttenuation;
				gl_PointSize = clamp(computedSize, 0.0, uPointSizeCap);
				gl_Position = projectionMatrix * mvPosition;
				vColor = color;
			}
		`,
		fragmentShader: `
			varying vec3 vColor;

			void main() {
				vec3 safeColor = max(vColor, vec3(0.0));
				vec3 displayColor = pow(safeColor, vec3(1.0 / 2.2));
				gl_FragColor = vec4(displayColor, 1.0);
			}
		`
	});

	const objLoader = new OBJLoader();
	const gltfLoader = new GLTFLoader();
	let points = null;
	let sourceModel = null;
	const geometryCache = new Map();
	let resizeRaf = 0;
	let animationFrameId = 0;
	let resizeObserver = null;

	const tempVec3A = new THREE.Vector3();
	const tempVec3B = new THREE.Vector3();
	const tempVec2A = new THREE.Vector2();
	const tempColor = new THREE.Color();
	const tempColorB = new THREE.Color();
	const tempColorC = new THREE.Color();
	const tempClearColor = new THREE.Color();
	let cachedGifWriter = null;

	const getGifWriter = async () => {
		if (cachedGifWriter) {
			return cachedGifWriter;
		}

		const module = await import('https://cdn.jsdelivr.net/npm/omggif@1.0.10/+esm');
		if (typeof module.GifWriter !== 'function') {
			throw new Error('GifWriter export not available');
		}

		cachedGifWriter = module.GifWriter;
		return cachedGifWriter;
	};

	const updatePointCount = (count) => {
		if (pointCountElement) {
			pointCountElement.textContent = `Points: ${count.toLocaleString()}`;
		}
	};

	const densityToStep = (densityValue) => {
		const density = Number(densityValue);
		return Math.max(1, 21 - density);
	};

	const syncControlValues = () => {
		if (densityInput && densityValueElement) {
			densityValueElement.textContent = String(Math.round(Number(densityInput.value)));
		}

		if (sizeInput && sizeValueElement) {
			sizeValueElement.textContent = Number(sizeInput.value).toFixed(3);
		}

		if (rotationSpeedInput && rotationSpeedValueElement) {
			rotationSpeedValueElement.textContent = Number(rotationSpeedInput.value).toFixed(2);
		}

		if (bloomStrengthInput && bloomStrengthValueElement) {
			bloomStrengthValueElement.textContent = Number(bloomStrengthInput.value).toFixed(2);
		}

		if (bloomRadiusInput && bloomRadiusValueElement) {
			bloomRadiusValueElement.textContent = Number(bloomRadiusInput.value).toFixed(2);
		}

		if (bloomThresholdInput && bloomThresholdValueElement) {
			bloomThresholdValueElement.textContent = Number(bloomThresholdInput.value).toFixed(2);
		}
	};

	const toFloat32 = (source) => (source instanceof Float32Array ? source.slice() : Float32Array.from(source));

	const normalizeModel = (rawModel) => {
		const positions = rawModel.positions;
		const normals = rawModel.normals;
		const colors = rawModel.colors;

		let minX = Infinity;
		let minY = Infinity;
		let minZ = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		let maxZ = -Infinity;

		for (let i = 0; i < positions.length; i += 3) {
			const x = positions[i];
			const y = positions[i + 1];
			const z = positions[i + 2];

			if (x < minX) minX = x;
			if (y < minY) minY = y;
			if (z < minZ) minZ = z;
			if (x > maxX) maxX = x;
			if (y > maxY) maxY = y;
			if (z > maxZ) maxZ = z;
		}

		const centerX = (minX + maxX) * 0.5;
		const centerY = (minY + maxY) * 0.5;
		const centerZ = (minZ + maxZ) * 0.5;
		const sizeX = Math.max(1e-6, maxX - minX);
		const sizeY = Math.max(1e-6, maxY - minY);
		const sizeZ = Math.max(1e-6, maxZ - minZ);
		const maxSize = Math.max(sizeX, sizeY, sizeZ);
		const scale = 2 / maxSize;

		let normalizedMinY = Infinity;
		let normalizedMaxY = -Infinity;

		for (let i = 0; i < positions.length; i += 3) {
			positions[i] = (positions[i] - centerX) * scale;
			positions[i + 1] = (positions[i + 1] - centerY) * scale;
			positions[i + 2] = (positions[i + 2] - centerZ) * scale;

			if (forceZUpOrientation) {
				const y = positions[i + 1];
				const z = positions[i + 2];
				positions[i + 1] = -z;
				positions[i + 2] = y;
			}

			const y = positions[i + 1];
			if (y < normalizedMinY) normalizedMinY = y;
			if (y > normalizedMaxY) normalizedMaxY = y;
		}

		for (let i = 0; i < positions.length; i += 3) {
			if (forceZUpOrientation) {
				const normalY = normals[i + 1];
				const normalZ = normals[i + 2];
				normals[i + 1] = -normalZ;
				normals[i + 2] = normalY;
			}

			tempVec3A.set(normals[i], normals[i + 1], normals[i + 2]).normalize();
			normals[i] = tempVec3A.x;
			normals[i + 1] = tempVec3A.y;
			normals[i + 2] = tempVec3A.z;
		}

		for (let i = 0; i < colors.length; i += 3) {
			let r = colors[i];
			let g = colors[i + 1];
			let b = colors[i + 2];

			if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
				r = 1;
				g = 1;
				b = 1;
			}

			r = THREE.MathUtils.clamp(r, 0, 1);
			g = THREE.MathUtils.clamp(g, 0, 1);
			b = THREE.MathUtils.clamp(b, 0, 1);

			colors[i] = r;
			colors[i + 1] = g;
			colors[i + 2] = b;
		}

		return {
			positions,
			normals,
			colors,
			pointCount: positions.length / 3
		};
	};

	const toRawModel = (positionsArray, normalsArray, colorsArray) =>
		normalizeModel({
			positions: toFloat32(positionsArray),
			normals: toFloat32(normalsArray),
			colors: toFloat32(colorsArray)
		});

	const readAttributeColor = (attribute, index, targetColor) => {
		const r = attribute.getX(index);
		const g = attribute.getY(index);
		const b = attribute.getZ(index);
		const sourceArray = attribute.array;

		const isUnsignedByte = sourceArray instanceof Uint8Array || sourceArray instanceof Uint8ClampedArray;
		const isUnsignedShort = sourceArray instanceof Uint16Array;
		const isSignedByte = sourceArray instanceof Int8Array;
		const isSignedShort = sourceArray instanceof Int16Array;
		const isIntegerTypedArray = isUnsignedByte || isUnsignedShort || isSignedByte || isSignedShort;

		let maxValue = 1;
		if (isUnsignedByte) {
			maxValue = 255;
		} else if (isUnsignedShort) {
			maxValue = 65535;
		} else if (isSignedByte) {
			maxValue = 127;
		} else if (isSignedShort) {
			maxValue = 32767;
		}

		if (!attribute.normalized) {
			if (isIntegerTypedArray && (r > 1 || g > 1 || b > 1)) {
				targetColor.setRGB(r / maxValue, g / maxValue, b / maxValue);
				return;
			}

			targetColor.setRGB(r, g, b);
			return;
		}

		targetColor.setRGB(r / maxValue, g / maxValue, b / maxValue);
	};

	const createTextureSampler = (texture) => {
		if (!texture?.image) {
			return null;
		}

		const image = texture.image;
		const width = image.width ?? image.videoWidth ?? 0;
		const height = image.height ?? image.videoHeight ?? 0;

		if (!width || !height) {
			return null;
		}

		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		if (!ctx) {
			return null;
		}

		ctx.drawImage(image, 0, 0, width, height);
		const pixelData = ctx.getImageData(0, 0, width, height).data;

		return (u, v, targetColor) => {
			tempVec2A.set(u, v);
			texture.transformUv(tempVec2A);

			const x = Math.min(width - 1, Math.max(0, Math.floor(tempVec2A.x * (width - 1))));
			const y = Math.min(height - 1, Math.max(0, Math.floor(tempVec2A.y * (height - 1))));
			const offset = (y * width + x) * 4;

			targetColor.setRGB(
				pixelData[offset] / 255,
				pixelData[offset + 1] / 255,
				pixelData[offset + 2] / 255
			);

			if (texture.colorSpace === THREE.SRGBColorSpace) {
				targetColor.convertSRGBToLinear();
			}
		};
	};

	const clearGeometryCache = () => {
		for (const cachedGeometry of geometryCache.values()) {
			cachedGeometry.dispose();
		}
		geometryCache.clear();
	};

	const darkenNonBloomed = (object3D) => {
		if ((object3D.isPoints || object3D.isMesh) && !bloomLayer.test(object3D.layers)) {
			hiddenMaterials[object3D.uuid] = object3D.material;
			object3D.material = darkMaterial;
		}
	};

	const restoreDarkenedMaterials = (object3D) => {
		if (hiddenMaterials[object3D.uuid]) {
			object3D.material = hiddenMaterials[object3D.uuid];
			delete hiddenMaterials[object3D.uuid];
		}
	};

	const extractRawModelDataFromObject = (object3D) => {
		object3D.updateMatrixWorld(true);

		const positions = [];
		const normals = [];
		const colors = [];
		const sampledPosition = new THREE.Vector3();
		const sampledNormal = new THREE.Vector3();
		const sampledVertexColor = new THREE.Color(1, 1, 1);
		const sampledUv = new THREE.Vector2();

		object3D.traverse((child) => {
			if (!child.isMesh || !child.geometry?.attributes?.position) {
				return;
			}

			const geometry = child.geometry;
			const baseCount = geometry.index ? geometry.index.count : geometry.attributes.position.count;
			const sampleCount = Math.min(180000, Math.max(3500, Math.round(baseCount * 1.2)));

			const material = Array.isArray(child.material) ? child.material[0] : child.material;
			const materialColor = material?.color ? material.color.clone() : new THREE.Color(1, 1, 1);
			const useVertexColors = Boolean(material?.vertexColors && geometry.getAttribute('color'));
			const uvAttribute = geometry.getAttribute('uv');
			const textureSampler = uvAttribute ? createTextureSampler(material?.map) : null;
			const normalMatrix = new THREE.Matrix3().getNormalMatrix(child.matrixWorld);

			const sampler = new MeshSurfaceSampler(child).build();

			for (let i = 0; i < sampleCount; i += 1) {
				sampledUv.set(0, 0);
				sampledVertexColor.setRGB(1, 1, 1);
				sampler.sample(sampledPosition, sampledNormal, sampledVertexColor, sampledUv);

				sampledPosition.applyMatrix4(child.matrixWorld);
				sampledNormal.applyMatrix3(normalMatrix).normalize();

				tempColor.copy(materialColor);
				let hasTextureSample = false;

				if (textureSampler && uvAttribute) {
					textureSampler(sampledUv.x, sampledUv.y, tempColorB);
					const texLuma = tempColorB.r * 0.2126 + tempColorB.g * 0.7152 + tempColorB.b * 0.0722;
					if (texLuma > 0.001) {
						tempColor.multiply(tempColorB);
						hasTextureSample = true;
					}
				}

				if (useVertexColors) {
					tempColor.multiply(sampledVertexColor);
				}

				const luma = tempColor.r * 0.2126 + tempColor.g * 0.7152 + tempColor.b * 0.0722;
				if (luma < 0.001 && hasTextureSample) {
					tempColor.copy(tempColorB);
				}

				positions.push(sampledPosition.x, sampledPosition.y, sampledPosition.z);
				normals.push(sampledNormal.x, sampledNormal.y, sampledNormal.z);
				colors.push(tempColor.r, tempColor.g, tempColor.b);
			}
		});

		if (positions.length === 0) {
			throw new Error('The model has no valid mesh surfaces to sample.');
		}

		return toRawModel(positions, normals, colors);
	};

	const createGeometryFromRaw = (rawModel, step) => {
		const total = rawModel.pointCount;
		const sampledCount = Math.ceil(total / step);
		const sampledPositions = new Float32Array(sampledCount * 3);
		const sampledNormals = new Float32Array(sampledCount * 3);
		const sampledColors = new Float32Array(sampledCount * 3);

		let write = 0;
		for (let i = 0; i < total; i += step) {
			const source = i * 3;
			const target = write * 3;

			sampledPositions[target] = rawModel.positions[source];
			sampledPositions[target + 1] = rawModel.positions[source + 1];
			sampledPositions[target + 2] = rawModel.positions[source + 2];

			sampledNormals[target] = rawModel.normals[source];
			sampledNormals[target + 1] = rawModel.normals[source + 1];
			sampledNormals[target + 2] = rawModel.normals[source + 2];

			sampledColors[target] = rawModel.colors[source];
			sampledColors[target + 1] = rawModel.colors[source + 1];
			sampledColors[target + 2] = rawModel.colors[source + 2];

			write += 1;
		}

		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(sampledPositions, 3));
		geometry.setAttribute('normal', new THREE.BufferAttribute(sampledNormals, 3));
		geometry.setAttribute('color', new THREE.BufferAttribute(sampledColors, 3));
		geometry.computeBoundingSphere();
		return geometry;
	};

	const frameObjectInView = (object3D) => {
		const box = new THREE.Box3().setFromObject(object3D);
		const size = box.getSize(new THREE.Vector3());
		const center = box.getCenter(new THREE.Vector3());
		const maxDim = Math.max(size.x, size.y, size.z, 1);

		const fov = THREE.MathUtils.degToRad(camera.fov);
		let distance = Math.abs((maxDim / 2) / Math.tan(fov / 2));
		distance *= 1.8;

		camera.position.set(center.x, center.y - distance, center.z + maxDim * 0.15);
		controls.target.copy(center);
		camera.near = maxDim / 200;
		camera.far = maxDim * 200;
		camera.updateProjectionMatrix();
		controls.update();
	};

	const getGeometryForStep = (step) => {
		let geometry = geometryCache.get(step);
		if (geometry) {
			return geometry;
		}

		geometry = createGeometryFromRaw(sourceModel, step);
		geometryCache.set(step, geometry);
		return geometry;
	};

	const setPointsFromRawModel = ({ frame = false } = {}) => {
		if (!sourceModel) {
			return;
		}

		const step = densityToStep(densityInput?.value ?? 8);
		const geometry = getGeometryForStep(step);

		if (points) {
			points.geometry = geometry;
		} else {
			points = new THREE.Points(geometry, pointMaterial);
			points.layers.enable(BLOOM_LAYER);
			pointContainer.add(points);
		}

		updatePointCount(geometry.attributes.position.count);

		if (frame) {
			if (points) {
				points.rotation.set(0, 0, 0);
			}
			frameObjectInView(points);
		}
	};

	const setDefaultModel = () => {
		console.log('Setting default model...');
		const geometry = new THREE.TorusKnotGeometry(1.25, 0.34, 700, 28);
		geometry.computeVertexNormals();
		const pointCount = geometry.attributes.position.count;
		const colors = new Float32Array(pointCount * 3);

		for (let i = 0; i < pointCount; i += 1) {
			tempVec3A.fromBufferAttribute(geometry.attributes.normal, i);
			const offset = i * 3;
			colors[offset] = 0.5 + tempVec3A.x * 0.5;
			colors[offset + 1] = 0.5 + tempVec3A.y * 0.5;
			colors[offset + 2] = 0.5 + tempVec3A.z * 0.5;
		}

		clearGeometryCache();
		sourceModel = toRawModel(geometry.attributes.position.array, geometry.attributes.normal.array, colors);
		geometry.dispose();
		console.log('Default model set, sourceModel:', sourceModel);
		setPointsFromRawModel({ frame: true });
	};

	const parseGlb = (arrayBuffer) =>
		new Promise((resolve, reject) => {
			gltfLoader.parse(arrayBuffer, '', resolve, reject);
		});

	const loadObject3D = (object3D) => {
		if (!object3D) {
			throw new Error('No valid scene found in file.');
		}

		clearGeometryCache();
		sourceModel = extractRawModelDataFromObject(object3D);
		setPointsFromRawModel({ frame: true });
	};

	const loadDefaultAssetModel = async () => {
		console.log('Loading default asset model from:', defaultModelUrl);
		if (!defaultModelUrl) {
			console.warn('No default model URL');
			return false;
		}

		try {
			const gltf = await gltfLoader.loadAsync(defaultModelUrl);
			console.log('GLTF loaded:', gltf);
			loadObject3D(gltf.scene || gltf.scenes?.[0]);
			return true;
		} catch (error) {
			console.warn('Unable to load default GLB from assets:', error);
			return false;
		}
	};

	const loadModelFile = async (file) => {
		if (!file) {
			return;
		}

		const lowerName = file.name.toLowerCase();
		const isObj = lowerName.endsWith('.obj');
		const isGlb = lowerName.endsWith('.glb');

		if (!isObj && !isGlb) {
			updatePointCount(0);
			if (pointCountElement) {
				pointCountElement.textContent = 'Points: invalid file format (use .obj or .glb)';
			}
			return;
		}

		let object3D = null;

		if (isObj) {
			const content = await file.text();
			object3D = objLoader.parse(content);
		} else {
			const gltf = await parseGlb(await file.arrayBuffer());
			object3D = gltf.scene || gltf.scenes?.[0];
		}

		loadObject3D(object3D);
	};

	const onResize = () => {
		const width = stage.clientWidth;
		const height = stage.clientHeight;
		camera.aspect = width / height;
		camera.updateProjectionMatrix();
		renderer.setSize(width, height, false);
		bloomComposer.setSize(width, height);
		bloomComposer.setPixelRatio(Math.min(window.devicePixelRatio, isNarrowScreen ? 1.5 : 2));
		finalComposer.setSize(width, height);
		finalComposer.setPixelRatio(Math.min(window.devicePixelRatio, isNarrowScreen ? 1.5 : 2));
		bloomPass.setSize(width, height);
		const fovRad = THREE.MathUtils.degToRad(camera.fov);
		uniforms.uProjectionScale.value = height / (2 * Math.tan(fovRad * 0.5));
	};

	const queueResize = () => {
		if (resizeRaf) {
			return;
		}

		resizeRaf = window.requestAnimationFrame(() => {
			resizeRaf = 0;
			onResize();
		});
	};

	const exportAsPNG = () => {
		if (!canvas || !renderer) {
			return;
		}

		// Salva lo stato attuale del rendering
		const previousClearColor = new THREE.Color();
		renderer.getClearColor(previousClearColor);
		const previousClearAlpha = renderer.getClearAlpha();

		// Imposta il clear color con alpha=0 per la trasparenza
		renderer.setClearColor(0x000000, 0);

		// Rendi la scena con sfondo trasparente
		if (bloomEnabled) {
			scene.traverse(darkenNonBloomed);
			bloomComposer.render();
			scene.traverse(restoreDarkenedMaterials);
			finalComposer.render();
		} else {
			renderer.render(scene, camera);
		}

		// Estrai PNG dal canvas
		canvas.toBlob((blob) => {
			if (!blob) {
				return;
			}

			const url = URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = url;
			link.download = 'pointcloud-export.png';
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			URL.revokeObjectURL(url);

			// Ripristina il clear color originale
			renderer.setClearColor(previousClearColor, previousClearAlpha);

			// Rendi di nuovo con il colore originale
			if (bloomEnabled) {
				scene.traverse(darkenNonBloomed);
				bloomComposer.render();
				scene.traverse(restoreDarkenedMaterials);
				finalComposer.render();
			} else {
				renderer.render(scene, camera);
			}
		}, 'image/png');
	};

	const exportAsGIF = async () => {
		if (!canvas || !renderer || !points) {
			console.error('Cannot export GIF: missing canvas, renderer or points');
			return;
		}

		let GifWriterCtor = null;
		try {
			GifWriterCtor = await getGifWriter();
		} catch (error) {
			console.error('Unable to load GIF encoder:', error);
			alert('GIF encoder unavailable. Model rendering is still active.');
			return;
		}

		console.log('Starting GIF export with omggif...');

		// Disable button during export.
		if (exportGifButton) {
			exportGifButton.disabled = true;
			exportGifButton.textContent = 'Exporting... 0%';
		}

		// Save current rendering state.
		const previousAutoRotate = autoRotateAroundZ;
		const previousClearColor = new THREE.Color();
		renderer.getClearColor(previousClearColor);
		const previousClearAlpha = renderer.getClearAlpha();
		const previousRotationZ = points.rotation.z;

		const gifWidth = canvas.width;
		const gifHeight = canvas.height;
		const totalFrames = 24;
		const frameDelayCentiseconds = 4; // ~25 FPS

		const captureCanvas = document.createElement('canvas');
		captureCanvas.width = gifWidth;
		captureCanvas.height = gifHeight;
		const captureContext = captureCanvas.getContext('2d', { willReadFrequently: true });

		if (!captureContext) {
			console.error('Cannot export GIF: 2D capture context unavailable');
			restoreState();
			return;
		}

		const makePalette332 = () => {
			const palette = new Array(256);
			for (let r = 0; r < 8; r++) {
				for (let g = 0; g < 8; g++) {
					for (let b = 0; b < 4; b++) {
						const index = (r << 5) | (g << 2) | b;
						const rr = Math.round((r / 7) * 255);
						const gg = Math.round((g / 7) * 255);
						const bb = Math.round((b / 3) * 255);
						palette[index] = (rr << 16) | (gg << 8) | bb;
					}
				}
			}
			return palette;
		};

		const rgbaToIndexed332 = (rgba) => {
			const pixelCount = gifWidth * gifHeight;
			const indexed = new Uint8Array(pixelCount);
			for (let i = 0, p = 0; p < pixelCount; i += 4, p++) {
				const r = rgba[i] >> 5;
				const g = rgba[i + 1] >> 5;
				const b = rgba[i + 2] >> 6;
				indexed[p] = (r << 5) | (g << 2) | b;
			}
			return indexed;
		};

		// Capture with fixed rotation steps to avoid jitter.
		renderer.setClearColor(0x000000, 1);
		autoRotateAroundZ = false;
		points.rotation.z = previousRotationZ;
		let frameCount = 0;
		const indexedFrames = [];
		const stepRotation = (Math.PI * 2) / totalFrames;

		const captureFrame = () => {
			if (frameCount > 0) {
				points.rotation.z += stepRotation;
			}
			controls.update();
			renderer.clear();

			if (bloomEnabled) {
				scene.traverse(darkenNonBloomed);
				bloomComposer.render();
				scene.traverse(restoreDarkenedMaterials);
				finalComposer.render();
			} else {
				renderer.render(scene, camera);
			}

			captureContext.clearRect(0, 0, gifWidth, gifHeight);
			captureContext.drawImage(canvas, 0, 0, gifWidth, gifHeight);
			const imageData = captureContext.getImageData(0, 0, gifWidth, gifHeight);
			indexedFrames.push(rgbaToIndexed332(imageData.data));

			frameCount++;

			const percent = Math.round((frameCount / totalFrames) * 100);
			if (exportGifButton) {
				exportGifButton.textContent = `Exporting... ${percent}%`;
			}
			console.log(`Frame ${frameCount}/${totalFrames}`);

			if (frameCount < totalFrames) {
				requestAnimationFrame(captureFrame);
			} else {
				encodeAndDownload(indexedFrames, makePalette332());
			}
		};

		const encodeAndDownload = (frames, palette) => {
			try {
				const estimatedBytes = Math.max(1024 * 1024, gifWidth * gifHeight * frames.length * 2);
				const output = new Uint8Array(estimatedBytes);
				const writer = new GifWriterCtor(output, gifWidth, gifHeight, { palette, loop: 0 });

				for (let i = 0; i < frames.length; i++) {
					writer.addFrame(0, 0, gifWidth, gifHeight, frames[i], {
						delay: frameDelayCentiseconds,
						disposal: 1
					});
				}

				const gifLength = writer.end();
				const gifBytes = output.slice(0, gifLength);
				const blob = new Blob([gifBytes], { type: 'image/gif' });
				downloadGIF(blob);
			} catch (error) {
				console.error('GIF encoding failed:', error);
				restoreState();
			}
		};

		const downloadGIF = (blob) => {
			const url = URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = url;
			link.download = 'pointcloud.gif';
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			URL.revokeObjectURL(url);
			restoreState();
		};

		const restoreState = () => {
			autoRotateAroundZ = previousAutoRotate;
			points.rotation.z = previousRotationZ;
			renderer.setClearColor(previousClearColor, previousClearAlpha);
			renderer.clear();

			if (exportGifButton) {
				exportGifButton.disabled = false;
				exportGifButton.textContent = 'Export GIF';
			}

			// Rendi di nuovo
			if (bloomEnabled) {
				scene.traverse(darkenNonBloomed);
				bloomComposer.render();
				scene.traverse(restoreDarkenedMaterials);
				finalComposer.render();
			} else {
				renderer.render(scene, camera);
			}
		};

		requestAnimationFrame(captureFrame);
	};

	uploadButton?.addEventListener('click', () => fileInput?.click());
	dropzone?.addEventListener('click', () => fileInput?.click());

	fileInput?.addEventListener('change', async (event) => {
		const target = event.target;
		const file = target.files?.[0];
		if (!file) {
			return;
		}

		try {
			await loadModelFile(file);
		} catch {
			if (pointCountElement) {
				pointCountElement.textContent = 'Points: unable to parse model';
			}
		}
	});

	dropzone?.addEventListener('dragover', (event) => {
		event.preventDefault();
		dropzone.classList.add('drag-over');
	});

	dropzone?.addEventListener('dragleave', () => {
		dropzone.classList.remove('drag-over');
	});

	dropzone?.addEventListener('drop', async (event) => {
		event.preventDefault();
		dropzone.classList.remove('drag-over');

		const file = event.dataTransfer?.files?.[0];
		if (!file) {
			return;
		}

		try {
			await loadModelFile(file);
		} catch {
			if (pointCountElement) {
				pointCountElement.textContent = 'Points: unable to parse model';
			}
		}
	});

	densityInput?.addEventListener('input', () => {
		syncControlValues();
		setPointsFromRawModel();
	});

	sizeInput?.addEventListener('input', () => {
		uniforms.uSize.value = Number(sizeInput.value);
		syncControlValues();
	});

	animationToggle?.addEventListener('change', () => {
		autoRotateAroundZ = animationToggle.checked;
	});

	rotationSpeedInput?.addEventListener('input', () => {
		zRotationSpeed = Number(rotationSpeedInput.value);
		syncControlValues();
	});

	bloomToggle?.addEventListener('change', () => {
		bloomEnabled = bloomToggle.checked;
	});

	bloomStrengthInput?.addEventListener('input', () => {
		bloomPass.strength = Number(bloomStrengthInput.value);
		syncControlValues();
	});

	bloomRadiusInput?.addEventListener('input', () => {
		bloomPass.radius = Number(bloomRadiusInput.value);
		syncControlValues();
	});

	bloomThresholdInput?.addEventListener('input', () => {
		bloomPass.threshold = Number(bloomThresholdInput.value);
		syncControlValues();
	});

	backgroundInput?.addEventListener('input', () => {
		renderer.setClearColor(backgroundInput.value, 1);
	});

	resetButton?.addEventListener('click', () => {
		if (points) {
			frameObjectInView(points);
		}
	});

	exportButton?.addEventListener('click', exportAsPNG);

	exportGifButton?.addEventListener('click', exportAsGIF);

	window.addEventListener('resize', queueResize);

	if ('ResizeObserver' in window) {
		resizeObserver = new ResizeObserver(() => {
			queueResize();
		});
		resizeObserver.observe(stage);
	}

	const clock = new THREE.Clock();

	const animateZRotation = (deltaSeconds) => {
		if (!autoRotateAroundZ || !points) {
			return;
		}

		points.rotation.z += deltaSeconds * zRotationSpeed;
	};

	const render = () => {
		const delta = clock.getDelta();
		animateZRotation(delta);
		controls.update();
		if (bloomEnabled) {
			const previousClearAlpha = renderer.getClearAlpha();
			renderer.getClearColor(tempClearColor);
			renderer.setClearColor(0x000000, 1);

			scene.traverse(darkenNonBloomed);
			bloomComposer.render();
			scene.traverse(restoreDarkenedMaterials);

			renderer.setClearColor(tempClearColor, previousClearAlpha);
			finalComposer.render();
		} else {
			renderer.render(scene, camera);
		}
		animationFrameId = requestAnimationFrame(render);
	};

	const onVisibilityChange = () => {
		if (document.hidden && animationFrameId) {
			cancelAnimationFrame(animationFrameId);
			animationFrameId = 0;
			return;
		}

		if (!document.hidden && animationFrameId === 0) {
			clock.getDelta();
			render();
		}
	};

	document.addEventListener('visibilitychange', onVisibilityChange);

	const cleanup = () => {
		window.removeEventListener('resize', queueResize);
		document.removeEventListener('visibilitychange', onVisibilityChange);
		if (resizeObserver) {
			resizeObserver.disconnect();
		}
		if (animationFrameId) {
			cancelAnimationFrame(animationFrameId);
			animationFrameId = 0;
		}
		clearGeometryCache();
		pointMaterial.dispose();
		renderer.dispose();
	};

	window.addEventListener('beforeunload', cleanup, { once: true });

	queueResize();
	syncControlValues();
	render();

	const withTimeout = (promise, timeoutMs) =>
		Promise.race([
			promise,
			new Promise((resolve) => {
				window.setTimeout(() => resolve(false), timeoutMs);
			})
		]);

	const initializeModel = async () => {
		console.log('Initializing model...');
		let loadedDefault = false;

		try {
			loadedDefault = await withTimeout(loadDefaultAssetModel(), 10000);
		} catch (error) {
			console.warn('Default asset load failed unexpectedly:', error);
		}

		console.log('loadedDefault:', loadedDefault);
		if (!loadedDefault) {
			console.log('Loading fallback default model');
			try {
				setDefaultModel();
			} catch (error) {
				console.error('Fallback model creation failed:', error);
				updatePointCount(0);
				if (pointCountElement) {
					pointCountElement.textContent = 'Points: unable to initialize model';
				}
			}
		}
	};

	console.log('Calling initializeModel...');
	initializeModel();
}
