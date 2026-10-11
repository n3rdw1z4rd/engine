import { ECS, Observable, type Component, type ComponentType, type Entity } from '@n3rdw1z4rd/core';
import { Object3D, Scene } from 'three';
import { Script } from './script';

type Instances<T extends readonly ComponentType[]> = {
    [K in keyof T]: T[K] extends ComponentType<infer U> ? U : never;
};

export type WorldEvent =
    | { kind: 'object-added' | 'object-removed' | 'hierarchy-changed'; object: Object3D }
    | { kind: 'component-added' | 'component-removed'; object: Object3D; component: Component };

export interface ScriptError {
    object: Object3D;
    script: Script;
    phase: string;
    error: unknown;
}

export interface AttachOptions {
    /** Name of a descendant of the parent to attach to, e.g. a glTF bone 'RightHand'. */
    socket?: string;
    /** Keep the child's world transform (default true), so it doesn't jump. */
    keepWorld?: boolean;
}

/**
 * The set of game objects in a scene and the components attached to them.
 *
 * Objects are plain Three.js Object3Ds. Components are class instances stored in
 * @n3rdw1z4rd/core's ECS, keyed by an entity id the world assigns to each object.
 * Scripts are components with a lifecycle (see Script).
 */
export class World {
    readonly scene: Scene;
    readonly onChange = new Observable<WorldEvent>();
    readonly onScriptError = new Observable<ScriptError>();

    private readonly _ecs = new ECS();
    private readonly _entities = new WeakMap<Object3D, Entity>();
    private readonly _objects = new Map<Entity, Object3D>();
    private readonly _scripts: Script[] = [];
    private _scriptsDirty = false;
    private _iterating = 0;
    private readonly _deferred: (() => void)[] = [];

    constructor(scene: Scene = new Scene()) {
        this.scene = scene;
    }

    /* -------------------------------------------------------------- */
    /* Objects                                                          */
    /* -------------------------------------------------------------- */

    /** Registers an object as a game object and adds it to the scene (flat by default). */
    add<T extends Object3D>(object: T, ...components: Component[]): T {
        this._defer(() => {
            if (this._entities.has(object)) return;
            const entity = this._ecs.createEntity();
            this._entities.set(object, entity);
            this._objects.set(entity, object);
            if (!object.parent) this.scene.add(object);
            this.onChange.notify({ kind: 'object-added', object });
            for (const c of components) this._addComponentNow(object, c);
        });
        return object;
    }

    /** Destroys an object, its components, and (by default) anything attached to it. */
    destroy(object: Object3D, opts: { detachChildren?: boolean } = {}): void {
        this._defer(() => {
            const entity = this._entities.get(object);
            if (entity === undefined) return;

            for (const child of [...object.children]) {
                if (!this._entities.has(child)) continue;
                if (opts.detachChildren) this.detach(child);
                else this.destroy(child);
            }

            for (const s of this._scriptsOf(object)) this._callScript(s, 'onDestroy');
            this._ecs.destroyEntity(entity);
            this._entities.delete(object);
            this._objects.delete(entity);
            object.removeFromParent();
            this._scriptsDirty = true;
            this.onChange.notify({ kind: 'object-removed', object });
        });
    }

    has(object: Object3D): boolean {
        return this._entities.has(object);
    }

    objects(): IterableIterator<Object3D> {
        return this._objects.values();
    }

    /** Walks up from any Object3D (e.g. a raycast hit) to the game object that owns it. */
    ownerOf(object: Object3D | null): Object3D | null {
        for (let o = object; o; o = o.parent) if (this._entities.has(o)) return o;
        return null;
    }

    /* -------------------------------------------------------------- */
    /* Attachments                                                      */
    /* -------------------------------------------------------------- */

    /** Attaches `child` to `parent` (or one of its sockets) using Three's scene graph. */
    attach(child: Object3D, parent: Object3D, opts: AttachOptions = {}): void {
        const target = opts.socket ? parent.getObjectByName(opts.socket) : parent;
        if (!target) throw new Error(`attach: socket "${opts.socket}" not found on "${parent.name}"`);
        for (let o: Object3D | null = target; o; o = o.parent) {
            if (o === child) throw new Error('attach: would create a cycle');
        }
        if (opts.keepWorld === false) target.add(child);
        else target.attach(child);
        this.onChange.notify({ kind: 'hierarchy-changed', object: child });
    }

    /** Moves an attached object back to the scene root, keeping its world transform. */
    detach(child: Object3D): void {
        this.scene.attach(child);
        this.onChange.notify({ kind: 'hierarchy-changed', object: child });
    }

    /* -------------------------------------------------------------- */
    /* Components                                                       */
    /* -------------------------------------------------------------- */

    addComponent<T extends Component>(object: Object3D, component: T): T {
        this._defer(() => this._addComponentNow(object, component));
        return component;
    }

    get<T extends Component>(object: Object3D, type: ComponentType<T>): T | undefined {
        const e = this._entities.get(object);
        return e === undefined ? undefined : this._ecs.getComponent(e, type);
    }

    removeComponent<T extends Component>(object: Object3D, type: ComponentType<T>): void {
        this._defer(() => {
            const e = this._entities.get(object);
            const c = e === undefined ? undefined : this._ecs.getComponent(e, type);
            if (e === undefined || !c) return;
            if (c instanceof Script) {
                if (c._enabled) this._callScript(c, 'onDisable');
                this._callScript(c, 'onDestroy');
                this._scriptsDirty = true;
            }
            this._ecs.removeComponent(e, type);
            this.onChange.notify({ kind: 'component-removed', object, component: c });
        });
    }

    /** Every component on an object (core's ECS has no per-entity index, so this scans types). */
    componentsOf(object: Object3D): Component[] {
        const e = this._entities.get(object);
        if (e === undefined) return [];
        const out: Component[] = [];
        for (const map of (this._ecs as unknown as { components: Map<ComponentType, Map<Entity, Component>> }).components.values()) {
            const c = map.get(e);
            if (c) out.push(c);
        }
        return out;
    }

    /** Objects that have all the given component types, with those components. */
    *query<T extends readonly ComponentType[]>(...types: T): IterableIterator<[Object3D, ...Instances<T>]> {
        this._iterating++;
        try {
            for (const [entity, ...components] of this._ecs.query(...types)) {
                const object = this._objects.get(entity);
                if (object) yield [object, ...(components as unknown as Instances<T>)];
            }
        } finally {
            this._leaveIteration();
        }
    }

    /* -------------------------------------------------------------- */
    /* Script lifecycle (driven by Engine)                              */
    /* -------------------------------------------------------------- */

    /** @internal */
    _runScripts(phase: 'fixedUpdate' | 'update' | 'lateUpdate', dt: number): void {
        this._iterating++;
        try {
            if (phase !== 'lateUpdate' && phase !== 'fixedUpdate') {
                for (const s of this._sortedScripts()) {
                    if (s._enabled && !s._started) {
                        s._started = true;
                        this._callScript(s, 'start');
                    }
                }
            }
            for (const s of this._sortedScripts()) {
                if (s._enabled && s._started) this._callScript(s, phase, dt);
            }
        } finally {
            this._leaveIteration();
        }
    }

    /** @internal */
    _scriptEnabledChanged(s: Script): void {
        this._callScript(s, s._enabled ? 'onEnable' : 'onDisable');
    }

    /** Re-runs start() on every script (used when entering play mode). */
    restartScripts(): void {
        for (const s of this._sortedScripts()) s._started = false;
    }

    /* -------------------------------------------------------------- */
    /* Internals                                                        */
    /* -------------------------------------------------------------- */

    private _addComponentNow(object: Object3D, component: Component): void {
        const e = this._entities.get(object);
        if (e === undefined) throw new Error('addComponent: object is not in this world; call world.add() first');
        this._ecs.addComponent(e, component);
        if (component instanceof Script) {
            component.object = object;
            component.world = this;
            this._scriptsDirty = true;
            this._callScript(component, 'awake');
            if (component._enabled) this._callScript(component, 'onEnable');
        }
        this.onChange.notify({ kind: 'component-added', object, component });
    }

    private _scriptsOf(object: Object3D): Script[] {
        return this.componentsOf(object).filter((c): c is Script => c instanceof Script);
    }

    private _sortedScripts(): Script[] {
        if (this._scriptsDirty) {
            this._scripts.length = 0;
            for (const object of this._objects.values()) this._scripts.push(...this._scriptsOf(object));
            // Array.prototype.sort is stable, so equal `order` keeps add order.
            this._scripts.sort((a, b) => (a.constructor as typeof Script).order - (b.constructor as typeof Script).order);
            this._scriptsDirty = false;
        }
        return this._scripts;
    }

    private _callScript(s: Script, phase: keyof Script & string, dt?: number): void {
        const fn = (s as unknown as Record<string, ((dt?: number) => void) | undefined>)[phase];
        if (typeof fn !== 'function') return;
        try {
            fn.call(s, dt);
        } catch (error) {
            // One broken script must never take down the editor or the other scripts.
            s._enabled = false;
            this.onScriptError.notify({ object: s.object, script: s, phase, error });
        }
    }

    /** Structural changes made while iterating are applied when iteration ends. */
    private _defer(fn: () => void): void {
        if (this._iterating > 0) this._deferred.push(fn);
        else fn();
    }

    private _leaveIteration(): void {
        if (--this._iterating > 0) return;
        while (this._deferred.length) this._deferred.shift()!();
    }
}
