const { spawn } = require("child_process");
const serverProcess = spawn("node", ["dist/node/examples/server.js"], {
  stdio: "inherit",
});

setTimeout(async () => {
  const open = await import("open");
  await open.default("http://localhost:8082");
}, 1000);

serverProcess.on("close", (code) => process.exit(code));
