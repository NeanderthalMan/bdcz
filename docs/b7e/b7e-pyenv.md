### Which local Python env already has the packages a probe needs, and which model weights are cached — `b7e-pyenv`

`bc-dgx7.180` is the same discovery made five times by hand. Five loremia sessions
(`lm-52r.55`, `lm-52r.61`, `lm-52r.56`, `lm-52r.57`, `lm-52r.62`) each independently
worked out which local Python interpreter already has `torch`/`diffusers`/`fal_client`
and how big a model already sitting in the shared Hugging Face cache actually is —
testing system `python3` for `torch` and hitting `ModuleNotFoundError`, globbing a
scratchpad for a venv a prior session built and finding none (it had vanished with that
session), `du -sh`-ing the cache directory by directory. Two of those sessions built a
fresh venv in a scratchpad rather than finding the one that already existed, because
nothing recorded where it was.

```
b7e-pyenv -w loremia --need torch,diffusers,transformers   which env has all three, or "none"
b7e-pyenv -w loremia --need fal_client                     a need nothing local has → "none"
b7e-pyenv -w loremia --model IP-Adapter                    Hugging Face cache entries matching this substring
b7e-pyenv -w loremia --json                                the machine-readable form
b7e-pyenv -w loremia --dir /path/to/checkout                a checkout other than ~/projects/loremia
```

The candidates it probes, in the order it tries them: `python3` on `PATH`; this repo's
own `.venv`/`.pwenv`/`.ltxenv`/`venv`/`env`, whichever a builder actually used;
`~/.local/share/<workspace>/*env` (the durable location `lm-52r.55` moved a venv into on
purpose, because a repo checkout's own venvs are not gitignored); and any scratchpad
venv still on disk from a session that has ended, bounded to 30 days old so a years-old
orphan is never offered as though it were live. Each row it prints names the
interpreter, its own Python version, each `--need` module's installed version or
`missing`, and — only when `torch` was asked for and found — whether that interpreter's
torch sees Apple's MPS backend.

The Hugging Face cache half reads `~/.cache/huggingface/hub` the way `huggingface_hub`
itself lays it out: real content lives in each entry's `blobs/`, and `snapshots/<rev>/`
holds symlinks to it under the names a model's files actually carry — a diffusers-format
repo nests a weight file a folder deep per component
(`image_encoder/model.safetensors`), so this walks every snapshot file recursively
rather than reading one directory's flat listing, which was the one real bug the first
version of this shipped with: a flat read sees only the component folder's name and
never the weight file inside it, misreporting a multi-gigabyte model as **metadata
only**. An entry reads as metadata only when nothing under its snapshots carries a
weight extension (`.safetensors`, `.bin`, `.ckpt`, `.pt`, `.pth`, `.onnx`, `.gguf`,
`.msgpack`, `.h5`) — a config/tokenizer-only pull, exactly what `lm-52r.57` found by
hand for one Depth-Anything variant — rather than by a size guess.

It never installs anything and never writes anywhere: every interpreter and every cache
entry it reports on already existed before it ran. Exit code is always `0` — "nothing
here has what you asked for yet" is a real, useful answer, not a refusal — except `2`
for a bad invocation: no `-w`, or a workspace `lib/config.js` does not know and no
`--dir` given instead.
