# Contributing

Thanks for helping. Bug reports, ideas and pull requests are all welcome.

## Setup
```
pnpm install && pnpm --dir web install
pnpm build:web
pnpm start            # http://localhost:3777
```
For UI work, run `pnpm dev:web` (Vite with hot reload on http://localhost:5173) next to the server.
Restart the server after changing anything in `src/`.

## Before you open a pull request
- Run `pnpm test` and make sure it passes.
- Keep each pull request to one concern, with small focused commits.
- Use [Conventional Commits](https://www.conventionalcommits.org): `type(scope): short imperative summary`
  (`feat`, `fix`, `docs`, `refactor`, `test`, `chore`...).
- Add a `node:test` test in `test/` for new non-trivial logic.

## Code conventions
- Colours are OKLCH everywhere (UI CSS, generated designs, tokens).
- Motion: animate transform/opacity only, never `transition: all`, gate hover styles behind
  `(hover:hover) and (pointer:fine)`, and give every animation a `prefers-reduced-motion` variant.
- Reuse before building: a shadcn component or a well-maintained library before custom UI.
- Comments explain the **why** (a constraint, a trade-off, a gotcha), not what the code already says.
- [CLAUDE.md](CLAUDE.md) has the architecture notes that are easy to get wrong.

## Security
The server binds to 127.0.0.1 only and sanitizes all HTML. Keep it that way: render untrusted text with
`textContent`, never `innerHTML`. Please report security problems privately (GitHub's "Report a vulnerability"
on the Security tab) instead of in a public issue.
