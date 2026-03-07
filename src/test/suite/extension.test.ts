import * as assert from 'assert';
import * as vscode from 'vscode';
import { updateStatusBar } from '../../extension';

suite('StatusBar Test Suite', () => {
    test('updateStatusBar should set status to connected', () => {
        const mockStatusBarItem = {
            text: '',
            tooltip: '',
            backgroundColor: undefined as vscode.ThemeColor | undefined,
            show: () => {},
            hide: () => {},
            dispose: () => {}
        } as unknown as vscode.StatusBarItem;

        updateStatusBar(mockStatusBarItem, true);

        assert.strictEqual(mockStatusBarItem.text, '$(check) Lemonade: Connected');
        assert.strictEqual(mockStatusBarItem.tooltip, 'Lemonade Server is Online');
        assert.strictEqual(mockStatusBarItem.backgroundColor, undefined);
    });

    test('updateStatusBar should set status to disconnected', () => {
        const mockStatusBarItem = {
            text: '',
            tooltip: '',
            backgroundColor: undefined as vscode.ThemeColor | undefined,
            show: () => {},
            hide: () => {},
            dispose: () => {}
        } as unknown as vscode.StatusBarItem;

        updateStatusBar(mockStatusBarItem, false);

        assert.strictEqual(mockStatusBarItem.text, '$(error) Lemonade: Disconnected');
        assert.strictEqual(mockStatusBarItem.tooltip, 'Lemonade Server is Offline. Click to check settings.');
        assert.notStrictEqual(mockStatusBarItem.backgroundColor, undefined);
    });
});
