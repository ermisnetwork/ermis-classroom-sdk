# GitHub Actions Workflows

This directory contains automated workflows for releasing and publishing the Ermis Classroom SDK.

## Workflows

### 1. Manual Release (`release.yml`)

**Trigger:** Manual workflow dispatch

**Purpose:** Manually trigger a release with version bump control

**How to use:**
1. Go to GitHub Actions tab
2. Select "Release and Publish" workflow
3. Click "Run workflow"
4. Choose version bump type (patch/minor/major)
5. Click "Run workflow"

**What it does:**
- Bumps version in package.json based on your selection
- Commits and pushes version change to main branch
- Builds the project
- Creates a GitHub Release with built files
- Publishes package to GitHub Packages (npm registry)

### 2. Auto Release (`auto-release.yml`)

**Trigger:** Push to main branch (excluding docs, examples, tests)

**Purpose:** Automatically create releases when code changes are pushed

**What it does:**
- Detects if version was manually changed (skips if yes)
- Auto-bumps patch version
- Commits version change with `[skip ci]` to avoid loops
- Builds the project
- Creates a GitHub Release
- Publishes to GitHub Packages

**Note:** This workflow is disabled by default. To enable it, uncomment the workflow or rename it.

## Setup Requirements

### 1. GitHub Packages Configuration

The package is configured to publish to GitHub Packages. Users will need to:

```bash
# Configure npm to use GitHub Packages for @ermisnetwork scope
npm config set @ermisnetwork:registry https://npm.pkg.github.com

# Authenticate (requires GitHub personal access token with read:packages scope)
npm login --scope=@ermisnetwork --registry=https://npm.pkg.github.com
```

### 2. Installation for Users

```bash
# Install from GitHub Packages
npm install @ermisnetwork/ermis-classroom-sdk

# Or install from GitHub Release (direct download)
# Download the .tar.gz file from releases and extract
```

### 3. Alternative: Publish to npm Registry

If you want to publish to the public npm registry instead:

1. Update `scripts/prepare-dist-package.js`:
   - Remove or comment out the `publishConfig` section

2. Update workflow files:
   - Change `registry-url` from `https://npm.pkg.github.com` to `https://registry.npmjs.org`
   - Remove `scope: '@ermisnetwork'`
   - Change `NODE_AUTH_TOKEN` to use `NPM_TOKEN` secret

3. Add NPM_TOKEN secret:
   - Go to repository Settings > Secrets and variables > Actions
   - Add new secret named `NPM_TOKEN` with your npm access token

## Version Bumping

### Semantic Versioning

- **patch** (1.0.0 → 1.0.1): Bug fixes, minor changes
- **minor** (1.0.0 → 1.1.0): New features, backward compatible
- **major** (1.0.0 → 2.0.0): Breaking changes

### Manual Version Control

You can also manually update the version in `package.json` and push:

```bash
npm version patch  # or minor, or major
git push origin main
```

The auto-release workflow will detect this and skip auto-bumping.

## Workflow Outputs

Each release creates:

1. **Git Tag**: `v{version}` (e.g., v1.0.3)
2. **GitHub Release**: With release notes and downloadable assets
3. **Release Asset**: `.tar.gz` archive of built files
4. **Package**: Published to GitHub Packages

## Troubleshooting

### Workflow fails with "permission denied"

Ensure the repository has the following permissions enabled:
- Settings > Actions > General > Workflow permissions
- Select "Read and write permissions"
- Check "Allow GitHub Actions to create and approve pull requests"

### Package publish fails

1. Verify `GITHUB_TOKEN` has `packages: write` permission
2. Check that package name matches repository structure
3. Ensure package.json has correct `repository` field

### Version conflict

If you get version conflicts:
1. Pull latest changes: `git pull origin main`
2. Resolve conflicts in package.json
3. Push again

## Disabling Auto-Release

To disable automatic releases on push:

1. Delete `.github/workflows/auto-release.yml`
2. Or rename it to `auto-release.yml.disabled`
3. Use only manual releases via `release.yml`

## CI/CD Best Practices

1. **Use manual releases** for production-ready versions
2. **Use auto-release** for continuous deployment of development builds
3. **Tag releases** with meaningful release notes
4. **Test before release** - consider adding a test job before publishing
5. **Protect main branch** - require PR reviews before merging

