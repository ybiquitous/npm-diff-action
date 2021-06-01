import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import { jest } from "@jest/globals"; // eslint-disable-line import/no-extraneous-dependencies
import { RequestError } from "@octokit/request-error";

// eslint-disable-next-line import/no-extraneous-dependencies -- Avoid increasing dependencies.
import yaml from "js-yaml";

import { extractUpdateInfo, npmDiffCommand, buildCommentBody, postComment } from "../lib/index.js";

// eslint-disable-next-line max-lines-per-function
describe("extractUpdateInfo()", () => {
  const REGEX = yaml.safeLoad(readFileSync(new URL("../action.yml", import.meta.url), "utf8"))
    .inputs.extract_regexp.default;

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

  test("normal case", () => {
    expect(buildCommentBody(cmd, cmdArgs, diff)).toEqual(`
<details>
<summary><code>npm diff --diff=foo@1.2.3 --diff=foo@1.2.4 --diff-unified=2</code></summary>

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

Posted by [ybiquitous/npm-diff-action](https://github.com/ybiquitous/npm-diff-action)
`);
  });
});

// eslint-disable-next-line max-lines-per-function
describe("postComment()", () => {
  const errorResponse = (status, message) =>
    Promise.reject(new RequestError(message, status, { request: { url: "", headers: {} } }));

  test("normal case", async () => {
    const createComment = jest.fn();
    createComment.mockReturnValueOnce(Promise.resolve("OK"));

    await postComment("cmd", ["arg"], "some diff", {
      client: { issues: { createComment } },
      repository: "foo/bar",
      number: "123",
    });

    expect(createComment.mock.calls).toHaveLength(1);
    expect(createComment.mock.calls[0]).toMatchInlineSnapshot(
      [
        {
          owner: "foo",
          repo: "bar",
          body: expect.any(String),
          issue_number: 123,
        },
      ],
      `
      Array [
        Object {
          "body": Any<String>,
          "issue_number": 123,
          "owner": "foo",
          "repo": "bar",
        },
      ]
    `
    );
  });

  test("too long body", async () => {
    const createComment = jest.fn();
    createComment.mockReturnValueOnce(
      errorResponse(422, "Body is too long (maximum is 1000 characters)")
    );
    createComment.mockReturnValueOnce(Promise.resolve("OK"));

    await postComment("cmd", ["arg"], "diff-".repeat(1000), {
      client: { issues: { createComment } },
      repository: "foo/bar",
      number: "123",
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
      postComment("cmd", ["arg"], "some diff", {
        client: { issues: { createComment } },
        repository: "foo/bar",
        number: "123",
      })
    ).rejects.toBeInstanceOf(RequestError);
  });
});
