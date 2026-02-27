import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
    build: {
        rollupOptions: {
            input: {
                index: resolve(__dirname, 'index.html'),
                background: resolve(__dirname, 'src/background/background.js'),
                content: resolve(__dirname, 'src/content/jira/main.js'),
            },
            output: {
                entryFileNames: '[name].js',
                chunkFileNames: 'assets/[name]-[hash].js',
                assetFileNames: 'assets/[name]-[hash].[ext]',
            },
        },
        outDir: 'dist',
        emptyOutDir: true,
    },
});
