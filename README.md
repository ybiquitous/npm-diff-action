# `npm diff` Action

This action posts a PR comment including output of the [`npm diff`](https://docs.npmjs.com/cli/commands/npm-diff) command (added with npm 7.5.0).

## Usage

Create a `.github/workflows/npm-diff.yml` file with the content below:

```yaml
name: npm diff

on:
  pull_request:
    types: [assigned]

jobs:
  npm-diff:
    if: ${{ startsWith(github.head_ref, 'dependabot/npm_and_yarn/') }}
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v2
      - uses: ybiquitous/npm-diff-action@v1
```

See also an [example](https://github.com/ybiquitous/npm-diff-action/pull/202#issuecomment-1336095687).

![Screenshot of a pull request comment](screenshot.png)
