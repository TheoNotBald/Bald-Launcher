const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

const ROOT = __dirname;

function safe(p) {
    const full = path.resolve(ROOT, p);
    if (!full.startsWith(ROOT)) throw new Error("Blocked path");
    return full;
}

function write_file(filePath, content) {
    const full = safe(filePath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf8");
    console.log("WROTE:", filePath);
}

function run_cmd(cmd) {
    console.log("RUN:", cmd);

    exec(cmd, { cwd: ROOT }, (err, out, errout) => {
        if (err) console.error("ERROR:", err.message);
        if (out) console.log(out);
        if (errout) console.error(errout);
    });
}

function handle(action) {
    if (!action?.type) return;

    switch (action.type) {
        case "write_file":
            write_file(action.path, action.content);
            break;

        case "run_cmd":
            run_cmd(action.cmd);
            break;

        case "done":
            console.log("✅ AI finished");
            break;

        default:
            console.log("Unknown action:", action);
    }
}

module.exports = { handle };