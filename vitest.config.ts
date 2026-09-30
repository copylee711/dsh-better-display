import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    setupFiles: ['tests/setup.ts'],
    exclude: ['**/node_modules/**', '.harness/**'],
    server: {
      deps: {
        inline: [
          '@deepseek-ai/dsh-client-ui-primitives',
          '@deepseek-ai/dsh-util-workspace-path',
        ],
      },
    },
  },
})
