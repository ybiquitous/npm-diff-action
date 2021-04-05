# `npm diff` Action

This action posts a PR comment including output of the [`npm diff`](https://docs.npmjs.com/cli/v7/commands/npm-diff) command (since npm 7.5.0).

## Usage

TODO...

```yaml
name: npm diff

on:
  pull_request:
    types: [opened]

jobs:
  post-comment:
    if: ${{ contains(github.head_ref, 'dependabot/npm_and_yarn/') }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: ybiquitous/npm-diff-action@v1
```
