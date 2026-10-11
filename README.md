# @n3rdw1z4rd/engine

The runtime for a browser-first game engine built on [Three.js](https://threejs.org) and [`@n3rdw1z4rd/core`](https://www.npmjs.com/package/@n3rdw1z4rd/core).

Game objects are ordinary Three.js `Object3D`s. You attach **components** (plain classes) and **scripts** (classes with a lifecycle) to them, and the engine runs the scripts every frame. This package is everything a finished game ships; the editor lives separately in [`@n3rdw1z4rd/engine-editor`](https://github.com/n3rdw1z4rd/engine-editor).

> Status: early (0.x). The API will change.

## Install

```bash
npm install @n3rdw1z4rd/engine three simplex-noise
npm install -D vite esbuild   # for the decorator plugin, see below
```

`three` and `simplex-noise` are peer dependencies, shared with `@n3rdw1z4rd/core`.

## Quick start

```ts
// main.ts
import { Engine, Script, field } from '@n3rdw1z4rd/engine';
import { BoxGeometry, DirectionalLight, Mesh, MeshStandardMaterial, PerspectiveCamera } from 'three';

class Spin extends Script {
    @field({ min: -5, max: 5, step: 0.1 }) speed = 1;

    update(dt: number) {
        this.object.rotation.y += this.speed * dt;
    }
}

const engine = new Engine({ container: document.getElementById('game')! });
const { world } = engine;

const cube = new Mesh(new BoxGeometry(), new MeshStandardMaterial({ color: 0x3fd1a4 }));
world.add(cube, new Spin());
world.add(new DirectionalLight(0xffffff, 2));

const camera = new PerspectiveCamera(60, 1, 0.1, 100);
camera.position.set(0, 1.5, 4);
camera.lookAt(cube.position);
world.add(camera);

engine.camera = camera;   // any Three.js camera: perspective for 3D, orthographic for 2D
engine.simulating = true; // run scripts (rendering runs regardless)
engine.start();
```

```ts
// vite.config.ts — required, see "Decorators" below
import { defineConfig } from 'vite';
import { decorators } from '@n3rdw1z4rd/engine/vite';

export default defineConfig({ plugins: [decorators()] });
```

## Concepts

### World: objects and components

`World` holds the game objects of a scene. Components are stored in core's typed `ECS`, keyed by their class, so lookups are type-safe.

```ts
class Health { constructor(public hp = 100, public max = 100) {} }

world.add(player, new Health(), new PlayerController()); // registers + adds to the scene
world.get(player, Health);                                 // Health | undefined
world.removeComponent(player, Health);

for (const [obj, health] of world.query(Health)) {
    if (health.hp <= 0) world.destroy(obj);                // safe mid-iteration
}
```

| Method | Does |
| --- | --- |
| `add(obj, ...components)` | Registers an `Object3D` as a game object and adds it to `world.scene` if it has no parent. |
| `destroy(obj, { detachChildren? })` | Removes the object and its components; attached objects are destroyed too unless `detachChildren`. |
| `addComponent` / `get` / `removeComponent` | Component access by class. |
| `componentsOf(obj)` | Every component on an object. |
| `query(A, B, …)` | Yields `[object, a, b, …]` for objects that have all of them. |
| `ownerOf(obj)` | Walks up from any `Object3D` (e.g. a raycast hit on a child mesh) to its game object. |
| `onChange`, `onScriptError` | Core `Observable`s for editors and tooling. |

Adding or destroying objects or components while a query or the script loop is running is deferred until it finishes, so iteration never breaks.

### Scripts

A script is a component that extends `Script`. Every lifecycle method is optional:

| Method | Called |
| --- | --- |
| `awake()` | When the script is added. |
| `onEnable()` / `onDisable()` | When `enabled` changes (and on add/remove). |
| `start()` | Once, just before the script's first `update`. |
| `fixedUpdate(dt)` | At a fixed rate (default 60 Hz), 0..n times per frame. |
| `update(dt)` | Once per frame. |
| `lateUpdate(dt)` | After every `update`, e.g. for cameras. |
| `onDestroy()` | When the script or its object is removed. |

Inside a script, `this.object` is its `Object3D`, `this.world` its `World`, and `this.get(Type)` reads a sibling component. `static order` (lower runs first) sets execution order between script classes.

**A script that throws is disabled**, and the error is reported through `world.onScriptError`. The rest of the game keeps running.

### `@field`

`@field` marks a property as editable in the editor and, later, saved with the scene:

```ts
class Turret extends Script {
    @field() range = 12;                                   // number (inferred from the default)
    @field({ min: 0, max: 10, step: 0.5 }) fireRate = 2;   // number with a slider range
    @field() active = true;                                // boolean
    @field({ type: 'color' }) tint = '#ff4477';            // color
    @field({ type: Object3D }) target: Object3D | null = null; // reference: type required
}
```

Primitive types are inferred from the default value. Anything that starts as `null` needs an explicit `type`, because standard decorators can't see TypeScript types. Tools read fields with `getFields(ScriptClass)` and `fieldKind(info, value)`.

### Attachments

Objects are flat under the scene root by default. Use attachments when one thing should follow another, like a weapon in a hand or a moon around a planet:

```ts
world.attach(sword, hero, { socket: 'RightHand' }); // socket = any named descendant, e.g. a glTF bone
world.attach(moon, orbitPivot);                     // keeps the world transform by default
world.detach(sword);                                // back to the scene root, same world transform
```

### Engine

`new Engine({ container, world?, antialias?, fixedRate? })` creates the renderer (core's `Renderer`), sizes it to `container` with a `ResizeObserver`, and runs the frame loop: `fixedUpdate × n → update → lateUpdate → onFrame → render`.

| Member | Purpose |
| --- | --- |
| `camera` | The camera to render with. Set it yourself; the engine doesn't pick one. |
| `simulating` | Run scripts. Rendering continues when `false`, so an editor can show a paused scene. |
| `timeScale` | Slow motion / fast forward. |
| `overlay` | A second `Scene` drawn on top after a depth clear, for debug drawing and gizmos. Never part of the game scene. |
| `onFrame(dt)` | Hook called after scripts, before rendering. |
| `start()` / `stop()` / `dispose()` | Loop control. `start` uses `setAnimationLoop`, so WebXR works. |

## Decorators: the Vite plugin

`@field` uses **standard TC39 decorators**. No browser runs them natively yet, and Vite 8 compiles TypeScript with Oxc, which only converts the older `experimentalDecorators` form. Without help, the browser receives raw `@field()` syntax and fails to parse it.

`@n3rdw1z4rd/engine/vite` exports `decorators()`, a Vite plugin that runs esbuild on files that use a decorator before Oxc sees them. It needs `esbuild` installed. Do **not** enable `experimentalDecorators` in your tsconfig; it selects the old, incompatible decorator semantics.

## Developing alongside the editor

The editor consumes the engine's TypeScript source through a custom export condition, `"n3rdw1z4rd-source"`, so engine edits hot-reload in the editor without rebuilding. Clone both repos side by side:

```
n3rdw1z4rd/
├── engine/          ← this repo
└── engine-editor/   ← depends on "file:../engine" until the engine is on npm
```

```bash
cd engine && npm install   # `prepare` builds dist/, which the editor's vite.config needs for the plugin
cd ../engine-editor && npm install && npm run dev
```

## Scripts

| Command | Does |
| --- | --- |
| `npm run build` | `vite build` (`dist/index.js`, `dist/vite.js`) then `tsc` for the `.d.ts` files. |
| `npm run typecheck` | Type-check without emitting. |

The published package includes `src/` as well as `dist/`, both for source maps and for the `n3rdw1z4rd-source` condition.

## Known issues from `@n3rdw1z4rd/core` 0.18.4

- `AsteroidMesh` throws on construction: `createNoise3D(rng.nextFloat)` loses `this`. Workaround: `rng.nextFloat = rng.nextFloat.bind(rng)`.
- Importing anything from core bundles all of it (~104 KB minified), so the engine is larger than it needs to be.
- `ECS` entity ids are static (shared by every instance), so two worlds alive at once can collide.
- `World.componentsOf()` reads core `ECS`'s private `components` map until core exposes a per-entity lookup.

## License

MIT © n3rdw1z4rd
