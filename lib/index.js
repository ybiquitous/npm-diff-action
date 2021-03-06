import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import * as core from "@actions/core";
import { exec, getExecOutput } from "@actions/exec";
import { getOctokit } from "@actions/github";
import { RequestError } from "@octokit/request-error";
import { bytesToSize, numSign } from "./utils.js";

/** @typedef {{ name: string, from: string, to: string }} UpdateInfo */

/** @typedef {{ fileCount: number, size: number }} PackageInfo */

/** @typedef {{ node: string, npm: string, self: string }} Versions */

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
  let ret;
  try {
    ret = await runCommand("npm", ["view", "--json", pkg, "dist"]);
  } catch (error) {
    // TODO: Use `{ cause: error }` option. See https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Error/Error#browser_compatibility
    throw new Error(`Failed to get package info of "${pkg}" due to: ${error}`);
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
 *   versions: Versions,
 *   truncated?: boolean,
 * }} args
 */
export const buildCommentBody = ({
  cmd,
  cmdArgs,
  diff,
  packageInfo,
  versions,
  truncated = false,
}) => {
  const cmdLine = [cmd, ...cmdArgs].join(" ");
  const sizeDiff = numSign(bytesToSize(packageInfo.to.size - packageInfo.from.size));
  const filesDiff = numSign(`${packageInfo.to.fileCount - packageInfo.from.fileCount}`);
  const self = `ybiquitous/npm-diff-action v${versions.self}`;
  const selfUrl = "https://github.com/ybiquitous/npm-diff-action";
  const runtime = `Node.js v${versions.node}; npm v${versions.npm}`;

  return `
<details>
<summary><code>${cmdLine}</code></summary>

\`\`\`\`diff
${diff.trim()}
\`\`\`\`
${truncated ? "\n_(too long so truncated)_\n" : ""}
</details>

- Size: ${bytesToSize(packageInfo.from.size)} ??? **${bytesToSize(
    packageInfo.to.size
  )}** (${sizeDiff})
- Files: ${packageInfo.from.fileCount} ??? **${packageInfo.to.fileCount}** (${filesDiff})

Posted by [${self}](${selfUrl}) (${runtime})
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
 *   versions: Versions,
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
  versions,
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
    await callApi(buildCommentBody({ cmd, cmdArgs, diff, packageInfo, versions }));
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
          versions,
          truncated: true,
        });
        await callApi(body);
        return;
      }
    }
    throw error;
  }
};

/**
 * @returns {Promise<Versions>}
 */
const showVersions = async () => {
  const versionJson = await runCommand("npm", ["version", "--json"]);
  const version = JSON.parse(versionJson);
  if (!(version && version.node && version.npm)) {
    throw new Error(`Invalid versions: '${versionJson}'`);
  }

  const packageJson = await readFile(new URL("../package.json", import.meta.url).pathname);
  const pkg = JSON.parse(packageJson.toString());
  if (!(pkg && pkg.version)) {
    throw new Error(`Invalid package.json: '${packageJson}'`);
  }

  return { node: version.node, npm: version.npm, self: pkg.version };
};

const run = async () => {
  await core.group("Install the latest npm", () =>
    exec("npm", ["install", "--global", "npm@latest"])
  );

  const versions = await core.group("Show runtime versions", () => showVersions());

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
    postComment({
      cmd,
      cmdArgs,
      diff,
      packageInfo: { from: oldPackageInfo, to: newPackageInfo },
      versions,
    })
  );
};

if (process.env["NODE_ENV"] !== "test") {
  run().catch((error) => core.setFailed(error.message));
}
