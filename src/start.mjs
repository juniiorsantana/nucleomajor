import { createServer } from "./server.mjs";

const portArgument = process.argv.find((argument) => argument.startsWith("--port="))?.split("=")[1];
const port = Number(portArgument || process.env.PORT || 3000);
const host = String(process.env.HOST || "0.0.0.0");

createServer().listen(port, host, () => {
  console.log(`Núcleo Major portal listening on ${host}:${port}`);
});
