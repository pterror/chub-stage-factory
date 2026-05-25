import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import dts from 'vite-plugin-dts'
import { resolve } from 'path'

export default defineConfig(({ command, mode }) => {
    if (mode === 'headless') {
        return {
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
        return { plugins: [
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
            plugins: [react()]
        }
    }
});