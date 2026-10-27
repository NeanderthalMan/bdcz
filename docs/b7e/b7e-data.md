### Run a script with the data environment this worktree needs — `b7e-data`

A worktree carries only tracked files, so a git-LFS asset such as
`reference/maps/web/elevation.bin` is a 132-byte pointer there while the main checkout
holds the real bytes. Three delmar sessions (`dv-k4n.70`, `dv-k4n.73`, `dv-k4n.105`)
pointed scripts at the main checkout by hand over twenty-five times, under two different
variable names (`ATLAS_ELEVATION_DIR`, `SITE_GRID_DIR`) that are only discoverable by
opening the module that reads them. A script that misses the variable either refuses or
quietly reads the pointer.

```
b7e-data <command> [args...]            run it with the variables set
b7e-data --print                        the export lines, and why each one
b7e-data --path <file> --print          only the entry whose bytes are <file>
b7e-data --discover                     draft .beadcause/data.json from env reads in the source
b7e-data --dir <root> ...               another checkout
```

**The table is the checkout's own**, `.beadcause/data.json`, beside `derived.json`:
`{"vars": [{"var", "reads": [modules], "holds": "<LFS file>", "dir": "<dir the variable names>"}]}`.
`dir` defaults to `holds`' directory. Each entry is resolved with `lib/visible.js`: bytes
real in this tree means no override; a pointer here with real bytes in the main checkout
sets the variable to the main checkout's directory; bytes real nowhere prints which file
and exits `1` without running the command. `--discover` is the heuristic way to draft the
file (a scan for `os.environ.get("X")` / `process.env.X` with a `_DIR`/`_PATH`/`_ROOT`/
`_FILE` name) and says so; every report says the answer came from the manifest.

`@grant excluded`: it execs an arbitrary command, so it is deliberately not on the
agents' read-only list. Exit `2` is bad usage or an unreadable manifest.
