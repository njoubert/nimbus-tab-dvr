# Nimbus Tab DVR: design interrogation

Questions raised against the shape of the project before research and planning.
Answer inline under each **Answer:** marker.
"Don't know" is a valid answer.

Sections are ordered by how much damage a wrong answer does.
A question that has been answered stays here with its answer, because the reason for a decision is worth more later than the decision is.

---

## 1. What it is

**1a.** What does "tab DVR" record: a browser tab's rendered video, its audio, the whole tab as a screen capture, or a stream it is playing?

**Answer:**

**1b.** Who is it for, and how many of them are there?

**Answer:**

**1c.** What does the user do with a recording once it exists?

**Answer:**

---

## 2. The load-bearing assumption

**2a.** Which capture interface is this built on, and does it give what the design needs on the platforms in scope?

**Answer:**

**2b.** What happens when that interface is unavailable, denied by the user, or changed by a browser update?

**Answer:**

---

## 3. Shape and constraints

**3a.** Is this a browser extension, a native app, a service, or a library?

**Answer:**

**3b.** Which platforms and which versions, and which of those are actually tested?

**Answer:**

**3c.** What is the dependency budget, and what is the licence?

**Answer:**

---

## 4. Failure and scale

**4a.** How long is the longest recording it must survive, and what bounds the disk it uses?

**Answer:**

**4b.** What is the acceptable loss when the process dies mid-recording?

**Answer:**

---

## 5. Distribution

**5a.** How does a user install it, and how does it update itself?

**Answer:**

**5b.** What is signed, notarized, or reviewed by a store, and who holds the credentials?

**Answer:**
