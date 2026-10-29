# Publishing

Publishing runs from `.github/workflows/publish.yml` using Marketplace trusted publishing (no PAT).

1. Raise `"version"` in `package.json` and commit.
2. Tag and push: `v="v$(npm pkg get version | tr -d '"')" && git tag "$v" && git push origin main "$v"`
3. The workflow type-checks, tests and runs `vsce publish --oidc`.

The workflow can also be started by hand from the Actions tab.

One-time setup: at https://marketplace.visualstudio.com/manage/publishers/vokilam, add a trusted publishing policy for
the `vokilam-d/comet-vscode` repository and the `publish.yml` workflow.
