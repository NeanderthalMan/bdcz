### A webseries episode's measured facts — frames, runtime, and the beat timings — `b7e-episode`

`bc-dgx7.105`, filed by the session audit against three delmar sessions (`dv-2uu.6`,
`dv-2uu.5`, `dv-2uu.3`) that each had to establish the same facts about one
`webseries/episodes/<name>/` directory by hand, before a single post about it could be
written — a different way each time. `dv-2uu.6` ran `ls`/`cat`/`afinfo`/`ffprobe` by hand.
`dv-2uu.5` wrote a python heredoc apportioning the audio duration across
`transcript.json`'s paragraphs, and found `script.txt`/`transcript.json`/`prompts.json`/
`moods.json` disagreeing in entry count — a real defect, not noise. `dv-2uu.3`
re-implemented `make_episode.py`'s own `build_beats` to get the beat boundaries, then
checked them against an `ffmpeg` scene-detect pass on the rendered video. These numbers
are load-bearing, not incidental: `publicity/ASSET_INDEX.md` and every queue file's
`asset:` line assert exactly them, and two of the three sessions above shipped
corrections after getting them wrong by hand.

```
b7e-episode kazran-orves                      bare name, resolved under
                                               <repo root>/webseries/episodes
b7e-episode webseries/episodes/kazran-orves    an explicit directory, relative to cwd
b7e-episode kazran-orves --json
b7e-episode --all                              every episode under webseries/episodes
```

**The beat count that matches the video is not `transcript.json`'s paragraph count.**
`lib/episode.js`'s `computeBeats` joins the transcript paragraphs, resplits at sentence
boundaries, and regroups into `n = max(minBeats, min(maxBeats, round(total/secondsPerBeat)))`
beats by word count — for `kazran-orves`, `n` is 12, not the 14 raw paragraphs
`transcript.json` holds. Verified against the real episode while this was written (not
part of `test/episode.mjs`, which must not depend on a sibling checkout —
a-real-repo-assertion-in-a-test-rots-between-your-run-and-ci): calling `computeBeats`
with `total = duration(audio.mp3)` (the narration track, before the 4-second title card
is prepended) and offsetting every start by that 4 seconds
reproduces every one of `ffmpeg`'s own scene-detect boundaries in the rendered
`kazran-orves.mp4`, to the millisecond, at any threshold from 0.1 to 0.3 — including the
exact sequence `4 46.4 90.7 133.466667 175.1` this bead's own filed description quotes
(that turned out to be `alban-orves`, not `kazran-orves` as the surrounding prose
implied — the same shape as acceptance-criteria-can-be-stale-vs-a-later-comment).

**Those four numbers are the renderer's, so they are defaults rather than literals.**
`BEAT_DEFAULTS` in `lib/episode.js` holds `secondsPerBeat: 28`, `minBeats: 5`,
`maxBeats: 12`, `minBeatSeconds: 2.0` and `titleSeconds: 4.0` — the values
`make_episode.py`'s own `build_beats` uses, which is what this implementation was verified
against — and `computeBeats(lines, total, options)` takes an override for any of them.
`bc-1r15j` is why: beadcause carries a beat-splitting algorithm that a caller parameterises,
not one renderer's constants baked into a beadcause command, and a second copy of somebody
else's magic numbers is a thing that drifts against the original in silence.

**The golden fixture is synthetic, and the reproduction is still exact.** `computeBeats`
reads only where the sentence boundaries fall and how many words are in each sentence — it
never reads the words. So `test/fixtures/beat-corpus.json` carries the original's 91
sentences across its 14 paragraphs with each sentence's word count preserved and nothing
else of it, and lands the same 12 beats with the same durations to the last bit. That
property is asserted in `test/episode.mjs` rather than assumed, so if `computeBeats` ever
starts reading the text itself, the suite says so instead of quietly becoming an
approximation. No episode transcript is stored in this repo.

**Nothing here fails just because an episode is not finished.** An episode with no
rendered `.mp4`, no audio, or no `transcript.json` (four of the nine directories under
`webseries/episodes` today have only `images/` and `prompts.json`) says so in a
`problems` line and still reports everything else — frame counts, title card, whatever
source files are present — exit `0` either way. `--all` scans every directory under
`<repo root>/webseries/episodes` the same way, one block each.

`lib/episode.js` holds the measurement (`measureEpisode`, `computeBeats`,
`resolveEpisodeDir`, `discoverEpisodes`); `bin/b7e-episode` is the argv parsing and the
printing, the same split every other `b7e-*` command in this family already uses.

Exit codes: `0` ran to completion, whatever it found — a missing file is reported, not a
failure. `2` bad usage, or no such episode directory. `4` `--all` found no
`webseries/episodes` directory to scan.
