import * as core from "@actions/core";
import { exec, getExecOutput } from "@actions/exec";
import { getOctokit } from "@actions/github";
import { RequestError } from "@octokit/request-error";
import { bytesToSize, numSign } from "./utils.js";

/** @typedef {{ name: string, from: string, to: string }} UpdateInfo */

/** @typedef {{ fileCount: number, size: number }} PackageInfo */

/**
 * @param {string} text
 * @param {string} pattern
 * @returns {UpdateInfo | null}
 */
export const extractUpdateInfo = (text, pattern) => {
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
export const npmDiffCommand = ({ name, from, to }) => [
  "npm",
  ["diff", `--diff=${name}@${from}`, `--diff=${name}@${to}`, "--diff-unified=2"],
];

/**
 * @param {string} cmd
 * @param {string[]} cmdArgs
 */
const runCommand = async (cmd, cmdArgs) => (await getExecOutput(cmd, cmdArgs)).stdout;

/**
 * @param {string} name
 * @param {string} version
 * @returns {Promise<PackageInfo>}
 */
export const getPackageInfo = async (name, version) => {
  const pkg = `${name}@${version}`;
  const ret = await runCommand("npm", ["view", "--json", pkg, "dist"]);
  if (ret === "") {
    throw new Error(`No package info of ${pkg}`);
  }
  const info = JSON.parse(ret);
  return { fileCount: Number(info.fileCount), size: Number(info.unpackedSize) };
};

/**
 * @param {{
 *   cmd: string,
 *   cmdArgs: string[],
 *   diff: string,
 *   packageInfo: { from: PackageInfo, to: PackageInfo },
 *   truncated?: boolean,
 * }} args
 */
export const buildCommentBody = ({ cmd, cmdArgs, diff, packageInfo, truncated = false }) => {
  const cmdLine = [cmd, ...cmdArgs].join(" ");
  const sizeDiff = numSign(bytesToSize(packageInfo.to.size - packageInfo.from.size));
  const filesDiff = numSign(`${packageInfo.to.fileCount - packageInfo.from.fileCount}`);

  return `
<details>
<summary><code>${cmdLine}</code></summary>

\`\`\`\`diff
${diff.trim()}
\`\`\`\`
${truncated ? "\n_(too long so truncated)_\n" : ""}
</details>

- Size: ${bytesToSize(packageInfo.from.size)} → **${bytesToSize(
    packageInfo.to.size
  )}** (${sizeDiff})
- Files: ${packageInfo.from.fileCount} → **${packageInfo.to.fileCount}** (${filesDiff})

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
 * @param {{
 *   cmd: string,
 *   cmdArgs: string[],
 *   diff: string,
 *   packageInfo: { from: PackageInfo, to: PackageInfo },
 *   client?: ReturnType<getOctokit>,
 *   repository?: string,
 *   pullNumber?: string,
 * }} args
 */
// eslint-disable-next-line max-statements
export const postComment = async ({
  cmd,
  cmdArgs,
  diff,
  packageInfo,
  client = getOctokit(core.getInput("token")),
  repository = core.getInput("repository"),
  pullNumber = core.getInput("pull_request_number"),
}) => {
  const [owner, repo] = repository.split("/");
  if (owner == null || repo == null) {
    throw new Error(`"${repository}" is an invalid repository`);
  }

  const callApi = (/** @type {string} */ commentBody) =>
    client.rest.issues.createComment({
      owner,
      repo,
      issue_number: Number(pullNumber),
      body: commentBody,
    });

  try {
    await callApi(buildCommentBody({ cmd, cmdArgs, diff, packageInfo }));
    return;
  } catch (error) {
    if (error instanceof RequestError) {
      const maxChars = maxCharsFromError(error);
      if (typeof maxChars === "number") {
        core.info("Retring the API call because the request body is too long...");
        const bufferChars = 500;
        const body = buildCommentBody({
          cmd,
          cmdArgs,
          diff: diff.slice(0, maxChars - bufferChars),
          packageInfo,
          truncated: true,
        });
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
    exec("npm", ["install", "--global", "npm@latest"])
  );

  const updateInfo = await core.group("Extract update information", () => {
    const title = core.getInput("pull_request_title");
    const pattern = core.getInput("extract_regexp");
    const info = extractUpdateInfo(title, pattern);
    if (info == null) {
      core.info("The pull request title does not match the pattern. Abort.");
      core.info(`- title: "${title}"`);
      core.info(`- pattern: "${pattern}"`);
    }
    return Promise.resolve(info);
  });
  if (updateInfo == null) return;

  const [cmd, cmdArgs] = npmDiffCommand(updateInfo);

  const diff = await core.group("Run npm diff", () => runCommand(cmd, cmdArgs));

  const oldPackageInfo = await core.group("Get old package info", () =>
    getPackageInfo(updateInfo.name, updateInfo.from)
  );
  const newPackageInfo = await core.group("Get new package info", () =>
    getPackageInfo(updateInfo.name, updateInfo.to)
  );

  await core.group("Post comment", () =>
    postComment({ cmd, cmdArgs, diff, packageInfo: { from: oldPackageInfo, to: newPackageInfo } })
  );
};

if (process.env["NODE_ENV"] !== "test") {
  run().catch((error) => core.setFailed(error.message));
}
