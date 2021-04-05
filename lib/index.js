const core = require("@actions/core");
const { exec } = require("@actions/exec");
const github = require("@actions/github");

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
 * @param {string} body
 */
const postComment = (
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
  return client.issues.createComment({
    owner,
    repo,
    body,
    issue_number: Number(number),
  });
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
