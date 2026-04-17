import { createPointcloudEngine } from './pointcloud-engine.js';

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
	const brightnessInput = app.querySelector('[data-brightness]');
	const saturationInput = app.querySelector('[data-saturation]');
	const tintInput = app.querySelector('[data-tint]');
	const animationToggle = app.querySelector('[data-animate-toggle]');
	const rotationSpeedInput = app.querySelector('[data-rotation-speed]');
	const bloomToggle = app.querySelector('[data-bloom-toggle]');
	const bloomStrengthInput = app.querySelector('[data-bloom-strength]');
	const bloomRadiusInput = app.querySelector('[data-bloom-radius]');
	const bloomThresholdInput = app.querySelector('[data-bloom-threshold]');
	const densityValueElement = app.querySelector('[data-density-value]');
	const sizeValueElement = app.querySelector('[data-size-value]');
	const brightnessValueElement = app.querySelector('[data-brightness-value]');
	const saturationValueElement = app.querySelector('[data-saturation-value]');
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

	const setPointCountText = (text) => {
		if (pointCountElement) {
			pointCountElement.textContent = text;
		}
	};

	const setPointCountFromStats = (stats) => {
		if (!pointCountElement) {
			return;
		}

		const pointsLabel = `Points: ${stats.totalPoints.toLocaleString()}`;
		if (stats.modelCount > 1) {
			pointCountElement.textContent = `${pointsLabel} | Models: ${stats.modelCount}`;
			return;
		}

		pointCountElement.textContent = pointsLabel;
	};

	const engine = createPointcloudEngine({
		canvas,
		stage,
		autostart: false,
		pointDensity: Number(densityInput?.value ?? 18),
		pointSize: Number(sizeInput?.value ?? 0.03),
		exposure: Number(brightnessInput?.value ?? 1),
		saturation: Number(saturationInput?.value ?? 1),
		tint: tintInput?.value ?? '#ffffff',
		background: backgroundInput?.value ?? '#000000',
		autoRotate: animationToggle ? animationToggle.checked : true,
		rotationSpeed: Number(rotationSpeedInput?.value ?? 0.6),
		bloomEnabled: bloomToggle ? bloomToggle.checked : false,
		bloomStrength: Number(bloomStrengthInput?.value ?? 1),
		bloomRadius: Number(bloomRadiusInput?.value ?? 0.3),
		bloomThreshold: Number(bloomThresholdInput?.value ?? 0.15),
		onStatsChange: setPointCountFromStats
	});

	const syncControlValues = () => {
		if (densityInput && densityValueElement) {
			densityValueElement.textContent = String(Math.round(Number(densityInput.value)));
		}

		if (sizeInput && sizeValueElement) {
			sizeValueElement.textContent = Number(sizeInput.value).toFixed(3);
		}

		if (brightnessInput && brightnessValueElement) {
			brightnessValueElement.textContent = Number(brightnessInput.value).toFixed(2);
		}

		if (saturationInput && saturationValueElement) {
			saturationValueElement.textContent = Number(saturationInput.value).toFixed(2);
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

	const withTimeout = (promise, timeoutMs) =>
		Promise.race([
			promise,
			new Promise((resolve) => {
				window.setTimeout(() => resolve(false), timeoutMs);
			})
		]);

	const loadSingleModelFromFile = async (file) => {
		if (!file) {
			return;
		}

		const lowerName = file.name.toLowerCase();
		const supported =
			lowerName.endsWith('.obj') ||
			lowerName.endsWith('.glb') ||
			lowerName.endsWith('.ply');
		if (!supported) {
			setPointCountText('Points: invalid file format (use .obj, .glb or .ply)');
			return;
		}

		engine.clearModels();
		await engine.addModelFromFile(file, { frame: true });
	};

	const initializeModel = async () => {
		let loadedDefault = false;

		if (defaultModelUrl) {
			try {
				const result = await withTimeout(
					engine.addModelFromUrl(defaultModelUrl, { replace: true, frame: true }),
					10000
				);
				loadedDefault = Boolean(result);
			} catch {
				loadedDefault = false;
			}
		}

		if (!loadedDefault) {
			try {
				engine.addFallbackDemoModel({ replace: true, frame: true });
			} catch {
				setPointCountText('Points: unable to initialize model');
			}
		}
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
			await loadSingleModelFromFile(file);
		} catch {
			setPointCountText('Points: unable to parse model');
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
			await loadSingleModelFromFile(file);
		} catch {
			setPointCountText('Points: unable to parse model');
		}
	});

	densityInput?.addEventListener('input', () => {
		syncControlValues();
		engine.setOptions({ pointDensity: Number(densityInput.value) });
	});

	sizeInput?.addEventListener('input', () => {
		syncControlValues();
		engine.setOptions({ pointSize: Number(sizeInput.value) });
	});

	animationToggle?.addEventListener('change', () => {
		engine.setOptions({ autoRotate: animationToggle.checked });
	});

	rotationSpeedInput?.addEventListener('input', () => {
		syncControlValues();
		engine.setOptions({ rotationSpeed: Number(rotationSpeedInput.value) });
	});

	bloomToggle?.addEventListener('change', () => {
		engine.setOptions({ bloomEnabled: bloomToggle.checked });
	});

	bloomStrengthInput?.addEventListener('input', () => {
		syncControlValues();
		engine.setOptions({ bloomStrength: Number(bloomStrengthInput.value) });
	});

	bloomRadiusInput?.addEventListener('input', () => {
		syncControlValues();
		engine.setOptions({ bloomRadius: Number(bloomRadiusInput.value) });
	});

	bloomThresholdInput?.addEventListener('input', () => {
		syncControlValues();
		engine.setOptions({ bloomThreshold: Number(bloomThresholdInput.value) });
	});

	backgroundInput?.addEventListener('input', () => {
		engine.setOptions({ background: backgroundInput.value });
	});

	brightnessInput?.addEventListener('input', () => {
		syncControlValues();
		engine.setOptions({ exposure: Number(brightnessInput.value) });
	});

	saturationInput?.addEventListener('input', () => {
		syncControlValues();
		engine.setOptions({ saturation: Number(saturationInput.value) });
	});

	tintInput?.addEventListener('input', () => {
		engine.setOptions({ tint: tintInput.value });
	});

	resetButton?.addEventListener('click', () => {
		engine.resetCamera();
	});

	exportButton?.addEventListener('click', () => {
		engine.exportAsPNG({ filename: 'pointcloud-export.png', transparent: true });
	});

	exportGifButton?.addEventListener('click', async () => {
		if (!exportGifButton) {
			return;
		}

		exportGifButton.disabled = true;
		exportGifButton.textContent = 'Exporting...';

		try {
			await engine.exportAsGIF({ filename: 'pointcloud.gif', totalFrames: 600, fps: 20 });
		} catch {
			setPointCountText('Points: unable to export GIF');
		} finally {
			exportGifButton.disabled = false;
			exportGifButton.textContent = 'Export GIF';
		}
	});

	window.addEventListener(
		'beforeunload',
		() => {
			engine.dispose();
		},
		{ once: true }
	);

	syncControlValues();
	engine.start();
	initializeModel();
}
