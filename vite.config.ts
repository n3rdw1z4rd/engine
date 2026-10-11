import { defineConfig } from 'vite';

// Library build: ES modules only. Three.js, core, Vite and esbuild stay external.
export default defineConfig({
    build: {
        lib: {
            entry: {
                index: 'src/index.ts', // the runtime
                vite: 'src/vite.ts', // the build-time Vite plugin (never imported by games at runtime)
            },
            formats: ['es'],
        },
        sourcemap: true,
        emptyOutDir: true,
        rolldownOptions: {
            external: [/^three(\/.*)?$/, /^@n3rdw1z4rd\/core/, 'simplex-noise', 'vite', 'esbuild', /^node:/],
        },
    },
});
