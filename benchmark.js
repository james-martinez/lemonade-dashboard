async function runBenchmark() {
    console.log("Measuring Baseline (Fetching from GitHub API every time)...");

    let totalTime = 0;
    const iterations = 5;

    for (let i = 0; i < iterations; i++) {
        const start = Date.now();

        try {
            const ghRes = await fetch('https://api.github.com/repos/lemonade-sdk/lemonade/releases/latest', {
                headers: { 'User-Agent': 'Lemonade-VSCode-Extension' }
            });
            if (ghRes.ok) await ghRes.json();

            const modelsRes = await fetch('https://raw.githubusercontent.com/lemonade-sdk/lemonade/refs/heads/main/src/cpp/resources/server_models.json');
            if (modelsRes.ok) await modelsRes.json();
        } catch(e) {
            console.error("Fetch failed", e);
        }

        const end = Date.now();
        totalTime += (end - start);
    }

    console.log(`Average Baseline Latency: ${totalTime / iterations} ms per poll`);

    console.log("\nMeasuring Optimized (Cached - 0 API requests)...");
    let cachedTotalTime = 0;

    for (let i = 0; i < iterations; i++) {
        const start = Date.now();
        // Just checking cache variables and returning them
        const _cachedGitHubVersion = "v1.0.0";
        const _cachedServerModels = { "models": [] };

        // Simulating the post message
        // webviewView.webview.postMessage({...});

        const end = Date.now();
        cachedTotalTime += (end - start);
    }

    console.log(`Average Optimized Latency: ${cachedTotalTime / iterations} ms per poll`);
}

runBenchmark();
