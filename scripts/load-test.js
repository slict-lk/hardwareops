import "dotenv/config";

const baseUrl = (process.env.LOAD_TEST_BASE_URL || "http://localhost:4000").replace(/\/+$/, "");
const email = process.env.AUTH_BOOTSTRAP_EMAIL;
const password = process.env.AUTH_BOOTSTRAP_PASSWORD;
const concurrency = Number(process.env.LOAD_TEST_CONCURRENCY || 56);
const endpoints = [
  "/api/me",
  "/api/login",
  "/api/tax-codes",
  "/api/invoices",
  "/api/items",
  "/api/users",
  "/api/suppliers",
  "/api/grns",
  "/api/services"
];

if (!email || !password) {
  throw new Error("Set AUTH_BOOTSTRAP_EMAIL and AUTH_BOOTSTRAP_PASSWORD to run the load test.");
}
if (!Number.isSafeInteger(concurrency) || concurrency < 56) {
  throw new Error("LOAD_TEST_CONCURRENCY must be an integer of at least 56.");
}

async function postLogin() {
  return fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  });
}

const loginResponse = await postLogin();
if (!loginResponse.ok) {
  throw new Error(`Login preflight failed with HTTP ${loginResponse.status}.`);
}
const { token } = await loginResponse.json();
if (!token) throw new Error("Login preflight did not return a token.");

const requests = Array.from({ length: concurrency }, async (_, index) => {
  const endpoint = endpoints[index % endpoints.length];
  const response = endpoint === "/api/login"
    ? await postLogin()
    : await fetch(`${baseUrl}${endpoint}`, {
      headers: { authorization: `Bearer ${token}` }
    });
  const text = await response.text();

  if (response.status >= 200 && response.status < 300) {
    return { endpoint, status: response.status };
  }
  if (response.status === 503) {
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`${endpoint} returned a non-JSON 503 response.`);
    }
    if (body.error !== "database_busy" || !response.headers.has("retry-after")) {
      throw new Error(`${endpoint} returned an invalid database_busy response.`);
    }
    return { endpoint, status: response.status };
  }
  throw new Error(`${endpoint} returned unexpected HTTP ${response.status}.`);
});

const results = await Promise.all(requests);
const counts = results.reduce((summary, result) => {
  summary[result.status] = (summary[result.status] || 0) + 1;
  return summary;
}, {});
console.log(JSON.stringify({ concurrency, results: counts }));
