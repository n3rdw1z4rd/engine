import type { Object3D } from 'three';
import type { World } from './world';

// Standard (TC39) decorators store metadata on Symbol.metadata. Browsers don't
// ship it yet; Symbol.for('Symbol.metadata') is what esbuild/TS/Oxc fall back to,
// so polyfilling with it keeps compiled user scripts and the engine in agreement.
(Symbol as { metadata?: symbol }).metadata ??= Symbol.for('Symbol.metadata');

export type FieldKind = 'number' | 'string' | 'boolean' | 'color';

export interface FieldOptions {
    /** Explicit kind. Omit to infer from the default value. Required for refs. */
    type?: FieldKind | (abstract new (...args: any[]) => unknown);
    min?: number;
    max?: number;
    step?: number;
    label?: string;
}

export interface FieldInfo extends FieldOptions {
    name: string;
}

/**
 * Marks a script property as editable in the inspector and saved with the scene.
 *
 *     @field() speed = 1;
 *     @field({ min: 0, max: 10, step: 0.1 }) radius = 2;
 *     @field({ type: Object3D }) target: Object3D | null = null;
 */
export function field(options: FieldOptions = {}) {
    return (_value: undefined, context: ClassFieldDecoratorContext) => {
        if (context.static || context.private) {
            throw new Error(`@field can't be used on static or #private members (${String(context.name)})`);
        }
        const meta = context.metadata as { fields?: FieldInfo[] };
        // Copy-on-write so a subclass never mutates its base class's list.
        meta.fields = [...(Object.hasOwn(meta, 'fields') ? meta.fields! : meta.fields ?? []), { ...options, name: String(context.name) }];
    };
}

/** Every @field of a script class, base classes included, de-duplicated by name (subclass wins). */
export function getFields(ctor: Function): FieldInfo[] {
    const meta = (ctor as { [Symbol.metadata]?: { fields?: FieldInfo[] } })[Symbol.metadata as typeof Symbol.metadata];
    const byName = new Map<string, FieldInfo>();
    for (const f of meta?.fields ?? []) byName.set(f.name, f);
    return [...byName.values()];
}

/** Resolves a field's kind, inferring primitives from the current value. */
export function fieldKind(info: FieldInfo, value: unknown): FieldKind | 'ref' | 'unknown' {
    if (typeof info.type === 'string') return info.type;
    if (typeof info.type === 'function') return 'ref';
    switch (typeof value) {
        case 'number': return 'number';
        case 'string': return 'string';
        case 'boolean': return 'boolean';
        default: return 'unknown';
    }
}

/**
 * Base class for behavior attached to an object. Every lifecycle method is optional.
 *
 * Order: awake → onEnable → start (once, before the first update) →
 * fixedUpdate / update / lateUpdate every frame → onDisable → onDestroy.
 */
export abstract class Script {
    /** Lower runs first. Ties keep add order. */
    static order = 0;

    /** Set by the world when the script is attached. */
    object!: Object3D;
    world!: World;

    /** @internal */ _started = false;
    /** @internal */ _enabled = true;

    get enabled(): boolean { return this._enabled; }
    set enabled(v: boolean) {
        if (v === this._enabled) return;
        this._enabled = v;
        this.world?._scriptEnabledChanged(this);
    }

    /** Shorthand for a sibling component on the same object. */
    get<T extends object>(type: abstract new (...args: any[]) => T): T | undefined {
        return this.world.get(this.object, type as new (...args: any[]) => T);
    }

    awake?(): void;
    onEnable?(): void;
    start?(): void;
    fixedUpdate?(dt: number): void;
    update?(dt: number): void;
    lateUpdate?(dt: number): void;
    onDisable?(): void;
    onDestroy?(): void;
}
