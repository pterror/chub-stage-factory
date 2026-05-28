import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import dts from 'vite-plugin-dts'
import { resolve } from 'path'

export default defineConfig(({ mode }) => {
    // Restrict vitest to workspace source so Nix flake-input snapshots in
    // .direnv/flake-inputs/ are never picked up as test files. Those paths
    // have no node_modules, causing optional-peer-dep stubs (e.g. three) to
    // fail to resolve.
    const test = {
        include: ['src/**/*.test.{ts,tsx}'],
    };
    if (mode === 'headless') {
        return {
            test,
            plugins: [react()],
            build: {
                lib: {
                    entry: resolve(__dirname, 'src/index.ts'),
                    name: 'index',
                    formats: ['es'],
                    fileName: 'index',
                },
                outDir: 'dist-headless',
                rollupOptions: {
                    external: ['react', 'react-dom', '@chub-ai/stages-ts'],
                    output: {
                        globals: {
                            react: 'React',
                            'react-dom': 'ReactDOM',
                            '@chub-ai/stages-ts': 'StagesTs',
                        },
                    },
                },
            },
        };
    } else if (mode === 'lib') {
        return { test,
            plugins: [
                react(),
                dts({
                    outDir: ['dist'],
                    include: ['src/**/*.ts*'],
                    staticImport: true,
                    rollupTypes: true,
                    insertTypesEntry: true,
                }),
            ],
            build: {
                lib: {
                    entry: resolve(__dirname, 'src/index.ts'),
                    name: 'index',
                    formats: ['umd', 'es', 'cjs', 'iife'],
                    fileName: 'index',
                },
                rollupOptions: {
                    external: ['react', 'react-dom'],
                    output: {
                        globals: {
                            react: 'React',
                            'react-dom': 'ReactDOM',
                        },
                    },
                }
            }
        }
    } else {
        return {
            test,
            plugins: [react()],
            ...(process.env.VITE_PUBLIC_DIR ? { publicDir: process.env.VITE_PUBLIC_DIR } : {}),
        }
    }
});