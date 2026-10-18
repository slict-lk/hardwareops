import { app, initializeAuthSchema } from "../server.js";

let initialization;

export default async function handler(req, res) {
  try {
    initialization ??= initializeAuthSchema().catch(error => {
      initialization = undefined;
      throw error;
    });
    await initialization;
  } catch (error) {
    console.error("Failed to initialize HardwareOps API:", error);
    return res.status(500).json({ error: "The API could not connect to its database." });
  }

  return app(req, res);
}
