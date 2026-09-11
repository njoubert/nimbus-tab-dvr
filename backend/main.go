// Copyright (C) 2026 Niels Joubert
// SPDX-License-Identifier: MIT

// The demo backend, and the reference implementation of the upload contract the extension
// speaks: a stand-in for the client's backend, in the shape theirs takes.
//
// It serves the built demo application from files embedded at build time and, on the same
// origin so the page needs no CORS, a recordings API that takes each chunk as the extension
// produces it, remuxes the whole with ffmpeg at stop so the file has a duration and cues,
// and serves the result with range requests so a scrubber works.
//
// Usage: nimbus-demo-backend [-listen ADDR] [-data DIR] [-static DIR] [-pack-listen ADDR] [-pack-dir DIR]
//
// The routes:
//
//	POST   /api/recordings/{id}/chunks/{sequence}   body: the chunk; headers: X-Recording-Key, Content-Type
//	POST   /api/recordings/{id}/stop                body: { chunks, bytes, reason? }
//	GET    /api/recordings                          every recording, newest first
//	GET    /api/recordings/{id}.webm                the finalized file, range requests honoured
//	DELETE /api/recordings/{id}
//
// -static serves the demo pages from a directory instead of the embedded copy, for editing
// them without a rebuild. The packed extension on 8765 is for the managed-install tools in
// scripts/spike and is served only if its directory exists.
package main

import (
	"embed"
	"flag"
	"io/fs"
	"log"
	"net/http"
	"os"
)

// The demo pages, copied into static/ by build.sh from dist/demo before `go build`, because
// an embed pattern cannot reach outside the module directory.
//
//go:embed all:static
var embedded embed.FS

func main() {
	listen := flag.String("listen", "127.0.0.1:5173", "address for the demo and the recordings API")
	data := flag.String("data", ".build-demo/recordings", "directory the recordings are stored under")
	static := flag.String("static", "", "serve the demo pages from this directory instead of the embedded copy")
	packListen := flag.String("pack-listen", "127.0.0.1:8765", "address for the packed extension, for the managed-install tools")
	packDir := flag.String("pack-dir", "dist/pack", "directory holding the packed extension and its update manifest")
	flag.Parse()

	var pages fs.FS
	if *static != "" {
		pages = os.DirFS(*static)
	} else {
		sub, err := fs.Sub(embedded, "static")
		if err != nil {
			log.Fatal(err)
		}
		pages = sub
	}

	store, err := newStore(*data)
	if err != nil {
		log.Fatal(err)
	}

	mux := http.NewServeMux()
	registerAPI(mux, store)
	mux.Handle("/", noStore(http.FileServerFS(pages)))

	if info, err := os.Stat(*packDir); err == nil && info.IsDir() {
		go func() {
			log.Printf("pack: http://%s/ from %s", *packListen, *packDir)
			log.Fatal(http.ListenAndServe(*packListen, noStore(http.FileServer(http.Dir(*packDir)))))
		}()
	}

	log.Printf("demo and recordings API: http://%s/ storing under %s", *listen, *data)
	log.Fatal(http.ListenAndServe(*listen, mux))
}

// The demo is rebuilt often and the browser must never show a stale page.
func noStore(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}
