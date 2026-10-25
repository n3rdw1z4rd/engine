import { Renderer } from '@n3rdw1z4rd/core/three';
import { Camera, OrthographicCamera, PerspectiveCamera, Scene } from 'three';
import { World } from './world';

export interface EngineOptions {
    /** Element the canvas is placed in and sized to. */
    container: HTMLElement;
    world?: World;
    antialias?: boolean;
    /** Fixed-update rate in Hz (default 60). */
    fixedRate?: number;
}

const MAX_FIXED_STEPS = 5; // avoid a spiral of death after a long frame
const MAX_DT = 0.25;

/**
 * Owns the renderer and the frame loop.
 *
 * Each frame: fixedUpdate (0..n times at a fixed rate) → update → lateUpdate → render.
 * Scripts only run while `simulating` is true; rendering always runs, so an
 * editor can show the scene without playing it.
 */
export class Engine {
    readonly renderer: Renderer;
    readonly world: World;
    readonly container: HTMLElement;

    /** The camera the frame is rendered with. Games set this; editors override it. */
    camera: Camera | null = null;
    simulating = false;
    timeScale = 1;

    /** Drawn on top of the world after the main render: debug draw, editor gizmos. Never saved. */
    readonly overlay = new Scene();

    /** Called after scripts and before render, with real elapsed seconds. */
    onFrame: ((dt: number) => void) | null = null;

    private readonly _fixedDt: number;
    private _accumulator = 0;
    private _last = 0;
    private readonly _resizeObserver: ResizeObserver;

    constructor(opts: EngineOptions) {
        this.container = opts.container;
        this.world = opts.world ?? new World();
        this._fixedDt = 1 / (opts.fixedRate ?? 60);

        this.renderer = new Renderer({ antialias: opts.antialias ?? true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        Object.assign(this.renderer.domElement.style, { display: 'block', width: '100%', height: '100%', touchAction: 'none' });
        this.container.append(this.renderer.domElement);

        this._resizeObserver = new ResizeObserver(() => this.resize());
        this._resizeObserver.observe(this.container);
        this.resize();
    }

    start(): void {
        this._last = 0;
        this.renderer.setAnimationLoop((t: number) => this._frame(t));
    }

    stop(): void {
        this.renderer.setAnimationLoop(null);
    }

    resize(): void {
        const w = Math.max(1, this.container.clientWidth);
        const h = Math.max(1, this.container.clientHeight);
        this.renderer.setSize(w, h, false);
        this._fitCamera(this.camera, w / h);
    }

    dispose(): void {
        this.stop();
        this._resizeObserver.disconnect();
        this.renderer.dispose();
        this.renderer.domElement.remove();
    }

    private _frame(t: number): void {
        const dt = this._last ? Math.min((t - this._last) / 1000, MAX_DT) : 0;
        this._last = t;

        if (this.simulating) {
            const scaled = dt * this.timeScale;
            this._accumulator += scaled;
            let steps = 0;
            while (this._accumulator >= this._fixedDt && steps++ < MAX_FIXED_STEPS) {
                this.world._runScripts('fixedUpdate', this._fixedDt);
                this._accumulator -= this._fixedDt;
            }
            if (steps >= MAX_FIXED_STEPS) this._accumulator = 0;

            this.world._runScripts('update', scaled);
            this.world._runScripts('lateUpdate', scaled);
        }

        this.onFrame?.(dt);

        if (this.camera) {
            this._fitCamera(this.camera, this.renderer.domElement.width / this.renderer.domElement.height);
            this.renderer.render(this.world.scene, this.camera);
            if (this.overlay.children.length) {
                this.renderer.autoClear = false;
                this.renderer.clearDepth();
                this.renderer.render(this.overlay, this.camera);
                this.renderer.autoClear = true;
            }
        }
    }

    private _fitCamera(camera: Camera | null, aspect: number): void {
        if (!camera || !Number.isFinite(aspect)) return;
        if (camera instanceof PerspectiveCamera && camera.aspect !== aspect) {
            camera.aspect = aspect;
            camera.updateProjectionMatrix();
        } else if (camera instanceof OrthographicCamera) {
            const halfH = (camera.top - camera.bottom) / 2;
            const halfW = halfH * aspect;
            if (camera.right !== halfW) {
                camera.left = -halfW;
                camera.right = halfW;
                camera.updateProjectionMatrix();
            }
        }
    }
}
