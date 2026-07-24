import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MatrixRunSession } from "../lib/matrix-run-session.ts";
import {
  InvalidJsonRequestError,
  readJsonObjectRequest,
  rejectUnsafeJsonRequest,
} from "../lib/request-security.ts";

const projectRoot = new URL("../", import.meta.url);

function jsonRequest(hostname, contentType = "application/json") {
  return new Request(`http://${hostname}/api/run`, {
    method: "POST",
    headers: { "content-type": contentType },
    body: "{}",
  });
}

test("excludes credentials, local deployment metadata, and generated output", () => {
  const ignored = new Set(
    readFileSync(new URL(".gitignore", projectRoot), "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#")),
  );

  for (const pattern of [
    ".env*",
    "!.env.example",
    ".dev.vars*",
    "/.openai/",
    "/.wrangler/",
    "/node_modules",
    "/.next/",
    "/dist/",
    "*.pem",
  ]) {
    assert.ok(ignored.has(pattern), `missing sensitive-file exclusion: ${pattern}`);
  }

  const envEntries = readFileSync(new URL(".env.example", projectRoot), "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  assert.deepEqual(envEntries, ["OPENAI_API_KEY="]);
});

test("ships without private registries or hosting-only dependencies", () => {
  const packageJson = JSON.parse(
    readFileSync(new URL("package.json", projectRoot), "utf8"),
  );
  const lockfile = JSON.parse(
    readFileSync(new URL("package-lock.json", projectRoot), "utf8"),
  );
  const publicDependencies = new Set([
    "@tailwindcss/postcss",
    "@types/node",
    "@types/react",
    "@types/react-dom",
    "eslint",
    "eslint-config-next",
    "next",
    "react",
    "react-dom",
    "tailwindcss",
    "typescript",
  ]);

  assert.ok(
    Object.keys(packageJson.scripts).every((name) => !name.includes(":")),
  );
  assert.ok(
    Object.keys({
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    }).every((name) => publicDependencies.has(name)),
  );

  for (const metadata of Object.values(lockfile.packages)) {
    if (typeof metadata.resolved === "string") {
      assert.equal(new URL(metadata.resolved).hostname, "registry.npmjs.org");
    }
  }
});

test("keeps a background run separate from the selected preset", () => {
  const session = new MatrixRunSession();
  const run = session.start();

  assert.equal(session.isActive(run), true);
  assert.equal(session.isDisplayed(run), true);

  session.detach();

  assert.equal(session.isActive(run), true);
  assert.equal(session.isDisplayed(run), false);
  assert.equal(session.finish(run), false);
  assert.equal(session.isActive(run), false);
});

test("ignores results from canceled and superseded matrix runs", () => {
  const session = new MatrixRunSession();
  const canceled = session.start();

  session.cancel();
  assert.equal(session.isActive(canceled), false);
  assert.equal(session.isDisplayed(canceled), false);
  assert.equal(session.finish(canceled), null);

  const older = session.start();
  const newer = session.start();

  assert.equal(session.isActive(older), false);
  assert.equal(session.finish(older), null);
  assert.equal(session.isDisplayed(newer), true);
  assert.equal(session.finish(newer), true);
});

test("accepts genuine loopback hosts and rejects loopback-lookalike domains", () => {
  for (const hostname of [
    "localhost",
    "demo.localhost",
    "127.0.0.1",
    "127.255.255.255",
    "[::1]",
  ]) {
    assert.equal(rejectUnsafeJsonRequest(jsonRequest(hostname)), null);
  }

  for (const hostname of [
    "0.0.0.0",
    "127.attacker.example",
    "127.0.0.1.attacker.example",
    "example.com",
  ]) {
    assert.equal(
      rejectUnsafeJsonRequest(jsonRequest(hostname))?.code,
      "local_only",
    );
  }
});

test("requires the exact JSON media type", () => {
  assert.equal(
    rejectUnsafeJsonRequest(
      jsonRequest("localhost", "application/json; charset=utf-8"),
    ),
    null,
  );

  for (const contentType of ["application/jsonp", "application/json-patch"]) {
    assert.equal(
      rejectUnsafeJsonRequest(jsonRequest("localhost", contentType))?.code,
      "unsupported_media_type",
    );
  }
});

test("classifies malformed and non-object JSON as client errors", async () => {
  for (const [body, expectedCode] of [
    ["{", "invalid_json"],
    ["null", "invalid_request"],
    ["[]", "invalid_request"],
  ]) {
    await assert.rejects(
      readJsonObjectRequest(
        new Request("http://localhost/api/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        }),
      ),
      (error) =>
        error instanceof InvalidJsonRequestError && error.code === expectedCode,
    );
  }
});
