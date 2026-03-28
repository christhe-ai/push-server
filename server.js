const express = require('express');

const app = express();
app.use(express.json({ limit: '5mb' }));

// Security: simple API key auth
const API_KEY = process.env.PUSH_API_KEY || 'percy-website-secret-key';

// GitHub config from environment
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO || 'ChrisBeast67/percy-website';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

// MiniMax config from environment
const MINIMAX_KEY = process.env.MINIMAX_API_KEY;
const MINIMAX_BASE_URL = 'https://api.minimax.chat/v1';

if (!GITHUB_TOKEN) {
    console.error('❌ GITHUB_TOKEN environment variable not set!');
    process.exit(1);
}

// Health check
app.get('/', (req, res) => {
    res.json({ status: 'ok', service: 'Percy Website Push Server' });
});

// Generate game endpoint
app.post('/generate-game', async (req, res) => {
    // Check API key
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== API_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const { name, prompt } = req.body;

    if (!name || !prompt) {
        return res.status(400).json({ error: 'Missing name or prompt' });
    }

    if (!MINIMAX_KEY) {
        return res.status(500).json({ error: 'MiniMax API key not configured on server' });
    }

    const systemPrompt = `You are a game generator. Create a simple, fun HTML5 game.

Rules:
- Return ONLY the HTML file content - no explanations, no markdown
- Simple vanilla JS and CSS only
- Game must be playable
- Use this exact format:
<!DOCTYPE html><html><head><title>GAME TITLE</title><style>CSS here</style></head><body>GAME HTML<script>JS here</script></body></html>`;

    try {
        const response = await fetch(`${MINIMAX_BASE_URL}/text/chatcompletion_v2`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + MINIMAX_KEY
            },
            body: JSON.stringify({
                model: 'MiniMax-M2.7',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `Create "${name}": ${prompt}` }
                ],
                max_tokens: 2500,
                temperature: 0.8
            })
        });

        const data = await response.json();

        if (data.error) {
            return res.status(500).json({ error: data.error.message });
        }

        let gameCode = data.choices[0].message.content;
        
        // Clean up any markdown formatting
        gameCode = gameCode.replace(/^```html\n?/, '').replace(/\n?```$/, '').trim();

        res.json({
            success: true,
            code: gameCode,
            name: name
        });

    } catch (error) {
        console.error('Generate error:', error);
        res.status(500).json({ error: 'Failed to generate game' });
    }
});

// Push game endpoint
app.post('/push-game', async (req, res) => {
    // Check API key
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== API_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const { filename, code, message } = req.body;

    if (!filename || !code) {
        return res.status(400).json({ error: 'Missing filename or code' });
    }

    // Sanitize filename
    const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '-');
    const commitMessage = message || `Add game: ${safeFilename} (via AI Generator)`;

    try {
        // Get current file SHA if exists
        let sha = null;
        try {
            const getResponse = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/games/${safeFilename}`, {
                headers: {
                    'Authorization': `token ${GITHUB_TOKEN}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });
            if (getResponse.ok) {
                const data = await getResponse.json();
                sha = data.sha;
            }
        } catch (e) {
            // File doesn't exist yet, that's fine
        }

        // Create/update file
        const content = Buffer.from(code).toString('base64');
        const putResponse = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/games/${safeFilename}`, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Content-Type': 'application/json',
                'Accept': 'application/vnd.github.v3+json'
            },
            body: JSON.stringify({
                message: commitMessage,
                content: content,
                branch: GITHUB_BRANCH,
                sha: sha
            })
        });

        if (!putResponse.ok) {
            const errorData = await putResponse.json();
            return res.status(500).json({ error: errorData.message || 'GitHub API error' });
        }

        const result = await putResponse.json();
        res.json({
            success: true,
            url: `https://ChrisBeast67.github.io/percy-website/games/${safeFilename}`,
            commit: result.commit.sha
        });

    } catch (error) {
        console.error('Push error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Percy Push Server running on port ${PORT}`);
});
