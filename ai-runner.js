const axios = require("axios");
const { handle } = require("./agent-bridge");

// 🧠 Clean AI call
async function askAI(prompt) {
    const res = await axios.post("http://127.0.0.1:11434/api/generate", {
        model: "qwen3-coder:30b",
        prompt: `
You are an automation agent.

RULES:
- Output ONLY valid JSON
- No markdown
- No explanations
- No backticks

FORMAT:
{
  "type": "write_file" | "run_cmd" | "done",
  "path": "string",
  "content": "string",
  "cmd": "string"
}

TASK:
${prompt}
        `,
        stream: false
    });

    return res.data.response;
}

// 🧠 bulletproof JSON extractor
function extractJSON(text) {
    if (!text) throw new Error("Empty AI response");

    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON found in AI output");

    return JSON.parse(match[0]);
}

// ⚙️ main loop
async function run(prompt) {
    let context = prompt;

    for (let i = 0; i < 5; i++) {
        const output = await askAI(context);

        let action;
        try {
            action = extractJSON(output);
        } catch (err) {
            console.log("❌ Failed to parse AI output:");
            console.log(output);
            return;
        }

        console.log(`STEP ${i + 1}:`, action);

        handle(action);

        if (action.type === "done") {
            console.log("✅ DONE");
            break;
        }

        context = `
Previous action:
${JSON.stringify(action)}

Continue the task. Return JSON only.
        `;
    }
}

// 🚀 START
const readline = require("readline");

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

rl.question("Prompt > ", async (input) => {
    await run(input);
    rl.close();
});