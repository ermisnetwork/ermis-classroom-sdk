# Release Process

This document describes the automated release process for Ermis Classroom SDK.

## Quick Start

### Option 1: Manual Release (Recommended)

1. Go to **Actions** tab on GitHub
2. Select **"Release and Publish"** workflow
3. Click **"Run workflow"**
4. Choose version bump type:
   - `patch` - Bug fixes (1.0.0 → 1.0.1)
   - `minor` - New features (1.0.0 → 1.1.0)
   - `major` - Breaking changes (1.0.0 → 2.0.0)
5. Click **"Run workflow"**

### Option 2: Auto Release on Push

Auto-release is configured but you need to enable it:
- The workflow in `.github/workflows/auto-release.yml` will automatically:
  - Bump patch version on every push to main
  - Create a release
  - Publish to GitHub Packages

## What Happens During Release

1. **Version Bump**: Updates version in `package.json`
2. **Commit & Push**: Commits version change to main branch
3. **Build**: Runs `pnpm run build` to create distribution files
4. **Package Preparation**: Creates clean `package.json` in dist folder
5. **GitHub Release**: Creates a new release with tag `v{version}`
6. **Release Assets**: Uploads `.tar.gz` archive of built files
7. **Publish**: Publishes to GitHub Packages (npm registry)

## Files Created/Modified

### Created Files

```
.github/
├── workflows/
│   ├── ci.yml              # CI tests on PRs and pushes
│   ├── release.yml         # Manual release workflow
│   ├── auto-release.yml    # Auto release on push
│   └── README.md           # Workflow documentation
scripts/
└── prepare-dist-package.js # Creates clean package.json for dist
RELEASE.md                  # This file
```

### Modified Files

- `package.json` - Updated build scripts to prepare dist package
- `rollup.config.js` - Removed package.json from copy targets

## Distribution Package Structure

After build, the `dist/` folder contains:

```
dist/
├── ermis-classroom.cjs.js      # CommonJS bundle
├── ermis-classroom.esm.js      # ES Module bundle
├── ermis-classroom.js          # UMD bundle
├── ermis-classroom.min.js      # Minified UMD bundle
├── *.map                       # Source maps
├── opus_decoder/               # Opus decoder files
├── polyfills/                  # Polyfills
├── raptorQ/                    # RaptorQ files
├── workers/                    # Web workers
├── types/                      # TypeScript definitions
├── package.json                # Clean package.json (no dev deps)
├── README.md                   # Documentation
└── LICENSE                     # License file
```

## Publishing Targets

### GitHub Packages (Default)

The package is published to GitHub Packages npm registry:

```bash
# Users need to configure npm
npm config set @ermisnetwork:registry https://npm.pkg.github.com

# Authenticate with GitHub token
npm login --scope=@ermisnetwork --registry=https://npm.pkg.github.com

# Install
npm install @ermisnetwork/ermis-classroom-sdk
```

### GitHub Releases

Each release also creates a downloadable `.tar.gz` file:

1. Go to **Releases** tab
2. Download `ermis-classroom-sdk-{version}.tar.gz`
3. Extract and use directly

### Switch to npm Registry (Optional)

To publish to public npm instead:

1. **Update `scripts/prepare-dist-package.js`**:
   ```javascript
   // Remove or comment out:
   publishConfig: {
     registry: 'https://npm.pkg.github.com'
   },
   ```

2. **Update workflow files** (`.github/workflows/release.yml` and `auto-release.yml`):
   ```yaml
   # Change from:
   registry-url: 'https://npm.pkg.github.com'
   scope: '@ermisnetwork'
   
   # To:
   registry-url: 'https://registry.npmjs.org'
   # Remove scope line
   ```

3. **Add npm token**:
   - Get token from npmjs.com
   - Add as `NPM_TOKEN` secret in GitHub repo settings
   - Update workflow to use `NPM_TOKEN` instead of `GITHUB_TOKEN`

## CI/CD Pipeline

### On Pull Request
- Runs linter
- Runs type checking
- Runs tests
- Builds project
- Validates build output

### On Push to Main
- Same as PR checks
- Optionally triggers auto-release (if enabled)

### On Manual Release
- Bumps version
- Runs full build
- Creates release
- Publishes package

## Version Management

### Automatic (via workflow)
```bash
# Trigger via GitHub Actions UI
# Select patch/minor/major
```

### Manual (via command line)
```bash
# Bump version locally
npm version patch  # or minor, or major

# Push to trigger release
git push origin main
git push origin --tags
```

### Pre-release versions
```bash
# Create pre-release
npm version prerelease --preid=beta
# Results in: 1.0.0 → 1.0.1-beta.0
```

## Troubleshooting

### Build fails in workflow

Check the build locally:
```bash
pnpm install
pnpm run build
ls -la dist/
```

### Publish fails

1. Check repository permissions:
   - Settings > Actions > General > Workflow permissions
   - Enable "Read and write permissions"

2. Verify package.json repository field matches GitHub repo

3. Check GITHUB_TOKEN has packages:write permission

### Version conflicts

```bash
# Pull latest
git pull origin main

# Resolve conflicts
# Edit package.json manually if needed

# Push again
git push origin main
```

### Workflow doesn't trigger

1. Check workflow file syntax (YAML)
2. Verify branch name is correct (main vs master)
3. Check if paths-ignore is blocking the trigger

## Best Practices

1. **Use manual releases** for production versions
2. **Test locally** before releasing:
   ```bash
   pnpm run lint
   pnpm run test
   pnpm run build
   ```
3. **Write meaningful release notes** after release is created
4. **Tag important releases** with additional labels (stable, lts, etc.)
5. **Keep CHANGELOG.md** updated (consider automating this)
6. **Protect main branch** - require PR reviews
7. **Use semantic versioning** consistently

## Security

- Never commit tokens or secrets
- Use GitHub secrets for sensitive data
- Regularly update dependencies
- Review workflow permissions

## Next Steps

1. **Enable workflows**: Push these files to your repository
2. **Test manual release**: Try creating a test release
3. **Configure npm**: Set up authentication for users
4. **Update README**: Add installation instructions
5. **Add CHANGELOG**: Consider adding automated changelog generation
6. **Set up branch protection**: Protect main branch from direct pushes

## Support

For issues with the release process:
1. Check workflow logs in Actions tab
2. Review this documentation
3. Check `.github/workflows/README.md`
4. Open an issue in the repository

