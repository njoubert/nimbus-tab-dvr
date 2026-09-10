# One sentence per line, in this repository's own markdown.
#
# A review reads a diff, and a diff reads by line. Prose wrapped at a column puts a one-word
# change on the same line as the five sentences around it, and changing a word near the start
# reflows every line after it, so the diff claims the whole paragraph changed. One sentence
# per line makes a diff say exactly what changed. docs/WRITING_STYLE.md holds the rule.
#
# It is awk so that it needs no toolchain: this repository has not chosen a language, and a
# check that gates every commit must run on a bare machine.
#
# WHAT IT DOES NOT TOUCH, because a line break there means something other than a wrap:
#   fenced code blocks, and their contents verbatim
#   table rows, which cannot be broken at all without breaking the table
#   headings, which are one line by construction
#   HTML blocks and comments
#   link reference definitions and thematic breaks
#   front matter
#   a blank line inside a blockquote, which separates quoted paragraphs
#
# A bolded lead followed by one sentence is the sanctioned bullet shape and passes: the lead's
# full stop is followed by the closing `**` rather than by a space, so it is not a boundary.
#
# It reports and never rewrites. Unwrapping hand-written markdown is not a solved problem, so
# an author does that, reading the diff afterwards.

BEGIN {
    split("e.g. i.e. etc. vs. cf. approx. no. req. fig. al. mr. mrs. ms. dr. st. jr. sr. inc. ltd. min. max.", ABBR, " ")
    NABBR = length(ABBR)
    bad = 0
}

# Replace the contents of each protected span with filler of the same length, so a full stop
# inside one can never look like the end of a sentence and every offset still points at the
# real one. The span's opening character survives, because a sentence may begin with one.
function fill(n,   r) {
    r = ""
    while (n-- > 0) r = r "x"
    return r
}

function maskpat(s, re,   out, m) {
    out = ""
    while (match(s, re)) {
        m = substr(s, RSTART, RLENGTH)
        out = out substr(s, 1, RSTART - 1) substr(m, 1, 1) fill(RLENGTH - 1)
        s = substr(s, RSTART + RLENGTH)
    }
    return out s
}

# The patterns are strings rather than regex literals: awk evaluates a literal as a match
# against $0 the moment it is passed to a function, so one handed to maskpat would arrive as 0.
function mask(s) {
    s = maskpat(s, "`[^`]*`")             # inline code
    s = maskpat(s, "[]][(][^)]*[)]")      # a link's destination
    s = maskpat(s, "<[^> \t][^>]*>")      # inline HTML and autolinks
    s = maskpat(s, "https?://[^ \t]+")    # a bare URL
    return s
}

# Whether the masked text ending at a terminator ends with an abbreviation as a whole word.
# The suffix test alone is not enough: "st." is one and "First." ends with it.
function is_abbrev(upto,   i, a, n, lower, before) {
    lower = tolower(upto)
    for (i = 1; i <= NABBR; i++) {
        a = ABBR[i]
        n = length(a)
        if (length(lower) < n) continue
        if (substr(lower, length(lower) - n + 1) != a) continue
        if (length(lower) == n) return 1
        before = substr(lower, length(lower) - n, 1)
        if (before !~ /[a-z]/) return 1
    }
    return 0
}

# How many sentence boundaries the text holds. A boundary is a full stop, question mark or
# exclamation mark, optionally followed by a closing bracket or quote, then a space, then one
# character that can begin a sentence. Requiring what follows to look like an opening is what
# keeps a filename, a decimal and a version number out of it.
function boundaries(s,   masked, pos, rest, idx, upto, before, n) {
    masked = mask(s)
    n = 0
    pos = 1
    while (pos <= length(masked)) {
        rest = substr(masked, pos)
        if (!match(rest, /[.!?][]"')]*[ \t]+[]"'([*_`A-Z0-9]/)) break
        idx = pos + RSTART - 1
        pos = idx + 1
        # An ellipsis is one terminator with a tail, not three sentences.
        before = substr(masked, 1, idx - 1)
        before = substr(before, length(before) - 1)
        if (index(before, ".") > 0) continue
        upto = substr(masked, 1, idx)
        if (is_abbrev(upto)) continue
        # A single capital before the stop is an initial, as in "N. Joubert".
        if (upto ~ /(^|[ \t])[A-Z]\.$/) continue
        n++
    }
    return n
}

FNR == 1 {
    infence = 0
    fencechar = ""
    infm = ($0 == "---")
    inhtml = 0
}

{
    line = $0

    if (infm) {
        if (FNR > 1 && line == "---") infm = 0
        next
    }

    if (match(line, /^[ \t]*(```+|~~~+)/)) {
        fence = substr(line, RSTART, RLENGTH)
        sub(/^[ \t]*/, "", fence)
        if (!infence) {
            infence = 1
            fencechar = substr(fence, 1, 1)
        } else if (substr(fence, 1, 1) == fencechar) {
            infence = 0
        }
        next
    }
    if (infence) next

    if (inhtml) {
        if (index(line, "-->") > 0) inhtml = 0
        next
    }

    text = line
    sub(/^[ \t]+/, "", text)
    sub(/[ \t]+$/, "", text)

    if (substr(text, 1, 4) == "<!--") {
        if (index(line, "-->") == 0) inhtml = 1
        next
    }

    if (text ~ /^(>[ \t]*)*$/) next
    if (substr(text, 1, 1) == "#") next
    if (substr(text, 1, 1) == "|") next
    if (substr(text, 1, 1) == "<") next
    if (text ~ /^\[[^]]+\]:[ \t]/) next
    if (text ~ /^---+$/ || text ~ /^\*\*\*+$/ || text ~ /^___+$/) next

    # A line's blockquote markers and list marker are not part of the sentence.
    body = line
    sub(/^[ \t]*(>[ \t]*)*([-*+]|[0-9]+[.)])[ \t]+/, "", body)

    count = boundaries(body)
    if (count > 0) {
        printf "%s:%d: %d sentences on one line\n", FILENAME, FNR, count + 1
        bad++
    }
}

END {
    if (bad > 0) {
        printf "\n%d line(s) hold more than one sentence. Break each at the sentence boundary.\n", bad
        printf "The rule and its reason: docs/WRITING_STYLE.md\n"
        exit 1
    }
}
