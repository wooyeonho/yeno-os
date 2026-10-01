# Bundled Three.js provenance

- Upstream: https://github.com/mrdoob/three.js
- Version: `0.186.0` (`r186`), pinned npm tarball `three-0.186.0.tgz`
- Upstream `r186` tag commit: `48dd7be01263658aad497fd72e09d1e4c6213461` (`git ls-remote --tags`, read-only).
- Tarball: https://registry.npmjs.org/three/-/three-0.186.0.tgz
- npm SRI: `sha512-cr/fIM2ddMSVbYVgkfD4jLJv7Fh/8ZTjvo+7gQeSVGUZHxpx9FDwoL5iC7hUz/LiRA8wMbqfnb90xKfm1/HHkQ==`
- License: MIT; the unmodified upstream `LICENSE` is kept beside the bundle.
- `three.core.js` SHA-256: `9edde002b066a9a05676a6127f67735b62baf399bdea529f2f7e31657da769e6`
- `three.module.js` SHA-256: `9052042d676cb0fdc1ddfefe193053f34b7ac0513a616fdac4535d49987812ea`

Only these two browser modules from `package/build/` are served, through the
runtime's exact static allowlist. No CDN or build-time fetch is required when
the resident starts. This does not grant other external code execution rights.
