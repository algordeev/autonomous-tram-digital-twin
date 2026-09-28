# GitHub Publishing

## Before the first push

1. Choose and add a public-use `LICENSE`, or intentionally retain
   `UNLICENSED` for source-visible but non-reusable publication.
2. Review author data in `CITATION.cff`.
3. Run `npm run test:all`.
4. Confirm `git diff --cached --check` is empty.

## Create the first commit

```bash
git commit -m "Initial public release"
```

Create an empty GitHub repository named `autonomous-tram-digital-twin` without
adding a generated README, licence or `.gitignore`. Then connect it:

```bash
git remote add origin https://github.com/YOUR-USER/autonomous-tram-digital-twin.git
git push -u origin main
```

## GitHub Pages

The repository contains `.github/workflows/pages.yml`. In GitHub repository
settings, open **Pages** and select **GitHub Actions** as the source. A push to
`main` or a manual workflow run builds and deploys `dist/`.

## Recommended repository settings

- Require pull requests and passing `Build and test` checks for `main` after the
  initial push;
- enable Dependabot security updates;
- disable merge commits if a linear history is preferred;
- add topics: `tram`, `digital-twin`, `webassembly`, `transport-simulation`,
  `regenerative-braking`, `flywheel-energy-storage`;
- add the deployed Pages URL to the repository description.

## First release

After CI and Pages succeed:

```bash
git tag -a v1.0.0 -m "Autonomous Tram Digital Twin v1.0.0"
git push origin v1.0.0
```

Create a GitHub release from the tag and attach the clean source archive if a
single downloadable package is useful. Describe current limitations and link
to `docs/DATA_AND_ASSUMPTIONS.md` and `docs/EXPERIMENTS.md`.
