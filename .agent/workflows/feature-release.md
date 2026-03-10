---
description: Standard workflow for releasing new features (Branch -> Commit -> PR -> Merge)
---

# Feature Release Workflow

Follow these steps to safely release a new feature to the repository using Git and GitHub CLI.

### 1. Update Documentation & Version
Always ensure the `README.md` is updated with the new feature details, and **bump the version number** in all required locations.
- See [.agent/version_update.md](file:///Users/ericconcha/desarrollo/PMToolkit%20Extension/.agent/version_update.md) for the checklist of files to update.
- Ensure the `README.md` includes screenshots/descriptions of UI changes, new storage keys, or API endpoints.

### 2. Create a Feature Branch
Create a descriptive branch name starting with `feature/`.
// turbo
```bash
git checkout -b feature/[short-feature-name]
```

### 3. Stage and Commit
// turbo
```bash
git add .
git commit -m "feat: [brief description of changes]"
```

### 4. Create Pull Request
Use the GitHub CLI (`gh`) to create the PR.
// turbo
```bash
gh pr create --title "feat: [Feature Name]" --body "[Detailed description of what this PR introduces and fixes]"
```
*Note: If `gh` asks for repository confirmation, press Enter to use the default.*

### 5. Merge and Cleanup
Merge the PR into `main` and delete the feature branch.
// turbo
```bash
gh pr merge --merge --delete-branch
```

### 6. Verify Main
Switch back to `main` and pull the latest changes.
// turbo
```bash
git checkout main
git pull origin main
```
