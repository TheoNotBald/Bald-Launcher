# Publishing Windows updates

Windows releases are built and published to the public GitHub Releases page by
the `Publish Windows release` workflow. The workflow runs when a version tag is
pushed, builds the NSIS installer, and uploads the installer and
`latest.yml` metadata required by the in-app updater.

To publish a release:

1. Set `version` in `package.json` to the new semantic version (for example,
   `0.1.1`) and commit the change.
2. Push the commit to GitHub.
3. Create and push the matching tag (for example, `v0.1.1`):

   ```powershell
   git tag v0.1.1
   git push origin v0.1.1
   ```

The tag must match `package.json`. GitHub Actions uses its short-lived
`GITHUB_TOKEN`; no personal access token or paid hosting is required. Check the
Actions run and the GitHub Releases page to confirm the installer and
`latest.yml` were uploaded.

The workflow publishes a public, non-draft release so the in-app updater can
discover it.

To publish the current `package.json` version without pushing a tag, open
**Actions → Publish Windows release → Run workflow** on the `main` branch.

Install the published NSIS installer to test updating. The `win-unpacked`
development folder is not the supported installation target for applying
updates.
