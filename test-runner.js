const Mocha = require('mocha');
const path = require('path');
const glob = require('glob');

async function run() {
    const mocha = new Mocha({
        ui: 'tdd',
        color: true,
        timeout: 20000
    });

    // To run without vscode electron environment, we might need to mock vscode first
    // It's tricky to unit test vscode extension without vscode context
}
