// Copyright (C) 2026 Niels Joubert
// SPDX-License-Identifier: MIT

package main

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
)

// The page shares this origin and needs no CORS; the extension's origin is
// chrome-extension://<id>, which does, and any origin is answered because the demo backend
// authorises nothing.
func cors(w http.ResponseWriter) {
	h := w.Header()
	h.Set("Access-Control-Allow-Origin", "*")
	h.Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
	h.Set("Access-Control-Allow-Headers", "Content-Type, X-Recording-Key")
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	cors(w)
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		log.Printf("writing response: %v", err)
	}
}

func writeError(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}

func recordingID(w http.ResponseWriter, r *http.Request) (string, bool) {
	id := strings.TrimSuffix(r.PathValue("id"), ".webm")
	if !validID.MatchString(id) {
		writeError(w, http.StatusBadRequest, errors.New("bad recording id"))
		return "", false
	}
	return id, true
}

func registerAPI(mux *http.ServeMux, store *Store) {
	mux.HandleFunc("OPTIONS /api/", func(w http.ResponseWriter, r *http.Request) {
		cors(w)
		w.WriteHeader(http.StatusNoContent)
	})

	mux.HandleFunc("GET /api/recordings", func(w http.ResponseWriter, r *http.Request) {
		recs, err := store.List()
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, recs)
	})

	mux.HandleFunc("POST /api/recordings/{id}/chunks/{sequence}", func(w http.ResponseWriter, r *http.Request) {
		id, ok := recordingID(w, r)
		if !ok {
			return
		}
		sequence, err := strconv.Atoi(r.PathValue("sequence"))
		if err != nil || sequence < 1 {
			writeError(w, http.StatusBadRequest, errors.New("bad sequence"))
			return
		}
		payload, err := io.ReadAll(r.Body)
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		rec, err := store.PutChunk(id, sequence, r.Header.Get("X-Recording-Key"), r.Header.Get("Content-Type"), payload)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, rec)
	})

	mux.HandleFunc("POST /api/recordings/{id}/stop", func(w http.ResponseWriter, r *http.Request) {
		id, ok := recordingID(w, r)
		if !ok {
			return
		}
		var body struct {
			Reason string `json:"reason"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil && !errors.Is(err, io.EOF) {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		rec, err := store.Finalize(id, body.Reason)
		switch {
		case errors.Is(err, errNotFound):
			writeError(w, http.StatusNotFound, err)
		case err != nil:
			log.Printf("finalize %s: %v", id, err)
			writeJSON(w, http.StatusInternalServerError, rec)
		default:
			log.Printf("finalized %s: %d chunks, %d bytes, %v s", id, rec.Chunks, rec.Bytes, deref(rec.DurationSeconds))
			writeJSON(w, http.StatusOK, rec)
		}
	})

	// http.ServeFile answers Range requests, which is what lets the scrubber seek.
	mux.HandleFunc("GET /api/recordings/{id}", func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.PathValue("id"), ".webm") {
			http.NotFound(w, r)
			return
		}
		id, ok := recordingID(w, r)
		if !ok {
			return
		}
		path, err := store.FilePath(id)
		if err != nil {
			writeError(w, http.StatusNotFound, errors.New("recording "+id+" is not finalized"))
			return
		}
		cors(w)
		w.Header().Set("Content-Type", "video/webm")
		w.Header().Set("Cache-Control", "no-store")
		http.ServeFile(w, r, path)
	})

	mux.HandleFunc("DELETE /api/recordings/{id}", func(w http.ResponseWriter, r *http.Request) {
		id, ok := recordingID(w, r)
		if !ok {
			return
		}
		if err := store.Delete(id); err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"deleted": id})
	})
}

func deref(f *float64) any {
	if f == nil {
		return nil
	}
	return *f
}
