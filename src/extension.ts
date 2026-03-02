import * as vscode from 'vscode';

// Global reference to the status bar
let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
    console.log('Lemonade Dashboard is now active!');

    // 1. Initialize the Status Bar Item (Right aligned, priority 100)
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'lemonade.openSettings'; // Clicking it opens settings
    context.subscriptions.push(statusBarItem);
    
    // Set initial state
    updateStatusBar(false);
    statusBarItem.show();

    // 2. Register command to easily open your extension's settings
    context.subscriptions.push(vscode.commands.registerCommand('lemonade.openSettings', () => {
        vscode.commands.executeCommand('workbench.action.openSettings', 'lemonade');
    }));

    // 3. Register the Webview Dashboard Provider
    const provider = new LemonadeDashboardProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(LemonadeDashboardProvider.viewType, provider)
    );
}

export function deactivate() {}

// Helper function to update the bottom Status Bar
export function updateStatusBar(isConnected: boolean) {
    if (isConnected) {
        statusBarItem.text = '$(check) Lemonade: Connected';
        statusBarItem.tooltip = 'Lemonade Server is Online';
        statusBarItem.backgroundColor = undefined; 
    } else {
        statusBarItem.text = '$(error) Lemonade: Disconnected';
        statusBarItem.tooltip = 'Lemonade Server is Offline. Click to check settings.';
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    }
}

// Helper to dynamically read user settings
export function getLemonadeConfig() {
    const config = vscode.workspace.getConfiguration('lemonade');
    let rawUrl = config.get<string>('serverUrl') || 'http://127.0.0.1:8000';
    const token = config.get<string>('apiToken') || '';

    // Clean up the URL
    rawUrl = rawUrl.trim().replace(/\/+$/, '');
    if (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://')) {
        rawUrl = `http://${rawUrl}`; 
    }

    const baseUrl = `${rawUrl}/api/v1`;
    const headers: Record<string, string> = {
        'Content-Type': 'application/json'
    };
    
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    return { baseUrl, headers };
}

class LemonadeDashboardProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'lemonadeDashboard';
    private _view?: vscode.WebviewView;

    constructor(private readonly _extensionUri: vscode.Uri) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = this._getHtmlForWebview();

        webviewView.webview.onDidReceiveMessage(async data => {
            const { baseUrl, headers } = getLemonadeConfig();
            
            switch (data.type) {
                case 'openSettings':
                    // This opens the VS Code settings tab filtered to 'lemonade'
                    vscode.commands.executeCommand('workbench.action.openSettings', 'lemonade');
                    break;

                case 'getDashboardData':
                    try {
                        const [sysRes, modelsRes, healthRes, statsRes] = await Promise.all([
                            fetch(`${baseUrl}/system-info`, { headers }),
                            fetch(`${baseUrl}/models`, { headers }),
                            fetch(`${baseUrl}/health`, { headers }),
                            fetch(`${baseUrl}/stats`, { headers })
                        ]);

                        if (!healthRes.ok) throw new Error("Server offline");
                        updateStatusBar(true);

                        const sysInfo = await sysRes.json();
                        const modelsData = await modelsRes.json();
                        const healthData = await healthRes.json();
                        
                        let statsData = {};
                        if (statsRes.ok) {
                            statsData = await statsRes.json();
                        }

                        webviewView.webview.postMessage({ 
                            type: 'renderDashboard', 
                            sysInfo: sysInfo, 
                            models: modelsData.data || [], 
                            loadedModel: healthData.model_loaded || null,
                            stats: statsData
                        });
                    } catch (e) {
                        updateStatusBar(false);
                        webviewView.webview.postMessage({ type: 'serverOffline' });
                    }
                    break;

                case 'manageModelLifecycle':
                    try {
                        const endpoint = data.action === 'load' ? '/load' : '/unload';
                        const res = await fetch(`${baseUrl}${endpoint}`, {
                            method: 'POST',
                            headers,
                            body: JSON.stringify({ model: data.modelName })
                        });
                        if (!res.ok) throw new Error("Action failed");
                        vscode.window.showInformationMessage(`Successfully ${data.action}ed ${data.modelName}`);
                    } catch (e) {
                        vscode.window.showErrorMessage(`Failed to ${data.action} model ${data.modelName}.`);
                    }
                    break;

                case 'pullModel':
                    vscode.window.showInformationMessage(`Pulling model: ${data.modelName}...`);
                    try {
                        const res = await fetch(`${baseUrl}/pull`, {
                            method: 'POST',
                            headers,
                            body: JSON.stringify({ model: data.modelName })
                        });
                        if (!res.ok) throw new Error("Pull failed");
                        vscode.window.showInformationMessage(`Successfully pulled ${data.modelName}`);
                    } catch (e) {
                        vscode.window.showErrorMessage(`Failed to pull ${data.modelName}`);
                    }
                    break;

                case 'deleteModel':
                    try {
                        const res = await fetch(`${baseUrl}/delete`, {
                            method: 'POST',
                            headers,
                            body: JSON.stringify({ model: data.modelName })
                        });
                        if (!res.ok) throw new Error("Delete failed");
                        vscode.window.showInformationMessage(`Deleted ${data.modelName}`);
                    } catch (e) {
                        vscode.window.showErrorMessage(`Failed to delete ${data.modelName}`);
                    }
                    break;
            }
        });
    }

    private _getHtmlForWebview() {
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Lemonade Manager</title>
                <script type="module" src="https://cdn.jsdelivr.net/npm/@vscode/webview-ui-toolkit/dist/toolkit.min.js"></script>
                <style>
                    body { padding: 0 10px; display: flex; flex-direction: column; gap: 20px; }
                    .header-status { display: flex; justify-content: space-between; align-items: center; margin-top: 15px; padding-bottom: 10px; border-bottom: 1px solid var(--vscode-panel-border); }
                    .status-badge { display: flex; align-items: center; gap: 6px; font-weight: 600; }
                    .indicator { width: 10px; height: 10px; border-radius: 50%; background: var(--vscode-disabledForeground); }
                    .indicator.online { background: var(--vscode-testing-iconPassed); }
                    .indicator.offline { background: var(--vscode-testing-iconFailed); }
                    
                    .section { margin-top: 15px; }
                    .section h3 { font-size: 12px; text-transform: uppercase; color: var(--vscode-descriptionForeground); margin-bottom: 10px; }
                    
                    .metric { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 8px; padding: 4px 0; border-bottom: 1px solid var(--vscode-widget-border); }
                    .metric-label { opacity: 0.8; }
                    .metric-value { font-family: var(--vscode-editor-font-family); font-weight: bold; }
                    
                    vscode-text-field, vscode-dropdown, vscode-button { width: 100%; margin-bottom: 10px; }
                    .button-group { display: flex; gap: 10px; }
                </style>
            </head>
            <body>
                <div class="header-status">
                    <div class="status-badge">
                        <div id="statusDot" class="indicator offline"></div>
                        <span id="statusText">Disconnected</span>
                    </div>
                    <vscode-badge id="speedBadge">0 t/s</vscode-badge>
                </div>

                <vscode-panels>
                    <vscode-panel-tab id="tab-1">System</vscode-panel-tab>
                    <vscode-panel-tab id="tab-2">Library</vscode-panel-tab>

                    <vscode-panel-view id="view-1" style="flex-direction: column;">
                        <div class="section">
                            <h3>Hardware Specs</h3>
                            <div class="metric"><span class="metric-label">Processor</span><span id="cpuText" class="metric-value">-</span></div>
                            <div class="metric"><span class="metric-label">Memory</span><span id="ramText" class="metric-value">-</span></div>
                            <div class="metric"><span class="metric-label">NPU Detected</span><span id="npuText" class="metric-value">-</span></div>
                        </div>

                        <div class="section">
                            <h3>Last Request Stats</h3>
                            <div class="metric"><span class="metric-label">Time to First Token</span><span id="ttft" class="metric-value">0s</span></div>
                            <div class="metric"><span class="metric-label">Tokens (In / Out)</span><span id="tokensInOut" class="metric-value">0 / 0</span></div>
                        </div>

                        <vscode-divider></vscode-divider>

                        <div class="section">
                            <h3>Memory Lifecycle</h3>
                            <p style="font-size: 12px; margin-bottom: 10px; color: var(--vscode-descriptionForeground);">
                                Loaded: <strong id="activeModel" style="color: var(--vscode-foreground);">None</strong>
                            </p>
                            <vscode-dropdown id="modelSelect">
                                <vscode-option value="">Fetching models...</vscode-option>
                            </vscode-dropdown>
                            
                            <div class="button-group">
                                <vscode-button appearance="primary" onclick="manageModel('load')">Load to VRAM</vscode-button>
                                <vscode-button appearance="secondary" onclick="manageModel('unload')">Unload</vscode-button>
                            </div>
                        </div>
                    </vscode-panel-view>

                    <vscode-panel-view id="view-2" style="flex-direction: column;">
                        <div class="section">
                            <h3>Pull New Model</h3>
                            <vscode-text-field id="pullInput" placeholder="e.g., Qwen/Qwen2.5-Coder-7B-Instruct-GGUF">
                                HuggingFace Repo ID
                            </vscode-text-field>
                            <vscode-button appearance="primary" onclick="pullModel()">Download Model</vscode-button>
                        </div>

                        <vscode-divider></vscode-divider>

                        <div class="section">
                            <h3>Manage Storage</h3>
                            <vscode-dropdown id="deleteSelect">
                                <vscode-option value="">Fetching models...</vscode-option>
                            </vscode-dropdown>
                            <vscode-button appearance="secondary" style="background: var(--vscode-errorForeground); color: white;" onclick="deleteModel()">
                                Delete Model
                            </vscode-button>
                        </div>
                    </vscode-panel-view>
                </vscode-panels>

                <script>
                    const vscode = acquireVsCodeApi();

                    function requestDashboardData() {
                        vscode.postMessage({ type: 'getDashboardData' });
                    }

                    function openSettings() {
                        vscode.postMessage({ type: 'openSettings' });
                    }

                    function manageModel(action) {
                        const modelName = document.getElementById('modelSelect').value;
                        if (modelName) vscode.postMessage({ type: 'manageModelLifecycle', action, modelName });
                    }

                    function pullModel() {
                        const modelName = document.getElementById('pullInput').value;
                        if (modelName) vscode.postMessage({ type: 'pullModel', modelName });
                    }

                    function deleteModel() {
                        const modelName = document.getElementById('deleteSelect').value;
                        if (modelName) vscode.postMessage({ type: 'deleteModel', modelName });
                    }

                    window.addEventListener('message', event => {
                        const msg = event.data;
                        
                        if (msg.type === 'renderDashboard') {
                            document.getElementById('statusDot').className = 'indicator online';
                            document.getElementById('statusText').innerText = 'Connected';
                            
                            const tps = msg.stats?.tokens_per_second || 0;
                            document.getElementById('speedBadge').innerText = \`\${tps.toFixed(1)} t/s\`;
                            document.getElementById('ttft').innerText = \`\${msg.stats?.time_to_first_token?.toFixed(2) || 0}s\`;
                            document.getElementById('tokensInOut').innerText = \`\${msg.stats?.input_tokens || 0} / \${msg.stats?.output_tokens || 0}\`;

                            document.getElementById('activeModel').innerText = msg.loadedModel || 'None';

                            const modelOptions = msg.models.map(m => \`<vscode-option value="\${m.id}">\${m.id}</vscode-option>\`).join('') || '<vscode-option value="">No models found</vscode-option>';
                            document.getElementById('modelSelect').innerHTML = modelOptions;
                            document.getElementById('deleteSelect').innerHTML = modelOptions;

                            if (msg.sysInfo) {
                                document.getElementById('cpuText').innerText = msg.sysInfo['Processor'] || 'Unknown CPU';
                                document.getElementById('ramText').innerText = msg.sysInfo['Physical Memory'] || 'Unknown';
                                
                                const hasNPU = msg.sysInfo.devices?.amd_npu?.available;
                                document.getElementById('npuText').innerText = hasNPU ? 'Yes (AMD XDNA)' : 'None';
                            }
                        } else if (msg.type === 'serverOffline') {
                            document.getElementById('statusDot').className = 'indicator offline';
                            
                            // Make the disconnected text a clickable link to settings
                            document.getElementById('statusText').innerHTML = 'Disconnected (<a href="#" style="color: var(--vscode-textLink-foreground);" onclick="openSettings()">Configure</a>)';
                            
                            document.getElementById('speedBadge').innerText = '0 t/s';
                            document.getElementById('activeModel').innerText = 'None';
                            
                            // Reset model dropdowns so they don't hold stale data
                            document.getElementById('modelSelect').innerHTML = '<vscode-option value="">Fetching models...</vscode-option>';
                            document.getElementById('deleteSelect').innerHTML = '<vscode-option value="">Fetching models...</vscode-option>';
                        }
                    });
                    
                    requestDashboardData();
                    setInterval(requestDashboardData, 3000); 
                </script>
            </body>
            </html>
        `;
    }
}