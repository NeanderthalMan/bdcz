### Put the exhibit on a card, with the paths checked the way the phone reads them — `b7e-exhibit`

`bc-dgx7.166`: four sessions — `dv-gr6.131`, `dv-gr6.36`, `dv-gr6.13`, `dv-5eu.70` — each
put a draft, an audit or an image on a card by hand, four different ways, and none of them
ended green. `dv-gr6.131` filed two cards, then wrote a scratch script to dump both with
`bd show --json`, rebuild each description with a `docs:` block and write them back — and
the workspace's own gate answered `[worktree]`, then, after it rewrote the paths to the
main-checkout form, `[missing]`. `dv-gr6.36` made the opposite call on the same fact and
named the audit in prose with no link at all. `dv-gr6.13` linked a chapter it had written
that hour, sitting on its own unmerged branch, and was told `no such file`. `dv-5eu.70` tried
to fetch an image into its worktree so the card could show it, twice, and sent the packet
text-only. They were all reasoning about one fact — **a card can only show what the main
checkout has** — and none had a way to be told which side of the merge a path was on.

```
b7e-exhibit -w delmar -b dv-abc --doc /abs/…/AUDIT.md                     one document
b7e-exhibit -w delmar -b dv-abc --doc /abs/A.md --label "the audit" --image /abs/p.png
b7e-exhibit -w delmar -b dv-abc --link "PR #268"=https://github.com/…/pull/268
b7e-exhibit -w delmar -b dv-abc --doc /abs/A.md --dry-run --json
b7e-exhibit -w delmar -b dv-abc --check                                   what the card already links
b7e-exhibit -w delmar --check                                             every open card
```

**Why `lib/reachable.js` was not the answer.** It holds one coarse verdict — is this
checkout on trunk? — reached only through `b7e-packet`, at filing time. The question the
four sessions actually had is per path, and about a card that already exists. And when the
branch is not trunk its advice is to publish an Artifact, which a workspace whose cards are
read on a phone under a different account cannot use: Artifact links are account-bound.

**The path written is always the main-checkout form.** The daemon serves the main checkout,
never a worktree, so a path under the worktree works while it is tested and 404s the day the
tidy sweep retires it. A path under this branch's worktree — or under any other
`.claude/worktrees/<name>/` of the same repo — is translated, and the line says so
(`/…/worktrees/feat/docs/A.md → /…/repo/docs/A.md`).

**One verdict per path**, and the two that may go on a card:

| verdict | meaning |
|---|---|
| `live` | a file is at that path in the main checkout now |
| `after-merge` | not there yet, but committed on this branch (or on the `--at` base ref); it opens once the branch lands and the checkout advances |

Everything else can never open on a phone without something other than merging changing
first, so writing one is refused: `uncommitted` (on disk in the worktree only — commit it),
`gitignored` (no merge will carry it), `stub` (an LFS pointer, or a `<file>.md` sidecar
standing in for media with no bytes on this Mac), `outside-roots` (`/api/asset` answers 403)
and `missing`. **`after-merge` is the distinction `dv-gr6.131` and `dv-gr6.36` resolved in
opposite directions**: a workspace gate that requires the file to exist in the main checkout
will say missing until the branch merges, and that is the gate being right rather than a
mistake — the command says so, in words, when it writes one.

**Malformed input is refused before the tracker is read**, each with its own exit code so a
session can tell "I typed it wrong" from "it is not merged yet": a URL or a beadcause route
under `--doc`/`--image` (`3` — it would be opened as `/doc?p=<url>`, a 404; use `--link`), an
extension `/api/asset` will not serve, or a `.md` under `--image` (`4`), a relative path or a
bare `%`-escape (`5`). One bad path among good ones refuses the lot (`6` for a verdict that
cannot open): a half-written card is worse than none.

**The write is text surgery, and idempotent.** A card with a drawn `decision` block gets
`docs:` / `images:` / `links:` entries added to that block, in place — appended to the list
already there in its own indent, or as a new key at the end — leaving every other line, and
every comment in the block, byte for byte. (A YAML round trip would have re-printed them.)
The block edited is the one `toQuestion` draws, in whichever of `description`, `design`
and `notes` holds it — never a copy in another field, which would be shadowed. A card with
no block gets an `**Up for review**` list on its description, with `file://…%20…` for a path
with a space, because that is the one spelling the prose linkifier survives. Entries already
on the card are skipped, so running the same call twice writes nothing the second time.
After the write it reads the card back and refuses (`7`) to call it done unless every path
is there. `docs:` written inline (`docs: [a, b]`) cannot be extended without re-printing it,
and exits `8` having written nothing.

**`--check` writes nothing.** It reads what a card already carries and reports each entry
with the same verdicts, plus the ones only a card can earn: a URL or route under `docs:`, a
relative path, an unservable extension, a `worktree` path (with the main-checkout form to use
instead), a markdown link whose absolute path has a space in it (`spaced-link`), an approval
labelled `needs-approval` that links nothing (`unlinked`), and a file named in prose that is
in the main checkout and linked by nothing on the card (`dead-path`) — per file, not per
card. A question with nothing to show and nothing named is not a finding; plenty of
questions are pure invention. Without `-b` it walks every open card (type `decision`, or
labelled `human`), reading them in batched `bd show`s because a list row carries neither
`design` nor `notes`. Run against the delmar tracker it reproduces the five dead links
`check_card_exhibits.py` found (`dv-3vlp`, `dv-a4af`, and three on `dv-t6a1`).

`--at <ref>` is the ref treated as the delivery base — the one a file must be on to count as
landed, defaulting to the trunk `lib/reachable.js` resolves. `--dir` is the checkout "this
branch" means, where the cwd is not it. Outside a git checkout every path is judged on the
filesystem alone: with no branch there is no `after-merge` to be had.

Exit codes: `0` written, already there, or a `--check` with nothing wrong; `1` usage, an
unconfigured workspace, or no such bead; `2` `--check` found something a phone cannot open;
`3`/`4`/`5` a malformed path (above), `6` a path that can never open, `7` the write went out
and the readback disagreed, `8` the block cannot be edited in place. All of `3`–`6` and `8`
leave the card untouched.

**On `DEFAULT_TOOL_LIST`**: `@grant excluded` in its own header. Its bare `--check` form only
reads, but the write is one flag away and the grant is per file, not per argv — the
`b7e-apply`/`b7e-swbump` precedent. See `bin/b7e-exhibit`, `lib/exhibit.js` and
`test/b7eexhibit.mjs`. `IMAGE_EXT` / `DOC_EXT` in `lib/exhibit.js` mirror the lists in
`lib/server.js`, which cannot be imported without booting the daemon; the suite reads
`server.js` and fails on any difference.
