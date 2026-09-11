// Copyright (C) 2026 Niels Joubert
// SPDX-License-Identifier: MIT

package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Recording is what the backend knows about one recording: its meta.json, and the shape the
// landing page reads. Times are milliseconds since the epoch, as JavaScript writes them.
type Recording struct {
	ID              string   `json:"id"`
	Key             string   `json:"key"`
	MimeType        string   `json:"mimeType"`
	StartedAt       int64    `json:"startedAt"`
	State           string   `json:"state"`
	Chunks          int      `json:"chunks"`
	Bytes           int64    `json:"bytes"`
	LastChunkAt     int64    `json:"lastChunkAt,omitempty"`
	FinalizedAt     int64    `json:"finalizedAt,omitempty"`
	DurationSeconds *float64 `json:"durationSeconds,omitempty"`
	Reason          string   `json:"reason,omitempty"`
	URL             string   `json:"url,omitempty"`
}

const (
	StateRecording = "recording"
	StateFinalized = "finalized"
	StateFailed    = "failed"
)

var validID = regexp.MustCompile(`^[A-Za-z0-9-]{1,64}$`)

var errNotFound = errors.New("no such recording")

// Store keeps every recording under one directory: the raw chunks by sequence, meta.json,
// and recording.webm once finalized. One mutex serialises the read-modify-write of meta.json,
// which is cheap because the extension uploads one chunk at a time.
type Store struct {
	root string
	mu   sync.Mutex
}

func newStore(root string) (*Store, error) {
	if err := os.MkdirAll(root, 0o755); err != nil {
		return nil, err
	}
	return &Store{root: root}, nil
}

func (s *Store) dir(id string) string { return filepath.Join(s.root, id) }

func (s *Store) read(id string) (*Recording, error) {
	raw, err := os.ReadFile(filepath.Join(s.dir(id), "meta.json"))
	if errors.Is(err, os.ErrNotExist) {
		return nil, errNotFound
	}
	if err != nil {
		return nil, err
	}
	var rec Recording
	if err := json.Unmarshal(raw, &rec); err != nil {
		return nil, err
	}
	return &rec, nil
}

func (s *Store) write(rec *Recording) error {
	raw, err := json.MarshalIndent(rec, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(s.dir(rec.ID), "meta.json"), raw, 0o644)
}

// PutChunk stores one chunk and updates the recording's counts, creating the recording on
// its first chunk; the extension sends no separate create.
func (s *Store) PutChunk(id string, sequence int, key, mimeType string, payload []byte) (*Recording, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.MkdirAll(s.dir(id), 0o755); err != nil {
		return nil, err
	}
	name := fmt.Sprintf("%06d.chunk", sequence)
	if err := os.WriteFile(filepath.Join(s.dir(id), name), payload, 0o644); err != nil {
		return nil, err
	}
	rec, err := s.read(id)
	if errors.Is(err, errNotFound) {
		if mimeType == "" {
			mimeType = "video/webm"
		}
		rec = &Recording{ID: id, Key: key, MimeType: mimeType, StartedAt: now(), State: StateRecording}
	} else if err != nil {
		return nil, err
	}
	if sequence > rec.Chunks {
		rec.Chunks = sequence
	}
	rec.Bytes += int64(len(payload))
	rec.LastChunkAt = now()
	return rec, s.write(rec)
}

// Finalize concatenates the chunks in order, which yields exactly the WebM MediaRecorder
// produced, and remuxes it with a stream copy so the file gains the duration and the cues
// MediaRecorder never writes. Calling it twice is harmless.
func (s *Store) Finalize(id, reason string) (*Recording, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rec, err := s.read(id)
	if err != nil {
		return nil, err
	}
	if rec.State == StateFinalized {
		return rec, nil
	}
	entries, err := os.ReadDir(s.dir(id))
	if err != nil {
		return nil, err
	}
	var names []string
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".chunk") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	var raw bytes.Buffer
	for _, name := range names {
		part, err := os.ReadFile(filepath.Join(s.dir(id), name))
		if err != nil {
			return nil, err
		}
		raw.Write(part)
	}
	rawPath := filepath.Join(s.dir(id), "raw.webm")
	if err := os.WriteFile(rawPath, raw.Bytes(), 0o644); err != nil {
		return nil, err
	}
	outPath := filepath.Join(s.dir(id), "recording.webm")
	if out, err := exec.Command("ffmpeg", "-v", "error", "-y", "-i", rawPath, "-c", "copy", outPath).CombinedOutput(); err != nil {
		rec.State = StateFailed
		rec.Reason = fmt.Sprintf("ffmpeg: %s", strings.TrimSpace(string(out)+" "+err.Error()))
		return rec, errors.Join(s.write(rec), fmt.Errorf("%s", rec.Reason))
	}
	rec.State = StateFinalized
	rec.FinalizedAt = now()
	rec.Chunks = len(names)
	rec.Bytes = int64(raw.Len())
	if reason != "" {
		rec.Reason = reason
	}
	if out, err := exec.Command("ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", outPath).Output(); err == nil {
		if d, err := strconv.ParseFloat(strings.TrimSpace(string(out)), 64); err == nil {
			rec.DurationSeconds = &d
		}
	}
	rec.URL = "/api/recordings/" + id + ".webm"
	return rec, s.write(rec)
}

// List returns every recording, newest first.
func (s *Store) List() ([]*Recording, error) {
	entries, err := os.ReadDir(s.root)
	if err != nil {
		return nil, err
	}
	recs := []*Recording{}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		rec, err := s.read(e.Name())
		if err != nil {
			continue
		}
		recs = append(recs, rec)
	}
	sort.Slice(recs, func(i, j int) bool { return recs[i].StartedAt > recs[j].StartedAt })
	return recs, nil
}

func (s *Store) FilePath(id string) (string, error) {
	path := filepath.Join(s.dir(id), "recording.webm")
	if _, err := os.Stat(path); err != nil {
		return "", errNotFound
	}
	return path, nil
}

func (s *Store) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return os.RemoveAll(s.dir(id))
}

func now() int64 { return time.Now().UnixMilli() }
