const core = require("@actions/core");
const { exec } = require("@actions/exec");
const github = require("@actions/github");
const { RequestError } = require("@octokit/request-error");

/** @typedef {{ name: string, from: string, to: string }} UpdateInfo */

/**
 * @returns {UpdateInfo}
 */
const extractUpdateInfo = (
  title = core.getInput("pull_request_title"),
  regexp = core.getInput("extract_regexp") || "[bB]ump (\\S+) from (\\S+) to (\\S+)"
) => {
  const matched = new RegExp(regexp, "u").exec(title);
  if (matched == null || matched[1] == null || matched[2] == null || matched[3] == null) {
    throw new Error(`"${regexp}" does not match "${title}"`);
  }
  return { name: matched[1], from: matched[2], to: matched[3] };
};

/**
 * @param {UpdateInfo} info
 * @returns {[string, string[]]}
 */
const npmDiffCommand = ({ name, from, to }) => [
  "npm",
  ["diff", `--diff=${name}@${from}`, `--diff=${name}@${to}`],
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
 */
const buildCommentBody = (cmd, cmdArgs, diff) => {
  const cmdLine = [cmd, ...cmdArgs].join(" ");
  return `
<details>
<summary><code>${cmdLine}</code></summary>

\`\`\`\`diff
${diff.trim()}
\`\`\`\`

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
 * @param {string} body
 * @param {{ client: ReturnType<github.getOctokit>, repository: string, number: string }} options
 */
// eslint-disable-next-line max-statements
const postComment = async (
  body,
  { client, repository, number } = {
    client: github.getOctokit(core.getInput("token")),
    repository: core.getInput("repository"),
    number: core.getInput("pull_request_number"),
  }
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
    await callApi(body);
    return;
  } catch (error) {
    if (error instanceof RequestError) {
      // NOTE: Retry the API call when the body is too long.
      const limit = maxCharsFromError(error);
      if (typeof limit === "number") {
        await callApi(body.slice(0, limit));
        return;
      }
    }
    throw error;
  }
};

const run = async () => {
  try {
    await exec("npm", ["--version"]);

    // TODO: `npm diff` is available since npm 7.5.0. In future Node versions, this code should be removed.
    await exec("sudo", ["npm", "install", "--global", "npm@latest"]);

    const info = extractUpdateInfo();
    const [cmd, cmdArgs] = npmDiffCommand(info);
    const diff = await runCommand(cmd, cmdArgs);
    const body = buildCommentBody(cmd, cmdArgs, diff);
    await postComment(body);
  } catch (error) {
    core.setFailed(error.message);
  }
};

if (process.env["NODE_ENV"] !== "test") {
  run();
}

// For test
module.exports = { extractUpdateInfo, npmDiffCommand, buildCommentBody, postComment };
