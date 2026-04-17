# Pointcloud Engine Integration Guide

This document is self-contained and is meant to be shared with external projects that cannot access this repository source code.

## What This Engine Does

The engine creates and renders one or more 3D pointcloud models in a web scene using Three.js.

Core capabilities:
- Load multiple models from local files (.obj, .glb, .ply) or URLs (.obj, .glb, .gltf, .ply)
- Convert mesh surfaces to dense pointcloud geometry
- Place models randomly in 3D space with basic overlap avoidance
- Orbit camera navigation and scene framing helpers
- Bloom post-processing
- PNG and GIF export
- Runtime option updates (density, point size, color controls, bloom, rotation)

## Public Entry Points

Import from package root:

```js
import { createPointcloudEngine } from 'pointcloud-tool';
```

Or import from explicit subpath:

```js
import { createPointcloudEngine } from 'pointcloud-tool/engine';
```

## Minimal Setup

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
  background: '#000000'
});

await engine.addModelFromUrl('/models/chair.glb', { frame: true });
```

## Multi-Model Usage Example

```js
await engine.addModelFromFile(fileA, {
  id: 'chair-1',
  randomPlacement: true,
  randomPlacementRange: 12,
  frame: false
});

await engine.addModelFromFile(fileB, {
  id: 'chair-2',
  randomPlacement: true,
  randomPlacementRange: 12,
  frame: false
});

engine.frameAllModels();
```

## API Reference

### Factory

createPointcloudEngine(options)

Required options:
- canvas: HTMLCanvasElement
- stage: HTMLElement (or inferred from canvas parent)

Common optional options:
- autostart: boolean
- pointDensity: number (1-20 practical range)
- pointSize: number
- exposure: number
- saturation: number
- tint: string color (hex)
- background: string color (hex)
- autoRotate: boolean
- rotationSpeed: number
- bloomEnabled: boolean
- bloomStrength: number (0-3)
- bloomRadius: number (0-1)
- bloomThreshold: number (0-1)
- randomPlacementRange: number
- randomPlacementPadding: number
- onStatsChange: function({ totalPoints, modelCount, activeModelId })

### Lifecycle

- start()
- stop()
- dispose()

### Runtime Options

- setOptions(partialOptions)

Supported runtime keys:
- pointDensity
- pointSize
- exposure
- saturation
- tint
- background
- autoRotate
- rotationSpeed
- bloomEnabled
- bloomStrength
- bloomRadius
- bloomThreshold
- randomPlacementRange
- randomPlacementPadding

### Model Loading

- addModelFromFile(file, options)
- addModelFromUrl(url, options)
- addModelFromRawModel(rawModel, options)
- loadObject3D(object3D, options)
- addFallbackDemoModel(options)

Model add options:
- id: string
- replace: boolean
- frame: boolean
- position: {x,y,z} | [x,y,z] | THREE.Vector3
- rotation: {x,y,z} | [x,y,z] | THREE.Vector3
- scale: {x,y,z} | [x,y,z] | THREE.Vector3
- randomPlacement: boolean
- randomPlacementRange: number
- randomPlacementPadding: number
- randomPlacementAttempts: number
- random: function returning number in [0, 1)

### Model Management

- removeModel(id)
- clearModels()
- setActiveModel(id)
- setModelTransform(id, transform)
- getModelIds()
- getStats()

### Camera Helpers

- frameModel(id)
- frameAllModels()
- resetCamera() (alias of frameAllModels)

### Export

- exportAsPNG({ filename, transparent })
- exportAsGIF({ filename, totalFrames, fps })

### Exposed Engine Objects

The returned engine object also exposes:
- scene
- camera
- renderer
- controls

## Error Behavior

The engine throws errors for invalid input scenarios, including:
- missing canvas/stage in factory creation
- unsupported file/url format
- invalid or empty mesh sampling result
- GIF export requested with no loaded models

External integrations should wrap loading/export calls in try/catch.

## React Integration Pattern

```ts
useEffect(() => {
  if (!canvasRef.current || !stageRef.current) return;

  const engine = createPointcloudEngine({
    canvas: canvasRef.current,
    stage: stageRef.current,
    autostart: true
  });

  engineRef.current = engine;

  return () => {
    engine.dispose();
    engineRef.current = null;
  };
}, []);
```

## Performance Recommendations

- Keep pointDensity moderate when many models are loaded
- Prefer async batching for multiple file loads
- Use setOptions for live updates instead of recreating engine
- Always call dispose on unmount/page exit

## Supported Model Formats

- Local file upload: .obj, .glb, .ply
- URL loading: .obj, .glb, .gltf, .ply

For .obj/.glb/.gltf the engine samples mesh surfaces; for .ply it reads geometry vertices/colors directly.
