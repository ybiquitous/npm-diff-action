import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import { jest } from "@jest/globals"; // eslint-disable-line import/no-extraneous-dependencies
import { RequestError } from "@octokit/request-error";

// eslint-disable-next-line import/no-extraneous-dependencies -- Avoid increasing dependencies.
import yaml from "js-yaml";

import {
  extractUpdateInfo,
  npmDiffCommand,
  buildCommentBody,
  postComment,
  getPackageInfo,
} from "../lib/index.js";

// eslint-disable-next-line max-lines-per-function
describe("extractUpdateInfo()", () => {
  const REGEX = yaml.load(readFileSync(new URL("../action.yml", import.meta.url), "utf8")).inputs
    .extract_regexp.default;

  test("matched", () => {
    expect(extractUpdateInfo("Bump foo from 1.2.3 to 1.2.4", REGEX)).toEqual({
      name: "foo",
      from: "1.2.3",
      to: "1.2.4",
    });
  });

  test("matched with prefix", () => {
    expect(extractUpdateInfo("chore(deps): bump foo from 1.2.3 to 1.2.4", REGEX)).toEqual({
      name: "foo",
      from: "1.2.3",
      to: "1.2.4",
    });
  });

  test("matched with suffix", () => {
    expect(extractUpdateInfo("Bump foo from 1.2.3 to 1.2.4 in /app", REGEX)).toEqual({
      name: "foo",
      from: "1.2.3",
      to: "1.2.4",
    });
  });

  test("matched with another action", () => {
    expect(extractUpdateInfo("update foo from 1.2.3 to 1.2.4", REGEX)).toEqual({
      name: "foo",
      from: "1.2.3",
      to: "1.2.4",
    });
  });

  test("matched without 'from'", () => {
    expect(extractUpdateInfo("bump foo 1.2.3 to 1.2.4", REGEX)).toEqual({
      name: "foo",
      from: "1.2.3",
      to: "1.2.4",
    });
  });

  test("matched with 'v' prefixes", () => {
    expect(extractUpdateInfo("bump foo from v1.2.3 to v1.2.4", REGEX)).toEqual({
      name: "foo",
      from: "1.2.3",
      to: "1.2.4",
    });
  });

  test("unmatched", () => {
    expect(extractUpdateInfo("Bump foo from 1.2.3 to", REGEX)).toBeNull();
  });
});

describe("npmDiffCommand()", () => {
  test("success", () => {
    const [cmd, args] = npmDiffCommand({ name: "typescript", from: "4.2.3", to: "4.2.4" });
    expect(execFileSync(cmd, args, { encoding: "utf8" }))
      .toContain(`diff --git a/package.json b/package.json
index v4.2.3..v4.2.4 100644
--- a/package.json
+++ b/package.json
@@ -3,5 +3,5 @@`);
  });

  test("failure", () => {
    const [cmd, args] = npmDiffCommand({ name: "typescript", from: "4.2.3", to: "unknown" });
    expect(() => execFileSync(cmd, args, { encoding: "utf8" })).toThrow("Command failed: npm diff");
  });
});

// eslint-disable-next-line max-lines-per-function
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
    expect(buildCommentBody({ cmd, cmdArgs, diff, packageInfo, versions })).toEqual(`
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

Posted by [ybiquitous/npm-diff-action@v1.2.0](https://github.com/ybiquitous/npm-diff-action) (Node.js 18.0.0 and npm 8.8.0)
`);
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
    expect(buildCommentBody(args(2, 1))).toContain("(-1 B 🟢)");
    expect(buildCommentBody(args(1, 2))).toContain("(+1 B 🟡)");
    expect(buildCommentBody(args(1, 1))).toContain("(±0 B 🟢)");
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
    expect(buildCommentBody(args(2, 1))).toContain("(-1 🟢)");
    expect(buildCommentBody(args(1, 2))).toContain("(+1 🟡)");
    expect(buildCommentBody(args(1, 1))).toContain("(±0 🟢)");
  });
});

// eslint-disable-next-line max-lines-per-function
describe("postComment()", () => {
  const errorResponse = (status, message) =>
    Promise.reject(new RequestError(message, status, { request: { url: "", headers: {} } }));

  const packageInfo = Object.freeze({
    from: { name: "foo", version: "1.0.0", fileCount: 23, size: 1089 },
    to: { name: "foo", version: "2.0.0", fileCount: 34, size: 956 },
  });

  const versions = Object.freeze({
    node: "18.0.0",
    npm: "8.8.0",
    self: "1.2.0",
  });

  test("normal case", async () => {
    const createComment = jest.fn();
    createComment.mockReturnValueOnce(Promise.resolve("OK"));

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

    expect(createComment.mock.calls).toHaveLength(1);
    expect(createComment.mock.calls[0]).toMatchSnapshot();
  });

  test("too long body", async () => {
    const createComment = jest.fn();
    createComment.mockReturnValueOnce(
      errorResponse(422, "Body is too long (maximum is 5000 characters)")
    );
    createComment.mockReturnValueOnce(Promise.resolve("OK"));

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

    expect(createComment.mock.calls).toHaveLength(2);
    expect(createComment.mock.calls[0]).toEqual([
      {
        owner: "foo",
        repo: "bar",
        issue_number: 123,
        body: expect.any(String),
      },
    ]);
    expect(createComment.mock.calls[1]).toEqual([
      {
        owner: "foo",
        repo: "bar",
        issue_number: 123,
        body: expect.any(String),
      },
    ]);
    expect(createComment.mock.calls[0][0].body).toMatchSnapshot();
    expect(createComment.mock.calls[1][0].body).toMatchSnapshot();
  });

  test("unexpected error", () => {
    const createComment = jest.fn();
    createComment.mockReturnValueOnce(errorResponse(500, "Foo"));

    return expect(
      postComment({
        cmd: "cmd",
        cmdArgs: ["arg"],
        diff: "some diff",
        packageInfo,
        versions,
        client: { rest: { issues: { createComment } } },
        repository: "foo/bar",
        pullNumber: "123",
      })
    ).rejects.toBeInstanceOf(RequestError);
  });
});

describe("getPackageInfo()", () => {
  test("success", async () => {
    await expect(getPackageInfo("npm", "7.20.0")).resolves.toEqual({
      name: "npm",
      version: "7.20.0",
      fileCount: 2469,
      size: 12195007,
    });
  });

  test("failure", async () => {
    await expect(getPackageInfo("npm", "7.20.100")).rejects.toThrow(
      /Failed to get package info of "npm@7\.20\.100" due to:/u
    );
  });
});
