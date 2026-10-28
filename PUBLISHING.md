# Publishing

Publishing runs from `.github/workflows/publish.yml` using Marketplace trusted publishing (no PAT).

1. Raise `"version"` in `package.json` and commit.
2. Tag and push: `git tag v<version> && git push origin main v<version>`.
3. The workflow type-checks, tests and runs `vsce publish --oidc`.

The workflow can also be started by hand from the Actions tab.

One-time setup: at https://marketplace.visualstudio.com/manage/publishers/vokilam, add a trusted publishing policy for
the `vokilam-d/comet-vscode` repository and the `publish.yml` workflow.
