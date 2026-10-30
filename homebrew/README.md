# homebrew-collected

The Homebrew tap for [`collected-cli`](https://www.npmjs.com/package/collected-cli), the command-line client for [collected](https://collected.priyamkabra.com), the open-source student dashboard.

```sh
brew install priyam-k/collected/collected-cli
collected init --local
```

`brew upgrade collected-cli` (or `collected upgrade`, which notices it was installed by Homebrew) moves to the newest release. The fully qualified install line above is all Homebrew 7 needs: it adds this tap and trusts this one formula, nothing else. If you `brew tap priyam-k/collected` first instead, Homebrew asks you to `brew trust priyam-k/collected` before it installs.

The formula installs the package npm published, with its dependencies, under Homebrew's own `node`. Its source of truth is [`homebrew/Formula/collected-cli.rb`](https://github.com/priyam-k/collected/tree/main/homebrew) in the main repository: every CLI release's workflow rewrites `url` and `sha256` from the published tarball and pushes the result here, so this tap always matches npm. Nothing is edited in this repository by hand; report problems at [priyam-k/collected](https://github.com/priyam-k/collected/issues).
