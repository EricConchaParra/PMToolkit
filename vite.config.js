import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
    build: {
        rollupOptions: {
            input: {
                index: resolve(__dirname, 'index.html'),
                background: resolve(__dirname, 'src/background/background.js'),
                content: resolve(__dirname, 'src/content/jira/main.js'),
                'zoom-content': resolve(__dirname, 'src/content/zoom/main.js'),
                exporter: resolve(__dirname, 'src/pages/exporter/index.html'),
                analytics: resolve(__dirname, 'src/pages/analytics/index.html'),
            },
            output: {
                entryFileNames: '[name].js',
                chunkFileNames: 'assets/[name].js',
                assetFileNames: 'assets/[name].[ext]',
            },
        },
        outDir: 'dist',
        emptyOutDir: true,
    },
});
