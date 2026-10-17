const { contextBridge } = require("electron");

const apiArgument = process.argv.find(argument =>
  argument.startsWith("--hardwareops-api=")
);
const apiUrl = apiArgument?.slice("--hardwareops-api=".length);

if (!apiUrl || !/^http:\/\/127\.0\.0\.1:\d+$/.test(apiUrl)) {
  throw new Error("A valid local HardwareOps API URL was not provided.");
}

contextBridge.exposeInMainWorld("HARDWAREOPS_API", apiUrl);
