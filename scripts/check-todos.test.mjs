#!/usr/bin/env node

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TRACKED_TODO,
  TODO_TOKEN,
  isCritical,
  extOf,
  isIgnored,
} from "./check-todos.mjs";

describe("check-todos policy", () => {
  it("detects TODO/FIXME tokens", () => {
    assert.equal(TODO_TOKEN.test("// TODO: bare"), true);
    assert.equal(TODO_TOKEN.test("// FIXME(#496): tracked"), true);
    assert.equal(TODO_TOKEN.test("const autodocs = 1"), false);
  });

  it("accepts GitHub issue references in tracked format", () => {
    assert.equal(TRACKED_TODO.test("// TODO(#491): migrate SDK"), true);
    assert.equal(TRACKED_TODO.test("// FIXME(#496): stub"), true);
    assert.equal(TRACKED_TODO.test("// TODO: no ref"), false);
    assert.equal(TRACKED_TODO.test("// TODO(#abc): bad ref"), false);
  });

  it("classifies critical paths for auth, payments, and integrations", () => {
    assert.equal(isCritical("client/lib/payment-service.ts"), true);
    assert.equal(isCritical("client/app/api/auth/route.ts"), true);
    assert.equal(isCritical("backend/src/services/telegram-bot-service.ts"), true);
    assert.equal(isCritical("client/app/page.tsx"), false);
    assert.equal(isCritical("docs/ROADMAP.md"), false);
  });

  it("ignores build artifacts and scans source extensions only", () => {
    assert.equal(isIgnored("client/node_modules/foo.ts"), true);
    assert.equal(isIgnored("client/lib/foo.ts"), false);
    assert.equal(extOf("backend/src/x.ts"), ".ts");
    assert.equal(extOf("README"), "");
  });
});
