import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

const DEFAULT_OPTIONS = Object.freeze({
	pointDensity: 18,
	pointSize: 0.03,
	exposure: 1,
	saturation: 1,
	tint: '#ffffff',
	background: '#000000',
	autoRotate: true,
	rotationSpeed: 0.6,
	forceZUpOrientation: true,
	bloomEnabled: false,
	bloomStrength: 1,
	bloomRadius: 0.3,
	bloomThreshold: 0.15,
	narrowScreenMaxWidth: 900,
	maxPixelRatioWide: 2,
	maxPixelRatioNarrow: 1.5,
	randomPlacementRange: 8,
	randomPlacementPadding: 0.25,
	randomPlacementAttempts: 60,
	autostart: false,
	observeResize: true,
	suspendOnHidden: true
});

const BLOOM_LAYER = 1;
const DEFAULT_MODEL_ID_PREFIX = 'model';

const clampRange = (value, min, max) => THREE.MathUtils.clamp(Number(value), min, max);
const asNumber = (value, fallback) => {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
};

const vec3FromInput = (value, fallback = new THREE.Vector3()) => {
	if (!value) {
		return fallback.clone();
	}

	if (value.isVector3) {
		return value.clone();
	}

	if (Array.isArray(value) && value.length >= 3) {
		return new THREE.Vector3(asNumber(value[0], 0), asNumber(value[1], 0), asNumber(value[2], 0));
	}

	if (typeof value === 'object') {
		return new THREE.Vector3(
			asNumber(value.x, 0),
			asNumber(value.y, 0),
			asNumber(value.z, 0)
		);
	}

	return fallback.clone();
};

const toFloat32 = (source) => (source instanceof Float32Array ? source.slice() : Float32Array.from(source));

const createFallbackRawModel = (normalizeModel) => {
	const geometry = new THREE.TorusKnotGeometry(1.25, 0.34, 700, 28);
	geometry.computeVertexNormals();

	const pointCount = geometry.attributes.position.count;
	const colors = new Float32Array(pointCount * 3);
	const normal = new THREE.Vector3();

	for (let i = 0; i < pointCount; i += 1) {
		normal.fromBufferAttribute(geometry.attributes.normal, i);
		const offset = i * 3;
		colors[offset] = 0.5 + normal.x * 0.5;
		colors[offset + 1] = 0.5 + normal.y * 0.5;
		colors[offset + 2] = 0.5 + normal.z * 0.5;
	}

	const rawModel = normalizeModel({
		positions: toFloat32(geometry.attributes.position.array),
		normals: toFloat32(geometry.attributes.normal.array),
		colors
	});

	geometry.dispose();
	return rawModel;
};

export const createPointcloudEngine = (inputOptions = {}) => {
	const options = { ...DEFAULT_OPTIONS, ...inputOptions };
	const canvas = options.canvas;
	const stage = options.stage ?? canvas?.parentElement ?? null;

	if (!canvas || !stage) {
		throw new Error('Pointcloud engine requires both canvas and stage elements.');
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
		clampRange(asNumber(options.bloomStrength, DEFAULT_OPTIONS.bloomStrength), 0, 3),
		clampRange(asNumber(options.bloomRadius, DEFAULT_OPTIONS.bloomRadius), 0, 1),
		clampRange(asNumber(options.bloomThreshold, DEFAULT_OPTIONS.bloomThreshold), 0, 1)
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

	const bloomLayer = new THREE.Layers();
	bloomLayer.set(BLOOM_LAYER);
	const darkMaterial = new THREE.MeshBasicMaterial({ color: 'black' });
	const hiddenMaterials = {};

	const uniforms = {
		uSize: { value: asNumber(options.pointSize, DEFAULT_OPTIONS.pointSize) },
		uProjectionScale: { value: 1 },
		uPointSizeCap: { value: Math.max(1, Math.min(10, maxPointSize)) },
		uExposure: { value: asNumber(options.exposure, DEFAULT_OPTIONS.exposure) },
		uSaturation: { value: asNumber(options.saturation, DEFAULT_OPTIONS.saturation) },
		uTint: { value: new THREE.Color(options.tint ?? DEFAULT_OPTIONS.tint) }
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
			uniform float uExposure;
			uniform float uSaturation;
			uniform vec3 uTint;
			varying vec3 vColor;

			void main() {
				vec3 safeColor = max(vColor, vec3(0.0));
				vec3 tintedColor = safeColor * uTint;
				float luma = dot(tintedColor, vec3(0.2126, 0.7152, 0.0722));
				vec3 saturatedColor = mix(vec3(luma), tintedColor, uSaturation);
				vec3 displayColor = pow(max(saturatedColor * uExposure, vec3(0.0)), vec3(1.0 / 2.2));
				gl_FragColor = vec4(displayColor, 1.0);
			}
		`
	});

	const objLoader = new OBJLoader();
	const gltfLoader = new GLTFLoader();

	const pointContainer = new THREE.Group();
	scene.add(pointContainer);

	const tempVec3A = new THREE.Vector3();
	const tempVec3B = new THREE.Vector3();
	const tempVec2A = new THREE.Vector2();
	const tempColor = new THREE.Color();
	const tempColorB = new THREE.Color();
	const tempClearColor = new THREE.Color();

	let resizeRaf = 0;
	let animationFrameId = 0;
	let resizeObserver = null;
	let cachedGifWriter = null;
	let isRunning = false;
	let modelCounter = 0;
	const activeAnimations = [];

	const engineConfig = {
		pointDensity: Math.round(asNumber(options.pointDensity, DEFAULT_OPTIONS.pointDensity)),
		autoRotate: Boolean(options.autoRotate),
		rotationSpeed: asNumber(options.rotationSpeed, DEFAULT_OPTIONS.rotationSpeed),
		forceZUpOrientation: Boolean(options.forceZUpOrientation),
		bloomEnabled: Boolean(options.bloomEnabled),
		background: options.background ?? DEFAULT_OPTIONS.background,
		randomPlacementRange: asNumber(options.randomPlacementRange, DEFAULT_OPTIONS.randomPlacementRange),
		randomPlacementPadding: asNumber(options.randomPlacementPadding, DEFAULT_OPTIONS.randomPlacementPadding),
		randomPlacementAttempts: Math.max(10, Math.round(asNumber(options.randomPlacementAttempts, DEFAULT_OPTIONS.randomPlacementAttempts))),
		narrowScreenMaxWidth: asNumber(options.narrowScreenMaxWidth, DEFAULT_OPTIONS.narrowScreenMaxWidth),
		maxPixelRatioWide: asNumber(options.maxPixelRatioWide, DEFAULT_OPTIONS.maxPixelRatioWide),
		maxPixelRatioNarrow: asNumber(options.maxPixelRatioNarrow, DEFAULT_OPTIONS.maxPixelRatioNarrow)
	};

	const modelRecords = new Map();
	let activeModelId = null;

	const invokeStatsChange = () => {
		if (typeof options.onStatsChange !== 'function') {
			return;
		}

		let totalPoints = 0;
		for (const modelRecord of modelRecords.values()) {
			if (modelRecord.points?.geometry?.attributes?.position) {
				totalPoints += modelRecord.points.geometry.attributes.position.count;
			}
		}

		options.onStatsChange({
			totalPoints,
			modelCount: modelRecords.size,
			activeModelId
		});
	};

	const getPixelRatioCap = () => {
		const isNarrowScreen = window.matchMedia(`(max-width: ${engineConfig.narrowScreenMaxWidth}px)`).matches;
		return isNarrowScreen ? engineConfig.maxPixelRatioNarrow : engineConfig.maxPixelRatioWide;
	};

	const applyRendererBackground = () => {
		renderer.setClearColor(engineConfig.background, 1);
		stage.style.backgroundColor = engineConfig.background;
	};

	const updateProjectionScaleUniform = () => {
		const fovRad = THREE.MathUtils.degToRad(camera.fov);
		uniforms.uProjectionScale.value = stage.clientHeight / (2 * Math.tan(fovRad * 0.5));
	};

	const densityToStep = (densityValue) => {
		const density = Math.round(asNumber(densityValue, DEFAULT_OPTIONS.pointDensity));
		return Math.max(1, 21 - density);
	};

	const clearGeometryCacheForModel = (modelRecord) => {
		for (const cachedGeometry of modelRecord.geometryCache.values()) {
			cachedGeometry.dispose();
		}
		modelRecord.geometryCache.clear();
	};

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

		for (let i = 0; i < positions.length; i += 3) {
			positions[i] = (positions[i] - centerX) * scale;
			positions[i + 1] = (positions[i + 1] - centerY) * scale;
			positions[i + 2] = (positions[i + 2] - centerZ) * scale;

			if (engineConfig.forceZUpOrientation) {
				const y = positions[i + 1];
				const z = positions[i + 2];
				positions[i + 1] = -z;
				positions[i + 2] = y;
			}
		}

		for (let i = 0; i < positions.length; i += 3) {
			if (engineConfig.forceZUpOrientation) {
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

		const sampleCanvas = document.createElement('canvas');
		sampleCanvas.width = width;
		sampleCanvas.height = height;
		const context = sampleCanvas.getContext('2d', { willReadFrequently: true });
		if (!context) {
			return null;
		}

		context.drawImage(image, 0, 0, width, height);
		const pixelData = context.getImageData(0, 0, width, height).data;

		return (u, v, targetColor) => {
			tempVec2A.set(u, v);
			texture.transformUv(tempVec2A);

			const x = Math.min(width - 1, Math.max(0, Math.floor(tempVec2A.x * (width - 1))));
			const y = Math.min(height - 1, Math.max(0, Math.floor(tempVec2A.y * (height - 1))));
			const offset = (y * width + x) * 4;

			targetColor.setRGB(pixelData[offset] / 255, pixelData[offset + 1] / 255, pixelData[offset + 2] / 255);

			if (texture.colorSpace === THREE.SRGBColorSpace) {
				targetColor.convertSRGBToLinear();
			}
		};
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

	const getGeometryForStep = (modelRecord, step) => {
		let geometry = modelRecord.geometryCache.get(step);
		if (geometry) {
			return geometry;
		}

		geometry = createGeometryFromRaw(modelRecord.sourceModel, step);
		modelRecord.geometryCache.set(step, geometry);
		return geometry;
	};

	const updateModelGeometry = (modelRecord) => {
		const step = densityToStep(engineConfig.pointDensity);
		const geometry = getGeometryForStep(modelRecord, step);
		modelRecord.points.geometry = geometry;
	};

	const updateAllModelGeometries = () => {
		for (const modelRecord of modelRecords.values()) {
			updateModelGeometry(modelRecord);
		}
		invokeStatsChange();
	};

	const frameObjectInView = (object3D) => {
		const box = new THREE.Box3().setFromObject(object3D);
		if (box.isEmpty()) {
			return;
		}

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

	const frameAllModels = () => {
		if (pointContainer.children.length === 0) {
			return;
		}
		frameObjectInView(pointContainer);
	};

	const getWorldSphere = (modelRecord) => {
		const sphere = modelRecord.points.geometry.boundingSphere;
		if (!sphere) {
			modelRecord.points.geometry.computeBoundingSphere();
		}
		const effectiveSphere = modelRecord.points.geometry.boundingSphere;
		if (!effectiveSphere) {
			return null;
		}

		const worldCenter = effectiveSphere.center.clone().applyMatrix4(modelRecord.points.matrixWorld);
		const maxScale = Math.max(modelRecord.points.scale.x, modelRecord.points.scale.y, modelRecord.points.scale.z);
		return {
			center: worldCenter,
			radius: effectiveSphere.radius * maxScale
		};
	};

	const collidesWithExisting = (candidateRecord, padding) => {
		const candidateSphere = getWorldSphere(candidateRecord);
		if (!candidateSphere) {
			return false;
		}

		for (const existingRecord of modelRecords.values()) {
			if (existingRecord.id === candidateRecord.id) {
				continue;
			}

			const existingSphere = getWorldSphere(existingRecord);
			if (!existingSphere) {
				continue;
			}

			const distance = candidateSphere.center.distanceTo(existingSphere.center);
			const minDistance = candidateSphere.radius + existingSphere.radius + padding;
			if (distance < minDistance) {
				return true;
			}
		}

		return false;
	};

	const placeModelRandomly = (modelRecord, placementOptions = {}) => {
		const range = asNumber(placementOptions.range, engineConfig.randomPlacementRange);
		const padding = asNumber(placementOptions.padding, engineConfig.randomPlacementPadding);
		const attempts = Math.max(5, Math.round(asNumber(placementOptions.attempts, engineConfig.randomPlacementAttempts)));
		const rng = typeof placementOptions.random === 'function' ? placementOptions.random : Math.random;

		const previousPosition = modelRecord.points.position.clone();

		for (let attempt = 0; attempt < attempts; attempt += 1) {
			const x = (rng() * 2 - 1) * range;
			const y = (rng() * 2 - 1) * range;
			const z = (rng() * 2 - 1) * (range * 0.45);
			modelRecord.points.position.set(x, y, z);
			modelRecord.points.updateMatrixWorld(true);

			if (!collidesWithExisting(modelRecord, padding)) {
				return;
			}
		}

		modelRecord.points.position.copy(previousPosition);
		modelRecord.points.updateMatrixWorld(true);
	};

	const animateLoadingImplosion = (modelRecord, durationMs = 1000) => {
		const geometry = modelRecord.points.geometry;
		const positionAttr = geometry.attributes.position;
		const positionArray = positionAttr.array;
		const pointCount = positionAttr.count;

		// Clone delle posizioni finali
		const finalPositions = new Float32Array(positionArray.length);
		finalPositions.set(positionArray);

		// Generare posizioni casuali iniziali
		const startPositions = new Float32Array(positionArray.length);
		const randomRange = engineConfig.randomPlacementRange * 0.4;
		for (let i = 0; i < pointCount; i++) {
			const idx = i * 3;
			startPositions[idx] = (Math.random() * 2 - 1) * randomRange;
			startPositions[idx + 1] = (Math.random() * 2 - 1) * randomRange;
			startPositions[idx + 2] = (Math.random() * 2 - 1) * randomRange * 0.6;
		}

		// Copia le posizioni casuali al geometry per il frame iniziale
		positionArray.set(startPositions);
		positionAttr.needsUpdate = true;

		// Crea oggetto animazione
		const animation = {
			modelRecord,
			positionAttr,
			positionArray,
			finalPositions,
			startPositions,
			pointCount,
			duration: durationMs,
			startTime: performance.now()
		};

		activeAnimations.push(animation);
	};

	const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

	const updateAnimations = () => {
		const now = performance.now();
		
		for (let i = activeAnimations.length - 1; i >= 0; i--) {
			const anim = activeAnimations[i];
			const elapsed = now - anim.startTime;
			let progress = Math.min(1, elapsed / anim.duration);
			progress = easeOutCubic(progress);

			if (progress < 1) {
				// Interpola tra posizioni iniziali e finali
				for (let j = 0; j < anim.pointCount; j++) {
					const idx = j * 3;
					anim.positionArray[idx] = anim.startPositions[idx] + (anim.finalPositions[idx] - anim.startPositions[idx]) * progress;
					anim.positionArray[idx + 1] = anim.startPositions[idx + 1] + (anim.finalPositions[idx + 1] - anim.startPositions[idx + 1]) * progress;
					anim.positionArray[idx + 2] = anim.startPositions[idx + 2] + (anim.finalPositions[idx + 2] - anim.startPositions[idx + 2]) * progress;
				}
				anim.positionAttr.needsUpdate = true;
			} else {
				// Animazione completata - ripristina le posizioni finali
				anim.positionArray.set(anim.finalPositions);
				anim.positionAttr.needsUpdate = true;
				activeAnimations.splice(i, 1);
			}
		}
	};

	const ensureUniqueModelId = (preferredId) => {
		if (preferredId && !modelRecords.has(preferredId)) {
			return preferredId;
		}

		let candidate = `${DEFAULT_MODEL_ID_PREFIX}-${++modelCounter}`;
		while (modelRecords.has(candidate)) {
			candidate = `${DEFAULT_MODEL_ID_PREFIX}-${++modelCounter}`;
		}
		return candidate;
	};

	const addModelFromRawModel = (rawModel, addOptions = {}) => {
		if (addOptions.replace) {
			clearModels();
		}

		const modelId = ensureUniqueModelId(addOptions.id);
		const modelRecord = {
			id: modelId,
			sourceModel: rawModel,
			geometryCache: new Map(),
			points: new THREE.Points(createGeometryFromRaw(rawModel, densityToStep(engineConfig.pointDensity)), pointMaterial)
		};

		modelRecord.points.layers.enable(BLOOM_LAYER);
		pointContainer.add(modelRecord.points);
		modelRecord.geometryCache.set(densityToStep(engineConfig.pointDensity), modelRecord.points.geometry);
		modelRecords.set(modelId, modelRecord);
		activeModelId = modelId;

		if (addOptions.scale != null) {
			const scaleVec = vec3FromInput(addOptions.scale, new THREE.Vector3(1, 1, 1));
			modelRecord.points.scale.copy(scaleVec);
		}

		if (addOptions.rotation != null) {
			const rotationVec = vec3FromInput(addOptions.rotation, new THREE.Vector3(0, 0, 0));
			modelRecord.points.rotation.set(rotationVec.x, rotationVec.y, rotationVec.z);
		}

		if (addOptions.position != null) {
			const positionVec = vec3FromInput(addOptions.position, new THREE.Vector3(0, 0, 0));
			modelRecord.points.position.copy(positionVec);
		} else if (addOptions.randomPlacement) {
			placeModelRandomly(modelRecord, {
				range: addOptions.randomPlacementRange,
				padding: addOptions.randomPlacementPadding,
				attempts: addOptions.randomPlacementAttempts,
				random: addOptions.random
			});
		}

		modelRecord.points.updateMatrixWorld(true);

		if (addOptions.frame ?? modelRecords.size === 1) {
			frameAllModels();
		}

		// Avvia l'animazione di caricamento (implosion)
		const animationDuration = addOptions.loadingAnimationDuration ?? 1000; // 1 secondo di default
		if (animationDuration > 0) {
			animateLoadingImplosion(modelRecord, animationDuration);
		}

		invokeStatsChange();

		return {
			id: modelId,
			pointCount: modelRecord.points.geometry.attributes.position.count
		};
	};

	const parseGlb = (arrayBuffer) =>
		new Promise((resolve, reject) => {
			gltfLoader.parse(arrayBuffer, '', resolve, reject);
		});

	const loadObject3D = (object3D, loadOptions = {}) => {
		if (!object3D) {
			throw new Error('No valid scene found in file.');
		}

		const rawModel = extractRawModelDataFromObject(object3D);
		return addModelFromRawModel(rawModel, loadOptions);
	};

	const addModelFromFile = async (file, loadOptions = {}) => {
		if (!file) {
			throw new Error('No file provided.');
		}

		const lowerName = file.name.toLowerCase();
		const isObj = lowerName.endsWith('.obj');
		const isGlb = lowerName.endsWith('.glb');

		if (!isObj && !isGlb) {
			throw new Error('Unsupported file format. Use .obj or .glb');
		}

		if (isObj) {
			const content = await file.text();
			return loadObject3D(objLoader.parse(content), loadOptions);
		}

		const gltf = await parseGlb(await file.arrayBuffer());
		return loadObject3D(gltf.scene || gltf.scenes?.[0], loadOptions);
	};

	const addModelFromUrl = async (url, loadOptions = {}) => {
		if (!url) {
			throw new Error('A valid URL is required.');
		}

		const lowerUrl = url.toLowerCase();
		if (lowerUrl.endsWith('.obj')) {
			const response = await fetch(url);
			if (!response.ok) {
				throw new Error(`Unable to load OBJ: ${response.status}`);
			}
			const text = await response.text();
			return loadObject3D(objLoader.parse(text), loadOptions);
		}

		if (lowerUrl.endsWith('.glb') || lowerUrl.endsWith('.gltf')) {
			const gltf = await gltfLoader.loadAsync(url);
			return loadObject3D(gltf.scene || gltf.scenes?.[0], loadOptions);
		}

		throw new Error('Unsupported URL format. Use .obj, .glb or .gltf');
	};

	const removeModel = (id) => {
		const modelRecord = modelRecords.get(id);
		if (!modelRecord) {
			return false;
		}

		clearGeometryCacheForModel(modelRecord);
		pointContainer.remove(modelRecord.points);
		modelRecords.delete(id);
		if (activeModelId === id) {
			activeModelId = modelRecords.keys().next().value ?? null;
		}
		invokeStatsChange();
		return true;
	};

	const clearModels = () => {
		for (const modelRecord of modelRecords.values()) {
			clearGeometryCacheForModel(modelRecord);
			pointContainer.remove(modelRecord.points);
		}
		modelRecords.clear();
		activeModelId = null;
		invokeStatsChange();
	};

	const setActiveModel = (id) => {
		if (!modelRecords.has(id)) {
			return false;
		}
		activeModelId = id;
		invokeStatsChange();
		return true;
	};

	const frameModel = (id) => {
		const modelRecord = modelRecords.get(id);
		if (!modelRecord) {
			return false;
		}
		frameObjectInView(modelRecord.points);
		return true;
	};

	const setModelTransform = (id, transform = {}) => {
		const modelRecord = modelRecords.get(id);
		if (!modelRecord) {
			return false;
		}

		if (transform.position != null) {
			modelRecord.points.position.copy(vec3FromInput(transform.position, modelRecord.points.position));
		}

		if (transform.rotation != null) {
			const rotation = vec3FromInput(transform.rotation);
			modelRecord.points.rotation.set(rotation.x, rotation.y, rotation.z);
		}

		if (transform.scale != null) {
			modelRecord.points.scale.copy(vec3FromInput(transform.scale, modelRecord.points.scale));
		}

		modelRecord.points.updateMatrixWorld(true);
		return true;
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

	const renderScene = () => {
		if (engineConfig.bloomEnabled) {
			const previousClearAlpha = renderer.getClearAlpha();
			renderer.getClearColor(tempClearColor);
			renderer.setClearColor(0x000000, 1);

			scene.traverse(darkenNonBloomed);
			bloomComposer.render();
			scene.traverse(restoreDarkenedMaterials);

			renderer.setClearColor(tempClearColor, previousClearAlpha);
			finalComposer.render();
			return;
		}

		renderer.render(scene, camera);
	};

	const clock = new THREE.Clock();

	const renderLoop = () => {
		const delta = clock.getDelta();
		if (engineConfig.autoRotate) {
			pointContainer.rotation.z += delta * engineConfig.rotationSpeed;
		}
		controls.update();
		updateAnimations();
		renderScene();
		animationFrameId = requestAnimationFrame(renderLoop);
	};

	const onVisibilityChange = () => {
		if (!options.suspendOnHidden) {
			return;
		}

		if (document.hidden && animationFrameId) {
			cancelAnimationFrame(animationFrameId);
			animationFrameId = 0;
			return;
		}

		if (!document.hidden && isRunning && animationFrameId === 0) {
			clock.getDelta();
			renderLoop();
		}
	};

	const onResize = () => {
		const width = Math.max(1, stage.clientWidth);
		const height = Math.max(1, stage.clientHeight);
		camera.aspect = width / height;
		camera.updateProjectionMatrix();
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, getPixelRatioCap()));
		renderer.setSize(width, height, false);

		bloomComposer.setPixelRatio(Math.min(window.devicePixelRatio, getPixelRatioCap()));
		bloomComposer.setSize(width, height);
		finalComposer.setPixelRatio(Math.min(window.devicePixelRatio, getPixelRatioCap()));
		finalComposer.setSize(width, height);
		bloomPass.setSize(width, height);
		updateProjectionScaleUniform();
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

	const start = () => {
		if (isRunning) {
			return;
		}

		isRunning = true;
		clock.getDelta();
		renderLoop();
	};

	const stop = () => {
		isRunning = false;
		if (animationFrameId) {
			cancelAnimationFrame(animationFrameId);
			animationFrameId = 0;
		}
	};

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

	const exportAsPNG = ({ filename = 'pointcloud-export.png', transparent = true } = {}) => {
		const previousClearColor = new THREE.Color();
		renderer.getClearColor(previousClearColor);
		const previousClearAlpha = renderer.getClearAlpha();

		renderer.setClearColor(0x000000, transparent ? 0 : 1);
		renderScene();

		canvas.toBlob((blob) => {
			renderer.setClearColor(previousClearColor, previousClearAlpha);
			renderScene();
			if (!blob) {
				return;
			}

			const url = URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = url;
			link.download = filename;
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			URL.revokeObjectURL(url);
		}, 'image/png');
	};

	const exportAsGIF = async ({ filename = 'pointcloud.gif', totalFrames = 24, fps = 25 } = {}) => {
		if (modelRecords.size === 0) {
			throw new Error('Cannot export GIF: no models loaded.');
		}

		const GifWriterCtor = await getGifWriter();
		const gifWidth = canvas.width;
		const gifHeight = canvas.height;
		const frameDelayCentiseconds = Math.max(1, Math.round(100 / Math.max(1, fps)));

		const captureCanvas = document.createElement('canvas');
		captureCanvas.width = gifWidth;
		captureCanvas.height = gifHeight;
		const captureContext = captureCanvas.getContext('2d', { willReadFrequently: true });
		if (!captureContext) {
			throw new Error('2D capture context unavailable.');
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

		const previousAutoRotate = engineConfig.autoRotate;
		const previousClearColor = new THREE.Color();
		renderer.getClearColor(previousClearColor);
		const previousClearAlpha = renderer.getClearAlpha();
		const previousContainerRotation = pointContainer.rotation.z;

		engineConfig.autoRotate = false;
		pointContainer.rotation.z = previousContainerRotation;
		renderer.setClearColor(0x000000, 1);

		try {
			const indexedFrames = [];
			const stepRotation = (Math.PI * 2) / Math.max(1, totalFrames);

			for (let frame = 0; frame < totalFrames; frame += 1) {
				if (frame > 0) {
					pointContainer.rotation.z += stepRotation;
				}
				controls.update();
				renderScene();
				captureContext.clearRect(0, 0, gifWidth, gifHeight);
				captureContext.drawImage(canvas, 0, 0, gifWidth, gifHeight);
				const imageData = captureContext.getImageData(0, 0, gifWidth, gifHeight);
				indexedFrames.push(rgbaToIndexed332(imageData.data));
			}

			const estimatedBytes = Math.max(1024 * 1024, gifWidth * gifHeight * indexedFrames.length * 2);
			const output = new Uint8Array(estimatedBytes);
			const writer = new GifWriterCtor(output, gifWidth, gifHeight, { palette: makePalette332(), loop: 0 });

			for (const frame of indexedFrames) {
				writer.addFrame(0, 0, gifWidth, gifHeight, frame, {
					delay: frameDelayCentiseconds,
					disposal: 1
				});
			}

			const gifLength = writer.end();
			const gifBytes = output.slice(0, gifLength);
			const blob = new Blob([gifBytes], { type: 'image/gif' });
			const url = URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = url;
			link.download = filename;
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			URL.revokeObjectURL(url);
		} finally {
			engineConfig.autoRotate = previousAutoRotate;
			pointContainer.rotation.z = previousContainerRotation;
			renderer.setClearColor(previousClearColor, previousClearAlpha);
			renderScene();
		}
	};

	const setOptions = (nextOptions = {}) => {
		if (nextOptions.pointDensity != null) {
			engineConfig.pointDensity = Math.round(asNumber(nextOptions.pointDensity, engineConfig.pointDensity));
			updateAllModelGeometries();
		}

		if (nextOptions.pointSize != null) {
			uniforms.uSize.value = asNumber(nextOptions.pointSize, uniforms.uSize.value);
		}

		if (nextOptions.exposure != null) {
			uniforms.uExposure.value = asNumber(nextOptions.exposure, uniforms.uExposure.value);
		}

		if (nextOptions.saturation != null) {
			uniforms.uSaturation.value = asNumber(nextOptions.saturation, uniforms.uSaturation.value);
		}

		if (nextOptions.tint != null) {
			uniforms.uTint.value.set(nextOptions.tint);
		}

		if (nextOptions.background != null) {
			engineConfig.background = nextOptions.background;
			applyRendererBackground();
		}

		if (nextOptions.autoRotate != null) {
			engineConfig.autoRotate = Boolean(nextOptions.autoRotate);
		}

		if (nextOptions.rotationSpeed != null) {
			engineConfig.rotationSpeed = asNumber(nextOptions.rotationSpeed, engineConfig.rotationSpeed);
		}

		if (nextOptions.bloomEnabled != null) {
			engineConfig.bloomEnabled = Boolean(nextOptions.bloomEnabled);
		}

		if (nextOptions.bloomStrength != null) {
			bloomPass.strength = clampRange(asNumber(nextOptions.bloomStrength, bloomPass.strength), 0, 3);
		}

		if (nextOptions.bloomRadius != null) {
			bloomPass.radius = clampRange(asNumber(nextOptions.bloomRadius, bloomPass.radius), 0, 1);
		}

		if (nextOptions.bloomThreshold != null) {
			bloomPass.threshold = clampRange(asNumber(nextOptions.bloomThreshold, bloomPass.threshold), 0, 1);
		}

		if (nextOptions.randomPlacementRange != null) {
			engineConfig.randomPlacementRange = asNumber(nextOptions.randomPlacementRange, engineConfig.randomPlacementRange);
		}

		if (nextOptions.randomPlacementPadding != null) {
			engineConfig.randomPlacementPadding = asNumber(nextOptions.randomPlacementPadding, engineConfig.randomPlacementPadding);
		}
	};

	const getModelIds = () => Array.from(modelRecords.keys());

	const getStats = () => {
		let totalPoints = 0;
		for (const modelRecord of modelRecords.values()) {
			if (modelRecord.points?.geometry?.attributes?.position) {
				totalPoints += modelRecord.points.geometry.attributes.position.count;
			}
		}

		return {
			totalPoints,
			modelCount: modelRecords.size,
			activeModelId
		};
	};

	const addFallbackDemoModel = (addOptions = {}) => {
		const rawModel = createFallbackRawModel(normalizeModel);
		return addModelFromRawModel(rawModel, addOptions);
	};

	const dispose = () => {
		stop();
		window.removeEventListener('resize', queueResize);
		document.removeEventListener('visibilitychange', onVisibilityChange);
		if (resizeObserver) {
			resizeObserver.disconnect();
			resizeObserver = null;
		}
		if (resizeRaf) {
			cancelAnimationFrame(resizeRaf);
			resizeRaf = 0;
		}

		clearModels();
		pointMaterial.dispose();
		darkMaterial.dispose();
		bloomComposer.dispose();
		finalComposer.dispose();
		renderer.dispose();
	};

	window.addEventListener('resize', queueResize);
	document.addEventListener('visibilitychange', onVisibilityChange);

	if (options.observeResize && 'ResizeObserver' in window) {
		resizeObserver = new ResizeObserver(() => {
			queueResize();
		});
		resizeObserver.observe(stage);
	}

	applyRendererBackground();
	onResize();

	if (options.autostart) {
		start();
	}

	return {
		scene,
		camera,
		renderer,
		controls,
		start,
		stop,
		dispose,
		setOptions,
		getStats,
		getModelIds,
		setActiveModel,
		setModelTransform,
		frameModel,
		frameAllModels,
		resetCamera: frameAllModels,
		removeModel,
		clearModels,
		addModelFromFile,
		addModelFromUrl,
		addModelFromRawModel,
		loadObject3D,
		addFallbackDemoModel,
		exportAsPNG,
		exportAsGIF
	};
};

export default createPointcloudEngine;
