import { defineConfig } from 'vite';

// Library build: ES module only, Three.js and core stay external (peer / dependency).
export default defineConfig({
    build: {
        lib: {
            entry: 'src/index.ts',
            formats: ['es'],
            fileName: 'index',
        },
        sourcemap: true,
        emptyOutDir: false, // tsc writes the .d.ts files into dist too
        rolldownOptions: {
            external: [/^three(\/.*)?$/, '@n3rdw1z4rd/core', 'simplex-noise'],
        },
    },
});
