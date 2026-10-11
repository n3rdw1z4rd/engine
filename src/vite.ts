import type { Plugin } from 'vite';

/**
 * Vite plugin: lowers standard (TC39) decorators such as `@field` with esbuild.
 *
 * Vite 8 compiles TypeScript with Oxc, which only lowers legacy
 * `experimentalDecorators` and passes standard decorators through untouched —
 * no browser can run that yet. This runs first on any source file that uses a
 * decorator; Oxc then sees plain TS/JS.
 *
 *     // vite.config.ts
 *     import { decorators } from '@n3rdw1z4rd/engine/vite';
 *     export default defineConfig({ plugins: [decorators()] });
 *
 * Requires `esbuild` to be installed alongside Vite.
 */
export function decorators(): Plugin {
    const file = /\.[cm]?[jt]sx?$/;
    const usesDecorator = /(^|[\s;{(])@[A-Za-z_$][\w$]*\s*(\(|\n|\s+[A-Za-z_$#])/m;
    let transform: typeof import('esbuild').transform | undefined;

    return {
        name: 'n3rdw1z4rd:standard-decorators',
        enforce: 'pre',
        async transform(code, id) {
            const path = id.split('?')[0];
            if (!file.test(path) || path.includes('/node_modules/') || !usesDecorator.test(code)) return null;

            transform ??= (await import('esbuild').catch(() => {
                throw new Error('@n3rdw1z4rd/engine/vite: install esbuild (npm i -D esbuild) to compile @field decorators');
            })).transform;

            const loader = path.slice(path.lastIndexOf('.') + 1).replace(/^[cm]/, '') as 'ts' | 'tsx' | 'js' | 'jsx';
            const result = await transform(code, {
                loader,
                sourcefile: path,
                sourcemap: true,
                target: 'es2022',
                jsx: 'preserve', // leave JSX to the framework plugin
                tsconfigRaw: { compilerOptions: { useDefineForClassFields: true, verbatimModuleSyntax: true } },
            });
            return { code: result.code, map: result.map };
        },
    };
}
