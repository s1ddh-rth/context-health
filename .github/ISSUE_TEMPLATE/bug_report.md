---
name: Bug report / false alarm
about: A detector misfired, a script crashed, or something didn't work
title: ''
labels: bug
assignees: ''
---

**What happened**
A clear description. If a detector fired when it shouldn't have (a false alarm),
say so — precision matters here, false positives are first-class bugs.

**Which part**
- [ ] statusline / context math
- [ ] distraction  - [ ] confusion  - [ ] goal-drift  - [ ] contradiction
- [ ] a hook  - [ ] the worker/monitor  - [ ] a config slash command  - [ ] install/packaging

**To reproduce**
Steps, and ideally the input. You can often reproduce a hook/statusline directly:
```
node statusline/statusline.js < your-input.json
```
The session state file that shows the issue also helps:
`~/.claude/context-health-state.json` (redact anything sensitive).

**Expected vs actual**

**Environment**
- OS + shell (note: Windows / Git Bash is a supported but common break point)
- Claude Code version, Node version, `uv --version`
