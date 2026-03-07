import { defineConfig } from '@vscode/test-cli';

export default defineConfig([
	{
		label: 'unitTests',
		files: 'out/test/suite/**/*.test.js',
		version: 'insiders',
		workspaceFolder: './',
		mocha: {
			ui: 'tdd',
			timeout: 20000
		},
        launchArgs: [
            '--disable-gpu',
            '--headless',
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--disable-software-rasterizer',
        ]
	}
]);
