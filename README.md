# `npm diff` Action

This action posts a PR comment including output of the [`npm diff`](https://docs.npmjs.com/cli/v7/commands/npm-diff) command (since npm 7.5.0).

## Usage

TODO...

```yaml
name: npm diff

on:
  pull_request:
    types: [assigned]

jobs:
  post-comment:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: ybiquitous/npm-diff-action@v1
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
```
