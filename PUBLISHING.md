# Publishing Boardroom

The Boardroom v1 source is published to `sparklabhqx/Boardroom` on the `main` branch. This workspace uses the SSH host alias `github-sparklabhqx`, which points at `~/.ssh/id_ed25519_github_sparklabhqx`.

The working HTTPS remote originally could not push because every available HTTPS or app-based write path was blocked:

- The GitHub app has read-only access to `sparklabhqx/Boardroom`.
- The GitHub contents API returned `403 Resource not accessible by integration`.
- HTTPS Git push has no usable username/token.
- Plain SSH Git push to `github.com` failed with `Permission denied (publickey)`.
- `~/.config/gh/hosts.yml` does not contain a GitHub token, and `gh` is not installed.

## Push From This Workspace

Use the configured SSH alias:

```bash
cd /Users/flo/Boardroom
git push git@github-sparklabhqx:sparklabhqx/Boardroom.git main:main
```

## Import From Bundle

The verified bundle can recreate the local `main` branch:

```bash
cd /tmp
git clone /Users/flo/Boardroom/boardroom-v1.bundle Boardroom-import
cd Boardroom-import
git remote set-url origin https://github.com/sparklabhqx/Boardroom.git
git push -u origin main
```

## Apply Patch

The patch can be applied into a fresh empty clone:

```bash
git clone https://github.com/sparklabhqx/Boardroom.git Boardroom-import
cd Boardroom-import
git am /Users/flo/Boardroom/0001-Build-Boardroom-v1.patch
git push -u origin main
```

## Source Zip

`boardroom-v1-source.zip` contains only the committed project source. It excludes `node_modules`, `dist`, and local handoff artifacts.
