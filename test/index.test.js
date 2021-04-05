const {
  extractUpdateInfo,
  npmDiffCommand,
  buildCommentBody,
  postComment,
} = require("../lib/index");

describe("extractUpdateInfo()", () => {
  test("matched", () => {
    expect(extractUpdateInfo("Bump foo from 1.2.3 to 1.2.4")).toEqual({
      name: "foo",
      from: "1.2.3",
      to: "1.2.4",
    });
  });

  test("matched with prefix", () => {
    expect(extractUpdateInfo("chore(deps): bump foo from 1.2.3 to 1.2.4")).toEqual({
      name: "foo",
      from: "1.2.3",
      to: "1.2.4",
    });
  });

  test("matched with suffix", () => {
    expect(extractUpdateInfo("Bump foo from 1.2.3 to 1.2.4 in /app")).toEqual({
      name: "foo",
      from: "1.2.3",
      to: "1.2.4",
    });
  });

  test("unmatched", () => {
    expect(() => {
      extractUpdateInfo("Bump foo from 1.2.3 to");
    }).toThrow('"[bB]ump (\\S+) from (\\S+) to (\\S+)" does not match "Bump foo from 1.2.3 to"');
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
<summary><code>npm diff --diff=foo@1.2.3 --diff=foo@1.2.4</code></summary>

\`\`\`diff
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
\`\`\`

</details>
`);
  });
});

describe("postComment()", () => {
  test("normal case", async () => {
    const createComment = jest.fn();
    createComment.mockReturnValueOnce(Promise.resolve("OK"));

    const result = await postComment("test body", {
      client: { issues: { createComment } },
      repository: "foo/bar",
      number: "123",
    });
    expect(result).toEqual("OK");

    expect(createComment.mock.calls.length).toEqual(1);
    expect(createComment.mock.calls[0]).toEqual([
      {
        owner: "foo",
        repo: "bar",
        body: "test body",
        issue_number: 123,
      },
    ]);
  });
});
