const core = require("@actions/core");
const { exec } = require("@actions/exec");
const github = require("@actions/github");
const { RequestError } = require("@octokit/request-error");

/** @typedef {{ name: string, from: string, to: string }} UpdateInfo */

/**
 * @param {string} text
 * @param {string} pattern
 * @returns {UpdateInfo | null}
 */
const extractUpdateInfo = (text, pattern) => {
  const matched = new RegExp(pattern, "iu").exec(text);
  if (matched == null || matched.groups == null) {
    return null;
  }
  const { name, from, to } = matched.groups;
  if (name == null || from == null || to == null) {
    return null;
  }
  return { name, from, to };
};

/**
 * @param {UpdateInfo} info
 * @returns {[string, string[]]}
 */
const npmDiffCommand = ({ name, from, to }) => [
  "npm",
  ["diff", `--diff=${name}@${from}`, `--diff=${name}@${to}`, "--diff-unified=2"],
];

/**
 * @param {string} cmd
 * @param {string[]} cmdArgs
 */
const runCommand = async (cmd, cmdArgs) => {
  let out = "";
  await exec(cmd, cmdArgs, {
    listeners: {
      stdout: (data) => {
        out += data.toString();
      },
    },
  });
  return out;
};

/**
 * @param {string} cmd
 * @param {string[]} cmdArgs
 * @param {string} diff
 * @param {boolean} truncated
 */
// eslint-disable-next-line max-params
const buildCommentBody = (cmd, cmdArgs, diff, truncated = false) => {
  const cmdLine = [cmd, ...cmdArgs].join(" ");
  return `
<details>
<summary><code>${cmdLine}</code></summary>

\`\`\`\`diff
${diff.trim()}
\`\`\`\`
${truncated ? "\n_(too long so truncated)_\n" : ""}
</details>

Posted by [ybiquitous/npm-diff-action](https://github.com/ybiquitous/npm-diff-action)
`;
};

/**
 * @param {RequestError} error
 */
const maxCharsFromError = (error) => {
  if (error.status === 422) {
    const matched = error.message.match(
      /Body is too long \(maximum is (?<limit>\d+) characters\)/u
    );
    if (matched != null && matched.groups != null) {
      return Number(matched.groups["limit"]); // eslint-disable-line dot-notation -- Prevent TS4111
    }
  }
  return null;
};

/**
 * @param {string} cmd
 * @param {string[]} cmdArgs
 * @param {string} diff
 * @param {{ client: ReturnType<github.getOctokit>, repository: string, number: string }} options
 */
// eslint-disable-next-line max-statements
const postComment = async (
  cmd,
  cmdArgs,
  diff,
  { client, repository, number } = {
    client: github.getOctokit(core.getInput("token")),
    repository: core.getInput("repository"),
    number: core.getInput("pull_request_number"),
  }
  // eslint-disable-next-line max-params
) => {
  const [owner, repo] = repository.split("/");
  if (owner == null || repo == null) {
    throw new Error(`"${repository}" is an invalid repository`);
  }

  const callApi = (/** @type {string} */ commentBody) =>
    client.issues.createComment({
      owner,
      repo,
      issue_number: Number(number),
      body: commentBody,
    });

  try {
    await callApi(buildCommentBody(cmd, cmdArgs, diff));
    return;
  } catch (error) {
    if (error instanceof RequestError) {
      const maxChars = maxCharsFromError(error);
      if (typeof maxChars === "number") {
        core.info("Retring the API call because the request body is too long...");
        const bufferChars = 500;
        const body = buildCommentBody(cmd, cmdArgs, diff.slice(0, maxChars - bufferChars), true);
        await callApi(body);
        return;
      }
    }
    throw error;
  }
};

const run = async () => {
  await core.group("Show npm version", () => exec("npm", ["--version"]));

  await core.group("Install the latest npm", () =>
    exec("sudo", ["npm", "install", "--global", "npm@latest"])
  );

  const updateInfo = await core.group("Extract update information", () => {
    const title = core.getInput("pull_request_title");
    const pattern = core.getInput("extract_regexp");
    const info = extractUpdateInfo(title, pattern);
    if (info == null) {
      core.info("The pull request title does not match the pattern. Skipped.");
      core.info(`- title: "${title}"`);
      core.info(`- pattern: "${pattern}"`);
    }
    return Promise.resolve(info);
  });
  if (updateInfo == null) return;

  const [cmd, cmdArgs] = npmDiffCommand(updateInfo);
  const diff = await core.group("Run npm diff", () => runCommand(cmd, cmdArgs));
  await core.group("Post comment", () => postComment(cmd, cmdArgs, diff));
};

if (process.env["NODE_ENV"] !== "test") {
  run().catch((error) => core.setFailed(error.message));
}

// For test
module.exports = { extractUpdateInfo, npmDiffCommand, buildCommentBody, postComment };
