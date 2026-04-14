# OBJ to Pointcloud Tool

Web app built with Astro + Three.js that converts local OBJ files into animated point clouds rendered with WebGL.

The rendering behavior is inspired by the reference article:
https://dev.to/maniflames/pointcloud-effect-in-three-js-3eic

## Features

- Upload or drag-and-drop OBJ files
- Mesh to point cloud conversion
- Shader-based animated wave displacement (pointcloud effect)
- Live controls for density, point size, wave speed, wave jitter, point color, and background color
- Orbit camera controls with reset
- Responsive UI for desktop and mobile

## Main Structure

- `src/pages/index.astro`: main page entry
- `src/components/PointcloudTool.astro`: UI + canvas layout
- `src/scripts/pointcloud-tool.js`: Three.js scene, OBJ parsing, point cloud generation, animation
- `src/layouts/Layout.astro`: global HTML shell and fonts

## Run

From project root:

1. `npm install`
2. `npm run dev`
3. Open `http://localhost:4321`

Production build:

- `npm run build`
- `npm run preview`

## OBJ Notes

- The app expects `.obj` files containing mesh geometry.
- If an OBJ has no valid mesh vertices, the app reports an error in the point counter.
