import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, test, mock, afterEach } from "node:test";
import assert from "node:assert/strict";

// eslint-disable-next-line n/no-extraneous-import -- Avoid increasing dependencies.
import * as yaml from "js-yaml";

import {
  extractUpdateInfo,
  npmDiffCommand,
  buildCommentBody,
  postComment,
  getPackageInfo,
} from "../lib/index.js";

function assertContain(string, substring) {
  assert.ok(string.includes(substring), `"${string}" does not contain "${substring}"`);
}

afterEach(() => {
  mock.reset();
});

describe("extractUpdateInfo()", () => {
  const REGEX = yaml.load(readFileSync(new URL("../action.yml", import.meta.url), "utf8")).inputs
    .extract_regexp.default;

  test("matched", () => {
    assert.deepEqual(extractUpdateInfo("Bump foo from 1.2.3 to 1.2.4", REGEX), {
      name: "foo",
      from: "1.2.3",
      to: "1.2.4",
    });
  });

  test("matched with prefix", () => {
    assert.deepEqual(extractUpdateInfo("chore(deps): bump foo from 1.2.3 to 1.2.4", REGEX), {
      name: "foo",
      from: "1.2.3",
      to: "1.2.4",
    });
  });

  test("matched with suffix", () => {
    assert.deepEqual(extractUpdateInfo("Bump foo from 1.2.3 to 1.2.4 in /app", REGEX), {
      name: "foo",
      from: "1.2.3",
      to: "1.2.4",
    });
  });

  test("matched with another action", () => {
    assert.deepEqual(extractUpdateInfo("update foo from 1.2.3 to 1.2.4", REGEX), {
      name: "foo",
      from: "1.2.3",
      to: "1.2.4",
    });
  });

  test("matched without 'from'", () => {
    assert.deepEqual(extractUpdateInfo("bump foo 1.2.3 to 1.2.4", REGEX), {
      name: "foo",
      from: "1.2.3",
      to: "1.2.4",
    });
  });

  test("matched with 'v' prefixes", () => {
    assert.deepEqual(extractUpdateInfo("bump foo from v1.2.3 to v1.2.4", REGEX), {
      name: "foo",
      from: "1.2.3",
      to: "1.2.4",
    });
  });

  test("unmatched", () => {
    assert.equal(extractUpdateInfo("Bump foo from 1.2.3 to", REGEX), null);
  });
});

describe("npmDiffCommand()", () => {
  test("success", () => {
    const [cmd, args] = npmDiffCommand({ name: "typescript", from: "4.2.3", to: "4.2.4" });
    assert.ok(
      execFileSync(cmd, args, { encoding: "utf8" }),
      `diff --git a/package.json b/package.json
index v4.2.3..v4.2.4 100644
--- a/package.json
+++ b/package.json
@@ -3,5 +3,5 @@`,
    );
  });

  test("failure", () => {
    const [cmd, args] = npmDiffCommand({ name: "typescript", from: "4.2.3", to: "unknown" });
    assert.throws(() => execFileSync(cmd, args, { encoding: "utf8" }), "Command failed: npm diff");
  });
});

describe("buildCommentBody()", () => {
  const [cmd, cmdArgs] = npmDiffCommand({ name: "foo", from: "1.2.3", to: "1.2.4" });

  const diff = `
diff --git a/index.js b/index.js
index v1.2.3..v1.2.4 100644
--- a/index.js
+++ b/index.js
@@ -6,7 +6,6 @@
 		'footer-leading-blank': [1, 'always'],
 		'footer-max-line-length': [2, 'always', 100],
 		'header-max-length': [2, 'always', 100],
-		'scope-case': [2, 'always', 'lower-case'],
 		'subject-case': [
 			2,
 			'never',
`;

  const packageInfo = Object.freeze({
    from: { name: "foo", version: "1.2.3", fileCount: 23, size: 1089 },
    to: { name: "foo", version: "1.2.4", fileCount: 34, size: 956 },
  });

  const versions = Object.freeze({
    node: "18.0.0",
    npm: "8.8.0",
    self: "1.2.0",
  });

  test("normal case", () => {
    assert.equal(
      buildCommentBody({ cmd, cmdArgs, diff, packageInfo, versions }),
      `
<details>
<summary>Diff between <a href="https://www.npmjs.com/package/foo">foo</a> 1.2.3 and 1.2.4</summary>

\`\`\`\`diff
diff --git a/index.js b/index.js
index v1.2.3..v1.2.4 100644
--- a/index.js
+++ b/index.js
@@ -6,7 +6,6 @@
 		'footer-leading-blank': [1, 'always'],
 		'footer-max-line-length': [2, 'always', 100],
 		'header-max-length': [2, 'always', 100],
-		'scope-case': [2, 'always', 'lower-case'],
 		'subject-case': [
 			2,
 			'never',
\`\`\`\`

</details>

| Size | Files |
|------|-------|
| 1.1 KB → **956 B** (-133 B 🟢) | 23 → **34** (+11 🟡) |

<details>
<summary>Command details</summary>

\`\`\`shell
npm diff --diff=foo@1.2.3 --diff=foo@1.2.4 --diff-unified=2
\`\`\`

See also the [\`npm diff\`](https://docs.npmjs.com/cli/commands/npm-diff) document.

</details>

Reported by [ybiquitous/npm-diff-action@v1.2.0](https://github.com/ybiquitous/npm-diff-action) (Node.js 18.0.0 and npm 8.8.0)
`,
    );
  });

  test("size diff", () => {
    const fileCount = 1;
    const args = (from, to) => ({
      cmd,
      cmdArgs,
      diff,
      versions,
      packageInfo: { from: { fileCount, size: from }, to: { fileCount, size: to } },
    });
    assertContain(buildCommentBody(args(2, 1)), "(-1 B 🟢)");
    assertContain(buildCommentBody(args(1, 2)), "(+1 B 🟡)");
    assertContain(buildCommentBody(args(1, 1)), "(±0 B 🟢)");
  });

  test("files diff", () => {
    const size = 1;
    const args = (from, to) => ({
      cmd,
      cmdArgs,
      diff,
      versions,
      packageInfo: { from: { fileCount: from, size }, to: { fileCount: to, size } },
    });
    assertContain(buildCommentBody(args(2, 1)), "(-1 🟢)");
    assertContain(buildCommentBody(args(1, 2)), "(+1 🟡)");
    assertContain(buildCommentBody(args(1, 1)), "(±0 🟢)");
  });
});

describe("postComment()", () => {
  const packageInfo = Object.freeze({
    from: { name: "foo", version: "1.0.0", fileCount: 23, size: 1089 },
    to: { name: "foo", version: "2.0.0", fileCount: 34, size: 956 },
  });

  const versions = Object.freeze({
    node: "18.0.0",
    npm: "8.8.0",
    self: "1.2.0",
  });

  test("normal case", async (t) => {
    const createComment = mock.fn(() => Promise.resolve("OK"));

    await postComment({
      cmd: "cmd",
      cmdArgs: ["arg"],
      diff: "some diff",
      packageInfo,
      versions,
      client: { rest: { issues: { createComment } } },
      repository: "foo/bar",
      pullNumber: "123",
    });

    assert.equal(createComment.mock.calls.length, 1);
    t.assert.snapshot(createComment.mock.calls[0].arguments);
  });

  test("too long body", async (t) => {
    let callCount = 0;
    const createComment = mock.fn(() => {
      if (callCount === 0) {
        callCount++;
        const error = new Error("Body is too long (maximum is 5000 characters)");
        error.name = "HttpError";
        return Promise.reject(error);
      }
      return Promise.resolve("OK");
    });

    await postComment({
      cmd: "cmd",
      cmdArgs: ["arg"],
      diff: "diff-".repeat(10000),
      packageInfo,
      versions,
      client: { rest: { issues: { createComment } } },
      repository: "foo/bar",
      pullNumber: "123",
    });

    assert.equal(createComment.mock.calls.length, 2);
    // eslint-disable-next-line n/no-unsupported-features/node-builtins
    assert.partialDeepStrictEqual(createComment.mock.calls[0].arguments, [
      {
        owner: "foo",
        repo: "bar",
        issue_number: 123,
      },
    ]);
    // eslint-disable-next-line n/no-unsupported-features/node-builtins
    assert.partialDeepStrictEqual(createComment.mock.calls[1].arguments, [
      {
        owner: "foo",
        repo: "bar",
        issue_number: 123,
      },
    ]);
    t.assert.snapshot(createComment.mock.calls[0].arguments[0].body);
    t.assert.snapshot(createComment.mock.calls[1].arguments[0].body);
  });

  test("unexpected error", async () => {
    const error = new Error("Foo");
    const createComment = mock.fn(() => Promise.reject(error));

    await assert.rejects(() => {
      return postComment({
        cmd: "cmd",
        cmdArgs: ["arg"],
        diff: "some diff",
        packageInfo,
        versions,
        client: { rest: { issues: { createComment } } },
        repository: "foo/bar",
        pullNumber: "123",
      });
    }, error);
  });
});

describe("getPackageInfo()", () => {
  test("success", async () => {
    assert.deepEqual(await getPackageInfo("npm", "7.20.0"), {
      name: "npm",
      version: "7.20.0",
      fileCount: 2469,
      size: 12195007,
    });
  });

  test("failure", async () => {
    await assert.rejects(
      () => getPackageInfo("npm", "7.20.100"),
      /Failed to get package info of "npm@7\.20\.100" due to:/u,
    );
  });
});
