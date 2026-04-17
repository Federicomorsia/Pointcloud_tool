# Pointcloud Tool (Astro + Three.js)

Questo progetto include:

- una web app pronta all'uso (UI Astro)
- un engine riusabile indipendente dalla UI, importabile in altri progetti

## Funzionalita principali

- Upload/drag-and-drop di file `.obj`, `.glb` e `.ply`
- Conversione mesh -> point cloud
- Controlli in tempo reale (densita, point size, esposizione, saturazione, tinta, background)
- Orbit controls + reset camera
- Bloom post-processing
- Export PNG e GIF
- Supporto multi-modello nel core engine con posizionamento casuale opzionale

## Struttura

- `src/components/PointcloudTool.astro`: UI dell'app web
- `src/scripts/pointcloud-tool.js`: adapter UI (usa il core engine)
- `src/scripts/pointcloud-engine.js`: core engine riusabile
- `src/scripts/index.js`: entrypoint export per uso esterno

## Avvio locale

1. `npm install`
2. `npm run dev`
3. Apri `http://localhost:4321`

Build produzione:

- `npm run build`
- `npm run preview`

## Riutilizzo in altri progetti

Se devi passare documentazione a un altro progetto che non puo' vedere questo repository, usa il documento dedicato:

- `README.external-integration.md`

L'engine e' esportato da:

- package root (`pointcloud-tool`)
- subpath (`pointcloud-tool/engine`)

Esempio base:

```js
import { createPointcloudEngine } from 'pointcloud-tool';

const canvas = document.querySelector('#pc-canvas');
const stage = document.querySelector('#pc-stage');

const engine = createPointcloudEngine({
	canvas,
	stage,
	autostart: true,
	pointDensity: 18,
	pointSize: 0.03,
	bloomEnabled: true,
	onStatsChange: ({ totalPoints, modelCount }) => {
		console.log('points:', totalPoints, 'models:', modelCount);
	}
});

await engine.addModelFromUrl('/models/chair.glb', { frame: true });
```

### Multi-modello con disposizione casuale

```js
await engine.addModelFromFile(fileA, {
	id: 'a',
	randomPlacement: true,
	randomPlacementRange: 12,
	frame: false
});

await engine.addModelFromFile(fileB, {
	id: 'b',
	randomPlacement: true,
	randomPlacementRange: 12,
	frame: false
});

engine.frameAllModels();
```

### API principali

- `start()` / `stop()` / `dispose()`
- `setOptions({...})`
- `addModelFromFile(file, options)`
- `addModelFromUrl(url, options)`
- `addModelFromRawModel(rawModel, options)`
- `removeModel(id)` / `clearModels()`
- `setModelTransform(id, transform)`
- `setActiveModel(id)`
- `frameModel(id)` / `frameAllModels()` / `resetCamera()`
- `exportAsPNG(options)` / `exportAsGIF(options)`
- `getStats()` / `getModelIds()`

## Note formato modelli

- Formati supportati: `.obj`, `.glb`, `.ply` (URL: anche `.gltf`)
- Per `.obj`/`.glb`/`.gltf` il loader campiona superfici mesh; per `.ply` usa direttamente la geometria dei punti/vertici
